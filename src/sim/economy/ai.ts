import type { CityRuntime, SimContext } from '../context'
import type { BuildingKind, CountryId, UnitKind } from '../core/types'
import { distanceKm } from '../theater/grid'
import { citiesOf, queueConstruction, queueRecruit } from './economy'
import { BUILDINGS, RECRUIT_COSTS } from './rules'

/** Composition visée des nouvelles unités de l'IA (cycle). */
const RECRUIT_CYCLE: UnitKind[] = ['inf', 'mech', 'inf', 'tank', 'art', 'inf', 'mech', 'log']
const FRONT_CITY_KM = 60

/** Distance d'une ville à la cellule ennemie la plus proche (échantillonnage grossier de la grille). */
function distanceToFront(ctx: SimContext, city: CityRuntime): number {
  const { grid } = ctx
  let best = Infinity
  const step = 4
  for (let y = 0; y < grid.height; y += step) {
    for (let x = 0; x < grid.width; x += step) {
      const i = grid.index(x, y)
      const o = grid.owner[i] ?? 0
      if (o === 0 || o === city.owner || !grid.passable(i)) continue
      const d = distanceKm(city.def.lon, city.def.lat, grid.lonOf(i), grid.latOf(i))
      if (d < best) best = d
    }
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
  const cities = citiesOf(ctx, country).map((c) => ({ c, front: distanceToFront(ctx, c) }))
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
  const barracks = cities
    .filter((x) => x.c.buildings.barracks > 0)
    .sort((a, b) => a.front - b.front)
  const slots = barracks.reduce((n, x) => n + x.c.buildings.barracks, 0)
  const army = [...ctx.armies.values()].find((a) => a.owner === country && a.wholeFront)
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
