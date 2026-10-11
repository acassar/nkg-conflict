import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { dailyIncome } from '@/sim/economy/economy'
import {
  applyBudget,
  computeBudget,
  factoryCount,
  GDP_DRIFT_DAYS,
  MOBILIZATION_DRAG,
  munitionsCap,
  newBudget,
  normalizeAllocation,
  START_INDUSTRY_BUDGET_SHARE,
} from '@/sim/economy/budget'
import { BUILDINGS, MUNITIONS_PER_MIL } from '@/sim/economy/rules'
import { parseSave, serializeSave } from '@/sim/core/save'
import { budgetView, money } from '@/composables/budget'
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
    expect(b?.gdpB).toBe(154)
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
    // Une part de défense finance une partie des usines seulement.
    sim.setBudgetAllocation({ defense: 0.3, reserve: 0.7 })
    const part = dailyIncome(sim.ctx, ukraine2026, 'UKR').production
    expect(part).toBeGreaterThan(0)
    expect(part).toBeLessThan(full.production)
    // La réserve couvre le manque tant qu'elle n'est pas vide.
    if (eco.budget) eco.budget.treasury = 1e6
    expect(dailyIncome(sim.ctx, ukraine2026, 'UKR').production).toBeCloseTo(full.production)
    sim.setBudgetAllocation(null)
    expect(eco.budget?.allocation).toBeUndefined()
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
    expect(migrated.budget?.gdpB).toBe(154)
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
    expect(view?.lines[0]?.note).toBe('usines militaires à 100 %')
    expect(view?.gdpB).toBeGreaterThan(100)
    expect(money(42.4)).toBe('42 M$')
    expect(money(1234)).toBe('1,2 Md$')
    expect(budgetView(null)).toBeNull()
  })
})
