import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import {
  AIR_CAPACITY,
  friendlyComponent,
  pickDestination,
  transportCost,
  transportHours,
} from '@/sim/systems/transport'
import { navalCapacity } from '@/sim/systems/naval'
import { parseSave, serializeSave } from '@/sim/core/save'
import { distanceKm, type TheaterData } from '@/sim/theater/grid'
import type { LonLat, UnitKind, UnitState } from '@/sim/core/types'

const theater = theaterJson as unknown as TheaterData
const newGame = (): Simulation => Simulation.fromScenario(ukraine2026, theater, 3)

const city = (sim: Simulation, name: string): LonLat => {
  const c = sim.ctx.cityStates.get(name)
  if (!c) throw new Error(`ville absente : ${name}`)
  return [c.def.lon, c.def.lat]
}

/** Unités ukrainiennes d'un type, placées dans une ville. */
const placeAt = (sim: Simulation, name: string, kind: UnitKind, n: number): UnitState[] => {
  const [lon, lat] = city(sim, name)
  const units = [...sim.ctx.units.values()]
    .filter((u) => u.owner === 'UKR' && u.kind === kind && !sim.ctx.sea.some((t) => t.unit === u))
    .slice(0, n)
  for (const u of units) {
    u.lon = lon
    u.lat = lat
  }
  return units
}

/** Sevastopol devient une enclave ukrainienne en Crimée russe : ni rail, mais un port et un aérodrome. */
const enclave = (sim: Simulation): LonLat => {
  const at = city(sim, 'Sevastopol')
  const c = sim.ctx.cityStates.get('Sevastopol')
  if (!c) throw new Error('ville absente')
  const side = sim.sideOf('UKR')
  c.owner = side
  sim.ctx.grid.setOwner(sim.ctx.grid.cellAt(at[0], at[1]), side)
  return at
}

