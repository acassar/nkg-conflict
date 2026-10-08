import { sideIndex, type CityRuntime, type SimContext } from '../context'
import { frontCells } from '../systems/armies'
import type { BuildingKind, CountryId, UnitKind } from '../core/types'
import { distanceKm } from '../theater/grid'
import { citiesOf, queueConstruction, queueRecruit } from './economy'
import { BUILDINGS, RECRUIT_COSTS } from './rules'

/** Composition visée des nouvelles unités de l'IA (cycle). */
const RECRUIT_CYCLE: UnitKind[] = ['inf', 'mech', 'inf', 'tank', 'art', 'inf', 'mech', 'log']
const FRONT_CITY_KM = 60

/** Distance d'une ville au front (échantillon de cellules de front), Infinity sans front. */
function distanceToFront(city: CityRuntime, front: Array<[number, number]>): number {
  let best = Infinity
  for (const [lon, lat] of front) {
    const d = distanceKm(city.def.lon, city.def.lat, lon, lat)
    if (d < best) best = d
  }
  return best
}

/**
 * Économie de l'IA, une fois par jour :
 * - deux chantiers au plus : fortifications dans les villes du front, sinon usines loin du front ;
 * - autant de formations que de casernes, dans la caserne la plus proche du front ;
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
  const atWar = ctx.matrix.atWar[sideIndex(ctx, country)] === 1
  const owned = [...ctx.units.values()].filter((u) => u.owner === country).length
  const target = ctx.politics.countries.get(country)?.forceSize ?? 0
  if (!atWar && owned + eco.recruitment.length >= target) return
  // Position dans le cycle : unités déjà commandées depuis le début de la partie.
  const ordered = (): number =>
    Object.values(eco.unitCounters).reduce((n, v) => n + v, 0) + eco.recruitment.length
  let guard = 0
  while (eco.recruitment.length < slots && guard++ < 10) {
    const kind = RECRUIT_CYCLE[ordered() % RECRUIT_CYCLE.length]
    if (!kind || eco.manpower < RECRUIT_COSTS[kind].manpower) break
    // Les casernes les plus proches du front d'abord, à tour de rôle.
    const city = barracks[eco.recruitment.length % Math.max(1, barracks.length)]
    if (!city) break
    if (queueRecruit(ctx, country, kind, city.c.def.name, army?.id ?? null) !== null) break
  }
}
