import fs from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { Simulation } from '@/sim/simulation'
import { buildScenario } from '@/sim/scenarios'
import { loadTheater } from '@/sim/theater/load'
import type { TheaterData } from '@/sim/theater/grid'
import { relation } from '@/sim/politics/politics'
import { parseSave, serializeSave } from '@/sim/core/save'
import type { ScenarioOptions } from '@/sim/core/types'

let theater: TheaterData
const readPublic = async (p: string): Promise<ArrayBuffer> => {
  const buf = fs.readFileSync(new URL(`../public/${p}`, import.meta.url))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

beforeAll(async () => {
  theater = await loadTheater('world', readPublic)
})

const newWorld = (options?: ScenarioOptions, player = 'FRA'): Simulation =>
  Simulation.fromScenario(buildScenario('world-2026', player, options), theater, 3, player)

describe("options de l'écran de départ", () => {
  it('sans affiliations : ni alliances, ni organisations, ni relations, sanctions ou aides', () => {
    const sim = newWorld({ noAffiliations: true })
    const p = sim.ctx.politics
    expect(p.alliances).toHaveLength(0)
    expect(p.organizations).toHaveLength(0)
    expect(p.sanctions.size).toBe(0)
    expect(p.aids).toHaveLength(0)
    // Relations neutres, sauf entre belligérants : la guerre du scénario reste en place.
    expect(relation(sim.ctx, 'FRA', 'DEU')).toBe(0)
    expect(relation(sim.ctx, 'USA', 'RUS')).toBe(0)
    expect(relation(sim.ctx, 'FRA', 'BEL')).toBe(0)
    expect(p.wars).toHaveLength(1)
    expect(sim.ctx.matrix.atWar[sim.sideOf('RUS')]).toBe(1)
    // Partie normale pour comparaison.
    const normal = newWorld()
    expect(normal.ctx.politics.alliances.length).toBeGreaterThan(0)
    expect(relation(normal.ctx, 'FRA', 'DEU')).toBeGreaterThan(0)
  })

  it('sans guerres : tout le monde en paix, armées en garnison, liens politiques conservés', () => {
    const sim = newWorld({ noWars: true })
    const p = sim.ctx.politics
    expect(p.wars).toHaveLength(0)
    expect(sim.ctx.matrix.atWar[sim.sideOf('RUS')]).toBe(0)
    expect(sim.ctx.matrix.atWar[sim.sideOf('UKR')]).toBe(0)
    // Les deux pays ont leur armée du temps de paix.
    const owners = new Set([...sim.ctx.units.values()].map((u) => u.owner))
    expect(owners.has('RUS')).toBe(true)
    expect(owners.has('UKR')).toBe(true)
    expect(p.alliances.length).toBeGreaterThan(0)
    expect(p.sanctions.size).toBeGreaterThan(0)
    // Quelques jours de jeu sans qu'une guerre n'éclate d'elle-même entre ces deux-là.
    sim.step(24 * 3)
    expect(sim.ctx.matrix.atWar[sim.sideOf('UKR')]).toBe(0)
  })

  it('les deux options se cumulent et sont gardées dans la sauvegarde', () => {
    const sim = newWorld({ noAffiliations: true, noWars: true })
    expect(sim.ctx.politics.wars).toHaveLength(0)
    expect(sim.ctx.politics.alliances).toHaveLength(0)
    const save = parseSave(serializeSave(sim.toSave()))
    expect(save.options).toEqual({ noAffiliations: true, noWars: true })
    const loaded = Simulation.fromSave(
      save,
      buildScenario(save.scenarioId, save.playerCountry, save.options),
      theater,
    )
    expect(loaded.scenario.options).toEqual({ noAffiliations: true, noWars: true })
    expect(loaded.ctx.politics.organizations).toHaveLength(0)
    expect(loaded.ctx.politics.wars).toHaveLength(0)
  })

  it('une partie sans option ne porte aucune option ; une option non proposée est ignorée', () => {
    expect(newWorld().toSave().options).toBeUndefined()
    expect(newWorld({}).scenario.options).toBeUndefined()
    // Le théâtre ukrainien ne propose pas « Sans guerres de départ ».
    const ukr = buildScenario('ukraine-2026', 'UKR', { noWars: true, noAffiliations: true })
    expect(ukr.options).toEqual({ noAffiliations: true })
    expect(ukr.politics?.wars).toHaveLength(1)
    expect(ukr.politics?.aids).toHaveLength(0)
  })
})
