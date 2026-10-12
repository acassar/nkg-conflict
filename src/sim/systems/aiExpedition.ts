import { countryName, isOffMap, sideIndex, type CityRuntime, type SimContext } from '../context'
import type { CountryId, LonLat, UnitState } from '../core/types'
import { distanceKm } from '../theater/grid'
import { isLineUnit } from '../units/catalog'
import { askPassage, askToJoin, joinAnswer, passageAnswer } from '../politics/coalition'
import { enemiesInWar, warsOf, type PoliticsHooks } from '../politics/politics'
import { frontCells } from './armies'
import { planPath } from './movement'
import { atSea, EMBARK_KM, heldPorts, isCoast, landUnits, MAX_LANDING_KM, portNames } from './naval'
import { transportUnits } from './transport'

/**
 * IA des guerres sans frontière commune (phase G, solutions provisoires). Chaque jour, une IA en guerre
 * qui n'a aucun front :
 * 1. appelle ses alliés à la guerre (jamais le joueur, qui décide seul) ;
 * 2. cherche un pays de transit voisin de l'ennemi (cobelligérant, ou pays qui lui accorde le passage,
 *    qu'elle demande au besoin) et y transporte un corps expéditionnaire, qui attaque ensuite la ville
 *    ennemie la plus proche ;
 * 3. à défaut de route terrestre, débarque sur la côte ennemie la plus proche de ses ports, après avoir
 *    amené ses brigades au port d'embarquement.
 * Dès qu'un front existe (frontière franchie, tête de pont), les armées reprennent la main. L'assaut
 * aéroporté attend la décision d'Adrien (case « à valider ») : l'IA ne s'en sert pas.
 */

/** Part des unités de ligne envoyées en expédition. */
export const EXPEDITION_SHARE = 0.5
/** Le corps expéditionnaire attaque une fois qu'il compte au moins cette part des unités envoyées. */
const READY_SHARE = 0.6
/** Rayon autour de la ville de rassemblement (unités arrivées). */
export const STAGING_KM = 150
/** Portée de l'attaque lancée depuis la ville de rassemblement ou la tête de pont. */
export const STRIKE_KM = 500
/** Recherche d'un point de côte ennemi autour d'un port visé. */
const COAST_SEARCH_KM = 40

export type ExpeditionStep =
  'front' | 'transport' | 'attaque' | 'débarquement' | 'vers le port' | 'en route' | 'aucune route'

function capitalOf(ctx: SimContext, code: CountryId): LonLat | null {
  const c = ctx.cities.find((x) => x.country === code && x.capital)
  if (c) return [c.lon, c.lat]
  return ctx.countries.get(code)?.label ?? null
}

function enemiesOf(ctx: SimContext, code: CountryId): CountryId[] {
  return [...new Set(warsOf(ctx, code).flatMap((w) => enemiesInWar(w, code)))].filter(
    (e) => !isOffMap(ctx, e),
  )
}

function citiesOf(ctx: SimContext, side: number): CityRuntime[] {
  return [...ctx.cityStates.values()].filter((c) => c.owner === side)
}

function nearest<T>(items: T[], at: LonLat, pos: (t: T) => LonLat): { item: T; km: number } | null {
  let best: { item: T; km: number } | null = null
  for (const it of items) {
    const [lon, lat] = pos(it)
    const km = distanceKm(at[0], at[1], lon, lat)
    if (!best || km < best.km) best = { item: it, km }
  }
  return best
}

const cityAt = (c: CityRuntime): LonLat => [c.def.lon, c.def.lat]

/** Unités du pays en route (mer, rail, air). */
function inTransitCount(ctx: SimContext, country: CountryId): number {
  return ctx.sea.filter((t) => t.unit.owner === country).length
}

/** Brigades arrivées d'un transport ou d'un débarquement (sans armée) : rangées dans l'armée principale. */
export function adoptOrphans(ctx: SimContext, country: CountryId): number {
  let main = null
  for (const a of ctx.armies.values()) {
    if (a.owner === country && (!main || a.unitIds.length > main.unitIds.length)) main = a
  }
  if (!main) return 0
  let n = 0
  for (const u of ctx.units.values()) {
    if (u.owner !== country || u.armyId !== null) continue
    u.armyId = main.id
    u.posture = main.posture
    main.unitIds.push(u.id)
    n++
  }
  return n
}

/** Unités de ligne disponibles pour une expédition (pas en route, pas déjà à l'attaque). */
function available(ctx: SimContext, country: CountryId): UnitState[] {
  return [...ctx.units.values()].filter(
    (u) => u.owner === country && isLineUnit(u.kind) && u.order.kind !== 'attack',
  )
}

