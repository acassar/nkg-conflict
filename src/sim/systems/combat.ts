import { runtimeOf, sideIndex, type SimContext } from '../context'
import type { LonLat, UnitState } from '../core/types'
import { distanceKm, Terrain, terrainRule } from '../theater/grid'
import { fortFactor, useMunitions } from '../economy/economy'

/** Distance à laquelle deux unités ennemies sont au contact et combattent. */
export const CONTACT_KM = 10
/** Seuil d'organisation sous lequel une unité décroche. */
export const ROUT_ORG = 0.15
/** Organisation à retrouver pour redevenir apte au combat. */
export const RALLY_ORG = 0.5

const STRENGTH_LOSS = 0.0025
const ORG_LOSS = 0.02
const ARTILLERY_FACTOR = 0.6
const OUT_OF_SUPPLY_FACTOR = 0.6
/** Bonus de combat d'une unité commandée par un QG proche. */
const COMMAND_FACTOR = 1.15
/** Récupération d'organisation hors combat, par heure (ravitaillée / commandée en plus). */
const ORG_RECOVERY = 0.01
const ORG_RECOVERY_COMMAND = 0.005

function commandFactor(ctx: SimContext, u: UnitState): number {
  return runtimeOf(ctx, u.id).commanded ? COMMAND_FACTOR : 1
}

/** Marque les unités à portée d'un QG de leur camp qui n'est pas en déroute. */
export function updateCommand(ctx: SimContext): void {
  const hqs = [...ctx.units.values()].filter(
    (u) => ctx.catalog[u.kind].commandRadiusKm > 0 && !runtimeOf(ctx, u.id).routed,
  )
  for (const u of ctx.units.values()) {
    runtimeOf(ctx, u.id).commanded = hqs.some(
      (h) =>
        h.owner === u.owner &&
        h.id !== u.id &&
        distanceKm(h.lon, h.lat, u.lon, u.lat) <= ctx.catalog[h.kind].commandRadiusKm,
    )
  }
}

function supplyFactor(ctx: SimContext, u: UnitState): number {
  return runtimeOf(ctx, u.id).supplied ? 1 : OUT_OF_SUPPLY_FACTOR
}

function terrainDefense(ctx: SimContext, u: UnitState): number {
  const t = ctx.grid.terrain[ctx.grid.cellAt(u.lon, u.lat)]
  return terrainRule(t).defense
}

/** Vrai si un fleuve sépare les deux unités (échantillonnage du segment). */
function riverBetween(ctx: SimContext, a: UnitState, b: UnitState): boolean {
  for (let k = 1; k < 6; k++) {
    const t = k / 6
    const c = ctx.grid.cellAt(a.lon + (b.lon - a.lon) * t, a.lat + (b.lat - a.lat) * t)
    if (ctx.grid.terrain[c] === Terrain.RIVER) return true
  }
  return false
}

function isOffensive(u: UnitState): boolean {
  return u.order.kind === 'attack'
}

/** Valeur de combat effective, sans unité. */
export function firePower(ctx: SimContext, u: UnitState): number {
  const type = ctx.catalog[u.kind]
  const base = isOffensive(u) ? type.attack : type.defense
  return base * u.strength * (0.25 + 0.75 * u.org) * supplyFactor(ctx, u) * commandFactor(ctx, u)
}

export function defenseValue(ctx: SimContext, u: UnitState): number {
  const type = ctx.catalog[u.kind]
  return (
    type.defense *
    u.strength *
    (0.25 + 0.75 * u.org) *
    supplyFactor(ctx, u) *
    commandFactor(ctx, u) *
    terrainDefense(ctx, u) *
    fortFactor(ctx, u) *
    (1 + 0.5 * u.entrench)
  )
}

function nearestEnemy(
  ctx: SimContext,
  u: UnitState,
  enemies: UnitState[],
  maxKm: number,
): UnitState | null {
  let best: UnitState | null = null
  let bestD = maxKm
  for (const e of enemies) {
    if (e.owner === u.owner) continue
    const d = distanceKm(u.lon, u.lat, e.lon, e.lat)
    if (d <= bestD) {
      bestD = d
      best = e
    }
  }
  return best
}

