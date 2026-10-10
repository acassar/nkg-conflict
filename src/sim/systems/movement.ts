import { runtimeOf, sideIndex, type SimContext } from '../context'
import { isOffensiveOrder, type LonLat, type OrderKind, type UnitState } from '../core/types'
import { distanceKm, moveToward, terrainRule } from '../theater/grid'
import { CONTACT_KM, retreatFromEnemy } from './combat'
import { WarIndex } from './spatial'
import { postureOf } from '../units/postures'
import { layObstacles } from './obstacles'

const ENTRENCH_PER_HOUR = 0.01

function speedKmh(ctx: SimContext, u: UnitState): number {
  const { grid } = ctx
  const cell = grid.cellAt(u.lon, u.lat)
  const t = grid.terrain[cell]
  let v = ctx.catalog[u.kind].speedKmh * (0.5 + 0.5 * u.org)
  v *= terrainRule(t).speed
  const owner = grid.owner[cell] ?? 0
  if (ctx.matrix.hostile(sideIndex(ctx, u.owner), owner)) v *= 0.7
  if (u.order.kind === 'retreat') v *= 1.2
  return v
}

/** Calcule le chemin d'une unité vers une cible. Coût plus élevé en territoire ennemi sauf pour attaquer. */
export function planPath(ctx: SimContext, u: UnitState, target: LonLat): void {
  const side = sideIndex(ctx, u.owner)
  // Début d'un ordre offensif : point de départ gardé pour mesurer l'avance (attaque mesurée).
  if (isOffensiveOrder(u.order.kind)) u.order.from ??= [u.lon, u.lat]
  const enemyCost = isOffensiveOrder(u.order.kind) ? 1.2 : u.order.kind === 'retreat' ? 8 : 2
  // Long trajet : recherche plus gourmande et bornée, pour ne pas figer la partie sur les grands fronts.
  const far =
    ctx.grid.size > 1_000_000 && distanceKm(u.lon, u.lat, target[0], target[1]) > LONG_TRIP_KM
  u.path =
    ctx.pathfinder.find(
      [u.lon, u.lat],
      target,
      far ? { side, enemyCost, greed: FRONT_GREED, maxExpanded: 40_000 } : { side, enemyCost },
    ) ?? []
}

/** Chemins calculés au plus par tick pour les postes de front : évite les à-coups sur les grands fronts. */
const QUEUED_PATHS_PER_TICK = 3
/** Exploration maximale pour rejoindre un poste : le chemin partiel est complété aux tours suivants. */
const FRONT_MAX_EXPANDED = 20_000
/** Heuristique plus gourmande pour ces trajets : le chemin exact compte moins que sa rapidité. */
const FRONT_GREED = 2.5
/** Sur la carte du monde, au-delà de cette distance, un trajet utilise la recherche gourmande. */
const LONG_TRIP_KM = 150

/**
 * Calcule quelques chemins en attente (postes de front attribués par les armées, marche des missions
 * « Avancer » sur la carte du monde). Une unité dont le
 * chemin partiel s'arrête avant son poste est remise en attente par la répartition suivante.
 */
export function planQueuedPaths(ctx: SimContext): void {
  let budget = QUEUED_PATHS_PER_TICK
  for (const u of ctx.units.values()) {
    if (budget <= 0) return
    const rt = ctx.runtime.get(u.id)
    if (!rt?.pathPending) continue
    rt.pathPending = false
    const target = u.order.target
    const kind = u.order.kind
    if ((kind !== 'front' && kind !== 'attack' && kind !== 'move') || !target) continue
    const side = sideIndex(ctx, u.owner)
    u.path =
      ctx.pathfinder.find([u.lon, u.lat], target, {
        side,
        enemyCost: kind === 'attack' ? 1.2 : 2,
        maxExpanded: FRONT_MAX_EXPANDED,
        greed: FRONT_GREED,
      }) ?? []
    budget--
  }
}

