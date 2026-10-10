import type { CityState, GridSnapshot } from '@/sim/core/types'
import {
  distanceKm,
  MAJOR_ROAD_BIT,
  RAIL_BIT,
  ROAD_BIT,
  Terrain,
  terrainRule,
} from '@/sim/theater/grid'
import { signedPct } from '@/help/rules'

/**
 * Bandeau de la carte : description de ce qui se trouve sous la souris (ou sous le doigt après un
 * appui prolongé). Textes alignés sur l'aide en jeu (section « Terrain ») : mêmes noms, mêmes effets.
 */

/** Bonus de défense d'une cible attaquée à travers un fleuve (voir combat.ts et l'aide). */
const RIVER_CROSSING_DEFENSE = 1.4

/** Index de la cellule sous un point, ou -1 hors de la grille. */
export function cellIndexAt(grid: GridSnapshot, lon: number, lat: number): number {
  const [lon0, lat0, lon1, lat1] = grid.bbox
  const x = Math.floor(((lon - lon0) / (lon1 - lon0)) * grid.width)
  const y = Math.floor(((lat - lat0) / (lat1 - lat0)) * grid.height)
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return -1
  return y * grid.width + x
}

/** Effet d'un terrain en vitesse et en défense, comme dans le tableau de l'aide. */
function effects(code: number): string {
  const r = terrainRule(code)
  return `vitesse ${signedPct(r.speed)}, défense ${signedPct(r.defense)}`
}

function population(pop: number): string {
  if (pop >= 1_000_000) return `${(pop / 1_000_000).toFixed(1).replace('.', ',')} M hab.`
  return `${Math.round(pop / 1000)} 000 hab.`
}

/**
 * Lignes du bandeau pour un point : terrain et son effet, fleuve, réseau de transport, ville
 * proche (à moins de `cityKm`). Vide hors de la grille.
 */
export function describePoint(
  grid: GridSnapshot,
  cities: readonly CityState[],
  lon: number,
  lat: number,
  cityKm: number,
): string[] {
  const i = cellIndexAt(grid, lon, lat)
  if (i < 0) return []
  const code = grid.terrain[i] ?? Terrain.PLAIN
  if (code === Terrain.WATER) return ['Mer ou lac : infranchissable']
  if (code === Terrain.NEUTRAL) return ['Pays hors du théâtre : infranchissable']
  const out: string[] = []
  if (code === Terrain.RIVER) {
    out.push(
      `Fleuve : ${effects(code)} ; attaque à travers : ${signedPct(RIVER_CROSSING_DEFENSE)} de défense pour la cible`,
    )
  } else {
    out.push(`${terrainRule(code).name} : ${effects(code)}`)
  }
  const bits = grid.roads?.[i] ?? 0
  if (bits & MAJOR_ROAD_BIT) out.push('Grand axe (autoroute, voie rapide)')
  else if (bits & ROAD_BIT) out.push('Route principale')
  if (bits & RAIL_BIT) out.push('Voie ferrée')
  let best: CityState | null = null
  let bestKm = cityKm
  for (const c of cities) {
    // Filtre grossier avant le calcul de distance (carte du monde : des centaines de villes).
    if (Math.abs(c.lat - lat) > 2 || Math.abs(c.lon - lon) > 3) continue
    const d = distanceKm(lon, lat, c.lon, c.lat)
    if (d <= bestKm) {
      best = c
      bestKm = d
    }
  }
  if (best) {
    out.push(`${best.name}${best.capital ? ', capitale' : ''} : ${population(best.pop)}`)
  }
  return out
}
