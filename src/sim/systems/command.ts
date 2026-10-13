import { runtimeOf, sideIndex, type SimContext } from '../context'
import type { ArmyState, FormationState, LonLat, UnitState } from '../core/types'
import { distanceKm } from '../theater/grid'
import { unitType } from '../units/templates'
import { onOwnLand } from '../politics/mobilization'
import { WarIndex } from './spatial'

/**
 * Commandement (phase D3) : chaque corps et chaque armée a un QG et une logistique intégrés, sans
 * pion, placés automatiquement à HQ_BEHIND_KM derrière le centre de ses brigades (à l'opposé des
 * ennemis proches, sinon vers la capitale). Une brigade à moins de HQ_RADIUS_KM du QG de son corps ou
 * de son armée est commandée (bonus de combat, organisation récupérée plus vite) ; la logistique
 * ravitaille dans un rayon de LOGISTICS_RADIUS_KM (supply.ts).
 *
 * Étendue de commandement : un corps commande ses divisions, une armée ses corps et ses divisions sans
 * corps. Jusqu'à SPAN_FREE subordonnés, aucun effet ; au-delà, chaque subordonné de plus retire
 * SPAN_STEP au facteur d'étendue (au plus bas SPAN_MIN), qui réduit le bonus du QG et la récupération
 * d'organisation des brigades de la formation.
 */

/** Bonus de combat d'une unité commandée par un QG proche (étendue sans malus). */
export const COMMAND_FACTOR = 1.15
/** Rayon de commandement d'un QG intégré. */
export const HQ_RADIUS_KM = 120
/** Distance du QG et de la logistique derrière le centre des brigades. */
export const HQ_BEHIND_KM = 40
/** Rayon de ravitaillement de la logistique intégrée. */
export const LOGISTICS_RADIUS_KM = 60
/** Subordonnés commandés sans malus. */
export const SPAN_FREE = 5
/** Malus par subordonné au-delà de SPAN_FREE. */
export const SPAN_STEP = 0.1
/** Facteur d'étendue minimal. */
export const SPAN_MIN = 0.5
/** Rayon dans lequel les ennemis orientent le QG vers l'arrière. */
const ENEMY_KM = 120

/** Facteur d'étendue pour `n` subordonnés : 1 jusqu'à SPAN_FREE, puis −SPAN_STEP par subordonné. */
export function spanFactor(n: number): number {
  return Math.max(SPAN_MIN, 1 - SPAN_STEP * Math.max(0, n - SPAN_FREE))
}

/** Subordonnés directs d'une armée (corps et divisions sans corps) ou d'un corps (divisions). */
export function countSubordinates(
  formations: Iterable<FormationState>,
  of: { army: number } | { corps: number },
): number {
  let n = 0
  for (const f of formations) {
    if ('corps' in of) {
      if (f.kind === 'division' && f.parentId === of.corps) n++
    } else if (f.armyId === of.army && (f.kind === 'corps' || f.parentId === null)) n++
  }
  return n
}

export function subordinates(ctx: SimContext, of: { army: number } | { corps: number }): number {
  return countSubordinates(ctx.formations.values(), of)
}

/** Texte de l'étendue de commandement, pour les fiches (« 7 subordonnés, malus −20 % »). */
export function spanText(count: number): string {
  const malus = Math.round((1 - spanFactor(count)) * 100)
  const who = `${count} subordonné${count > 1 ? 's' : ''}`
  return malus > 0 ? `${who}, malus −${malus} %` : `${who}, sans malus (jusqu'à ${SPAN_FREE})`
}

/** Étendue d'une armée ou d'un corps : subordonnés et facteur. */
export function commandSpan(
  ctx: SimContext,
  of: { army: number } | { corps: number },
): { count: number; factor: number } {
  const count = subordinates(ctx, of)
  return { count, factor: spanFactor(count) }
}

/** Point de QG : derrière le centre des brigades, sur le territoire du camp. */
function hqPoint(
  ctx: SimContext,
  side: number,
  units: UnitState[],
  index: WarIndex,
  home: LonLat | null,
): LonLat | null {
  if (units.length === 0) return null
  let lon = 0
  let lat = 0
  for (const u of units) {
    lon += u.lon
    lat += u.lat
  }
  lon /= units.length
  lat /= units.length
  // Direction de l'arrière : à l'opposé des ennemis proches, sinon vers la capitale.
  let dx = 0
  let dy = 0
  index.forEachEnemyAt(side, lon, lat, ENEMY_KM, (e) => {
    const k = Math.max(1, distanceKm(lon, lat, e.lon, e.lat))
    dx += (lon - e.lon) / k
    dy += (lat - e.lat) / k
    return false
  })
  if (dx === 0 && dy === 0 && home) {
    dx = home[0] - lon
    dy = home[1] - lat
  }
  // Pas de HQ_BEHIND_KM dans cette direction (vecteur en km : longitudes réduites par cos(lat)).
  const coslat = Math.max(0.2, Math.cos((lat * Math.PI) / 180))
  const norm = Math.hypot(dx * coslat, dy)
  if (norm > 1e-9) {
    const deg = HQ_BEHIND_KM / 111
    const tLon = lon + ((dx * coslat) / norm) * (deg / coslat)
    const tLat = lat + (dy / norm) * deg
    const at = onOwnLand(ctx, side, tLon, tLat)
    if (at && distanceKm(at[0], at[1], tLon, tLat) < HQ_BEHIND_KM) return at
  }
  return onOwnLand(ctx, side, lon, lat) ?? [lon, lat]
}

