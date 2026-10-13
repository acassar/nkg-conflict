import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { dailyIncome, onCityCaptured } from '@/sim/economy/economy'
import { CAPTURED_CONDITION, syncFactories } from '@/sim/economy/budget'
import {
  BUILDINGS,
  CONSTRUCTION_PER_CIV,
  constructionSlots,
  MAX_PARALLEL_CONSTRUCTION,
  RECRUIT_COSTS,
  WAR_ECONOMY,
} from '@/sim/economy/rules'
import type { TheaterData } from '@/sim/theater/grid'

const theater = theaterJson as unknown as TheaterData
const newGame = (): Simulation => Simulation.fromScenario(ukraine2026, theater, 3)
const ecoOf = (sim: Simulation) => {
  const eco = sim.ctx.economies.get('UKR')
  if (!eco) throw new Error('économie absente')
  return eco
}
const city = (sim: Simulation, name: string) => {
  const c = sim.ctx.cityStates.get(name)
  if (!c) throw new Error(`ville absente : ${name}`)
  return c
}

describe('économie', () => {
  it('donne des usines et une caserne aux grandes villes', () => {
    const kyiv = city(newGame(), 'Kyiv')
    expect(kyiv.buildings.civ).toBeGreaterThan(0)
    expect(kyiv.buildings.mil).toBeGreaterThan(0)
    expect(kyiv.buildings.barracks).toBeGreaterThan(0)
  })

  it('produit chaque jour', () => {
    const sim = newGame()
    const before = ecoOf(sim).production
    // Les usines civiles ne travaillent (et ne coûtent) que s'il y a un chantier.
    expect(sim.queueConstruction('Lviv', 'depot')).toBe(null)
    sim.step(24)
    expect(ecoOf(sim).production).toBeGreaterThan(before)
    expect(ecoOf(sim).daily.construction).toBeGreaterThan(0)
  })

  it('achève une construction après sa durée minimale', () => {
    const sim = newGame()
    const before = city(sim, 'Lviv').buildings.depot
    expect(sim.queueConstruction('Lviv', 'depot')).toBe(null)
    sim.step(24 * (BUILDINGS.depot.minDays - 1))
    expect(city(sim, 'Lviv').buildings.depot).toBe(before)
    sim.step(24 * 2)
    expect(city(sim, 'Lviv').buildings.depot).toBe(before + 1)
  })

  it('une usine demande plusieurs mois, quels que soient les points disponibles', () => {
    const sim = newGame()
    const before = city(sim, 'Lviv').buildings.civ
    expect(sim.queueConstruction('Lviv', 'civ')).toBe(null)
    sim.step(24 * 120)
    expect(city(sim, 'Lviv').buildings.civ).toBe(before)
    expect(BUILDINGS.civ.minDays).toBeGreaterThanOrEqual(180)
    expect(BUILDINGS.mil.minDays).toBeGreaterThanOrEqual(120)
    // Une usine civile ne rembourse pas son coût en moins d'un an.
    expect(BUILDINGS.civ.cost / CONSTRUCTION_PER_CIV).toBeGreaterThan(365)
  })

  it('le nombre de chantiers dépend des points de construction', () => {
    expect(constructionSlots(0)).toBe(1)
    expect(constructionSlots(20)).toBe(1)
    expect(constructionSlots(40)).toBe(2)
    expect(constructionSlots(1000)).toBe(MAX_PARALLEL_CONSTRUCTION)
    // Les chantiers au-delà de la capacité attendent sans avancer.
    const sim = newGame()
    const eco = ecoOf(sim)
    for (const name of ['Lviv', 'Kyiv', 'Odessa', 'Vinnytsya', 'Poltava', 'Zhytomyr']) {
      expect(sim.queueConstruction(name, 'mil')).toBe(null)
    }
    sim.step(24)
    // Chantiers ouverts selon la capacité des usines civiles.
    const slots = constructionSlots(eco.budget?.last?.civPoints ?? 0)
    const moving = eco.construction.filter((q) => q.progress > 0).length
    expect(moving).toBe(Math.min(slots, eco.construction.length))
  })

  it('refuse de construire dans une ville adverse ou au-delà du maximum', () => {
    const sim = newGame()
    expect(sim.queueConstruction('Moscow', 'fort')).not.toBe(null)
    for (let k = 0; k < BUILDINGS.fort.maxPerCity; k++) sim.queueConstruction('Lviv', 'fort')
    expect(sim.queueConstruction('Lviv', 'fort')).not.toBe(null)
  })

  it('forme une unité dans une caserne et engage la main-d’œuvre', () => {
    const sim = newGame()
    const men = ecoOf(sim).manpower
    // Numéro suivant ceux de l'ordre de bataille de départ.
    const name = `${ecoOf(sim).unitCounters.inf}e brigade d'infanterie`
    expect(sim.queueRecruit('inf', 'Kyiv', null)).toBe(null)
    expect(ecoOf(sim).manpower).toBeCloseTo(men - RECRUIT_COSTS.inf.manpower)
    sim.step(24 * (RECRUIT_COSTS.inf.days + 1))
    const recruit = [...sim.ctx.units.values()].find((u) => u.name === name)
    expect(recruit?.owner).toBe('UKR')
    expect(recruit && Math.abs(recruit.lat - 50.45) < 0.5).toBe(true)
  })

  it('une ville prise perd ses fortifications ; ses usines passent à l’occupant, endommagées', () => {
    const sim = newGame()
    const kharkiv = city(sim, 'Kharkiv')
    kharkiv.buildings.fort = 2
    onCityCaptured(sim.ctx, kharkiv, kharkiv.owner)
    expect(kharkiv.buildings.fort).toBe(0)
    // Usines de Kharkiv : leurs cellules passent à la Russie.
    const ukr = ecoOf(sim)
    const sites = ukr.factories.filter((f) => f.city === 'Kharkiv')
    expect(sites.length).toBeGreaterThan(0)
    const g = sim.ctx.grid
    const rus = sim.sideOf('RUS')
    for (const f of sites) g.setOwner(g.cellAt(f.lon, f.lat), rus)
    sim.ctx.tick++
    syncFactories(sim.ctx)
    const ids = new Set(sites.map((f) => f.id))
    expect(ukr.factories.some((f) => ids.has(f.id))).toBe(false)
    const taken = sim.ctx.economies.get('RUS')?.factories.filter((f) => ids.has(f.id)) ?? []
    expect(taken.length).toBe(sites.length)
    expect(taken.every((f) => f.condition <= CAPTURED_CONDITION + 0.01)).toBe(true)
  })
})

