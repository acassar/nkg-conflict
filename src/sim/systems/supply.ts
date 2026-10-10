import { runtimeOf, sideIndex, type SimContext } from '../context'
import type { UnitState } from '../core/types'
import { distanceKm } from '../theater/grid'

/** Rayon de ravitaillement autour d'une source (capitale, grande ville, dépôt). */
export const SOURCE_RADIUS_KM = 30
/** Une unité au contact peut déborder sur une cellule adverse : elle reste ravitaillée si une cellule
 * reliée de son camp est à cette distance. */
const FRONT_TOLERANCE_KM = 12

/** File du remplissage, réutilisée d'un appel à l'autre (plusieurs Mo sur la carte du monde). */
const queues = new WeakMap<SimContext, Int32Array>()

/**
 * Recalcule, pour chaque camp en guerre (ou ceux que `only` retient), les cellules reliées à ses sources de ravitaillement
 * (remplissage à travers son territoire et celui de ses cobelligérants), puis l'état ravitaillé
 * de chaque unité. Un pays en paix est entièrement ravitaillé.
 * Une unité logistique elle-même ravitaillée prolonge le ravitaillement dans son rayon.
 */
export function updateSupply(ctx: SimContext, only?: (side: number) => boolean): void {
  const { grid, matrix } = ctx
  const { width: W, height: H, owner } = grid
  let queue = queues.get(ctx)
  if (!queue || queue.length !== grid.size) {
    queue = new Int32Array(grid.size)
    queues.set(ctx, queue)
  }

  for (let side = 1; side < ctx.sides.length; side++) {
    if (only && !only(side)) continue
    if (matrix.atWar[side] !== 1) {
      // Hors guerre : pas de calcul (et on libère la mémoire d'une guerre terminée).
      if (ctx.supplyReach[side]) {
        delete ctx.supplyReach[side]
        delete ctx.unsuppliedCells[side]
      }
      continue
    }
    const country = ctx.sides[side] ?? ''
    let reach = ctx.supplyReach[side]
    if (!reach || reach.length !== grid.size) {
      reach = new Uint8Array(grid.size)
      ctx.supplyReach[side] = reach
    }
    reach.fill(0)
    let head = 0
    let tail = 0
    const r = reach
    for (const [lon, lat] of ctx.supplySources[country] ?? []) {
      grid.cellsWithin(lon, lat, SOURCE_RADIUS_KM, (i) => {
        if (owner[i] === side && grid.passable(i) && !r[i]) {
          r[i] = 1
          queue[tail++] = i
        }
      })
    }
    // Le ravitaillement suit le territoire des cobelligérants et celui des pays qui accordent le passage.
    const visit = (n: number): void => {
      const o = owner[n] ?? 0
      if (!r[n] && (matrix.friendly(side, o) || matrix.passage(side, o)) && grid.passable(n)) {
        r[n] = 1
        queue[tail++] = n
      }
    }
    while (head < tail) {
      const i = queue[head++] ?? 0
      const x = i % W
      if (x > 0) visit(i - 1)
      if (x < W - 1) visit(i + 1)
      if (i >= W) visit(i - W)
      if (i < (H - 1) * W) visit(i + W)
    }

    // Poches : cellules non reliées au contact de l'ennemi (une poche s'effondre par ses bords).
    const pockets: number[] = []
    const hostileAt = (n: number): boolean =>
      matrix.hostile(side, owner[n] ?? 0) && grid.passable(n)
    for (const box of grid.contactBoxes(side, matrix.enemiesOf(side))) {
      for (let y = box.y0; y <= box.y1; y++) {
        for (let x = box.x0; x <= box.x1; x++) {
          const i = y * W + x
          if (owner[i] !== side || r[i] || !grid.passable(i)) continue
          const edge =
            (x > 0 && hostileAt(i - 1)) ||
            (x < W - 1 && hostileAt(i + 1)) ||
            (y > 0 && hostileAt(i - W)) ||
            (y < H - 1 && hostileAt(i + W))
          if (edge) pockets.push(i)
        }
      }
    }
    ctx.unsuppliedCells[side] = pockets
  }

  // Unités : ravitaillées si leur cellule est reliée, ou proches d'une unité logistique reliée.
  // Les dépôts ne sont listés qu'au premier besoin (rare : une unité hors des cellules reliées).
  let depots: UnitState[] | null = null
  const depotsList = (): UnitState[] =>
    (depots ??= [...ctx.units.values()].filter((u) => {
      if (ctx.catalog[u.kind].supplyRadiusKm <= 0) return false
      const reach = ctx.supplyReach[sideIndex(ctx, u.owner)]
      return reach?.[grid.cellAt(u.lon, u.lat)] === 1
    }))
  // Camps retenus par `only`, évalués une fois par camp plutôt qu'une fois par unité.
  const retained = new Int8Array(ctx.sides.length).fill(-1)
  for (const u of ctx.units.values()) {
    const side = sideIndex(ctx, u.owner)
    if (only) {
      if (retained[side] === -1) retained[side] = only(side) ? 1 : 0
      if (retained[side] !== 1) continue
    }
    const rt = runtimeOf(ctx, u.id)
    if (matrix.atWar[side] !== 1) {
      rt.supplied = true
      continue
    }
    const reach = ctx.supplyReach[side]
    const cell = grid.cellAt(u.lon, u.lat)
    let supplied = cell >= 0 && reach?.[cell] === 1
    if (!supplied && reach) {
      grid.cellsWithin(u.lon, u.lat, FRONT_TOLERANCE_KM, (i) => {
        if (reach[i] === 1) supplied = true
      })
    }
    if (!supplied) {
      supplied = depotsList().some(
        (d) =>
          d.owner === u.owner &&
          distanceKm(d.lon, d.lat, u.lon, u.lat) <= ctx.catalog[d.kind].supplyRadiusKm,
      )
    }
    if (rt.supplied && !supplied) ctx.log(`Ravitaillement coupé : ${u.name}`, u.owner)
    rt.supplied = supplied
  }
}
