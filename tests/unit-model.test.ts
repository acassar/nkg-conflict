import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { isBrigade, MODERN_CATALOG } from '@/sim/units/catalog'
import { matchup, munitionsPerShot } from '@/sim/units/kinds'
import { FORMATIONS_PER_BARRACKS, RECRUIT_COSTS, formationSlots } from '@/sim/economy/rules'
import { forceComposition, forceSizeOf } from '@/sim/politics/mobilization'
import {
  BRIGADE_TEMPLATES,
  DEFAULT_BRIGADE_TEMPLATE,
  DIVISION_TEMPLATES,
  brigadeProfile,
  compositionText,
  profileOf,
  templateLabel,
} from '@/sim/units/templates'
import { combatStrength } from '@/sim/units/equipment'
import { parseSave } from '@/sim/core/save'
import { Terrain, type TheaterData } from '@/sim/theater/grid'
import type { UnitKind } from '@/sim/core/types'
import realUkr from '@/sim/data/real/UKR.json'
import { brigadeCount } from '@/sim/scenarios/forces'
import { LOSS_REF_BRIGADES } from '@/sim/politics/politics'

const theater = theaterJson as unknown as TheaterData

describe('modèle d’unités', () => {
  it('les modèles par défaut gardent les valeurs de référence de leur rôle', () => {
    for (const kind of ['inf', 'mech', 'tank', 'art', 'tdf'] as UnitKind[]) {
      const p = profileOf({ kind })
      const ref = MODERN_CATALOG[kind]
      expect(p.template).toBe(DEFAULT_BRIGADE_TEMPLATE[kind])
      expect(p.type.attack).toBeCloseTo(ref.attack, 0)
      expect(p.type.defense).toBeCloseTo(ref.defense, 0)
      expect(p.type.speedKmh).toBe(ref.speedKmh)
      expect(p.type.supportRangeKm).toBe(ref.supportRangeKm)
      expect(p.type.zocKm).toBeCloseTo(ref.zocKm, 0)
    }
    // Brigades à l'effectif réel : 3 000 à 6 000 hommes.
    for (const t of Object.values(BRIGADE_TEMPLATES)) {
      const men = brigadeProfile(t.id).men
      expect(men).toBeGreaterThanOrEqual(2000)
      expect(men).toBeLessThanOrEqual(7000)
    }
  })

  it('les valeurs se calculent à partir des bataillons', () => {
    const mech = brigadeProfile('mecanisee')
    const tank = brigadeProfile('blindee')
    const motor = brigadeProfile('motorisee')
    const light = brigadeProfile('infanterie_legere')
    // Somme des bataillons : la brigade blindée attaque plus, la mécanisée défend mieux.
    expect(tank.type.attack).toBeGreaterThan(mech.type.attack)
    expect(mech.type.defense).toBeGreaterThan(tank.type.defense)
    // Vitesse du bataillon le plus lent ; carburant selon la majorité des bataillons.
    expect(motor.type.speedKmh).toBeGreaterThan(light.type.speedKmh)
    expect(motor.motorized).toBe(true)
    expect(light.motorized).toBe(false)
    // Poids du matériel et munitions selon la part de chaque type.
    expect(tank.equipmentWeight).toBeGreaterThan(mech.equipmentWeight)
    expect(mech.equipmentWeight).toBeGreaterThan(light.equipmentWeight)
    expect(munitionsPerShot({ kind: 'art' })).toBeCloseTo(2)
    expect(munitionsPerShot({ kind: 'inf' })).toBeCloseTo(1)
    // Seules les brigades d'appui tirent à distance ; les roquettes portent plus loin.
    expect(brigadeProfile('artillerie_roquettes').type.supportRangeKm).toBeGreaterThan(
      brigadeProfile('artillerie').type.supportRangeKm,
    )
    expect(brigadeProfile('defense_sol_air').type.supportRangeKm).toBe(0)
    // Terrain : la brigade blindée, freinée par ses chars en forêt.
    expect(tank.terrainSpeed[Terrain.FOREST]).toBeLessThan(1)
    expect(light.terrainDefense[Terrain.URBAN]).toBeGreaterThan(1)
    // Composition lisible.
    expect(templateLabel({ kind: 'mech' })).toBe('Brigade mécanisée')
    expect(compositionText({ kind: 'mech' })).toMatch(/^3 Infanterie mécanisée, 1 Chars, 1 Soutien/)
  })

  it('les rapports de force entre types sont pondérés par la part de chaque type', () => {
    const sim = Simulation.fromScenario(ukraine2026, theater, 1)
    const units = [...sim.ctx.units.values()]
    const of = (kind: UnitKind) => {
      const u = units.find((x) => x.kind === kind)
      if (!u) throw new Error(kind)
      return { ...u, path: [], entrench: 0, strength: 1 }
    }
    const inf = of('inf')
    const vsTank = matchup(of('tank'), inf, Terrain.PLAIN)?.factor ?? 1
    const vsMech = matchup(of('mech'), inf, Terrain.PLAIN)?.factor ?? 1
    expect(vsTank).toBeGreaterThan(vsMech)
    expect(vsMech).toBeGreaterThan(1)
    expect(matchup(of('tank'), of('tank'), Terrain.PLAIN)).toBeNull()
    // Force de combat : à jauges inégales, le poids du matériel du modèle compte.
    const worn = { ...of('tank'), strength: 1, equipment: 0.5 }
    expect(combatStrength(worn)).toBeLessThan(combatStrength({ ...of('inf'), equipment: 0.5 }))
  })

  it('les modèles couvrent les types des ordres de bataille réels', () => {
    const types = new Set<string>()
    const walk = (o: unknown): void => {
      if (Array.isArray(o)) o.forEach(walk)
      else if (o && typeof o === 'object') {
        const r = o as Record<string, unknown>
        if (typeof r.type === 'string' && typeof r.echelon === 'string') types.add(r.type)
        Object.values(r).forEach(walk)
      }
    }
    walk(realUkr)
    expect(types.size).toBeGreaterThan(3)
    for (const t of types) expect(BRIGADE_TEMPLATES[t]).toBeDefined()
    for (const d of Object.values(DIVISION_TEMPLATES)) {
      expect(d.brigades.length).toBeGreaterThanOrEqual(2)
      expect(d.brigades.length).toBeLessThanOrEqual(4)
      for (const b of d.brigades) expect(BRIGADE_TEMPLATES[b]).toBeDefined()
    }
  })

  it('une brigade a l’effectif d’une vraie brigade : coûts et forces à l’échelle réelle', () => {
    const sim = Simulation.fromScenario(ukraine2026, theater, 1)
    // Une brigade de l'ordre de bataille réel donne une brigade en jeu.
    const brigades = (owner: string): number =>
      [...sim.ctx.units.values()].filter((u) => u.owner === owner && isBrigade(u.kind)).length
    for (const owner of ['UKR', 'RUS'])
      expect(brigades(owner)).toBe(brigadeCount(ukraine2026.forces?.[owner]?.armies ?? []))
    expect(RECRUIT_COSTS.inf.production).toBe(300)
    expect(RECRUIT_COSTS.mech.manpower).toBe(5)
    expect(formationSlots(2)).toBe(2 * FORMATIONS_PER_BARRACKS)
    expect(FORMATIONS_PER_BARRACKS).toBe(1)
    expect(isBrigade('tdf')).toBe(true)
    expect(isBrigade('log')).toBe(false)
    expect(forceSizeOf(30_000, 330)).toBe(45)
    expect(forceSizeOf(0, 0)).toBe(3)
    const big = forceComposition(45)
    expect(Object.values(big).reduce((a, b) => a + b, 0)).toBe(45)
  })

  it('les pertes usent le soutien à la guerre : une brigade perdue, −0,01 pour 20 unités', () => {
    const support = (extra: number): number => {
      const sim = Simulation.fromScenario(ukraine2026, theater, 1)
      sim.step(23)
      sim.ctx.losses.set('UKR', (sim.ctx.losses.get('UKR') ?? 0) + extra)
      sim.step(1)
      return sim.ctx.politics.countries.get('UKR')?.warSupport ?? 0
    }
    // Rapportée à la taille de l'armée au-delà de LOSS_REF_BRIGADES unités.
    const size = Simulation.fromScenario(ukraine2026, theater, 1).ctx.politics.countries.get(
      'UKR',
    )?.forceSize
    expect(support(0) - support(1)).toBeCloseTo(
      (0.01 * LOSS_REF_BRIGADES) / Math.max(LOSS_REF_BRIGADES, size ?? 0),
      6,
    )
  })

  it('les sauvegardes d’avant les armées réelles ne se chargent plus, avec un message clair', () => {
    const old = JSON.stringify({
      version: 5,
      tick: 0,
      scenarioId: 'x',
      units: [],
      armies: [],
      owner: [],
    })
    expect(() => parseSave(old)).toThrow(/avant les armées réelles/)
  })
})
