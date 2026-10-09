import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { parseSave, serializeSave } from '@/sim/core/save'
import { distanceKm, type TheaterData } from '@/sim/theater/grid'
import type { UnitState } from '@/sim/core/types'

const theater = theaterJson as unknown as TheaterData
const newGame = (): Simulation => Simulation.fromScenario(ukraine2026, theater, 7)

/** Unité russe la plus proche d'une unité ukrainienne, et les unités ukrainiennes de ligne voisines. */
function setup(sim: Simulation): { target: UnitState; mine: UnitState[] } {
  const all = [...sim.ctx.units.values()]
  const ukr = all.filter((u) => u.owner === 'UKR' && ['inf', 'mech', 'tank'].includes(u.kind))
  const rus = all.filter((u) => u.owner === 'RUS')
  let best: { t: UnitState; d: number } | null = null
  for (const r of rus) {
    for (const u of ukr) {
      const d = distanceKm(u.lon, u.lat, r.lon, r.lat)
      if (!best || d < best.d) best = { t: r, d }
    }
  }
  const target = best?.t
  if (!target) throw new Error('pas de cible')
  const mine = [...ukr]
    .sort(
      (a, b) =>
        distanceKm(a.lon, a.lat, target.lon, target.lat) -
        distanceKm(b.lon, b.lat, target.lon, target.lat),
    )
    .slice(0, 4)
  return { target, mine }
}

describe('ordres visant une unité', () => {
  it('poursuite : les unités suivent la cible et gardent l’ordre en mouvement', () => {
    const sim = newGame()
    const { target, mine } = setup(sim)
    expect(
      sim.pursueUnit(
        mine.map((u) => u.id),
        target.id,
      ),
    ).toBe(null)
    for (const u of mine) {
      expect(u.order.kind).toBe('pursue')
      expect(u.order.unitId).toBe(target.id)
    }
    // La cible se déplace : au prochain recalcul, la poursuite vise sa nouvelle position.
    target.lon += 0.3
    sim.step(6)
    const still = mine.filter((u) => sim.ctx.units.has(u.id) && u.order.kind === 'pursue')
    for (const u of still) {
      expect(u.order.target?.[0]).toBeCloseTo(target.lon, 1)
    }
  })

  it('poursuite terminée quand la cible disparaît', () => {
    const sim = newGame()
    const { target, mine } = setup(sim)
    sim.pursueUnit([mine[0]?.id ?? -1], target.id)
    sim.ctx.units.delete(target.id)
    sim.step(6)
    expect(mine[0]?.order.kind).toBe('hold')
  })

  it('assaut ponctuel : attaque de la position de la cible', () => {
    const sim = newGame()
    const { target, mine } = setup(sim)
    expect(sim.assaultUnit([mine[0]?.id ?? -1], target.id)).toBe(null)
    expect(mine[0]?.order.kind).toBe('attack')
    const t = mine[0]?.order.target
    expect(t && distanceKm(t[0], t[1], target.lon, target.lat)).toBeLessThan(10)
  })

  it('refuse de viser une unité d’un pays avec qui l’on n’est pas en guerre', () => {
    const sim = newGame()
    const { mine } = setup(sim)
    expect(sim.pursueUnit([mine[0]?.id ?? -1], mine[1]?.id ?? -1)).toMatch(/guerre/)
  })
})

describe('encerclement', () => {
  it('les unités choisies forment un groupe et se répartissent autour de la cible', () => {
    const sim = newGame()
    const { target, mine } = setup(sim)
    const armyBefore = mine[0]?.armyId ?? null
    expect(
      sim.encircle(
        mine.map((u) => u.id),
        target.id,
      ),
    ).toBe(null)
    const group = [...sim.ctx.armies.values()].find((a) => a.name.startsWith('Encerclement'))
    expect(group?.unitIds.sort()).toEqual(mine.map((u) => u.id).sort())
    expect(group?.wholeFront).toBe(false)
    // L'armée d'origine garde ses autres unités sur le front.
    if (armyBefore !== null) {
      const original = sim.ctx.armies.get(armyBefore)
      expect(original?.unitIds.some((id) => mine.some((u) => u.id === id))).toBe(false)
      expect(original?.wholeFront).toBe(true)
    }
    const points = mine.map((u) => u.order.target)
    for (const p of points) {
      expect(p).toBeDefined()
      const d = distanceKm(p?.[0] ?? 0, p?.[1] ?? 0, target.lon, target.lat)
      expect(d).toBeGreaterThan(10)
      expect(d).toBeLessThan(80)
    }
    // Points distincts, répartis autour de la cible.
    const angles = points.map((p) =>
      Math.atan2((p?.[1] ?? 0) - target.lat, (p?.[0] ?? 0) - target.lon),
    )
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(Math.PI / 2)
  })

  it('détachement automatique : une partie de l’armée part, le reste tient le front', () => {
    const sim = newGame()
    const { target } = setup(sim)
    const army = [...sim.ctx.armies.values()].find((a) => a.owner === 'UKR' && a.wholeFront)
    if (!army) throw new Error('armée manquante')
    const before = army.unitIds.length
    expect(sim.encircleWithArmy(army.id, target.id)).toBe(null)
    const group = [...sim.ctx.armies.values()].find((a) => a.name.startsWith('Encerclement'))
    const detached = group?.unitIds.length ?? 0
    expect(detached).toBeGreaterThanOrEqual(2)
    expect(detached).toBeLessThan(before / 2)
    expect(army.unitIds.length).toBe(before - detached)
  })

  it('une poursuite survit à une sauvegarde', () => {
    const sim = newGame()
    const { target, mine } = setup(sim)
    sim.pursueUnit([mine[0]?.id ?? -1], target.id)
    const loaded = Simulation.fromSave(parseSave(serializeSave(sim.toSave())), ukraine2026, theater)
    expect(loaded.ctx.units.get(mine[0]?.id ?? -1)?.order).toMatchObject({
      kind: 'pursue',
      unitId: target.id,
    })
  })
})
