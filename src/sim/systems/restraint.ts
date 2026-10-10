import { runtimeOf, sideIndex, type SimContext } from '../context'
import type { LonLat, Posture, UnitState } from '../core/types'
import { distanceKm, terrainRule } from '../theater/grid'
import { fortFactorAt } from '../economy/economy'
import { isLineUnit } from '../units/catalog'
import { enemyShare } from './flanks'

/**
 * Attaque mesurée : une brigade qui attaque ou poursuit ne s'enfonce plus indéfiniment chez
 * l'adversaire. Toutes les quelques heures, chaque unité de ligne en ordre offensif est contrôlée :
 * - poursuite : distance parcourue depuis le début de l'ordre limitée selon la posture, réduite hors
 *   ravitaillement et sans voisines en soutien ;
 * - toute attaque (réflexes des postures, offensives, ripostes, IA) : arrêt si l'unité s'enfonce
 *   seule dans un saillant ennemi, ou si elle est coupée de son ravitaillement sans soutien.
 * L'unité s'arrête alors et consolide sur la position la plus défendable à quelques kilomètres
 * (terrain, fortifications, territoire tenu, ravitaillement, proximité des voisines), puis tient au
 * moins une journée avant d'être relancée par un réflexe, l'IA ou une riposte.
 * Ne sont pas concernées : l'ordre d'attaque direct du joueur (il vise un point qu'il a choisi), les
 * missions « Avancer », le groupe de choc des percées et les encerclements, qui ont leur propre rythme.
 */

/** Distance de poursuite (km depuis le début de l'ordre) selon la posture. */
export const PURSUIT_KM: Record<Posture, number> = {
  maxDefense: 8,
  defensive: 15,
  balanced: 25,
  offensive: 40,
  maxDamage: 60,
}
/** Rayon dans lequel une unité amie compte comme voisine en soutien. */
export const SUPPORT_KM = 20
/** Part de cellules ennemies autour de l'unité au-delà de laquelle elle s'enfonce chez l'adversaire. */
export const DEEP_SHARE = 0.6
/** Heures hors ravitaillement au-delà desquelles une unité sans soutien s'arrête. */
const UNSUPPLIED_HOURS = 12
/** Rayon de recherche de la position où consolider. */
const CONSOLIDATE_KM = 10
/** Durée minimale de consolidation avant une nouvelle attaque automatique. */
export const HALT_TICKS = 24

export type HaltReason = 'pursuit' | 'alone' | 'unsupplied'

const REASON_TEXT: Record<HaltReason, string> = {
  pursuit: 'poursuite assez longue',
  alone: 'seule en pointe',
  unsupplied: 'coupée du ravitaillement',
}

/** Motif lisible : « consolide : seule en pointe ». */
export function haltText(reason: HaltReason): string {
  return `consolide : ${REASON_TEXT[reason]}`
}

/** L'unité consolide après un arrêt : réflexes, IA et ripostes la laissent tranquille. */
export function isHalted(ctx: SimContext, u: UnitState): boolean {
  return !!u.halt && ctx.tick < u.halt.until
}

/**
 * Distance de poursuite autorisée : celle de la posture, divisée par deux hors ravitaillement,
 * ×0,5 sans voisine en soutien et ×0,75 avec une seule.
 */
export function pursuitLimitKm(
  posture: Posture | undefined,
  supplied: boolean,
  support: number,
): number {
  const base = PURSUIT_KM[posture ?? 'balanced']
  const supply = supplied ? 1 : 0.5
  const help = support >= 2 ? 1 : support === 1 ? 0.75 : 0.5
  return base * supply * help
}

/** Ordre offensif soumis au contrôle : ni attaque directe du joueur, ni mission, ni encerclement. */
function controlled(ctx: SimContext, u: UnitState): boolean {
  const k = u.order.kind
  if (k !== 'attack' && k !== 'pursue') return false
  if (k === 'attack' && u.direct) return false
  const army = u.armyId !== null ? ctx.armies.get(u.armyId) : undefined
  if (army?.encirclement || army?.mission?.kind === 'advance') return false
  // Groupe de choc d'une percée : il pousse jusqu'au point visé, ses flancs couverts par l'armée.
  if (army?.mission?.kind === 'breach' && army.mission.shockIds.includes(u.id)) return false
  return true
}

