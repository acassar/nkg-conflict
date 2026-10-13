import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { dailyIncome } from '@/sim/economy/economy'
import { canFundFactory, FACTORY_RESERVE_DAYS, updateAiEconomy } from '@/sim/economy/ai'
import {
  applyBudget,
  armyUpkeep,
  computeBudget,
  dailyGdp,
  factoryCount,
  GDP_DRIFT_DAYS,
  MOBILIZATION_DRAG,
  munitionsCap,
  newBudget,
  normalizeAllocation,
  START_INDUSTRY_BUDGET_SHARE,
  UPKEEP_SHARE,
} from '@/sim/economy/budget'
import { BUILDINGS, CONSCRIPTION_FACTOR, MUNITIONS_PER_MIL } from '@/sim/economy/rules'
import { parseSave, serializeSave } from '@/sim/core/save'
import {
  budgetForecast,
  budgetView,
  currentAllocation,
  historySeries,
  money,
  nearestOwnCity,
  rebalance,
  sparkPoints,
} from '@/composables/budget'
import type { EconomyState } from '@/sim/core/types'
import type { TheaterData } from '@/sim/theater/grid'

const theater = theaterJson as unknown as TheaterData
const newGame = (): Simulation => Simulation.fromScenario(ukraine2026, theater, 3)
const ecoOf = (sim: Simulation, c = 'UKR'): EconomyState => {
  const eco = sim.ctx.economies.get(c)
  if (!eco) throw new Error('économie absente')
  return eco
}