describe('transport stratégique', () => {
  it('par le rail entre deux villes reliées par un territoire ami', () => {
    const sim = newGame()
    const [u] = placeAt(sim, 'Lviv', 'tank', 1)
    if (!u) throw new Error('unité absente')
    const production = sim.ctx.economies.get('UKR')?.production ?? 0
    const kyiv = city(sim, 'Kyiv')
    // Le clic n'a pas à tomber sur la ville : la plus proche est retenue.
    expect(pickDestination(sim.ctx, 'UKR', [kyiv[0] + 0.2, kyiv[1]])?.def.name).toBe('Kyiv')
    expect(sim.transportUnits([u.id], [kyiv[0] + 0.2, kyiv[1]])).toBe(null)
    expect(sim.ctx.units.has(u.id)).toBe(false)
    const t = sim.ctx.sea[0]
    const km = distanceKm(...city(sim, 'Lviv'), ...kyiv)
    expect(t?.mode).toBe('rail')
    expect(t?.dest).toBe('Kyiv')
    expect(t?.arriveTick).toBe(sim.ctx.tick + transportHours('rail', km))
    expect(sim.ctx.economies.get('UKR')?.production).toBeCloseTo(
      production - transportCost('tank', 'rail', km),
    )
    // Pas de place navale prise ; visible dans l'état publié.
    expect(sim.snapshot().naval.atSea).toHaveLength(0)
    expect(sim.snapshot().transport.inTransit.map((x) => [x.id, x.mode])).toEqual([[u.id, 'rail']])
    sim.step((t?.arriveTick ?? 0) - sim.ctx.tick)
    const arrived = sim.ctx.units.get(u.id)
    expect(arrived).toBeDefined()
    expect(distanceKm(arrived?.lon ?? 0, arrived?.lat ?? 0, ...kyiv)).toBeLessThan(15)
    expect(sim.ctx.sea).toHaveLength(0)
    // Lviv – Kyiv (470 km) : un peu plus d'une journée.
    expect(transportHours('rail', km)).toBeGreaterThan(24)
    expect(transportHours('rail', km)).toBeLessThan(48)
  })

  it('refuse une ville ennemie ou une unité au contact', () => {
    const sim = newGame()
    const [u] = placeAt(sim, 'Lviv', 'inf', 1)
    expect(sim.transportUnits([u?.id ?? -1], city(sim, 'Rostov'))).toMatch(/ville amie/)
    // Une unité ukrainienne sur la ligne de front.
    const front = [...sim.ctx.units.values()].find(
      (x) =>
        x.owner === 'UKR' &&
        [...sim.ctx.units.values()].some(
          (e) => e.owner === 'RUS' && distanceKm(x.lon, x.lat, e.lon, e.lat) < 10,
        ),
    )
    if (!front) throw new Error('aucune unité au contact')
    expect(sim.transportUnits([front.id], city(sim, 'Lviv'))).toMatch(/contact/)
  })

  it('par la mer vers un port isolé, puis par les airs pour les unités légères', () => {
    const sim = newGame()
    const target = enclave(sim)
    const linked = friendlyComponent(sim.ctx, sim.sideOf('UKR'), sim.ctx.grid.cellAt(...target))
    const kyiv = city(sim, 'Kyiv')
    expect(linked[sim.ctx.grid.cellAt(...kyiv)]).toBe(0)
    // Depuis Odessa : par la mer, dans la capacité navale.
    const [boat] = placeAt(sim, 'Odessa', 'mech', 1)
    expect(sim.transportUnits([boat?.id ?? -1], target)).toBe(null)
    expect(sim.ctx.sea.at(-1)?.mode).toBe('sea')
    expect(sim.snapshot().naval.atSea).toHaveLength(1)
    expect(navalCapacity(sim.ctx, 'UKR')).toBeGreaterThan(0)
    // Depuis Kyiv, loin de tout port : les blindés ne volent pas, l'infanterie si, dans la limite des places.
    const [tank] = placeAt(sim, 'Kyiv', 'tank', 1)
    expect(sim.transportUnits([tank?.id ?? -1], target)).toMatch(/Aucun trajet/)
    const inf = placeAt(sim, 'Kyiv', 'inf', AIR_CAPACITY + 1)
    expect(
      sim.transportUnits(
        inf.map((x) => x.id),
        target,
      ),
    ).toMatch(/restent sur place/)
    const air = sim.ctx.sea.filter((t) => t.mode === 'air')
    expect(air).toHaveLength(AIR_CAPACITY)
    expect(air[0]?.arriveTick).toBe(
      sim.ctx.tick + transportHours('air', distanceKm(...kyiv, ...target)),
    )
    // L'avion coûte plus cher que le rail.
    expect(transportCost('inf', 'air', 800)).toBeGreaterThan(transportCost('inf', 'rail', 800))
  })

  it("revient au départ si la ville d'arrivée a été prise", () => {
    const sim = newGame()
    const target = enclave(sim)
    const [u] = placeAt(sim, 'Odessa', 'inf', 1)
    sim.transportUnits([u?.id ?? -1], target)
    const sevastopol = sim.ctx.cityStates.get('Sevastopol')
    if (sevastopol) sevastopol.owner = sim.sideOf('RUS')
    const t = sim.ctx.sea[0]
    sim.step((t?.arriveTick ?? 0) - sim.ctx.tick)
    const back = sim.ctx.units.get(u?.id ?? -1)
    expect(back).toBeDefined()
    expect(distanceKm(back?.lon ?? 0, back?.lat ?? 0, ...city(sim, 'Odessa'))).toBeLessThan(15)
  })

  it('les unités en route sont gardées dans la sauvegarde', () => {
    const sim = newGame()
    const [u] = placeAt(sim, 'Lviv', 'inf', 1)
    sim.transportUnits([u?.id ?? -1], city(sim, 'Kyiv'))
    const loaded = Simulation.fromSave(parseSave(serializeSave(sim.toSave())), ukraine2026, theater)
    expect(loaded.ctx.sea.map((t) => [t.unit.id, t.mode, t.dest])).toEqual([
      [u?.id, 'rail', 'Kyiv'],
    ])
  })
})