/** Capitale (ou plus grande ville) tenue par un camp. */
function capitals(ctx: SimContext): Map<number, LonLat> {
  const out = new Map<number, { at: LonLat; capital: boolean; pop: number }>()
  for (const c of ctx.cityStates.values()) {
    const best = out.get(c.owner)
    const score = { at: [c.def.lon, c.def.lat] as LonLat, capital: c.def.capital, pop: c.def.pop }
    if (
      !best ||
      (score.capital && !best.capital) ||
      (score.capital === best.capital && score.pop > best.pop)
    )
      out.set(c.owner, score)
  }
  return new Map([...out].map(([side, v]) => [side, v.at]))
}

/**
 * Place les QG intégrés des corps et des armées, puis marque les unités commandées : bonus de leur
 * corps ou de leur armée à portée (le meilleur), réduit par l'étendue de commandement ; un QG ancien
 * (pion) à portée compte aussi, sans malus.
 */
export function updateCommand(ctx: SimContext): void {
  const index = new WarIndex(ctx)
  const home = capitals(ctx)
  // Brigades par corps et par armée.
  const byCorps = new Map<number, UnitState[]>()
  const byArmy = new Map<number, UnitState[]>()
  for (const u of ctx.units.values()) {
    if (u.divisionId === undefined) continue
    const d = ctx.formations.get(u.divisionId)
    if (!d) continue
    if (d.parentId !== null) {
      const list = byCorps.get(d.parentId)
      if (list) list.push(u)
      else byCorps.set(d.parentId, [u])
    }
    const list = byArmy.get(d.armyId)
    if (list) list.push(u)
    else byArmy.set(d.armyId, [u])
  }
  const place = (target: FormationState | ArmyState, units: UnitState[]): void => {
    const side = sideIndex(ctx, target.owner)
    const at = hqPoint(ctx, side, units, index, home.get(side) ?? null)
    if (at) target.hq = at
    else delete target.hq
  }
  const corpsFactor = new Map<number, number>()
  for (const f of ctx.formations.values()) {
    if (f.kind !== 'corps') continue
    place(f, byCorps.get(f.id) ?? [])
    corpsFactor.set(f.id, spanFactor(subordinates(ctx, { corps: f.id })))
  }
  const armyFactor = new Map<number, number>()
  for (const a of ctx.armies.values()) {
    place(a, byArmy.get(a.id) ?? [])
    armyFactor.set(a.id, spanFactor(subordinates(ctx, { army: a.id })))
  }
  // QG anciens (pions) : bonus plein à portée.
  const hqsByOwner = new Map<string, UnitState[]>()
  for (const u of ctx.units.values()) {
    if (unitType(u).commandRadiusKm <= 0 || runtimeOf(ctx, u.id).routed) continue
    const list = hqsByOwner.get(u.owner)
    if (list) list.push(u)
    else hqsByOwner.set(u.owner, [u])
  }
  for (const u of ctx.units.values()) {
    const rt = runtimeOf(ctx, u.id)
    let best = 1
    let span = 1
    const d = u.divisionId !== undefined ? ctx.formations.get(u.divisionId) : undefined
    const corps = d && d.parentId !== null ? ctx.formations.get(d.parentId) : undefined
    const army = d ? ctx.armies.get(d.armyId) : undefined
    const within = (p: LonLat | undefined): boolean =>
      !!p && distanceKm(p[0], p[1], u.lon, u.lat) <= HQ_RADIUS_KM
    if (corps) {
      const f = corpsFactor.get(corps.id) ?? 1
      span = Math.min(span, f)
      if (within(corps.hq)) best = Math.max(best, 1 + (COMMAND_FACTOR - 1) * f)
    }
    if (army) {
      const f = armyFactor.get(army.id) ?? 1
      span = Math.min(span, f)
      if (within(army.hq)) best = Math.max(best, 1 + (COMMAND_FACTOR - 1) * f)
    }
    const hqs = hqsByOwner.get(u.owner)
    if (
      hqs?.some(
        (h) =>
          h.id !== u.id && distanceKm(h.lon, h.lat, u.lon, u.lat) <= unitType(h).commandRadiusKm,
      )
    )
      best = COMMAND_FACTOR
    rt.command = best
    rt.commanded = best > 1
    rt.span = span
  }
}

/** Points logistiques intégrés d'un pays (corps et armées), pour le ravitaillement. */
export function logisticsPoints(ctx: SimContext, owner: string): LonLat[] {
  const out: LonLat[] = []
  for (const f of ctx.formations.values()) if (f.owner === owner && f.hq) out.push(f.hq)
  for (const a of ctx.armies.values()) if (a.owner === owner && a.hq) out.push(a.hq)
  return out
}
