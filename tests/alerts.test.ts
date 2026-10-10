import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { runtimeOf } from '@/sim/context'
import { computeAlerts } from '@/sim/systems/alerts'
import type { TheaterData } from '@/sim/theater/grid'
import type { UnitState } from '@/sim/core/types'

const theater = theaterJson as unknown as TheaterData

function setup(): { sim: Simulation; ukr: UnitState[]; rus: UnitState[] } {
  const sim = Simulation.fromScenario(ukraine2026, theater, 5, 'UKR')
  const all = [...sim.ctx.units.values()]
  // Situation de départ : toutes les unités ravitaillées, aucun ennemi enfoncé.
  for (const u of all) runtimeOf(sim.ctx, u.id).supplied = true
  const line = (owner: string): UnitState[] =>
    all.filter((u) => u.owner === owner && (u.kind === 'inf' || u.kind === 'mech'))
  return { sim, ukr: line('UKR'), rus: line('RUS') }
}

const alertsOf = (sim: Simulation) =>
  computeAlerts(sim.ctx, 'UKR', (at) => sim.describeLocation(at[0], at[1]))

describe('alertes du joueur', () => {
  it('au départ, aucune unité coupée ni presque entourée', () => {
    const { sim } = setup()
    const kinds = alertsOf(sim).map((a) => a.kind)
    expect(kinds).not.toContain('encircled')
    expect(kinds).not.toContain('pocket')
  })

  it('regroupe les unités coupées proches en une alerte, centrée sur elles', () => {
    const { sim, ukr } = setup()
    const [a, b, c] = ukr as [UnitState, UnitState, UnitState]
    ;[a.lon, a.lat] = [33.0, 48.0]
    ;[b.lon, b.lat] = [33.2, 48.1]
    ;[c.lon, c.lat] = [25.0, 49.0]
    for (const u of [a, b, c]) runtimeOf(sim.ctx, u.id).supplied = false
    const cut = alertsOf(sim).filter((x) => x.kind === 'encircled')
    expect(cut).toHaveLength(2)
    const pair = cut.find((x) => x.unitIds.length === 2)
    expect(pair?.unitIds).toEqual([a.id, b.id].sort((x, y) => x - y))
    expect(pair?.key).toBe(`encircled:${Math.min(a.id, b.id)}`)
    expect(Math.abs((pair?.at[0] ?? 0) - 33.1)).toBeLessThan(0.2)
    expect(pair?.text).toMatch(/^2 unités coupées du ravitaillement près de /)
    // Les alertes les plus graves d'abord.
    expect(alertsOf(sim)[0]?.kind).toBe('encircled')
  })

  it('signale une unité ennemie enfoncée dans le territoire du joueur', () => {
    const { sim, rus } = setup()
    const e = rus[0] as UnitState
    ;[e.lon, e.lat] = [30.9, 50.2] // près de Kyiv, loin du front
    const breach = alertsOf(sim).filter((x) => x.kind === 'breach')
    expect(breach.some((x) => x.unitIds.includes(e.id))).toBe(true)
    expect(breach.find((x) => x.unitIds.includes(e.id))?.text).toMatch(/^Front percé près de /)
  })

  it('annonce une poche quand une unité ravitaillée est presque entourée', () => {
    const { sim, ukr } = setup()
    const u = ukr[0] as UnitState
    const [lon, lat] = ukraine2026.supplySources.RUS?.[0] ?? [0, 0]
    ;[u.lon, u.lat] = [lon, lat] // au milieu du territoire russe
    const pocket = alertsOf(sim).filter((x) => x.kind === 'pocket')
    expect(pocket.map((x) => x.unitIds)).toContainEqual([u.id])
  })

  it('écrit les alertes nouvelles au journal et les publie, rien en paix', () => {
    const { sim, ukr } = setup()
    const u = ukr[0] as UnitState
    const [lon, lat] = ukraine2026.supplySources.RUS?.[0] ?? [0, 0]
    ;[u.lon, u.lat] = [lon, lat]
    u.order = { kind: 'hold' }
    sim.step(6)
    const snap = sim.snapshot(false, false)
    expect(snap.alerts.some((a) => a.unitIds.includes(u.id))).toBe(true)
    expect(snap.events.some((e) => e.text.startsWith('Alerte : '))).toBe(true)
    sim.ctx.matrix.atWar.fill(0)
    expect(alertsOf(sim)).toEqual([])
  })
})
