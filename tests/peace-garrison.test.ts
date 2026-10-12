import fs from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { Simulation } from '@/sim/simulation'
import { buildScenario } from '@/sim/scenarios'
import { loadTheater } from '@/sim/theater/load'
import type { TheaterData } from '@/sim/theater/grid'
import { distanceKm } from '@/sim/theater/grid'
import { sideIndex } from '@/sim/context'
import { makePeace, setRelation } from '@/sim/politics/politics'
import { spotNear } from '@/sim/politics/mobilization'
import { updateArmies } from '@/sim/systems/armies'
import { missionGroups } from '@/composables/missions'
import type { ArmyState } from '@/sim/core/types'

let theater: TheaterData
const readPublic = async (p: string): Promise<ArrayBuffer> => {
  const buf = fs.readFileSync(new URL(`../public/${p}`, import.meta.url))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

beforeAll(async () => {
  theater = await loadTheater('world', readPublic)
})

/** La France, deux armées de brigades de ligne prises dans l'est du pays. */
function france(): { sim: Simulation; a: number; b: number } {
  const sim = Simulation.fromScenario(buildScenario('world-2026', 'FRA'), theater, 5, 'FRA')
  const line = [...sim.ctx.units.values()]
    .filter((u) => u.owner === 'FRA' && u.kind === 'inf')
    .sort((p, q) => q.lon - p.lon)
  const a = sim.createArmy(
    '1re armée',
    line.slice(0, 4).map((u) => u.id),
  )
  const b = sim.createArmy(
    '2e armée',
    line.slice(4, 8).map((u) => u.id),
  )
  return { sim, a, b }
}

const army = (sim: Simulation, id: number): ArmyState => sim.ctx.armies.get(id) as ArmyState

describe('retour en garnison à la paix', () => {
  it("l'armée sans frontière rentre en garnison, celle qui tient une frontière reste", () => {
    const { sim, a, b } = france()
    const ctx = sim.ctx
    sim.setArmyFront(a, 'whole')
    sim.setArmyBorder(b, { country: 'DEU' })
    setRelation(ctx, 'FRA', 'CHE', -100)
    expect(sim.declareWar('CHE')).toBe(null)
    updateArmies(ctx)
    expect(army(sim, a).atWar).toBe(true)
    const war = ctx.politics.wars.find((w) => w.attackers.includes('FRA'))!
    makePeace(ctx, war.id, 'FRA', 'white')
    updateArmies(ctx)
    const held = army(sim, a)
    expect(held.atWar).toBeUndefined()
    // Garde son front pour la prochaine guerre.
    expect(held.wholeFront).toBe(true)
    const fra = sideIndex(ctx, 'FRA')
    const cities = [...ctx.cityStates.values()].filter((c) => c.owner === fra)
    for (const id of held.unitIds) {
      const u = ctx.units.get(id)!
      expect(u.order.kind).toBe('move')
      const t = u.order.target!
      const near = cities.some((c) => distanceKm(t[0], t[1], c.def.lon, c.def.lat) < 40)
      expect(near).toBe(true)
    }
    expect(sim.snapshot().events.some((e) => e.text.includes('rentre en garnison'))).toBe(true)
    // La frontière tenue reste tenue.
    for (const id of army(sim, b).unitIds) expect(ctx.units.get(id)!.order.kind).toBe('front')
    // Plus rien la fois suivante : les garnisons du monde ne sont pas redéployées chaque jour.
    const first = held.unitIds.map((id) => ctx.units.get(id)!.order.target)
    updateArmies(ctx)
    expect(held.unitIds.map((id) => ctx.units.get(id)!.order.target)).toEqual(first)
  })

  it('les places autour d’une ville sont distinctes et à côté de la ville', () => {
    const { sim } = france()
    const ctx = sim.ctx
    const fra = sideIndex(ctx, 'FRA')
    const lyon = ctx.cityStates.get('Lyon')!
    const spots = Array.from({ length: 6 }, (_, n) =>
      spotNear(ctx, fra, lyon.def.lon, lyon.def.lat, n),
    )
    for (const s of spots) {
      expect(s).not.toBe(null)
      const km = distanceKm(s![0], s![1], lyon.def.lon, lyon.def.lat)
      expect(km).toBeGreaterThan(5)
      expect(km).toBeLessThan(25)
    }
    expect(new Set(spots.map((s) => s!.join())).size).toBe(6)
  })

  it('missions de guerre masquées en paix, sauf celle en cours', () => {
    const kinds = (atWar: boolean, cur: Parameters<typeof missionGroups>[1]) =>
      missionGroups(atWar, cur).flatMap((g) => g.kinds)
    expect(kinds(true, 'hold')).toContain('breach')
    expect(kinds(false, 'hold')).not.toContain('breach')
    expect(kinds(false, 'hold')).not.toContain('retreat')
    expect(kinds(false, 'hold')).toContain('advance')
    expect(missionGroups(false, 'hold').map((g) => g.label)).toEqual(['Défendre', 'Attaquer'])
    expect(kinds(false, 'retreat')).toContain('retreat')
  })
})
