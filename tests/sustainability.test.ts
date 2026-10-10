import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { parseSave, serializeSave } from '@/sim/core/save'
import { RECRUIT_COSTS } from '@/sim/economy/rules'
import { assess, sustainabilityOf } from '@/sim/economy/sustainability'
import { sustainView } from '@/composables/sustainability'
import type { TheaterData } from '@/sim/theater/grid'

const theater = theaterJson as unknown as TheaterData
const newGame = (): Simulation => Simulation.fromScenario(ukraine2026, theater, 1)

describe("soutenabilité de l'armée", () => {
  it('donne les jours tenables et le facteur limitant', () => {
    const r = assess(
      { production: 200, munitions: 50, manpower: 2 },
      { production: 150, munitions: 100, manpower: 1 },
      { production: 1000, munitions: 3000, manpower: 40 },
    )
    // Production : 1000 / 50 = 20 jours ; main-d'œuvre : 40 / 1 = 40 jours.
    expect(r.limiting).toBe('production')
    expect(r.days).toBeCloseTo(20)
    expect(r.coverage).toBeCloseTo(0.5)
  })

  it('armée durable sans déficit, ou sans besoins', () => {
    const ok = assess(
      { production: 100, munitions: 50, manpower: 1 },
      { production: 150, munitions: 100, manpower: 3 },
      { production: 0, munitions: 0, manpower: 0 },
    )
    expect(ok.days).toBe(null)
    expect(ok.coverage).toBeCloseTo(1.5)
    const idle = assess(
      { production: 0, munitions: 0, manpower: 0 },
      { production: 10, munitions: 10, manpower: 1 },
      { production: 0, munitions: 0, manpower: 0 },
    )
    expect(idle.days).toBe(null)
    expect(idle.coverage).toBe(null)
  })

  it('mesure les pertes du jour : renforts et unités détruites', () => {
    const sim = newGame()
    sim.step(48)
    expect(sustainabilityOf(sim.ctx, 'UKR')).not.toBe(null)
    // Pertes artificielles juste après la mesure : une unité réduite de moitié, une autre détruite.
    const own = [...sim.ctx.units.values()].filter((u) => u.owner === 'UKR' && u.kind === 'inf')
    const [hurt, gone] = own
    if (!hurt || !gone) throw new Error('unités absentes')
    // Unités au front : pertes de combat possibles dans la journée, on mesure l'écart.
    const before = sustainabilityOf(sim.ctx, 'UKR')
    if (!before) throw new Error('mesure absente')
    hurt.strength = Math.max(0, hurt.strength - 0.5)
    sim.ctx.units.delete(gone.id)
    sim.step(24)
    const after = sustainabilityOf(sim.ctx, 'UKR')
    if (!after) throw new Error('mesure absente')
    expect(after.samples).toBe(before.samples + 1)
    // Moyenne glissante : le jour mesuré compte pour 1/7 au moins.
    expect(after.replace.production).toBeGreaterThanOrEqual(RECRUIT_COSTS.inf.production / 7 - 1)
    expect(after.reinforce.production).toBeGreaterThanOrEqual(
      (0.5 * RECRUIT_COSTS.inf.production * 0.5) / 7 - 1,
    )
    expect(after.need.production).toBeGreaterThan(0)
    expect(after.income.production).toBeGreaterThan(0)
  })

  it('reste dans la sauvegarde et reprend après un chargement', () => {
    const sim = newGame()
    sim.step(72)
    const s = sustainabilityOf(sim.ctx, 'RUS')
    const loaded = Simulation.fromSave(parseSave(serializeSave(sim.toSave())), ukraine2026, theater)
    expect(sustainabilityOf(loaded.ctx, 'RUS')).toEqual(s)
    loaded.step(48)
    expect(sustainabilityOf(loaded.ctx, 'RUS')?.samples).toBeGreaterThan(s?.samples ?? 0)
  })

  it("affiche l'état : durable, en tension ou critique", () => {
    const stock = { production: 300, munitions: 3000, manpower: 50 }
    expect(sustainView(null, stock).level).toBe('unknown')
    const base = {
      samples: 10,
      need: { production: 200, munitions: 20, manpower: 2 },
      income: { production: 180, munitions: 100, manpower: 4 },
      reinforce: { production: 100, munitions: 0, manpower: 1 },
      replace: { production: 100, munitions: 0, manpower: 1 },
      aid: { production: 30, munitions: 0 },
    }
    const critical = sustainView(
      { ...base, days: 15, limiting: 'production', coverage: 0.9 },
      stock,
    )
    expect(critical.level).toBe('critical')
    expect(critical.value).toBe('15 j')
    expect(critical.summary).toContain('faute de production')
    expect(critical.rows[0]?.balance).toBe(-20)
    expect(critical.rows[0]?.detail).toContain('aide reçue 30')
    expect(
      sustainView({ ...base, days: 60, limiting: 'production', coverage: 0.9 }, stock).level,
    ).toBe('warning')
    const fine = sustainView({ ...base, days: null, limiting: null, coverage: 2 }, stock)
    expect(fine.level).toBe('ok')
    expect(fine.value).toBe('durable')
  })
})
