import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { runtimeOf } from '@/sim/context'
import { combatModifiers, defenseValue, updateCombat } from '@/sim/systems/combat'
import { angularSpread, FLANK_DEFENSE } from '@/sim/systems/flanks'
import { battleReport } from '@/sim/systems/battle'
import type { TheaterData } from '@/sim/theater/grid'
import type { UnitState } from '@/sim/core/types'

const theater = theaterJson as unknown as TheaterData
const newGame = (): Simulation => Simulation.fromScenario(ukraine2026, theater, 7)

/** Une unité ukrainienne posée loin du front (ouest du pays) et des unités russes autour d'elle. */
function setup(offsets: Array<[number, number]>): {
  sim: Simulation
  u: UnitState
  foes: UnitState[]
} {
  const sim = newGame()
  const all = [...sim.ctx.units.values()]
  const u = all.find((x) => x.owner === 'UKR' && x.kind === 'inf')
  const foes = all.filter((x) => x.owner === 'RUS' && x.kind === 'inf').slice(0, offsets.length)
  if (!u || foes.length < offsets.length) throw new Error('unités introuvables')
  u.lon = 25.5
  u.lat = 49.5
  u.org = 1
  foes.forEach((f, k) => {
    const [dLon, dLat] = offsets[k] as [number, number]
    f.lon = u.lon + dLon
    f.lat = u.lat + dLat
    f.order = { kind: 'hold' }
  })
  return { sim, u, foes }
}

describe('règle de flanc', () => {
  it('mesure l’ouverture des directions d’attaque', () => {
    expect(angularSpread([10])).toBe(0)
    expect(angularSpread([-40, 40])).toBe(80)
    expect(angularSpread([90, 270])).toBe(180)
    expect(angularSpread([0, 90, 180, 270])).toBe(270)
    expect(angularSpread([350, 10])).toBe(20)
  })

  it('un seul ennemi de face : pas de malus', () => {
    const { sim, u } = setup([[0.12, 0]])
    updateCombat(sim.ctx)
    expect(runtimeOf(sim.ctx, u.id).engagedWith).not.toBeNull()
    expect(runtimeOf(sim.ctx, u.id).flank).toBeUndefined()
    expect(combatModifiers(sim.ctx, u).defense.some((m) => m.label.startsWith('Flanc'))).toBe(false)
  })

  it('attaquée de deux côtés : défense réduite, affichée dans l’écran de bataille', () => {
    const { sim, u } = setup([
      [0.12, 0],
      [-0.12, 0],
    ])
    updateCombat(sim.ctx)
    const flank = runtimeOf(sim.ctx, u.id).flank
    expect(flank?.level).toBe(1)
    const before = defenseValue(sim.ctx, u)
    delete runtimeOf(sim.ctx, u.id).flank
    expect(before / defenseValue(sim.ctx, u)).toBeCloseTo(FLANK_DEFENSE[1], 5)
    runtimeOf(sim.ctx, u.id).flank = flank
    const mods = combatModifiers(sim.ctx, u).defense
    expect(mods.find((m) => m.label.startsWith('Flanc'))?.value).toBeCloseTo(FLANK_DEFENSE[1], 5)
    expect(mods.find((m) => m.label.startsWith('Moral'))?.value).toBeLessThan(1)
    const report = battleReport(sim.ctx, [u.id], 'UKR')
    const row = [...(report?.a ?? []), ...(report?.b ?? [])].find((x) => x.id === u.id)
    expect(row?.flank).toBe('attaquée de deux côtés')
  })

  it('presque encerclée : malus plus fort et moral qui cède plus vite', () => {
    const ring: Array<[number, number]> = [
      [0.12, 0],
      [-0.12, 0],
      [0, 0.08],
      [0, -0.08],
    ]
    const surrounded = setup(ring)
    updateCombat(surrounded.sim.ctx)
    expect(runtimeOf(surrounded.sim.ctx, surrounded.u.id).flank?.level).toBe(2)

    // Même nombre d'ennemis, tous du même côté : l'organisation baisse moins.
    const front = setup([
      [0.12, 0],
      [0.11, 0.04],
      [0.11, -0.04],
      [0.13, 0.02],
    ])
    updateCombat(front.sim.ctx)
    expect(runtimeOf(front.sim.ctx, front.u.id).flank).toBeUndefined()
    expect(1 - surrounded.u.org).toBeGreaterThan(1 - front.u.org)
  })

  it('disparaît quand le contact cesse', () => {
    const { sim, u, foes } = setup([
      [0.12, 0],
      [-0.12, 0],
    ])
    updateCombat(sim.ctx)
    expect(runtimeOf(sim.ctx, u.id).flank).toBeDefined()
    for (const f of foes) f.lat += 3
    updateCombat(sim.ctx)
    expect(runtimeOf(sim.ctx, u.id).flank).toBeUndefined()
  })
})
