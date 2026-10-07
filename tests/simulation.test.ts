import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { parseSave, serializeSave } from '@/sim/core/save'
import { distanceKm, Terrain, type TheaterData } from '@/sim/theater/grid'
import type { LonLat } from '@/sim/core/types'

const theater = theaterJson as unknown as TheaterData
const KYIV: LonLat = [30.52, 50.45]
const newGame = (): Simulation => Simulation.fromScenario(ukraine2026, theater, 7)

describe('théâtre', () => {
  it('place Kyiv chez l’Ukraine et la mer Noire en eau', () => {
    const sim = newGame()
    const g = sim.ctx.grid
    expect(g.owner[g.cellAt(KYIV[0], KYIV[1])]).toBe(sim.sideOf('UKR'))
    expect(g.terrain[g.cellAt(32, 43.5 + 1)]).toBe(Terrain.WATER)
  })
})

describe('déploiement', () => {
  it('place chaque unité sur une cellule praticable de son camp', () => {
    const sim = newGame()
    const g = sim.ctx.grid
    for (const u of sim.ctx.units.values()) {
      const cell = g.cellAt(u.lon, u.lat)
      expect(g.passable(cell)).toBe(true)
      expect(g.owner[cell]).toBe(sim.sideOf(u.owner))
    }
  })
})

describe('pathfinding', () => {
  it('relie Kyiv à Odesa par la terre', () => {
    const sim = newGame()
    const path = sim.ctx.pathfinder.find(KYIV, [30.73, 46.48], { side: 1, enemyCost: 2 })
    expect(path).not.toBeNull()
    for (const [lon, lat] of path ?? []) {
      expect(sim.ctx.grid.passable(sim.ctx.grid.cellAt(lon, lat))).toBe(true)
    }
  })
})

describe('ordres', () => {
  it('une unité en ordre de mouvement se rapproche de sa cible', () => {
    const sim = newGame()
    const u = [...sim.ctx.units.values()].find((x) => x.owner === 'UKR' && x.kind === 'hq')
    if (!u) throw new Error('QG introuvable')
    const before = distanceKm(u.lon, u.lat, KYIV[0], KYIV[1])
    sim.orderUnits([u.id], 'move', KYIV)
    sim.step(24)
    expect(distanceKm(u.lon, u.lat, KYIV[0], KYIV[1])).toBeLessThan(before)
  })

  it('refuse de commander les unités adverses', () => {
    const sim = newGame()
    const enemy = [...sim.ctx.units.values()].find((x) => x.owner === 'RUS')
    if (!enemy) throw new Error('unité introuvable')
    const order = enemy.order.kind
    sim.orderUnits([enemy.id], 'move', KYIV)
    expect(enemy.order.kind).toBe(order)
  })

  it('une offensive planifiée met les unités de ligne en attaque', () => {
    const sim = newGame()
    const ids = [...sim.ctx.units.values()]
      .filter((x) => x.owner === 'UKR' && (x.kind === 'tank' || x.kind === 'mech'))
      .map((x) => x.id)
    const army = sim.createArmy('Groupement Nord', ids)
    sim.planOffensive(army, [36.2, 50.0], [36.6, 50.6])
    sim.launchOffensive(army)
    const orders = ids.map((id) => sim.ctx.units.get(id)?.order.kind)
    expect(orders.every((o) => o === 'attack')).toBe(true)
  })
})

describe('partie', () => {
  it('fait bouger le front sans valeurs invalides sur deux semaines', () => {
    const sim = newGame()
    const start = sim.snapshot(true).grid?.owner.slice()
    sim.step(24 * 14)
    const end = sim.snapshot(true).grid?.owner
    let changed = 0
    for (let i = 0; i < (end?.length ?? 0); i++) if (end?.[i] !== start?.[i]) changed++
    expect(changed).toBeGreaterThan(0)
    for (const u of sim.ctx.units.values()) {
      expect(Number.isFinite(u.lon) && Number.isFinite(u.strength) && Number.isFinite(u.org)).toBe(
        true,
      )
    }
  })

  it('une sauvegarde rechargée rejoue exactement la même suite', () => {
    const a = newGame()
    a.step(100)
    const b = Simulation.fromSave(parseSave(serializeSave(a.toSave())), ukraine2026, theater)
    a.step(60)
    b.step(60)
    const pos = (s: Simulation): string =>
      JSON.stringify(
        [...s.ctx.units.values()].map((u) => [u.id, u.lon.toFixed(5), u.org.toFixed(5)]),
      )
    expect(pos(b)).toBe(pos(a))
  })
})
