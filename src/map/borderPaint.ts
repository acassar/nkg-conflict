import type { GridSnapshot, LonLat } from '@/sim/core/types'
import { Terrain } from '@/sim/theater/grid'

/**
 * Peinture d'une frontière tenue (phase G2), côté interface : cellules de frontière terrestre du joueur
 * sous le pinceau, et carrés des cellules pour l'affichage. Mêmes règles que sim/systems/frontiers.ts
 * (le Worker revérifie chaque cellule).
 */

/** Taille d'une cellule, en degrés. */
function cellDeg(g: GridSnapshot): number {
  return (g.bbox[2] - g.bbox[0]) / g.width
}

const passable = (g: GridSnapshot, i: number): boolean => {
  const t = g.terrain[i]
  return t !== undefined && t !== Terrain.WATER && t !== Terrain.NEUTRAL
}

/** Cellule de frontière terrestre du camp `side` : à lui, praticable, voisine d'un autre pays. */
export function isBorderCell(g: GridSnapshot, side: number, i: number): boolean {
  if (g.owner[i] !== side || !passable(g, i)) return false
  const W = g.width
  const x = i % W
  const foreign = (n: number): boolean => {
    const o = g.owner[n] ?? 0
    return o !== 0 && o !== side && passable(g, n)
  }
  return (
    (x > 0 && foreign(i - 1)) ||
    (x < W - 1 && foreign(i + 1)) ||
    (i >= W && foreign(i - W)) ||
    (i + W < W * g.height && foreign(i + W))
  )
}

/** Cellule de côte du camp `side` : à lui, praticable, voisine de la mer ou d'un lac. */
export function isCoastCell(g: GridSnapshot, side: number, i: number): boolean {
  if (g.owner[i] !== side || !passable(g, i)) return false
  const W = g.width
  const x = i % W
  const water = (n: number): boolean => g.terrain[n] === Terrain.WATER
  return (
    (x > 0 && water(i - 1)) ||
    (x < W - 1 && water(i + 1)) ||
    (i >= W && water(i - W)) ||
    (i + W < W * g.height && water(i + W))
  )
}

/** Rayon du pinceau, en cellules, pour un rayon donné en degrés (au moins une cellule, au plus 12). */
export function brushCells(g: GridSnapshot, radiusDeg: number): number {
  return Math.max(1, Math.min(12, Math.round(radiusDeg / cellDeg(g))))
}

/** Cellules de frontière ou de côte du camp `side` dans un disque de `radius` cellules autour d'un point. */
export function borderCellsNear(
  g: GridSnapshot,
  side: number,
  at: LonLat,
  radius: number,
): number[] {
  const d = cellDeg(g)
  const cx = Math.floor((at[0] - g.bbox[0]) / d)
  const cy = Math.floor((at[1] - g.bbox[1]) / d)
  const out: number[] = []
  for (let y = cy - radius; y <= cy + radius; y++) {
    if (y < 0 || y >= g.height) continue
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || x >= g.width) continue
      if ((x - cx) ** 2 + (y - cy) ** 2 > radius * radius) continue
      const i = y * g.width + x
      if (isBorderCell(g, side, i) || isCoastCell(g, side, i)) out.push(i)
    }
  }
  return out
}

/** Carré d'une cellule (polygone en lon/lat), pour colorer la portion prise. */
export function cellSquare(g: GridSnapshot, i: number): LonLat[] {
  const d = cellDeg(g)
  const lon = g.bbox[0] + (i % g.width) * d
  const lat = g.bbox[1] + Math.floor(i / g.width) * d
  return [
    [lon, lat],
    [lon + d, lat],
    [lon + d, lat + d],
    [lon, lat + d],
  ]
}

/**
 * Pays voisins (codes) le long des cellules tenues, longueur approchée en km et, dans cette longueur,
 * celle des côtes.
 */
export function borderSummary(
  g: GridSnapshot,
  side: number,
  cells: ReadonlyArray<number>,
): { neighbors: string[]; km: number; coastKm: number } {
  const W = g.width
  const seen = new Set<number>()
  let coast = 0
  for (const i of cells) {
    if (!isBorderCell(g, side, i)) coast++
    const x = i % W
    for (const n of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
      if (n < 0 || n >= W * g.height) continue
      const o = g.owner[n] ?? 0
      if (o !== 0 && o !== side && passable(g, n)) seen.add(o)
    }
  }
  const lat = cells.length ? g.bbox[1] + (Math.floor((cells[0] ?? 0) / W) + 0.5) * cellDeg(g) : 0
  // Longueur : un côté de cellule par cellule de frontière (côté moyen, l'est-ouest réduit par la latitude).
  const perCell = cellDeg(g) * 111 * (1 + Math.cos((lat * Math.PI) / 180)) * 0.5
  return {
    neighbors: [...seen].map((o) => g.sides[o] ?? '').filter(Boolean),
    km: cells.length * perCell,
    coastKm: coast * perCell,
  }
}
