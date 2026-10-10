import fs from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadTheater } from '@/sim/theater/load'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { frontCells } from '@/sim/systems/armies'
import { missionKind } from '@/sim/systems/missions'
import { distanceKm, type TheaterData } from '@/sim/theater/grid'
import type { ArmyState, LonLat, UnitSnapshot } from '@/sim/core/types'
import { isLineUnit } from '@/sim/units/catalog'
import { breachAxis, encircleRing } from '@/map/missionPreview'
import { MISSION_GROUPS, isLineMission, missionAction } from '@/composables/missions'

const readPublic = async (p: string): Promise<ArrayBuffer> => {
  const buf = fs.readFileSync(new URL(`../public/${p}`, import.meta.url))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

let theater: TheaterData
beforeAll(async () => {
  theater = await loadTheater('ukraine', readPublic)
})

function setup(): { sim: Simulation; army: ArmyState } {
  const sim = Simulation.fromScenario(ukraine2026, theater, 7)
  const army = [...sim.ctx.armies.values()].find((a) => a.owner === 'UKR' && a.wholeFront)
  if (!army) throw new Error('armée introuvable')
  return { sim, army }
}

/** Distance (km) d'un point à la cellule de front la plus proche de l'armée. */
function depthOf(sim: Simulation, army: ArmyState, p: LonLat): number {
  const ctx = sim.ctx
  return Math.min(
    ...frontCells(ctx, sim.sideOf(army.owner), null).map((c) =>
      distanceKm(p[0], p[1], ctx.grid.lonOf(c.cell), ctx.grid.latOf(c.cell)),
    ),
  )
}

describe('aperçu des missions de ligne', () => {
  it('ne change rien à la partie', () => {
    const { sim, army } = setup()
    const orders = army.unitIds.map((id) => JSON.stringify(sim.ctx.units.get(id)?.order))
    for (const kind of ['hold', 'keyPoints', 'depth', 'reserve'] as const) {
      sim.missionPreview(army.id, kind)
    }
    expect(missionKind(army)).toBe('hold')
    expect(army.keyPoints).toBeUndefined()
    expect(army.unitIds.map((id) => JSON.stringify(sim.ctx.units.get(id)?.order))).toEqual(orders)
  })

  it('un poste par unité de ligne, seconde ligne à 25 km, réserve à 40 km, points clés', () => {
    const { sim, army } = setup()
    const line = army.unitIds.filter((id) => {
      const u = sim.ctx.units.get(id)
      return !!u && isLineUnit(u.kind)
    }).length
    const hold = sim.missionPreview(army.id, 'hold')
    expect(hold.posts.length).toBe(line)
    expect(hold.lines).toEqual([])

    const depth = sim.missionPreview(army.id, 'depth')
    expect(depth.posts.length).toBe(line)
    expect(depth.lines.length).toBeGreaterThan(0)
    const rear = depth.posts.filter((p) => depthOf(sim, army, p) >= 15).length / line
    expect(rear).toBeGreaterThan(0.25)
    expect(rear).toBeLessThan(0.5)
    // La seconde ligne tracée court en retrait du front.
    const pts = depth.lines.flat()
    const mean = pts.reduce((s, p) => s + depthOf(sim, army, p), 0) / pts.length
    expect(mean).toBeGreaterThan(12)

    const reserve = sim.missionPreview(army.id, 'reserve')
    const far = reserve.posts.filter((p) => depthOf(sim, army, p) >= 20).length / line
    expect(far).toBeGreaterThan(0.6)
    expect(reserve.lines.length).toBeGreaterThan(0)

    const key = sim.missionPreview(army.id, 'keyPoints')
    expect(key.points.length).toBeGreaterThan(0)
    expect(key.posts.length).toBe(line)
  })

  it('armée sans front : aperçu vide', () => {
    const { sim, army } = setup()
    sim.setArmyFront(army.id, null)
    expect(sim.missionPreview(army.id, 'depth')).toEqual({ posts: [], lines: [], points: [] })
  })
})

describe('aperçus pendant la visée', () => {
  it('axe de percée depuis le point du front le plus proche', () => {
    const front: LonLat[][] = [
      [
        [30, 50],
        [31, 50],
        [32, 50],
      ],
    ]
    expect(breachAxis(front, null, [31.1, 50.5])).toEqual([
      [31, 50],
      [31.1, 50.5],
    ])
    expect(breachAxis(undefined, [29, 49], [31, 50])?.[0]).toEqual([29, 49])
    expect(breachAxis(undefined, null, [31, 50])).toBeNull()
  })

  it('anneau autour du groupe ennemi survolé', () => {
    const unit = (id: number, owner: string, lon: number, lat: number): UnitSnapshot =>
      ({ id, owner, lon, lat }) as UnitSnapshot
    const units = [unit(1, 'RUS', 36, 50), unit(2, 'RUS', 36.1, 50), unit(3, 'UKR', 35.5, 50)]
    const enemy = (o: string): boolean => o === 'RUS'
    const ring = encircleRing(units, enemy, [36.02, 50.01])
    expect(ring).not.toBeNull()
    const r = ring as LonLat[]
    // Rayon : 20 km au moins autour du centre du groupe (36,05 ; 50).
    for (const p of r) expect(distanceKm(p[0], p[1], 36.05, 50)).toBeGreaterThan(19)
    expect(encircleRing(units, enemy, [34, 50])).toBeNull()
  })
})

describe("cartes de mission de l'onglet Ordre", () => {
  it('huit missions en trois groupes, action selon la mission', () => {
    expect(MISSION_GROUPS.map((g) => g.label)).toEqual(['Défendre', 'Attaquer', 'Reculer'])
    expect(MISSION_GROUPS.flatMap((g) => g.kinds)).toHaveLength(8)
    expect(missionAction('hold', 'hold').kind).toBe('current')
    expect(missionAction('depth', 'hold')).toEqual({ kind: 'apply', label: 'Appliquer' })
    expect(missionAction('breach', 'hold').kind).toBe('aim')
    expect(isLineMission('reserve')).toBe(true)
    expect(isLineMission('retreat')).toBe(false)
  })
})

describe("onglet « Composition » d'une armée", () => {
  it('compte les unités par type avec leur force moyenne', async () => {
    const { armyComposition, strengthTone } = await import('@/composables/composition')
    const rows = armyComposition([
      { kind: 'inf', strength: 1, org: 0.8 },
      { kind: 'inf', strength: 0.6, org: 0.4 },
      { kind: 'tank', strength: 0.4, org: 1 },
    ])
    expect(rows.map((r) => [r.kind, r.count])).toEqual([
      ['inf', 2],
      ['tank', 1],
    ])
    expect(rows[0]?.strength).toBeCloseTo(0.8)
    expect(rows[0]?.org).toBeCloseTo(0.6)
    expect(strengthTone(0.8)).toBe('ok')
    expect(strengthTone(0.6)).toBe('warn')
    expect(strengthTone(0.4)).toBe('bad')
  })
})
