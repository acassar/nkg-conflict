import type { LonLat } from '../core/types'
import { terrainRule, type Grid } from '../theater/grid'
import type { SideMatrix } from '../politics/matrix'

/** Tas binaire minimal (file de priorité) sur des indices de cellules. */
class MinHeap {
  private items: number[] = []
  private prio: number[] = []

  get size(): number {
    return this.items.length
  }

  clear(): void {
    this.items.length = 0
    this.prio.length = 0
  }

  push(item: number, p: number): void {
    const { items, prio } = this
    items.push(item)
    prio.push(p)
    let i = items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if ((prio[parent] ?? 0) <= p) break
      items[i] = items[parent] ?? 0
      prio[i] = prio[parent] ?? 0
      i = parent
    }
    items[i] = item
    prio[i] = p
  }

  pop(): number {
    const { items, prio } = this
    const top = items[0] ?? -1
    const lastItem = items.pop() ?? 0
    const lastPrio = prio.pop() ?? 0
    const n = items.length
    if (n > 0) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        let mp = lastPrio
        if (l < n && (prio[l] ?? 0) < mp) {
          m = l
          mp = prio[l] ?? 0
        }
        if (r < n && (prio[r] ?? 0) < mp) {
          m = r
          mp = prio[r] ?? 0
        }
        if (m === i) break
        items[i] = items[m] ?? 0
        prio[i] = prio[m] ?? 0
        i = m
      }
      items[i] = lastItem
      prio[i] = lastPrio
    }
    return top
  }
}

export interface PathOptions {
  /** Camp de l'unité : les cellules ennemies coûtent plus cher. */
  side: number
  /** Multiplicateur de coût en territoire ennemi (retraite = très élevé). */
  enemyCost: number
  /** Nombre maximal de cellules explorées avant abandon. */
  maxExpanded?: number
}

const DIRS: ReadonlyArray<[number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
]

/** A* sur la grille, en 8 directions. Réutilise ses tableaux entre deux appels. */
export class Pathfinder {
  private readonly g: Float32Array
  private readonly from: Int32Array
  private readonly stamp: Uint32Array
  private readonly closed: Uint32Array
  private run = 0
  private readonly heap = new MinHeap()

  constructor(
    private readonly grid: Grid,
    private readonly matrix: SideMatrix,
  ) {
    this.g = new Float32Array(grid.size)
    this.from = new Int32Array(grid.size)
    this.stamp = new Uint32Array(grid.size)
    this.closed = new Uint32Array(grid.size)
  }

  private cellCost(i: number, opts: PathOptions): number {
    const t = this.grid.terrain[i]
    let c = terrainRule(t).pathCost
    const o = this.grid.owner[i] ?? 0
    if (this.matrix.hostile(opts.side, o)) c *= opts.enemyCost
    return c
  }

  /** Chemin praticable le plus proche de la destination, ou null si aucun. Retourne des points lon/lat. */
  find(start: LonLat, goal: LonLat, opts: PathOptions): LonLat[] | null {
    const grid = this.grid
    const s = grid.cellAt(start[0], start[1])
    let t = grid.cellAt(goal[0], goal[1])
    if (s < 0 || t < 0) return null
    // Objectif dans l'eau ou un pays neutre : on vise la terre praticable la plus proche.
    const ok = (i: number): boolean =>
      grid.passable(i) && this.matrix.canEnter(opts.side, grid.owner[i] ?? 0)
    const goalPassable = ok(t)
    if (!goalPassable) t = this.nearestPassable(t, ok)
    if (t < 0) return null
    if (s === t) return [goal]

    this.run++
    const run = this.run
    const W = grid.width
    const tx = t % W
    const ty = Math.floor(t / W)
    const h = (i: number): number => Math.hypot((i % W) - tx, Math.floor(i / W) - ty)
    const heap = this.heap
    heap.clear()
    this.g[s] = 0
    this.from[s] = -1
    this.stamp[s] = run
    heap.push(s, 1.2 * h(s))
    const maxExpanded = opts.maxExpanded ?? 60_000
    let expanded = 0
    let best = s
    let bestH = h(s)

    while (heap.size > 0) {
      const cur = heap.pop()
      if (this.closed[cur] === run) continue
      this.closed[cur] = run
      if (cur === t) {
        best = t
        break
      }
      const hc = h(cur)
      if (hc < bestH) {
        bestH = hc
        best = cur
      }
      if (++expanded > maxExpanded) break
      const cx = cur % W
      const cy = Math.floor(cur / W)
      const gc = this.g[cur] ?? 0
      for (const [dx, dy, len] of DIRS) {
        const nx = cx + dx
        const ny = cy + dy
        if (!grid.inBounds(nx, ny)) continue
        const n = ny * W + nx
        if (!ok(n) || this.closed[n] === run) continue
        // Pas de passage en diagonale entre deux cellules infranchissables.
        if (dx !== 0 && dy !== 0) {
          if (!ok(cy * W + nx) || !ok(ny * W + cx)) continue
        }
        const ng = gc + len * this.cellCost(n, opts)
        if (this.stamp[n] !== run || ng < (this.g[n] ?? Infinity)) {
          this.stamp[n] = run
          this.g[n] = ng
          this.from[n] = cur
          // Heuristique pondérée (1,2) : chemins quasi optimaux, beaucoup moins de cellules explorées.
          heap.push(n, ng + 1.2 * h(n))
        }
      }
    }

    const cells: number[] = []
    for (let c = best; c !== -1; c = this.from[c] ?? -1) {
      cells.push(c)
      if (c === s) break
    }
    cells.reverse()
    const pts = simplify(cells, W).map((c): LonLat => [grid.lonOf(c), grid.latOf(c)])
    if (best === t && goalPassable) pts[pts.length - 1] = goal
    return pts.length > 0 ? pts : null
  }

  private nearestPassable(t: number, ok: (i: number) => boolean): number {
    const grid = this.grid
    const W = grid.width
    const tx = t % W
    const ty = Math.floor(t / W)
    for (let r = 1; r < 40; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const x = tx + dx
          const y = ty + dy
          if (grid.inBounds(x, y) && ok(y * W + x)) return y * W + x
        }
      }
    }
    return -1
  }
}

/** Garde seulement les cellules où la direction change (moins de points à suivre et à afficher). */
function simplify(cells: number[], W: number): number[] {
  if (cells.length <= 2) return cells.slice(1)
  const out: number[] = []
  for (let k = 1; k < cells.length - 1; k++) {
    const a = cells[k - 1] ?? 0
    const b = cells[k] ?? 0
    const c = cells[k + 1] ?? 0
    const d1 = [(b % W) - (a % W), Math.floor(b / W) - Math.floor(a / W)]
    const d2 = [(c % W) - (b % W), Math.floor(c / W) - Math.floor(b / W)]
    if (d1[0] !== d2[0] || d1[1] !== d2[1]) out.push(b)
  }
  out.push(cells[cells.length - 1] ?? 0)
  return out
}
