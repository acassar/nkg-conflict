import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { BREACH_CORRIDOR_KM, frontCells } from '@/sim/systems/armies'
import { BREACH_SHOCK_SHARE, missionKind } from '@/sim/systems/missions'
import { distanceKm, type TheaterData } from '@/sim/theater/grid'
import type { ArmyState, BreachMission, LonLat, UnitState } from '@/sim/core/types'
import { isLineUnit } from '@/sim/units/catalog'

const theater = theaterJson as unknown as TheaterData

function setup(): { sim: Simulation; army: ArmyState } {
  const sim = Simulation.fromScenario(ukraine2026, theater, 7)
  const army = [...sim.ctx.armies.values()].find((a) => a.owner === 'UKR' && a.wholeFront)
  if (!army) throw new Error('armée introuvable')
  return { sim, army }
}

/** Point visé : 40 km chez l'ennemi, en face d'une cellule du front de l'armée (vers son milieu). */
function targetFor(sim: Simulation, army: ArmyState): LonLat {
  const ctx = sim.ctx
  const side = sim.sideOf(army.owner)
  const cells = frontCells(ctx, side, null)
  for (let k = Math.floor(cells.length / 2); k < cells.length; k += 5) {
    const f = cells[k]
    if (!f) continue
    const len = Math.hypot(f.back[0], f.back[1]) || 1
    // Vers l'ennemi : à l'opposé de l'arrière (lignes de la grille du nord au sud).
    const lat = ctx.grid.latOf(f.cell) + (f.back[1] / len) * (40 / 111)
    const lon =
      ctx.grid.lonOf(f.cell) - ((f.back[0] / len) * (40 / 111)) / Math.cos((lat * Math.PI) / 180)
    const c = ctx.grid.cellAt(lon, lat)
    const o = c >= 0 ? (ctx.grid.owner[c] ?? 0) : 0
    if (c >= 0 && ctx.grid.passable(c) && o !== 0 && ctx.matrix.hostile(side, o)) return [lon, lat]
  }
  throw new Error('point visé introuvable')
}

function lineUnits(sim: Simulation, army: ArmyState): UnitState[] {
  return army.unitIds
    .map((id) => sim.ctx.units.get(id))
    .filter((u): u is UnitState => !!u && isLineUnit(u.kind))
}

/** Part des postes de front de l'armée à moins du couloir de l'axe (du départ au point visé). */
function corridorShare(sim: Simulation, army: ArmyState, origin: LonLat): number {
  const posts = lineUnits(sim, army)
    .filter((u) => u.order.kind === 'front' && u.order.target)
    .map((u) => u.order.target as LonLat)
  const near = posts.filter(
    (p) => distanceKm(p[0], p[1], origin[0], origin[1]) <= BREACH_CORRIDOR_KM + 30,
  )
  return near.length / Math.max(1, posts.length)
}

describe('mission « Percée sur un axe »', () => {
  it('groupe de choc concentré vers le point visé, flancs tenus par le reste', () => {
    const { sim, army } = setup()
    const target = targetFor(sim, army)
    const line = lineUnits(sim, army)
    expect(sim.breachArmy(army.id, target)).toBeNull()
    expect(missionKind(army)).toBe('breach')
    const m = army.mission as BreachMission
    expect(m.shockIds.length).toBe(Math.ceil(line.length * BREACH_SHOCK_SHARE))
    // Choc : les unités les plus proches du départ, en attaque vers le point visé (à quelques km près).
    for (const id of m.shockIds) {
      const u = sim.ctx.units.get(id) as UnitState
      expect(u.order.kind).toBe('attack')
      const t = u.order.target as LonLat
      expect(distanceKm(t[0], t[1], target[0], target[1])).toBeLessThan(m.shockIds.length * 3 + 5)
    }
    // Le reste tient le front, plus dense autour du départ de la percée qu'avant.
    const rest = line.filter((u) => !m.shockIds.includes(u.id))
    expect(rest.every((u) => u.order.kind === 'front')).toBe(true)
    const withBreach = corridorShare(sim, army, m.origin)
    const { sim: sim2, army: army2 } = setup()
    expect(withBreach).toBeGreaterThan(corridorShare(sim2, army2, m.origin))
  })

  it("le groupe de choc échappe à l'arrêt des attaques isolées, et Tenir le ramène au front", () => {
    const { sim, army } = setup()
    const target = targetFor(sim, army)
    expect(sim.breachArmy(army.id, target)).toBeNull()
    const m = army.mission as BreachMission
    sim.step(24)
    expect(missionKind(army)).toBe('breach')
    const shock = m.shockIds.map((id) => sim.ctx.units.get(id)).filter((u) => !!u)
    expect(shock.length).toBeGreaterThan(0)
    expect(shock.every((u) => !u.halt)).toBe(true)
    expect(m.progress).toBeGreaterThanOrEqual(0)
    sim.holdArmy(army.id)
    expect(missionKind(army)).toBe('hold')
    sim.step(24)
    const back = shock.filter((u) => sim.ctx.units.has(u.id) && u.order.kind === 'front')
    expect(back.length).toBeGreaterThan(shock.length / 2)
  })

  it("au point visé, la mission s'achève et le groupe de choc reprend le front", () => {
    const { sim, army } = setup()
    expect(sim.breachArmy(army.id, targetFor(sim, army))).toBeNull()
    const m = army.mission as BreachMission
    for (let day = 0; day < 15 && missionKind(army) === 'breach'; day++) sim.step(24)
    expect(missionKind(army)).toBe('hold')
    expect(m.progress).toBe(1)
    sim.step(24)
    const shock = m.shockIds.map((id) => sim.ctx.units.get(id)).filter((u) => !!u)
    expect(shock.filter((u) => u.order.kind === 'front').length).toBeGreaterThan(shock.length / 2)
  })

  it('point visé déjà tenu : refusé', () => {
    const { sim, army } = setup()
    const u = lineUnits(sim, army)[0] as UnitState
    expect(sim.breachArmy(army.id, [u.lon, u.lat])).toMatch(/déjà tenu/)
    expect(missionKind(army)).toBe('hold')
  })
})
