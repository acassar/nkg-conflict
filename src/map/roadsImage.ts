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
 * Couleurs de la carte par défaut (vue politique) : le réseau est tracé en traits fins sous le
 * territoire, en teintes désaturées qui restent discrètes sous le bleu, le rouge ou le vert des pays.
 * La transparence vient de l'opacité selon le zoom (`roadOpacity`).
 */
export const BASE_ROAD_COLORS: { road: Rgba; major: Rgba; rail: Rgba } = {
  road: [128, 120, 108, 255],
  major: [176, 148, 108, 255],
  rail: [78, 74, 92, 255],
}

/** Épaisseur des traits de la carte par défaut, en pixels écran. */
export const BASE_ROAD_WIDTH = { main: 1.5, minor: 1 }

/** Opacité maximale du réseau de la carte par défaut (atteinte en zoomant). */
export const BASE_ROAD_MAX_OPACITY = { main: 0.6, minor: 0.45 }

/** Partie du réseau dessinée : tout, les grands axes et voies ferrées, ou les seules routes. */
export type RoadSet = 'all' | 'main' | 'minor'

/**
 * Couleur d'une cellule du réseau, ou null sans route ni voie ferrée. Quand plusieurs passent par la
 * même cellule, le grand axe l'emporte sur la voie ferrée, qui l'emporte sur la route.
 */
export function roadColor(
  bits: number,
  colors: typeof ROAD_COLORS = ROAD_COLORS,
  set: RoadSet = 'all',
): Rgba | null {
  if (bits & MAJOR_ROAD_BIT) return set === 'minor' ? null : colors.major
  if (bits & RAIL_BIT) return set === 'minor' ? null : colors.rail
  if (bits & ROAD_BIT) return set === 'main' ? null : colors.road
  return null
}

/**
 * Opacité du réseau selon le zoom (vue politique) : grands axes et voies ferrées apparaissent quand
 * une cellule mesure 2,5 pixels à l'écran et atteignent leur opacité maximale à 4,5 pixels ; les routes
 * apparaissent à 5 pixels (pleines à 9), pour ne pas brouiller la carte vue de loin.
 * `cellDeg` : taille d'une cellule en degrés.
 */
export function roadOpacity(zoom: number, cellDeg: number, set: 'main' | 'minor'): number {
  // Monde de 512 × 2^zoom pixels sur 360°.
  const px = (cellDeg * 512 * 2 ** zoom) / 360
  const [from, to] = set === 'main' ? [2.5, 4.5] : [5, 9]
  return BASE_ROAD_MAX_OPACITY[set] * Math.max(0, Math.min(1, (px - from) / (to - from)))
}

/** Taille des blocs de segments, en cellules : seuls les blocs proches de la vue sont dessinés. */
export const ROAD_BLOCK = 128

/**
 * Réseau en segments (carte par défaut), pour un tracé en traits fins quel que soit le zoom : un
 * segment relie les centres de cellules voisines du même ensemble (grands axes et voies ferrées, ou
 * routes), et les cellules alignées dans la même direction forment un seul segment. Une diagonale
 * n'est tracée que si aucune des deux cellules qui la bordent n'en fait partie (pas de triangles dans
 * les virages). Les segments sont rangés par blocs de `ROAD_BLOCK` cellules (selon leur cellule de
 * départ) pour ne dessiner que ceux de la vue. Données binaires pour deck.gl (LineLayer) : 4 nombres
 * par segment (lon, lat de départ puis d'arrivée) et une couleur RGBA.
 */
export interface RoadLines {
  id: string
  /** Emprise du bloc [lon0, lat0, lon1, lat1], segments débordants compris. */
  bounds: [number, number, number, number]
  length: number
  positions: Float32Array
  colors: Uint8Array
}

