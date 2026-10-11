import { sideIndex, type SimContext } from '../context'
import type {
  BudgetDay,
  BudgetSector,
  BudgetState,
  CountryId,
  EconomyState,
  FactoryKind,
  FactorySite,
  ScenarioDef,
} from '../core/types'
import { Terrain } from '../theater/grid'
import { RECRUIT_COSTS } from './rules'
import { OCCUPATION_YIELD, territoryShares } from './national'

/**
 * Budget national (modèle 2, phase F). Le PIB fournit chaque jour un budget, prélevé selon le niveau
 * de guerre, la stabilité et les sanctions, et réparti entre défense, construction, recherche et
 * réserve. Les usines (des sites sur la carte) plafonnent ce que l'argent achète : une journée d'usine
 * militaire donne de la production et des munitions, une journée d'usine civile des points de
 * construction. L'argent inemployé va à la réserve, qui couvre ensuite les manques.
 */

/** Part du PIB prélevée pour le budget, hors économie de guerre. */
export const BUDGET_LEVY = 0.12
/**
 * Part du budget de paix qu'absorbe l'industrie de départ tournant à plein : le prix d'une journée
 * d'usine est fixé pour chaque pays au départ (niveau des prix et des salaires du pays), et une usine
 * construite ensuite coûte autant.
 */
export const START_INDUSTRY_BUDGET_SHARE = 0.7
/** Part du budget versée à la recherche en répartition automatique. */
export const AUTO_RESEARCH_SHARE = 0.05
/** Réserve de départ, en jours de budget. */
export const TREASURY_START_DAYS = 30
/** État d'une usine prise par l'adversaire (sabotage, combats), puis réparation quotidienne. */
export const CAPTURED_CONDITION = 0.25
export const REPAIR_PER_DAY = 0.005
/** Perte d'activité par point de population active sous les drapeaux (3 % du PIB pour 1 %). */
export const MOBILIZATION_DRAG = 3
/** Part de la population en âge et en état de travailler. */
export const ACTIVE_SHARE = 0.5
/** L'activité rejoint sa cible en environ six mois. */
export const GDP_DRIFT_DAYS = 180
/** Plafond du stock de munitions : jours de production des usines militaires, avec un minimum. */
export const MUNITIONS_CAP_DAYS = 15
export const MUNITIONS_CAP_MIN = 2000

export const SECTORS: BudgetSector[] = ['defense', 'construction', 'research', 'reserve']

export const SECTOR_NAMES: Record<BudgetSector, string> = {
  defense: 'Défense',
  construction: 'Construction et infrastructures',
  research: 'Recherche',
  reserve: 'Réserve',
}

/** Prix d'une journée d'usine : l'industrie de départ absorbe une part fixe du budget de paix. */
export function factoryDayCost(startBudget: number, factories: number): number {
  return (START_INDUSTRY_BUDGET_SHARE * startBudget) / Math.max(1, factories)
}

export function newBudget(
  gdpB: number,
  gdpOnMap: number,
  offMap: Record<FactoryKind, number>,
): BudgetState {
  return {
    gdpB,
    gdpOnMap,
    gdpIndex: 1,
    // Réserve de départ fixée à la première journée, quand le budget est connu.
    treasury: -1,
    research: 0,
    offMap,
    // Fixé une fois l'industrie de départ posée (voir `priceFactories`).
    factoryDayCost: 0,
  }
}

// ---------- Sites ----------

/** Cellule de terre tenue par `side` près d'un point, sur une spirale (sinon le point lui-même). */
export function factorySpot(
  ctx: SimContext,
  side: number,
  lon: number,
  lat: number,
  index: number,
): [number, number] {
  const g = ctx.grid
  const cos = Math.max(0.2, Math.cos((lat * Math.PI) / 180))
  for (let k = index; k < index + 12; k++) {
    const r = k === 0 ? 0 : 3 + 2.2 * Math.sqrt(k)
    const a = k * 2.399963
    const x = lon + (r * Math.cos(a)) / (111 * cos)
    const y = lat + (r * Math.sin(a)) / 111
    const i = g.cellAt(x, y)
    if (i >= 0 && g.owner[i] === side && g.terrain[i] !== Terrain.WATER) return [x, y]
  }
  return [lon, lat]
}

export function addFactory(
  ctx: SimContext,
  eco: EconomyState,
  kind: FactoryKind,
  lon: number,
  lat: number,
  city?: string,
): FactorySite {
  const site: FactorySite = { id: ctx.allocId(), kind, lon, lat, condition: 1 }
  if (city) site.city = city
  eco.factories.push(site)
  return site
}

