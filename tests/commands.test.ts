import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { parseSave, serializeSave } from '@/sim/core/save'
import { distanceKm, type TheaterData } from '@/sim/theater/grid'
import { runtimeOf, sideIndex } from '@/sim/context'
import type { LonLat, UnitState } from '@/sim/core/types'
import { combatModifiers, firePower } from '@/sim/systems/combat'
import { updatePostureReflexes } from '@/sim/systems/postures'
import { frontCells } from '@/sim/systems/armies'

const theater = theaterJson as unknown as TheaterData
const newGame = (): Simulation => Simulation.fromScenario(ukraine2026, theater, 7)

const line = (sim: Simulation, owner: string): UnitState[] =>
  [...sim.ctx.units.values()].filter(
    (u) => u.owner === owner && ['inf', 'mech', 'tank'].includes(u.kind),
  )

/** Paire (unité ukrainienne, unité russe) la plus proche. */
function closestPair(sim: Simulation): { mine: UnitState; enemy: UnitState } {
  let best: { mine: UnitState; enemy: UnitState; d: number } | null = null
  for (const m of line(sim, 'UKR')) {
    for (const e of line(sim, 'RUS')) {
      const d = distanceKm(m.lon, m.lat, e.lon, e.lat)
      if (!best || d < best.d) best = { mine: m, enemy: e, d }
    }
  }
  if (!best) throw new Error('pas de paire')
  return best
}

const playerArmy = (sim: Simulation) => {
  const army = [...sim.ctx.armies.values()].find((a) => a.owner === 'UKR' && a.wholeFront)
  if (!army) throw new Error('armée manquante')
  return army
}

describe('annuler un ordre', () => {
  it('les unités s’arrêtent et oublient leur chemin', () => {
    const sim = newGame()
    const u = line(sim, 'UKR')[0]
    if (!u) throw new Error('unité manquante')
    sim.orderUnits([u.id], 'move', [u.lon + 1, u.lat])
    expect(u.order.kind).toBe('move')
    sim.cancelOrders([u.id])
    expect(u.order.kind).toBe('hold')
    expect(u.path).toEqual([])
  })
})

describe('postures', () => {
  it('modifient la puissance de feu et apparaissent dans les modificateurs', () => {
    const sim = newGame()
    const u = line(sim, 'UKR')[0]
    if (!u) throw new Error('unité manquante')
    const balanced = firePower(sim.ctx, u)
    sim.setPosture([u.id], 'maxDamage')
    expect(firePower(sim.ctx, u)).toBeGreaterThan(balanced)
    const mods = combatModifiers(sim.ctx, u)
    expect(mods.attack.find((m) => m.label.startsWith('Posture'))?.value).toBeGreaterThan(1)
    expect(mods.defense.find((m) => m.label.startsWith('Posture'))?.value).toBeLessThan(1)
    sim.setPosture([u.id], 'maxDefense')
    expect(firePower(sim.ctx, u)).toBeLessThan(balanced)
  })

  it('la posture d’armée s’applique à toutes ses unités', () => {
    const sim = newGame()
    const army = playerArmy(sim)
    sim.setArmyPosture(army.id, 'defensive')
    expect(army.unitIds.every((id) => sim.ctx.units.get(id)?.posture === 'defensive')).toBe(true)
  })

  it('dégâts max : poursuit un ennemi en déroute à portée ; défense max : reste en place', () => {
    const sim = newGame()
    const { mine, enemy } = closestPair(sim)
    enemy.lon = mine.lon + 0.15
    enemy.lat = mine.lat
    runtimeOf(sim.ctx, enemy.id).routed = true
    mine.order = { kind: 'hold' }
    sim.setPosture([mine.id], 'maxDefense')
    updatePostureReflexes(sim.ctx)
    expect(mine.order.kind).toBe('hold')
    sim.setPosture([mine.id], 'maxDamage')
    updatePostureReflexes(sim.ctx)
    expect(mine.order.kind).toBe('pursue')
    expect(mine.order.unitId).toBe(enemy.id)
  })
})

