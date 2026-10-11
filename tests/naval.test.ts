import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import {
  crossingHours,
  heldPorts,
  isCoast,
  LANDING_FACTOR,
  LANDING_HOURS,
  LANDING_ORG,
  landingFactor,
  navalCapacity,
  portCapacity,
  portNames,
  seaSupplySources,
} from '@/sim/systems/naval'
import { combatModifiers } from '@/sim/systems/combat'
import { updateSupplySources } from '@/sim/economy/economy'
import { parseSave, serializeSave } from '@/sim/core/save'
import type { LonLat, UnitState } from '@/sim/core/types'
import type { TheaterData } from '@/sim/theater/grid'

const theater = theaterJson as unknown as TheaterData
const newGame = (): Simulation => Simulation.fromScenario(ukraine2026, theater, 3)

const city = (sim: Simulation, name: string): LonLat => {
  const c = sim.ctx.cityStates.get(name)
  if (!c) throw new Error(`ville absente : ${name}`)
  return [c.def.lon, c.def.lat]
}

/** Brigades ukrainiennes placées à Odessa (port d'embarquement). */
const atOdessa = (sim: Simulation, n: number): UnitState[] => {
  const [lon, lat] = city(sim, 'Odessa')
  const units = [...sim.ctx.units.values()]
    .filter((u) => u.owner === 'UKR' && u.kind === 'inf')
    .slice(0, n)
  for (const u of units) {
    u.lon = lon
    u.lat = lat
  }
  return units
}

describe('marine provisoire', () => {
  it('repère les ports et en tire la capacité navale', () => {
    const sim = newGame()
    const ports = portNames(sim.ctx)
    expect(ports.has('Odessa')).toBe(true)
    expect(ports.has('Sevastopol')).toBe(true)
    expect(ports.has('Kyiv')).toBe(false)
    expect(ports.has('Kharkiv')).toBe(false)
    const held = heldPorts(sim.ctx, 'UKR')
    expect(held.map((c) => c.def.name)).toContain('Odessa')
    expect(navalCapacity(sim.ctx, 'UKR')).toBe(
      held.reduce((n, c) => n + portCapacity(c.def.pop), 0),
    )
    expect(portCapacity(100_000)).toBe(1)
    expect(portCapacity(1_500_000)).toBe(2)
    expect(portCapacity(30_000_000)).toBe(4)
  })

  it('embarque, traverse puis débarque désorganisée, avec un malus de quelques heures', () => {
    const sim = newGame()
    const [u] = atOdessa(sim, 1)
    if (!u) throw new Error('unité absente')
    const target = city(sim, 'Sevastopol')
    expect(isCoast(sim.ctx, target[0], target[1])).toBe(true)
    expect(sim.landUnits([u.id], target)).toBe(null)
    // En mer : hors de la carte, visible dans l'état publié.
    expect(sim.ctx.units.has(u.id)).toBe(false)
    expect(
      sim.ctx.armies.size === 0 ||
        [...sim.ctx.armies.values()].every((a) => !a.unitIds.includes(u.id)),
    ).toBe(true)
    const transit = sim.ctx.sea[0]
    expect(transit?.arriveTick).toBe(sim.ctx.tick + crossingHours(city(sim, 'Odessa'), target))
    expect(sim.snapshot().naval.atSea.map((t) => t.id)).toEqual([u.id])
    sim.step((transit?.arriveTick ?? 0) - sim.ctx.tick)
    const landed = sim.ctx.units.get(u.id)
    expect(landed).toBeDefined()
    expect(sim.ctx.sea).toHaveLength(0)
    expect(landed?.org).toBeLessThanOrEqual(LANDING_ORG + 0.05)
    expect(landed?.landedAt).toBe(sim.ctx.tick)
    if (!landed) return
    expect(landingFactor(sim.ctx, landed)).toBe(LANDING_FACTOR)
    expect(combatModifiers(sim.ctx, landed).attack.some((m) => m.key === 'landing')).toBe(true)
    sim.step(LANDING_HOURS)
    expect(landingFactor(sim.ctx, landed)).toBe(1)
  })

  it('refuse une côte absente ou un port trop loin, et respecte la capacité', () => {
    const sim = newGame()
    const target = city(sim, 'Sevastopol')
    // Kyiv : à l'intérieur des terres.
    const [u] = atOdessa(sim, 1)
    expect(sim.landUnits([u?.id ?? -1], city(sim, 'Kyiv'))).toMatch(/côte/)
    // Une unité loin de tout port.
    const inland = [...sim.ctx.units.values()].find(
      (x) =>
        x.owner === 'UKR' &&
        heldPorts(sim.ctx, 'UKR').every((p) => Math.abs(p.def.lat - x.lat) > 1),
    )
    expect(sim.landUnits([inland?.id ?? -1], target)).toMatch(/port/)
    // Plus d'unités que de places : le reste reste à quai.
    const capacity = navalCapacity(sim.ctx, 'UKR')
    const group = atOdessa(sim, capacity + 2)
    expect(
      sim.landUnits(
        group.map((x) => x.id),
        target,
      ),
    ).toMatch(/restent à quai/)
    expect(sim.ctx.sea).toHaveLength(capacity)
    expect(sim.landUnits([group.at(-1)?.id ?? -1], target)).toMatch(/Capacité navale épuisée/)
  })

  it('un port pris ravitaille la tête de pont par la mer', () => {
    const sim = newGame()
    expect(seaSupplySources(sim.ctx, 'UKR')).toEqual([])
    const sevastopol = sim.ctx.cityStates.get('Sevastopol')
    if (!sevastopol) throw new Error('ville absente')
    sevastopol.owner = sim.sideOf('UKR')
    expect(seaSupplySources(sim.ctx, 'UKR')).toEqual([city(sim, 'Sevastopol')])
    updateSupplySources(sim.ctx, ukraine2026)
    expect(sim.ctx.supplySources.UKR).toContainEqual(city(sim, 'Sevastopol'))
  })

  it('les unités en mer sont gardées dans la sauvegarde', () => {
    const sim = newGame()
    const [u] = atOdessa(sim, 1)
    sim.landUnits([u?.id ?? -1], city(sim, 'Sevastopol'))
    const loaded = Simulation.fromSave(parseSave(serializeSave(sim.toSave())), ukraine2026, theater)
    expect(loaded.ctx.sea.map((t) => t.unit.id)).toEqual([u?.id])
    expect(loaded.ctx.units.has(u?.id ?? -1)).toBe(false)
  })
})
