import { runtimeOf, sideIndex, type SimContext } from '../context'
import type { AirMission, AirZone, CountryId, LonLat, UnitState } from '../core/types'
import { distanceKm } from '../theater/grid'
import { AIRFIELD_POP } from './transport'

/**
 * Aviation provisoire (phase G) : pas d'avions sur la carte, une puissance aérienne abstraite par
 * pays, tirée de ses usines militaires, répartie à parts égales entre ses zones de mission. Chaque
 * zone (cercle de AIR_ZONE_KM) porte une mission :
 * - supériorité : compte double dans la maîtrise du ciel, sans effet direct au sol ;
 * - appui au sol : feu et défense de ses unités dans la zone, selon la maîtrise du ciel ;
 * - bombardement : feu, défense et organisation des unités ennemies dans la zone ;
 * - interdiction : vitesse des unités ennemies dans la zone.
 * Maîtrise du ciel en un point = puissance amie / (amie + ennemie) des zones qui le couvrent.
 * Une zone doit rester à portée d'un aérodrome tenu (ville d'au moins AIRFIELD_POP habitants).
 * Remplacée en phase J par de vraies unités aériennes.
 */

export const AIR_ZONE_KM = 100
export const AIR_RANGE_KM = 600
export const AIR_ZONES_MAX = 4
/** Poids d'une zone de supériorité dans la maîtrise du ciel (les autres missions : 1). */
export const SUPERIORITY_WEIGHT = 2
/** Effets au sol, à maîtrise complète du ciel. */
export const AIR_SUPPORT_BONUS = 0.15
export const BOMBING_MALUS = 0.1
export const BOMBING_ORG_PER_HOUR = 0.003
export const INTERDICTION_SLOW = 0.4
/** Zones de l'IA : deux au plus, revues chaque jour. */
const AI_ZONES = 2

export const AIR_MISSIONS: AirMission[] = ['superiority', 'support', 'bombing', 'interdiction']
export const AIR_MISSION_NAMES: Record<AirMission, string> = {
  superiority: 'Supériorité aérienne',
  support: 'Appui au sol',
  bombing: 'Bombardement',
  interdiction: 'Interdiction',
}

/** Couleur de chaque mission (carte et tiroir Forces). */
export const AIR_COLORS: Record<AirMission, string> = {
  superiority: '#0ea5e9',
  support: '#22c55e',
  bombing: '#ef4444',
  interdiction: '#f59e0b',
}

/** Puissance aérienne : usines militaires (selon leur état) et usines hors carte. */
export function airPower(ctx: SimContext, country: CountryId): number {
  const eco = ctx.economies.get(country)
  if (!eco) return 0
  let p = eco.budget?.offMap.mil ?? 0
  for (const f of eco.factories) if (f.kind === 'mil') p += f.condition
  return p
}

export function airZonesOf(ctx: SimContext, country: CountryId): AirZone[] {
  return ctx.air.filter((z) => z.owner === country)
}

/** Aérodrome tenu le plus proche d'un point (distance en km), Infinity s'il n'y en a pas. */
export function airfieldKm(ctx: SimContext, country: CountryId, at: LonLat): number {
  const side = sideIndex(ctx, country)
  let best = Infinity
  for (const c of ctx.cityStates.values()) {
    if (c.owner !== side || c.def.pop < AIRFIELD_POP) continue
    best = Math.min(best, distanceKm(at[0], at[1], c.def.lon, c.def.lat))
  }
  return best
}

/** Nouvelle zone de mission ; renvoie un message d'erreur ou null. */
export function addAirZone(
  ctx: SimContext,
  country: CountryId,
  mission: AirMission,
  center: LonLat,
): string | null {
  if (airPower(ctx, country) <= 0) return "Pas d'aviation : aucune usine militaire"
  if (airZonesOf(ctx, country).length >= AIR_ZONES_MAX)
    return `${AIR_ZONES_MAX} zones au plus : retirez-en une`
  if (airfieldKm(ctx, country, center) > AIR_RANGE_KM)
    return `Hors de portée : aucun aérodrome tenu à moins de ${AIR_RANGE_KM} km`
  ctx.air.push({ id: ctx.allocId(), owner: country, mission, center: [center[0], center[1]] })
  return null
}

export function removeAirZone(ctx: SimContext, country: CountryId, id: number): void {
  ctx.air = ctx.air.filter((z) => z.owner !== country || z.id !== id)
}

/** Fin de l'aviation d'un pays (capitulation). */
export function dropAirZones(ctx: SimContext, country: CountryId): void {
  ctx.air = ctx.air.filter((z) => z.owner !== country)
}

interface AirEffects {
  fire: Map<number, number>
  defense: Map<number, number>
  speed: Map<number, number>
}

const effectsOf = new WeakMap<SimContext, AirEffects>()

/** Facteurs aériens d'une unité (1 hors de toute zone), recalculés à chaque heure par `updateAir`. */
export function airFire(ctx: SimContext, u: UnitState): number {
  return effectsOf.get(ctx)?.fire.get(u.id) ?? 1
}
export function airDefense(ctx: SimContext, u: UnitState): number {
  return effectsOf.get(ctx)?.defense.get(u.id) ?? 1
}
export function airSpeed(ctx: SimContext, u: UnitState): number {
  return effectsOf.get(ctx)?.speed.get(u.id) ?? 1
}

