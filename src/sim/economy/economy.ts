import { runtimeOf, sideIndex, type CityRuntime, type SimContext } from '../context'
import type {
  BuildingKind,
  CountryId,
  EconomyState,
  LonLat,
  RecruitItem,
  ScenarioDef,
  UnitKind,
  UnitState,
} from '../core/types'
import { distanceKm } from '../theater/grid'
import {
  BUILDINGS,
  CONSTRUCTION_PER_CIV,
  FORT_BONUS_PER_LEVEL,
  FORT_RADIUS_KM,
  initialBuildings,
  MANPOWER_PER_MILLION,
  MAX_PARALLEL_CONSTRUCTION,
  MUNITIONS_CAP,
  MUNITIONS_PER_MIL,
  MUNITIONS_PER_SHOT,
  NO_MUNITIONS_FACTOR,
  PRODUCTION_PER_MIL,
  RECRUIT_COSTS,
  REINFORCE_PER_DAY,
} from './rules'
import { unitName } from '../units/names'

const UNIT_KINDS: UnitKind[] = ['inf', 'mech', 'tank', 'art', 'log', 'hq']

// ---------- Initialisation ----------

/** Villes : propriétaire d'après la grille, bâtiments d'après la population. */
export function initCities(ctx: SimContext): void {
  ctx.cityStates.clear()
  for (const def of ctx.cities) {
    ctx.cityStates.set(def.name, {
      def,
      owner: ctx.grid.owner[ctx.grid.cellAt(def.lon, def.lat)] ?? 0,
      buildings: initialBuildings(def.pop, def.capital),
    })
  }
}

export function initEconomies(ctx: SimContext, scenario: ScenarioDef): void {
  ctx.economies.clear()
  for (const country of scenario.countries) {
    const start = scenario.economy[country.id]
    const counters = Object.fromEntries(UNIT_KINDS.map((k) => [k, 1])) as Record<UnitKind, number>
    for (const u of ctx.units.values()) if (u.owner === country.id) counters[u.kind]++
    ctx.economies.set(country.id, {
      country: country.id,
      production: start?.production ?? 0,
      munitions: start?.munitions ?? 0,
      manpower: start?.manpower ?? 0,
      construction: [],
      recruitment: [],
      unitCounters: counters,
      daily: {
        construction: 0,
        production: 0,
        munitions: 0,
        munitionsUsed: 0,
        manpower: 0,
        reinforcements: 0,
      },
    })
  }
}

export function citiesOf(ctx: SimContext, country: CountryId): CityRuntime[] {
  const side = sideIndex(ctx, country)
  return [...ctx.cityStates.values()].filter((c) => c.owner === side)
}

/** Sources de ravitaillement : celles du scénario, plus les dépôts des villes tenues. */
export function updateSupplySources(ctx: SimContext, scenario: ScenarioDef): void {
  for (const country of scenario.countries) {
    const sources: LonLat[] = (scenario.supplySources[country.id] ?? []).map(
      (p): LonLat => [p[0], p[1]],
    )
    for (const c of citiesOf(ctx, country.id)) {
      if (c.buildings.depot > 0) sources.push([c.def.lon, c.def.lat])
    }
    ctx.supplySources[country.id] = sources
  }
}

// ---------- Effets en combat ----------

/** Bonus de défense des fortifications d'une ville tenue par le camp de l'unité, à moins de 15 km. */
export function fortFactor(ctx: SimContext, u: UnitState): number {
  const side = sideIndex(ctx, u.owner)
  let level = 0
  for (const c of ctx.cityStates.values()) {
    if (c.owner !== side || c.buildings.fort <= level) continue
    if (distanceKm(c.def.lon, c.def.lat, u.lon, u.lat) <= FORT_RADIUS_KM) level = c.buildings.fort
  }
  return 1 + FORT_BONUS_PER_LEVEL * level
}

/** Consomme les munitions d'un tir. Renvoie le facteur de puissance de feu (réduit si le stock est vide). */
export function useMunitions(ctx: SimContext, owner: CountryId, shots = 1): number {
  const eco = ctx.economies.get(owner)
  if (!eco) return 1
  if (eco.munitions <= 0) return NO_MUNITIONS_FACTOR
  const used = Math.min(eco.munitions, MUNITIONS_PER_SHOT * shots)
  eco.munitions -= used
  eco.daily.munitionsUsed += used
  return 1
}

// ---------- Prise de ville ----------

/**
 * Une ville change de camp : le défenseur détruit ce qu'il peut avant de partir.
 * Usines réduites de moitié, fortifications et dépôt détruits, casernes conservées.
 * Les constructions et formations en cours dans la ville sont perdues.
 */
