import type { GridSnapshot } from '@/sim/core/types'
import { LINE_BLOCK, lineBlock, type LineBlock } from './lineBlocks'

const WATER = 1
const NEUTRAL = 2

type Rgba = [number, number, number, number]

/** Frontières : trait fin sombre entre deux pays, plus épais et plus sombre entre pays en guerre. */
export const BORDER_STYLE: Record<'peace' | 'war', { color: Rgba; width: number }> = {
  peace: { color: [22, 26, 34, 190], width: 1 },
  war: { color: [8, 8, 10, 240], width: 2.5 },
}

export interface BorderBlocks {
  peace: LineBlock[]
  war: LineBlock[]
}

/**
 * Frontières nationales en segments le long des bords de cellules, nettes à tous les zooms : un
 * segment sépare deux cellules terrestres de pays différents (pas les côtes), les bords alignés de
 * même nature formant un seul segment. Rangées par blocs de `LINE_BLOCK` cellules : une conquête ne
 * recalcule que les blocs touchés. `hostile` : paires de camps en guerre (a × 256 + b, dans les deux
 * sens), comme pour le territoire.
 */
export class BorderLines {
  private readonly cols: number
  private readonly rows: number
  private readonly blocks = new Map<number, { peace: LineBlock | null; war: LineBlock | null }>()
  private dirty = new Set<number>()
  private cache: BorderBlocks | null = null

  constructor(
    private readonly grid: Pick<GridSnapshot, 'width' | 'height' | 'bbox' | 'owner' | 'terrain'>,
    private hostile: Set<number>,
    private readonly block = LINE_BLOCK,
  ) {
    this.cols = Math.ceil(grid.width / block)
    this.rows = Math.ceil(grid.height / block)
    this.markAll()
  }

  /** Guerres changées : toutes les frontières sont reclassées. */
  setHostile(hostile: Set<number>): void {
    this.hostile = hostile
    this.markAll()
  }

  /** Cellules dont le propriétaire a changé : leurs blocs, et ceux de leurs voisines ouest et sud. */
  applyCells(cells: number[]): void {
    const W = this.grid.width
    for (const i of cells) {
      const x = i % W
      const y = (i - x) / W
      this.mark(x, y)
      if (x > 0) this.mark(x - 1, y)
      if (y > 0) this.mark(x, y - 1)
    }
  }

  /** Blocs à dessiner (les blocs modifiés sont recalculés ici). */
  lines(): BorderBlocks {
    if (this.dirty.size === 0 && this.cache) return this.cache
    for (const key of this.dirty) this.blocks.set(key, this.compute(key))
    this.dirty.clear()
    const peace: LineBlock[] = []
    const war: LineBlock[] = []
    for (const b of this.blocks.values()) {
      if (b.peace) peace.push(b.peace)
      if (b.war) war.push(b.war)
    }
    this.cache = { peace, war }
    return this.cache
  }

  private markAll(): void {
    for (let k = 0; k < this.cols * this.rows; k++) this.dirty.add(k)
  }

  private mark(x: number, y: number): void {
    this.dirty.add(Math.floor(y / this.block) * this.cols + Math.floor(x / this.block))
  }

  /** Pays d'une cellule terrestre, 0 pour la mer, les zones neutres et les cellules sans pays. */
  private land(x: number, y: number): number {
    const { width: W, height: H, owner, terrain } = this.grid
    if (x < 0 || y < 0 || x >= W || y >= H) return 0
    const i = y * W + x
    const t = terrain[i]
    return t === WATER || t === NEUTRAL ? 0 : (owner[i] ?? 0)
  }

  /** Nature du bord entre deux cellules : 0 aucun, 1 frontière, 2 frontière entre pays en guerre. */
  private edge(a: number, b: number): number {
    if (!a || !b || a === b) return 0
    return this.hostile.has(a * 256 + b) ? 2 : 1
  }

