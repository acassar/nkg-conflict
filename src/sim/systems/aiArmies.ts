import { runtimeOf, sideIndex, type SimContext } from '../context'
import type { ArmyState, LineMissionKind, LonLat, Posture, UnitState } from '../core/types'
import { distanceKm } from '../theater/grid'
import { isLineUnit } from '../units/catalog'
import { postureOf } from '../units/postures'
import { assignFront, frontCells, type FrontCell } from './armies'
import { axisBonus, frontWeight } from './axes'
import { defenseValue } from './combat'
import { holdMission, startBreach } from './missions'
import { WarIndex } from './spatial'

/**
 * IA des armées : chaque jour, chaque armée d'un pays IA en guerre juge sa situation (rapport de force
 * face aux ennemis proches, état des troupes, densité sur le front, terrain) et choisit sa posture et sa
 * mission. Seules les missions de ligne (Tenir, Points clés, Profondeur) et la percée sur un axe sont
 * utilisées ; « Avancer », « Retraite » et « Réserve » restent au joueur pour l'instant.
 */

/** Rayon (km) autour des unités de l'armée où l'on compte les ennemis. */
const CONTACT_KM = 50
/** Délai minimal entre deux changements de posture ou de mission d'une armée (3 jours). */
const CHANGE_COOLDOWN_TICKS = 72
/** Durée d'une poussée offensive (4 jours), puis pause opérationnelle (6 jours). */
const OFFENSIVE_PUSH_TICKS = 96
const OFFENSIVE_PAUSE_TICKS = 144
/** Délai minimal entre deux percées d'une même armée (15 jours). */
const BREACH_COOLDOWN_TICKS = 360
/** Écart de rapport de force exigé pour quitter la posture actuelle (évite les allers-retours). */
const HYSTERESIS = 0.1

/** Seuils de rapport de force (puissance de l'armée / puissance ennemie au contact). */
export const AI_RATIO = {
  /** Percée sur un axe. */
  breach: 2.5,
  /** Posture offensive. */
  offensive: 2,
  /** Posture équilibrée. */
  balanced: 0.5,
  /** Posture défensive ; en dessous, défense max. */
  defensive: 0.3,
}
/** Organisation moyenne minimale pour une posture offensive (0,65 pour une percée). */
const MIN_ORG_OFFENSIVE = 0.6
const MIN_ORG_BREACH = 0.65
/** Unités de ligne minimales pour lancer une percée (la moitié forme le groupe de choc). */
const MIN_BREACH_UNITS = 8
/** Densité (unités de ligne pour 100 km de front) en dessous de laquelle l'armée tient les points clés. */
const THIN_DENSITY = 0.5
/** Densité au-dessus de laquelle une armée faible peut tenir deux lignes (défense en profondeur). */
const DEPTH_DENSITY = 1.5
/** Part de front calme (terrain difficile sans route) au-delà de laquelle les points clés suffisent. */
const CALM_SHARE = 0.35
/** Profondeur (km) du point visé par une percée, à défaut de ville ennemie à portée. */
const BREACH_DEPTH_KM = 60
/** Ville ennemie retenue comme but de percée si elle est à moins de tant de km du point de départ. */
const BREACH_CITY_KM = 120

/** Mémoire de l'IA pour une armée (non sauvegardée : recalculée après un chargement). */
export interface AiArmyMemory {
  lastChange: number
  lastBreach: number
  /** Début de la poussée offensive en cours (posture offensive), ou fin de la dernière. */
  offensiveSince: number
  offensiveEnded: number
}

/** Situation d'une armée, telle que l'IA la juge. */
export interface ArmySituation {
  /** Puissance au contact de l'armée / puissance ennemie à moins de 50 km de ses unités (3 si aucun ennemi). */
  ratio: number
  /** Organisation moyenne des unités de ligne. */
  org: number
  lineUnits: number
  /** Unités de ligne pour 100 km de front. */
  density: number
  /** Part du front en secteur calme (terrain difficile sans route, voie ferrée ni ville). */
  calmShare: number
  /** Ennemi au contact. */
  contact: boolean
}