/** Répartit `count` usines entre des villes, au prorata de la population (plus forts restes). */
function spread(count: number, pops: number[]): number[] {
  const total = pops.reduce((s, p) => s + p, 0)
  if (total <= 0 || count <= 0) return pops.map(() => 0)
  const exact = pops.map((p) => (count * p) / total)
  const out = exact.map(Math.floor)
  let left = count - out.reduce((s, n) => s + n, 0)
  const order = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0])
  for (const [, i] of order) {
    if (left <= 0) break
    out[i] = (out[i] ?? 0) + 1
    left--
  }
  return out
}

/**
 * Industrie de départ posée sur la carte. Avec un nombre d'usines donné par le scénario (carte du
 * monde), elles sont réparties entre les dix plus grandes villes tenues du pays ; sinon (théâtre),
 * chaque ville reçoit les usines de sa population (`perCity`). Sans ville ni territoire, l'industrie
 * passe hors carte.
 */
export function placeInitialFactories(
  ctx: SimContext,
  eco: EconomyState,
  counts: Record<FactoryKind, number> | undefined,
  perCity: (pop: number) => Record<FactoryKind, number>,
): void {
  const side = sideIndex(ctx, eco.country)
  const cities = [...ctx.cityStates.values()]
    .filter((c) => c.owner === side && c.def.country === eco.country)
    .sort((a, b) => b.def.pop - a.def.pop)
  const kinds: FactoryKind[] = ['civ', 'mil']
  if (!counts) {
    for (const c of cities) {
      const n = perCity(c.def.pop)
      let k = 0
      for (const kind of kinds) {
        for (let j = 0; j < n[kind]; j++) {
          const [lon, lat] = factorySpot(ctx, side, c.def.lon, c.def.lat, k++)
          addFactory(ctx, eco, kind, lon, lat, c.def.name)
        }
      }
    }
    return
  }
  const hubs = cities.slice(0, 10)
  if (hubs.length === 0) {
    // Pas de ville : autour du centre du pays sur la carte, sinon hors carte.
    const at = ctx.countries.get(eco.country)?.label
    const cell = at ? ctx.grid.cellAt(at[0], at[1]) : -1
    if (!at || cell < 0 || ctx.grid.owner[cell] !== side) {
      if (eco.budget) {
        eco.budget.offMap.civ += counts.civ
        eco.budget.offMap.mil += counts.mil
      }
      return
    }
    let k = 0
    for (const kind of kinds) {
      for (let j = 0; j < counts[kind]; j++) {
        const [lon, lat] = factorySpot(ctx, side, at[0], at[1], k++)
        addFactory(ctx, eco, kind, lon, lat)
      }
    }
    return
  }
  const pops = hubs.map((c) => c.def.pop)
  const civ = spread(counts.civ, pops)
  const mil = spread(counts.mil, pops)
  hubs.forEach((c, i) => {
    let k = 0
    for (const [kind, n] of [
      ['civ', civ[i] ?? 0],
      ['mil', mil[i] ?? 0],
    ] as const) {
      for (let j = 0; j < n; j++) {
        const [lon, lat] = factorySpot(ctx, side, c.def.lon, c.def.lat, k++)
        addFactory(ctx, eco, kind, lon, lat, c.def.name)
      }
    }
  })
}

const syncedAt = new WeakMap<SimContext, number>()

/**
 * Usines dont la cellule a changé de mains : elles passent à l'occupant, endommagées ; sur une
 * cellule sans propriétaire, elles sont détruites. Les chantiers d'usine situés sur une cellule perdue
 * sont abandonnés. Au plus une fois par tick ; met aussi à jour le compte d'usines des villes.
 */
export function syncFactories(ctx: SimContext): void {
  if (syncedAt.get(ctx) === ctx.tick) return
  syncedAt.set(ctx, ctx.tick)
  const g = ctx.grid
  const moved: Array<[FactorySite, number, CountryId]> = []
  for (const eco of ctx.economies.values()) {
    const side = sideIndex(ctx, eco.country)
    if (eco.factories.length > 0) {
      const kept: FactorySite[] = []
      for (const f of eco.factories) {
        const now = g.owner[g.cellAt(f.lon, f.lat)] ?? 0
        if (now === side) kept.push(f)
        else moved.push([f, now, eco.country])
      }
      if (kept.length !== eco.factories.length) eco.factories = kept
    }
    if (eco.construction.some((q) => q.at)) {
      eco.construction = eco.construction.filter(
        (q) => !q.at || (g.owner[g.cellAt(q.at[0], q.at[1])] ?? 0) === side,
      )
    }
  }
  const lost = new Map<CountryId, number>()
  for (const [f, now, from] of moved) {
    lost.set(from, (lost.get(from) ?? 0) + 1)
    const taker = ctx.economies.get(ctx.sides[now] ?? '')
    if (!taker) continue
    f.condition = Math.min(f.condition, CAPTURED_CONDITION)
    taker.factories.push(f)
  }
  for (const [country, n] of lost) {
    ctx.log(`${n} usine(s) perdue(s) au profit de l'occupant`, country)
  }
  countCityFactories(ctx)
}

