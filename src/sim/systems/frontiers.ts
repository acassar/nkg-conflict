import { countryName, sideIndex, type SimContext } from '../context'
import type { ArmyState, LonLat } from '../core/types'
import type { Grid } from '../theater/grid'
import type { FrontCell } from './armies'

/**
 * Frontières tenues par les armées (phase G2), en paix comme en guerre : une armée reçoit des cellules
 * de la frontière terrestre de son pays (peintes au glisser, ou toute la frontière avec un voisin). En
 * paix, elle s'y déploie sans franchir ; si la guerre éclate avec ce voisin, la frontière devient son
 * front (voir `updateBorderFronts`). Plusieurs armées se partagent une frontière sans chevauchement.
 */

/** Une cellule tenue par plusieurs armées : impossible, une prise la retire aux autres. */
export type BorderMode =
  /** Cellules peintes : prises à l'armée qui les tenait. */
  | 'paint'
  /** Frontière avec un voisin (clic sur le pays) : seulement les cellules qu'aucune armée ne tient. */
  | 'free'
  /** « Prendre toute la frontière » : retirée explicitement aux autres armées. */
  | 'all'

/** Voisins étrangers (index de camp) d'une cellule du camp `side`, en 4-voisinage, sans doublon. */
export function foreignNeighbors(grid: Grid, side: number, i: number): number[] {
  const out: number[] = []
  if (grid.owner[i] !== side || !grid.passable(i)) return out
  const W = grid.width
  const x = i % W
  const check = (n: number): void => {
    const o = grid.owner[n] ?? 0
    if (o !== 0 && o !== side && grid.passable(n) && !out.includes(o)) out.push(o)
  }
  if (x > 0) check(i - 1)
  if (x < W - 1) check(i + 1)
  if (i >= W) check(i - W)
  if (i + W < grid.size) check(i + W)
  return out
}

/** Cellule de frontière terrestre du camp : à lui, praticable, voisine d'un autre pays. */
export function isBorderCell(grid: Grid, side: number, i: number): boolean {
  return foreignNeighbors(grid, side, i).length > 0
}

/** Cellules du camp `side` sur sa frontière avec le camp `other`, balayées dans l'emprise du camp. */
export function borderWith(grid: Grid, side: number, other: number): number[] {
  const box = grid.boxes[side]
  if (!box || box.x1 < 0) return []
  const out: number[] = []
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const i = y * grid.width + x
      if (grid.owner[i] === side && foreignNeighbors(grid, side, i).includes(other)) out.push(i)
    }
  }
  return out
}

/** Armées du même pays que `army`, sauf elle. */
function siblings(ctx: SimContext, army: ArmyState): ArmyState[] {
  return [...ctx.armies.values()].filter((a) => a.owner === army.owner && a !== army)
}

/**
 * Donne des cellules de frontière à une armée (ajoutées à celles qu'elle tient). Seules les cellules de
 * frontière terrestre de son pays sont gardées. Renvoie les armées qui ont perdu des cellules (leur
 * répartition est à refaire), ou un message d'erreur si aucune cellule n'a été prise.
 */
export function assignBorder(
  ctx: SimContext,
  army: ArmyState,
  cells: Iterable<number>,
  mode: BorderMode,
): { losers: ArmyState[] } | string {
  const side = sideIndex(ctx, army.owner)
  const others = siblings(ctx, army)
  const heldByOthers = new Set<number>()
  for (const a of others) for (const c of a.border ?? []) heldByOthers.add(c)
  const mine = new Set(army.border ?? [])
  const taken = new Set<number>()
  let onBorder = false
  let blocked = false
  for (const c of cells) {
    if (!isBorderCell(ctx.grid, side, c)) continue
    onBorder = true
    if (mine.has(c)) continue
    if (mode === 'free' && heldByOthers.has(c)) blocked = true
    else taken.add(c)
  }
  if (taken.size === 0) {
    if (!onBorder)
      return 'Aucune frontière terrestre ici : glissez le long de la frontière de votre pays'
    return blocked
      ? "Cette frontière est déjà tenue par d'autres armées : « Prendre toute la frontière » pour la leur retirer"
      : "L'armée tient déjà cette portion de frontière"
  }
  const losers: ArmyState[] = []
  for (const a of others) {
    if (!a.border?.some((c) => taken.has(c))) continue
    a.border = a.border.filter((c) => !taken.has(c))
    if (a.border.length === 0) delete a.border
    losers.push(a)
  }
  army.border = [...mine, ...taken].sort((p, q) => p - q)
  return { losers }
}

/**
 * Pays voisins (index de camp) le long de la frontière tenue par l'armée. Un tripoint ne compte pas :
 * il faut au moins une cellule qui ne touche que ce voisin.
 */
export function borderNeighbors(ctx: SimContext, army: ArmyState): number[] {
  const side = sideIndex(ctx, army.owner)
  const out = new Set<number>()
  for (const c of army.border ?? []) {
    const n = foreignNeighbors(ctx.grid, side, c)
    if (n.length === 1) out.add(n[0] as number)
  }
  return [...out]
}

