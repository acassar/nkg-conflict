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
  WarEconomyLevel,
} from '../core/types'
import { distanceKm } from '../theater/grid'
import {
  BUILDINGS,
  CONSTRUCTION_PER_CIV,
  CONSTRUCTION_SPILLOVER,
  FORT_BONUS_PER_LEVEL,
  FORT_RADIUS_KM,
  initialBuildings,
  initialNationalBuildings,
  MANPOWER_PER_MILLION,
  constructionSlots,
  MUNITIONS_CAP,
  MUNITIONS_PER_MIL,
  MUNITIONS_PER_SHOT,
  NO_MUNITIONS_FACTOR,
  PRODUCTION_PER_MIL,
  RECRUIT_COSTS,
  REINFORCE_PER_DAY,
  WAR_ECONOMY,
} from './rules'
import { unitName } from '../units/names'
import { manpowerFactor, productionFactor } from '../politics/politics'
import { OCCUPATION_MANPOWER, OCCUPATION_YIELD, territoryShares } from './national'
import { armyAnchors, expandOrder, planArmyRecruit, type RecruitOrder } from './armyRecruit'

const UNIT_KINDS: UnitKind[] = ['inf', 'mech', 'tank', 'art', 'log', 'hq', 'tdf']

// ---------- Initialisation ----------