export function roadLines(
  grid: Pick<GridSnapshot, 'width' | 'height' | 'bbox' | 'roads'>,
  set: 'main' | 'minor',
  colors: typeof ROAD_COLORS = BASE_ROAD_COLORS,
  block = ROAD_BLOCK,
): RoadLines[] {
  const { width: W, height: H, bbox, roads } = grid
  if (!roads?.length) return []
  const [lon0, lat0, lon1, lat1] = bbox
  const dLon = (lon1 - lon0) / W
  const dLat = (lat1 - lat0) / H
  // Une cellule de routes qui porte aussi un grand axe ou une voie ferrée appartient au réseau principal.
  const MAIN = MAJOR_ROAD_BIT | RAIL_BIT
  const has = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false
    const b = roads[y * W + x] ?? 0
    return set === 'main' ? (b & MAIN) !== 0 : (b & ROAD_BIT) !== 0 && (b & MAIN) === 0
  }
  /** Couleur du lien entre une cellule et sa voisine (dx, dy), ou null sans lien. */
  const link = (x: number, y: number, dx: number, dy: number): Rgba | null => {
    const nx = x + dx
    const ny = y + dy
    if (!has(x, y) || !has(nx, ny)) return null
    if (dx !== 0 && dy !== 0 && (has(nx, y) || has(x, ny))) return null
    if (set === 'minor') return colors.road
    const a = roads[y * W + x] ?? 0
    const b = roads[ny * W + nx] ?? 0
    if (a & b & MAJOR_ROAD_BIT) return colors.major
    if (a & b & RAIL_BIT) return colors.rail
    return a & MAJOR_ROAD_BIT ? colors.major : colors.rail
  }
  const BW = Math.ceil(W / block)
  const blocks = new Map<number, { pos: number[]; col: number[] }>()
  // Voisins vers l'est, le nord et les deux diagonales du nord : chaque paire n'est vue qu'une fois.
  const dirs: [number, number][] = [
    [1, 0],
    [0, 1],
    [1, 1],
    [-1, 1],
  ]
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!has(x, y)) continue
      for (const [dx, dy] of dirs) {
        const c = link(x, y, dx, dy)
        // Une cellule déjà au milieu d'un alignement de même couleur est couverte par son début.
        if (!c || link(x - dx, y - dy, dx, dy) === c) continue
        let n = 1
        while (link(x + n * dx, y + n * dy, dx, dy) === c) n++
        const key = Math.floor(y / block) * BW + Math.floor(x / block)
        let b = blocks.get(key)
        if (!b) blocks.set(key, (b = { pos: [], col: [] }))
        b.pos.push(
          lon0 + (x + 0.5) * dLon,
          lat0 + (y + 0.5) * dLat,
          lon0 + (x + n * dx + 0.5) * dLon,
          lat0 + (y + n * dy + 0.5) * dLat,
        )
        b.col.push(...c)
      }
    }
  }
  const out: RoadLines[] = []
  for (const [key, b] of blocks) {
    let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity]
    for (let i = 0; i < b.pos.length; i += 2) {
      w = Math.min(w, b.pos[i] ?? w)
      e = Math.max(e, b.pos[i] ?? e)
      s = Math.min(s, b.pos[i + 1] ?? s)
      n = Math.max(n, b.pos[i + 1] ?? n)
    }
    out.push({
      id: `${set}-${key}`,
      bounds: [w, s, e, n],
      length: b.col.length / 4,
      positions: new Float32Array(b.pos),
      colors: new Uint8Array(b.col),
    })
  }
  return out
}

/** Blocs du réseau qui touchent l'emprise visible [lon0, lat0, lon1, lat1] (tous sans emprise). */
export function visibleRoadLines(
  lines: RoadLines[],
  view: [number, number, number, number] | null,
): RoadLines[] {
  if (!view) return lines
  const [w, s, e, n] = view
  return lines.filter(
    (l) => l.bounds[0] <= e && l.bounds[2] >= w && l.bounds[1] <= n && l.bounds[3] >= s,
  )
}

/**
 * Routes et voies ferrées en tuiles de 512 × 512 cellules, dessinées une seule fois par grille (le réseau
 * ne change pas pendant la partie) ; les tuiles sans réseau ne sont pas créées.
 */
export function roadTiles(
  grid: GridSnapshot,
  colors: typeof ROAD_COLORS = ROAD_COLORS,
  set: RoadSet = 'all',
): TerritoryTile[] {
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
          const c = roadColor(bits, colors, set)
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
        id: `${set}-${x0}-${y0}`,
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
