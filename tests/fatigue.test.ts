import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { assignFront, frontCells } from '@/sim/systems/armies'
import { combatModifiers, defenseValue, firePower } from '@/sim/systems/combat'
import {
  FATIGUE_COMBAT_PER_HOUR,
  FATIGUE_REST_PER_HOUR,
  RELIEF_END,
  RELIEF_START,
  selectRelief,
  updateFatigue,
} from '@/sim/systems/fatigue'
import { WarIndex } from '@/sim/systems/spatial'
import { runtimeOf } from '@/sim/context'
import { distanceKm, type TheaterData } from '@/sim/theater/grid'
import type { ArmyState, LonLat, UnitState } from '@/sim/core/types'
import { isLineUnit } from '@/sim/units/catalog'

const theater = theaterJson as unknown as TheaterData

function setup(): { sim: Simulation; army: ArmyState; line: UnitState[] } {
  const sim = Simulation.fromScenario(ukraine2026, theater, 7)
  const army = [...sim.ctx.armies.values()].find((a) => a.owner === 'UKR' && a.wholeFront)
  if (!army) throw new Error('armée introuvable')
  const line = army.unitIds
    .map((id) => sim.ctx.units.get(id))
    .filter((u): u is UnitState => !!u && isLineUnit(u.kind))
  return { sim, army, line }
}

/** Distance (km) d'un point à la cellule de front ukrainienne la plus proche. */
function depthOf(sim: Simulation, p: LonLat): number {
  const ctx = sim.ctx
  return Math.min(
    ...frontCells(ctx, sim.sideOf('UKR'), null).map((c) =>
      distanceKm(p[0], p[1], ctx.grid.lonOf(c.cell), ctx.grid.latOf(c.cell)),
    ),
  )
}

describe('fatigue et relève', () => {
  it('la fatigue monte au contact et retombe au repos', () => {
    const { sim, line } = setup()
    const ctx = sim.ctx
    const u = line[0]!
    const rt = runtimeOf(ctx, u.id)
    const index = new WarIndex(ctx)
    rt.engagedWith = -1
    updateFatigue(u, rt, false, index)
    expect(u.fatigue).toBeCloseTo(FATIGUE_COMBAT_PER_HOUR, 9)
    updateFatigue(u, rt, true, index)
    expect(u.fatigue).toBeCloseTo(FATIGUE_COMBAT_PER_HOUR * 2.5, 9)
    // Loin de tout ennemi : repos.
    rt.engagedWith = null
    u.lon = 24
    u.lat = 49.8
    u.fatigue = 0.5
    updateFatigue(u, rt, false, new WarIndex(ctx))
    expect(u.fatigue).toBeCloseTo(0.5 - FATIGUE_REST_PER_HOUR, 9)
  })

  it('une unité fatiguée frappe et tient moins bien, et le montre', () => {
    const { sim, line } = setup()
    const u = line[0]!
    const fire = firePower(sim.ctx, u)
    const defense = defenseValue(sim.ctx, u)
    expect(combatModifiers(sim.ctx, u).defense.some((m) => m.key === 'fatigue')).toBe(false)
    u.fatigue = 1
    expect(firePower(sim.ctx, u)).toBeLessThan(fire * 0.75)
    expect(defenseValue(sim.ctx, u)).toBeLessThan(defense * 0.75)
    expect(combatModifiers(sim.ctx, u).defense.find((m) => m.key === 'fatigue')?.value).toBeCloseTo(
      0.7,
      6,
    )
  })

  it('la relève prend les plus fatiguées, au plus un quart de la ligne, avec hystérésis', () => {
    const { line } = setup()
    expect(line.length).toBeGreaterThanOrEqual(8)
    for (const [k, u] of line.entries()) u.fatigue = k < 6 ? 0.7 + k * 0.01 : 0.1
    const resting = selectRelief(line)
    expect(resting).toHaveLength(Math.floor(line.length / 4))
    // Les plus fatiguées d'abord.
    expect(resting[0]!.fatigue).toBeCloseTo(0.75, 6)
    for (const u of resting) expect(u.relief).toBe(true)
    // Au repos, elle reste en relève tant qu'elle n'est pas redescendue sous le seuil de retour.
    const first = resting[0]!
    for (const u of line) if (u !== first) u.fatigue = 0
    first.fatigue = (RELIEF_START + RELIEF_END) / 2
    expect(selectRelief(line)).toEqual([first])
    first.fatigue = RELIEF_END / 2
    expect(selectRelief(line)).toEqual([])
    expect(first.relief).toBeFalsy()
  })

  it("l'armée envoie ses unités épuisées au repos, en retrait, et répartit leurs postes", () => {
    const { sim, army, line } = setup()
    const tired = line.slice(0, 2)
    for (const u of tired) u.fatigue = 0.9
    assignFront(sim.ctx, army)
    const fresh = line.filter((u) => !tired.includes(u))
    const freshDepths = fresh
      .map((u) => u.order.target)
      .filter((t): t is LonLat => !!t)
      .map((t) => depthOf(sim, t))
    const maxFresh = Math.max(...freshDepths)
    for (const u of tired) {
      expect(u.relief).toBe(true)
      expect(u.order.kind).toBe('front')
      expect(depthOf(sim, u.order.target!)).toBeGreaterThan(maxFresh)
    }
    const snap = sim.snapshot().units.find((s) => s.id === tired[0]!.id)
    expect(snap?.relief).toBe(true)
    expect(snap?.fatigue).toBeCloseTo(0.9, 6)
  })
})
