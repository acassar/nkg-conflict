import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { combatModifiers, updateCombat } from '@/sim/systems/combat'
import type { TheaterData } from '@/sim/theater/grid'
import { HELP_SECTIONS, MODIFIER_HELP, signedPct } from '@/help/rules'

const theater = theaterJson as unknown as TheaterData

describe('aide en jeu', () => {
  it('pourcentages signés', () => {
    expect(signedPct(1.15)).toBe('+15 %')
    expect(signedPct(0.6)).toBe('−40 %')
    expect(signedPct(1)).toBe('0 %')
  })

  it('chaque modificateur renvoie à une section existante', () => {
    const ids = new Set(HELP_SECTIONS.map((s) => s.id))
    expect(ids.size).toBe(HELP_SECTIONS.length)
    for (const [key, h] of Object.entries(MODIFIER_HELP)) {
      expect(ids.has(h.section), key).toBe(true)
      expect(h.text.length).toBeGreaterThan(10)
    }
  })

  it('les textes reprennent les valeurs de la simulation', () => {
    const text = (id: string): string =>
      HELP_SECTIONS.find((s) => s.id === id)?.paragraphs.join(' ') ?? ''
    expect(text('command')).toContain('+15 %')
    expect(text('supply')).toContain('−40 %')
    expect(text('forts')).toContain('15 km')
    const terrain = HELP_SECTIONS.find((s) => s.id === 'terrain')?.table?.rows ?? []
    expect(terrain.find((r) => r[0] === 'Ville')?.[1]).toBe('+50 %')
    const postures = HELP_SECTIONS.find((s) => s.id === 'postures')?.table?.rows ?? []
    expect(postures).toHaveLength(5)
  })

  it('les modificateurs d’une vraie bataille ont tous une explication', () => {
    const sim = Simulation.fromScenario(ukraine2026, theater, 3)
    sim.step(24 * 10)
    updateCombat(sim.ctx)
    let seen = 0
    for (const u of sim.ctx.units.values()) {
      const m = combatModifiers(sim.ctx, u)
      for (const mod of [...m.attack, ...m.defense]) {
        expect(MODIFIER_HELP[mod.key], mod.label).toBeDefined()
        seen++
      }
    }
    expect(seen).toBeGreaterThan(0)
  })
})