/** Ordre d'attaque vers la ville ennemie la plus proche, pour les unités hors de leur territoire. */
function strike(ctx: SimContext, units: UnitState[], targets: CityRuntime[]): number {
  let n = 0
  for (const u of units) {
    const t = nearest(targets, [u.lon, u.lat], cityAt)
    if (!t || t.km > STRIKE_KM) continue
    u.order = { kind: 'attack', target: cityAt(t.item) }
    planPath(ctx, u, cityAt(t.item))
    n++
  }
  return n
}

/** Point de côte tenu par l'ennemi près d'une de ses villes portuaires, ou null. */
function landingPoint(ctx: SimContext, enemySide: number, city: CityRuntime): LonLat | null {
  const g = ctx.grid
  const [lon0, lat0] = cityAt(city)
  const kmLat = 111
  const kmLon = 111 * Math.max(0.2, Math.cos((lat0 * Math.PI) / 180))
  let best: LonLat | null = null
  let bestKm = Infinity
  for (let r = 0; r <= COAST_SEARCH_KM; r += 5) {
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * 2 * Math.PI
      const lon = lon0 + (r * Math.cos(ang)) / kmLon
      const lat = lat0 + (r * Math.sin(ang)) / kmLat
      const cell = g.cellAt(lon, lat)
      if (cell < 0 || g.owner[cell] !== enemySide || !g.passable(cell)) continue
      if (!isCoast(ctx, lon, lat)) continue
      if (r < bestKm) {
        best = [lon, lat]
        bestKm = r
      }
    }
    if (best) return best
  }
  return best
}

/** Alliés appelés à la guerre (le joueur exclu). Renvoie le nombre de pays qui rejoignent. */
function callAllies(
  ctx: SimContext,
  country: CountryId,
  player: CountryId,
  hooks: PoliticsHooks,
): number {
  const allies = new Set(
    ctx.politics.alliances.filter((a) => a.members.includes(country)).flatMap((a) => a.members),
  )
  allies.delete(country)
  allies.delete(player)
  let n = 0
  for (const ally of allies) {
    if (joinAnswer(ctx, ally, country).veto) continue
    if (askToJoin(ctx, country, ally, hooks).accepted) n++
  }
  return n
}

/** Pays de transit vers `enemy` : voisin de l'ennemi où le pays peut entrer, demandé au besoin. */
function gatewayTo(
  ctx: SimContext,
  country: CountryId,
  enemy: CountryId,
  player: CountryId,
  neighbors: Map<CountryId, Set<CountryId>>,
): CountryId | null {
  const side = sideIndex(ctx, country)
  const home = capitalOf(ctx, country)
  const around = [...(neighbors.get(enemy) ?? [])].filter((g) => g !== country && !isOffMap(ctx, g))
  // Le plus proche d'abord : moins de route, moins de risque d'être coupé.
  const dist = (g: CountryId): number => {
    const at = capitalOf(ctx, g)
    return home && at ? distanceKm(home[0], home[1], at[0], at[1]) : 0
  }
  around.sort((a, b) => dist(a) - dist(b))
  const open = around.find((g) => ctx.matrix.canEnter(side, sideIndex(ctx, g)))
  if (open) return open
  // Demande de passage : jamais au joueur (sa décision), une demande acceptable par jour.
  for (const g of around) {
    if (g === player) continue
    if (!passageAnswer(ctx, g, country).accepted) continue
    askPassage(ctx, country, g)
    if (ctx.matrix.canEnter(side, sideIndex(ctx, g))) return g
  }
  return null
}

/**
 * Tour quotidien de l'IA de guerre à distance pour `country`. Renvoie l'étape jouée (pour les tests et
 * le profilage) ; 'front' quand un front existe déjà.
 */
