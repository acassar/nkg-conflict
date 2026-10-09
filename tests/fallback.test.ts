import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { parseSave, serializeSave } from '@/sim/core/save'
import { runtimeOf } from '@/sim/context'
import { distanceKm, type TheaterData } from '@/sim/theater/grid'
import { assignFront } from '@/sim/systems/armies'
import {
  decide,
  holdOrFallBack,
  stanceOf,
  stanceText,
  WITHDRAW_RISK,
  type Assessment,
} from '@/sim/systems/fallback'
import { isLineUnit } from '@/sim/units/catalog'
import type { ArmyState, LonLat, UnitState } from '@/sim/core/types'

const theater = theaterJson as unknown as TheaterData

interface Setup {
  sim: Simulation
  army: ArmyState
  line: UnitState[]
  /** Brigade ukrainienne menacée. */
  near: UnitState
  /** Blindés russes au contact de `near`. */
  attackers: UnitState[]
}

/** Trois brigades blindées russes à 8 km d'une brigade ukrainienne qui tient le front. */
function setup(): Setup {
  const sim = Simulation.fromScenario(ukraine2026, theater, 7)
  const ctx = sim.ctx
  const army = [...ctx.armies.values()].find((a) => a.owner === 'UKR' && a.wholeFront)
  if (!army) throw new Error('armée introuvable')
  const line = army.unitIds
    .map((id) => ctx.units.get(id))
    .filter((u): u is UnitState => !!u && isLineUnit(u.kind) && u.order.kind === 'front')
  const near = line[0]
  const attackers = [...ctx.units.values()]
    .filter((u) => u.owner === 'RUS' && u.kind === 'tank')
    .slice(0, 3)
  if (!near || attackers.length < 3) throw new Error('unités introuvables')
  // Les autres unités de ligne loin de là : pas de voisines pour partager la charge.
  attackers.forEach((e, k) => {
    ;[e.lon, e.lat] = [near.lon + 0.1, near.lat + (k - 1) * 0.03]
    e.order = { kind: 'attack', target: [near.lon - 1, near.lat] }
    e.path = []
  })
  return { sim, army, line, near, attackers }
}

const assessment = (risk: number, extra: Partial<Assessment> = {}): Assessment => ({
  threat: 1,
  defense: 1,
  ring: 0.3,
  supplied: true,
  helped: false,
  strongPoint: false,
  risk,
  ...extra,
})

describe('tenir ou décrocher', () => {
  it('décide selon le risque, la valeur de la position et les renforts', () => {
    expect(decide(assessment(WITHDRAW_RISK * 0.5)).decision).toBe('hold')
    expect(decide(assessment(WITHDRAW_RISK * 1.2))).toMatchObject({
      decision: 'withdraw',
      reason: 'outnumbered',
    })
    // Une ville ou une position fortifiée vaut un risque plus élevé.
    expect(decide(assessment(WITHDRAW_RISK * 1.2, { strongPoint: true }))).toMatchObject({
      decision: 'hold',
      reason: 'strongPoint',
    })
    // Une riposte arrive : on tient, quel que soit le risque.
    expect(decide(assessment(WITHDRAW_RISK * 5, { helped: true })).reason).toBe('reinforcements')
    // Cause principale du décrochage.
    expect(decide(assessment(WITHDRAW_RISK * 2, { ring: 0.8 })).reason).toBe('encircled')
    expect(decide(assessment(WITHDRAW_RISK * 2, { supplied: false })).reason).toBe('unsupplied')
    expect(stanceText({ decision: 'withdraw', reason: 'encircled', risk: 3 })).toBe(
      "décroche : menace d'encerclement",
    )
  })

  it('une unité submergée et peu retranchée décroche vers la ligne suivante', () => {
    const { sim, near, attackers } = setup()
    near.entrench = 0
    near.org = 0.4
    const center: LonLat = [near.lon + 0.1, near.lat]
    const before = distanceKm(near.lon, near.lat, center[0], center[1])
    holdOrFallBack(sim.ctx)
    expect(stanceOf(sim.ctx, near.id)?.decision).toBe('withdraw')
    expect(near.order.kind).toBe('retreat')
    const t = near.order.target as LonLat
    expect(distanceKm(t[0], t[1], center[0], center[1])).toBeGreaterThan(before + 8)
    expect(sim.ctx.grid.owner[sim.ctx.grid.cellAt(t[0], t[1])]).toBe(sim.sideOf('UKR'))
    expect(attackers.length).toBe(3)
  })

  it('une unité bien retranchée face à un ennemi faible tient', () => {
    const { sim, near, attackers } = setup()
    near.entrench = 1
    for (const e of attackers) e.strength = 0.2
    holdOrFallBack(sim.ctx)
    expect(stanceOf(sim.ctx, near.id)?.decision).toBe('hold')
    expect(near.order.kind).toBe('front')
  })

  it('tient si une riposte arrive sur une percée proche', () => {
    const { sim, line, near, attackers } = setup()
    near.entrench = 0
    near.org = 0.4
    const helper = line[line.length - 1] as UnitState
    runtimeOf(sim.ctx, helper.id).reaction = {
      kind: 'counter',
      intruder: (attackers[0] as UnitState).id,
      until: sim.ctx.tick + 72,
    }
    holdOrFallBack(sim.ctx)
    expect(stanceOf(sim.ctx, near.id)?.reason).toBe('reinforcements')
    expect(near.order.kind).toBe('front')
  })

  it('le départ d’une unité ne décale pas les postes du reste de l’armée', () => {
    const { sim, army, line, near } = setup()
    near.entrench = 0
    near.org = 0.4
    const posts = new Map(line.map((u) => [u.id, u.order.target]))
    holdOrFallBack(sim.ctx)
    expect(near.order.kind).toBe('retreat')
    assignFront(sim.ctx, army)
    expect(near.order.kind).toBe('retreat')
    let moved = 0
    for (const u of line) {
      if (u === near) continue
      const a = posts.get(u.id)
      const b = u.order.target
      if (!a || !b || distanceKm(a[0], a[1], b[0], b[1]) > 8) moved++
    }
    expect(moved).toBeLessThanOrEqual(2)
  })

  it('le décrochage prend fin au bout de deux jours et survit à une sauvegarde', () => {
    const { sim, near } = setup()
    near.entrench = 0
    near.org = 0.4
    holdOrFallBack(sim.ctx)
    const loaded = Simulation.fromSave(parseSave(serializeSave(sim.toSave())), ukraine2026, theater)
    expect(stanceOf(loaded.ctx, near.id)?.decision).toBe('withdraw')
    sim.ctx.tick += 48
    holdOrFallBack(sim.ctx)
    expect(stanceOf(sim.ctx, near.id)?.decision).not.toBe('withdraw')
  })
})
