import { countryName, sideIndex, type CityRuntime, type SimContext } from '../context'
import type { CountryId, LonLat, SeaTransit, UnitState } from '../core/types'
import { distanceKm, Terrain } from '../theater/grid'
import { WarIndex } from './spatial'

/**
 * Marine provisoire (phase G) : pas de navires, une capacité de transport abstraite par port.
 * Une unité proche d'un port tenu embarque, quitte la carte le temps de la traversée, puis débarque
 * sur une côte : désorganisée, sans retranchement et affaiblie pendant quelques heures, avec des
 * pertes si l'ennemi tient la plage. Elle n'est ravitaillée qu'une fois reliée à son territoire, ou
 * par un port pris (voir `seaSupplySources`). Remplacée en phase J par de vraies unités navales.
 */

/** Rayon autour d'une ville où l'on cherche la mer, et part d'eau qui en fait un port. */
const PORT_SEA_KM = 40
const PORT_WATER_SHARE = 0.03
/** Brigades qu'un port peut avoir en mer à la fois : 1, plus 1 par million d'habitants, 4 au plus. */
export const PORT_BASE_CAPACITY = 1
export const PORT_CAPACITY_MAX = 4
/** Distance maximale entre l'unité et le port d'embarquement. */
export const EMBARK_KM = 40
/** Embarquement, puis traversée (vitesse moyenne d'un convoi, détours compris). */
export const EMBARK_HOURS = 12
export const SEA_KM_PER_HOUR = 20
/** Portée maximale d'un débarquement depuis le port d'embarquement. */
export const MAX_LANDING_KM = 2500
/** Une côte : de l'eau à moins de cette distance de la cellule visée. */
const COAST_KM = 15
/** Au débarquement : organisation gardée, durée et effet du malus. */
export const LANDING_ORG = 0.5
export const LANDING_HOURS = 24
export const LANDING_FACTOR = 0.7
/** Plage tenue : pertes au débarquement si un ennemi est à moins de cette distance. */
export const OPPOSED_KM = 15
export const OPPOSED_LOSS = 0.1

/** Capacité d'un port selon sa population. */
export function portCapacity(pop: number): number {
  return Math.min(PORT_CAPACITY_MAX, PORT_BASE_CAPACITY + Math.floor(pop / 1_000_000))
}

const portsCache = new WeakMap<SimContext, Set<string>>()

/** Villes portuaires de la carte (calculées une fois : la mer ne bouge pas). */
export function portNames(ctx: SimContext): Set<string> {
  let ports = portsCache.get(ctx)
  if (ports) return ports
  ports = new Set()
  const g = ctx.grid
  for (const c of ctx.cities) {
    let water = 0
    let all = 0
    g.cellsWithin(c.lon, c.lat, PORT_SEA_KM, (i) => {
      all++
      if (g.terrain[i] === Terrain.WATER) water++
    })
    if (all > 0 && water / all >= PORT_WATER_SHARE) ports.add(c.name)
  }
  portsCache.set(ctx, ports)
  return ports
}

/** Ports tenus par un pays (nationaux ou pris). */
export function heldPorts(ctx: SimContext, country: CountryId): CityRuntime[] {
  const side = sideIndex(ctx, country)
  const names = portNames(ctx)
  const out: CityRuntime[] = []
  for (const name of names) {
    const c = ctx.cityStates.get(name)
    if (c && c.owner === side) out.push(c)
  }
  return out
}

/** Capacité de transport naval d'un pays : brigades en mer à la fois. */
export function navalCapacity(ctx: SimContext, country: CountryId): number {
  return heldPorts(ctx, country).reduce((n, c) => n + portCapacity(c.def.pop), 0)
}

/** Unités d'un pays en mer : débarquements et transports par mer (ils partagent la capacité navale). */
export function atSea(ctx: SimContext, country: CountryId): SeaTransit[] {
  return ctx.sea.filter((t) => t.unit.owner === country && (!t.mode || t.mode === 'sea'))
}