describe('économie de guerre', () => {
  it('la guerre totale déplace la construction vers la production et use la population', () => {
    const peace = newGame()
    const total = newGame()
    total.setWarEconomy(2)
    expect(ecoOf(total).warEconomy).toBe(2)
    // Revenus propres du pays, hors aides étrangères.
    const p = dailyIncome(peace.ctx, ukraine2026, 'UKR')
    const t = dailyIncome(total.ctx, ukraine2026, 'UKR')
    expect(t.production / p.production).toBeCloseTo(WAR_ECONOMY[2].production)
    expect(t.munitions / p.munitions).toBeCloseTo(WAR_ECONOMY[2].production)
    // Capacité des usines civiles (aucun chantier : rien n'est dépensé en construction).
    peace.step(24)
    total.step(24)
    const civ = (sim: Simulation): number => ecoOf(sim).budget?.last?.civPoints ?? 0
    expect(civ(total) / civ(peace)).toBeCloseTo(WAR_ECONOMY[2].construction)
    peace.step(24 * 9)
    total.step(24 * 9)
    const support = (sim: Simulation): number =>
      sim.ctx.politics.countries.get('UKR')?.warSupport ?? 0
    expect(support(total)).toBeLessThan(support(peace))
  })

  it('forme une brigade de défense territoriale, peu coûteuse en matériel', () => {
    expect(RECRUIT_COSTS.tdf.production).toBeLessThan(RECRUIT_COSTS.inf.production / 2)
    expect(RECRUIT_COSTS.tdf.manpower).toBeGreaterThan(RECRUIT_COSTS.inf.manpower)
    const sim = newGame()
    const name = `${ecoOf(sim).unitCounters.tdf}e brigade de défense territoriale`
    expect(sim.queueRecruit('tdf', 'Kyiv', null)).toBe(null)
    sim.step(24 * (RECRUIT_COSTS.tdf.days + 1))
    const tdf = [...sim.ctx.units.values()].find((u) => u.name === name)
    expect(tdf?.kind).toBe('tdf')
    expect(tdf?.owner).toBe('UKR')
  })
})
