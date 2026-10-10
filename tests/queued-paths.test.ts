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
})
