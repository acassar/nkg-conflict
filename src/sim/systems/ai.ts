import { runtimeOf, sideIndex, type SimContext } from '../context'
import type { CountryId, LonLat, UnitState } from '../core/types'
import { distanceKm } from '../theater/grid'
import { isLineUnit } from '../units/catalog'
import { defenseValue } from './combat'
import { frontCells } from './armies'
import { planPath } from './movement'

const STRIKE_SIZE = 3
const STRIKE_DEPTH_KM = 50
/** Une offensive tous les ~3 jours au plus. */
const OFFENSIVE_COOLDOWN_TICKS = 72

export interface AiState {
  lastOffensiveTick: number
}

/**
 * IA adverse, appelée toutes les 12 h de jeu :
 * - toutes ses armées tiennent le front entier (géré par updateArmies) ;
 * - elle contre-attaque les unités ennemies isolées sur son territoire ;
 * - quand ses troupes sont en état, elle frappe le point le plus faible du front avec ses meilleures unités.
 */
export function updateAi(ctx: SimContext, country: CountryId, state: AiState): void {
  const side = sideIndex(ctx, country)
  const own = [...ctx.units.values()].filter((u) => u.owner === country)
  const enemies = [...ctx.units.values()].filter((u) => u.owner !== country)
  const available = own.filter(
    (u) => isLineUnit(u.kind) && u.order.kind !== 'attack' && !runtimeOf(ctx, u.id).routed,
  )

  // Contre-attaque : unité ennemie isolée (hors ravitaillement) sur notre territoire.
  for (const e of enemies) {
    const cell = ctx.grid.cellAt(e.lon, e.lat)
    if (runtimeOf(ctx, e.id).supplied || ctx.grid.owner[cell] !== side) continue
    const hunter = closest(available, e.lon, e.lat, 120)
    if (!hunter) continue
    attack(ctx, hunter, [e.lon, e.lat])
    available.splice(available.indexOf(hunter), 1)
  }

  // Offensive : seulement si les troupes sont reposées.
  if (ctx.tick - state.lastOffensiveTick < OFFENSIVE_COOLDOWN_TICKS) return
  const avgOrg = available.reduce((s, u) => s + u.org, 0) / Math.max(1, available.length)
  if (available.length < STRIKE_SIZE * 2 || avgOrg < 0.6) return

  const cells = frontCells(ctx, side, null)
  if (cells.length === 0) return
  let weakest: (typeof cells)[number] | null = null
  let weakestPower = Infinity
  for (let k = 0; k < cells.length; k += 5) {
    const c = cells[k]
    if (!c) continue
    const lon = ctx.grid.lonOf(c.cell)
    const lat = ctx.grid.latOf(c.cell)
    let power = 0
    for (const e of enemies) {
      if (distanceKm(lon, lat, e.lon, e.lat) < 30) power += defenseValue(ctx, e)
    }
    // Petit bruit pour ne pas frapper toujours au même endroit.
    power += ctx.rng.range(0, 0.5)
    if (power < weakestPower) {
      weakestPower = power
      weakest = c
    }
  }
  if (!weakest) return

  const lon = ctx.grid.lonOf(weakest.cell)
  const lat = ctx.grid.latOf(weakest.cell)
  // Direction de l'attaque : vers l'ennemi, à l'opposé de l'arrière.
  const kmPerCell = distanceKm(lon, lat, lon + ctx.grid.cell, lat)
  const steps = STRIKE_DEPTH_KM / Math.max(1, kmPerCell)
  const target: LonLat = [
    lon - weakest.back[0] * steps * ctx.grid.cell,
    lat - weakest.back[1] * steps * ctx.grid.cell,
  ]
  const strike = [...available]
    .sort((a, b) => score(b, lon, lat) - score(a, lon, lat))
    .slice(0, STRIKE_SIZE)
  for (const u of strike) attack(ctx, u, target)
  state.lastOffensiveTick = ctx.tick
  ctx.log(`Offensive ennemie signalée près de ${nearestCity(ctx, lon, lat)}`, country)
}

/** Préfère les unités puissantes, en forme et proches de l'objectif. */
function score(u: UnitState, lon: number, lat: number): number {
  const punch = u.kind === 'tank' ? 3 : u.kind === 'mech' ? 2 : 1
  return punch * u.strength * u.org - distanceKm(u.lon, u.lat, lon, lat) / 100
}

function closest(units: UnitState[], lon: number, lat: number, maxKm: number): UnitState | null {
  let best: UnitState | null = null
  let bestD = maxKm
  for (const u of units) {
    const d = distanceKm(u.lon, u.lat, lon, lat)
    if (d < bestD) {
      bestD = d
      best = u
    }
  }
  return best
}

function attack(ctx: SimContext, u: UnitState, target: LonLat): void {
  u.order = { kind: 'attack', target }
  planPath(ctx, u, target)
}

export function nearestCity(ctx: SimContext, lon: number, lat: number): string {
  let best = '?'
  let bestD = Infinity
  for (const c of ctx.cities) {
    const d = distanceKm(c.lon, c.lat, lon, lat)
    if (d < bestD) {
      bestD = d
      best = c.name
    }
  }
  return best
}
