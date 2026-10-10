import fs from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { loadTheater } from '@/sim/theater/load'
import type { TheaterData } from '@/sim/theater/grid'
import { frontCells } from '@/sim/systems/armies'
import { axisBonus, cumulativeWeights, indexAtShare, snapToAxis } from '@/sim/systems/axes'
import { isLineUnit } from '@/sim/units/catalog'

const readPublic = async (p: string): Promise<ArrayBuffer> => {
  const buf = fs.readFileSync(new URL(`../public/${p}`, import.meta.url))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

let theater: TheaterData
beforeAll(async () => {
  theater = await loadTheater('ukraine', readPublic)
})

describe('front discontinu', () => {
  it('les unités de ligne se concentrent sur les axes (routes, voies ferrées, villes)', () => {
    const sim = Simulation.fromScenario(ukraine2026, theater, 7)
    const ctx = sim.ctx
    const side = sim.sideOf('UKR')
    const cells = frontCells(ctx, side, null)
    const onAxis = cells.filter((c) => axisBonus(ctx, c.cell) > 0).length / cells.length
    let posts = 0
    let axisPosts = 0
    for (const u of ctx.units.values()) {
      const t = u.order.target
      if (u.owner !== 'UKR' || !isLineUnit(u.kind) || u.order.kind !== 'front' || !t) continue
      posts++
      if (axisBonus(ctx, ctx.grid.cellAt(t[0], t[1])) > 0) axisPosts++
    }
    expect(posts).toBeGreaterThan(10)
    // Les postes sur un axe sont nettement plus fréquents que les axes sur le front.
    expect(axisPosts / posts).toBeGreaterThan(onAxis + 0.1)
  })

  it('les postes suivent le poids cumulé des cellules', () => {
    const cum = Float64Array.from([0, 1, 2, 7, 8])
    expect(indexAtShare(cum, 0)).toBe(0)
    expect(indexAtShare(cum, 0.3)).toBe(2)
    expect(indexAtShare(cum, 0.8)).toBe(2)
    expect(indexAtShare(cum, 0.95)).toBe(3)
    expect(indexAtShare(cum, 1)).toBe(3)
  })

  it('la base d’une percée est visée sur la route ou la voie ferrée la plus proche', () => {
    const sim = Simulation.fromScenario(ukraine2026, theater, 7)
    const ctx = sim.ctx
    // Entre Kiev et Jytomyr : une route passe à quelques km.
    const p = snapToAxis(ctx, [29.6, 50.35], 10)
    const cell = ctx.grid.cellAt(p[0], p[1])
    expect(ctx.grid.roads[cell]).toBeGreaterThan(0)
    // Pleine mer : aucun axe, le point reste tel quel.
    expect(snapToAxis(ctx, [31, 45.5], 10)).toEqual([31, 45.5])
    expect(cumulativeWeights(ctx, []).length).toBe(1)
  })
})
