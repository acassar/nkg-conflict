import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { parseSave, serializeSave } from '@/sim/core/save'
import { runtimeOf, sideIndex } from '@/sim/context'
import { distanceKm, type TheaterData } from '@/sim/theater/grid'
import { planPath, updatePursuits } from '@/sim/systems/movement'
import { updatePostureReflexes } from '@/sim/systems/postures'
import { HALT_TICKS, isHalted, pursuitLimitKm, restrainAttacks } from '@/sim/systems/restraint'
import type { UnitState } from '@/sim/core/types'

const theater = theaterJson as unknown as TheaterData
const newGame = (): Simulation => Simulation.fromScenario(ukraine2026, theater, 7)

/** Pousse toutes les unités hors de la zone de test, sauf celles gardées. */
function clearAround(sim: Simulation, keep: UnitState[], lon: number, lat: number): void {
  for (const x of sim.ctx.units.values()) {
    if (keep.includes(x)) continue
    if (distanceKm(x.lon, x.lat, lon, lat) < 80) sim.ctx.units.delete(x.id)
  }
}

function pick(sim: Simulation, owner: string): UnitState {
  const u = [...sim.ctx.units.values()].find((x) => x.owner === owner && x.kind === 'inf')
  if (!u) throw new Error('unité introuvable')
  return u
}

describe('attaque mesurée', () => {
  it('distance de poursuite selon la posture, le ravitaillement et le soutien', () => {
    expect(pursuitLimitKm('balanced', true, 2)).toBe(25)
    expect(pursuitLimitKm('maxDamage', true, 3)).toBe(60)
    expect(pursuitLimitKm('defensive', true, 2)).toBe(15)
    expect(pursuitLimitKm('maxDamage', false, 2)).toBe(30)
    expect(pursuitLimitKm('offensive', true, 1)).toBe(30)
    expect(pursuitLimitKm('balanced', true, 0)).toBe(12.5)
  })

  it('une poursuite s’arrête au-delà de sa distance et l’unité consolide', () => {
    const sim = newGame()
    const ctx = sim.ctx
    const u = pick(sim, 'UKR')
    const e = pick(sim, 'RUS')
    // Ouest de l'Ukraine, loin du front : seule la distance compte.
    u.lon = 26
    u.lat = 49.5
    e.lon = 26.3
    e.lat = 49.5
    clearAround(sim, [u, e], u.lon, u.lat)
    u.posture = 'balanced'
    u.order = { kind: 'pursue', unitId: e.id, target: [e.lon, e.lat], from: [25.5, 49.5] }
    runtimeOf(ctx, u.id).supplied = true
    restrainAttacks(ctx)
    expect(u.order.kind === 'move' || u.order.kind === 'hold').toBe(true)
    expect(u.halt?.reason).toBe('pursuit')
    expect(u.halt?.until).toBe(ctx.tick + HALT_TICKS)
    if (u.order.target) {
      expect(distanceKm(u.lon, u.lat, u.order.target[0], u.order.target[1])).toBeLessThanOrEqual(11)
    }
  })

  it('une poursuite courte continue, et garde son point de départ au fil des recalculs', () => {
    const sim = newGame()
    const ctx = sim.ctx
    const u = pick(sim, 'UKR')
    const e = pick(sim, 'RUS')
    u.lon = 26
    u.lat = 49.5
    e.lon = 26.3
    e.lat = 49.5
    clearAround(sim, [u, e], u.lon, u.lat)
    u.posture = 'maxDamage'
    u.order = { kind: 'pursue', unitId: e.id, target: [e.lon, e.lat] }
    planPath(ctx, u, [e.lon, e.lat])
    expect(u.order.from).toEqual([26, 49.5])
    restrainAttacks(ctx)
    expect(u.order.kind).toBe('pursue')
    expect(u.halt).toBeUndefined()
    // La cible s'enfuit : nouveau chemin, même point de départ.
    e.lon = 26.6
    updatePursuits(ctx)
    expect(u.order.kind).toBe('pursue')
    expect(u.order.from).toEqual([26, 49.5])
  })

  it('une unité seule enfoncée chez l’adversaire s’arrête ; l’ordre direct du joueur est respecté', () => {
    const sim = newGame()
    const ctx = sim.ctx
    const u = pick(sim, 'UKR')
    // Belgorod, en territoire russe, loin de toute unité ukrainienne.
    const [lon, lat] = [36.9, 50.75]
    const side = sideIndex(ctx, 'UKR')
    expect(ctx.matrix.hostile(side, ctx.grid.owner[ctx.grid.cellAt(lon, lat)] ?? 0)).toBe(true)
    clearAround(sim, [u], lon, lat)
    u.lon = lon
    u.lat = lat
    u.order = { kind: 'attack', target: [lon + 0.5, lat] }
    u.direct = {}
    restrainAttacks(ctx)
    expect(u.order.kind).toBe('attack')
    delete u.direct
    restrainAttacks(ctx)
    expect(u.halt?.reason).toBe('alone')
    expect(u.order.kind).not.toBe('attack')
    expect(sim.snapshot().units.find((x) => x.id === u.id)?.stance).toBe(
      'consolide : seule en pointe',
    )
  })

  it('avec des voisines, l’attaque continue', () => {
    const sim = newGame()
    const ctx = sim.ctx
    const [u, v, w] = [...ctx.units.values()].filter((x) => x.owner === 'UKR' && x.kind === 'inf')
    if (!u || !v || !w) throw new Error('unités introuvables')
    const [lon, lat] = [36.9, 50.75]
    clearAround(sim, [u, v, w], lon, lat)
    for (const [k, x] of [u, v, w].entries()) {
      x.lon = lon + k * 0.1
      x.lat = lat
      x.order = { kind: 'attack', target: [lon + 0.5, lat] }
    }
    runtimeOf(ctx, u.id).supplied = true
    restrainAttacks(ctx)
    expect(u.order.kind).toBe('attack')
    expect(u.halt).toBeUndefined()
  })

  it('une unité qui consolide n’est pas relancée par les réflexes ; l’arrêt est gardé dans la sauvegarde', () => {
    const sim = newGame()
    const ctx = sim.ctx
    const u = pick(sim, 'UKR')
    const e = pick(sim, 'RUS')
    u.lon = 26
    u.lat = 49.5
    e.lon = 26.2
    e.lat = 49.5
    clearAround(sim, [u, e], u.lon, u.lat)
    u.posture = 'maxDamage'
    u.order = { kind: 'hold' }
    runtimeOf(ctx, e.id).routed = true
    u.halt = { until: ctx.tick + HALT_TICKS, reason: 'pursuit' }
    updatePostureReflexes(ctx)
    expect(u.order.kind).toBe('hold')
    expect(isHalted(ctx, u)).toBe(true)

    const loaded = Simulation.fromSave(parseSave(serializeSave(sim.toSave())), ukraine2026, theater)
    expect(loaded.ctx.units.get(u.id)?.halt).toEqual(u.halt)

    // Fin de la consolidation : le réflexe reprend.
    ctx.tick += HALT_TICKS
    restrainAttacks(ctx)
    expect(u.halt).toBeUndefined()
    updatePostureReflexes(ctx)
    expect(u.order.kind).toBe('pursue')
  })
})
