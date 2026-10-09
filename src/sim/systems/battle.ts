import { runtimeOf, type SimContext } from '../context'
import type { BattleReport, BattleUnit, UnitState } from '../core/types'
import { combatModifiers, defenseValue, firePower, riverBetween } from './combat'
import { nearestCity } from './ai'
import { terrainRule } from '../theater/grid'
import { obstaclesUnder } from './obstacles'

/**
 * Rapport d'une bataille : les unités demandées et toutes celles avec qui elles sont au contact
 * (de proche en proche), réparties en deux camps, avec leurs modificateurs.
 */
export function battleReport(ctx: SimContext, ids: number[], player: string): BattleReport | null {
  const units = new Map<number, UnitState>()
  const queue = ids.filter((id) => ctx.units.has(id))
  while (queue.length > 0 && units.size < 60) {
    const id = queue.pop()
    if (id === undefined || units.has(id)) continue
    const u = ctx.units.get(id)
    if (!u) continue
    units.set(id, u)
    const foe = runtimeOf(ctx, id).engagedWith
    if (foe !== null && !units.has(foe)) queue.push(foe)
    // Les unités qui frappent celle-ci font aussi partie de la bataille.
    for (const [other, rt] of ctx.runtime) {
      if (rt.engagedWith === id && !units.has(other)) queue.push(other)
    }
  }
  if (units.size === 0) return null
  const list = [...units.values()]
  const first = list[0] as UnitState
  // Camp A : celui du joueur s'il est engagé, sinon celui de la première unité.
  const anchor = list.find((u) => u.owner === player) ?? first
  const sideOf = (u: UnitState): 'a' | 'b' =>
    u.owner === anchor.owner ||
    !ctx.matrix.hostile(ctx.sideIndex.get(u.owner) ?? -1, ctx.sideIndex.get(anchor.owner) ?? -1)
      ? 'a'
      : 'b'
  const describe = (u: UnitState): BattleUnit => {
    const rt = runtimeOf(ctx, u.id)
    const foe = rt.engagedWith !== null ? ctx.units.get(rt.engagedWith) : undefined
    return {
      id: u.id,
      name: u.name,
      owner: u.owner,
      kind: u.kind,
      strength: u.strength,
      org: u.org,
      posture: u.posture ?? 'balanced',
      firePower: firePower(ctx, u),
      defense: defenseValue(ctx, u),
      routed: rt.routed,
      attacking: u.order.kind === 'attack' || u.order.kind === 'pursue',
      engagedWith: rt.engagedWith,
      riverCrossing: !!foe && riverBetween(ctx, u, foe),
      obstacles: obstaclesUnder(ctx, u),
      modifiers: combatModifiers(ctx, u),
    }
  }
  const lon = list.reduce((s, u) => s + u.lon, 0) / list.length
  const lat = list.reduce((s, u) => s + u.lat, 0) / list.length
  const cell = ctx.grid.cellAt(lon, lat)
  return {
    place: nearestCity(ctx, lon, lat),
    terrain: terrainRule(ctx.grid.terrain[cell]).name,
    lon,
    lat,
    a: list.filter((u) => sideOf(u) === 'a').map(describe),
    b: list.filter((u) => sideOf(u) === 'b').map(describe),
  }
}
