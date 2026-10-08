import fs from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { Simulation } from '@/sim/simulation'
import { buildScenario } from '@/sim/scenarios'
import { loadTheater } from '@/sim/theater/load'
import type { TheaterData } from '@/sim/theater/grid'
import { declareWar, relation, sameAlliance, sanctionFactor } from '@/sim/politics/politics'
import { dailyIncome } from '@/sim/economy/economy'

let theater: TheaterData
const readPublic = async (p: string): Promise<ArrayBuffer> => {
  const buf = fs.readFileSync(new URL(`../public/${p}`, import.meta.url))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

beforeAll(async () => {
  theater = await loadTheater('world', readPublic)
})

const newWorld = (player = 'BRA', seed = 7): Simulation =>
  Simulation.fromScenario(buildScenario('world-2026', player), theater, seed, player)

const hooks = { armyName: (c: string): string => `Armée (${c})` }

describe('économie nationale', () => {
  it('les revenus dépendent du pays entier, et suivent le territoire tenu', () => {
    const sim = newWorld()
    const ctx = sim.ctx
    const fra = dailyIncome(ctx, sim.scenario, 'FRA')
    const pol = dailyIncome(ctx, sim.scenario, 'POL')
    // La France, plus riche, produit plus que la Pologne malgré peu de grandes villes.
    expect(fra.production).toBeGreaterThan(pol.production)
    expect(fra.manpower).toBeGreaterThan(2)

    // La moitié sud de la France passe à l'Espagne : la France perd, l'Espagne gagne un peu.
    const esp = dailyIncome(ctx, sim.scenario, 'ESP')
    const g = ctx.grid
    const fr = sim.sideOf('FRA')
    for (let i = 0; i < g.size; i++) {
      if (g.owner[i] === fr && g.latOf(i) < 46 && g.lonOf(i) > -5 && g.lonOf(i) < 8) {
        g.owner[i] = sim.sideOf('ESP')
      }
    }
    ctx.tick++
    const fraAfter = dailyIncome(ctx, sim.scenario, 'FRA')
    const espAfter = dailyIncome(ctx, sim.scenario, 'ESP')
    expect(fraAfter.production).toBeLessThan(fra.production * 0.8)
    expect(espAfter.production).toBeGreaterThan(esp.production)
    // L'occupant ne récupère qu'une partie de ce que perd le pays occupé.
    expect(espAfter.production - esp.production).toBeLessThan(fra.production - fraAfter.production)
  })
})

describe('liens politiques de départ', () => {
  it('organisations régionales et affinités rapprochent leurs membres', () => {
    const sim = newWorld()
    const ctx = sim.ctx
    expect(ctx.politics.organizations.find((o) => o.id === 'ue')?.members).toContain('FRA')
    expect(ctx.politics.organizations.find((o) => o.id === 'ua')?.members.length).toBeGreaterThan(
      40,
    )
    expect(relation(ctx, 'EGY', 'SAU')).toBeGreaterThan(10)
    expect(relation(ctx, 'FRA', 'SEN')).toBeGreaterThan(0)
    // Les tensions fixées par le scénario l'emportent sur les organisations communes.
    expect(relation(ctx, 'IND', 'PAK')).toBeLessThan(-40)
  })

  it('un pacte de défense fait entrer les États-Unis en guerre pour le Japon', () => {
    const sim = newWorld()
    const ctx = sim.ctx
    expect(sameAlliance(ctx, 'USA', 'JPN')).toBe(true)
    expect(sameAlliance(ctx, 'USA', 'FRA')).toBe(true)
    expect(declareWar(ctx, 'CHN', 'JPN', hooks)).toBe(null)
    const war = ctx.politics.wars.at(-1)
    expect(war?.defenders).toContain('USA')
  })

  it('les sanctions occidentales pèsent sur la Russie selon le poids économique des sanctionneurs', () => {
    const sim = newWorld()
    const f = sanctionFactor(sim.ctx, 'RUS')
    expect(f).toBeGreaterThan(0.6)
    expect(f).toBeLessThan(0.85)
    expect(sanctionFactor(sim.ctx, 'FRA')).toBe(1)
  })
})

describe('armées du temps de paix', () => {
  it("l'IA reconstitue son armée en paix", () => {
    const sim = newWorld('BRA')
    const french = [...sim.ctx.units.values()].filter((u) => u.owner === 'FRA')
    for (const u of french.slice(0, 6)) sim.ctx.units.delete(u.id)
    const count = (): number => [...sim.ctx.units.values()].filter((u) => u.owner === 'FRA').length
    const before = count()
    sim.step(24 * 40)
    expect(count()).toBeGreaterThan(before)
  })
})
