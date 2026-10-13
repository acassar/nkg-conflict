import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { expandOrder, planArmyRecruit } from '@/sim/economy/armyRecruit'
import { recruitCostOf } from '@/sim/economy/rules'
import { DEFAULT_BRIGADE_TEMPLATE, DIVISION_TEMPLATES } from '@/sim/units/templates'
import type { UnitKind } from '@/sim/core/types'
import type { TheaterData } from '@/sim/theater/grid'

const theater = theaterJson as unknown as TheaterData
const tpl = (k: UnitKind): string => DEFAULT_BRIGADE_TEMPLATE[k] ?? ''
const lines = (kinds: UnitKind[]) => kinds.map((kind) => ({ kind, template: tpl(kind) }))
/** Coût d'une brigade du modèle par défaut de ce type. */
const COST = new Proxy({} as Record<UnitKind, ReturnType<typeof recruitCostOf>>, {
  get: (_, k) => recruitCostOf(k as UnitKind, tpl(k as UnitKind)),
})
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
  const plan = (kinds: UnitKind[], queue = [] as never[]) =>
    planArmyRecruit({
      sites,
      queue,
      anchors,
      lines: lines(kinds),
      stock: 1e6,
      productionPerDay: 1000,
    })

  it('prend d’abord la caserne libre la plus proche du front', () => {
    const p = plan(['inf'])
    expect(p.items).toEqual([{ kind: 'inf', city: 'Près', line: 0 }])
    expect(p.production).toBe(COST.inf.production)
    expect(p.days).toBe(COST.inf.days)
  })

  it('se répartit quand une caserne ne suffit pas, puis met en file', () => {
    const p = plan(['inf', 'inf', 'inf', 'inf', 'inf', 'inf'])
    const count = (city: string) => p.items.filter((i) => i.city === city).length
    expect(count('Près')).toBeGreaterThanOrEqual(1)
    expect(count('Moyen')).toBeGreaterThanOrEqual(2)
    // Six formations pour quatre casernes : au moins deux attendent.
    expect(p.cities.reduce((n, c) => n + c.waiting, 0)).toBeGreaterThanOrEqual(2)
    expect(p.barracksDays).toBeGreaterThan(COST.inf.days)
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
      lines: lines(['tank', 'tank']),
      stock: 0,
      productionPerDay: 20,
    })
    expect(p.productionDays).toBe(Math.ceil((2 * COST.tank.production) / 20))
    expect(p.days).toBe(p.productionDays)
    expect(p.affordable).toBe(0)
    expect(p.shortfall).toBe(2 * COST.tank.production)
  })

  it('part couverte par le stock et arrivée au front après le trajet', () => {
    const cost = COST.inf.production
    const p = planArmyRecruit({
      sites,
      queue: [],
      anchors,
      lines: lines(['inf', 'inf', 'inf']),
      stock: 2 * cost,
      productionPerDay: cost,
    })
    expect(p.affordable).toBe(2)
    expect(p.shortfall).toBe(cost)
    // « Près » est à environ 73 km du front : un peu plus de 1 jour de trajet après la sortie.
    expect(p.arrivalDays).toBeGreaterThan(COST.inf.days)
    const rich = plan(['inf'])
    expect(rich.affordable).toBe(1)
    expect(rich.shortfall).toBe(0)
    expect(rich.arrivalDays).toBe(COST.inf.days + 2)
  })
})

