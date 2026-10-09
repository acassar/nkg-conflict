import { runtimeOf, sideIndex, type SimContext } from '../context'
import type { LonLat, UnitState } from '../core/types'
import { distanceKm, Terrain, terrainRule } from '../theater/grid'
import { fortFactorAt } from '../economy/economy'
import { isLineUnit } from '../units/catalog'
import { defenseValue } from './combat'
import { assaultFireFactor, obstaclesUnder } from './obstacles'

/** Rayon dans lequel un ennemi menace une unité qui tient le front. */
export const THREAT_KM = 15
/** Voisines de l'unité qui partagent la charge (à moitié de leur défense). */
const NEIGHBOR_KM = 20
/** Une riposte en cours contre une percée à cette distance compte comme un renfort. */
const HELP_KM = 30
/** Rayon où l'on mesure la part de cellules ennemies autour de l'unité (risque d'encerclement). */
const RING_KM = 20
/** Part de cellules ennemies à partir de laquelle l'encerclement devient un risque. */
const RING_SHARE = 0.5
/** Risque au-delà duquel l'unité décroche (×1,5 pour une ville ou une position fortifiée). */
export const WITHDRAW_RISK = 3
/** Bond de recul visé vers la ligne suivante. */
export const FALLBACK_KM = 20
/** Durée du décrochage avant que l'armée réaffecte l'unité au front. */
const FALLBACK_TICKS = 48

/** Motif de la décision d'une unité menacée. */
export type StanceReason =
  | 'reinforcements'
  | 'strongPoint'
  | 'tenable'
  | 'encircled'
  | 'unsupplied'
  | 'outnumbered'

/** Décision d'une unité menacée : tenir retranchée ou décrocher vers la ligne suivante. */
export interface Stance {
  decision: 'hold' | 'withdraw'
  reason: StanceReason
  /** Risque évalué (rapport de force corrigé de l'encerclement et du ravitaillement). */
  risk: number
  /** Fin du décrochage (tour), pour un décrochage. */
  until?: number
}

const REASON_TEXT: Record<StanceReason, string> = {
  reinforcements: 'renforts en route',
  strongPoint: 'position forte',
  tenable: 'rapport de force tenable',
  encircled: "menace d'encerclement",
  unsupplied: 'hors ravitaillement',
  outnumbered: 'rapport de force défavorable',
}

/** Motif lisible : « tient : position forte », « décroche : menace d'encerclement ». */
export function stanceText(s: Stance): string {
  return `${s.decision === 'hold' ? 'tient' : 'décroche'} : ${REASON_TEXT[s.reason]}`
}

/** Décision en cours d'une unité (absente si elle n'est pas menacée). */
export function stanceOf(ctx: SimContext, id: number): Stance | undefined {
  return ctx.runtime.get(id)?.stance
}

/** Une unité en train de décrocher : l'armée la laisse faire jusqu'à la fin du décrochage. */
export function isWithdrawing(ctx: SimContext, id: number): boolean {
  return ctx.runtime.get(id)?.stance?.decision === 'withdraw'
}

/** Puissance d'assaut brute d'une unité ennemie. */
function punch(ctx: SimContext, u: UnitState): number {
  return ctx.catalog[u.kind].attack * u.strength * (0.25 + 0.75 * u.org)
}

/** Valeur défensive d'une cellule pour un camp (terrain × fortifications), hors unité. */
function cellValue(ctx: SimContext, side: number, i: number): number {
  const { grid } = ctx
  return (
    terrainRule(grid.terrain[i]).defense * fortFactorAt(ctx, side, grid.lonOf(i), grid.latOf(i))
  )
}

/** Part de cellules ennemies autour d'un point (0 à 1). */
function hostileShare(ctx: SimContext, side: number, lon: number, lat: number): number {
  const { grid, matrix } = ctx
  let hostile = 0
  let total = 0
  grid.cellsWithin(lon, lat, RING_KM, (i) => {
    if (!grid.passable(i)) return
    total++
    const o = grid.owner[i] ?? 0
    if (o !== 0 && matrix.hostile(side, o)) hostile++
  })
  return total > 0 ? hostile / total : 0
}

/** Éléments du calcul bénéfice/risque d'une unité menacée. */
export interface Assessment {
  /** Puissance d'assaut des ennemis à portée. */
  threat: number
  /** Défense de l'unité (avec obstacles) et moitié de celle des voisines. */
  defense: number
  /** Part de cellules ennemies autour d'elle. */
  ring: number
  supplied: boolean
  /** Une riposte arrive sur une percée proche. */
  helped: boolean
  /** Ville ou position fortifiée : vaut un risque plus élevé. */
  strongPoint: boolean
  risk: number
}

