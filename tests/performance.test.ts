import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { multiplyForces, profileReport } from '@/sim/bench'
import { territoryShares } from '@/sim/economy/national'
import { WarIndex } from '@/sim/systems/spatial'
import { sideIndex } from '@/sim/context'
import type { TheaterData } from '@/sim/theater/grid'

const theater = theaterJson as unknown as TheaterData
const newGame = (): Simulation => Simulation.fromScenario(ukraine2026, theater, 7)

/** État comparable d'une partie : positions, forces et propriétaires des cellules. */
function fingerprint(sim: Simulation): string {
  const units = [...sim.ctx.units.values()].map(
    (u) => `${u.id}:${u.lon.toFixed(6)},${u.lat.toFixed(6)},${u.strength.toFixed(6)}`,
  )
  let owners = 0
  for (let i = 0; i < sim.ctx.grid.size; i++)
    owners = (owners * 31 + (sim.ctx.grid.owner[i] ?? 0)) | 0
  return `${units.join(';')}|${owners}`
}

describe('mesure des performances', () => {
  it('multiplie les unités en conservant la force totale et les armées', () => {
    const sim = newGame()
    const ctx = sim.ctx
    const before = ctx.units.size
    const strength = [...ctx.units.values()].reduce((n, u) => n + u.strength, 0)
    multiplyForces(ctx, 3)
    expect(ctx.units.size).toBe(before * 3)
    const after = [...ctx.units.values()].reduce((n, u) => n + u.strength, 0)
    expect(after).toBeCloseTo(strength, 6)
    for (const army of ctx.armies.values()) {
      for (const id of army.unitIds) expect(ctx.units.get(id)?.armyId).toBe(army.id)
    }
    sim.step(48)
    for (const u of ctx.units.values()) expect(Number.isFinite(u.lon)).toBe(true)
  })

  it('le profilage mesure chaque système sans changer la partie', () => {
    const plain = newGame()
    const profiled = newGame()
    profiled.profile = new Map()
    plain.step(72)
    profiled.step(72)
    expect(fingerprint(profiled)).toBe(fingerprint(plain))
    const report = profileReport(profiled.profile, profiled.tick)
    const names = report.map((r) => r.name)
    for (const n of ['combat', 'mouvement', 'territoire', 'ravitaillement', 'armées']) {
      expect(names).toContain(n)
    }
    expect(report[0]!.msPerHour).toBeGreaterThanOrEqual(report[report.length - 1]!.msPerHour)
    expect(report.reduce((n, r) => n + r.share, 0)).toBeCloseTo(1, 6)
  })

  it('les parts de territoire suivies par la grille égalent un parcours complet', () => {
    const sim = newGame()
    sim.step(24 * 10)
    const ctx = sim.ctx
    const tracked = territoryShares(ctx)
    // Même calcul sans le suivi de la grille (tableau d'origine copié : plus reconnu par la grille).
    const scanned = territoryShares({ ...ctx, homeOwner: ctx.homeOwner.slice(), tick: -1 })
    expect([...tracked.home]).toEqual([...scanned.home])
    expect([...tracked.occupied.entries()]).toEqual([...scanned.occupied.entries()])
    // Une cellule prise met les comptes à jour aussitôt.
    const ukr = sideIndex(ctx, 'UKR')
    const rus = sideIndex(ctx, 'RUS')
    let cell = -1
    for (let i = 0; i < ctx.grid.size && cell < 0; i++) {
      if (ctx.grid.owner[i] === ukr && ctx.homeOwner[i] === ukr) cell = i
    }
    ctx.grid.setOwner(cell, rus)
    ctx.tick++
    const home = territoryShares(ctx).home[ukr] ?? 0
    expect(home).toBeLessThan(tracked.home[ukr] ?? 0)
    expect(home).toBeCloseTo(
      territoryShares({ ...ctx, homeOwner: ctx.homeOwner.slice() }).home[ukr] ?? 0,
      12,
    )
  })

  it("l'index spatial s'arrête au premier ennemi retenu", () => {
    const sim = newGame()
    const ctx = sim.ctx
    const index = new WarIndex(ctx)
    const u = [...ctx.units.values()].find((x) => x.owner === 'UKR')!
    const side = sideIndex(ctx, 'UKR')
    let all = 0
    index.forEachEnemyAt(side, u.lon, u.lat, 2000, () => {
      all++
      return false
    })
    expect(all).toBeGreaterThan(1)
    let seen = 0
    const stopped = index.forEachEnemyAt(side, u.lon, u.lat, 2000, () => ++seen === 1)
    expect(stopped).toBe(true)
    expect(seen).toBe(1)
  })
})
