import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { combatModifiers, defenseValue, firePower } from '@/sim/systems/combat'
import { Terrain, type TheaterData } from '@/sim/theater/grid'
import type { UnitState } from '@/sim/core/types'
import {
  ARMOR_OPEN_FACTOR,
  ARMOR_URBAN_FACTOR,
  ARTILLERY_STATIC_FACTOR,
  fuelSpeedFactor,
  kindTerrainAttack,
  kindTerrainSpeed,
  matchup,
  NO_FUEL_SPEED,
} from '@/sim/units/kinds'
import { HELP_SECTIONS } from '@/help/rules'

const theater = theaterJson as unknown as TheaterData

function setup(): { sim: Simulation; of: (kind: UnitState['kind']) => UnitState } {
  const sim = Simulation.fromScenario(ukraine2026, theater, 5)
  const of = (kind: UnitState['kind']): UnitState => {
    const u = [...sim.ctx.units.values()].find((x) => x.kind === kind)
    if (!u) throw new Error(`pas d'unité ${kind}`)
    return u
  }
  return { sim, of }
}

/** Place une unité sur la première cellule praticable du terrain voulu. */
function placeOn(sim: Simulation, u: UnitState, terrain: number): void {
  const g = sim.ctx.grid
  for (let i = 0; i < g.size; i++) {
    if (g.terrain[i] === terrain && g.passable(i)) {
      u.lon = g.lonOf(i)
      u.lat = g.latOf(i)
      return
    }
  }
  throw new Error('terrain introuvable')
}

describe("différences entre types d'unités", () => {
  it('le terrain gêne les blindés et avantage l’infanterie', () => {
    expect(kindTerrainSpeed('tank', Terrain.FOREST)).toBeLessThan(1)
    expect(kindTerrainSpeed('inf', Terrain.FOREST)).toBe(1)
    expect(kindTerrainAttack('tank', Terrain.URBAN)).toBeLessThan(1)
    expect(kindTerrainAttack('inf', Terrain.URBAN)).toBeGreaterThan(1)
    expect(kindTerrainAttack('art', Terrain.MOUNTAINS)).toBeLessThan(1)
    expect(kindTerrainAttack('tank', Terrain.PLAIN)).toBe(1)

    const { sim, of } = setup()
    const tank = of('tank')
    placeOn(sim, tank, Terrain.PLAIN)
    const open = firePower(sim.ctx, tank)
    const openDef = defenseValue(sim.ctx, tank)
    placeOn(sim, tank, Terrain.FOREST)
    expect(firePower(sim.ctx, tank)).toBeCloseTo(open * kindTerrainAttack('tank', Terrain.FOREST))
    // Défense en forêt : bonus commun du terrain, réduit pour les blindés.
    expect(defenseValue(sim.ctx, tank) / openDef).toBeLessThan(1.25)
    const labels = combatModifiers(sim.ctx, tank).attack.map((m) => m.key)
    expect(labels).toContain('kindTerrain')
  })

  it('rapports de force entre types', () => {
    const { of } = setup()
    const tank = of('tank')
    const inf = of('inf')
    const art = of('art')
    expect(matchup(tank, inf, Terrain.PLAIN)?.factor).toBe(ARMOR_OPEN_FACTOR)
    inf.entrench = 1
    expect(matchup(tank, inf, Terrain.URBAN)?.factor).toBe(ARMOR_URBAN_FACTOR)
    inf.entrench = 0
    expect(matchup(tank, inf, Terrain.URBAN)).toBeNull()
    expect(matchup(inf, tank, Terrain.PLAIN)).toBeNull()
    inf.path = []
    expect(matchup(art, inf, Terrain.FOREST)?.factor).toBe(ARTILLERY_STATIC_FACTOR)
    inf.path = [[inf.lon + 0.1, inf.lat]]
    expect(matchup(art, inf, Terrain.FOREST)).toBeNull()
  })

  it('les unités motorisées tombent en panne de carburant hors ravitaillement', () => {
    const { of } = setup()
    const tank = of('tank')
    const inf = of('inf')
    tank.hoursOutOfSupply = 30
    inf.hoursOutOfSupply = 30
    expect(fuelSpeedFactor(tank)).toBe(NO_FUEL_SPEED)
    expect(fuelSpeedFactor(inf)).toBe(1)
    tank.hoursOutOfSupply = 5
    expect(fuelSpeedFactor(tank)).toBe(1)
  })

  it("l'aide en jeu détaille les effets par type", () => {
    const s = HELP_SECTIONS.find((x) => x.id === 'kinds')
    expect(s?.table?.rows.find((r) => r[0] === 'Blindés' && r[1] === 'Forêt')?.[2]).toBe('−30 %')
    expect(s?.paragraphs.join(' ')).toContain('+15 %')
  })
})