/** Usines rattachées à chaque ville et tenues par son propriétaire (affichage, plafond par ville). */
export function countCityFactories(ctx: SimContext): void {
  for (const c of ctx.cityStates.values()) {
    c.buildings.civ = 0
    c.buildings.mil = 0
  }
  for (const eco of ctx.economies.values()) {
    const side = sideIndex(ctx, eco.country)
    for (const f of eco.factories) {
      if (!f.city) continue
      const c = ctx.cityStates.get(f.city)
      if (c && c.owner === side) c.buildings[f.kind]++
    }
  }
}

/** Usines tenues, pondérées par leur état, hors carte comprises. */
export function factoryCount(eco: EconomyState): Record<FactoryKind, number> {
  const n = { civ: eco.budget?.offMap.civ ?? 0, mil: eco.budget?.offMap.mil ?? 0 }
  for (const f of eco.factories) n[f.kind] += f.condition
  return n
}

// ---------- Journée budgétaire ----------

/** Fixe le prix d'une journée d'usine d'après le budget et l'industrie de départ. */
export function priceFactories(ctx: SimContext, scenario: ScenarioDef, eco: EconomyState): void {
  if (!eco.budget) return
  const n = factoryCount(eco)
  eco.budget.factoryDayCost = factoryDayCost(
    dailyGdp(ctx, scenario, eco) * BUDGET_LEVY,
    n.civ + n.mil,
  )
}

const menCache = new WeakMap<SimContext, { tick: number; men: Map<CountryId, number> }>()

/** Part de la population active sous les drapeaux (hommes comptés une fois par tick pour tous). */
export function mobilizedShare(ctx: SimContext, eco: EconomyState, popM: number): number {
  if (popM <= 0) return 0
  let entry = menCache.get(ctx)
  if (!entry || entry.tick !== ctx.tick) {
    const men = new Map<CountryId, number>()
    for (const u of ctx.units.values()) {
      men.set(u.owner, (men.get(u.owner) ?? 0) + RECRUIT_COSTS[u.kind].manpower * u.strength)
    }
    entry = { tick: ctx.tick, men }
    menCache.set(ctx, entry)
  }
  return (entry.men.get(eco.country) ?? 0) / (popM * 1000 * ACTIVE_SHARE)
}

/** PIB du jour (M$) : territoire tenu (et une part du territoire occupé), indice d'activité. */
export function dailyGdp(ctx: SimContext, scenario: ScenarioDef, eco: EconomyState): number {
  const b = eco.budget
  if (!b) return 0
  const shares = territoryShares(ctx)
  const side = sideIndex(ctx, eco.country)
  const day = (gdpB: number): number => (gdpB * 1000) / 365
  const own = 1 - b.gdpOnMap + b.gdpOnMap * (shares.home[side] ?? 0)
  let gdp = day(b.gdpB) * own
  for (const [orig, share] of shares.occupied.get(side) ?? []) {
    const theirs = scenario.economy[ctx.sides[orig] ?? '']
    if (!theirs?.gdpB) continue
    gdp += day(theirs.gdpB) * (theirs.gdpOnMap ?? 1) * share * OCCUPATION_YIELD
  }
  return gdp * b.gdpIndex
}

export interface BudgetResult {
  /** Points du jour : production militaire, munitions, construction. */
  production: number
  munitions: number
  construction: number
  day: BudgetDay
  /** Variations de la réserve et de la recherche à appliquer. */
  treasury: number
  research: number
}

export interface BudgetInput {
  gdp: number
  /** Multiplicateurs du prélèvement et des usines (économie de guerre, stabilité, sanctions). */
  levy: number
  milRate: number
  civRate: number
  /** Points de construction que les chantiers peuvent absorber aujourd'hui. */
  constructionDemand: (points: number) => number
  mobilized: number
  pointsPerMil: { production: number; munitions: number }
  pointsPerCiv: number
}