/** Débarquements en cours d'un pays (sans les transports stratégiques). */
export function landings(ctx: SimContext, country: CountryId): SeaTransit[] {
  return ctx.sea.filter((t) => t.unit.owner === country && !t.mode)
}

/** Port tenu le plus proche d'un point, dans la limite d'embarquement. */
function embarkPort(ctx: SimContext, country: CountryId, u: UnitState): CityRuntime | null {
  let best: CityRuntime | null = null
  let bestKm = EMBARK_KM
  for (const c of heldPorts(ctx, country)) {
    const km = distanceKm(u.lon, u.lat, c.def.lon, c.def.lat)
    if (km <= bestKm) {
      best = c
      bestKm = km
    }
  }
  return best
}

/** Cellule de terre côtière : de l'eau à proximité. */
export function isCoast(ctx: SimContext, lon: number, lat: number): boolean {
  const g = ctx.grid
  const i = g.cellAt(lon, lat)
  if (i < 0 || !g.passable(i)) return false
  let water = false
  g.cellsWithin(lon, lat, COAST_KM, (k) => {
    if (g.terrain[k] === Terrain.WATER) water = true
  })
  return water
}

/** Durée de la traversée (heures) entre un port et un point de débarquement. */
export function crossingHours(from: LonLat, to: LonLat): number {
  return EMBARK_HOURS + Math.ceil(distanceKm(from[0], from[1], to[0], to[1]) / SEA_KM_PER_HOUR)
}

/**
 * Débarquement : chaque unité embarque au port tenu le plus proche (à moins de EMBARK_KM), dans la
 * limite de la capacité navale du pays, et quitte la carte jusqu'à son arrivée. La côte visée doit
 * être à soi, à un ennemi, à un allié ou à un pays qui accorde le passage. Renvoie un message
 * (erreur, ou embarquement partiel) ou null.
 */
export function landUnits(
  ctx: SimContext,
  country: CountryId,
  units: UnitState[],
  target: LonLat,
): string | null {
  const g = ctx.grid
  const side = sideIndex(ctx, country)
  const cell = g.cellAt(target[0], target[1])
  if (!isCoast(ctx, target[0], target[1])) return 'Choisissez une côte (terre au bord de la mer)'
  const owner = g.owner[cell] ?? 0
  if (!ctx.matrix.canEnter(side, owner)) {
    return `Débarquement impossible : ${countryName(ctx, ctx.sides[owner] ?? null)} ne vous ouvre pas son territoire`
  }
  if (units.length === 0) return 'Aucune unité choisie'
  let free = navalCapacity(ctx, country) - atSea(ctx, country).length
  if (free <= 0) return 'Capacité navale épuisée : toutes vos places sont en mer'
  let sent = 0
  let farFromPort = 0
  let tooFar = 0
  for (const u of units) {
    if (free <= 0) break
    const port = embarkPort(ctx, country, u)
    if (!port) {
      farFromPort++
      continue
    }
    const from: LonLat = [port.def.lon, port.def.lat]
    if (distanceKm(from[0], from[1], target[0], target[1]) > MAX_LANDING_KM) {
      tooFar++
      continue
    }
    embark(ctx, u, port.def.name, target, ctx.tick + crossingHours(from, target))
    free--
    sent++
  }
  if (sent === 0) {
    if (tooFar > 0) return `Côte trop lointaine (plus de ${MAX_LANDING_KM} km du port)`
    return `Aucune unité à moins de ${EMBARK_KM} km d'un de vos ports`
  }
  ctx.log(`${sent} brigade(s) embarquent pour un débarquement`, country)
  const left = units.length - sent
  return left > 0 ? `${sent} brigade(s) embarquent ; ${left} restent à quai` : null
}

function embark(ctx: SimContext, u: UnitState, port: string, to: LonLat, arriveTick: number): void {
  leaveMap(ctx, u)
  ctx.sea.push({ unit: u, port, to: [to[0], to[1]], departTick: ctx.tick, arriveTick })
}