/** Plan choisi pour une armée. */
export interface ArmyPlan {
  posture: Posture
  mission: LineMissionKind | 'breach'
}

/** Puissance d'une unité pour le rapport de force (blindés et mécanisés comptent davantage). */
function punch(u: UnitState): number {
  const kind = u.kind === 'tank' ? 1.5 : u.kind === 'mech' ? 1.25 : 1
  return kind * u.strength * (0.25 + 0.75 * u.org)
}

function lineOf(ctx: SimContext, army: ArmyState): UnitState[] {
  return army.unitIds
    .map((id) => ctx.units.get(id))
    .filter((u): u is UnitState => !!u && isLineUnit(u.kind) && !runtimeOf(ctx, u.id).routed)
}

/** Juge la situation d'une armée qui tient un front. */
export function assessArmy(
  ctx: SimContext,
  army: ArmyState,
  index: WarIndex,
  cells: FrontCell[],
): ArmySituation {
  const line = lineOf(ctx, army)
  // Rapport de force symétrique : nos unités qui ont un ennemi à moins de 50 km, face aux ennemis à moins
  // de 50 km de l'une d'elles (les réserves lointaines des deux camps ne comptent pas).
  let own = 0
  let org = 0
  const seen = new Map<number, UnitState>()
  for (const u of line) {
    org += u.org
    let near = false
    index.forEachEnemy(u, CONTACT_KM, (e) => {
      if (!isLineUnit(e.kind) || runtimeOf(ctx, e.id).routed) return
      near = true
      seen.set(e.id, e)
    })
    if (near) own += punch(u)
  }
  let enemy = 0
  for (const e of seen.values()) enemy += punch(e)
  const kmPerCell = ctx.grid.cell * 111
  const frontKm = Math.max(1, cells.length * kmPerCell)
  let calm = 0
  let sampled = 0
  for (let k = 0; k < cells.length; k += 3) {
    const c = cells[k]
    if (!c) continue
    sampled++
    if (frontWeight(ctx, c.cell) < 1) calm++
  }
  return {
    ratio: enemy > 0 ? own / enemy : 3,
    org: line.length ? org / line.length : 0,
    lineUnits: line.length,
    density: (line.length * 100) / frontKm,
    calmShare: sampled ? calm / sampled : 0,
    contact: seen.size > 0,
  }
}

/** Rang d'une posture, de la plus prudente (0) à la plus agressive (4). */
const RANK: Record<Posture, number> = {
  maxDefense: 0,
  defensive: 1,
  balanced: 2,
  offensive: 3,
  maxDamage: 4,
}

/**
 * Posture selon le rapport de force et l'organisation. La posture actuelle n'est quittée que si le
 * rapport franchit le seuil d'au moins 10 % (hystérésis).
 */
export function choosePosture(s: ArmySituation, current: Posture): Posture {
  const pick = (r: number): Posture => {
    // Troupes épuisées : pas mieux que défensive.
    if (s.org < 0.4 && r >= AI_RATIO.defensive) return 'defensive'
    if (r >= AI_RATIO.offensive && s.org >= MIN_ORG_OFFENSIVE) return 'offensive'
    if (r >= AI_RATIO.balanced) return 'balanced'
    if (r >= AI_RATIO.defensive) return 'defensive'
    return 'maxDefense'
  }
  if (!s.contact) return 'balanced'
  const p = pick(s.ratio)
  const cur = current === 'maxDamage' ? 'offensive' : current
  if (p === cur) return p
  // Hystérésis : on ne change que si le rapport, décalé de 10 % vers la posture actuelle, confirme.
  const shifted = RANK[p] > RANK[cur] ? s.ratio * (1 - HYSTERESIS) : s.ratio * (1 + HYSTERESIS)
  const confirmed = pick(shifted)
  return RANK[p] > RANK[cur]
    ? RANK[confirmed] > RANK[cur]
      ? confirmed
      : cur
    : RANK[confirmed] < RANK[cur]
      ? confirmed
      : cur
}

