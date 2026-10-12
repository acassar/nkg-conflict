import fs from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { Simulation } from '@/sim/simulation'
import { buildScenario } from '@/sim/scenarios'
import { loadTheater } from '@/sim/theater/load'
import type { TheaterData } from '@/sim/theater/grid'
import { distanceKm } from '@/sim/theater/grid'
import { CAPITAL_WEIGHT, POINT_RING_KM, quotas } from '@/sim/systems/defendPoints'
import { isLineUnit } from '@/sim/units/catalog'
import type { ArmyState, DefendPointKinds } from '@/sim/core/types'

let theater: TheaterData
const readPublic = async (p: string): Promise<ArrayBuffer> => {
  const buf = fs.readFileSync(new URL(`../public/${p}`, import.meta.url))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

beforeAll(async () => {
  theater = await loadTheater('world', readPublic)
})

const ALL: DefendPointKinds = { cities: true, ports: true, bases: true, airfields: true }

/** La France en paix, et une armée de toutes ses brigades de ligne. */
function france(): { sim: Simulation; id: number; army: () => ArmyState } {
  const sim = Simulation.fromScenario(buildScenario('world-2026', 'FRA'), theater, 5, 'FRA')
  const line = [...sim.ctx.units.values()].filter((u) => u.owner === 'FRA' && isLineUnit(u.kind))
  const id = sim.createArmy(
    'Garnisons',
    line.map((u) => u.id),
  )
  return { sim, id, army: () => sim.ctx.armies.get(id) as ArmyState }
}

describe('mission « Défendre des points »', () => {
  it('répartition : une brigade par point, le reste au prorata du poids', () => {
    const pts = [
      { name: 'A', at: [0, 0] as [number, number], weight: 5 },
      { name: 'B', at: [0, 0] as [number, number], weight: 2 },
      { name: 'C', at: [0, 0] as [number, number], weight: 1 },
    ]
    expect(quotas(pts, 2)).toEqual([1, 1])
    expect(quotas(pts, 11)).toEqual([6, 3, 2])
    expect(quotas(pts, 0)).toEqual([])
  })

  it('tout le pays : la capitale d’abord, brigades réparties en anneau autour des points', () => {
    const { sim, id, army } = france()
    const ctx = sim.ctx
    expect(sim.defendPointsArmy(id, null, ALL)).toBe(null)
    const m = army().mission
    expect(m?.kind).toBe('defendPoints')
    if (m?.kind !== 'defendPoints') return
    expect(m.points[0]?.name).toBe('Paris')
    expect(m.points[0]?.weight).toBeGreaterThanOrEqual(CAPITAL_WEIGHT)
    const line = army().unitIds.map((u) => ctx.units.get(u)!)
    expect(m.points.reduce((s, p) => s + p.units, 0)).toBe(line.length)
    // Plus de brigades à Paris que dans n'importe quel autre point.
    expect(m.points.every((p) => p.units <= (m.points[0]?.units ?? 0))).toBe(true)
    for (const u of line) {
      expect(u.order.kind).toBe('front')
      const t = u.order.target
      if (!t) continue
      const near = m.points.some(
        (p) => distanceKm(t[0], t[1], p.at[0], p.at[1]) <= POINT_RING_KM + 1,
      )
      expect(near).toBe(true)
    }
    // Les brigades rejoignent leur point (garnison), sans riposte ni ligne de front.
    sim.step(24 * 10)
    const parisPost = line.filter((u) => {
      const t = u.order.target
      return t && distanceKm(t[0], t[1], 2.35, 48.86) < 20
    })
    expect(parisPost.length).toBe(m.points[0]?.units)
    expect(parisPost.some((u) => distanceKm(u.lon, u.lat, 2.35, 48.86) < 15)).toBe(true)
    expect(army().frontLine).toBeUndefined()
  })

  it('zone et types cochés ; erreurs ; retour à « Tenir » ; sauvegarde', async () => {
    const { sim, id, army } = france()
    expect(
      sim.defendPointsArmy(id, null, {
        ...ALL,
        cities: false,
        ports: false,
        bases: false,
        airfields: false,
      }),
    ).toContain('Cochez')
    // Ports seulement, dans un cercle autour de Nice.
    const zone = { center: [7.27, 43.7] as [number, number], km: 150 }
    expect(
      sim.defendPointsArmy(id, zone, {
        cities: false,
        ports: true,
        bases: false,
        airfields: false,
      }),
    ).toBe(null)
    const m = army().mission
    if (m?.kind !== 'defendPoints') throw new Error('mission absente')
    expect(m.points.length).toBeGreaterThan(0)
    for (const p of m.points)
      expect(distanceKm(p.at[0], p.at[1], 7.27, 43.7)).toBeLessThanOrEqual(150)
    expect(m.points.map((p) => p.name)).toContain('Nice')
    // Zone sans point.
    const empty = { center: [-30, 0] as [number, number], km: 50 }
    expect(sim.defendPointsArmy(id, empty, ALL)).toContain('Aucun point')
    const { parseSave, serializeSave } = await import('@/sim/core/save')
    const loaded = Simulation.fromSave(
      parseSave(serializeSave(sim.toSave())),
      buildScenario('world-2026', 'FRA'),
      theater,
    )
    expect(loaded.ctx.armies.get(id)?.mission?.kind).toBe('defendPoints')
    expect(sim.lineMissionArmy(id, 'hold')).toBe(null)
    expect(army().mission).toBeUndefined()
  })
})