/** Retire les cellules qui ne sont plus une frontière du pays (territoire perdu, voisin annexé). */
export function pruneBorder(ctx: SimContext, army: ArmyState): void {
  if (!army.border) return
  const side = sideIndex(ctx, army.owner)
  army.border = army.border.filter((c) => isBorderCell(ctx.grid, side, c))
  if (army.border.length === 0) delete army.border
}

/**
 * Cellules de la frontière tenue, prêtes pour la répartition des postes (comme `frontCells`) : direction
 * de l'arrière opposée aux voisins étrangers, position le long de l'axe principal de la portion.
 */
export function borderFrontCells(ctx: SimContext, army: ArmyState): FrontCell[] {
  const { grid } = ctx
  const side = sideIndex(ctx, army.owner)
  const W = grid.width
  const raw: Array<{ cell: number; back: [number, number] }> = []
  const foreign = (n: number): boolean => {
    const o = grid.owner[n] ?? 0
    return o !== 0 && o !== side && grid.passable(n)
  }
  for (const i of army.border ?? []) {
    if (grid.owner[i] !== side || !grid.passable(i)) continue
    const x = i % W
    let bx = 0
    let by = 0
    if (x > 0 && foreign(i - 1)) bx += 1
    if (x < W - 1 && foreign(i + 1)) bx -= 1
    if (i >= W && foreign(i - W)) by += 1
    if (i + W < grid.size && foreign(i + W)) by -= 1
    if (bx === 0 && by === 0) continue
    raw.push({ cell: i, back: [Math.sign(bx), Math.sign(by)] })
  }
  if (raw.length === 0) return []
  const axis = principalAxis(raw.map((r): LonLat => [grid.lonOf(r.cell), grid.latOf(r.cell)]))
  const out = raw.map((r) => ({
    cell: r.cell,
    back: r.back,
    t: axis(grid.lonOf(r.cell), grid.latOf(r.cell)),
  }))
  out.sort((a, b) => a.t - b.t)
  return out
}

/**
 * Axe principal d'un nuage de points (longitudes ramenées en km à la latitude moyenne) : renvoie la
 * position d'un point le long de cet axe, de 0 à 1 entre les deux extrêmes du nuage.
 */
function principalAxis(points: LonLat[]): (lon: number, lat: number) => number {
  const n = points.length
  let mx = 0
  let my = 0
  for (const [lon, lat] of points) {
    mx += lon
    my += lat
  }
  mx /= n
  my /= n
  const k = Math.cos((my * Math.PI) / 180)
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const [lon, lat] of points) {
    const dx = (lon - mx) * k
    const dy = lat - my
    sxx += dx * dx
    syy += dy * dy
    sxy += dx * dy
  }
  // Direction propre de la plus grande valeur propre de la matrice de covariance.
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const ux = Math.cos(angle)
  const uy = Math.sin(angle)
  const proj = (lon: number, lat: number): number => (lon - mx) * k * ux + (lat - my) * uy
  let lo = Infinity
  let hi = -Infinity
  for (const [lon, lat] of points) {
    const p = proj(lon, lat)
    if (p < lo) lo = p
    if (p > hi) hi = p
  }
  const span = hi - lo || 1
  return (lon, lat) => Math.max(0, Math.min(1, (proj(lon, lat) - lo) / span))
}

/**
 * Passage de la paix à la guerre et retour, pour les armées qui tiennent une frontière. Guerre avec un
 * voisin de la frontière : la portion qui le touche devient le front de l'armée (deux extrémités, comme
 * une portion tracée), sans redéploiement puisque ses unités y sont déjà. Paix revenue : l'armée
 * retrouve sa frontière. Renvoie les armées dont la répartition est à refaire.
 */
export function updateBorderFronts(ctx: SimContext): ArmyState[] {
  const changed: ArmyState[] = []
  for (const army of ctx.armies.values()) {
    if (!army.border) continue
    const side = sideIndex(ctx, army.owner)
    if (army.borderFront) {
      if (ctx.matrix.atWar[side] === 1) continue
      army.front = null
      delete army.borderFront
      pruneBorder(ctx, army)
      changed.push(army)
      continue
    }
    if (army.front || army.wholeFront || ctx.matrix.atWar[side] !== 1) continue
    const contact: FrontCell[] = borderFrontCells(ctx, army).filter((f) =>
      foreignNeighbors(ctx.grid, side, f.cell).some((o) => ctx.matrix.hostile(side, o)),
    )
    const first = contact[0]
    const last = contact[contact.length - 1]
    if (!first || !last) continue
    const { grid } = ctx
    army.front = [
      [grid.lonOf(first.cell), grid.latOf(first.cell)],
      [grid.lonOf(last.cell), grid.latOf(last.cell)],
    ]
    army.borderFront = true
    const enemies = new Set<number>()
    for (const f of contact) {
      for (const o of foreignNeighbors(grid, side, f.cell))
        if (ctx.matrix.hostile(side, o)) enemies.add(o)
    }
    const names = [...enemies].map((o) => countryName(ctx, ctx.sides[o] ?? ''))
    ctx.log(`${army.name} : sa frontière avec ${names.join(', ')} devient son front`, army.owner)
    changed.push(army)
  }
  return changed
}
