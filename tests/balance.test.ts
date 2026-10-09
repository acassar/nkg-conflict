import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { balanceMarkdown, playBalanceGame, summarizeBalance } from '@/sim/balance'
import type { TheaterData } from '@/sim/theater/grid'

const theater = theaterJson as unknown as TheaterData

describe('rapport d’équilibrage', () => {
  it('relève territoire, unités et pertes des deux camps', () => {
    const g = playBalanceGame(ukraine2026, theater, 1, 12, ['UKR', 'RUS'], 6)
    expect(g.days).toBe(12)
    expect(g.timeline.map((t) => t.day)).toEqual([0, 6, 12])
    expect(g.timeline[0]?.countries.UKR?.territory).toBeCloseTo(1)
    const [ukr, rus] = g.countries
    expect(ukr?.country).toBe('UKR')
    expect(ukr?.units).toBeGreaterThan(0)
    expect(rus?.units).toBeGreaterThan(0)
    // La guerre est en cours dès le départ : les deux camps perdent des effectifs.
    expect((ukr?.losses ?? 0) + (rus?.losses ?? 0)).toBeGreaterThan(0)
    expect(g.peaceDay).toBeNull()
  })

  it('résume les graines et produit un tableau Markdown', () => {
    const game = (seed: number, territory: number): Parameters<typeof summarizeBalance>[0][0] => ({
      seed,
      days: 30,
      peaceDay: seed === 2 ? 20 : null,
      outcome: null,
      timeline: [],
      countries: [{ country: 'UKR', territory, units: 10, losses: seed, destroyed: 1, created: 2 }],
      ms: 0,
    })
    const games = [game(1, 0.6), game(2, 0.9)]
    const [ukr] = summarizeBalance(games)
    expect(ukr?.territory.min).toBeCloseTo(0.6)
    expect(ukr?.territory.mean).toBeCloseTo(0.75)
    expect(ukr?.losses.max).toBe(2)
    const md = balanceMarkdown('Test', games)
    expect(md).toContain('| 2 | 30 | paix au jour 20 | 90 % · 10 · 2.0 (1 détruites) |')
    expect(md).toContain('UKR : territoire 60 % à 90 % (moyenne 75 %)')
  })
})
