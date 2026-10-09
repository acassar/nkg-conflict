import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { onCityCaptured } from '@/sim/economy/economy'
import {
  BUILDINGS,
  CONSTRUCTION_PER_CIV,
  constructionSlots,
  MAX_PARALLEL_CONSTRUCTION,
  RECRUIT_COSTS,
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
    const slots = constructionSlots(eco.daily.construction)
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
    expect(sim.queueRecruit('inf', 'Kyiv', null)).toBe(null)
    expect(ecoOf(sim).manpower).toBeCloseTo(men - RECRUIT_COSTS.inf.manpower)
    sim.step(24 * (RECRUIT_COSTS.inf.days + 1))
    const recruit = [...sim.ctx.units.values()].find((u) => u.name === "11e brigade d'infanterie")
    expect(recruit?.owner).toBe('UKR')
    expect(recruit && Math.abs(recruit.lat - 50.45) < 0.5).toBe(true)
  })

  it('une ville prise perd la moitié de ses usines et ses fortifications', () => {
    const sim = newGame()
    const kharkiv = city(sim, 'Kharkiv')
    kharkiv.buildings.fort = 2
    const civ = kharkiv.buildings.civ
    onCityCaptured(sim.ctx, kharkiv, kharkiv.owner)
    expect(kharkiv.buildings.fort).toBe(0)
    expect(kharkiv.buildings.civ).toBe(Math.floor(civ / 2))
  })
})