/**
 * Mission selon la situation : percée si l'armée écrase l'ennemi et que ses troupes sont fraîches ;
 * défense en profondeur si elle est nettement plus faible mais assez nombreuse pour deux lignes ;
 * points clés si elle est trop étirée ou si le front est en grande partie calme ; sinon « Tenir ».
 */
export function chooseMission(s: ArmySituation, breachReady: boolean): ArmyPlan['mission'] {
  if (
    breachReady &&
    s.contact &&
    s.ratio >= AI_RATIO.breach &&
    s.org >= MIN_ORG_BREACH &&
    s.lineUnits >= MIN_BREACH_UNITS
  ) {
    return 'breach'
  }
  if (s.contact && s.ratio < AI_RATIO.balanced && s.density >= DEPTH_DENSITY) return 'depth'
  if (s.density < THIN_DENSITY) return 'keyPoints'
  if (s.calmShare >= CALM_SHARE && s.ratio < 1) return 'keyPoints'
  return 'hold'
}

/**
 * But d'une percée : le point du front le plus faible (défense ennemie à moins de 30 km, un axe la
 * divise jusqu'à deux), puis la ville ennemie la plus proche dans cette direction (objectif), à défaut
 * un point 60 km chez l'ennemi.
 */
export function breachTarget(
  ctx: SimContext,
  side: number,
  cells: FrontCell[],
  index: WarIndex,
): LonLat | null {
  const { grid } = ctx
  const enemies = index.units.filter((e) => ctx.matrix.hostile(side, index.sideOf.get(e.id) ?? -1))
  // Points du front, du plus faible au plus fort.
  const candidates: Array<{ c: FrontCell; power: number }> = []
  for (let k = 0; k < cells.length; k += 5) {
    const c = cells[k]
    if (!c) continue
    const lon = grid.lonOf(c.cell)
    const lat = grid.latOf(c.cell)
    let power = 0
    for (const e of enemies) {
      if (distanceKm(lon, lat, e.lon, e.lat) < 30) power += defenseValue(ctx, e)
    }
    candidates.push({ c, power: power / (1 + axisBonus(ctx, c.cell) / 5) })
  }
  candidates.sort((x, y) => x.power - y.power)
  const hostileAt = (p: LonLat): boolean => {
    const t = grid.cellAt(p[0], p[1])
    const o = t >= 0 ? (grid.owner[t] ?? 0) : 0
    return t >= 0 && grid.passable(t) && o !== 0 && ctx.matrix.hostile(side, o)
  }
  // Le front est irrégulier : on garde le premier point faible dont la direction mène bien chez l'ennemi.
  for (const { c } of candidates.slice(0, 8)) {
    const lon = grid.lonOf(c.cell)
    const lat = grid.latOf(c.cell)
    const len = Math.hypot(c.back[0], c.back[1]) || 1
    // Direction de l'ennemi (à l'opposé de l'arrière ; lignes de la grille du nord au sud).
    const dir: LonLat = [-c.back[0] / len, c.back[1] / len]
    const cos = Math.cos((lat * Math.PI) / 180) || 1
    const ahead = (km: number): LonLat => [
      lon + (dir[0] * km) / 111 / cos,
      lat + (dir[1] * km) / 111,
    ]
    if (!hostileAt(ahead(20))) continue
    let best: LonLat | null = null
    let bestD = BREACH_CITY_KM
    for (const city of ctx.cities) {
      const d = distanceKm(lon, lat, city.lon, city.lat)
      if (d < 15 || d >= bestD || !hostileAt([city.lon, city.lat])) continue
      // Ville devant le point de départ (dans un cône de ±60° autour de la direction de l'ennemi).
      const vx = (city.lon - lon) * cos
      const vy = city.lat - lat
      const dot = (vx * dir[0] + vy * dir[1]) / (Math.hypot(vx, vy) || 1)
      if (dot < 0.5) continue
      bestD = d
      best = [city.lon, city.lat]
    }
    if (best) return best
    for (const km of [BREACH_DEPTH_KM, 40]) {
      const p = ahead(km)
      if (hostileAt(p)) return p
    }
  }
  return null
}

