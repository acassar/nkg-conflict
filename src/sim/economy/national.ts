import type { SimContext } from '../context'

/** Part du rendement d'un territoire occupé qui revient à l'occupant. */
export const OCCUPATION_YIELD = 0.3
/** Part de la main-d'œuvre d'un territoire occupé qui revient à l'occupant. */
export const OCCUPATION_MANPOWER = 0.1

/**
 * Territoire tenu par chaque camp, rapporté au territoire de départ de chaque pays :
 * `home[s]` = part de son propre territoire que le camp s tient encore ;
 * `occupied[s]` = parts des territoires d'autres pays qu'il occupe ([camp d'origine, part]).
 */
export interface TerritoryShares {
  home: Float64Array
  occupied: Map<number, Array<[number, number]>>
}

const homeTotals = new WeakMap<SimContext, Float64Array>()
const cache = new WeakMap<SimContext, { tick: number; shares: TerritoryShares }>()

/** Cellules de départ de chaque camp (calculées une fois). */
function totals(ctx: SimContext): Float64Array {
  let t = homeTotals.get(ctx)
  if (!t) {
    t = new Float64Array(256)
    const home = ctx.homeOwner
    for (let i = 0; i < home.length; i++) {
      const h = home[i] ?? 0
      if (h) t[h] = (t[h] ?? 0) + 1
    }
    homeTotals.set(ctx, t)
  }
  return t
}

/** Parts de territoire, recalculées au plus une fois par tick (un parcours de la grille). */
export function territoryShares(ctx: SimContext): TerritoryShares {
  const hit = cache.get(ctx)
  if (hit && hit.tick === ctx.tick) return hit.shares
  const total = totals(ctx)
  // Comptes tenus à jour par la grille ; sinon (contexte de test), un parcours complet.
  let counts = ctx.grid.occupationFor(ctx.homeOwner)
  if (!counts) {
    counts = new Uint32Array(256 * 256)
    const owner = ctx.grid.owner
    const home = ctx.homeOwner
    for (let i = 0; i < owner.length; i++) {
      const h = home[i] ?? 0
      if (!h) continue
      const k = (owner[i] ?? 0) * 256 + h
      counts[k] = (counts[k] ?? 0) + 1
    }
  }
  const shares: TerritoryShares = { home: new Float64Array(256), occupied: new Map() }
  for (let s = 1; s < 256; s++) {
    const t = total[s] ?? 0
    if (t > 0) shares.home[s] = (counts[s * 256 + s] ?? 0) / t
  }
  for (let holder = 1; holder < 256; holder++) {
    for (let orig = 1; orig < 256; orig++) {
      if (holder === orig) continue
      const n = counts[holder * 256 + orig] ?? 0
      if (n === 0) continue
      const t = total[orig] ?? 0
      if (t === 0) continue
      const list = shares.occupied.get(holder) ?? []
      list.push([orig, n / t])
      shares.occupied.set(holder, list)
    }
  }
  cache.set(ctx, { tick: ctx.tick, shares })
  return shares
}
