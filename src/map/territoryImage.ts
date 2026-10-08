import type { CountryDef, GridSnapshot } from '@/sim/core/types'

const WATER = 1
const NEUTRAL = 2
const AREA_ALPHA = 105
const FRONT_ALPHA = 235
/** Largeur (en cellules) du fondu sur les bords du théâtre, pour éviter une coupure nette. */
const EDGE_FADE = 24

/**
 * Dessine la grille de contrôle dans un canvas (1 pixel = 1 cellule), ligne du nord en haut.
 * Les cellules au contact de l'adversaire sont plus opaques : c'est la ligne de front.
 */
export function territoryCanvas(grid: GridSnapshot, countries: CountryDef[]): HTMLCanvasElement {
  const { width: W, height: H, owner, terrain, sides } = grid
  const colors = sides.map((id) => countries.find((c) => c.id === id)?.color ?? null)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const image = ctx.createImageData(W, H)
  const px = image.data

  for (let y = 0; y < H; y++) {
    const row = (H - 1 - y) * W
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const t = terrain[i]
      const o = owner[i] ?? 0
      const color = colors[o]
      if (t === WATER || t === NEUTRAL || !color) continue
      let front = false
      const check = (n: number): void => {
        const on = owner[n] ?? 0
        if (on !== 0 && on !== o && terrain[n] !== WATER && terrain[n] !== NEUTRAL) front = true
      }
      if (x > 0) check(i - 1)
      if (x < W - 1) check(i + 1)
      if (y > 0) check(i - W)
      if (y < H - 1) check(i + W)
      const p = (row + x) * 4
      if (front) {
        // Ligne de front : couleur assombrie, presque opaque.
        px[p] = color[0] * 0.55
        px[p + 1] = color[1] * 0.55
        px[p + 2] = color[2] * 0.55
        px[p + 3] = FRONT_ALPHA
      } else {
        const edge = Math.min(x, y, W - 1 - x, H - 1 - y)
        px[p] = color[0]
        px[p + 1] = color[1]
        px[p + 2] = color[2]
        px[p + 3] = AREA_ALPHA * Math.min(1, edge / EDGE_FADE)
      }
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

/** Teintes discrètes du terrain (forêt, collines, montagnes, marais), sous la couche de territoire. */
const TERRAIN_TINTS: Record<number, [number, number, number, number]> = {
  5: [34, 110, 50, 55],
  6: [150, 120, 70, 55],
  7: [110, 75, 45, 110],
  8: [40, 150, 150, 90],
}

/** Dessine le terrain une fois pour toutes : il ne change pas pendant la partie. */
export function terrainCanvas(grid: GridSnapshot): HTMLCanvasElement {
  const { width: W, height: H, terrain } = grid
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const image = ctx.createImageData(W, H)
  const px = image.data
  for (let y = 0; y < H; y++) {
    const row = (H - 1 - y) * W
    for (let x = 0; x < W; x++) {
      const tint = TERRAIN_TINTS[terrain[y * W + x] ?? 0]
      if (!tint) continue
      const p = (row + x) * 4
      px[p] = tint[0]
      px[p + 1] = tint[1]
      px[p + 2] = tint[2]
      px[p + 3] = tint[3]
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}
