import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { planArmyRecruit } from '@/sim/economy/armyRecruit'
import { RECRUIT_COSTS } from '@/sim/economy/rules'
import type { TheaterData } from '@/sim/theater/grid'

const theater = theaterJson as unknown as TheaterData
const newGame = (): Simulation => Simulation.fromScenario(ukraine2026, theater, 3)
const ecoOf = (sim: Simulation) => {
  const eco = sim.ctx.economies.get('UKR')
  if (!eco) throw new Error('économie absente')
  return eco
}
const mainArmy = (sim: Simulation) => {
  const army = [...sim.ctx.armies.values()]
    .filter((a) => a.owner === 'UKR')
    .sort((a, b) => b.unitIds.length - a.unitIds.length)[0]
  if (!army) throw new Error('armée absente')
  return army
}

describe('recrutement par armée (répartition)', () => {
  const sites = [
    { name: 'Près', lon: 36, lat: 49, barracks: 1 },
    { name: 'Moyen', lon: 33, lat: 49, barracks: 2 },
    { name: 'Loin', lon: 24, lat: 49.8, barracks: 1 },
  ]
  const anchors: [number, number][] = [[37, 49]]
  const plan = (kinds: (keyof typeof RECRUIT_COSTS)[], queue = [] as never[]) =>
    planArmyRecruit({ sites, queue, anchors, kinds, stock: 1e6, productionPerDay: 1000 })

  it('prend d’abord la caserne libre la plus proche du front', () => {
    const p = plan(['inf'])
    expect(p.items).toEqual([{ kind: 'inf', city: 'Près' }])
    expect(p.production).toBe(RECRUIT_COSTS.inf.production)
    expect(p.days).toBe(RECRUIT_COSTS.inf.days)
  })

  it('se répartit quand une caserne ne suffit pas, puis met en file', () => {
    const p = plan(['inf', 'inf', 'inf', 'inf', 'inf', 'inf'])
    const count = (city: string) => p.items.filter((i) => i.city === city).length
    expect(count('Près')).toBeGreaterThanOrEqual(1)
    expect(count('Moyen')).toBeGreaterThanOrEqual(2)
    // Six formations pour quatre casernes : au moins deux attendent.
    expect(p.cities.reduce((n, c) => n + c.waiting, 0)).toBeGreaterThanOrEqual(2)
    expect(p.barracksDays).toBeGreaterThan(RECRUIT_COSTS.inf.days)
  })

  it('tient compte des formations déjà en file', () => {
    const queue = [{ kind: 'tank', city: 'Près', progress: 0, cost: 900 }] as never[]
    const p = plan(['inf'], queue)
    expect(p.items[0]?.city).toBe('Moyen')
  })

  it('un délai de production apparaît quand le stock manque', () => {
    const p = planArmyRecruit({
      sites,
      queue: [],
      anchors,
      kinds: ['tank', 'tank'],
      stock: 0,
      productionPerDay: 60,
    })
    expect(p.productionDays).toBe(Math.ceil((2 * RECRUIT_COSTS.tank.production) / 60))
    expect(p.days).toBe(p.productionDays)
    expect(p.affordable).toBe(0)
    expect(p.shortfall).toBe(2 * RECRUIT_COSTS.tank.production)
  })

  it('part couverte par le stock et arrivée au front après le trajet', () => {
    const cost = RECRUIT_COSTS.inf.production
    const p = planArmyRecruit({
      sites,
      queue: [],
      anchors,
      kinds: ['inf', 'inf', 'inf'],
      stock: 2 * cost,
      productionPerDay: cost,
    })
    expect(p.affordable).toBe(2)
    expect(p.shortfall).toBe(cost)
    // « Près » est à environ 73 km du front : un peu plus de 1 jour de trajet après la sortie.
    expect(p.arrivalDays).toBeGreaterThan(RECRUIT_COSTS.inf.days)
    const rich = plan(['inf'])
    expect(rich.affordable).toBe(1)
    expect(rich.shortfall).toBe(0)
    expect(rich.arrivalDays).toBe(RECRUIT_COSTS.inf.days + 2)
  })
})

describe('recrutement par armée (simulation)', () => {
  it('lance les formations dans les casernes et les recrues rejoignent l’armée', () => {
    const sim = newGame()
    const army = mainArmy(sim)
    const eco = ecoOf(sim)
    const queued = eco.recruitment.length
    const men = eco.manpower
    const res = sim.queueArmyRecruit(army.id, { inf: 3, art: 1 })
    expect(res).toEqual({ launched: 4, error: null })
    const mine = eco.recruitment.slice(queued)
    expect(mine.map((q) => q.kind)).toEqual(['inf', 'inf', 'inf', 'art'])
    expect(mine.every((q) => q.armyId === army.id)).toBe(true)
    expect(eco.manpower).toBeCloseTo(
      men - 3 * RECRUIT_COSTS.inf.manpower - RECRUIT_COSTS.art.manpower,
    )
    // Chaque formation va dans une ville du joueur qui a une caserne.
    for (const q of mine) {
      const c = sim.ctx.cityStates.get(q.city)
      expect(c?.buildings.barracks).toBeGreaterThan(0)
    }
    const existing = new Set(sim.ctx.units.keys())
    eco.production += 1e5
    sim.step(24 * 40)
    expect(eco.recruitment.filter((q) => q.armyId === army.id)).toHaveLength(0)
    const recruits = [...sim.ctx.units.values()].filter(
      (u) => u.owner === 'UKR' && !existing.has(u.id) && u.armyId === army.id,
    )
    expect(recruits.length).toBeGreaterThanOrEqual(4)
  })

  it('ne lance que ce que la main-d’œuvre permet', () => {
    const sim = newGame()
    const army = mainArmy(sim)
    const eco = ecoOf(sim)
    eco.manpower = RECRUIT_COSTS.inf.manpower * 2 + 0.1
    const res = sim.queueArmyRecruit(army.id, { inf: 5 })
    expect(res.launched).toBe(2)
    expect(res.error).toMatch(/2 formation/)
    expect(sim.queueArmyRecruit(army.id, { inf: 1 }).launched).toBe(0)
  })
})
