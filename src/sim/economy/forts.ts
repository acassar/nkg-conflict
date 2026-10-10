import type { CityState, CountryId } from '@/sim/core/types'
import { distanceKm } from '@/sim/theater/grid'
import { BUILDINGS, FORT_BONUS_PER_LEVEL, FORT_RADIUS_KM } from './rules'

/**
 * Fortifications vues de l'interface (fiche de la ville, carte) : mêmes règles que le combat
 * (fortFactorAt) : bonus de défense par niveau pour les unités du propriétaire de la ville
 * à moins de FORT_RADIUS_KM ; quand plusieurs villes fortifiées se recouvrent, le meilleur
 * niveau compte, sans cumul.
 */

/** Bonus de défense (en %) d'un niveau de fortification. */
export function fortBonusPct(level: number): number {
  return Math.round(100 * FORT_BONUS_PER_LEVEL * level)
}

/** Texte court du bonus, par exemple « +30 % déf. ». */
export function fortBonusLabel(level: number): string {
  return `+${fortBonusPct(level)} % déf.`
}

/** Niveau de fortification qui protège un pays en un point (meilleur niveau à portée, 0 sinon). */
export function fortLevelAt(
  cities: readonly CityState[],
  owner: CountryId,
  lon: number,
  lat: number,
): number {
  let level = 0
  for (const c of cities) {
    if (c.owner !== owner || c.buildings.fort <= level) continue
    if (distanceKm(c.lon, c.lat, lon, lat) <= FORT_RADIUS_KM) level = c.buildings.fort
  }
  return level
}

/** Résumé pour la fiche de la ville : niveau, bonus, unités du propriétaire couvertes. */
export interface FortSummary {
  level: number
  max: number
  bonusPct: number
  radiusKm: number
  /** Unités du propriétaire à portée de la ville. */
  covered: number
  /** Parmi elles, celles qu'une autre ville mieux fortifiée protège déjà davantage. */
  coveredBetter: number
}

export function fortSummary(
  city: CityState,
  cities: readonly CityState[],
  units: ReadonlyArray<{ owner: CountryId; lon: number; lat: number }>,
): FortSummary {
  const level = city.buildings.fort
  let covered = 0
  let coveredBetter = 0
  if (city.owner) {
    for (const u of units) {
      if (u.owner !== city.owner) continue
      if (distanceKm(city.lon, city.lat, u.lon, u.lat) > FORT_RADIUS_KM) continue
      covered++
      if (fortLevelAt(cities, city.owner, u.lon, u.lat) > level) coveredBetter++
    }
  }
  return {
    level,
    max: BUILDINGS.fort.maxPerCity,
    bonusPct: fortBonusPct(level),
    radiusKm: FORT_RADIUS_KM,
    covered,
    coveredBetter,
  }
}