/** Villes : propriétaire d'après la grille, bâtiments d'après la population. */
export function initCities(ctx: SimContext, scenario?: ScenarioDef): void {
  ctx.cityStates.clear()
  const national = scenario?.economyModel === 'national'
  for (const def of ctx.cities) {
    ctx.cityStates.set(def.name, {
      def,
      owner: ctx.grid.owner[ctx.grid.cellAt(def.lon, def.lat)] ?? 0,
      buildings: national
        ? initialNationalBuildings(def.pop, def.capital)
        : initialBuildings(def.pop, def.capital),
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
      warEconomy: 0,
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

/** Villes par camp, recalculées au plus une fois par tick (des centaines de pays × des centaines de villes). */
const cityIndex = new WeakMap<SimContext, { tick: number; bySide: Map<number, CityRuntime[]> }>()

export function citiesOf(ctx: SimContext, country: CountryId): CityRuntime[] {
  let entry = cityIndex.get(ctx)
  if (!entry || entry.tick !== ctx.tick) {
    const bySide = new Map<number, CityRuntime[]>()
    for (const c of ctx.cityStates.values()) {
      const list = bySide.get(c.owner)
      if (list) list.push(c)
      else bySide.set(c.owner, [c])
    }
    entry = { tick: ctx.tick, bySide }
    cityIndex.set(ctx, entry)
  }
  return entry.bySide.get(sideIndex(ctx, country)) ?? []
}

/** À appeler quand une ville change de mains en cours de tick. */
export function invalidateCityIndex(ctx: SimContext): void {
  cityIndex.delete(ctx)
}

/** Sources de ravitaillement : celles du scénario, plus les dépôts des villes tenues. */
/** Population à partir de laquelle une ville nationale sert de source de ravitaillement. */
const HUB_MIN_POP = 300_000

export function updateSupplySources(ctx: SimContext, scenario: ScenarioDef): void {
  // Une passe sur les villes : dépôts, capitale et plus grande ville tenues par chaque camp.
  const depots = new Map<number, LonLat[]>()
  const capital = new Map<number, LonLat>()
  const largest = new Map<number, { pop: number; at: LonLat }>()
  const hubs = new Map<number, LonLat[]>()
  for (const c of ctx.cityStates.values()) {
    if (!c.owner) continue
    const at: LonLat = [c.def.lon, c.def.lat]
    if (c.buildings.depot > 0) depots.set(c.owner, [...(depots.get(c.owner) ?? []), at])
    const owner = ctx.sides[c.owner]
    if (c.def.country === owner && c.def.pop >= HUB_MIN_POP) {
      hubs.set(c.owner, [...(hubs.get(c.owner) ?? []), at])
    }
    if (c.def.capital && c.def.country === owner) capital.set(c.owner, at)
    const best = largest.get(c.owner)
    if (!best || c.def.pop > best.pop) largest.set(c.owner, { pop: c.def.pop, at })
  }
  for (const country of scenario.countries) {
    const side = sideIndex(ctx, country.id)
    const explicit = scenario.supplySources[country.id]
    // Sans sources explicites : la capitale (ou à défaut la plus grande ville tenue) et les grandes
    // villes nationales, qui ravitaillent aussi les territoires séparés du reste du pays (îles, enclaves).
    const base: LonLat[] =
      explicit && explicit.length > 0
        ? explicit.map((p): LonLat => [p[0], p[1]])
        : [capital.get(side) ?? largest.get(side)?.at, ...(hubs.get(side) ?? [])].filter(
            (p): p is LonLat => !!p,
          )
    ctx.supplySources[country.id] = [...base, ...(depots.get(side) ?? [])]
  }
}

// ---------- Effets en combat ----------

/** Bonus de défense des fortifications d'une ville tenue par le camp de l'unité, à moins de 15 km. */
export function fortFactor(ctx: SimContext, u: UnitState): number {
  return fortFactorAt(ctx, sideIndex(ctx, u.owner), u.lon, u.lat)
}

/** Bonus des fortifications de son camp en un point (ville fortifiée à moins de FORT_RADIUS_KM). */
export function fortFactorAt(ctx: SimContext, side: number, lon: number, lat: number): number {
  let level = 0
  for (const c of ctx.cityStates.values()) {
    if (c.owner !== side || c.buildings.fort <= level) continue
    if (distanceKm(c.def.lon, c.def.lat, lon, lat) <= FORT_RADIUS_KM) level = c.buildings.fort
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
  invalidateCityIndex(ctx)
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

/** Revenus quotidiens d'un pays : bâtiments de ses villes, plus apports du scénario (voir `economyModel`). */
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
  // Apports hors bâtiments : fixes (modèle « villes ») ou au prorata du territoire (modèle national).
  let base = {
    production: offMap?.productionPerDay ?? 0,
    munitions: offMap?.munitionsPerDay ?? 0,
    construction: offMap?.constructionPerDay ?? 0,
    manpower: offMap?.manpowerPerDay ?? 0,
  }
  let cityManpower = (pop / 1_000_000) * MANPOWER_PER_MILLION
  if (scenario.economyModel === 'national') {
    const shares = territoryShares(ctx)
    const side = sideIndex(ctx, country)
    const own = shares.home[side] ?? 0
    base = {
      production: base.production * own,
      munitions: base.munitions * own,
      construction: base.construction * own,
      manpower: base.manpower * own,
    }
    // Territoires occupés : une partie de leur rendement revient à l'occupant.
    for (const [orig, share] of shares.occupied.get(side) ?? []) {
      const theirs = scenario.economy[ctx.sides[orig] ?? '']
      if (!theirs) continue
      base.production += theirs.productionPerDay * share * OCCUPATION_YIELD
      base.munitions += theirs.munitionsPerDay * share * OCCUPATION_YIELD
      base.construction += (theirs.constructionPerDay ?? 0) * share * OCCUPATION_YIELD
      base.manpower += theirs.manpowerPerDay * share * OCCUPATION_MANPOWER
    }
    // La population des villes est déjà comptée dans celle du pays.
    cityManpower = 0
  }
  // Stabilité et sanctions pèsent sur l'industrie, le soutien à la guerre sur la conscription.
  const industry = productionFactor(ctx, country)
  const conscription = manpowerFactor(ctx, country)
  // Économie de guerre : une part de l'industrie civile travaille pour l'armée.
  const war = WAR_ECONOMY[ctx.economies.get(country)?.warEconomy ?? 0]
  return {
    construction: (civ * CONSTRUCTION_PER_CIV + base.construction) * industry * war.construction,
    production: (mil * PRODUCTION_PER_MIL + base.production) * industry * war.production,
    munitions: (mil * MUNITIONS_PER_MIL + base.munitions) * industry * war.production,
    manpower: (cityManpower + base.manpower) * conscription,
  }
}

/** Affiche dès le départ les revenus attendus, avant la première journée économique. */
export function previewIncome(ctx: SimContext, scenario: ScenarioDef): void {
  for (const eco of ctx.economies.values()) {
    eco.daily = { ...eco.daily, ...dailyIncome(ctx, scenario, eco.country) }
  }
}

export type Income = ReturnType<typeof dailyIncome>

/**
 * Une journée d'économie pour chaque pays : revenus, constructions, renforts, formations.
 * `transfers` peut modifier les revenus de tous les pays avant leur emploi (aides étrangères).
 */
export function updateEconomy(
  ctx: SimContext,
  scenario: ScenarioDef,
  transfers?: (incomes: Map<CountryId, Income>) => void,
): void {
  const incomes = new Map<CountryId, Income>()
  for (const eco of ctx.economies.values()) {
    incomes.set(eco.country, dailyIncome(ctx, scenario, eco.country))
  }
  transfers?.(incomes)
  for (const eco of ctx.economies.values()) {
    const income = incomes.get(eco.country)
    if (!income) continue
    const { construction, production, munitions, manpower } = income
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
    eco.daily.constructionUsed = advanceConstruction(ctx, eco, construction)
    // Les points de construction inutilisés deviennent de la production : l'industrie civile
    // travaille pour l'armée quand elle ne bâtit pas.
    const spill = Math.max(0, construction - eco.daily.constructionUsed) * CONSTRUCTION_SPILLOVER
    eco.production += spill
    eco.daily.production += spill
    eco.daily.productionFromConstruction = spill
    const afterSpill = eco.production
    reinforce(ctx, eco)
    advanceRecruitment(ctx, eco)
    eco.daily.productionUsed = Math.max(0, afterSpill - eco.production)
    // Les munitions consommées sont comptées sur la journée écoulée, puis remises à zéro.
    eco.daily.munitionsSpent = eco.daily.munitionsUsed
    eco.daily.munitionsUsed = 0
  }
}

/** Fait avancer les chantiers ; renvoie les points employés. */
function advanceConstruction(ctx: SimContext, eco: EconomyState, points: number): number {
  const side = sideIndex(ctx, eco.country)
  let left = points
  for (const item of eco.construction.slice(0, constructionSlots(points))) {
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
      ctx.log(`${type.name} achevée à ${item.city}`, eco.country, true)
    }
  }
  return points - left
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
    posture: army?.owner === eco.country ? army.posture : undefined,
  }
  ctx.units.set(u.id, u)
  if (u.armyId !== null) army?.unitIds.push(u.id)
  ctx.log(`Nouvelle unité à ${city.def.name} : ${u.name}`, eco.country, true)
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

/** Règle l'économie de guerre d'un pays (0 paix, 1 mobilisation partielle, 2 guerre totale). */
export function setWarEconomy(ctx: SimContext, country: CountryId, level: WarEconomyLevel): void {
  const eco = ctx.economies.get(country)
  if (!eco || eco.warEconomy === level) return
  eco.warEconomy = level
  ctx.log(`Économie : ${WAR_ECONOMY[level].name.toLowerCase()}`, country, true)
}

export function cancelConstruction(ctx: SimContext, country: CountryId, id: number): void {
  const eco = ctx.economies.get(country)
  if (eco) eco.construction = eco.construction.filter((q) => q.id !== id)
}

/**
 * Déplace un chantier ou une formation dans sa propre file : `delta` −1 monte d'un rang, +1 descend,
 * `'first'` passe en tête. Les premiers de chaque file sont ceux qui avancent (chantiers selon les
 * points du jour, formations une par caserne). Renvoie vrai si l'ordre a changé.
 */
export function moveQueueItem(
  ctx: SimContext,
  country: CountryId,
  id: number,
  delta: -1 | 1 | 'first',
): boolean {
  const eco = ctx.economies.get(country)
  if (!eco) return false
  const move = <T extends { id: number }>(queue: T[]): T[] | null => {
    const from = queue.findIndex((q) => q.id === id)
    if (from < 0) return null
    const to = delta === 'first' ? 0 : Math.max(0, Math.min(queue.length - 1, from + delta))
    if (to === from) return queue
    const next = [...queue]
    const [item] = next.splice(from, 1)
    if (item) next.splice(to, 0, item)
    return next
  }
  const build = move(eco.construction)
  if (build) {
    const changed = build !== eco.construction
    eco.construction = build
    return changed
  }
  const train = move(eco.recruitment)
  if (!train) return false
  const changed = train !== eco.recruitment
  eco.recruitment = train
  return changed
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

/** Casernes du pays, pour la répartition d'une commande. */
export function barracksSites(ctx: SimContext, country: CountryId) {
  return citiesOf(ctx, country)
    .filter((c) => c.buildings.barracks > 0)
    .map((c) => ({
      name: c.def.name,
      lon: c.def.lon,
      lat: c.def.lat,
      barracks: c.buildings.barracks,
    }))
}

/**
 * Recrutement par armée : les formations partent dans les casernes d'où elles rejoindront l'armée
 * le plus tôt (voir `planArmyRecruit`), puis rejoignent cette armée à leur sortie.
 * Si la main-d'œuvre manque, seules les premières formations de la commande sont lancées.
 * Renvoie le nombre de formations lancées et, s'il y a lieu, un message pour l'interface.
 */
export function queueArmyRecruit(
  ctx: SimContext,
  country: CountryId,
  armyId: number,
  order: RecruitOrder,
): ArmyRecruitResult {
  const fail = (error: string): ArmyRecruitResult => ({ launched: 0, error })
  const eco = ctx.economies.get(country)
  const army = ctx.armies.get(armyId)
  if (!eco || !army || army.owner !== country) return fail('Armée inconnue')
  const kinds = expandOrder(order, UNIT_KINDS)
  if (kinds.length === 0) return fail('Aucune unité commandée')
  const sites = barracksSites(ctx, country)
  if (sites.length === 0) return fail('Aucune caserne : construisez-en une pour former des unités')
  const anchors = armyAnchors(army, (id) => {
    const u = ctx.units.get(id)
    return u ? [u.lon, u.lat] : undefined
  })
  const plan = planArmyRecruit({
    sites,
    queue: eco.recruitment,
    anchors,
    kinds,
    stock: eco.production,
    productionPerDay: eco.daily.production,
  })
  let launched = 0
  for (const item of plan.items) {
    if (queueRecruit(ctx, country, item.kind, item.city, armyId) !== null) break
    launched++
  }
  if (launched === 0) return fail("Pas assez de main-d'œuvre")
  if (launched < plan.items.length) {
    return {
      launched,
      error: `${launched} formation(s) lancée(s) sur ${plan.items.length} : main-d'œuvre insuffisante`,
    }
  }
  return { launched, error: null }
}

export interface ArmyRecruitResult {
  launched: number
  error: string | null
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