export function onCityCaptured(ctx: SimContext, city: CityRuntime, previousOwner: number): void {
  const b = city.buildings
  b.civ = Math.floor(b.civ / 2)
  b.mil = Math.floor(b.mil / 2)
  b.fort = 0
  b.depot = 0
  const loser = ctx.economies.get(ctx.sides[previousOwner] ?? '')
  if (!loser) return
  const lostBuild = loser.construction.filter((q) => q.city === city.def.name)
  const lostTrain = loser.recruitment.filter((q) => q.city === city.def.name)
  loser.construction = loser.construction.filter((q) => q.city !== city.def.name)
  loser.recruitment = loser.recruitment.filter((q) => q.city !== city.def.name)
  if (lostBuild.length + lostTrain.length > 0) {
    ctx.log(`Chantiers et formations perdus à ${city.def.name}`, loser.country)
  }
}

// ---------- Journée économique ----------

/** Revenus quotidiens d'un pays, d'après les villes qu'il tient et ses apports hors théâtre. */
export function dailyIncome(
  ctx: SimContext,
  scenario: ScenarioDef,
  country: CountryId,
): { construction: number; production: number; munitions: number; manpower: number } {
  const offMap = scenario.economy[country]
  let civ = 0
  let mil = 0
  let pop = 0
  for (const c of citiesOf(ctx, country)) {
    civ += c.buildings.civ
    mil += c.buildings.mil
    pop += c.def.pop
  }
  return {
    construction: civ * CONSTRUCTION_PER_CIV,
    production: mil * PRODUCTION_PER_MIL + (offMap?.productionPerDay ?? 0),
    munitions: mil * MUNITIONS_PER_MIL + (offMap?.munitionsPerDay ?? 0),
    manpower: (pop / 1_000_000) * MANPOWER_PER_MILLION + (offMap?.manpowerPerDay ?? 0),
  }
}

/** Affiche dès le départ les revenus attendus, avant la première journée économique. */
export function previewIncome(ctx: SimContext, scenario: ScenarioDef): void {
  for (const eco of ctx.economies.values()) {
    eco.daily = { ...eco.daily, ...dailyIncome(ctx, scenario, eco.country) }
  }
}

/** Une journée d'économie pour chaque pays : revenus, constructions, renforts, formations. */
export function updateEconomy(ctx: SimContext, scenario: ScenarioDef): void {
  for (const eco of ctx.economies.values()) {
    const { construction, production, munitions, manpower } = dailyIncome(
      ctx,
      scenario,
      eco.country,
    )
    eco.production += production
    eco.munitions = Math.min(MUNITIONS_CAP, eco.munitions + munitions)
    eco.manpower += manpower
    eco.daily = {
      construction,
      production,
      munitions,
      munitionsUsed: eco.daily.munitionsUsed,
      manpower,
      reinforcements: 0,
    }
    advanceConstruction(ctx, eco, construction)
    reinforce(ctx, eco)
    advanceRecruitment(ctx, eco)
    // Les munitions consommées sont comptées sur la journée écoulée, puis remises à zéro.
    eco.daily.munitionsUsed = 0
  }
}

function advanceConstruction(ctx: SimContext, eco: EconomyState, points: number): void {
  const side = sideIndex(ctx, eco.country)
  let left = points
  for (const item of eco.construction.slice(0, MAX_PARALLEL_CONSTRUCTION)) {
    if (left <= 0) break
    const type = BUILDINGS[item.kind]
    const step = Math.min(left, item.cost / type.minDays, item.cost - item.progress)
    item.progress += step
    left -= step
    if (item.progress < item.cost - 1e-6) continue
    const city = ctx.cityStates.get(item.city)
    eco.construction = eco.construction.filter((q) => q.id !== item.id)
    if (!city || city.owner !== side) continue
    if (city.buildings[item.kind] < type.maxPerCity) {
      city.buildings[item.kind]++
      ctx.log(`${type.name} achevée à ${item.city}`, eco.country)
    }
  }
}

/** Renforts : les unités ravitaillées hors combat récupèrent des effectifs, payés en production et main-d'œuvre. */
function reinforce(ctx: SimContext, eco: EconomyState): void {
  for (const u of ctx.units.values()) {
    if (u.owner !== eco.country || u.strength >= 1) continue
    const rt = runtimeOf(ctx, u.id)
    if (!rt.supplied || rt.engagedWith !== null || rt.routed) continue
    const want = Math.min(REINFORCE_PER_DAY, 1 - u.strength)
    const cost = RECRUIT_COSTS[u.kind]
    // Un renfort coûte la moitié de la production d'une unité neuve, et sa pleine main-d'œuvre.
    const prod = want * cost.production * 0.5
    const men = want * cost.manpower
    const share = Math.min(
      1,
      eco.production / Math.max(prod, 1e-9),
      eco.manpower / Math.max(men, 1e-9),
    )
    if (share <= 0) break
    u.strength += want * share
    eco.production -= prod * share
    eco.manpower -= men * share
    eco.daily.reinforcements += want * share
  }
}

