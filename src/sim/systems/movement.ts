import { runtimeOf, sideIndex, type SimContext } from '../context'
import type { LonLat, UnitState } from '../core/types'
import { distanceKm, moveToward, Terrain } from '../theater/grid'

const ENTRENCH_PER_HOUR = 0.01

function speedKmh(ctx: SimContext, u: UnitState): number {
  const { grid } = ctx
  const cell = grid.cellAt(u.lon, u.lat)
  const t = grid.terrain[cell]
  let v = ctx.catalog[u.kind].speedKmh * (0.5 + 0.5 * u.org)
  if (t === Terrain.RIVER) v *= 0.3
  else if (t === Terrain.URBAN) v *= 0.7
  const owner = grid.owner[cell] ?? 0
  if (owner !== 0 && owner !== sideIndex(ctx, u.owner)) v *= 0.7
  if (u.order.kind === 'retreat') v *= 1.2
  return v
}

/** Calcule le chemin d'une unité vers une cible. Coût plus élevé en territoire ennemi sauf pour attaquer. */
export function planPath(ctx: SimContext, u: UnitState, target: LonLat): void {
  const side = sideIndex(ctx, u.owner)
  const enemyCost = u.order.kind === 'attack' ? 1.2 : u.order.kind === 'retreat' ? 8 : 2
  u.path = ctx.pathfinder.find([u.lon, u.lat], target, { side, enemyCost }) ?? []
}

/** Une heure de déplacement. Une unité au contact ne progresse pas, sauf si elle se replie. */
export function updateMovement(ctx: SimContext): void {
  for (const u of ctx.units.values()) {
    const rt = runtimeOf(ctx, u.id)
    const moving = u.path.length > 0
    const blocked = rt.engagedWith !== null && u.order.kind !== 'retreat'

    if (!moving || blocked) {
      // À l'arrêt : on se retranche, sauf en pleine attaque ou en déroute.
      if (u.order.kind !== 'attack' && !rt.routed) {
        u.entrench = Math.min(1, u.entrench + ENTRENCH_PER_HOUR)
      }
      if (!moving) finishOrder(u)
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

/** Ordre terminé : déplacement et repli deviennent « tenir », l'attaque aussi une fois l'objectif atteint. */
function finishOrder(u: UnitState): void {
  const k = u.order.kind
  if (k === 'move' || k === 'retreat' || k === 'attack') u.order = { kind: 'hold' }
}