describe('budget national', () => {
  it('le PIB fournit un budget qui fait tourner les usines de départ, le reste en réserve', () => {
    const sim = newGame()
    const eco = ecoOf(sim)
    const b = eco.budget
    expect(b?.gdpB).toBe(212.9)
    // Usines posées autour des villes, plus l'industrie hors carte.
    expect(eco.factories.length).toBeGreaterThan(20)
    expect(eco.factories.every((f) => f.city)).toBe(true)
    expect(b?.offMap.mil).toBeGreaterThan(0)
    const treasury = b?.treasury ?? 0
    sim.step(24)
    const last = b?.last
    expect(last?.budget).toBeGreaterThan(0)
    expect(last?.use.mil).toBeCloseTo(1)
    // L'industrie de départ à plein régime coûte une part fixe du budget de paix.
    expect((last?.spent.defense ?? 0) / (last?.budget ?? 1)).toBeLessThan(
      START_INDUSTRY_BUDGET_SHARE + 0.01,
    )
    // Sans chantier, l'argent de la construction va à la réserve.
    expect(last?.allocated.construction).toBe(0)
    expect(b?.treasury).toBeGreaterThan(treasury)
    expect(b?.research).toBeGreaterThan(0)
  })

  it('sans argent pour la défense, les usines militaires s’arrêtent', () => {
    const sim = newGame()
    const eco = ecoOf(sim)
    const full = dailyIncome(sim.ctx, ukraine2026, 'UKR')
    sim.setBudgetAllocation({ reserve: 1 })
    if (eco.budget) eco.budget.treasury = 0
    expect(dailyIncome(sim.ctx, ukraine2026, 'UKR').production).toBe(0)
    // Une part de défense paie l'entretien de l'armée, puis une partie des usines seulement.
    sim.setBudgetAllocation({ defense: 0.6, reserve: 0.4 })
    const part = dailyIncome(sim.ctx, ukraine2026, 'UKR').production
    expect(part).toBeGreaterThan(0)
    expect(part).toBeLessThan(full.production)
    // La réserve couvre le manque tant qu'elle n'est pas vide.
    if (eco.budget) eco.budget.treasury = 1e6
    expect(dailyIncome(sim.ctx, ukraine2026, 'UKR').production).toBeCloseTo(full.production)
    sim.setBudgetAllocation(null)
    expect(eco.budget?.allocation).toBeUndefined()
  })

  it("l'IA ne lance une usine que si le budget peut la faire tourner", () => {
    const sim = newGame()
    sim.step(24)
    const eco = ecoOf(sim, 'RUS')
    const b = eco.budget
    if (!b?.last) throw new Error('budget absent')
    const factories = (): number =>
      eco.construction.filter((q) => q.kind === 'mil' || q.kind === 'civ').length
    // Réserve vide : fortifications seulement.
    b.treasury = 0
    eco.construction = []
    expect(canFundFactory(eco)).toBe(false)
    updateAiEconomy(sim.ctx, 'RUS', { warEconomy: false, build: true, recruit: false })
    updateAiEconomy(sim.ctx, 'RUS', { warEconomy: false, build: true, recruit: false })
    expect(factories()).toBe(0)
    // Argent qui dort, usines militaires payées : une usine militaire (pays en guerre).
    b.treasury = (FACTORY_RESERVE_DAYS + 1) * b.last.budget
    b.last.use.mil = 1
    expect(canFundFactory(eco)).toBe(true)
    eco.construction = eco.construction.slice(0, 1)
    updateAiEconomy(sim.ctx, 'RUS', { warEconomy: false, build: true, recruit: false })
    expect(eco.construction.some((q) => q.kind === 'mil')).toBe(true)
    // Usines militaires sous-payées : plus d'usine, même avec de l'argent en réserve.
    b.last.use.mil = 0.5
    expect(canFundFactory(eco)).toBe(false)
  })

  it("l'aide en argent compte dans la réserve annoncée", () => {
    const sim = newGame()
    sim.step(24)
    const eco = ecoOf(sim)
    const last = eco.budget?.last
    if (!last) throw new Error('budget absent')
    const a = currentAllocation(eco)
    if (!a) throw new Error('répartition absente')
    const before = budgetForecast(eco, a)?.reserve ?? 0
    last.aid = { in: 50, out: 10 }
    expect((budgetForecast(eco, a)?.reserve ?? 0) - before).toBeCloseTo(40)
    expect(budgetView(eco)?.aid).toEqual({ in: 50, out: 10 })
  })

  it('normalise une répartition choisie', () => {
    const a = normalizeAllocation({ defense: 2, construction: 1, research: 1 })
    expect(a?.defense).toBeCloseTo(0.5)
    expect(a?.reserve).toBe(0)
    expect(normalizeAllocation({})).toBeUndefined()
    expect(normalizeAllocation(null)).toBeUndefined()
  })

  it('la mobilisation fait baisser lentement l’activité', () => {
    const eco = {
      factories: [],
      budget: newBudget(100, 1, { civ: 1, mil: 1 }),
    } as unknown as EconomyState
    const day = computeBudget(eco, {
      gdp: 300,
      levy: 1,
      milRate: 1,
      civRate: 1,
      constructionDemand: () => 0,
      mobilized: 0.05,
      pointsPerMil: { production: 3, munitions: 4 },
      pointsPerCiv: 4,
    })
    if (!day) throw new Error('budget absent')
    for (let d = 0; d < GDP_DRIFT_DAYS; d++) applyBudget(eco, day)
    const target = 1 - MOBILIZATION_DRAG * 0.05
    // Environ 63 % du chemin vers la cible en GDP_DRIFT_DAYS jours.
    expect(eco.budget?.gdpIndex).toBeLessThan(1 - 0.55 * (1 - target))
    expect(eco.budget?.gdpIndex).toBeGreaterThan(target)
  })

  it('une usine se pose librement sur le territoire, pas ailleurs', () => {
    const sim = newGame()
    const eco = ecoOf(sim)
    // Hors des villes, entre Kyiv et Zhytomyr ; Moscou est hors du territoire.
    expect(sim.queueFactory('mil', 29.4, 50.4)).toBe(null)
    expect(sim.queueFactory('mil', 37.6, 55.75)).not.toBe(null)
    expect(eco.construction[0]?.at).toEqual([29.4, 50.4])
    const before = eco.factories.length
    // Chantier presque achevé (la partie au long cours peut finir avant ses 180 jours).
    const item = eco.construction[0]
    if (item) item.progress = item.cost - BUILDINGS.mil.cost / BUILDINGS.mil.minDays
    sim.step(24 * 2)
    const site = eco.factories.find((f) => f.lon === 29.4 && f.lat === 50.4)
    expect(site?.kind).toBe('mil')
    expect(eco.factories.length).toBe(before + 1)
  })

  it('le plafond de munitions suit l’industrie militaire', () => {
    const sim = newGame()
    const ukr = ecoOf(sim)
    const rus = ecoOf(sim, 'RUS')
    expect(factoryCount(rus).mil).toBeGreaterThan(factoryCount(ukr).mil)
    expect(munitionsCap(rus, MUNITIONS_PER_MIL)).toBeGreaterThan(
      munitionsCap(ukr, MUNITIONS_PER_MIL),
    )
    expect(ukr.munitionsCap).toBe(munitionsCap(ukr, MUNITIONS_PER_MIL))
  })

  it('budget et usines sont gardés dans la sauvegarde ; une ancienne sauvegarde les recrée', () => {
    const sim = newGame()
    sim.step(24 * 2)
    sim.setBudgetAllocation({ defense: 0.6, construction: 0.2, research: 0.1, reserve: 0.1 })
    const eco = ecoOf(sim)
    const loaded = Simulation.fromSave(parseSave(serializeSave(sim.toSave())), ukraine2026, theater)
    const back = ecoOf(loaded)
    expect(back.factories.length).toBe(eco.factories.length)
    expect(back.budget?.allocation?.defense).toBeCloseTo(0.6)
    expect(back.budget?.treasury).toBeCloseTo(eco.budget?.treasury ?? 0)
    const old = sim.toSave()
    for (const e of old.economies) {
      const o = e as Partial<typeof e>
      delete o.budget
      delete o.factories
    }
    const migrated = ecoOf(Simulation.fromSave(parseSave(serializeSave(old)), ukraine2026, theater))
    expect(migrated.budget?.gdpB).toBe(212.9)
    expect(migrated.factories.length).toBeGreaterThan(20)
  })

  it('résume le budget pour le tiroir Production', () => {
    const sim = newGame()
    sim.step(24)
    const view = budgetView(ecoOf(sim))
    expect(view?.auto).toBe(true)
    expect(view?.lines.map((l) => l.sector)).toEqual([
      'defense',
      'construction',
      'research',
      'reserve',
    ])
    const shares = view?.lines.reduce((s, l) => s + l.share, 0) ?? 0
    expect(shares).toBeCloseTo(1)
    expect(view?.lines[0]?.note).toBe(
      "entretien de l'armée payé à 100 %, usines militaires à 100 %",
    )
    expect(view?.upkeep?.need).toBeGreaterThan(0)
    expect(view?.manpower?.pool).toBeGreaterThan(1000)
    expect(view?.gdpB).toBeGreaterThan(100)
    expect(money(42.4)).toBe('42 M$')
    expect(money(1234)).toBe('1,2 Md$')
    expect(budgetView(null)).toBeNull()
  })

  it('l’armée de départ coûte la part prévue des dépenses militaires réelles ; impayée, elle se renforce moins', () => {
    const sim = newGame()
    const eco = ecoOf(sim)
    const b = eco.budget
    expect(b?.defenseShare).toBeCloseTo(0.396)
    const gdp = dailyGdp(sim.ctx, ukraine2026, eco)
    expect(armyUpkeep(sim.ctx, eco)).toBeCloseTo(gdp * 0.396 * UPKEEP_SHARE, 0)
    sim.step(24)
    expect(b?.last?.upkeep?.paid).toBe(1)
    expect(eco.upkeepPaid).toBe(1)
    // Plus d'argent pour la défense ni de réserve : entretien impayé, renforts arrêtés.
    sim.setBudgetAllocation({ reserve: 1 })
    if (b) b.treasury = 0
    const hurt = [...sim.ctx.units.values()].find((u) => u.owner === 'UKR')
    if (!hurt) throw new Error('unité absente')
    hurt.strength = 0.5
    eco.manpower = 1e4
    sim.step(24)
    expect(eco.upkeepPaid).toBe(0)
    // La réserve vide : l'argent mis de côté la veille couvrirait sinon l'entretien.
    if (b) b.treasury = 0
    hurt.strength = 0.5
    sim.step(24)
    expect(eco.upkeepPaid).toBe(0)
    expect(hurt.strength).toBe(0.5)
    // La prévision du budget le dit, une fois la réserve vide.
    if (b) b.treasury = 0
    expect(
      budgetForecast(eco, { defense: 0, construction: 0, research: 0, reserve: 1 })?.upkeepPaid,
    ).toBe(0)
  })

  it('la conscription suit la population et la mobilisation, plafonnée par la réserve mobilisable', () => {
    const sim = newGame()
    const eco = ecoOf(sim)
    // Ukraine en guerre totale : environ 1 000 recrues par jour au rythme réel, réserve de quelques
    // millions.
    const day = dailyIncome(sim.ctx, ukraine2026, 'UKR').manpower / CONSCRIPTION_FACTOR
    expect(day).toBeGreaterThan(0.5)
    expect(day).toBeLessThan(1.5)
    expect(eco.manpowerPool).toBeGreaterThan(3000)
    const pool = eco.manpowerPool ?? 0
    sim.step(24)
    expect(eco.manpowerPool).toBeCloseTo(pool - eco.daily.manpower)
    eco.manpowerPool = 0.2
    expect(dailyIncome(sim.ctx, ukraine2026, 'UKR').manpower).toBeCloseTo(0.2)
  })

  it('un curseur garde la somme à 100 % en répartissant le reste au prorata', () => {
    const a = { defense: 0.5, construction: 0.2, research: 0.1, reserve: 0.2 }
    const b = rebalance(a, 'defense', 0.8)
    expect(b.defense).toBe(0.8)
    expect(b.construction).toBeCloseTo(0.08)
    expect(b.reserve).toBeCloseTo(0.08)
    expect(Object.values(b).reduce((x, y) => x + y, 0)).toBeCloseTo(1)
    const c = rebalance({ defense: 1, construction: 0, research: 0, reserve: 0 }, 'defense', 0.4)
    expect(c.research).toBeCloseTo(0.2)
  })

  it('annonce les effets d’une répartition : usines payées, réserve qui baisse', () => {
    const sim = newGame()
    sim.step(24)
    const eco = ecoOf(sim)
    const auto = currentAllocation(eco)
    if (!auto) throw new Error('répartition absente')
    const ok = budgetForecast(eco, auto)
    expect(ok?.milUse).toBeCloseTo(1)
    expect(ok?.reserve).toBeGreaterThan(0)
    expect(ok?.reserveDays).toBeNull()
    // Défense à 10 %, le reste en recherche : la réserve comble le manque et baisse.
    const poor = budgetForecast(eco, { defense: 0.1, construction: 0, research: 0.9, reserve: 0 })
    expect(poor?.milUse).toBeLessThan(0.5)
    expect(poor?.reserve).toBeLessThan(0)
    expect(poor?.reserveDays).toBeGreaterThan(0)
    // Production attendue proche de celle du jour (sans l'aide reçue).
    expect(ok?.production).toBeCloseTo(
      (((eco.budget?.last?.need.defense ?? 0) - (eco.budget?.last?.upkeep?.need ?? 0)) /
        (eco.budget?.factoryDayCost ?? 1)) *
        3,
    )
  })

  it('garde l’évolution du PIB, de la production et de la main-d’œuvre', () => {
    const sim = newGame()
    sim.step(24 * 5)
    const series = historySeries(ecoOf(sim))
    expect(series.map((h) => h.key)).toEqual(['gdp', 'production', 'manpower'])
    expect(series[0]?.values).toHaveLength(5)
    expect(series[0]?.change).not.toBeNull()
    expect(sparkPoints([1, 2, 3], 100, 20).split(' ')).toHaveLength(3)
    expect(sparkPoints([1], 100, 20)).toBe('')
  })

  it('situe un emplacement d’usine par la ville la plus proche', () => {
    const cities = [
      { name: 'Kyiv', lon: 30.52, lat: 50.45, owner: 'UKR' },
      { name: 'Moscow', lon: 37.62, lat: 55.75, owner: 'RUS' },
    ]
    const near = nearestOwnCity(cities, 'UKR', 30.0, 50.4)
    expect(near?.name).toBe('Kyiv')
    expect(near?.km).toBeGreaterThan(30)
    expect(near?.km).toBeLessThan(45)
    expect(nearestOwnCity(cities, 'POL', 30, 50)).toBeNull()
  })
})