/** L'unité quitte la carte, son armée et sa division le temps d'un trajet (mer, rail ou air). */
export function leaveMap(ctx: SimContext, u: UnitState): void {
  ctx.units.delete(u.id)
  ctx.runtime.delete(u.id)
  for (const a of ctx.armies.values()) {
    if (a.unitIds.includes(u.id)) a.unitIds = a.unitIds.filter((id) => id !== u.id)
  }
  u.armyId = null
  delete u.divisionId
  delete u.direct
  delete u.relief
  u.order = { kind: 'hold' }
  u.path = []
  u.entrench = 0
}

/**
 * Arrivées du tick : l'unité débarque sur la côte visée, désorganisée et affaiblie quelques heures,
 * avec des pertes si un ennemi tient la plage. Si la côte n'est plus accessible (paix, territoire
 * fermé), elle rentre à son port d'embarquement, ou à défaut est perdue s'il a été pris.
 */
export function updateNaval(ctx: SimContext): void {
  if (ctx.sea.length === 0) return
  const due = ctx.sea.filter((t) => !t.mode && t.arriveTick <= ctx.tick)
  if (due.length === 0) return
  ctx.sea = ctx.sea.filter((t) => t.mode || t.arriveTick > ctx.tick)
  const index = new WarIndex(ctx)
  for (const t of due) {
    const u = t.unit
    const side = sideIndex(ctx, u.owner)
    const cell = ctx.grid.cellAt(t.to[0], t.to[1])
    const owner = ctx.grid.owner[cell] ?? 0
    let at: LonLat = t.to
    let landing = true
    if (!ctx.matrix.canEnter(side, owner)) {
      const port = ctx.cityStates.get(t.port)
      if (!port || port.owner !== side) {
        ctx.log(`${u.name} perdue en mer : port de départ perdu, côte fermée`, u.owner)
        continue
      }
      at = [port.def.lon, port.def.lat]
      landing = false
      ctx.log(`${u.name} rentre au port de ${t.port} : côte fermée`, u.owner)
    }
    u.lon = at[0]
    u.lat = at[1]
    u.order = { kind: 'hold' }
    u.path = []
    u.entrench = 0
    if (landing) {
      u.org = Math.min(u.org, LANDING_ORG)
      u.landedAt = ctx.tick
      if (index.nearestEnemy(u, OPPOSED_KM)) {
        u.strength *= 1 - OPPOSED_LOSS
        if (u.equipment !== undefined) u.equipment *= 1 - OPPOSED_LOSS
        ctx.log(`${u.name} débarque sous le feu près de ${nearestPlace(ctx, at)}`, u.owner)
      } else {
        ctx.log(`${u.name} débarque près de ${nearestPlace(ctx, at)}`, u.owner)
      }
    }
    ctx.units.set(u.id, u)
  }
}

export function nearestPlace(ctx: SimContext, at: LonLat): string {
  let best = ''
  let bestKm = Infinity
  for (const c of ctx.cities) {
    const km = distanceKm(at[0], at[1], c.lon, c.lat)
    if (km < bestKm) {
      best = c.name
      bestKm = km
    }
  }
  return best || 'la côte'
}

/** Malus de débarquement (attaque et défense) pendant LANDING_HOURS après l'arrivée. */
export function landingFactor(ctx: SimContext, u: UnitState): number {
  return u.landedAt !== undefined && ctx.tick - u.landedAt < LANDING_HOURS ? LANDING_FACTOR : 1
}

/**
 * Ports pris qui ravitaillent par la mer : un pays qui tient au moins un port national ravitaille
 * ses têtes de pont depuis chaque port étranger qu'il tient.
 */
export function seaSupplySources(ctx: SimContext, country: CountryId): LonLat[] {
  const held = heldPorts(ctx, country)
  if (!held.some((c) => c.def.country === country)) return []
  return held.filter((c) => c.def.country !== country).map((c): LonLat => [c.def.lon, c.def.lat])
}

/** Fin des trajets d'un pays (capitulation, fin de partie) : les unités en mer ou en route sont perdues. */
export function dropSeaTransits(ctx: SimContext, country: CountryId): void {
  ctx.sea = ctx.sea.filter((t) => t.unit.owner !== country)
}