export function updateExpeditionAi(
  ctx: SimContext,
  country: CountryId,
  player: CountryId,
  hooks: PoliticsHooks,
  neighbors: Map<CountryId, Set<CountryId>>,
): ExpeditionStep {
  const side = sideIndex(ctx, country)
  adoptOrphans(ctx, country)
  if (frontCells(ctx, side, null).length > 0) return 'front'
  callAllies(ctx, country, player, hooks)

  // Ennemi visé : le plus proche (capitales).
  const home = capitalOf(ctx, country)
  const enemies = enemiesOf(ctx, country)
  if (!home || enemies.length === 0) return 'aucune route'
  const byDistance = enemies
    .map((e) => ({ e, at: capitalOf(ctx, e) }))
    .filter((x): x is { e: CountryId; at: LonLat } => !!x.at)
    .sort(
      (a, b) =>
        distanceKm(home[0], home[1], a.at[0], a.at[1]) -
        distanceKm(home[0], home[1], b.at[0], b.at[1]),
    )
  const target = byDistance[0]?.e
  if (!target) return 'aucune route'
  const enemySide = sideIndex(ctx, target)
  const enemyCities = citiesOf(ctx, enemySide)
  if (enemyCities.length === 0) return 'aucune route'

  const own = available(ctx, country)
  const wanted = Math.max(1, Math.round(own.length * EXPEDITION_SHARE))
  const busy = inTransitCount(ctx, country) > 0

  // Unités déjà hors de chez elles (pays de transit, tête de pont) : à l'attaque.
  const abroad = own.filter((u) => ctx.grid.owner[ctx.grid.cellAt(u.lon, u.lat)] !== side)

  // 1. Par la terre, à travers un pays de transit.
  const gateway = gatewayTo(ctx, country, target, player, neighbors)
  if (gateway) {
    const gCities = citiesOf(ctx, sideIndex(ctx, gateway))
    let staging: CityRuntime | null = null
    let stagingKm = Infinity
    for (const c of gCities) {
      const n = nearest(enemyCities, cityAt(c), cityAt)
      if (n && n.km < stagingKm) {
        staging = c
        stagingKm = n.km
      }
    }
    if (staging) {
      const at = cityAt(staging)
      const near = own.filter((u) => distanceKm(u.lon, u.lat, at[0], at[1]) <= STAGING_KM)
      const ready = near.length >= Math.ceil(wanted * READY_SHARE) || (!busy && near.length > 0)
      if (ready && near.length > 0) {
        const n = strike(ctx, [...new Set([...near, ...abroad])], enemyCities)
        if (n > 0) {
          ctx.log(
            `${countryName(ctx, country)} attaque ${countryName(ctx, target)} depuis ${staging.def.name}`,
            country,
          )
          return 'attaque'
        }
      }
      if (busy) return 'en route'
      const send = own
        .filter((u) => distanceKm(u.lon, u.lat, at[0], at[1]) > STAGING_KM)
        .sort(
          (a, b) => distanceKm(a.lon, a.lat, at[0], at[1]) - distanceKm(b.lon, b.lat, at[0], at[1]),
        )
        .slice(0, Math.max(0, wanted - near.length))
      if (send.length > 0) {
        transportUnits(ctx, country, send, at)
        if (inTransitCount(ctx, country) > 0) return 'transport'
      }
    }
  }

  // 2. Par la mer : du port tenu le plus proche vers la côte ennemie.
  if (abroad.length > 0 && strike(ctx, abroad, enemyCities) > 0) return 'attaque'
  if (busy) return 'en route'
  const ports = heldPorts(ctx, country)
  const names = portNames(ctx)
  const enemyPorts = enemyCities.filter((c) => names.has(c.def.name))
  let best: { from: CityRuntime; to: CityRuntime; km: number } | null = null
  for (const p of ports) {
    const n = nearest(enemyPorts, cityAt(p), cityAt)
    if (n && n.km <= MAX_LANDING_KM && (!best || n.km < best.km)) {
      best = { from: p, to: n.item, km: n.km }
    }
  }
  if (!best) return 'aucune route'
  const beach = landingPoint(ctx, enemySide, best.to)
  if (!beach) return 'aucune route'
  const port = cityAt(best.from)
  const atPort = own.filter((u) => distanceKm(u.lon, u.lat, port[0], port[1]) <= EMBARK_KM)
  if (atPort.length > 0 && atSea(ctx, country).length === 0) {
    landUnits(ctx, country, atPort, beach)
    if (atSea(ctx, country).length > 0) {
      ctx.log(
        `${countryName(ctx, country)} lance un débarquement près de ${best.to.def.name}`,
        country,
      )
      return 'débarquement'
    }
  }
  const send = own
    .filter((u) => distanceKm(u.lon, u.lat, port[0], port[1]) > EMBARK_KM)
    .sort(
      (a, b) =>
        distanceKm(a.lon, a.lat, port[0], port[1]) - distanceKm(b.lon, b.lat, port[0], port[1]),
    )
    .slice(0, Math.max(0, wanted - atPort.length))
  if (send.length > 0) {
    transportUnits(ctx, country, send, port)
    if (inTransitCount(ctx, country) > 0) return 'vers le port'
  }
  return 'aucune route'
}