  private compute(key: number): { peace: LineBlock | null; war: LineBlock | null } {
    const { width: W, height: H, bbox } = this.grid
    const [lon0, lat0, lon1, lat1] = bbox
    const dLon = (lon1 - lon0) / W
    const dLat = (lat1 - lat0) / H
    const bx = key % this.cols
    const by = (key - bx) / this.cols
    const x0 = bx * this.block
    const y0 = by * this.block
    const x1 = Math.min(W, x0 + this.block)
    const y1 = Math.min(H, y0 + this.block)
    const out: [number[], number[]] = [[], []]
    const push = (cls: number, a: [number, number], b: [number, number]): void => {
      if (cls) out[cls - 1]?.push(a[0], a[1], b[0], b[1])
    }
    // Bords est (verticaux) : alignements le long de chaque colonne.
    for (let x = x0; x < x1; x++) {
      const lon = lon0 + (x + 1) * dLon
      let start = y0
      let cls = 0
      for (let y = y0; y <= y1; y++) {
        const c = y < y1 ? this.edge(this.land(x, y), this.land(x + 1, y)) : 0
        if (c === cls) continue
        push(cls, [lon, lat0 + start * dLat], [lon, lat0 + y * dLat])
        start = y
        cls = c
      }
    }
    // Bords nord (horizontaux) : alignements le long de chaque ligne.
    for (let y = y0; y < y1; y++) {
      const lat = lat0 + (y + 1) * dLat
      let start = x0
      let cls = 0
      for (let x = x0; x <= x1; x++) {
        const c = x < x1 ? this.edge(this.land(x, y), this.land(x, y + 1)) : 0
        if (c === cls) continue
        push(cls, [lon0 + start * dLon, lat], [lon0 + x * dLon, lat])
        start = x
        cls = c
      }
    }
    const [peace, war] = out
    return {
      peace: peace.length ? lineBlock(`border-peace-${key}`, peace) : null,
      war: war.length ? lineBlock(`border-war-${key}`, war) : null,
    }
  }
}

type Rgb = [number, number, number]

/**
 * Teintes du filtre « Pays » : bien séparées les unes des autres, assez claires pour rester lisibles
 * sous les pions.
 */
export const COUNTRY_PALETTE: Rgb[] = [
  [228, 26, 28],
  [55, 126, 184],
  [77, 175, 74],
  [152, 78, 163],
  [255, 127, 0],
  [255, 221, 51],
  [166, 86, 40],
  [247, 129, 191],
  [27, 158, 158],
  [180, 190, 60],
]

const dist2 = (a: Rgb, b: Rgb): number =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2

/** Paires de pays voisins (cellules terrestres côte à côte), par indice de camp de la grille. */
export function neighbours(
  grid: Pick<GridSnapshot, 'width' | 'height' | 'owner' | 'terrain' | 'sides'>,
): Set<number>[] {
  const { width: W, height: H, owner, terrain } = grid
  const out = grid.sides.map(() => new Set<number>())
  const land = (i: number): number => {
    const t = terrain[i]
    return t === WATER || t === NEUTRAL ? 0 : (owner[i] ?? 0)
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = land(y * W + x)
      if (!a) continue
      for (const b of [
        x + 1 < W ? land(y * W + x + 1) : 0,
        y + 1 < H ? land((y + 1) * W + x) : 0,
      ]) {
        if (!b || b === a) continue
        out[a]?.add(b)
        out[b]?.add(a)
      }
    }
  }
  return out
}

/**
 * Couleur de chaque camp pour le filtre « Pays » : deux voisins n'ont jamais la même teinte de la
 * palette. Les pays aux voisins les plus nombreux choisissent d'abord ; chacun prend, parmi les teintes
 * libres, la plus proche de sa couleur habituelle (`base`), sinon la plus éloignée de celles de ses voisins.
 */
export function countryColors(adjacency: Set<number>[], base: (side: number) => Rgb): Rgb[] {
  const out: (Rgb | undefined)[] = adjacency.map(() => undefined)
  const order = adjacency
    .map((_, i) => i)
    .sort((a, b) => (adjacency[b]?.size ?? 0) - (adjacency[a]?.size ?? 0) || a - b)
  for (const side of order) {
    const used = [...(adjacency[side] ?? [])].map((n) => out[n]).filter((c): c is Rgb => !!c)
    const free = COUNTRY_PALETTE.filter((c) => !used.includes(c))
    const own = base(side)
    let pick: Rgb
    if (free.length) {
      pick = free.reduce((best, c) => (dist2(c, own) < dist2(best, own) ? c : best))
    } else {
      const score = (c: Rgb) => Math.min(...used.map((u) => dist2(c, u)))
      pick = COUNTRY_PALETTE.reduce((best, c) => (score(c) > score(best) ? c : best))
    }
    out[side] = pick
  }
  return out.map((c) => c ?? [150, 150, 150])
}
