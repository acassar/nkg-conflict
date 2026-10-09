import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { frontCells, postValue } from '@/sim/systems/armies'
import { isLineUnit } from '@/sim/units/catalog'
import type { TheaterData } from '@/sim/theater/grid'
import type { ArmyState } from '@/sim/core/types'

const theater = theaterJson as unknown as TheaterData
const newGame = (): Simulation => Simulation.fromScenario(ukraine2026, theater, 7)

function frontArmy(sim: Simulation): ArmyState {
  const army = [...sim.ctx.armies.values()].find(
    (a) => a.owner === 'UKR' && (a.front || a.wholeFront),
  )
  if (!army) throw new Error('aucune armée ukrainienne au front')
  return army
}

/** Valeur défensive moyenne des postes visés par les unités de ligne de l'armée. */
function meanPostValue(sim: Simulation, army: ArmyState): { mean: number; posts: number } {
  const ctx = sim.ctx
  const side = sim.sideOf('UKR')
  const cells = frontCells(ctx, side, army.wholeFront ? null : army.front)
  const values = new Map<number, number>()
  for (const c of cells) {
    const { cell, value } = postValue(ctx, side, c, 2, new Map())
    values.set(cell, Math.max(values.get(cell) ?? 0, value))
  }
  let sum = 0
  let n = 0
  const targets = new Set<number>()
  for (const id of army.unitIds) {
    const u = ctx.units.get(id)
    const target = u?.order.target
    if (!u || !target || !isLineUnit(u.kind) || u.order.kind !== 'front') continue
    const cell = ctx.grid.cellAt(target[0], target[1])
    targets.add(cell)
    sum += values.get(cell) ?? 1
    n++
  }
  return { mean: sum / Math.max(1, n), posts: targets.size }
}

describe('postes favorables en défense', () => {
  it('une armée en posture défensive tient des postes de plus grande valeur', () => {
    const sim = newGame()
    const army = frontArmy(sim)
    const before = meanPostValue(sim, army)
    sim.setArmyPosture(army.id, 'defensive')
    const after = meanPostValue(sim, army)
    expect(after.mean).toBeGreaterThan(before.mean)
    // Un poste par secteur : les unités restent réparties sur tout le front.
    expect(after.posts).toBeGreaterThanOrEqual(before.posts - 1)
  })

  it('le retranchement et les obstacles d’un poste comptent dans sa valeur', () => {
    const sim = newGame()
    const ctx = sim.ctx
    const side = sim.sideOf('UKR')
    const army = frontArmy(sim)
    const f = frontCells(ctx, side, army.wholeFront ? null : army.front)[0]
    if (!f) throw new Error('front vide')
    const bare = postValue(ctx, side, f, 2, new Map())
    const dug = postValue(ctx, side, f, 2, new Map([[bare.cell, 1]]))
    expect(dug.value / bare.value).toBeCloseTo(1.5)
    ctx.obstacles.set(bare.cell, { level: 1, side })
    const mined = postValue(ctx, side, f, 2, new Map())
    expect(mined.value / bare.value).toBeCloseTo(1 / 0.7)
  })
})