describe('recrutement par armée (simulation)', () => {
  it('lance les formations dans les casernes et les recrues rejoignent l’armée', () => {
    const sim = newGame()
    const army = mainArmy(sim)
    const eco = ecoOf(sim)
    const queued = eco.recruitment.length
    const men = eco.manpower
    const res = sim.queueArmyRecruit(army.id, { brigades: { [tpl('inf')]: 3, [tpl('art')]: 1 } })
    expect(res).toEqual({ launched: 4, error: null })
    const mine = eco.recruitment.slice(queued)
    expect(mine.map((q) => q.kind)).toEqual(['inf', 'inf', 'inf', 'art'])
    expect(mine.every((q) => q.armyId === army.id)).toBe(true)
    expect(eco.manpower).toBeCloseTo(men - 3 * COST.inf.manpower - COST.art.manpower)
    // Chaque formation va dans une ville du joueur qui a une caserne.
    for (const q of mine) {
      const c = sim.ctx.cityStates.get(q.city)
      expect(c?.buildings.barracks).toBeGreaterThan(0)
    }
    const existing = new Set(sim.ctx.units.keys())
    eco.production += 1e5
    // Recrues vues dans l'armée jour après jour (certaines peuvent tomber au front pendant ces 40 jours).
    const recruits = new Set<number>()
    for (let d = 0; d < 40; d++) {
      sim.step(24)
      for (const u of sim.ctx.units.values()) {
        if (u.owner === 'UKR' && !existing.has(u.id) && u.armyId === army.id) recruits.add(u.id)
      }
    }
    expect(eco.recruitment.filter((q) => q.armyId === army.id)).toHaveLength(0)
    // Brigades versées dans l'armée à leur sortie de caserne ; une formation se perd si sa ville tombe
    // (Donetsk, près du front, peut être prise pendant ces 40 jours).
    expect(recruits.size).toBeGreaterThanOrEqual(3)
  })

  it('ne lance que ce que la main-d’œuvre permet', () => {
    const sim = newGame()
    const army = mainArmy(sim)
    const eco = ecoOf(sim)
    eco.manpower = COST.inf.manpower * 2 + 0.1
    const res = sim.queueArmyRecruit(army.id, { brigades: { [tpl('inf')]: 5 } })
    expect(res.launched).toBe(2)
    expect(res.error).toMatch(/2 formation/)
    expect(sim.queueArmyRecruit(army.id, { brigades: { [tpl('inf')]: 1 } }).launched).toBe(0)
  })

  it('commande une brigade d’un modèle pour une division, et une division entière', () => {
    const sim = newGame()
    const ctx = sim.ctx
    const army = mainArmy(sim)
    const eco = ecoOf(sim)
    eco.manpower = 1e4
    const division = ctx.units.get(army.unitIds[0] ?? -1)?.divisionId
    if (division === undefined) throw new Error('division absente')
    const template = Object.keys(DIVISION_TEMPLATES)[0] ?? ''
    const order = {
      brigades: { blindee: 1 },
      divisionId: division,
      divisions: { [template]: 1 },
    }
    const size = DIVISION_TEMPLATES[template]?.brigades.length ?? 0
    expect(expandOrder(order)).toHaveLength(1 + size)
    const queued = eco.recruitment.length
    expect(sim.queueArmyRecruit(army.id, order)).toEqual({ launched: 1 + size, error: null })
    const mine = eco.recruitment.slice(queued)
    expect(mine[0]).toMatchObject({ kind: 'tank', template: 'blindee', divisionId: division })
    const batch = mine[1]?.batch
    expect(batch).toBeDefined()
    expect(mine.slice(1).every((q) => q.batch === batch && q.divisionTemplate === template)).toBe(
      true,
    )
    const existing = new Set(ctx.units.keys())
    eco.production += 1e6
    for (let d = 0; d < 60 && eco.recruitment.some((q) => q.armyId === army.id); d++) sim.step(24)
    const recruits = [...ctx.units.values()].filter((u) => !existing.has(u.id) && u.owner === 'UKR')
    const tank = recruits.find((u) => u.template === 'blindee' && u.divisionId === division)
    expect(tank).toBeDefined()
    const whole = recruits.filter((u) => u.divisionId !== division && u.divisionId !== undefined)
    const formed = ctx.formations.get(whole[0]?.divisionId ?? -1)
    expect(formed?.template).toBe(template)
    expect(whole.every((u) => u.divisionId === formed?.id)).toBe(true)
    expect(whole.length).toBeGreaterThanOrEqual(size - 1)
  })
})