/**
 * Heure de jeu : maîtrise du ciel et effets au sol de chaque unité couverte par une zone ; le
 * bombardement use l'organisation. Chaque jour, les zones hors de portée d'un aérodrome tenu
 * disparaissent.
 */
export function updateAir(ctx: SimContext): void {
  const fx: AirEffects = { fire: new Map(), defense: new Map(), speed: new Map() }
  effectsOf.set(ctx, fx)
  if (ctx.air.length === 0) return
  if (ctx.tick % 24 === 0) {
    const lost = ctx.air.filter((z) => airfieldKm(ctx, z.owner, z.center) > AIR_RANGE_KM)
    for (const z of lost) ctx.log(`Zone aérienne abandonnée : plus d'aérodrome à portée`, z.owner)
    if (lost.length > 0) ctx.air = ctx.air.filter((z) => !lost.includes(z))
  }
  // Puissance de chaque zone : celle du pays, partagée entre ses zones.
  const count = new Map<CountryId, number>()
  for (const z of ctx.air) count.set(z.owner, (count.get(z.owner) ?? 0) + 1)
  const power = new Map<CountryId, number>()
  for (const [c, n] of count) power.set(c, airPower(ctx, c) / n)
  const zones = ctx.air.map((z) => ({
    z,
    side: sideIndex(ctx, z.owner),
    weight: (power.get(z.owner) ?? 0) * (z.mission === 'superiority' ? SUPERIORITY_WEIGHT : 1),
    // Boîte rapide avant la distance exacte.
    dLat: AIR_ZONE_KM / 111,
    dLon: AIR_ZONE_KM / (111 * Math.max(0.2, Math.cos((z.center[1] * Math.PI) / 180))),
  }))
  const m = ctx.matrix
  for (const u of ctx.units.values()) {
    const s = sideIndex(ctx, u.owner)
    let own = 0
    let enemy = 0
    let support = false
    let bombing = false
    let interdiction = false
    for (const a of zones) {
      const [lon, lat] = a.z.center
      if (Math.abs(u.lat - lat) > a.dLat || Math.abs(u.lon - lon) > a.dLon) continue
      if (distanceKm(u.lon, u.lat, lon, lat) > AIR_ZONE_KM) continue
      if (m.friendly(s, a.side)) {
        own += a.weight
        if (a.z.owner === u.owner && a.z.mission === 'support') support = true
      } else if (m.hostile(s, a.side)) {
        enemy += a.weight
        if (a.z.mission === 'bombing') bombing = true
        else if (a.z.mission === 'interdiction') interdiction = true
      }
    }
    if (!support && !bombing && !interdiction) continue
    const control = own + enemy > 0 ? own / (own + enemy) : 0
    const hostileControl = enemy > 0 ? 1 - control : 0
    let factor = 1
    if (support) factor *= 1 + AIR_SUPPORT_BONUS * control
    if (bombing) {
      factor *= 1 - BOMBING_MALUS * hostileControl
      u.org = Math.max(0, u.org - BOMBING_ORG_PER_HOUR * hostileControl)
    }
    if (factor !== 1) {
      fx.fire.set(u.id, factor)
      fx.defense.set(u.id, factor)
    }
    if (interdiction) fx.speed.set(u.id, 1 - INTERDICTION_SLOW * hostileControl)
  }
}

/**
 * IA aérienne (chaque jour, pays en guerre) : supériorité et appui au sol au-dessus de ses unités au
 * contact, autour de celle qui est la plus proche de leur centre. Les zones restent tant qu'une
 * unité au contact s'y trouve.
 */
export function updateAirAi(ctx: SimContext, country: CountryId): void {
  if (airPower(ctx, country) <= 0) return
  const engaged: UnitState[] = []
  for (const u of ctx.units.values()) {
    if (u.owner === country && runtimeOf(ctx, u.id).engagedWith !== null) engaged.push(u)
  }
  const mine = airZonesOf(ctx, country)
  const useful = (z: AirZone): boolean =>
    engaged.some((u) => distanceKm(u.lon, u.lat, z.center[0], z.center[1]) <= AIR_ZONE_KM)
  if (mine.length === AI_ZONES && mine.every(useful)) return
  dropAirZones(ctx, country)
  if (engaged.length === 0) return
  const lon = engaged.reduce((s, u) => s + u.lon, 0) / engaged.length
  const lat = engaged.reduce((s, u) => s + u.lat, 0) / engaged.length
  let best = engaged[0] as UnitState
  let bestKm = Infinity
  for (const u of engaged) {
    const km = distanceKm(u.lon, u.lat, lon, lat)
    if (km < bestKm) {
      best = u
      bestKm = km
    }
  }
  const at: LonLat = [best.lon, best.lat]
  addAirZone(ctx, country, 'superiority', at)
  addAirZone(ctx, country, 'support', at)
}
