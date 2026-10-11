import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { BRIGADE_SPLIT, isBrigade } from '@/sim/units/catalog'
import { munitionsPerShot, MUNITIONS_PER_SHOT_BY_KIND } from '@/sim/units/kinds'
import { FORMATIONS_PER_BARRACKS, RECRUIT_COSTS, formationSlots } from '@/sim/economy/rules'
import { forceComposition, forceSizeOf } from '@/sim/politics/mobilization'
import type { TheaterData } from '@/sim/theater/grid'

const theater = theaterJson as unknown as TheaterData

describe('échelle de la brigade', () => {
  it('le théâtre ukrainien aligne trois brigades par ancienne unité, logistique et QG inchangés', () => {
    const sim = Simulation.fromScenario(ukraine2026, theater, 1)
    const count = (owner: string, kind: string): number =>
      [...sim.ctx.units.values()].filter((u) => u.owner === owner && u.kind === kind).length
    expect(count('UKR', 'inf')).toBe(10 * BRIGADE_SPLIT)
    expect(count('RUS', 'tank')).toBe(5 * BRIGADE_SPLIT)
    expect(count('UKR', 'log')).toBe(2)
    expect(count('RUS', 'hq')).toBe(2)
  })

  it('une brigade coûte et consomme le tiers, une caserne en forme trois à la fois', () => {
    expect(RECRUIT_COSTS.inf.production * BRIGADE_SPLIT).toBeCloseTo(300)
    expect(RECRUIT_COSTS.mech.manpower * BRIGADE_SPLIT).toBeCloseTo(5)
    expect(RECRUIT_COSTS.hq.production).toBe(400)
    expect(formationSlots(2)).toBe(2 * FORMATIONS_PER_BARRACKS)
    expect(munitionsPerShot('art') * BRIGADE_SPLIT).toBeCloseTo(MUNITIONS_PER_SHOT_BY_KIND.art)
    expect(munitionsPerShot('hq')).toBe(MUNITIONS_PER_SHOT_BY_KIND.hq)
    expect(isBrigade('tdf')).toBe(true)
    expect(isBrigade('log')).toBe(false)
  })

  it('les forces de « Monde 2026 » triplent, plafond à 135, sans tripler QG et logistique', () => {
    expect(forceSizeOf(30_000, 330)).toBe(135)
    expect(forceSizeOf(0, 0)).toBe(3 * BRIGADE_SPLIT)
    const big = forceComposition(135)
    expect(big.hq).toBe(4)
    expect(big.log).toBe(4)
    expect(Object.values(big).reduce((a, b) => a + b, 0)).toBe(135)
  })

  it('les pertes usent le soutien à la guerre à l’échelle de l’ancienne unité', () => {
    // Deux parties identiques ; dans l'une, trois brigades de plus perdues le premier jour.
    const support = (extra: number): number => {
      const sim = Simulation.fromScenario(ukraine2026, theater, 1)
      sim.step(23)
      sim.ctx.losses.set('UKR', (sim.ctx.losses.get('UKR') ?? 0) + extra)
      sim.step(1)
      return sim.ctx.politics.countries.get('UKR')?.warSupport ?? 0
    }
    // Autant qu'une ancienne unité : −0,01.
    expect(support(0) - support(BRIGADE_SPLIT)).toBeCloseTo(0.01, 6)
  })
})