function barracksCount(ctx: SimContext, country: CountryId): number {
  return citiesOf(ctx, country).reduce((n, c) => n + c.buildings.barracks, 0)
}

function advanceRecruitment(ctx: SimContext, eco: EconomyState): void {
  const side = sideIndex(ctx, eco.country)
  // Chaque caserne forme une unité à la fois.
  const slots = barracksCount(ctx, eco.country)
  for (const item of eco.recruitment.slice(0, slots)) {
    const cost = RECRUIT_COSTS[item.kind]
    const step = Math.min(eco.production, item.cost / cost.days, item.cost - item.progress)
    if (step <= 0) break
    item.progress += step
    eco.production -= step
    if (item.progress < item.cost - 1e-6) continue
    eco.recruitment = eco.recruitment.filter((q) => q.id !== item.id)
    const city = ctx.cityStates.get(item.city)
    if (!city || city.owner !== side) continue
    deployRecruit(ctx, eco, item, city)
  }
}

function deployRecruit(
  ctx: SimContext,
  eco: EconomyState,
  item: RecruitItem,
  city: CityRuntime,
): void {
  const number = eco.unitCounters[item.kind]++
  const army = item.armyId !== null ? ctx.armies.get(item.armyId) : undefined
  const u: UnitState = {
    id: ctx.allocId(),
    name: unitName(item.kind, number),
    owner: eco.country,
    kind: item.kind,
    lon: city.def.lon,
    lat: city.def.lat,
    strength: 1,
    org: 0.7,
    entrench: 0,
    order: { kind: 'hold' },
    path: [],
    armyId: army && army.owner === eco.country ? army.id : null,
    hoursOutOfSupply: 0,
  }
  ctx.units.set(u.id, u)
  if (u.armyId !== null) army?.unitIds.push(u.id)
  ctx.log(`Nouvelle unité à ${city.def.name} : ${u.name}`, eco.country)
}

// ---------- Commandes ----------

/** Lance une construction. Renvoie un message d'erreur, ou null si c'est fait. */
export function queueConstruction(
  ctx: SimContext,
  country: CountryId,
  cityName: string,
  kind: BuildingKind,
): string | null {
  const eco = ctx.economies.get(country)
  const city = ctx.cityStates.get(cityName)
  if (!eco || !city) return 'Ville inconnue'
  if (city.owner !== sideIndex(ctx, country)) return `${cityName} n'est pas sous votre contrôle`
  const type = BUILDINGS[kind]
  const queued = eco.construction.filter((q) => q.city === cityName && q.kind === kind).length
  if (city.buildings[kind] + queued >= type.maxPerCity) {
    return `${type.name} : maximum atteint à ${cityName}`
  }
  eco.construction.push({ id: ctx.allocId(), city: cityName, kind, progress: 0, cost: type.cost })
  return null
}

export function cancelConstruction(ctx: SimContext, country: CountryId, id: number): void {
  const eco = ctx.economies.get(country)
  if (eco) eco.construction = eco.construction.filter((q) => q.id !== id)
}

/** Lance la formation d'une unité. La main-d'œuvre est engagée tout de suite. */
export function queueRecruit(
  ctx: SimContext,
  country: CountryId,
  kind: UnitKind,
  cityName: string,
  armyId: number | null,
): string | null {
  const eco = ctx.economies.get(country)
  const city = ctx.cityStates.get(cityName)
  if (!eco || !city) return 'Ville inconnue'
  if (city.owner !== sideIndex(ctx, country)) return `${cityName} n'est pas sous votre contrôle`
  if (city.buildings.barracks <= 0) return `Pas de caserne à ${cityName}`
  const cost = RECRUIT_COSTS[kind]
  if (eco.manpower < cost.manpower) return "Pas assez de main-d'œuvre"
  eco.manpower -= cost.manpower
  eco.recruitment.push({
    id: ctx.allocId(),
    kind,
    city: cityName,
    progress: 0,
    cost: cost.production,
    armyId,
  })
  return null
}

/** Annule une formation : la main-d'œuvre est rendue, la production investie est perdue. */
export function cancelRecruit(ctx: SimContext, country: CountryId, id: number): void {
  const eco = ctx.economies.get(country)
  if (!eco) return
  const item = eco.recruitment.find((q) => q.id === id)
  if (!item) return
  eco.manpower += RECRUIT_COSTS[item.kind].manpower
  eco.recruitment = eco.recruitment.filter((q) => q.id !== id)
}
