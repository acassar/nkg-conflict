import { sideIndex, type SimContext } from '../context'
import { SOURCE_RADIUS_KM } from './supply'
import { encodeRle } from '../core/save'
import type { CountryId, LonLat } from '../core/types'

/** État logistique d'une cellule, vu par un camp. */
export const SUPPLY_NONE = 0
/** Territoire du camp ou d'un cobelligérant, relié aux sources. */
export const SUPPLY_OK = 1
/** Territoire ami coupé des sources, sans contact avec l'ennemi (île, enclave). */
export const SUPPLY_CUT = 2
/** Poche : territoire ami coupé des sources et au contact de l'ennemi. */
export const SUPPLY_POCKET = 3

export interface SupplyPocket {
  /** Cellule de la poche la plus proche de son centre. */
  at: LonLat
  cells: number
  /** Unités du joueur et de ses cobelligérants dans la poche. */
  units: number
}

/** Vue « Logistique » de la carte, calculée à la demande pour le joueur. */
export interface SupplyView {
  tick: number
  /** Faux en paix : tout le territoire est ravitaillé, aucune cellule n'est transmise. */
  atWar: boolean
  /** État par cellule (SUPPLY_*), en RLE (valeur, longueur, valeur, longueur…). */
  cells: number[]
  /** Sources de ravitaillement du joueur : capitale, grandes villes nationales, dépôts. */
  sources: LonLat[]
  /** Rayon autour de chaque source, en km. */
  sourceRadiusKm: number
  pockets: SupplyPocket[]
}

/**
 * État logistique de chaque cellule pour le camp d'un pays : reliée, coupée ou en poche.
 * Les poches sont les groupes de cellules amies coupées dont un bord touche l'ennemi.
 */
export function supplyView(ctx: SimContext, country: CountryId): SupplyView {
  const { grid, matrix } = ctx
  const side = sideIndex(ctx, country)
  const sources = (ctx.supplySources[country] ?? []).map((p): LonLat => [p[0], p[1]])
  const reach = ctx.supplyReach[side]
  const base = { tick: ctx.tick, sources, sourceRadiusKm: SOURCE_RADIUS_KM }
  if (matrix.atWar[side] !== 1 || !reach) return { ...base, atWar: false, cells: [], pockets: [] }

  const { width: W, height: H, owner } = grid
  const state = new Uint8Array(grid.size)
  // Camps amis et hostiles en table (la grille mondiale compte près de 5 millions de cellules).
  const friend = new Uint8Array(ctx.sides.length)
  const foe = new Uint8Array(ctx.sides.length)
  for (let s = 1; s < ctx.sides.length; s++) {
    friend[s] = s === side || matrix.friendly(side, s) ? 1 : 0
    foe[s] = matrix.hostile(side, s) ? 1 : 0
  }
  const cut: number[] = []
  for (let i = 0; i < grid.size; i++) {
    const o = owner[i] ?? 0
    if (!friend[o] || !grid.passable(i)) continue
    if (reach[i] === 1) state[i] = SUPPLY_OK
    else {
      state[i] = SUPPLY_CUT
      cut.push(i)
    }
  }

  // Unités amies par cellule, pour compter les défenseurs de chaque poche.
  const unitsAt = new Map<number, number>()
  for (const u of ctx.units.values()) {
    if (!friend[sideIndex(ctx, u.owner)]) continue
    const c = grid.cellAt(u.lon, u.lat)
    if (c >= 0) unitsAt.set(c, (unitsAt.get(c) ?? 0) + 1)
  }

  // Groupes de cellules coupées (4-voisinage) : une poche dès qu'un bord touche l'ennemi.
  // Une cellule en file est marquée QUEUED, puis reçoit l'état de son groupe.
  const QUEUED = 255
  const queue = new Int32Array(cut.length)
  const pockets: SupplyPocket[] = []
  const hostileAt = (n: number): boolean => foe[owner[n] ?? 0] === 1 && grid.passable(n)
  for (const start of cut) {
    if (state[start] !== SUPPLY_CUT) continue
    let head = 0
    let tail = 0
    queue[tail++] = start
    state[start] = QUEUED
    let contact = false
    let units = 0
    let sx = 0
    let sy = 0
    while (head < tail) {
      const i = queue[head++] ?? 0
      const x = i % W
      const y = (i - x) / W
      sx += x
      sy += y
      units += unitsAt.get(i) ?? 0
      const visit = (n: number): void => {
        if (state[n] === SUPPLY_CUT) {
          state[n] = QUEUED
          queue[tail++] = n
        } else if (!contact && hostileAt(n)) contact = true
      }
      if (x > 0) visit(i - 1)
      if (x < W - 1) visit(i + 1)
      if (y > 0) visit(i - W)
      if (y < H - 1) visit(i + W)
    }
    const value = contact ? SUPPLY_POCKET : SUPPLY_CUT
    // Cellule du groupe la plus proche de son centre (le centre peut tomber hors d'une poche en arc).
    const cx = sx / tail
    const cy = sy / tail
    let best = start
    let bestD = Infinity
    for (let k = 0; k < tail; k++) {
      const i = queue[k] ?? 0
      state[i] = value
      const x = i % W
      const d = (x - cx) ** 2 + ((i - x) / W - cy) ** 2
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    if (contact) pockets.push({ at: [grid.lonOf(best), grid.latOf(best)], cells: tail, units })
  }
  pockets.sort((a, b) => b.cells - a.cells)
  return { ...base, atWar: true, cells: encodeRle(state), pockets }
}
