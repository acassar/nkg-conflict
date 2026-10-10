import type { CountryDef, GridSnapshot } from '@/sim/core/types'
import type { Stance } from '@/stores/game'

const WATER = 1
const NEUTRAL = 2
const TILE = 512
/** Largeur (en cellules) du fondu sur les bords d'un théâtre, pour éviter une coupure nette. */
const EDGE_FADE = 24

type Rgb = [number, number, number]

/** Couleurs par position vis-à-vis du joueur ; les pays neutres gardent leur teinte discrète. */
export const STANCE_COLORS: Record<Exclude<Stance, 'neutral'>, Rgb> = {
  player: [37, 99, 235],
  enemy: [220, 38, 38],
  ally: [16, 150, 110],
  war: [217, 119, 6],
}
const ALPHA: Record<Stance, number> = { player: 105, enemy: 105, ally: 85, war: 80, neutral: 45 }
const FRONT_ALPHA = 235

export function stanceColor(stance: Stance, base: Rgb): Rgb {
  return stance === 'neutral' ? base : STANCE_COLORS[stance]
}

export interface TerritoryTile {
  id: string
  canvas: HTMLCanvasElement
  bounds: [number, number, number, number]
}

interface TileState {
  x0: number
  y0: number
  w: number
  h: number
  image: ImageData
  canvas: HTMLCanvasElement
  bounds: [number, number, number, number]
  dirty: boolean
  /** Change à chaque redessin : deck.gl recharge la texture quand l'image change de référence. */
  rev: number
}

/**
 * Territoire découpé en tuiles de 512 × 512 cellules : seules les tuiles touchées par un changement
 * sont redessinées (indispensable sur la grille mondiale, 3600 × 1340 cellules).
 */
export class TerritoryTiles {
  private tiles: TileState[] = []
  private palette: Array<{ rgb: Rgb; alpha: number }> = []
  private readonly fade: boolean

  constructor(
    private readonly grid: GridSnapshot,
    countries: CountryDef[],
    stances: Map<string, Stance>,
    private hostile: Set<number>,
  ) {
    // Pas de fondu sur la grille mondiale : ses bords sont les pôles.
    this.fade = grid.width < 2000
    this.setColors(countries, stances, hostile)
    const { width: W, height: H, bbox } = grid
    const [lon0, lat0, lon1, lat1] = bbox
    const dLon = (lon1 - lon0) / W
    const dLat = (lat1 - lat0) / H
    for (let y0 = 0; y0 < H; y0 += TILE) {
      for (let x0 = 0; x0 < W; x0 += TILE) {
        const w = Math.min(TILE, W - x0)
        const h = Math.min(TILE, H - y0)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        this.tiles.push({
          x0,
          y0,
          w,
          h,
          image: new ImageData(w, h),
          canvas,
          bounds: [
            lon0 + x0 * dLon,
            lat0 + y0 * dLat,
            lon0 + (x0 + w) * dLon,
            lat0 + (y0 + h) * dLat,
          ],
          dirty: true,
          rev: 0,
        })
      }
    }
    for (const t of this.tiles) this.paintTile(t)
  }

  /** Nouvelles couleurs (guerres ou alliances changées) : tout est redessiné. */
  setColors(countries: CountryDef[], stances: Map<string, Stance>, hostile: Set<number>): void {
    this.hostile = hostile
    const byCode = new Map(countries.map((c) => [c.id, c]))
    this.palette = this.grid.sides.map((code) => {
      const stance = stances.get(code) ?? 'neutral'
      const base = byCode.get(code)?.color ?? [150, 150, 150]
      return { rgb: stanceColor(stance, base), alpha: ALPHA[stance] }
    })
    for (const t of this.tiles) this.paintTile(t)
  }

  private paintTile(t: TileState): void {
    for (let y = t.y0; y < t.y0 + t.h; y++) {
      for (let x = t.x0; x < t.x0 + t.w; x++) this.paintCell(t, x, y)
    }
    t.dirty = true
  }