/**
 * Bénéfice/risque d'une unité qui tient le front : rapport entre la puissance d'assaut des ennemis
 * proches et sa défense (terrain, retranchement, fortifications, obstacles, voisines), aggravé par
 * l'encerclement et le manque de ravitaillement. Null si aucun ennemi ne la menace.
 */
export function assess(
  ctx: SimContext,
  u: UnitState,
  enemies: UnitState[],
  friends: UnitState[],
  defenses: Map<number, number> = new Map(),
): Assessment | null {
  const side = sideIndex(ctx, u.owner)
  let threat = 0
  for (const e of enemies) {
    if (distanceKm(u.lon, u.lat, e.lon, e.lat) <= THREAT_KM) threat += punch(ctx, e)
  }
  if (threat <= 0) return null
  const own = defenseValue(ctx, u) / assaultFireFactor(obstaclesUnder(ctx, u))
  let neighbors = 0
  let helped = false
  for (const f of friends) {
    if (f.id === u.id) continue
    const rt = runtimeOf(ctx, f.id)
    if (rt.reaction) {
      const e = ctx.units.get(rt.reaction.intruder)
      if (e && distanceKm(u.lon, u.lat, e.lon, e.lat) <= HELP_KM) helped = true
      continue
    }
    if (rt.routed || f.order.kind === 'retreat') continue
    if (distanceKm(u.lon, u.lat, f.lon, f.lat) > NEIGHBOR_KM) continue
    let d = defenses.get(f.id)
    if (d === undefined) {
      d = defenseValue(ctx, f)
      defenses.set(f.id, d)
    }
    neighbors += d
  }
  const defense = own + 0.5 * neighbors
  const ring = hostileShare(ctx, side, u.lon, u.lat)
  const supplied = runtimeOf(ctx, u.id).supplied
  const cell = ctx.grid.cellAt(u.lon, u.lat)
  const strongPoint =
    ctx.grid.terrain[cell] === Terrain.URBAN || fortFactorAt(ctx, side, u.lon, u.lat) > 1
  const risk =
    (threat / Math.max(0.05, defense)) *
    (1 + 2 * Math.max(0, ring - RING_SHARE)) *
    (supplied ? 1 : 1.5)
  return { threat, defense, ring, supplied, helped, strongPoint, risk }
}

/** Décision tirée de l'évaluation : tenir (avec son motif) ou décrocher (avec la cause principale). */
export function decide(a: Assessment): Stance {
  const limit = WITHDRAW_RISK * (a.strongPoint ? 1.5 : 1)
  if (a.helped) return { decision: 'hold', reason: 'reinforcements', risk: a.risk }
  if (a.risk < limit) {
    return { decision: 'hold', reason: a.strongPoint ? 'strongPoint' : 'tenable', risk: a.risk }
  }
  const reason: StanceReason =
    a.ring > RING_SHARE + 0.1 ? 'encircled' : !a.supplied ? 'unsupplied' : 'outnumbered'
  return { decision: 'withdraw', reason, risk: a.risk }
}

/**
 * Point de repli sur la ligne suivante : environ 20 km plus loin des ennemis, en territoire ami,
 * de préférence sur une position défendable et ravitaillée. Null s'il n'y a pas où aller.
 */
export function fallbackPoint(ctx: SimContext, u: UnitState, enemies: UnitState[]): LonLat | null {
  const side = sideIndex(ctx, u.owner)
  const near = enemies.filter((e) => distanceKm(u.lon, u.lat, e.lon, e.lat) <= THREAT_KM * 2)
  if (near.length === 0) return null
  const cx = near.reduce((s, e) => s + e.lon, 0) / near.length
  const cy = near.reduce((s, e) => s + e.lat, 0) / near.length
  const from = distanceKm(u.lon, u.lat, cx, cy)
  const { grid } = ctx
  let best: LonLat | null = null
  let bestScore = -Infinity
  grid.cellsWithin(u.lon, u.lat, FALLBACK_KM + 10, (i) => {
    if (grid.owner[i] !== side || !grid.passable(i)) return
    const lon = grid.lonOf(i)
    const lat = grid.latOf(i)
    const gain = distanceKm(lon, lat, cx, cy) - from
    if (gain < FALLBACK_KM / 2) return
    const score =
      -Math.abs(gain - FALLBACK_KM) +
      8 * (cellValue(ctx, side, i) - 1) +
      (ctx.supplyReach[side]?.[i] === 1 ? 6 : 0)
    if (score > bestScore) {
      bestScore = score
      best = [lon, lat]
    }
  })
  return best
}

