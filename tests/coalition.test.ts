import fs from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { Simulation } from '@/sim/simulation'
import { buildScenario } from '@/sim/scenarios'
import { loadTheater } from '@/sim/theater/load'
import type { TheaterData } from '@/sim/theater/grid'
import { sideIndex } from '@/sim/context'
import {
  isAtWarWith,
  makePeace,
  relation,
  sameAlliance,
  setRelation,
} from '@/sim/politics/politics'
import {
  ASK_COOLDOWN_TICKS,
  hasPassage,
  JOIN_THRESHOLD,
  joinAnswer,
  passageAnswer,
  updatePassages,
} from '@/sim/politics/coalition'
import { parseSave, serializeSave } from '@/sim/core/save'

let theater: TheaterData
const readPublic = async (p: string): Promise<ArrayBuffer> => {
  const buf = fs.readFileSync(new URL(`../public/${p}`, import.meta.url))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

beforeAll(async () => {
  theater = await loadTheater('world', readPublic)
})

/** La France en guerre contre la Suisse, relations remises à zéro avec les pays testés. */
const scenario = () => buildScenario('world-2026', 'FRA')

function franceAtWar(): Simulation {
  const sim = Simulation.fromScenario(scenario(), theater, 5, 'FRA')
  expect(sim.declareWar('CHE')).toBe(null)
  return sim
}

describe('coalition', () => {
  it('un allié accepte de participer selon son score, et rejoint la guerre', () => {
    const sim = franceAtWar()
    const ctx = sim.ctx
    expect(sameAlliance(ctx, 'FRA', 'DEU')).toBe(true)
    setRelation(ctx, 'DEU', 'FRA', 80)
    setRelation(ctx, 'DEU', 'CHE', -50)
    const a = joinAnswer(ctx, 'DEU', 'FRA')
    expect(a.veto).toBe(null)
    expect(a.score).toBeGreaterThanOrEqual(JOIN_THRESHOLD)
    expect(a.factors.map((f) => f.label)).toContain('alliance')
    expect(sim.askToJoin('DEU')).toContain('entre en guerre à vos côtés')
    expect(isAtWarWith(ctx, 'DEU', 'CHE')).toBe(true)
    expect(ctx.matrix.friendly(sideIndex(ctx, 'DEU'), sideIndex(ctx, 'FRA'))).toBe(true)
    expect(joinAnswer(ctx, 'DEU', 'FRA').veto).toBe('déjà à vos côtés')
  })

  it('un refus bloque une nouvelle demande pendant un mois', () => {
    const sim = franceAtWar()
    const ctx = sim.ctx
    setRelation(ctx, 'DEU', 'FRA', -20)
    setRelation(ctx, 'DEU', 'CHE', 0)
    const first = sim.askToJoin('DEU')
    expect(first).toContain('refuse')
    expect(first).toContain('score')
    expect(sim.askToJoin('DEU')).toContain('nouvelle demande dans 30 jours')
    ctx.tick += ASK_COOLDOWN_TICKS
    expect(sim.askToJoin('DEU')).not.toContain('nouvelle demande')
    // Un pays non allié ne peut pas être appelé.
    expect(joinAnswer(ctx, 'BRA', 'FRA').veto).toBe("ce pays n'est pas votre allié")
  })

  it('droit de passage : territoire ouvert, puis fermé à la paix et unités rapatriées', () => {
    const sim = franceAtWar()
    const ctx = sim.ctx
    const fra = sideIndex(ctx, 'FRA')
    const aut = sideIndex(ctx, 'AUT')
    setRelation(ctx, 'AUT', 'FRA', 60)
    setRelation(ctx, 'AUT', 'CHE', 0)
    expect(ctx.matrix.canEnter(fra, aut)).toBe(false)
    const before = relation(ctx, 'CHE', 'AUT')
    expect(sim.askPassage('AUT')).toContain('vous accorde le droit de passage')
    expect(hasPassage(ctx, 'FRA', 'AUT')).toBe(true)
    expect(ctx.matrix.canEnter(fra, aut)).toBe(true)
    // Un seul sens : l'Autriche ne gagne pas le passage en France.
    expect(ctx.matrix.canEnter(aut, fra)).toBe(false)
    expect(relation(ctx, 'CHE', 'AUT')).toBe(before - 10)
    expect(passageAnswer(ctx, 'AUT', 'FRA').veto).toBe('passage déjà accordé')

    // Une brigade française en Autriche.
    const g = ctx.grid
    const u = [...ctx.units.values()].find((x) => x.owner === 'FRA' && x.kind === 'inf')!
    let cell = -1
    for (let i = 0; i < g.size && cell < 0; i++) if (g.owner[i] === aut && g.passable(i)) cell = i
    ;[u.lon, u.lat] = [g.lonOf(cell), g.latOf(cell)]
    u.path = []

    const war = ctx.politics.wars.find((w) => w.attackers.includes('FRA'))!
    makePeace(ctx, war.id, 'FRA', 'white')
    updatePassages(ctx)
    expect(hasPassage(ctx, 'FRA', 'AUT')).toBe(false)
    expect(ctx.matrix.canEnter(fra, aut)).toBe(false)
    // Rapatriée : en route vers la France, ou déjà dessus.
    const home = g.owner[g.cellAt(u.lon, u.lat)] === fra
    expect(home || u.order.kind === 'retreat').toBe(true)
  })

  it('refus sans appel : ami de l’ennemi ; le passage est gardé dans la sauvegarde', () => {
    const sim = franceAtWar()
    const ctx = sim.ctx
    setRelation(ctx, 'ITA', 'CHE', 60)
    expect(passageAnswer(ctx, 'ITA', 'FRA').veto).toBe('trop proche de Suisse')
    setRelation(ctx, 'AUT', 'FRA', 60)
    setRelation(ctx, 'AUT', 'CHE', 0)
    sim.askPassage('AUT')
    const loaded = Simulation.fromSave(parseSave(serializeSave(sim.toSave())), scenario(), theater)
    expect(hasPassage(loaded.ctx, 'FRA', 'AUT')).toBe(true)
    expect(
      loaded.ctx.matrix.canEnter(sideIndex(loaded.ctx, 'FRA'), sideIndex(loaded.ctx, 'AUT')),
    ).toBe(true)
  })
})
