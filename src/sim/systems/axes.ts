import type { SimContext } from '../context'
import type { LonLat } from '../core/types'
import { MAJOR_ROAD_BIT, RAIL_BIT, ROAD_BIT, Terrain } from '../theater/grid'

/**
 * Axes du front discontinu : les routes, voies ferrées et villes (données Natural Earth) font les
 * secteurs actifs, que les armées tiennent en force ; le terrain difficile sans route (forêt, marais,
 * montagne) fait les secteurs calmes, tenus par quelques postes seulement.
 */

/** Rayon (km) autour d'une cellule de front où l'on cherche une route, une voie ferrée ou une ville. */
const AXIS_RADIUS_KM = 8
/** Poids d'une cellule de front sans axe, en terrain ouvert. */
const OPEN_WEIGHT = 1
/** Poids d'une cellule de front sans axe, en terrain difficile (secteur calme). */
const ROUGH_WEIGHT = 0.35
/** Bonus d'axe : grand axe routier, voie ferrée, route, ville (le plus fort compte, plus la ville). */
const MAJOR_ROAD_BONUS = 3
const RAIL_BONUS = 2.5
const ROAD_BONUS = 1.5
const CITY_BONUS = 2

/** Rayon de recherche des axes en cellules (1 sur la carte du monde, 2 sur le théâtre ukrainien). */
export function axisRadiusCells(ctx: SimContext): number {
  const kmPerCell = ctx.grid.cell * 111
  return Math.max(1, Math.round(AXIS_RADIUS_KM / kmPerCell))
}

/** Terrain difficile : un secteur sans axe y reste calme. */
function rough(t: number | undefined): boolean {
  return t === Terrain.FOREST || t === Terrain.MARSH || t === Terrain.MOUNTAINS
}

/**
 * Intérêt d'une cellule comme axe (0 = aucun) : meilleur réseau à moins de `AXIS_RADIUS_KM`
 * (grand axe, voie ferrée ou route), plus un bonus s'il y a une ville.
 */
export function axisBonus(ctx: SimContext, cell: number): number {
  const { grid } = ctx
  const W = grid.width
  const r = axisRadiusCells(ctx)
  const x0 = cell % W
  const y0 = Math.floor(cell / W)
  let bits = 0
  let city = false
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = x0 + dx
      const y = y0 + dy
      if (!grid.inBounds(x, y)) continue
      const i = y * W + x
      bits |= grid.roads[i] ?? 0
      if (grid.terrain[i] === Terrain.URBAN) city = true
    }
  }
  const network =
    bits & MAJOR_ROAD_BIT
      ? MAJOR_ROAD_BONUS
      : bits & RAIL_BIT
        ? RAIL_BONUS
        : bits & ROAD_BIT
          ? ROAD_BONUS
          : 0
  return network + (city ? CITY_BONUS : 0)
}

/** Poids d'une cellule de front dans la répartition des postes : axe fort = beaucoup d'unités. */
export function frontWeight(ctx: SimContext, cell: number): number {
  const bonus = axisBonus(ctx, cell)
  if (bonus > 0) return OPEN_WEIGHT + bonus
  return rough(ctx.grid.terrain[cell]) ? ROUGH_WEIGHT : OPEN_WEIGHT
}

// ---------- Points clés (mission « Tenir les points clés ») ----------

/** Nature d'un point clé : ville, passage de fleuve, nœud routier (bits combinables). */
export const KEY_CITY = 1
export const KEY_CROSSING = 2
export const KEY_NODE = 4

/** Poids d'une cellule de front sans point clé dans cette mission : simple écran. */
const SCREEN_WEIGHT = 0.2
/** Poids d'un point clé : base, plus tant par nature (ville, passage, nœud). */
const KEY_BASE_WEIGHT = 2
const KEY_KIND_WEIGHT = 3

/** Points clés déjà calculés, par grille (réseau et terrain sont fixes pendant la partie). */
const keyCache = new WeakMap<object, Map<number, number>>()

/** Anneau couvert de routes à ce point (réseau dense autour d'une ville) : nœud routier. */
const DENSE_RING_SHARE = 0.6

/**
 * Nœud routier : sur l'anneau de cellules qui entoure `cell` à la distance `ring`, au moins trois
 * tronçons de route ou de voie ferrée distincts (une route qui ne fait que passer en donne deux), ou un
 * anneau presque entièrement couvert de routes (étoile de routes autour d'une ville).
 */
