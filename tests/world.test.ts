import fs from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { Simulation } from '@/sim/simulation'
import { buildScenario } from '@/sim/scenarios'
import { loadTheater } from '@/sim/theater/load'
import type { TheaterData } from '@/sim/theater/grid'
import { relation } from '@/sim/politics/politics'
import { parseSave, serializeSave } from '@/sim/core/save'

let theater: TheaterData
const readPublic = async (p: string): Promise<ArrayBuffer> => {
  const buf = fs.readFileSync(new URL(`../public/${p}`, import.meta.url))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

beforeAll(async () => {
  theater = await loadTheater('world', readPublic)
})

const newWorld = (player = 'FRA', seed = 5): Simulation =>
  Simulation.fromScenario(buildScenario('world-2026', player), theater, seed, player)

describe('monde', () => {
  it('charge tous les pays et place Paris en France', () => {
    const sim = newWorld()
    const g = sim.ctx.grid
    expect(sim.ctx.countries.size).toBeGreaterThan(200)
    expect(g.owner[g.cellAt(2.35, 48.86)]).toBe(sim.sideOf('FRA'))
  })

  it('ne mobilise au départ que les pays en guerre', () => {
    const sim = newWorld()
    const owners = new Set([...sim.ctx.units.values()].map((u) => u.owner))
    expect([...owners].sort()).toEqual(['RUS', 'UKR'])
  })

  it('ferme les frontières des pays en paix', () => {
    const sim = newWorld()
    const path = sim.ctx.pathfinder.find([2.35, 48.86], [13.4, 52.52], {
      side: sim.sideOf('FRA'),
      enemyCost: 2,
    })
    const g = sim.ctx.grid
    for (const [lon, lat] of path ?? []) {
      expect(g.owner[g.cellAt(lon, lat)]).not.toBe(sim.sideOf('DEU'))
    }
  })
})

describe('guerre et diplomatie', () => {
  it('une déclaration de guerre mobilise les deux pays et rend leurs unités hostiles', () => {
    const sim = newWorld('FRA')
    expect(sim.declareWar('CHE')).toBe(null)
    const owners = new Set([...sim.ctx.units.values()].map((u) => u.owner))
    expect(owners.has('FRA') && owners.has('CHE')).toBe(true)
    expect(sim.ctx.matrix.hostile(sim.sideOf('FRA'), sim.sideOf('CHE'))).toBe(true)
    expect(relation(sim.ctx, 'FRA', 'CHE')).toBe(-100)
  })

  it('les alliés d’un pays agressé entrent en guerre', () => {
    const sim = newWorld('BLR')
    expect(sim.declareWar('POL')).toBe(null)
    const war = sim.ctx.politics.wars.find((w) => w.attackers.includes('BLR'))
    expect(war?.defenders).toContain('DEU')
    expect(war?.defenders.length).toBeGreaterThan(5)
  })

  it('une paix blanche rend les territoires conquis', () => {
    const sim = newWorld('FRA')
    expect(sim.declareWar('CHE')).toBe(null)
    const g = sim.ctx.grid
    const geneva = g.cellAt(6.14, 46.2)
    const che = sim.sideOf('CHE')
    const fra = sim.sideOf('FRA')
    g.setOwner(geneva, fra)
    const war = sim.ctx.politics.wars.find((w) => w.attackers.includes('FRA'))
    if (!war) throw new Error('guerre absente')
    // On force l'acceptation : la Suisse est à bout.
    const chePol = sim.ctx.politics.countries.get('CHE')
    if (chePol) chePol.warSupport = 0.05
    expect(sim.proposePeace(war.id, 'white')).toBe(null)
    expect(g.owner[geneva]).toBe(che)
    expect(sim.ctx.matrix.hostile(fra, che)).toBe(false)
  })

  it('la prise de la capitale fait capituler un pays', () => {
    const sim = newWorld('FRA')
    sim.declareWar('CHE')
    const g = sim.ctx.grid
    // Berne passe sous contrôle français, sans défenseur pour la reprendre.
    for (const u of [...sim.ctx.units.values()]) if (u.owner === 'CHE') sim.ctx.units.delete(u.id)
    g.cellsWithin(7.45, 46.95, 15, (i) => g.setOwner(i, sim.sideOf('FRA')))
    sim.step(6)
    expect(sim.ctx.politics.wars.some((w) => w.defenders.includes('CHE'))).toBe(false)
  })

  it('refuse d’attaquer un allié', () => {
    const sim = newWorld('FRA')
    expect(sim.declareWar('BEL')).not.toBe(null)
  })

  it('une sauvegarde mondiale rechargée rejoue la même suite', () => {
    const scenario = buildScenario('world-2026', 'FRA')
    const a = newWorld('FRA', 11)
    a.step(30)
    const b = Simulation.fromSave(parseSave(serializeSave(a.toSave())), scenario, theater)
    a.step(48)
    b.step(48)
    const pos = (s: Simulation): string =>
      JSON.stringify(
        [...s.ctx.units.values()].map((u) => [u.id, u.lon.toFixed(5), u.org.toFixed(5)]),
      )
    expect(pos(b)).toBe(pos(a))
  })
})
