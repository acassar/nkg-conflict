import fs from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { Simulation } from '@/sim/simulation'
import { buildScenario } from '@/sim/scenarios'
import { loadTheater } from '@/sim/theater/load'
import type { TheaterData } from '@/sim/theater/grid'
import { sideIndex } from '@/sim/context'
import { declareWar, setRelation, type PoliticsHooks } from '@/sim/politics/politics'
import { hasPassage } from '@/sim/politics/coalition'
import { computeNeighbors } from '@/sim/politics/ai'
import { adoptOrphans, updateExpeditionAi } from '@/sim/systems/aiExpedition'
import { frontCells } from '@/sim/systems/armies'

let theater: TheaterData
const readPublic = async (p: string): Promise<ArrayBuffer> => {
  const buf = fs.readFileSync(new URL(`../public/${p}`, import.meta.url))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

beforeAll(async () => {
  theater = await loadTheater('world', readPublic)
})

const hooks: PoliticsHooks = { armyName: (c) => `Armée (${c})` }

/** Partie mondiale (joueur : France) où deux IA sans frontière commune entrent en guerre. */
function remoteWar(attacker: string, target: string): Simulation {
  const sim = Simulation.fromScenario(buildScenario('world-2026', 'FRA'), theater, 5, 'FRA')
  expect(declareWar(sim.ctx, attacker, target, hooks)).toBe(null)
  expect(frontCells(sim.ctx, sideIndex(sim.ctx, attacker), null)).toHaveLength(0)
  return sim
}

describe('IA de guerre à distance', () => {
  it('demande le passage à un voisin de l’ennemi, y transporte un corps expéditionnaire puis attaque', () => {
    // Serbie contre Moldavie : la Roumanie les sépare.
    const sim = remoteWar('SRB', 'MDA')
    const ctx = sim.ctx
    setRelation(ctx, 'ROU', 'SRB', 80)
    setRelation(ctx, 'ROU', 'MDA', 0)
    const neighbors = computeNeighbors(ctx)
    expect(updateExpeditionAi(ctx, 'SRB', 'FRA', hooks, neighbors)).toBe('transport')
    expect(hasPassage(ctx, 'SRB', 'ROU')).toBe(true)
    const sent = ctx.sea.filter((t) => t.unit.owner === 'SRB')
    expect(sent.length).toBeGreaterThan(0)
    expect(sent.every((t) => t.mode === 'rail')).toBe(true)
    // Pendant le trajet, rien de plus.
    expect(updateExpeditionAi(ctx, 'SRB', 'FRA', hooks, neighbors)).toBe('en route')

    // Arrivée : les brigades rejoignent l'armée et attaquent la Moldavie.
    const last = Math.max(...sent.map((t) => t.arriveTick))
    sim.step(last - ctx.tick + 1)
    expect(ctx.sea.filter((t) => t.unit.owner === 'SRB')).toHaveLength(0)
    adoptOrphans(ctx, 'SRB')
    const ids = new Set(sent.map((t) => t.unit.id))
    const arrived = [...ctx.units.values()].filter((u) => ids.has(u.id))
    expect(arrived.every((u) => u.armyId !== null)).toBe(true)
    const step = updateExpeditionAi(ctx, 'SRB', 'FRA', hooks, neighbors)
    if (step !== 'front') {
      expect(step).toBe('attaque')
      expect(arrived.some((u) => u.order.kind === 'attack')).toBe(true)
    }
  })

  it('le corps expéditionnaire prend du terrain depuis le pays de transit, et un front se forme', () => {
    const sim = remoteWar('SRB', 'MDA')
    const ctx = sim.ctx
    setRelation(ctx, 'ROU', 'SRB', 80)
    setRelation(ctx, 'ROU', 'MDA', 0)
    const mda = sideIndex(ctx, 'MDA')
    const before = ctx.grid.countOwned(mda)
    // Jour par jour : l'IA peut signer la paix avant la fin des dix jours (le front disparaît alors).
    let front = 0
    for (let d = 0; d < 10; d++) {
      sim.step(24)
      front = Math.max(front, frontCells(ctx, sideIndex(ctx, 'SRB'), null).length)
    }
    expect(ctx.grid.countOwned(mda)).toBeLessThan(before)
    expect(front).toBeGreaterThan(0)
  })

  it('sans route terrestre, amène ses brigades au port puis débarque sur la côte ennemie', () => {
    // Japon contre Corée du Sud : la mer seulement (la Corée du Nord refuse le passage).
    const sim = remoteWar('JPN', 'KOR')
    const ctx = sim.ctx
    setRelation(ctx, 'PRK', 'JPN', -80)
    const neighbors = computeNeighbors(ctx)
    const first = updateExpeditionAi(ctx, 'JPN', 'FRA', hooks, neighbors)
    expect(['débarquement', 'vers le port']).toContain(first)
    expect(hasPassage(ctx, 'JPN', 'PRK')).toBe(false)
    if (first === 'vers le port') {
      const moving = ctx.sea.filter((t) => t.unit.owner === 'JPN')
      expect(moving.length).toBeGreaterThan(0)
      const last = Math.max(...moving.map((t) => t.arriveTick))
      sim.step(last - ctx.tick + 1)
      expect(updateExpeditionAi(ctx, 'JPN', 'FRA', hooks, neighbors)).toBe('débarquement')
    }
    const landing = ctx.sea.filter((t) => t.unit.owner === 'JPN' && !t.mode)
    expect(landing.length).toBeGreaterThan(0)
    // Côte visée : coréenne.
    const kor = sideIndex(ctx, 'KOR')
    for (const t of landing) expect(ctx.grid.owner[ctx.grid.cellAt(t.to[0], t.to[1])]).toBe(kor)
  })

  it('n’engage jamais le joueur : ni appel à la guerre, ni demande de passage', () => {
    // Maroc contre Italie : la France (joueur) est voisine de l'Italie.
    const sim = remoteWar('MAR', 'ITA')
    const ctx = sim.ctx
    setRelation(ctx, 'FRA', 'MAR', 90)
    setRelation(ctx, 'FRA', 'ITA', -40)
    const neighbors = computeNeighbors(ctx)
    updateExpeditionAi(ctx, 'MAR', 'FRA', hooks, neighbors)
    expect(hasPassage(ctx, 'MAR', 'FRA')).toBe(false)
    expect(ctx.politics.wars.every((w) => !w.attackers.includes('FRA'))).toBe(true)
  })
})