/** Fin des décrochages arrivés à terme : l'unité revient sous les ordres de son armée. */
function expire(ctx: SimContext): void {
  for (const [id, rt] of ctx.runtime) {
    const s = rt.stance
    if (!s) continue
    const u = ctx.units.get(id)
    if (s.decision === 'hold') {
      // Recalculée à chaque passage ; effacée si l'unité ne tient plus le front.
      if (!u || u.order.kind !== 'front' || rt.routed || rt.reaction) rt.stance = undefined
      continue
    }
    if (!u || rt.routed || ctx.tick >= (s.until ?? 0)) {
      rt.stance = undefined
      if (u && !rt.routed && u.order.kind === 'retreat') u.path = []
      if (u && !rt.routed) u.order = { kind: 'hold' }
    }
  }
}

/**
 * Tenir ou décrocher, toutes les quelques heures (après la riposte aux percées) : chaque unité de
 * ligne qui tient le front d'une armée et qu'un ennemi menace pèse le risque (rapport de force,
 * encerclement, ravitaillement) contre la valeur de sa position. Si une riposte arrive, elle tient ;
 * si le risque dépasse le seuil, elle décroche vers la ligne suivante pendant deux jours, puis
 * l'armée la réaffecte au front. Le motif reste visible dans son statut.
 */
export function holdOrFallBack(ctx: SimContext): void {
  expire(ctx)
  const enemiesBySide = new Map<number, UnitState[]>()
  for (const army of ctx.armies.values()) {
    if (!army.front && !army.wholeFront) continue
    const side = sideIndex(ctx, army.owner)
    if (ctx.matrix.atWar[side] !== 1) continue
    let enemies = enemiesBySide.get(side)
    if (!enemies) {
      enemies = [...ctx.units.values()].filter(
        (e) =>
          isLineUnit(e.kind) &&
          ctx.matrix.hostile(side, sideIndex(ctx, e.owner)) &&
          !runtimeOf(ctx, e.id).routed,
      )
      enemiesBySide.set(side, enemies)
    }
    const friends = army.unitIds
      .map((id) => ctx.units.get(id))
      .filter((u): u is UnitState => !!u && isLineUnit(u.kind))
    // Défense des unités de l'armée, calculée une fois par passage.
    const defenses = new Map<number, number>()
    // Ennemis assez proches de l'armée pour menacer une de ses unités (boîte englobante).
    const pad = (THREAT_KM * 2) / 111
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
    for (const f of friends) {
      x0 = Math.min(x0, f.lon)
      y0 = Math.min(y0, f.lat)
      x1 = Math.max(x1, f.lon)
      y1 = Math.max(y1, f.lat)
    }
    const cos = Math.max(0.2, Math.cos((((y0 + y1) / 2) * Math.PI) / 180))
    const nearby = enemies.filter(
      (e) =>
        e.lat >= y0 - pad &&
        e.lat <= y1 + pad &&
        e.lon >= x0 - pad / cos &&
        e.lon <= x1 + pad / cos,
    )
    if (nearby.length === 0) {
      for (const u of friends) {
        const rt = runtimeOf(ctx, u.id)
        if (rt.stance?.decision === 'hold') rt.stance = undefined
      }
      continue
    }
    for (const u of friends) {
      const rt = runtimeOf(ctx, u.id)
      const busy = rt.routed || !!rt.reaction || rt.stance?.decision === 'withdraw'
      if (u.order.kind !== 'front' || busy) continue
      const a = assess(ctx, u, nearby, friends, defenses)
      if (!a) {
        rt.stance = undefined
        continue
      }
      const stance = decide(a)
      if (stance.decision === 'withdraw') {
        const target = fallbackPoint(ctx, u, nearby)
        if (!target) {
          // Nulle part où aller : l'unité tient, faute de mieux.
          rt.stance = { decision: 'hold', reason: 'tenable', risk: a.risk }
          continue
        }
        u.order = { kind: 'retreat', target }
        u.path = ctx.pathfinder.find([u.lon, u.lat], target, { side, enemyCost: 8 }) ?? [target]
        u.entrench = 0
        rt.stance = { ...stance, until: ctx.tick + FALLBACK_TICKS }
        ctx.log(`${u.name} décroche (${REASON_TEXT[stance.reason]})`, u.owner, true)
      } else {
        rt.stance = stance
      }
    }
  }
}