/** Contrôle des attaques et poursuites en cours (toutes les quelques heures). */
export function restrainAttacks(ctx: SimContext): void {
  const attackers: UnitState[] = []
  for (const u of ctx.units.values()) {
    if (u.halt && ctx.tick >= u.halt.until) delete u.halt
    if (!isLineUnit(u.kind) || !controlled(ctx, u) || runtimeOf(ctx, u.id).routed) continue
    // Début de l'ordre inconnu (ordre donné sans chemin, ancienne sauvegarde) : position actuelle.
    u.order.from ??= [u.lon, u.lat]
    attackers.push(u)
  }
  if (attackers.length === 0) return
  // Unités de ligne amies, par camp, pour compter les voisines en soutien.
  const lines = new Map<number, UnitState[]>()
  for (const f of ctx.units.values()) {
    if (!isLineUnit(f.kind) || runtimeOf(ctx, f.id).routed) continue
    const side = sideIndex(ctx, f.owner)
    if (ctx.matrix.atWar[side] !== 1) continue
    const list = lines.get(side)
    if (list) list.push(f)
    else lines.set(side, [f])
  }
  for (const u of attackers) {
    const side = sideIndex(ctx, u.owner)
    if (ctx.matrix.atWar[side] !== 1) continue
    const friends = friendsOf(ctx, side, lines)
    const support = supportOf(u, friends)
    const reason = overreach(ctx, u, support)
    if (reason) halt(ctx, u, reason, friends)
  }
}

/** Unités de ligne du camp et de ses alliés en guerre. */
function friendsOf(ctx: SimContext, side: number, lines: Map<number, UnitState[]>): UnitState[] {
  const out: UnitState[] = []
  for (const [s, list] of lines) if (s === side || ctx.matrix.friendly(side, s)) out.push(...list)
  return out
}

/** Nombre de voisines à moins de SUPPORT_KM. */
function supportOf(u: UnitState, friends: UnitState[]): number {
  let n = 0
  const dLat = SUPPORT_KM / 111
  for (const f of friends) {
    if (f === u || Math.abs(f.lat - u.lat) > dLat) continue
    if (distanceKm(u.lon, u.lat, f.lon, f.lat) <= SUPPORT_KM) n++
  }
  return n
}

/** Motif d'arrêt d'une unité qui attaque, ou null si elle peut continuer. */
export function overreach(ctx: SimContext, u: UnitState, support: number): HaltReason | null {
  const supplied = runtimeOf(ctx, u.id).supplied
  if (support === 0 && enemyShare(ctx, u) >= DEEP_SHARE) return 'alone'
  if (!supplied && u.hoursOutOfSupply >= UNSUPPLIED_HOURS && support < 2) return 'unsupplied'
  if (u.order.kind === 'pursue') {
    const from = u.order.from ?? [u.lon, u.lat]
    const done = distanceKm(from[0], from[1], u.lon, u.lat)
    if (done >= pursuitLimitKm(u.posture, supplied, support)) return 'pursuit'
  }
  return null
}

/** Arrêt et consolidation : l'unité rejoint la position la plus défendable à proximité. */
export function halt(
  ctx: SimContext,
  u: UnitState,
  reason: HaltReason,
  friends: UnitState[],
): void {
  const target = consolidationPoint(ctx, u, friends)
  u.halt = { until: ctx.tick + HALT_TICKS, reason }
  if (target) {
    u.order = { kind: 'move', target }
    u.path = ctx.pathfinder.find([u.lon, u.lat], target, {
      side: sideIndex(ctx, u.owner),
      enemyCost: 2,
      maxExpanded: 5_000,
    }) ?? [target]
  } else {
    u.order = { kind: 'hold' }
    u.path = []
  }
  ctx.log(`${u.name} s'arrête et consolide (${REASON_TEXT[reason]})`, u.owner, true)
}

/**
 * Position où consolider, à moins de 10 km : valeur défensive (terrain, fortifications), cellule
 * tenue par son camp et ravitaillée, rapprochement des voisines ; null si rien de mieux qu'ici.
 */
export function consolidationPoint(
  ctx: SimContext,
  u: UnitState,
  friends: UnitState[],
): LonLat | null {
  const { grid, matrix } = ctx
  const side = sideIndex(ctx, u.owner)
  let nearest: UnitState | null = null
  let nearestD = 60
  for (const f of friends) {
    if (f === u) continue
    const d = distanceKm(u.lon, u.lat, f.lon, f.lat)
    if (d < nearestD) {
      nearestD = d
      nearest = f
    }
  }
  const score = (i: number): number => {
    const lon = grid.lonOf(i)
    const lat = grid.latOf(i)
    const o = grid.owner[i] ?? 0
    const value = terrainRule(grid.terrain[i]).defense * fortFactorAt(ctx, side, lon, lat)
    const held = o !== 0 && (o === side || matrix.friendly(side, o)) ? 3 : 0
    const supplied = ctx.supplyReach[side]?.[i] === 1 ? 3 : 0
    const close = nearest ? distanceKm(lon, lat, nearest.lon, nearest.lat) / 10 : 0
    return 8 * (value - 1) + held + supplied - close - distanceKm(u.lon, u.lat, lon, lat) / 4
  }
  const here = grid.cellAt(u.lon, u.lat)
  let best = here
  let bestScore = grid.passable(here) ? score(here) : -Infinity
  grid.cellsWithin(u.lon, u.lat, CONSOLIDATE_KM, (i) => {
    if (!grid.passable(i)) return
    const s = score(i)
    if (s > bestScore) {
      bestScore = s
      best = i
    }
  })
  return best === here ? null : [grid.lonOf(best), grid.latOf(best)]
}