describe('front de l’armée', () => {
  it('une portion tracée loin du front s’y accroche, et le tracé suit le front réel', () => {
    const sim = newGame()
    const army = playerArmy(sim)
    const side = sideIndex(sim.ctx, 'UKR')
    const cells = frontCells(sim.ctx, side, null)
    const a = cells[Math.floor(cells.length * 0.3)]
    const b = cells[Math.floor(cells.length * 0.5)]
    if (!a || !b) throw new Error('front vide')
    const g = sim.ctx.grid
    // Portion tracée 30 km en retrait du front.
    const off = (c: { cell: number }): LonLat => [g.lonOf(c.cell) - 0.4, g.latOf(c.cell)]
    sim.setArmyFront(army.id, [off(a), off(b)])
    const front = army.front
    if (!front) throw new Error('portion absente')
    const onFront = (p: LonLat): boolean =>
      cells.some((c) => distanceKm(p[0], p[1], g.lonOf(c.cell), g.latOf(c.cell)) < 1)
    expect(onFront(front[0])).toBe(true)
    expect(onFront(front[1])).toBe(true)
    expect(army.frontLine?.length).toBeGreaterThan(0)
  })

  it('le tracé du front est continu, sans demi-tour, et colle à la ligne de contact', () => {
    const sim = newGame()
    sim.aiControlsPlayer = true
    sim.step(24 * 20)
    const g = sim.ctx.grid
    const cellKm = g.cell * 111
    for (const army of sim.ctx.armies.values()) {
      const lines = army.frontLine ?? []
      if (lines.length === 0) continue
      // Quelques secteurs au plus, jamais une quinzaine de morceaux.
      expect(lines.length).toBeLessThanOrEqual(4)
      const cells = frontCells(sim.ctx, sideIndex(sim.ctx, army.owner), null)
      for (const l of lines) {
        for (let i = 1; i < l.length; i++) {
          const [p0, p1, p2] = [l[i - 1] as LonLat, l[i] as LonLat, l[i + 1]]
          // Points rapprochés : pas de grand saut d'un bout à l'autre du front.
          expect(distanceKm(p0[0], p0[1], p1[0], p1[1])).toBeLessThan(25)
          if (p2) {
            // Pas d'éperon : le tracé ne repart jamais en arrière.
            const dot = (p1[0] - p0[0]) * (p2[0] - p1[0]) + (p1[1] - p0[1]) * (p2[1] - p1[1])
            expect(dot).toBeGreaterThanOrEqual(0)
          }
        }
        // Chaque point est sur la ligne de contact (à moins de deux cellules d'une cellule de front).
        for (const p of l) {
          const near = cells.some(
            (c) => distanceKm(p[0], p[1], g.lonOf(c.cell), g.latOf(c.cell)) < 2 * cellKm,
          )
          expect(near).toBe(true)
        }
      }
    }
  })

  it('chaque unité prend le poste le plus proche (pas de traversée de la carte)', () => {
    const sim = newGame()
    const army = playerArmy(sim)
    const units = army.unitIds
      .map((id) => sim.ctx.units.get(id))
      .filter((u): u is UnitState => !!u && u.order.kind === 'front' && !!u.order.target)
    expect(units.length).toBeGreaterThan(5)
    const trips = units.map((u) => {
      const t = u.order.target as LonLat
      return distanceKm(u.lon, u.lat, t[0], t[1])
    })
    trips.sort((x, y) => x - y)
    // La médiane des trajets reste courte comparée à la longueur du front (plus de 1 000 km).
    expect(trips[Math.floor(trips.length / 2)]).toBeLessThan(250)
  })
})

describe('offensive avec une partie de l’armée', () => {
  it('seules les unités choisies attaquent, les autres tiennent le front', () => {
    const sim = newGame()
    const army = playerArmy(sim)
    const chosen = army.unitIds.filter((id) => sim.ctx.units.get(id)?.kind !== 'art').slice(0, 3)
    const { enemy } = closestPair(sim)
    sim.planOffensive(
      army.id,
      [enemy.lon - 0.3, enemy.lat],
      [enemy.lon, enemy.lat],
      [...chosen, -5],
    )
    expect(army.offensive?.unitIds).toEqual(chosen)
    sim.launchOffensive(army.id)
    const attacking = army.unitIds.filter((id) => sim.ctx.units.get(id)?.order.kind === 'attack')
    expect(attacking.sort()).toEqual([...chosen].sort())
  })
})

