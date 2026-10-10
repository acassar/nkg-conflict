import { runtimeOf, sideIndex, type SimContext } from '../context'
import type { UnitState } from '../core/types'
import { distanceKm } from '../theater/grid'
import { WarIndex } from './spatial'

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
  // Unités hors déroute de tous les camps, listées seulement si une poche est à examiner.
  let all: UnitState[] | null = null
  const units = (): UnitState[] =>
    (all ??= [...ctx.units.values()].filter((u) => !runtimeOf(ctx, u.id).routed))
  const scratch: number[] = []
  const flips: Array<[number, number]> = []

  // Ennemis proches, par index spatial (une cellule n'est comparée qu'aux unités voisines) ; les
  // unités en déroute n'ont pas de zone de contrôle.
  const index = new WarIndex(ctx)
  let maxZoc = 0
  for (const u of index.units) maxZoc = Math.max(maxZoc, zocKm(ctx, u))
  const covers = (e: UnitState, km: number): boolean =>
    km <= zocKm(ctx, e) && !runtimeOf(ctx, e.id).routed

  // Seules les unités des camps en guerre (celles de l'index) prennent du terrain.
  for (const u of index.units) {
    if (runtimeOf(ctx, u.id).routed) continue
    const side = index.sideOf.get(u.id) ?? sideIndex(ctx, u.owner)
    grid.cellsWithin(u.lon, u.lat, zocKm(ctx, u), (i) => {
      const owner = grid.owner[i] ?? 0
      // Seules les cellules d'un pays en guerre contre nous peuvent être prises.
      if (owner === side || !ctx.matrix.hostile(side, owner) || !grid.passable(i)) return
      // La cellule doit toucher le territoire du camp.
      let touches = false
      for (const n of grid.neighbors4(i, scratch)) if (grid.owner[n] === side) touches = true
      if (!touches) return
      // Contestée : couverte par une unité ennemie.
      if (index.forEachEnemyAt(side, grid.lonOf(i), grid.latOf(i), maxZoc, covers)) return
      flips.push([i, side])
    })
  }

  // Poches : cellules non reliées au ravitaillement de leur camp, sans défenseur proche, au contact de l'ennemi.
  for (let side = 1; side < ctx.sides.length; side++) {
    const reach = ctx.supplyReach[side]
    const candidates = ctx.unsuppliedCells[side]
    if (!reach || !candidates || candidates.length === 0) continue
    const defenders = units().filter((u) => sideIndex(ctx, u.owner) === side)
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
