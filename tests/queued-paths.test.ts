import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import type { TheaterData } from '@/sim/theater/grid'
import { runtimeOf } from '@/sim/context'
import { planQueuedPaths, updateMovement } from '@/sim/systems/movement'

const theater = theaterJson as unknown as TheaterData

describe('chemins en attente (carte du monde)', () => {
  it("un ordre d'attaque dont le chemin n'est pas encore calculé n'est pas abandonné", () => {
    const sim = Simulation.fromScenario(ukraine2026, theater, 3)
    const ctx = sim.ctx
    const u = [...ctx.units.values()].find((x) => x.owner === 'UKR' && x.kind === 'inf')
    if (!u) throw new Error('unité manquante')
    u.order = { kind: 'attack', target: [u.lon + 0.5, u.lat] }
    u.path = []
    runtimeOf(ctx, u.id).pathPending = true
    updateMovement(ctx)
    // L'unité attend son chemin : l'ordre reste en cours.
    expect(u.order.kind).toBe('attack')
    planQueuedPaths(ctx)
    expect(u.path.length).toBeGreaterThan(0)
    expect(runtimeOf(ctx, u.id).pathPending).toBe(false)
  })

  it('sert les chemins en attente chacun son tour, les dernières unités créées comprises', () => {
    const sim = Simulation.fromScenario(ukraine2026, theater, 3)
    const ctx = sim.ctx
    const mine = [...ctx.units.values()].filter((x) => x.owner === 'UKR' && x.kind === 'inf')
    const last = mine[mine.length - 1]
    if (!last || mine.length < 10) throw new Error('unités manquantes')
    for (const u of ctx.units.values()) runtimeOf(ctx, u.id).pathPending = false
    // Toutes en attente, comme sur un grand front qui bouge : la dernière n'attend pas indéfiniment.
    const reset = (): void => {
      for (const u of mine) {
        if (u.id === last.id && !runtimeOf(ctx, u.id).pathPending && u.path.length > 0) continue
        u.order = { kind: 'move', target: [u.lon + 0.3, u.lat] }
        u.path = []
        runtimeOf(ctx, u.id).pathPending = true
      }
    }
    let served = -1
    for (let t = 0; t < mine.length && served < 0; t++) {
      reset()
      planQueuedPaths(ctx)
      if (last.path.length > 0) served = t
    }
    expect(served).toBeGreaterThanOrEqual(0)
    expect(served).toBeLessThan(Math.ceil(mine.length / 3) + 1)
  })
})
