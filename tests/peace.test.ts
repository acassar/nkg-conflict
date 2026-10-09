import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { sideIndex } from '@/sim/context'
import { makePeace } from '@/sim/politics/politics'
import { updateArmies } from '@/sim/systems/armies'
import type { PeaceKind } from '@/sim/politics/types'
import type { UnitState } from '@/sim/core/types'
import type { TheaterData } from '@/sim/theater/grid'

const theater = theaterJson as unknown as TheaterData
const newGame = (): Simulation => Simulation.fromScenario(ukraine2026, theater, 7)

const ownerAt = (sim: Simulation, u: UnitState): number =>
  sim.ctx.grid.owner[sim.ctx.grid.cellAt(u.lon, u.lat)] ?? 0
const atHome = (sim: Simulation, u: UnitState): boolean =>
  ownerAt(sim, u) === sideIndex(sim.ctx, u.owner)

/** Une brigade ukrainienne posée sur une position russe d'origine (restée russe après toute paix). */
function intruder(sim: Simulation): UnitState {
  const units = [...sim.ctx.units.values()]
  const rus = units.find((u) => u.owner === 'RUS' && atHome(sim, u))
  const ukr = units.find((u) => u.owner === 'UKR' && u.armyId !== null && u.kind === 'inf')
  if (!rus || !ukr) throw new Error('unités manquantes')
  ;[ukr.lon, ukr.lat] = [rus.lon, rus.lat]
  ukr.path = []
  return ukr
}

function peace(sim: Simulation, kind: PeaceKind): void {
  const war = sim.ctx.politics.wars[0]
  if (!war) throw new Error('pas de guerre')
  makePeace(sim.ctx, war.id, 'UKR', kind)
  expect(sim.ctx.politics.wars.length).toBe(0)
}

describe('évacuation après une paix', () => {
  for (const kind of ['white', 'lines'] as const) {
    it(`paix ${kind === 'white' ? 'blanche' : 'sur la ligne de front'} : repli vers son territoire, puis retour à l’armée`, () => {
      const sim = newGame()
      const u = intruder(sim)
      expect(atHome(sim, u)).toBe(false)
      peace(sim, kind)
      // Repli ordonné, hors de la répartition de l'armée.
      expect(u.order.kind).toBe('retreat')
      expect(u.path.length).toBeGreaterThan(0)
      expect(u.direct).toEqual({})
      updateArmies(sim.ctx)
      expect(u.order.kind).toBe('retreat')
      let hours = 0
      while (u.order.kind === 'retreat' && hours < 24 * 10) {
        sim.step(1)
        hours++
      }
      expect(atHome(sim, u)).toBe(true)
      // Arrivée : elle tient, et son armée pourra la reprendre à sa répartition suivante.
      expect(u.order.kind).toBe('hold')
      expect(u.direct?.doneAt).toBe(sim.ctx.tick)
    })
  }

  it('aucune unité ne reste en territoire fermé, joueur comme IA', () => {
    const sim = newGame()
    intruder(sim)
    // Une brigade russe posée en territoire ukrainien d'origine.
    const units = [...sim.ctx.units.values()]
    const r = units.find((u) => u.owner === 'RUS' && u.kind === 'inf')
    const host = units.find((u) => u.owner === 'UKR' && u.kind === 'inf' && atHome(sim, u))
    if (!r || !host) throw new Error('unités manquantes')
    ;[r.lon, r.lat] = [host.lon - 0.3, host.lat]
    peace(sim, 'white')
    sim.step(24 * 6)
    const stuck = [...sim.ctx.units.values()].filter(
      (u) => !sim.ctx.matrix.canEnter(sideIndex(sim.ctx, u.owner), ownerAt(sim, u)),
    )
    expect(stuck.map((u) => u.name)).toEqual([])
  })

  it('un chemin tracé pendant la guerre ne traverse plus la frontière fermée', () => {
    const sim = newGame()
    const units = [...sim.ctx.units.values()]
    const u = units.find((x) => x.owner === 'UKR' && x.kind === 'inf' && atHome(sim, x))
    const rus = units.find((x) => x.owner === 'RUS' && atHome(sim, x))
    if (!u || !rus) throw new Error('unités manquantes')
    u.order = { kind: 'move', target: [rus.lon, rus.lat] }
    u.path = [
      [rus.lon, rus.lat],
      [u.lon, u.lat],
    ]
    peace(sim, 'lines')
    const side = sideIndex(sim.ctx, 'UKR')
    for (const p of u.path) {
      const o = sim.ctx.grid.owner[sim.ctx.grid.cellAt(p[0], p[1])] ?? 0
      expect(sim.ctx.matrix.canEnter(side, o)).toBe(true)
    }
  })
})
