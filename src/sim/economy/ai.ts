import { sideIndex, type CityRuntime, type SimContext } from '../context'
import { frontCells } from '../systems/armies'
import type { BuildingKind, CountryId, UnitKind } from '../core/types'
import { distanceKm } from '../theater/grid'
import { citiesOf, queueConstruction, queueRecruit, setWarEconomy } from './economy'
import { BUILDINGS, RECRUIT_COSTS } from './rules'
import { relation } from '../politics/politics'
import { territoryShares } from './national'

/** Composition visée des nouvelles unités de l'IA (cycle). */
const RECRUIT_CYCLE: UnitKind[] = ['inf', 'mech', 'inf', 'tank', 'art', 'inf', 'mech', 'log']
const FRONT_CITY_KM = 60
/** Relations sous lesquelles un pays se sent menacé et renforce son armée en temps de paix. */
const TENSION_RELATION = -50
/** En guerre, l'IA passe en guerre totale sous cette part de son territoire. */
const TOTAL_WAR_HOME_SHARE = 0.9
/** Réserve d'hommes (milliers) au-delà de laquelle l'IA forme de la défense territoriale quand la production manque. */
const TDF_MANPOWER = 30

/** Distance d'une ville au front (échantillon de cellules de front), Infinity sans front. */
function distanceToFront(city: CityRuntime, front: Array<[number, number]>): number {
  let best = Infinity
  for (const [lon, lat] of front) {
    const d = distanceKm(city.def.lon, city.def.lat, lon, lat)
    if (d < best) best = d
  }
  return best
}

/** Nombre d'unités par pays, compté une fois par tick (l'économie de l'IA passe sur chaque pays). */
const countsCache = new WeakMap<
  SimContext,
  { tick: number; size: number; counts: Map<CountryId, number> }
>()
function unitCounts(ctx: SimContext): Map<CountryId, number> {
  const hit = countsCache.get(ctx)
  if (hit && hit.tick === ctx.tick && hit.size === ctx.units.size) return hit.counts
  const counts = new Map<CountryId, number>()
  for (const u of ctx.units.values()) counts.set(u.owner, (counts.get(u.owner) ?? 0) + 1)
  countsCache.set(ctx, { tick: ctx.tick, size: ctx.units.size, counts })
  return counts
}

/** Effectif visé en paix : celui de la mobilisation, relevé d'un quart face à un pays hostile. */
function peaceTarget(ctx: SimContext, country: CountryId): number {
  const base = ctx.politics.countries.get(country)?.forceSize ?? 0
  let tense = false
  for (const other of ctx.countries.keys()) {
    if (other !== country && relation(ctx, country, other) <= TENSION_RELATION) {
      tense = true
      break
    }
  }
  return tense ? Math.ceil(base * 1.25) : base
}

/**
 * Économie de l'IA, une fois par jour :
 * - deux chantiers au plus : fortifications dans les villes du front, sinon usines loin du front ;
 * - autant de formations que de casernes, dans la caserne la plus proche du front ;
 *   en paix, seulement pour entretenir l'effectif visé (relevé en cas de tension) ;
 * - les nouvelles unités rejoignent l'armée qui tient tout le front.
 */
export function updateAiEconomy(ctx: SimContext, country: CountryId): void {
  const eco = ctx.economies.get(country)
  if (!eco) return
  const g = ctx.grid
  const cells = frontCells(ctx, sideIndex(ctx, country), null)
  const step = Math.max(1, Math.floor(cells.length / 200))
  const front: Array<[number, number]> = []
  for (let k = 0; k < cells.length; k += step) {
    const c = cells[k]
    if (c) front.push([g.lonOf(c.cell), g.latOf(c.cell)])
  }
  const cities = citiesOf(ctx, country).map((c) => ({ c, front: distanceToFront(c, front) }))
  if (cities.length === 0) return

  // Économie de guerre : partielle en guerre, totale quand le pays perd du terrain.
  const side = sideIndex(ctx, country)
  if (ctx.matrix.atWar[side] !== 1) setWarEconomy(ctx, country, 0)
  else {
    const home = territoryShares(ctx).home[side] ?? 1
    setWarEconomy(ctx, country, home < TOTAL_WAR_HOME_SHARE ? 2 : 1)
  }

  // Constructions.
  if (eco.construction.length < 2) {
    const frontCity = cities
      .filter((x) => x.front < FRONT_CITY_KM && x.c.buildings.fort < BUILDINGS.fort.maxPerCity)
      .sort((a, b) => b.c.def.pop - a.c.def.pop)[0]
    const already = (kind: BuildingKind, city: string): boolean =>
      eco.construction.some((q) => q.kind === kind && q.city === city)
    if (frontCity && !already('fort', frontCity.c.def.name)) {
      queueConstruction(ctx, country, frontCity.c.def.name, 'fort')
    } else {
      const rear = [...cities].sort((a, b) => b.front - a.front)[0]
      if (rear) {
        const kind: BuildingKind = rear.c.buildings.mil <= rear.c.buildings.civ ? 'mil' : 'civ'
        if (!already(kind, rear.c.def.name)) queueConstruction(ctx, country, rear.c.def.name, kind)
      }
    }
  }

  // Formations.
  // Les trois villes de caserne les plus proches du front (pas de recrues en Sibérie pour l'Ukraine).
  const barracks = cities
    .filter((x) => x.c.buildings.barracks > 0)
    .sort((a, b) => a.front - b.front)
    .slice(0, 3)
  const slots = barracks.reduce((n, x) => n + x.c.buildings.barracks, 0)
  const army = [...ctx.armies.values()].find((a) => a.owner === country && a.wholeFront)
  // En paix, on n'entretient que l'effectif de mobilisation.
  const atWar = ctx.matrix.atWar[side] === 1
  if (!atWar) {
    // La tension (parcours de tous les pays) n'est évaluée que si l'effectif est entre les deux cibles.
    const have = (unitCounts(ctx).get(country) ?? 0) + eco.recruitment.length
    const base = ctx.politics.countries.get(country)?.forceSize ?? 0
    if (have >= Math.ceil(base * 1.25)) return
    if (have >= base && have >= peaceTarget(ctx, country)) return
  }
  // Position dans le cycle : unités déjà commandées depuis le début de la partie.
  const ordered = (): number =>
    Object.values(eco.unitCounters).reduce((n, v) => n + v, 0) + eco.recruitment.length
  let guard = 0
  while (eco.recruitment.length < slots && guard++ < 10) {
    let kind = RECRUIT_CYCLE[ordered() % RECRUIT_CYCLE.length]
    // Hommes en surplus et production à court : défense territoriale.
    if (kind && eco.manpower > TDF_MANPOWER && eco.production < RECRUIT_COSTS[kind].production) {
      kind = 'tdf'
    }
    if (!kind || eco.manpower < RECRUIT_COSTS[kind].manpower) break
    // Les casernes les plus proches du front d'abord, à tour de rôle.
    const city = barracks[eco.recruitment.length % Math.max(1, barracks.length)]
    if (!city) break
    if (queueRecruit(ctx, country, kind, city.c.def.name, army?.id ?? null) !== null) break
  }
}