/** Une heure de déplacement. Une unité au contact ne progresse pas, sauf si elle se replie. */
export function updateMovement(ctx: SimContext): void {
  // Index des camps en guerre, construit seulement s'il y a une unité en déroute à l'arrêt.
  let index: WarIndex | null = null
  for (const u of ctx.units.values()) {
    const rt = runtimeOf(ctx, u.id)
    // Une unité en déroute continue de décrocher tant qu'un ennemi est proche, jusqu'à se rallier.
    if (rt.routed && u.path.length === 0) {
      index ??= new WarIndex(ctx)
      if (index.nearestEnemy(u, CONTACT_KM * 3)) retreatFromEnemy(ctx, u, index)
    }
    const moving = u.path.length > 0
    const blocked = rt.engagedWith !== null && u.order.kind !== 'retreat'

    if (!moving || blocked) {
      // À l'arrêt : on se retranche, sauf en pleine attaque ou en déroute.
      if (!isOffensiveOrder(u.order.kind) && !rt.routed) {
        u.entrench = Math.min(1, u.entrench + ENTRENCH_PER_HOUR * postureOf(u.posture).entrench)
        layObstacles(ctx, u)
      }
      if (!moving) {
        finishOrder(u)
        // Ordre direct du joueur terminé : on note l'heure, l'armée reprendra l'unité ensuite.
        if (u.direct && u.direct.doneAt === undefined && !isRunningOrder(u.order.kind)) {
          u.direct.doneAt = ctx.tick
        }
      }
      continue
    }

    u.entrench = 0
    let budget = speedKmh(ctx, u)
    while (budget > 0 && u.path.length > 0) {
      const next = u.path[0]
      if (!next) break
      const d = distanceKm(u.lon, u.lat, next[0], next[1])
      ;[u.lon, u.lat] = moveToward(u.lon, u.lat, next[0], next[1], budget)
      budget -= d
      if (budget >= 0) u.path.shift()
    }
  }
}

/** Distance au-delà de laquelle une poursuite est abandonnée. */
const PURSUIT_MAX_KM = 250
/** La cible a bougé de plus de tant depuis le dernier calcul : nouveau chemin. */
const PURSUIT_REPLAN_KM = 4

/**
 * Poursuites : les unités suivent leur cible où qu'elle aille, jusqu'à sa destruction,
 * la fin de la guerre ou sa fuite hors de portée.
 */
export function updatePursuits(ctx: SimContext): void {
  for (const u of ctx.units.values()) {
    if (u.order.kind !== 'pursue') continue
    const target = u.order.unitId !== undefined ? ctx.units.get(u.order.unitId) : undefined
    const hostile =
      !!target && ctx.matrix.hostile(sideIndex(ctx, u.owner), sideIndex(ctx, target.owner))
    if (!target || !hostile || distanceKm(u.lon, u.lat, target.lon, target.lat) > PURSUIT_MAX_KM) {
      ctx.log(
        target && hostile
          ? `${u.name} perd la trace de ${target.name}`
          : `${u.name} : poursuite terminée`,
        u.owner,
      )
      u.order = { kind: 'hold' }
      u.path = []
      continue
    }
    const last = u.order.target
    const moved = !last || distanceKm(last[0], last[1], target.lon, target.lat) > PURSUIT_REPLAN_KM
    if (moved || (u.path.length === 0 && runtimeOf(ctx, u.id).engagedWith === null)) {
      const from = u.order.from
      u.order = { kind: 'pursue', unitId: target.id, target: [target.lon, target.lat] }
      if (from) u.order.from = from
      planPath(ctx, u, [target.lon, target.lat])
    }
  }
}

/** Ordre encore en cours d'exécution (déplacement, repli, attaque, poursuite). */
function isRunningOrder(kind: OrderKind): boolean {
  return kind === 'move' || kind === 'retreat' || isOffensiveOrder(kind)
}

/** Ordre terminé : déplacement et repli deviennent « tenir », l'attaque aussi une fois l'objectif atteint. */
function finishOrder(u: UnitState): void {
  const k = u.order.kind
  if (k === 'move' || k === 'retreat' || k === 'attack') u.order = { kind: 'hold' }
}
