import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import {
  addAirZone,
  AIR_SUPPORT_BONUS,
  AIR_ZONES_MAX,
  airDefense,
  airFire,
  airPower,
  airSpeed,
  airZonesOf,
  BOMBING_MALUS,
  INTERDICTION_SLOW,
  SUPERIORITY_WEIGHT,
  updateAir,
  updateAirAi,
} from '@/sim/systems/air'
import { combatModifiers } from '@/sim/systems/combat'
import { parseSave, serializeSave } from '@/sim/core/save'
import { distanceKm, type TheaterData } from '@/sim/theater/grid'
import type { LonLat, UnitState } from '@/sim/core/types'
import { bringToContact } from './helpers/contact'

const theater = theaterJson as unknown as TheaterData
const newGame = (): Simulation => Simulation.fromScenario(ukraine2026, theater, 3)

/** Une brigade ukrainienne au contact des Russes : la plus proche, avancée à 6 km de son vis-à-vis. */
const frontUnit = (sim: Simulation): UnitState => bringToContact(sim)
const at = (u: UnitState): LonLat => [u.lon, u.lat]

describe('aviation provisoire', () => {
  it('tire la puissance aérienne des usines militaires', () => {
    const sim = newGame()
    expect(airPower(sim.ctx, 'UKR')).toBeGreaterThan(0)
    expect(airPower(sim.ctx, 'RUS')).toBeGreaterThan(airPower(sim.ctx, 'UKR'))
  })

  it("pose des zones à portée d'un aérodrome, dans la limite du nombre", () => {
    const sim = newGame()
    expect(sim.addAirZone('support', [80, 62])).toMatch(/portée/)
    const center = at(frontUnit(sim))
    for (let i = 0; i < AIR_ZONES_MAX; i++) expect(sim.addAirZone('support', center)).toBe(null)
    expect(sim.addAirZone('bombing', center)).toMatch(/au plus/)
    const zones = sim.snapshot().air.zones
    expect(zones).toHaveLength(AIR_ZONES_MAX)
    sim.removeAirZone(zones[0]?.id ?? -1)
    expect(airZonesOf(sim.ctx, 'UKR')).toHaveLength(AIR_ZONES_MAX - 1)
  })

  it("l'appui au sol dépend de la maîtrise du ciel", () => {
    const sim = newGame()
    const u = frontUnit(sim)
    sim.addAirZone('support', at(u))
    updateAir(sim.ctx)
    expect(airFire(sim.ctx, u)).toBeCloseTo(1 + AIR_SUPPORT_BONUS)
    expect(airDefense(sim.ctx, u)).toBeCloseTo(1 + AIR_SUPPORT_BONUS)
    expect(combatModifiers(sim.ctx, u).attack.some((m) => m.key === 'air')).toBe(true)
    // La supériorité aérienne russe dispute le ciel.
    expect(addAirZone(sim.ctx, 'RUS', 'superiority', at(u))).toBe(null)
    updateAir(sim.ctx)
    const ukr = airPower(sim.ctx, 'UKR')
    const rus = airPower(sim.ctx, 'RUS') * SUPERIORITY_WEIGHT
    expect(airFire(sim.ctx, u)).toBeCloseTo(1 + (AIR_SUPPORT_BONUS * ukr) / (ukr + rus))
  })

  it("le bombardement et l'interdiction frappent les unités ennemies", () => {
    const sim = newGame()
    const u = frontUnit(sim)
    expect(addAirZone(sim.ctx, 'RUS', 'bombing', at(u))).toBe(null)
    expect(addAirZone(sim.ctx, 'RUS', 'interdiction', at(u))).toBe(null)
    const org = u.org
    updateAir(sim.ctx)
    expect(airFire(sim.ctx, u)).toBeCloseTo(1 - BOMBING_MALUS)
    expect(airSpeed(sim.ctx, u)).toBeCloseTo(1 - INTERDICTION_SLOW)
    expect(u.org).toBeLessThan(org)
    // Les unités russes de la zone ne sont pas touchées.
    const own = [...sim.ctx.units.values()].find(
      (x) => x.owner === 'RUS' && distanceKm(x.lon, x.lat, u.lon, u.lat) < 30,
    )
    if (own) expect(airFire(sim.ctx, own)).toBe(1)
  })

  it("l'IA pose supériorité et appui au-dessus de ses unités au contact", () => {
    const sim = newGame()
    bringToContact(sim)
    sim.step(1)
    updateAirAi(sim.ctx, 'RUS')
    const zones = airZonesOf(sim.ctx, 'RUS')
    expect(zones.map((z) => z.mission).sort()).toEqual(['superiority', 'support'])
    // Zones gardées tant qu'elles servent.
    const ids = zones.map((z) => z.id)
    updateAirAi(sim.ctx, 'RUS')
    expect(airZonesOf(sim.ctx, 'RUS').map((z) => z.id)).toEqual(ids)
  })

  it('les zones sont gardées dans la sauvegarde', () => {
    const sim = newGame()
    sim.addAirZone('interdiction', at(frontUnit(sim)))
    const loaded = Simulation.fromSave(parseSave(serializeSave(sim.toSave())), ukraine2026, theater)
    expect(loaded.ctx.air.map((z) => [z.owner, z.mission])).toEqual([['UKR', 'interdiction']])
  })
})
