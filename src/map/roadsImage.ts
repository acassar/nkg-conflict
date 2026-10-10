import type { GridSnapshot } from '@/sim/core/types'
import { MAJOR_ROAD_BIT, RAIL_BIT, ROAD_BIT } from '@/sim/theater/grid'
import type { TerritoryTile } from './territoryImage'

const TILE = 512

type Rgba = [number, number, number, number]

/** Couleurs du réseau de transport (mode Logistique). */
export const ROAD_COLORS: { road: Rgba; major: Rgba; rail: Rgba } = {
  road: [250, 245, 225, 120],
  major: [250, 204, 21, 220],
  rail: [49, 46, 129, 175],
}

/**
 * Couleur d'une cellule du réseau, ou null sans route ni voie ferrée. Quand plusieurs passent par la
 * même cellule, le grand axe l'emporte sur la voie ferrée, qui l'emporte sur la route.
 */
export function roadColor(bits: number): Rgba | null {
  if (bits & MAJOR_ROAD_BIT) return ROAD_COLORS.major
  if (bits & RAIL_BIT) return ROAD_COLORS.rail
  if (bits & ROAD_BIT) return ROAD_COLORS.road
  return null
}

/**
 * Routes et voies ferrées en tuiles de 512 × 512 cellules, dessinées une seule fois par grille (le réseau
 * ne change pas pendant la partie) ; les tuiles sans réseau ne sont pas créées.
 */
export function roadTiles(grid: GridSnapshot): TerritoryTile[] {
  const { width: W, height: H, bbox, roads } = grid
  if (!roads?.length) return []
  const [lon0, lat0, lon1, lat1] = bbox
  const dLon = (lon1 - lon0) / W
  const dLat = (lat1 - lat0) / H
  const out: TerritoryTile[] = []
  for (let y0 = 0; y0 < H; y0 += TILE) {
    for (let x0 = 0; x0 < W; x0 += TILE) {
      const w = Math.min(TILE, W - x0)
      const h = Math.min(TILE, H - y0)
      let image: ImageData | null = null
      for (let y = 0; y < h; y++) {
        const row = (y0 + y) * W + x0
        for (let x = 0; x < w; x++) {
          const bits = roads[row + x] ?? 0
          if (!bits) continue
          const c = roadColor(bits)
          if (!c) continue
          image ??= new ImageData(w, h)
          // Ligne du nord en haut dans l'image.
          const p = ((h - 1 - y) * w + x) * 4
          image.data[p] = c[0]
          image.data[p + 1] = c[1]
          image.data[p + 2] = c[2]
          image.data[p + 3] = c[3]
        }
      }
      if (!image) continue
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d')?.putImageData(image, 0, 0)
      out.push({
        id: `${x0}-${y0}`,
        canvas,
        bounds: [
          lon0 + x0 * dLon,
          lat0 + y0 * dLat,
          lon0 + (x0 + w) * dLon,
          lat0 + (y0 + h) * dLat,
        ],
      })
    }
  }
  return out
}
