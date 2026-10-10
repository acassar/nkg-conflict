import fs from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { loadTheater } from '@/sim/theater/load'
import { distanceKm, type TheaterData } from '@/sim/theater/grid'
import { parseSave, serializeSave } from '@/sim/core/save'
import { frontCells } from '@/sim/systems/armies'
import { KEY_CITY, KEY_CROSSING, KEY_NODE, keyPointKinds } from '@/sim/systems/axes'
import { missionKind } from '@/sim/systems/missions'
import type { ArmyState } from '@/sim/core/types'
import { isLineUnit } from '@/sim/units/catalog'

const readPublic = async (p: string): Promise<ArrayBuffer> => {
  const buf = fs.readFileSync(new URL(`../public/${p}`, import.meta.url))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

let theater: TheaterData
beforeAll(async () => {
  theater = await loadTheater('ukraine', readPublic)
})

function biggestArmy(sim: Simulation, owner: string): ArmyState {
  const army = [...sim.ctx.armies.values()]
    .filter((a) => a.owner === owner && (a.front || a.wholeFront))
    .sort((a, b) => b.unitIds.length - a.unitIds.length)[0]
  if (!army) throw new Error(`pas d’armée pour ${owner}`)
  return army
}

/**
 * Part des postes de ligne de l'armée qui tiennent un point clé : cellule de front à point clé à moins
 * de 15 km (le poste est placé deux cellules derrière le contact).
 */
function keyShare(sim: Simulation, army: ArmyState): { posts: number; share: number } {
  const ctx = sim.ctx
  const { grid } = ctx
  const keys = frontCells(ctx, sim.sideOf(army.owner), army.wholeFront ? null : army.front)
    .filter((c) => keyPointKinds(ctx, c.cell) !== 0)
    .map((c) => [grid.lonOf(c.cell), grid.latOf(c.cell)] as const)
  let posts = 0
  let onKey = 0
  for (const id of army.unitIds) {
    const u = ctx.units.get(id)
    const t = u?.order.target
    if (!u || !isLineUnit(u.kind) || u.order.kind !== 'front' || !t) continue
    posts++
    if (keys.some((k) => distanceKm(t[0], t[1], k[0], k[1]) <= 15)) onKey++
  }
  return { posts, share: posts ? onKey / posts : 0 }
}

describe('mission « Tenir les points clés »', () => {
  it('repère villes, passages de fleuve et nœuds routiers', () => {
    const sim = Simulation.fromScenario(ukraine2026, theater, 7)
    const ctx = sim.ctx
    // Kharkiv : ville et nœud routier.
    const kharkiv = keyPointKinds(ctx, ctx.grid.cellAt(36.23, 49.99))
    expect(kharkiv & KEY_CITY).toBeTruthy()
    expect(kharkiv & KEY_NODE).toBeTruthy()
    // Les ponts de Kiev sur le Dniepr.
    let crossing = false
    ctx.grid.cellsWithin(30.55, 50.45, 15, (i) => {
      if (keyPointKinds(ctx, i) & KEY_CROSSING) crossing = true
    })
    expect(crossing).toBe(true)
    // Pleine mer : rien.
    expect(keyPointKinds(ctx, ctx.grid.cellAt(31, 45.5))).toBe(0)
  })

  it('concentre les unités sur les points clés et les montre sur la carte', () => {
    const sim = Simulation.fromScenario(ukraine2026, theater, 7)
    const ctx = sim.ctx
    const army = biggestArmy(sim, 'UKR')
    const side = sim.sideOf('UKR')
    const cells = frontCells(ctx, side, army.wholeFront ? null : army.front)
    const onFront = cells.filter((c) => keyPointKinds(ctx, c.cell) !== 0).length / cells.length
    const before = keyShare(sim, army)

    expect(sim.lineMissionArmy(army.id, 'keyPoints')).toBeNull()
    expect(missionKind(army)).toBe('keyPoints')
    const after = keyShare(sim, army)
    expect(after.posts).toBeGreaterThan(5)
    // Nettement plus de postes sur les points clés qu'avec « Tenir », et bien plus que leur part du front.
    expect(after.share).toBeGreaterThan(before.share + 0.1)
    expect(after.share).toBeGreaterThan(onFront + 0.25)
    // Un écran reste ailleurs : quelques postes hors des points clés si le front en a.
    expect(army.keyPoints?.length ?? 0).toBeGreaterThan(0)

    // Retour à « Tenir » : répartition habituelle, plus de repères.
    sim.holdArmy(army.id)
    expect(missionKind(army)).toBe('hold')
    expect(army.keyPoints).toBeUndefined()
    expect(keyShare(sim, army).share).toBeLessThan(after.share)
  })

  it('reste active en jeu, en posture défensive et après une sauvegarde', () => {
    const sim = Simulation.fromScenario(ukraine2026, theater, 7)
    const army = biggestArmy(sim, 'UKR')
    sim.setArmyPosture(army.id, 'defensive')
    sim.lineMissionArmy(army.id, 'keyPoints')
    sim.step(48)
    expect(missionKind(army)).toBe('keyPoints')
    expect(keyShare(sim, army).share).toBeGreaterThan(0.5)
    const loaded = Simulation.fromSave(parseSave(serializeSave(sim.toSave())), ukraine2026, theater)
    const copy = loaded.ctx.armies.get(army.id)
    expect(copy?.mission?.kind).toBe('keyPoints')
  })
})
