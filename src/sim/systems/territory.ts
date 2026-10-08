import { runtimeOf, sideIndex, type SimContext } from '../context'
import type { UnitState } from '../core/types'
import { distanceKm } from '../theater/grid'

const POCKET_GUARD_KM = 15

function zocKm(ctx: SimContext, u: UnitState): number {
  return ctx.catalog[u.kind].zocKm * (0.5 + 0.5 * u.strength)
}

/**
 * Avance de la ligne de front, une heure.
 * Une cellule passe à un camp si elle est dans la zone de contrôle d'une de ses unités, hors de celle de
 * toute unité ennemie, et touche déjà son territoire : le front avance d'une cellule à la fois, au pixel près.
 * Les poches coupées du ravitaillement et sans défenseur s'effondrent depuis leurs bords.
 */
export function updateTerritory(ctx: SimContext): void {
  const { grid } = ctx
  const units = [...ctx.units.values()].filter((u) => !runtimeOf(ctx, u.id).routed)
  const scratch: number[] = []
  const flips: Array<[number, number]> = []

  // Ennemis de chaque camp, calculés une fois par tour.
  const enemiesBySide = new Map<number, UnitState[]>()
  const enemiesOf = (side: number): UnitState[] => {
    let list = enemiesBySide.get(side)
    if (!list) {
      list = units.filter((e) => ctx.matrix.hostile(side, sideIndex(ctx, e.owner)))
      enemiesBySide.set(side, list)
    }
    return list
  }

  for (const u of units) {
    const side = sideIndex(ctx, u.owner)
    if (ctx.matrix.atWar[side] !== 1) continue
    const enemies = enemiesOf(side)
    grid.cellsWithin(u.lon, u.lat, zocKm(ctx, u), (i) => {
      const owner = grid.owner[i] ?? 0
      // Seules les cellules d'un pays en guerre contre nous peuvent être prises.
      if (owner === side || !ctx.matrix.hostile(side, owner) || !grid.passable(i)) return
      // La cellule doit toucher le territoire du camp.
      let touches = false
      for (const n of grid.neighbors4(i, scratch)) if (grid.owner[n] === side) touches = true
      if (!touches) return
      // Contestée : couverte par une unité ennemie.
      const lon = grid.lonOf(i)
      const lat = grid.latOf(i)
      for (const e of enemies) {
        if (distanceKm(lon, lat, e.lon, e.lat) <= zocKm(ctx, e)) return
      }
      flips.push([i, side])
    })
  }

  // Poches : cellules non reliées au ravitaillement de leur camp, sans défenseur proche, au contact de l'ennemi.
  for (let side = 1; side < ctx.sides.length; side++) {
    const reach = ctx.supplyReach[side]
    const candidates = ctx.unsuppliedCells[side]
    if (!reach || !candidates || candidates.length === 0) continue
    const defenders = units.filter((u) => sideIndex(ctx, u.owner) === side)
    // Candidates du tour suivant : celles qui tiennent encore, plus l'intérieur mis à nu.
    const next: number[] = []
    for (const i of candidates) {
      if (grid.owner[i] !== side || reach[i]) continue
      let enemySide = 0
      for (const n of grid.neighbors4(i, scratch)) {
        const o = grid.owner[n] ?? 0
        if (o !== 0 && ctx.matrix.hostile(side, o) && grid.passable(n)) enemySide = o
      }
      if (!enemySide) continue
      const lon = grid.lonOf(i)
      const lat = grid.latOf(i)
      if (defenders.some((d) => distanceKm(lon, lat, d.lon, d.lat) <= POCKET_GUARD_KM)) {
        next.push(i)
        continue
      }
      flips.push([i, enemySide])
      for (const n of grid.neighbors4(i, scratch)) {
        if (grid.owner[n] === side && !reach[n] && grid.passable(n)) next.push(n)
      }
    }
    ctx.unsuppliedCells[side] = [...new Set(next)]
  }

  for (const [i, side] of flips) {
    grid.setOwner(i, side)
    // Une cellule gagnée au contact d'une zone ravitaillée l'est aussi, sans attendre le prochain calcul :
    // sinon la règle des poches la rendrait aussitôt (effet de damier).
    const reach = ctx.supplyReach[side]
    if (reach && grid.neighbors4(i, scratch).some((n) => reach[n] === 1)) reach[i] = 1
  }
}
