import { countryName, runtimeOf, sideIndex, type SimContext } from '../context'
import type { CountryId, LonLat, UnitState } from '../core/types'
import { distanceKm } from '../theater/grid'
import { isLineUnit } from '../units/catalog'
import { defenseValue } from './combat'
import { frontCells } from './armies'
import { planPath } from './movement'
import { axisBonus } from './axes'
import { isHalted } from './restraint'
import { WarIndex } from './spatial'
import { updateAiArmies, type AiArmyMemory } from './aiArmies'

const STRIKE_SIZE = 3
const STRIKE_DEPTH_KM = 50
/** Une offensive tous les ~3 jours au plus. */
const OFFENSIVE_COOLDOWN_TICKS = 72

/** Revue des armées (posture et mission) une fois par jour. */
const ARMY_REVIEW_TICKS = 24

export interface AiState {
  lastOffensiveTick: number
  /** Dernière revue des armées (posture et mission). */
  lastArmyReview: number
  /** Mémoire de l'IA pour chacune de ses armées. */
  armies: Map<number, AiArmyMemory>
}

export function newAiState(lastOffensiveTick = 0): AiState {
  return { lastOffensiveTick, lastArmyReview: -Infinity, armies: new Map() }
}

/**
 * IA adverse, appelée toutes les 12 h de jeu :
 * - toutes ses armées tiennent le front entier (géré par updateArmies) ; chaque jour, elle choisit leur
 *   posture et leur mission selon la situation (voir aiArmies.ts) ;
 * - elle contre-attaque les unités ennemies isolées sur son territoire ;
 * - quand ses troupes sont en état, elle frappe le point le plus faible du front avec ses meilleures unités,
 *   de préférence sur un axe (route, voie ferrée, ville).
 */
export function updateAi(ctx: SimContext, country: CountryId, state: AiState): void {
  const side = sideIndex(ctx, country)
  const own = [...ctx.units.values()].filter((u) => u.owner === country)
  const enemies = [...ctx.units.values()].filter((u) =>
    ctx.matrix.hostile(side, sideIndex(ctx, u.owner)),
  )
  if (enemies.length === 0) return
  let breaching = false
  if (ctx.tick - state.lastArmyReview >= ARMY_REVIEW_TICKS) {
    state.lastArmyReview = ctx.tick
    breaching = updateAiArmies(ctx, country, state.armies, new WarIndex(ctx))
  }
  // Unités du groupe de choc d'une percée : elles suivent leur mission.
  const shock = new Set<number>()
  for (const a of ctx.armies.values()) {
    if (a.owner === country && a.mission?.kind === 'breach') {
      breaching = true
      for (const id of a.mission.shockIds) shock.add(id)
    }
  }
  const available = own.filter(
    (u) =>
      isLineUnit(u.kind) &&
      !shock.has(u.id) &&
      u.order.kind !== 'attack' &&
      !runtimeOf(ctx, u.id).routed &&
      !isHalted(ctx, u),
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

  // Offensive : seulement si les troupes sont reposées, hors percée en cours et hors défense max.
  if (breaching || ctx.tick - state.lastOffensiveTick < OFFENSIVE_COOLDOWN_TICKS) return
  if (armyPostureOf(ctx, country) === 'maxDefense') return
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
    // Petit bruit pour ne pas frapper toujours au même endroit ; un axe vaut jusqu'à deux fois moins
    // de défense (front discontinu : l'offensive suit les routes).
    power = (power + ctx.rng.range(0, 0.5)) / (1 + axisBonus(ctx, c.cell) / 5)
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
  ctx.log(`Offensive (${countryName(ctx, country)}) près de ${nearestCity(ctx, lon, lat)}`, country)
}

/** Posture de la principale armée du pays (la plus nombreuse). */
function armyPostureOf(ctx: SimContext, country: CountryId): string {
  let best: { n: number; p: string } = { n: -1, p: 'balanced' }
  for (const a of ctx.armies.values()) {
    if (a.owner === country && a.unitIds.length > best.n) {
      best = { n: a.unitIds.length, p: a.posture ?? 'balanced' }
    }
  }
  return best.p
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
