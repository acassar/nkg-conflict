import { runtimeOf, sideIndex, type SimContext } from '../context'
import { distanceKm } from '../theater/grid'

/** Rayon de ravitaillement autour d'une source (capitale, grande ville, dépôt). */
export const SOURCE_RADIUS_KM = 30
/** Une unité au contact peut déborder sur une cellule adverse : elle reste ravitaillée si une cellule
 * reliée de son camp est à cette distance. */
const FRONT_TOLERANCE_KM = 12

/**
 * Recalcule, pour chaque camp en guerre, les cellules reliées à ses sources de ravitaillement
 * (remplissage à travers son territoire et celui de ses cobelligérants), puis l'état ravitaillé
 * de chaque unité. Un pays en paix est entièrement ravitaillé.
 * Une unité logistique elle-même ravitaillée prolonge le ravitaillement dans son rayon.
 */
export function updateSupply(ctx: SimContext): void {
  const { grid, matrix } = ctx
  const { width: W, height: H, owner } = grid
  const queue = new Int32Array(grid.size)

  for (let side = 1; side < ctx.sides.length; side++) {
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
    const visit = (n: number): void => {
      if (!r[n] && matrix.friendly(side, owner[n] ?? 0) && grid.passable(n)) {
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
  const depots = [...ctx.units.values()].filter((u) => {
    if (ctx.catalog[u.kind].supplyRadiusKm <= 0) return false
    const reach = ctx.supplyReach[sideIndex(ctx, u.owner)]
    return reach?.[grid.cellAt(u.lon, u.lat)] === 1
  })
  for (const u of ctx.units.values()) {
    const rt = runtimeOf(ctx, u.id)
    if (matrix.atWar[sideIndex(ctx, u.owner)] !== 1) {
      rt.supplied = true
      continue
    }
    const reach = ctx.supplyReach[sideIndex(ctx, u.owner)]
    const cell = grid.cellAt(u.lon, u.lat)
    let supplied = cell >= 0 && reach?.[cell] === 1
    if (!supplied && reach) {
      grid.cellsWithin(u.lon, u.lat, FRONT_TOLERANCE_KM, (i) => {
        if (reach[i] === 1) supplied = true
      })
    }
    if (!supplied) {
      supplied = depots.some(
        (d) =>
          d.owner === u.owner &&
          distanceKm(d.lon, d.lat, u.lon, u.lat) <= ctx.catalog[d.kind].supplyRadiusKm,
      )
    }
    if (rt.supplied && !supplied) ctx.log(`Ravitaillement coupé : ${u.name}`, u.owner)
    rt.supplied = supplied
  }
}
