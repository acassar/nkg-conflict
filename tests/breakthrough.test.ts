import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { assignFront } from '@/sim/systems/armies'
import { isBreach, reactionOf, reactToBreakthroughs } from '@/sim/systems/breakthrough'
import { isLineUnit } from '@/sim/units/catalog'
import type { TheaterData } from '@/sim/theater/grid'
import type { ArmyState, UnitState } from '@/sim/core/types'

const theater = theaterJson as unknown as TheaterData

interface Setup {
  sim: Simulation
  army: ArmyState
  line: UnitState[]
  /** Unité de ligne de l'armée la plus proche de la percée. */
  near: UnitState
  intruder: UnitState
}

/** Une brigade russe enfoncée à 10 km derrière une brigade ukrainienne de la 1re Armée. */
function setup(): Setup {
  const sim = Simulation.fromScenario(ukraine2026, theater, 7)
  const ctx = sim.ctx
  const army = [...ctx.armies.values()].find((a) => a.owner === 'UKR' && a.wholeFront)
  if (!army) throw new Error('armée introuvable')
  const line = army.unitIds
    .map((id) => ctx.units.get(id))
    .filter((u): u is UnitState => !!u && isLineUnit(u.kind))
  const near = line[0]
  const intruder = [...ctx.units.values()].find((u) => u.owner === 'RUS' && u.kind === 'tank')
  if (!near || !intruder) throw new Error('unités introuvables')
  const side = sim.sideOf('UKR')
  // Position sur une cellule ukrainienne, un peu à l'ouest de la brigade.
  let lon = near.lon - 0.1
  while (ctx.grid.owner[ctx.grid.cellAt(lon, near.lat)] !== side) lon -= 0.05
  ;[intruder.lon, intruder.lat] = [lon, near.lat]
  intruder.order = { kind: 'attack', target: [lon - 1, near.lat] }
  intruder.path = []
  for (const u of line) u.entrench = 1
  near.entrench = 0
  return { sim, army, line, near, intruder }
}

describe('riposte aux percées', () => {
  it('une unité ennemie sur notre territoire est une percée', () => {
    const { sim, intruder } = setup()
    expect(isBreach(sim.ctx, sim.sideOf('UKR'), intruder)).toBe(true)
  })

  it('les unités bien retranchées gardent leur poste, les autres réagissent', () => {
    const { sim, line, near, intruder } = setup()
    reactToBreakthroughs(sim.ctx)
    expect(reactionOf(sim.ctx, near.id)?.intruder).toBe(intruder.id)
    for (const u of line) if (u !== near) expect(reactionOf(sim.ctx, u.id)).toBeUndefined()
  })

  it('contre-attaque une pointe faible, bloque une pointe forte', () => {
    const weak = setup()
    weak.intruder.strength = 0.1
    reactToBreakthroughs(weak.sim.ctx)
    expect(reactionOf(weak.sim.ctx, weak.near.id)?.kind).toBe('counter')
    expect(weak.near.order.kind).toBe('attack')

    const strong = setup()
    strong.near.strength = 0.1
    reactToBreakthroughs(strong.sim.ctx)
    expect(reactionOf(strong.sim.ctx, strong.near.id)?.kind).toBe('block')
    expect(strong.near.order.kind).toBe('move')
  })

  it('une unité en riposte n’est pas renvoyée à son poste avant la fin de la percée', () => {
    const { sim, army, near, intruder } = setup()
    near.strength = 0.1
    reactToBreakthroughs(sim.ctx)
    const target = near.order.target
    assignFront(sim.ctx, army)
    expect(near.order.kind).toBe('move')
    expect(near.order.target).toEqual(target)
    // Percée détruite : retour au poste.
    sim.ctx.units.delete(intruder.id)
    reactToBreakthroughs(sim.ctx)
    expect(reactionOf(sim.ctx, near.id)).toBeUndefined()
    assignFront(sim.ctx, army)
    expect(near.order.kind).toBe('front')
  })
})
