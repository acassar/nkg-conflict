import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { combatModifiers, updateCombat } from '@/sim/systems/combat'
import { clearObstacles, DEMINING_PER_DAY, obstaclesUnder } from '@/sim/systems/obstacles'
import { parseSave, serializeSave } from '@/sim/core/save'
import { Terrain, type TheaterData } from '@/sim/theater/grid'
import type { UnitState } from '@/sim/core/types'

const theater = theaterJson as unknown as TheaterData
const newGame = (): Simulation => Simulation.fromScenario(ukraine2026, theater, 7)

/** Première cellule ukrainienne de ce terrain à l'ouest du pays (loin du front). */
function westernCell(sim: Simulation, terrain: number): [number, number] {
  const g = sim.ctx.grid
  const side = sim.sideOf('UKR')
  for (let lat = 50.5; lat > 48.5; lat -= 0.05) {
    for (let lon = 24; lon < 27; lon += 0.05) {
      const c = g.cellAt(lon, lat)
      if (g.owner[c] === side && g.terrain[c] === terrain) return [g.lonOf(c), g.latOf(c)]
    }
  }
  throw new Error(`aucune cellule de terrain ${terrain}`)
}

function unitOf(sim: Simulation, owner: string, kind = 'inf'): UnitState {
  const u = [...sim.ctx.units.values()].find((x) => x.owner === owner && x.kind === kind)
  if (!u) throw new Error(`unité ${owner} introuvable`)
  return u
}

describe('obstacles', () => {
  it('s’accumulent sous une unité retranchée, deux fois plus vite en ville', () => {
    const sim = newGame()
    const units = [...sim.ctx.units.values()].filter((u) => u.owner === 'UKR' && u.kind === 'inf')
    const [inTown, inField] = units
    if (!inTown || !inField) throw new Error('unités introuvables')
    ;[inTown.lon, inTown.lat] = westernCell(sim, Terrain.URBAN)
    ;[inField.lon, inField.lat] = westernCell(sim, Terrain.PLAIN)
    for (const u of [inTown, inField]) {
      // Hors de toute armée : l'unité garde sa position.
      for (const a of sim.ctx.armies.values()) a.unitIds = a.unitIds.filter((id) => id !== u.id)
      u.armyId = null
      u.path = []
      u.order = { kind: 'hold' }
      u.posture = 'balanced'
    }
    sim.step(48)
    const town = obstaclesUnder(sim.ctx, inTown)
    const field = obstaclesUnder(sim.ctx, inField)
    expect(field).toBeGreaterThan(0)
    expect(town / field).toBeCloseTo(2, 1)
  })

  it('freinent l’assaut et alourdissent les pertes de l’attaquant', () => {
    const duel = (level: number): { attacker: number; defender: number } => {
      const sim = newGame()
      const ctx = sim.ctx
      const def = unitOf(sim, 'UKR')
      const att = unitOf(sim, 'RUS')
      for (const id of [...ctx.units.keys()])
        if (id !== def.id && id !== att.id) ctx.units.delete(id)
      ;[def.lon, def.lat] = westernCell(sim, Terrain.PLAIN)
      ;[att.lon, att.lat] = [def.lon + 0.05, def.lat]
      def.order = { kind: 'hold' }
      att.order = { kind: 'attack', target: [def.lon, def.lat] }
      def.strength = att.strength = 1
      def.org = att.org = 1
      if (level > 0) {
        ctx.obstacles.set(ctx.grid.cellAt(def.lon, def.lat), { level, side: sim.sideOf('UKR') })
      }
      updateCombat(ctx)
      return { attacker: 1 - att.strength, defender: 1 - def.strength }
    }
    const open = duel(0)
    const mined = duel(1)
    expect(open.attacker).toBeGreaterThan(0)
    expect(mined.attacker / open.attacker).toBeCloseTo(1.5, 2)
    expect(mined.defender / open.defender).toBeCloseTo(0.7, 2)
  })

  it('apparaissent dans les modificateurs de l’écran de bataille', () => {
    const sim = newGame()
    const u = unitOf(sim, 'UKR')
    sim.ctx.obstacles.set(sim.ctx.grid.cellAt(u.lon, u.lat), {
      level: 0.5,
      side: sim.sideOf('UKR'),
    })
    const mod = combatModifiers(sim.ctx, u).defense.find((m) => m.label.startsWith('Obstacles'))
    expect(mod?.label).toBe("Obstacles contre l'assaut (50 %)")
    expect(mod?.value).toBeCloseTo(1 / 0.85)
  })

  it('sont levés par l’occupant et survivent à une sauvegarde', () => {
    const sim = newGame()
    const ctx = sim.ctx
    const [lon, lat] = westernCell(sim, Terrain.PLAIN)
    const cell = ctx.grid.cellAt(lon, lat)
    const own = ctx.grid.cellAt(lon + 0.2, lat)
    // Obstacles russes sur une cellule ukrainienne : déminés ; obstacles ukrainiens : conservés.
    ctx.obstacles.set(cell, { level: 1, side: sim.sideOf('RUS') })
    ctx.obstacles.set(own, { level: 0.6, side: sim.sideOf('UKR') })
    clearObstacles(ctx)
    expect(ctx.obstacles.get(cell)?.level).toBeCloseTo(1 - DEMINING_PER_DAY)
    const loaded = Simulation.fromSave(parseSave(serializeSave(sim.toSave())), ukraine2026, theater)
    expect(loaded.ctx.obstacles.get(cell)?.level).toBeCloseTo(1 - DEMINING_PER_DAY)
    for (let d = 0; d < 8; d++) clearObstacles(ctx)
    expect(ctx.obstacles.has(cell)).toBe(false)
    expect(ctx.obstacles.get(own)?.level).toBeCloseTo(0.6)
  })
})
