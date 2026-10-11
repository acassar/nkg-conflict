import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { sameData, SnapshotPublisher, SnapshotReceiver } from '@/sim/publish'
import type { TheaterData } from '@/sim/theater/grid'

const theater = theaterJson as unknown as TheaterData

/** Publication telle que transmise au thread de l'interface (copie structurée). */
const wire = <T>(v: T): T => structuredClone(v)

describe("publication de l'état par différences", () => {
  it("l'état reconstruit est identique à l'état complet, partie en cours", () => {
    const sim = Simulation.fromScenario(ukraine2026, theater, 3)
    sim.setPaused(false)
    const publisher = new SnapshotPublisher()
    const receiver = new SnapshotReceiver()
    for (let k = 0; k < 12; k++) {
      sim.step(k === 0 ? 1 : 6)
      const full = sim.snapshot(false, false)
      const rebuilt = receiver.apply(wire(publisher.encode(full)))
      expect(rebuilt.units).toEqual(full.units)
      expect(rebuilt.formations).toEqual(full.formations)
      expect(rebuilt.cities).toEqual(full.cities)
      expect(rebuilt.countries).toEqual(full.countries)
      expect(rebuilt.tick).toBe(full.tick)
    }
  })

  it("n'envoie que les unités modifiées et les listes qui changent", () => {
    const sim = Simulation.fromScenario(ukraine2026, theater, 3)
    const publisher = new SnapshotPublisher()
    const first = publisher.encode(sim.snapshot(false, false))
    expect(first.unitsDelta.full).toBe(true)
    expect(first.unitsDelta.changed.length).toBeGreaterThan(50)
    // Partie en pause : rien n'a bougé, rien n'est renvoyé.
    const idle = publisher.encode(sim.snapshot(false, false))
    expect(idle.unitsDelta).toEqual({ full: false, changed: [], removed: [] })
    expect(idle.formations).toBeNull()
    expect(idle.cities).toBeNull()
    expect(idle.countries).toBeNull()
    // Après une remise à zéro (nouvelle partie, chargement), tout repart.
    publisher.reset()
    const again = publisher.encode(sim.snapshot(false, false))
    expect(again.unitsDelta.full).toBe(true)
    expect(again.formations).not.toBeNull()
  })

  it('les unités disparues sont retirées, les nouvelles ajoutées à la fin', () => {
    const publisher = new SnapshotPublisher()
    const receiver = new SnapshotReceiver()
    const sim = Simulation.fromScenario(ukraine2026, theater, 3)
    const base = sim.snapshot(false, false)
    const [a, b, c] = base.units
    receiver.apply(wire(publisher.encode({ ...base, units: [a!, b!, c!] })))
    const moved = { ...b!, lon: b!.lon + 0.1 }
    const extra = { ...a!, id: 999_999 }
    const out = receiver.apply(wire(publisher.encode({ ...base, units: [a!, moved, extra] })))
    expect(out.units.map((u) => u.id)).toEqual([a!.id, b!.id, 999_999])
    expect(out.units[1]?.lon).toBeCloseTo(moved.lon)
  })

  it('compare les données simples en profondeur', () => {
    expect(sameData({ a: [1, [2, 3]], b: null }, { a: [1, [2, 3]], b: null })).toBe(true)
    expect(sameData({ a: [1, 2] }, { a: [1, 3] })).toBe(false)
    expect(sameData({ a: 1 }, { a: 1, b: undefined })).toBe(false)
    expect(sameData([1], { 0: 1 })).toBe(false)
    expect(sameData(NaN, NaN)).toBe(true)
  })
})
