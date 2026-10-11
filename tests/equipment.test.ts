import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { parseSave, serializeSave } from '@/sim/core/save'
import { runtimeOf } from '@/sim/context'
import { updateEconomy } from '@/sim/economy/economy'
import { REINFORCE_PER_DAY } from '@/sim/economy/rules'
import { combatModifiers } from '@/sim/systems/combat'
import { applyLosses, combatStrength, equipmentOf, EQUIPMENT_WEIGHT } from '@/sim/units/equipment'
import type { TheaterData } from '@/sim/theater/grid'
import type { UnitKind, UnitState } from '@/sim/core/types'

const theater = theaterJson as unknown as TheaterData

const unit = (kind: UnitKind, strength: number, equipment?: number): UnitState => ({
  id: 1,
  name: 'test',
  owner: 'UKR',
  kind,
  lon: 30,
  lat: 50,
  strength,
  ...(equipment !== undefined ? { equipment } : {}),
  org: 1,
  entrench: 0,
  order: { kind: 'hold' },
  path: [],
  armyId: null,
  hoursOutOfSupply: 0,
})

describe('effectifs et matériel', () => {
  it('la force combine les deux jauges selon le type, et vaut la jauge quand elles sont égales', () => {
    expect(combatStrength(unit('inf', 0.6))).toBeCloseTo(0.6)
    expect(combatStrength(unit('tank', 0.6, 0.6))).toBeCloseTo(0.6)
    // Sans matériel, des blindés ne valent presque plus rien ; une infanterie garde l'essentiel.
    const tank = combatStrength(unit('tank', 1, 0.3))
    const inf = combatStrength(unit('inf', 1, 0.3))
    expect(tank).toBeLessThan(0.45)
    expect(inf).toBeGreaterThan(0.6)
    expect(EQUIPMENT_WEIGHT.tank).toBeGreaterThan(EQUIPMENT_WEIGHT.inf)
    // Ancienne unité sans jauge de matériel : égale aux effectifs.
    expect(equipmentOf(unit('mech', 0.7))).toBe(0.7)
  })

  it('les pertes touchent davantage le matériel des blindés et les hommes de l’infanterie', () => {
    const tank = unit('tank', 1, 1)
    applyLosses(tank, 0.1)
    expect(1 - (tank.equipment ?? 1)).toBeGreaterThan(1 - tank.strength)
    expect(combatStrength(tank)).toBeCloseTo(0.9, 2)
    const inf = unit('inf', 1, 1)
    applyLosses(inf, 0.1)
    expect(1 - inf.strength).toBeGreaterThan(1 - (inf.equipment ?? 1))
    expect(combatStrength(inf)).toBeCloseTo(0.9, 2)
  })

  it('les hommes reviennent par la main-d’œuvre, le matériel par la production, chacun de son côté', () => {
    const sim = Simulation.fromScenario(ukraine2026, theater, 1)
    const ctx = sim.ctx
    const eco = ctx.economies.get('UKR')
    // Une unité ukrainienne ravitaillée et hors combat.
    const u = [...ctx.units.values()].find((x) => {
      const rt = runtimeOf(ctx, x.id)
      return x.owner === 'UKR' && x.kind === 'inf' && rt.supplied && rt.engagedWith === null
    })
    if (!eco || !u) throw new Error('unité introuvable')
    for (const other of ctx.units.values()) {
      if (other.owner === 'UKR' && other !== u) {
        other.strength = 1
        other.equipment = 1
      }
    }
    u.strength = 0.5
    u.equipment = 0.5
    // Pas de production : seuls les hommes reviennent.
    eco.production = -1e6
    eco.manpower = 1e6
    updateEconomy(ctx, ukraine2026)
    expect(u.strength).toBeCloseTo(0.5 + REINFORCE_PER_DAY)
    expect(u.equipment).toBeCloseTo(0.5)
    // Pas de main-d'œuvre : seul le matériel revient.
    eco.production = 1e6
    eco.manpower = -1e6
    updateEconomy(ctx, ukraine2026)
    expect(u.strength).toBeCloseTo(0.5 + REINFORCE_PER_DAY)
    expect(u.equipment).toBeCloseTo(0.5 + REINFORCE_PER_DAY)
  })

  it("l'écran de bataille détaille effectifs et matériel ; la sauvegarde garde le matériel", () => {
    const sim = Simulation.fromScenario(ukraine2026, theater, 1)
    const u = [...sim.ctx.units.values()].find((x) => x.kind === 'tank')
    if (!u) throw new Error('pas de blindés')
    u.strength = 0.9
    u.equipment = 0.4
    const mods = combatModifiers(sim.ctx, u).attack
    const men = mods.find((m) => m.key === 'strength')
    const gear = mods.find((m) => m.key === 'equipment')
    expect(gear?.label).toBe('Matériel (40 %)')
    expect((men?.value ?? 0) * (gear?.value ?? 0)).toBeCloseTo(combatStrength(u))
    const loaded = Simulation.fromSave(parseSave(serializeSave(sim.toSave())), ukraine2026, theater)
    expect(loaded.ctx.units.get(u.id)?.equipment).toBe(0.4)
    expect(loaded.snapshot().units.find((x) => x.id === u.id)?.equipment).toBe(0.4)
  })
})
