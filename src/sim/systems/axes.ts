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

/**
 * Poids cumulés le long d'une liste de cellules de front (déjà triée) : `cum[q]` = somme des poids des
 * cellules avant `q` ; `cum[n]` = total.
 */
export function cumulativeWeights(
  ctx: SimContext,
  cells: ReadonlyArray<{ cell: number }>,
): Float64Array {
  const cum = new Float64Array(cells.length + 1)
  for (let q = 0; q < cells.length; q++) {
    cum[q + 1] = (cum[q] ?? 0) + frontWeight(ctx, (cells[q] as { cell: number }).cell)
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