/** Donne une posture à toute l'armée (recrues comprises) ; nouvelle répartition si elle change les postes. */
export function applyArmyPosture(ctx: SimContext, army: ArmyState, posture: Posture): void {
  army.posture = posture
  for (const id of army.unitIds) {
    const u = ctx.units.get(id)
    if (u) u.posture = posture
  }
}

/**
 * Revue quotidienne des armées d'un pays IA. Renvoie vrai si une armée est en percée (l'offensive
 * ponctuelle de l'IA attend alors la fin de la percée).
 */
export function updateAiArmies(
  ctx: SimContext,
  country: string,
  memory: Map<number, AiArmyMemory>,
  index: WarIndex,
): boolean {
  const side = sideIndex(ctx, country)
  let breaching = false
  for (const army of ctx.armies.values()) {
    if (army.owner !== country || army.encirclement) continue
    const kind = army.mission?.kind ?? 'hold'
    if (kind === 'breach') {
      breaching = true
      continue
    }
    if (kind === 'advance' || kind === 'retreat' || army.offensive?.launched) continue
    if (!army.front && !army.wholeFront) continue
    let mem = memory.get(army.id)
    if (!mem) {
      mem = {
        lastChange: -Infinity,
        lastBreach: -Infinity,
        offensiveSince: -Infinity,
        offensiveEnded: -Infinity,
      }
      memory.set(army.id, mem)
    }
    if (ctx.tick - mem.lastChange < CHANGE_COOLDOWN_TICKS) continue
    const cells = frontCells(ctx, side, army.wholeFront ? null : army.front)
    if (cells.length === 0) continue
    const s = assessArmy(ctx, army, index, cells)
    const current = army.posture ?? 'balanced'
    let posture = choosePosture(s, current)
    // Pause opérationnelle : une poussée offensive dure 4 jours au plus, suivie de 6 jours sans.
    if (posture === 'offensive') {
      if (current !== 'offensive') {
        if (ctx.tick - mem.offensiveEnded < OFFENSIVE_PAUSE_TICKS) posture = 'balanced'
        else mem.offensiveSince = ctx.tick
      } else if (ctx.tick - mem.offensiveSince >= OFFENSIVE_PUSH_TICKS) posture = 'balanced'
    }
    if (current === 'offensive' && posture !== 'offensive') mem.offensiveEnded = ctx.tick
    let mission = chooseMission(s, ctx.tick - mem.lastBreach >= BREACH_COOLDOWN_TICKS)
    let changed = false
    if (mission === 'breach') {
      const target = breachTarget(ctx, side, cells, index)
      if (target && startBreach(ctx, army, target) === null) {
        mem.lastBreach = ctx.tick
        breaching = true
        changed = true
      } else mission = 'hold'
    }
    if (mission !== 'breach' && mission !== kind) {
      holdMission(ctx, army, mission)
      changed = true
    }
    if (posture !== current) {
      const before = postureOf(current)
      applyArmyPosture(ctx, army, posture)
      // Postes choisis selon le terrain en défensive : répartition refaite si l'on entre ou sort de ce mode.
      const favorable = (p: Posture): boolean => p === 'defensive' || p === 'maxDefense'
      if (favorable(posture) !== favorable(current) && army.mission?.kind !== 'breach') {
        assignFront(ctx, army)
      }
      ctx.log(
        `${army.name} passe en posture ${postureOf(posture).name.toLowerCase()} (rapport de force ${s.ratio.toFixed(1).replace('.', ',')}, avant : ${before.name.toLowerCase()})`,
        army.owner,
        true,
      )
      changed = true
    }
    if (changed) mem.lastChange = ctx.tick
  }
  return breaching
}
