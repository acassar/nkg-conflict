import type { GridSnapshot } from '@/sim/core/types'
import { SUPPLY_CUT, SUPPLY_OK, SUPPLY_POCKET } from '@/sim/systems/supplyView'
import type { TerritoryTile } from './territoryImage'

const TILE = 512

type Rgba = [number, number, number, number]

/**
 * Couleurs du mode Logistique : vert discret pour le territoire relié, hachures orange pour un territoire
 * coupé sans contact avec l'ennemi, hachures rouges pour une poche (une rayure sur trois plus soutenue).
 */
export const SUPPLY_COLORS: Record<number, { base: Rgba; stripe: Rgba }> = {
  [SUPPLY_OK]: { base: [34, 197, 94, 70], stripe: [34, 197, 94, 70] },
  [SUPPLY_CUT]: { base: [234, 88, 12, 70], stripe: [234, 88, 12, 190] },
  [SUPPLY_POCKET]: { base: [220, 38, 38, 110], stripe: [185, 28, 28, 230] },
}

interface TileState {
  x0: number
  y0: number
  w: number
  h: number
  /** Copie de l'état des cellules de la tuile au dernier dessin. */
  last: Uint8Array
  tile: TerritoryTile | null
  rev: number
}

/**
 * Calque du mode Logistique, en tuiles de 512 × 512 cellules comme le territoire : à chaque mise à jour,
 * seules les tuiles dont l'état a changé sont redessinées ; les tuiles vides ne sont pas affichées.
 */
export class SupplyTiles {
  private tiles: TileState[] = []

  constructor(private readonly grid: GridSnapshot) {
    const { width: W, height: H } = grid
    for (let y0 = 0; y0 < H; y0 += TILE) {
      for (let x0 = 0; x0 < W; x0 += TILE) {
        const w = Math.min(TILE, W - x0)
        const h = Math.min(TILE, H - y0)
        this.tiles.push({ x0, y0, w, h, last: new Uint8Array(w * h), tile: null, rev: 0 })
      }
    }
  }

  /** Applique un nouvel état (une valeur SUPPLY_* par cellule) et renvoie les tuiles à afficher. */
  update(state: Uint8Array): TerritoryTile[] {
    const W = this.grid.width
    for (const t of this.tiles) {
      let changed = false
      for (let y = 0; y < t.h && !changed; y++) {
        const row = (t.y0 + y) * W + t.x0
        for (let x = 0; x < t.w; x++) {
          if (state[row + x] !== t.last[y * t.w + x]) {
            changed = true
            break
          }
        }
      }
      if (changed) this.paint(t, state)
    }
    return this.tiles.flatMap((t) => (t.tile ? [t.tile] : []))
  }

  private paint(t: TileState, state: Uint8Array): void {
    const { width: W, height: H, bbox } = this.grid
    const [lon0, lat0, lon1, lat1] = bbox
    const dLon = (lon1 - lon0) / W
    const dLat = (lat1 - lat0) / H
    const image = new ImageData(t.w, t.h)
    const px = image.data
    let any = false
    for (let y = 0; y < t.h; y++) {
      const row = (t.y0 + y) * W + t.x0
      for (let x = 0; x < t.w; x++) {
        const v = state[row + x] ?? 0
        t.last[y * t.w + x] = v
        const colors = SUPPLY_COLORS[v]
        if (!colors) continue
        any = true
        // Rayures diagonales, une cellule sur trois (ligne du nord en haut dans l'image).
        const c = (t.x0 + x + t.y0 + y) % 3 === 0 ? colors.stripe : colors.base
        const p = ((t.h - 1 - y) * t.w + x) * 4
        px[p] = c[0]
        px[p + 1] = c[1]
        px[p + 2] = c[2]
        px[p + 3] = c[3]
      }
    }
    if (!any) {
      t.tile = null
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = t.w
    canvas.height = t.h
    canvas.getContext('2d')?.putImageData(image, 0, 0)
    t.rev++
    t.tile = {
      id: `${t.x0}-${t.y0}-${t.rev}`,
      canvas,
      bounds: [
        lon0 + t.x0 * dLon,
        lat0 + t.y0 * dLat,
        lon0 + (t.x0 + t.w) * dLon,
        lat0 + (t.y0 + t.h) * dLat,
      ],
    }
  }
}
