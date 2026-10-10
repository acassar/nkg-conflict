import { describe, expect, it } from 'vitest'
import type { CityState } from '@/sim/core/types'
import { fortBonusLabel, fortBonusPct, fortLevelAt, fortSummary } from '@/sim/economy/forts'
import { FORT_RADIUS_KM, emptyBuildings } from '@/sim/economy/rules'

const city = (name: string, lon: number, lat: number, owner: string, fort: number): CityState => ({
  name,
  lon,
  lat,
  capital: false,
  owner,
  pop: 1e5,
  buildings: { ...emptyBuildings(), fort },
})

// 0,1° de latitude ≈ 11 km.
const A = city('A', 30, 50, 'UKR', 1)
const B = city('B', 30, 50.2, 'UKR', 3)
const R = city('R', 30, 50, 'RUS', 2)
const cities = [A, B, R]

describe('fortifications vues de l’interface', () => {
  it('bonus de 15 % par niveau', () => {
    expect(fortBonusPct(0)).toBe(0)
    expect(fortBonusPct(2)).toBe(30)
    expect(fortBonusLabel(3)).toBe('+45 % déf.')
  })

  it('le meilleur niveau du propriétaire à portée compte, sans cumul', () => {
    expect(fortLevelAt(cities, 'UKR', 30, 50)).toBe(1)
    expect(fortLevelAt(cities, 'UKR', 30, 50.1)).toBe(3)
    expect(fortLevelAt(cities, 'RUS', 30, 50)).toBe(2)
    expect(fortLevelAt(cities, 'UKR', 30, 50 + (FORT_RADIUS_KM + 5) / 111 + 0.2)).toBe(0)
  })

  it('résumé de la fiche : unités du propriétaire couvertes', () => {
    const units = [
      { owner: 'UKR', lon: 30, lat: 49.95 }, // A seulement
      { owner: 'UKR', lon: 30, lat: 50.1 }, // A et B : B protège mieux
      { owner: 'RUS', lon: 30, lat: 50 }, // autre pays
      { owner: 'UKR', lon: 31, lat: 50 }, // hors de portée
    ]
    const s = fortSummary(A, cities, units)
    expect(s).toMatchObject({ level: 1, max: 3, bonusPct: 15, radiusKm: FORT_RADIUS_KM })
    expect(s.covered).toBe(2)
    expect(s.coveredBetter).toBe(1)
  })
})
