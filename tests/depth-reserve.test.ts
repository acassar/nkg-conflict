import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { frontCells } from '@/sim/systems/armies'
import { reactionOf, reactToBreakthroughs } from '@/sim/systems/breakthrough'
import { decide, DEPTH_WITHDRAW_FACTOR, type Assessment } from '@/sim/systems/fallback'
import { missionKind } from '@/sim/systems/missions'
import { distanceKm, type TheaterData } from '@/sim/theater/grid'
import type { ArmyState, LonLat, UnitState } from '@/sim/core/types'
import { isLineUnit } from '@/sim/units/catalog'

const theater = theaterJson as unknown as TheaterData

function setup(): { sim: Simulation; army: ArmyState } {
  const sim = Simulation.fromScenario(ukraine2026, theater, 7)
  const army = [...sim.ctx.armies.values()].find((a) => a.owner === 'UKR' && a.wholeFront)
  if (!army) throw new Error('armée introuvable')
  return { sim, army }
}

/** Distance (km) de chaque poste de ligne de l'armée à la cellule de front la plus proche. */
function postDepths(sim: Simulation, army: ArmyState): number[] {
  const ctx = sim.ctx
  const front: LonLat[] = frontCells(ctx, sim.sideOf(army.owner), null).map((c) => [
    ctx.grid.lonOf(c.cell),
    ctx.grid.latOf(c.cell),
  ])
  const out: number[] = []
  for (const id of army.unitIds) {
    const u = ctx.units.get(id)
    const t = u?.order.target
    if (!u || !isLineUnit(u.kind) || u.order.kind !== 'front' || !t) continue
    out.push(Math.min(...front.map((f) => distanceKm(t[0], t[1], f[0], f[1]))))
  }
  return out
}

describe('missions « Défense en profondeur » et « Réserve »', () => {
  it('défense en profondeur : une seconde ligne en arrière', () => {
    const { sim, army } = setup()
    expect(Math.max(...postDepths(sim, army))).toBeLessThan(15)
    expect(sim.lineMissionArmy(army.id, 'depth')).toBeNull()
    expect(missionKind(army)).toBe('depth')
    const depths = postDepths(sim, army)
    const second = depths.filter((d) => d >= 15).length / depths.length
    // Deux cinquièmes environ des postes sur la seconde ligne (le territoire peut la rapprocher).
    expect(second).toBeGreaterThan(0.25)
    expect(second).toBeLessThan(0.5)
  })

  it('défense en profondeur : la première ligne décroche plus tôt', () => {
    const a: Assessment = {
      threat: 1,
      defense: 1,
      ring: 0,
      supplied: true,
      helped: false,
      strongPoint: false,
      risk: 2.2,
    }
    expect(decide(a).decision).toBe('hold')
    expect(decide(a, DEPTH_WITHDRAW_FACTOR).decision).toBe('withdraw')
  })

  it('réserve : en retrait, elle contre-attaque une percée même retranchée, puis revient', () => {
    const { sim, army } = setup()
    const ctx = sim.ctx
    sim.lineMissionArmy(army.id, 'reserve')
    expect(missionKind(army)).toBe('reserve')
    const depths = postDepths(sim, army)
    expect(depths.length).toBeGreaterThan(5)
    // La plupart des postes à 20 km ou plus du front (quelques-uns restent près d'une autre portion).
    expect(depths.filter((d) => d >= 20).length / depths.length).toBeGreaterThan(0.6)
    expect(depths.reduce((s, d) => s + d, 0) / depths.length).toBeGreaterThan(20)

    // Percée : une brigade russe enfoncée en territoire ukrainien, près d'une unité de la réserve.
    const line = army.unitIds
      .map((id) => ctx.units.get(id))
      .filter((u): u is UnitState => !!u && isLineUnit(u.kind))
    const near = line[0] as UnitState
    const target = near.order.target as LonLat
    ;[near.lon, near.lat] = target
    for (const u of line) u.entrench = 1
    const intruder = [...ctx.units.values()].find((u) => u.owner === 'RUS' && u.kind === 'tank')
    if (!intruder) throw new Error('unité introuvable')
    const side = sim.sideOf('UKR')
    let lon = near.lon + 0.3
    while (ctx.grid.owner[ctx.grid.cellAt(lon, near.lat)] !== side) lon -= 0.05
    ;[intruder.lon, intruder.lat] = [lon, near.lat]
    intruder.order = { kind: 'attack', target: [lon - 1, near.lat] }
    intruder.path = []
    reactToBreakthroughs(ctx)
    const reacting = line.filter((u) => reactionOf(ctx, u.id)?.intruder === intruder.id)
    // Plus que les deux unités d'une armée ordinaire, retranchement compris.
    expect(reacting.length).toBeGreaterThan(2)

    // Retour à « Tenir » : postes de nouveau au contact.
    for (const u of line) ctx.runtime.get(u.id)!.reaction = undefined
    sim.holdArmy(army.id)
    expect(Math.max(...postDepths(sim, army))).toBeLessThan(15)
  })
})
