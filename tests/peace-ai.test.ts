import fs from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { Simulation } from '@/sim/simulation'
import { buildScenario } from '@/sim/scenarios'
import { loadTheater } from '@/sim/theater/load'
import type { TheaterData } from '@/sim/theater/grid'
import { sideIndex } from '@/sim/context'
import { declareWar, makePeace, setRelation, type PoliticsHooks } from '@/sim/politics/politics'
import { computeNeighbors } from '@/sim/politics/ai'
import { foreignNeighbors } from '@/sim/systems/frontiers'
import { tenseNeighbors, updatePeaceAi } from '@/sim/systems/peaceAi'

let theater: TheaterData
const readPublic = async (p: string): Promise<ArrayBuffer> => {
  const buf = fs.readFileSync(new URL(`../public/${p}`, import.meta.url))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

beforeAll(async () => {
  theater = await loadTheater('world', readPublic)
})

describe('IA de paix', () => {
  it('frontière tendue couverte, points défendus ailleurs ; fusion à la guerre, garnison sans tension', () => {
    const sim = Simulation.fromScenario(buildScenario('world-2026', 'FRA'), theater, 5, 'FRA')
    const ctx = sim.ctx
    const neighbors = computeNeighbors(ctx)
    const pol = sideIndex(ctx, 'POL')
    const blr = sideIndex(ctx, 'BLR')
    expect(ctx.matrix.atWar[pol]).not.toBe(1)
    setRelation(ctx, 'POL', 'BLR', -100)
    expect(tenseNeighbors(ctx, 'POL', neighbors)).toContain('BLR')
    // Armée principale (la première) : l'IA en détache la garde des frontières ; les autres armées de
    // l'ordre de bataille restent en garnison.
    const total =
      [...ctx.armies.values()].find((a) => a.owner === 'POL' && a.wholeFront)?.unitIds.length ?? 0
    ctx.tick = 0
    updatePeaceAi(ctx, 'POL', neighbors)
    const armies = () => [...ctx.armies.values()].filter((a) => a.owner === 'POL')
    const guard = armies().find((a) => a.aiPeace === 'border')!
    const main = armies().find((a) => a.aiPeace === 'points')!
    expect(guard).toBeDefined()
    expect(main?.mission?.kind).toBe('defendPoints')
    expect(guard.border!.length).toBeGreaterThan(10)
    // Seules les frontières tendues (la Biélorussie, et la Russie déjà hostile) sont tenues.
    const tense = tenseNeighbors(ctx, 'POL', neighbors).map((c) => sideIndex(ctx, c))
    for (const c of guard.border!) {
      expect(foreignNeighbors(ctx.grid, pol, c).some((o) => tense.includes(o))).toBe(true)
    }
    expect(guard.border!.some((c) => foreignNeighbors(ctx.grid, pol, c).includes(blr))).toBe(true)
    expect(guard.unitIds.length).toBeGreaterThan(0)
    expect(guard.unitIds.length + main.unitIds.length).toBe(total)
    for (const id of guard.unitIds) {
      const u = ctx.units.get(id)!
      expect(u.armyId).toBe(guard.id)
      expect(u.posture).toBe('defensive')
      expect(u.order.kind).toBe('front')
    }
    expect(sim.snapshot().events.some((e) => e.text.includes('couvre sa frontière'))).toBe(true)
    // Rien de nouveau au réexamen suivant.
    ctx.tick = 7 * 24
    updatePeaceAi(ctx, 'POL', neighbors)
    expect(armies().filter((a) => a.aiPeace === 'border')).toHaveLength(1)

    // Guerre : l'armée des frontières rejoint l'armée principale, qui reprend tout le front.
    expect(declareWar(ctx, 'BLR', 'POL', (sim as unknown as { hooks: PoliticsHooks }).hooks)).toBe(
      null,
    )
    ctx.tick = 7 * 24 + 1
    updatePeaceAi(ctx, 'POL', neighbors)
    expect(armies().some((a) => a.aiPeace)).toBe(false)
    expect(ctx.armies.has(guard.id)).toBe(false)
    expect(main.unitIds.length).toBe(total)
    expect(main.wholeFront).toBe(true)
    expect(main.mission).toBeUndefined()

    // Paix revenue et tension apaisée : garnison.
    const war = ctx.politics.wars.find((w) => w.defenders.includes('POL'))!
    makePeace(ctx, war.id, 'POL', 'white')
    for (const n of neighbors.get('POL') ?? []) setRelation(ctx, 'POL', n, 0)
    expect(tenseNeighbors(ctx, 'POL', neighbors)).toEqual([])
    ctx.tick = 14 * 24
    updatePeaceAi(ctx, 'POL', neighbors)
    expect(armies().some((a) => a.aiPeace)).toBe(false)
  })
})
