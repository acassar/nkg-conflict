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
  /**
   * Poids de l'heuristique (1,2 par défaut). Plus élevé : recherche bien plus rapide, chemins un peu
   * moins directs ; utile pour les longs trajets vers un poste du front.
   */
  greed?: number
  /** Camp dont les cellules restent franchissables malgré les frontières fermées (évacuation après une paix). */
  alsoEnter?: number
}

/** Les 8 directions (dx, dy, longueur), en tableaux plats pour la boucle chaude de l'A*. */
const DX = Int8Array.of(1, -1, 0, 0, 1, 1, -1, -1)
const DY = Int8Array.of(0, 0, 1, -1, 1, -1, 1, -1)
const LEN = Float64Array.of(1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2)

/** Coût de passage par code de terrain, précalculé (évite la recherche de règle à chaque voisin). */
const TERRAIN_COST = Float64Array.from({ length: 256 }, (_, t) => terrainRule(t).pathCost)

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

  /** Chemin praticable le plus proche de la destination, ou null si aucun. Retourne des points lon/lat. */
  find(start: LonLat, goal: LonLat, opts: PathOptions): LonLat[] | null {
    const grid = this.grid
    const s = grid.cellAt(start[0], start[1])
    let t = grid.cellAt(goal[0], goal[1])
    if (s < 0 || t < 0) return null
    // Par propriétaire de cellule, calculés une fois par recherche : entrée permise, multiplicateur de
    // coût (territoire ennemi). La boucle chaude ne fait plus que des lectures de tableaux.
    const enter = new Uint8Array(256)
    const ownerCost = new Float64Array(256)
    for (let o = 0; o < 256; o++) {
      enter[o] = o === opts.alsoEnter || this.matrix.canEnter(opts.side, o) ? 1 : 0
      ownerCost[o] = this.matrix.hostile(opts.side, o) ? opts.enemyCost : 1
    }
    const owner = grid.owner
    const terrain = grid.terrain
    // Objectif dans l'eau ou un pays neutre : on vise la terre praticable la plus proche.
    const ok = (i: number): boolean => grid.passable(i) && enter[owner[i] ?? 0] === 1
    const goalPassable = ok(t)
    if (!goalPassable) t = this.nearestPassable(t, ok)
    if (t < 0) return null
    if (s === t) return [goal]

    this.run++
    const run = this.run
    const W = grid.width
    const H = grid.height
    const tx = t % W
    const ty = (t - tx) / W
    const h = (i: number): number => {
      const x = i % W
      const dx = x - tx
      const dy = (i - x) / W - ty
      return Math.sqrt(dx * dx + dy * dy)
    }
    const heap = this.heap
    const g = this.g
    const from = this.from
    const stamp = this.stamp
    const closed = this.closed
    heap.clear()
    g[s] = 0
    from[s] = -1
    stamp[s] = run
    const w = opts.greed ?? 1.2
    heap.push(s, w * h(s))
    const maxExpanded = opts.maxExpanded ?? 60_000
    let expanded = 0
    let best = s
    let bestH = h(s)

    while (heap.size > 0) {
      const cur = heap.pop()
      if (closed[cur] === run) continue
      closed[cur] = run
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
      const cy = (cur - cx) / W
      const gc = g[cur] ?? 0
      for (let d = 0; d < 8; d++) {
        const dx = DX[d] ?? 0
        const dy = DY[d] ?? 0
        const nx = cx + dx
        const ny = cy + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const n = ny * W + nx
        if (closed[n] === run || !ok(n)) continue
        // Pas de passage en diagonale entre deux cellules infranchissables.
        if (dx !== 0 && dy !== 0) {
          if (!ok(cy * W + nx) || !ok(ny * W + cx)) continue
        }
        const cost = (TERRAIN_COST[terrain[n] ?? 0] ?? 1) * (ownerCost[owner[n] ?? 0] ?? 1)
        const ng = gc + (LEN[d] ?? 1) * cost
        if (stamp[n] !== run || ng < (g[n] ?? Infinity)) {
          stamp[n] = run
          g[n] = ng
          from[n] = cur
          // Heuristique pondérée (1,2 par défaut) : chemins quasi optimaux, bien moins de cellules explorées.
          heap.push(n, ng + w * h(n))
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
