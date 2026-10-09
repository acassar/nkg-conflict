import { sideIndex, type SimContext } from '../context'
import type { UnitState } from '../core/types'
import { Terrain } from '../theater/grid'
import { postureOf } from '../units/postures'

/**
 * Obstacles (mines, barbelés, positions préparées) : posés cellule par cellule par les unités
 * retranchées d'un camp en guerre, ils freinent les assauts contre ce camp. Quand la cellule change
 * de mains, l'occupant les lève peu à peu (déminage).
 */
export interface ObstacleField {
  /** Niveau, de 0 à 1 (1 = champ d'obstacles complet). */
  level: number
  /** Index du camp qui les a posés (seul ce camp en profite). */
  side: number
}

/** Durée d'un retranchement en terrain découvert pour un champ d'obstacles complet : 30 jours. */
export const OBSTACLES_PER_HOUR = 1 / (30 * 24)
/** Ville et forêt se prêtent mieux aux positions préparées. */
const TERRAIN_RATE: Partial<Record<number, number>> = {
  [Terrain.URBAN]: 2,
  [Terrain.FOREST]: 1.5,
}
/** Puissance de feu d'un assaut contre un champ complet (−30 %). */
export const OBSTACLE_FIRE_MALUS = 0.3
/** Pertes supplémentaires de l'attaquant face à un champ complet (+50 %). */
export const OBSTACLE_LOSS_BONUS = 0.5
/** Déminage par l'occupant, par jour : un champ complet est levé en 8 jours environ. */
export const DEMINING_PER_DAY = 0.125

/** Rythme de pose sur une cellule, selon son terrain. */
export function obstacleRate(terrain: number | undefined): number {
  return OBSTACLES_PER_HOUR * (TERRAIN_RATE[terrain ?? 0] ?? 1)
}

/** Une heure de retranchement : la cellule de l'unité se garnit d'obstacles de son camp. */
export function layObstacles(ctx: SimContext, u: UnitState): void {
  const side = sideIndex(ctx, u.owner)
  if (side <= 0 || ctx.matrix.atWar[side] !== 1) return
  const cell = ctx.grid.cellAt(u.lon, u.lat)
  if (ctx.grid.owner[cell] !== side) return
  const rate = obstacleRate(ctx.grid.terrain[cell]) * postureOf(u.posture).entrench
  const field = ctx.obstacles.get(cell)
  if (!field || field.side !== side) {
    // Des obstacles adverses restés sur place sont d'abord levés par le déminage quotidien.
    if (!field) ctx.obstacles.set(cell, { level: Math.min(1, rate), side })
    return
  }
  field.level = Math.min(1, field.level + rate)
}

/** Niveau des obstacles de son camp sous une unité (0 sans obstacles). */
export function obstaclesUnder(ctx: SimContext, u: UnitState): number {
  const field = ctx.obstacles.get(ctx.grid.cellAt(u.lon, u.lat))
  return field && field.side === sideIndex(ctx, u.owner) ? field.level : 0
}

/** Facteur de puissance de feu d'un assaut contre des obstacles de niveau `level`. */
export function assaultFireFactor(level: number): number {
  return 1 - OBSTACLE_FIRE_MALUS * level
}

/** Facteur de pertes de l'attaquant frappé depuis des obstacles de niveau `level`. */
export function assaultLossFactor(level: number): number {
  return 1 + OBSTACLE_LOSS_BONUS * level
}

/** Une journée de déminage : l'occupant d'une cellule lève les obstacles laissés par un autre camp. */
export function clearObstacles(ctx: SimContext): void {
  for (const [cell, field] of ctx.obstacles) {
    if (ctx.grid.owner[cell] === field.side) continue
    field.level -= DEMINING_PER_DAY
    if (field.level <= 0) ctx.obstacles.delete(cell)
  }
}