  private paintCell(t: TileState, x: number, y: number): void {
    const { width: W, height: H, owner, terrain } = this.grid
    const i = y * W + x
    // Ligne du nord en haut dans l'image.
    const p = ((t.h - 1 - (y - t.y0)) * t.w + (x - t.x0)) * 4
    const px = t.image.data
    const ter = terrain[i]
    const o = owner[i] ?? 0
    const color = this.palette[o]
    if (ter === WATER || ter === NEUTRAL || !o || !color) {
      px[p + 3] = 0
      return
    }
    let front = false
    const check = (n: number): void => {
      const on = owner[n] ?? 0
      if (on && on !== o && this.hostile.has(o * 256 + on)) front = true
    }
    if (x > 0) check(i - 1)
    if (x < W - 1) check(i + 1)
    if (y > 0) check(i - W)
    if (y < H - 1) check(i + W)
    const [r, g, b] = color.rgb
    if (front) {
      px[p] = r * 0.55
      px[p + 1] = g * 0.55
      px[p + 2] = b * 0.55
      px[p + 3] = FRONT_ALPHA
      return
    }
    const fade = this.fade ? Math.min(1, Math.min(x, y, W - 1 - x, H - 1 - y) / EDGE_FADE) : 1
    px[p] = r
    px[p + 1] = g
    px[p + 2] = b
    px[p + 3] = color.alpha * fade
  }

  /** Redessine les cellules modifiées et leurs voisines (l'état « front » dépend des voisins). */
  applyCells(cells: number[]): void {
    const { width: W, height: H } = this.grid
    const cols = Math.ceil(W / TILE)
    for (const i of cells) {
      const x = i % W
      const y = (i - x) / W
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const t = this.tiles[Math.floor(ny / TILE) * cols + Math.floor(nx / TILE)]
        if (!t) continue
        this.paintCell(t, nx, ny)
        t.dirty = true
      }
    }
  }

  /** Tuiles prêtes à afficher ; les tuiles modifiées reçoivent un nouveau canvas. */
  layers(): TerritoryTile[] {
    for (const t of this.tiles) {
      if (!t.dirty) continue
      const canvas = document.createElement('canvas')
      canvas.width = t.w
      canvas.height = t.h
      canvas.getContext('2d')?.putImageData(t.image, 0, 0)
      t.canvas = canvas
      t.rev++
      t.dirty = false
    }
    return this.tiles.map((t) => ({
      id: `${t.x0}-${t.y0}-${t.rev}`,
      canvas: t.canvas,
      bounds: t.bounds,
    }))
  }
}

/**
 * Teintes du terrain sous la couche de territoire (carte par défaut) : fleuves, villes, forêts,
 * collines, montagnes et marais. Assez marquées pour rester lisibles sous la couleur des pays.
 */
export const TERRAIN_TINTS: Record<number, [number, number, number, number]> = {
  3: [37, 99, 190, 200],
  4: [90, 90, 100, 150],
  5: [34, 110, 50, 75],
  6: [150, 120, 70, 70],
  7: [110, 75, 45, 120],
  8: [40, 150, 150, 100],
}

/** Dessine le terrain une fois pour toutes, en tuiles comme le territoire. */
export function terrainTiles(grid: GridSnapshot): TerritoryTile[] {
  const { width: W, height: H, terrain, bbox } = grid
  const [lon0, lat0, lon1, lat1] = bbox
  const dLon = (lon1 - lon0) / W
  const dLat = (lat1 - lat0) / H
  const out: TerritoryTile[] = []
  for (let y0 = 0; y0 < H; y0 += TILE) {
    for (let x0 = 0; x0 < W; x0 += TILE) {
      const w = Math.min(TILE, W - x0)
      const h = Math.min(TILE, H - y0)
      const image = new ImageData(w, h)
      const px = image.data
      let any = false
      for (let y = y0; y < y0 + h; y++) {
        for (let x = x0; x < x0 + w; x++) {
          const tint = TERRAIN_TINTS[terrain[y * W + x] ?? 0]
          if (!tint) continue
          any = true
          const p = ((h - 1 - (y - y0)) * w + (x - x0)) * 4
          px[p] = tint[0]
          px[p + 1] = tint[1]
          px[p + 2] = tint[2]
          px[p + 3] = tint[3]
        }
      }
      if (!any) continue
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d')?.putImageData(image, 0, 0)
      out.push({
        id: `terrain-${x0}-${y0}`,
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