function roadNode(ctx: SimContext, cell: number, ring: number): boolean {
  const { grid } = ctx
  const W = grid.width
  const x0 = cell % W
  const y0 = Math.floor(cell / W)
  // Parcours de l'anneau dans l'ordre (sens horaire depuis le coin haut gauche).
  const ringCells: Array<[number, number]> = []
  for (let dx = -ring; dx < ring; dx++) ringCells.push([dx, -ring])
  for (let dy = -ring; dy < ring; dy++) ringCells.push([ring, dy])
  for (let dx = ring; dx > -ring; dx--) ringCells.push([dx, ring])
  for (let dy = ring; dy > -ring; dy--) ringCells.push([-ring, dy])
  const on = ringCells.map(([dx, dy]) => {
    const x = x0 + dx
    const y = y0 + dy
    return grid.inBounds(x, y) && (grid.roads[y * W + x] ?? 0) !== 0
  })
  let runs = 0
  let count = 0
  for (let k = 0; k < on.length; k++) {
    if (on[k]) count++
    if (on[k] && !on[(k + on.length - 1) % on.length]) runs++
  }
  return runs >= 3 || count >= DENSE_RING_SHARE * on.length
}

/**
 * Points clés à moins de `AXIS_RADIUS_KM` d'une cellule (0 = aucun) : ville (terrain urbain), passage de
 * fleuve (route ou voie ferrée sur un fleuve ou au bord), nœud routier (trois tronçons ou plus).
 */
export function keyPointKinds(ctx: SimContext, cell: number): number {
  const { grid } = ctx
  let cache = keyCache.get(grid)
  if (!cache) {
    cache = new Map()
    keyCache.set(grid, cache)
  }
  const known = cache.get(cell)
  if (known !== undefined) return known
  const W = grid.width
  const r = axisRadiusCells(ctx)
  const x0 = cell % W
  const y0 = Math.floor(cell / W)
  const river = (x: number, y: number): boolean =>
    grid.inBounds(x, y) && grid.terrain[y * W + x] === Terrain.RIVER
  let kinds = 0
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = x0 + dx
      const y = y0 + dy
      if (!grid.inBounds(x, y)) continue
      const i = y * W + x
      if (grid.terrain[i] === Terrain.URBAN) kinds |= KEY_CITY
      if (
        (grid.roads[i] ?? 0) !== 0 &&
        (river(x, y) || river(x - 1, y) || river(x + 1, y) || river(x, y - 1) || river(x, y + 1))
      ) {
        kinds |= KEY_CROSSING
      }
    }
  }
  if (roadNode(ctx, cell, Math.max(2, r))) kinds |= KEY_NODE
  cache.set(cell, kinds)
  return kinds
}

/** Nombre de natures de point clé (0 à 3). */
function kindCount(kinds: number): number {
  return (kinds & 1) + ((kinds >> 1) & 1) + ((kinds >> 2) & 1)
}

/** Poids d'une cellule de front dans la mission « Tenir les points clés » : forts sur les points clés. */
export function keyPointWeight(ctx: SimContext, cell: number): number {
  const n = kindCount(keyPointKinds(ctx, cell))
  return n > 0 ? KEY_BASE_WEIGHT + KEY_KIND_WEIGHT * n : SCREEN_WEIGHT
}

/** Fonction de poids des cellules de front (répartition des postes). */
export type WeightFn = (ctx: SimContext, cell: number) => number

/**
 * Poids cumulés le long d'une liste de cellules de front (déjà triée) : `cum[q]` = somme des poids des
 * cellules avant `q` ; `cum[n]` = total. Par défaut, le poids des axes du front discontinu.
 */
export function cumulativeWeights(
  ctx: SimContext,
  cells: ReadonlyArray<{ cell: number }>,
  weight: WeightFn = frontWeight,
): Float64Array {
  const cum = new Float64Array(cells.length + 1)
  for (let q = 0; q < cells.length; q++) {
    cum[q + 1] = (cum[q] ?? 0) + weight(ctx, (cells[q] as { cell: number }).cell)
  }
  return cum
}

/** Indice de la cellule où le poids cumulé atteint la part `share` (0 à 1) du total. */
export function indexAtShare(cum: Float64Array, share: number): number {
  const n = cum.length - 1
  if (n <= 0) return 0
  const goal = share * (cum[n] ?? 0)
  let lo = 0
  let hi = n - 1
  // Première cellule dont la fin dépasse le poids visé.
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((cum[mid + 1] ?? 0) <= goal) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Cellule d'axe (route ou voie ferrée) la plus proche d'un point, à moins de `maxKm` ; sinon le point
 * lui-même. Sert à viser l'axe qui alimente une percée.
 */
export function snapToAxis(ctx: SimContext, p: LonLat, maxKm: number): LonLat {
  const { grid } = ctx
  let best = -1
  let bestD = Infinity
  const c0 = grid.cellAt(p[0], p[1])
  grid.cellsWithin(p[0], p[1], maxKm, (i) => {
    if ((grid.roads[i] ?? 0) === 0 || !grid.passable(i)) return
    const dx = (i % grid.width) - (c0 % grid.width)
    const dy = Math.floor(i / grid.width) - Math.floor(c0 / grid.width)
    const d = dx * dx + dy * dy
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  return best < 0 ? p : [grid.lonOf(best), grid.latOf(best)]
}
