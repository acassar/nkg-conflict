import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { parseSave, serializeSave } from '@/sim/core/save'
import { updateArmies } from '@/sim/systems/armies'
import { distanceKm, type TheaterData } from '@/sim/theater/grid'
import type { LonLat, UnitState } from '@/sim/core/types'

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
  const launch = (): {
    sim: Simulation
    target: UnitState
    mine: UnitState[]
    parentId: number | null
  } => {
    const sim = newGame()
    const { target, mine } = setup(sim)
    const parentId = mine[0]?.armyId ?? null
    expect(
      sim.encircle(
        mine.map((u) => u.id),
        target.id,
      ),
    ).toBe(null)
    return { sim, target, mine, parentId }
  }
  const groupOf = (sim: Simulation) =>
    [...sim.ctx.armies.values()].find((a) => a.encirclement !== undefined)

  it('phase 1 : les unités quittent leur armée et gagnent leurs points d’attente', () => {
    const { sim, target, mine, parentId } = launch()
    const group = groupOf(sim)
    expect(group?.unitIds.sort()).toEqual(mine.map((u) => u.id).sort())
    expect(group?.encirclement?.phase).toBe('staging')
    expect(group?.encirclement?.parentArmyId).toBe(parentId)
    expect(group?.encirclement?.targetIds).toContain(target.id)
    for (const u of mine) {
      expect(u.order.kind).toBe('move')
      expect(group?.encirclement?.staging[u.id]).toEqual(u.order.target)
    }
    // L'armée d'origine garde ses autres unités sur le front.
    const original = parentId !== null ? sim.ctx.armies.get(parentId) : undefined
    expect(original?.unitIds.some((id) => mine.some((u) => u.id === id))).toBe(false)
  })

  it('phase 2 : toutes prêtes, elles ferment l’anneau ensemble autour de la cible', () => {
    const { sim, target, mine } = launch()
    const enc = groupOf(sim)?.encirclement
    // Toutes les unités arrivent à leur point d'attente.
    for (const u of mine) {
      const p = enc?.staging[u.id]
      if (p) [u.lon, u.lat] = p
      u.path = []
    }
    sim.step(6)
    expect(groupOf(sim)?.encirclement?.phase).toBe('closing')
    const points = mine.filter((u) => u.order.kind === 'attack').map((u) => u.order.target)
    expect(points.length).toBe(mine.length)
    const angles = points.map((p) =>
      Math.atan2((p?.[1] ?? 0) - target.lat, (p?.[0] ?? 0) - target.lon),
    )
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(Math.PI / 2)
  })

  it('le groupe rejoint son armée quand le groupe ennemi est détruit', () => {
    const { sim, mine, parentId } = launch()
    for (const id of groupOf(sim)?.encirclement?.targetIds ?? []) sim.ctx.units.delete(id)
    sim.step(6)
    expect(groupOf(sim)).toBeUndefined()
    const parent = parentId !== null ? sim.ctx.armies.get(parentId) : undefined
    for (const u of mine.filter((x) => sim.ctx.units.has(x.id))) {
      expect(u.armyId).toBe(parentId)
      expect(parent?.unitIds).toContain(u.id)
    }
  })

  it('le groupe rejoint son armée après 7 jours de siège', () => {
    const { sim, mine, parentId } = launch()
    const enc = groupOf(sim)?.encirclement
    if (!enc) throw new Error('encerclement manquant')
    enc.phase = 'closing'
    enc.closeTick = sim.ctx.tick - 7 * 24
    sim.step(6)
    expect(groupOf(sim)).toBeUndefined()
    expect(mine.filter((u) => sim.ctx.units.has(u.id)).every((u) => u.armyId === parentId)).toBe(
      true,
    )
  })

  it('le joueur peut mettre fin à l’encerclement', () => {
    const { sim, parentId, mine } = launch()
    const group = groupOf(sim)
    sim.endEncirclement(group?.id ?? -1)
    expect(groupOf(sim)).toBeUndefined()
    expect(mine.every((u) => u.armyId === parentId)).toBe(true)
  })

  it('détachement automatique : une partie de l’armée part, le reste tient le front', () => {
    const sim = newGame()
    const { target } = setup(sim)
    const army = [...sim.ctx.armies.values()].find((a) => a.owner === 'UKR' && a.wholeFront)
    if (!army) throw new Error('armée manquante')
    const before = army.unitIds.length
    expect(sim.encircleWithArmy(army.id, target.id)).toBe(null)
    const detached = groupOf(sim)?.unitIds.length ?? 0
    expect(detached).toBeGreaterThanOrEqual(2)
    expect(detached).toBeLessThan(before / 2)
    expect(army.unitIds.length).toBe(before - detached)
    expect(groupOf(sim)?.encirclement?.parentArmyId).toBe(army.id)
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

describe('ordre direct à une unité d’armée', () => {
  /** Unité de ligne ukrainienne d'une armée, la plus éloignée des Russes (pas de combat en route). */
  function quietArmyUnit(sim: Simulation): UnitState {
    const all = [...sim.ctx.units.values()]
    const rus = all.filter((u) => u.owner === 'RUS')
    const nearest = (u: UnitState): number =>
      Math.min(...rus.map((r) => distanceKm(u.lon, u.lat, r.lon, r.lat)))
    const mine = all
      .filter((u) => u.owner === 'UKR' && u.armyId !== null && ['inf', 'mech'].includes(u.kind))
      .sort((a, b) => nearest(b) - nearest(a))
    const unit = mine[0]
    if (!unit) throw new Error('pas d’unité d’armée')
    return unit
  }

  it('le déplacement n’est pas écrasé par la répartition du front, puis l’armée reprend l’unité', () => {
    const sim = newGame()
    const u = quietArmyUnit(sim)
    const target: LonLat = [u.lon - 1, u.lat]
    sim.orderUnits([u.id], 'move', target)
    expect(u.direct).toEqual({})
    // Pendant le trajet, la répartition du front passe et laisse l'unité à son ordre.
    sim.step(2)
    updateArmies(sim.ctx)
    expect(u.order).toMatchObject({ kind: 'move', target })
    let hours = 2
    while (u.order.kind === 'move' && hours < 24 * 6) {
      sim.step(1)
      hours++
      expect(u.order.kind).not.toBe('front')
    }
    expect(u.order.kind).toBe('hold')
    expect(distanceKm(u.lon, u.lat, target[0], target[1])).toBeLessThan(2)
    expect(u.direct?.doneAt).toBe(sim.ctx.tick)
    // À l'heure de l'arrivée, elle tient sa position.
    updateArmies(sim.ctx)
    expect(u.order.kind).toBe('hold')
    // Ensuite, l'armée la reprend à sa répartition suivante.
    sim.step(1)
    updateArmies(sim.ctx)
    expect(u.order.kind).toBe('front')
    expect(u.direct).toBeUndefined()
  })

  it('un repli reste prioritaire et survit à une sauvegarde', () => {
    const sim = newGame()
    const u = quietArmyUnit(sim)
    sim.orderUnits([u.id], 'retreat', [u.lon - 1, u.lat])
    const loaded = Simulation.fromSave(parseSave(serializeSave(sim.toSave())), ukraine2026, theater)
    const v = loaded.ctx.units.get(u.id)
    expect(v?.direct).toEqual({})
    loaded.step(1)
    updateArmies(loaded.ctx)
    expect(v?.order.kind).toBe('retreat')
  })

  it('annuler l’ordre rend l’unité à son armée', () => {
    const sim = newGame()
    const u = quietArmyUnit(sim)
    sim.orderUnits([u.id], 'move', [u.lon - 0.25, u.lat])
    sim.cancelOrders([u.id])
    expect(u.direct).toBeUndefined()
    updateArmies(sim.ctx)
    expect(u.order.kind).toBe('front')
  })
})
