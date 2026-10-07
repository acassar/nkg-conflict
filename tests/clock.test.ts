import { describe, expect, it } from 'vitest'
import { formatGameDate, isSpeed, tickToDate } from '@/sim/core/clock'

describe('clock', () => {
  it('convertit les ticks en heures de jeu', () => {
    expect(tickToDate('2026-01-01T00:00:00Z', 0).toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(tickToDate('2026-01-01T00:00:00Z', 25).toISOString()).toBe('2026-01-02T01:00:00.000Z')
  })

  it('refuse une date de départ invalide', () => {
    expect(() => tickToDate('pas une date', 0)).toThrow()
  })

  it('formate la date en français, en UTC', () => {
    expect(formatGameDate(new Date('2026-10-07T14:00:00Z'))).toBe('7 oct. 2026, 14:00')
  })

  it('valide les vitesses 1 à 5', () => {
    expect([0, 1, 3, 5, 6, 2.5].map(isSpeed)).toEqual([false, true, true, true, false, false])
  })
})