function hit(ctx: SimContext, from: UnitState, target: UnitState, factor: number): void {
  let defense = defenseValue(ctx, target)
  if (isOffensive(from) && riverBetween(ctx, from, target)) defense *= 1.4
  // Chaque tir consomme des munitions ; l'artillerie en consomme deux fois plus.
  const ammo = useMunitions(ctx, from.owner, ctx.catalog[from.kind].supportRangeKm > 0 ? 2 : 1)
  const ratio = Math.min(4, (firePower(ctx, from) * ammo) / Math.max(0.05, defense))
  const roll = ctx.rng.range(0.8, 1.2)
  target.strength = Math.max(0, target.strength - STRENGTH_LOSS * ratio * roll * factor)
  target.org = Math.max(0, target.org - ORG_LOSS * ratio * roll * factor)
}

/** Une heure de combat : contacts, tirs, appui d'artillerie, décrochages, unités détruites. */
export function updateCombat(ctx: SimContext): void {
  const units = [...ctx.units.values()]

  // 1. Contacts.
  for (const u of units) {
    const rt = runtimeOf(ctx, u.id)
    const e = nearestEnemy(ctx, u, units, CONTACT_KM)
    rt.engagedWith = e ? e.id : null
  }

  // 2. Tirs directs (chaque unité au contact frappe son adversaire le plus proche).
  for (const u of units) {
    const rt = runtimeOf(ctx, u.id)
    if (rt.engagedWith === null || rt.routed) continue
    const target = ctx.units.get(rt.engagedWith)
    if (target) hit(ctx, u, target, 1)
  }

  // 3. Artillerie : frappe l'ennemi le plus proche à portée, même sans contact direct.
  for (const u of units) {
    const range = ctx.catalog[u.kind].supportRangeKm
    if (range <= 0 || runtimeOf(ctx, u.id).routed) continue
    const target = nearestEnemy(ctx, u, units, range)
    if (target) hit(ctx, u, target, ARTILLERY_FACTOR)
  }

  // 4. Organisation, décrochage, ralliement, pertes.
  for (const u of units) {
    const rt = runtimeOf(ctx, u.id)
    if (rt.engagedWith === null) {
      const recovery = rt.supplied
        ? ORG_RECOVERY + (rt.commanded ? ORG_RECOVERY_COMMAND : 0)
        : 0.002
      u.org = Math.min(1, u.org + recovery)
    }
    if (!rt.supplied) {
      u.hoursOutOfSupply++
      if (u.hoursOutOfSupply > 72) u.strength = Math.max(0, u.strength - 0.002)
    } else {
      u.hoursOutOfSupply = 0
    }
    if (!rt.routed && u.org < ROUT_ORG) {
      rt.routed = true
      u.entrench = 0
      ctx.log(`Décrochage : ${u.name}`, u.owner)
      retreatFromEnemy(ctx, u, units)
    } else if (rt.routed && u.org >= RALLY_ORG) {
      rt.routed = false
      u.order = { kind: 'hold' }
      u.path = []
    }
    if (u.strength < 0.05) {
      ctx.units.delete(u.id)
      ctx.runtime.delete(u.id)
      for (const a of ctx.armies.values()) a.unitIds = a.unitIds.filter((id) => id !== u.id)
      ctx.log(`Unité détruite : ${u.name}`, u.owner)
    }
  }
}

/** Fait reculer une unité de ~25 km à l'opposé de l'ennemi le plus proche, vers son territoire. */
export function retreatFromEnemy(ctx: SimContext, u: UnitState, units: UnitState[]): void {
  const e = nearestEnemy(ctx, u, units, 60)
  const side = sideIndex(ctx, u.owner)
  const found: { best: LonLat | null } = { best: null }
  let bestScore = -Infinity
  ctx.grid.cellsWithin(u.lon, u.lat, 35, (i) => {
    if (ctx.grid.owner[i] !== side || !ctx.grid.passable(i)) return
    const lon = ctx.grid.lonOf(i)
    const lat = ctx.grid.latOf(i)
    const away = e ? distanceKm(lon, lat, e.lon, e.lat) : 0
    const reach = ctx.supplyReach[side]?.[i] === 1 ? 20 : 0
    const score = away + reach - 0.3 * distanceKm(lon, lat, u.lon, u.lat)
    if (score > bestScore) {
      bestScore = score
      found.best = [lon, lat]
    }
  })
  const target: LonLat = found.best ?? [u.lon, u.lat]
  u.order = { kind: 'retreat', target }
  u.path = ctx.pathfinder.find([u.lon, u.lat], target, { side, enemyCost: 8 }) ?? [target]
}
