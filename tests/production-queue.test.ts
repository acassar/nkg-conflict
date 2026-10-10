import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { productionQueue, warEconomyEffects } from '@/composables/productionQueue'
import type { TheaterData } from '@/sim/theater/grid'

const theater = theaterJson as unknown as TheaterData
const newGame = (): Simulation => Simulation.fromScenario(ukraine2026, theater, 3)
const ecoOf = (sim: Simulation) => {
  const eco = sim.ctx.economies.get('UKR')
  if (!eco) throw new Error('économie absente')
  return eco
}

describe('file de production', () => {
  it("change l'ordre d'un chantier dans sa propre file", () => {
    const sim = newGame()
    sim.queueConstruction('Lviv', 'depot')
    sim.queueConstruction('Kyiv', 'fort')
    sim.queueConstruction('Odessa', 'depot')
    const ids = () => ecoOf(sim).construction.map((q) => q.city)
    const odesa = ecoOf(sim).construction[2]?.id ?? -1
    sim.moveQueueItem(odesa, -1)
    expect(ids()).toEqual(['Lviv', 'Odessa', 'Kyiv'])
    sim.moveQueueItem(odesa, 'first')
    expect(ids()).toEqual(['Odessa', 'Lviv', 'Kyiv'])
    // Déjà en tête : rien ne bouge ; en fin de file, descendre ne fait rien non plus.
    sim.moveQueueItem(odesa, -1)
    const kyiv = ecoOf(sim).construction[2]?.id ?? -1
    sim.moveQueueItem(kyiv, 1)
    expect(ids()).toEqual(['Odessa', 'Lviv', 'Kyiv'])
  })

  it('une formation passée en tête occupe la caserne', () => {
    const sim = newGame()
    const eco = ecoOf(sim)
    eco.recruitment = []
    eco.production = 1e6
    for (let k = 0; k < 40; k++) sim.queueRecruit('inf', 'Kyiv', null)
    const last = eco.recruitment[eco.recruitment.length - 1]
    if (!last) throw new Error('file vide')
    sim.moveQueueItem(last.id, 'first')
    expect(eco.recruitment[0]?.id).toBe(last.id)
    sim.step(24)
    expect(last.progress).toBeGreaterThan(0)
  })

  it('montre les éléments qui avancent avant ceux qui attendent', () => {
    const eco = {
      construction: [
        { id: 1, city: 'Kyiv', kind: 'fort' as const, progress: 50, cost: 100 },
        { id: 2, city: 'Lviv', kind: 'depot' as const, progress: 0, cost: 100 },
      ],
      recruitment: [
        { id: 3, kind: 'inf' as const, city: 'Kyiv', progress: 0, cost: 100, armyId: 7 },
        { id: 4, kind: 'tank' as const, city: 'Lviv', progress: 0, cost: 100, armyId: null },
      ],
    }
    const rows = productionQueue(eco, 1, 1, (id) => (id === 7 ? '1re Armée' : null))
    expect(rows.map((r) => r.id)).toEqual([1, 3, 2, 4])
    expect(rows[0]?.status).toMatch(/^50 % · ≈ \d+ j$/)
    expect(rows[1]?.army).toBe('1re Armée')
    expect(rows[2]?.status).toBe('en attente de chantier')
    expect(rows[3]?.status).toBe('en attente de caserne')
    expect(rows.map((r) => r.tag)).toEqual(['Chantier', 'Formation', 'Chantier', 'Formation'])
  })

  it("décrit les effets de chaque cran d'économie de guerre", () => {
    expect(warEconomyEffects(0)[0]).toBe('Production et munitions : inchangée')
    expect(warEconomyEffects(1)).toContain('Construction : −30 %')
    expect(warEconomyEffects(2)[2]).toMatch(/4,5 pt\/mois/)
  })
})

describe('gestion automatique en deux parties', () => {
  it("les constructions seules ne lancent aucune formation ni n'imposent l'économie de guerre", () => {
    const sim = newGame()
    const eco = ecoOf(sim)
    eco.construction = []
    eco.recruitment = []
    sim.setWarEconomy(0)
    sim.setAutoEconomy('build', true)
    sim.step(24)
    expect(eco.construction.length).toBeGreaterThan(0)
    expect(eco.recruitment.length).toBe(0)
    expect(eco.warEconomy).toBe(0)
  })

  it('les renforts seuls lancent des formations sans chantier', () => {
    const sim = newGame()
    const eco = ecoOf(sim)
    eco.construction = []
    eco.recruitment = []
    eco.production = 1e5
    eco.manpower = 1e5
    sim.setAutoEconomy('recruit', true)
    sim.step(24)
    expect(eco.recruitment.length).toBeGreaterThan(0)
    expect(eco.construction.length).toBe(0)
  })

  it('reprend une ancienne sauvegarde (un seul booléen)', () => {
    const sim = newGame()
    const save = sim.toSave()
    const old = { ...save, autoEconomy: true }
    const loaded = Simulation.fromSave(old, ukraine2026, theater)
    expect(loaded.autoEconomy).toEqual({ build: true, recruit: true })
    sim.setAutoEconomy('recruit', true)
    const again = Simulation.fromSave(sim.toSave(), ukraine2026, theater)
    expect(again.autoEconomy).toEqual({ build: false, recruit: true })
  })
})