describe('encerclement par toute une armée', () => {
  it('pas de nouveau groupe : l’armée encercle puis reprend son front', () => {
    const sim = newGame()
    const { enemy } = closestPair(sim)
    const near = line(sim, 'UKR')
      .sort(
        (a, b) =>
          distanceKm(a.lon, a.lat, enemy.lon, enemy.lat) -
          distanceKm(b.lon, b.lat, enemy.lon, enemy.lat),
      )
      .slice(0, 3)
    const armyId = sim.createArmy(
      'Groupe Nord',
      near.map((u) => u.id),
    )
    const army = sim.ctx.armies.get(armyId)
    if (!army) throw new Error('armée manquante')
    sim.setArmyFront(armyId, 'whole')
    const before = sim.ctx.armies.size
    expect(
      sim.encircle(
        near.map((u) => u.id),
        enemy.id,
      ),
    ).toBe(null)
    expect(sim.ctx.armies.size).toBe(before)
    expect(army.encirclement?.parentArmyId).toBe(armyId)
    expect(army.wholeFront).toBe(false)
    sim.endEncirclement(armyId)
    expect(sim.ctx.armies.get(armyId)).toBe(army)
    expect(army.encirclement).toBeUndefined()
    expect(army.wholeFront).toBe(true)
  })
})

describe('écran de bataille', () => {
  it('rapport des deux camps avec les modificateurs', () => {
    const sim = newGame()
    let engaged: UnitState | undefined
    for (let h = 0; h < 24 * 5 && !engaged; h += 6) {
      sim.step(6)
      engaged = line(sim, 'UKR').find((u) => runtimeOf(sim.ctx, u.id).engagedWith !== null)
    }
    if (!engaged) throw new Error('aucun combat')
    const report = sim.battleReport([engaged.id])
    expect(report).not.toBe(null)
    expect(report?.a.every((u) => u.owner === 'UKR')).toBe(true)
    expect(report?.b.length).toBeGreaterThan(0)
    expect(report?.b.every((u) => u.owner === 'RUS')).toBe(true)
    const labels = report?.a[0]?.modifiers.attack.map((m) => m.label) ?? []
    expect(labels.some((l) => l.startsWith('Posture'))).toBe(true)
    const defense = report?.a[0]?.modifiers.defense.map((m) => m.label) ?? []
    expect(defense.some((l) => l.startsWith('Terrain'))).toBe(true)
  })
})

describe('donneurs hors carte (théâtre ukrainien)', () => {
  it('existent sans territoire, aident dès le départ, et ne peuvent pas entrer en guerre', () => {
    const sim = newGame()
    const ctx = sim.ctx
    expect(ctx.countries.get('USA')?.offMap).toBe(true)
    expect(sideIndex(ctx, 'USA')).toBeGreaterThan(0)
    expect(ctx.grid.countOwned(sideIndex(ctx, 'USA'))).toBe(0)
    expect(ctx.politics.aids.filter((a) => a.to === 'UKR').length).toBe(5)
    expect(ctx.politics.aids.filter((a) => a.to === 'RUS').length).toBe(2)
    expect(sim.declareWar('USA')).toMatch(/hors du théâtre/)
    expect([...ctx.units.values()].some((u) => u.owner === 'USA')).toBe(false)
    sim.step(24 * 3)
    const usa = ctx.politics.aids.find((a) => a.from === 'USA' && a.to === 'UKR')
    expect(usa?.lastDay.munitions).toBeGreaterThan(0)
    expect(usa?.equipment).toBeGreaterThan(0)
    // Une partie avec donneurs survit à une sauvegarde.
    const loaded = Simulation.fromSave(parseSave(serializeSave(sim.toSave())), ukraine2026, theater)
    expect(loaded.ctx.politics.aids.length).toBe(ctx.politics.aids.length)
  })

  it('le joueur peut demander l’aide d’un donneur hors carte', () => {
    const sim = newGame()
    sim.ctx.politics.aids = sim.ctx.politics.aids.filter((a) => a.from !== 'FRA')
    expect(sim.requestAid('FRA')).toBe(null)
    expect(sim.ctx.politics.aids.some((a) => a.from === 'FRA' && a.to === 'UKR')).toBe(true)
  })
})