/** Calcul d'une journée de budget (sans effet sur l'état ; voir `BudgetResult`). */
export function computeBudget(eco: EconomyState, input: BudgetInput): BudgetResult | null {
  const b = eco.budget
  if (!b) return null
  const factories = factoryCount(eco)
  const budget = input.gdp * BUDGET_LEVY * input.levy
  const milDays = factories.mil * input.milRate
  const civDays = factories.civ * input.civRate
  const defenseNeed = milDays * b.factoryDayCost
  // Construction : seulement ce que les chantiers en cours peuvent absorber.
  const civPoints = civDays * input.pointsPerCiv
  const absorb = civPoints > 0 ? Math.min(1, input.constructionDemand(civPoints) / civPoints) : 0
  const constructionNeed = civDays * b.factoryDayCost * absorb
  let allocated: Record<BudgetSector, number>
  if (b.allocation) {
    const a = b.allocation
    allocated = {
      defense: budget * a.defense,
      construction: budget * a.construction,
      research: budget * a.research,
      reserve: budget * a.reserve,
    }
  } else {
    // Répartition automatique : faire tourner les usines, un peu de recherche, le reste en réserve.
    const defense = Math.min(budget, defenseNeed)
    const construction = Math.min(budget - defense, constructionNeed)
    const research = Math.min(budget - defense - construction, budget * AUTO_RESEARCH_SHARE)
    allocated = {
      defense,
      construction,
      research,
      reserve: budget - defense - construction - research,
    }
  }
  // La réserve (le stock de la veille) couvre les manques, défense d'abord ; l'argent que les usines
  // n'emploient pas et la part « réserve » du jour la regarnissent.
  const stock = Math.max(0, b.treasury)
  let drawn = 0
  let saved = allocated.reserve
  const spend = (money: number, need: number): number => {
    if (money >= need) {
      saved += money - need
      return need
    }
    const extra = Math.min(stock - drawn, need - money)
    drawn += extra
    return money + extra
  }
  const defense = spend(allocated.defense, defenseNeed)
  const construction = spend(allocated.construction, constructionNeed)
  const milUse = defenseNeed > 0 ? defense / defenseNeed : 0
  // Part des usines civiles employée : absorbée par les chantiers et payée.
  const civUse = constructionNeed > 0 ? absorb * (construction / constructionNeed) : 0
  return {
    production: milDays * input.pointsPerMil.production * milUse,
    munitions: milDays * input.pointsPerMil.munitions * milUse,
    construction: civPoints * civUse,
    treasury: saved - drawn,
    research: allocated.research,
    day: {
      gdp: input.gdp,
      budget,
      allocated,
      spent: { defense, construction },
      factories,
      use: { mil: milUse, civ: civUse },
      civPoints,
      mobilized: input.mobilized,
    },
  }
}

/** Fin de journée : réserve, recherche, réparations, indice d'activité. */
export function applyBudget(eco: EconomyState, r: BudgetResult): void {
  const b = eco.budget
  if (!b) return
  b.treasury = Math.max(0, b.treasury) + r.treasury
  b.research += r.research
  b.last = r.day
  for (const f of eco.factories) {
    if (f.condition < 1) f.condition = Math.min(1, f.condition + REPAIR_PER_DAY)
  }
  const target = Math.max(0.5, 1 - MOBILIZATION_DRAG * r.day.mobilized)
  b.gdpIndex += (target - b.gdpIndex) / GDP_DRIFT_DAYS
}

/** Plafond du stock de munitions d'un pays, d'après ses usines militaires. */
export function munitionsCap(eco: EconomyState, munitionsPerMil: number): number {
  const mil = factoryCount(eco).mil
  return Math.max(MUNITIONS_CAP_MIN, Math.round(mil * munitionsPerMil * MUNITIONS_CAP_DAYS))
}

/** Répartition choisie (normalisée), ou retour à la répartition automatique (`null`). */
export function normalizeAllocation(
  a: Partial<Record<BudgetSector, number>> | null,
): Record<BudgetSector, number> | undefined {
  if (!a) return undefined
  const v = SECTORS.map((s) => Math.max(0, Number.isFinite(a[s]) ? (a[s] ?? 0) : 0))
  const total = v.reduce((s, x) => s + x, 0)
  if (total <= 0) return undefined
  return Object.fromEntries(SECTORS.map((s, i) => [s, (v[i] ?? 0) / total])) as Record<
    BudgetSector,
    number
  >
}
