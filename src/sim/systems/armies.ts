import { runtimeOf, sideIndex, type SimContext } from '../context'
import { isOffensiveOrder, type ArmyState, type LonLat, type UnitState } from '../core/types'
import { distanceKm } from '../theater/grid'
import { isLineUnit } from '../units/catalog'
import { planPath } from './movement'

/** Largeur du couloir autour d'une portion de front assignée. */
const FRONT_CORRIDOR_KM = 60
/** Un ordre de front n'est recalculé que si l'emplacement a bougé de plus que ça. */
const SLOT_TOLERANCE_KM = 8

interface FrontCell {
  cell: number
  /** Position le long de la portion de front, 0 à 1. */
  t: number
  /** Direction (en cellules) vers l'arrière, à l'opposé de l'ennemi. */
  back: [number, number]
}

/** Projection d'un point sur un segment : position t (0 à 1) et distance en km. */
function project(p: LonLat, a: LonLat, b: LonLat): { t: number; km: number } {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return { t, km: distanceKm(p[0], p[1], a[0] + dx * t, a[1] + dy * t) }
}

/** Cellules de front d'un camp, triées le long d'une portion (ou de tout le front si `segment` est null). */
export function frontCells(
  ctx: SimContext,
  side: number,
  segment: [LonLat, LonLat] | null,
): FrontCell[] {
  const { grid } = ctx
  const { width: W, height: H, owner } = grid
  const raw: Array<{ cell: number; back: [number, number] }> = []
  const hostile = (n: number): boolean => {
    const o = owner[n] ?? 0
    return o !== 0 && ctx.matrix.hostile(side, o) && grid.passable(n)
  }
  // Balayage limité aux zones de contact avec chaque ennemi (cellules vues une seule fois).
  if (ctx.matrix.atWar[side] !== 1) return []
  const seen = new Set<number>()
  for (const box of grid.contactBoxes(side, ctx.matrix.enemiesOf(side))) {
    for (let y = box.y0; y <= box.y1; y++) {
      for (let x = box.x0; x <= box.x1; x++) {
        const i = y * W + x
        if (owner[i] !== side || seen.has(i)) continue
        // Direction vers l'arrière : somme des vecteurs qui s'éloignent des voisins ennemis.
        let bx = 0
        let by = 0
        if (x > 0 && hostile(i - 1)) bx += 1
        if (x < W - 1 && hostile(i + 1)) bx -= 1
        if (y > 0 && hostile(i - W)) by += 1
        if (y < H - 1 && hostile(i + W)) by -= 1
        if ((bx !== 0 || by !== 0) && grid.passable(i)) {
          seen.add(i)
          raw.push({ cell: i, back: [Math.sign(bx), Math.sign(by)] })
        }
      }
    }
  }
  if (raw.length === 0) return []

  let a: LonLat
  let b: LonLat
  if (segment) {
    ;[a, b] = segment
  } else {
    // Tout le front : du point le plus au nord au point le plus au sud.
    const first = raw[0]?.cell ?? 0
    let north = first
    let south = first
    for (const r of raw) {
      if (grid.latOf(r.cell) > grid.latOf(north)) north = r.cell
      if (grid.latOf(r.cell) < grid.latOf(south)) south = r.cell
    }
    a = [grid.lonOf(north), grid.latOf(north)]
    b = [grid.lonOf(south), grid.latOf(south)]
  }

  const out: FrontCell[] = []
  for (const r of raw) {
    const p: LonLat = [grid.lonOf(r.cell), grid.latOf(r.cell)]
    const { t, km } = project(p, a, b)
    if (segment && km > FRONT_CORRIDOR_KM) continue
    out.push({ cell: r.cell, t, back: r.back })
  }
  out.sort((x, y) => x.t - y.t)
  return out
}

/** Recule de `depth` cellules depuis une cellule de front, tant qu'on reste chez soi. */
function behind(ctx: SimContext, side: number, f: FrontCell, depth: number): LonLat {
  const { grid } = ctx
  let x = f.cell % grid.width
  let y = Math.floor(f.cell / grid.width)
  for (let k = 0; k < depth; k++) {
    const nx = x + f.back[0]
    const ny = y + f.back[1]
    if (!grid.inBounds(nx, ny)) break
    const n = grid.index(nx, ny)
    if (grid.owner[n] !== side || !grid.passable(n)) break
    x = nx
    y = ny
  }
  const i = grid.index(x, y)
  return [grid.lonOf(i), grid.latOf(i)]
}

/** Emplacements répartis régulièrement le long des cellules de front. */
function slots(cells: FrontCell[], count: number): FrontCell[] {
  if (count <= 0 || cells.length === 0) return []
  const out: FrontCell[] = []
  for (let k = 0; k < count; k++) {
    const q = Math.min(cells.length - 1, Math.floor(((k + 0.5) / count) * cells.length))
    const c = cells[q]
    if (c) out.push(c)
  }
  return out
}

/**
 * Répartit les unités d'une armée le long de sa portion de front : unités de ligne juste derrière
 * le contact, artillerie, logistique et QG plus en arrière. Les unités en attaque ou en déroute sont laissées.
 * `teleport` sert au déploiement initial.
 */
export function assignFront(ctx: SimContext, army: ArmyState, teleport = false): void {
  const side = sideIndex(ctx, army.owner)
  if (!army.front && !army.wholeFront) {
    army.frontLine = undefined
    return
  }
  const cells = frontCells(ctx, side, army.wholeFront ? null : army.front)
  army.frontLine = traceFront(ctx, cells)
  if (cells.length === 0) return
  const members = army.unitIds
    .map((id) => ctx.units.get(id))
    .filter(
      (u): u is UnitState => !!u && !isOffensiveOrder(u.order.kind) && !runtimeOf(ctx, u.id).routed,
    )
  const line = members.filter((u) => isLineUnit(u.kind))
  const rear = members.filter((u) => !isLineUnit(u.kind))

  const place = (units: UnitState[], depth: number): void => {
    const posts = slots(cells, units.length).map((slot) => behind(ctx, side, slot, depth))
    // Chaque poste revient à l'unité la plus proche encore libre (paires triées par distance) :
    // une unité n'est jamais envoyée à l'autre bout du front quand un poste l'attend à côté.
    const pairs: Array<{ u: number; p: number; d: number }> = []
    units.forEach((u, ui) => {
      posts.forEach((p, pi) =>
        pairs.push({ u: ui, p: pi, d: distanceKm(u.lon, u.lat, p[0], p[1]) }),
      )
    })
    pairs.sort((x, y) => x.d - y.d)
    const unitDone = new Set<number>()
    const postDone = new Set<number>()
    for (const { u: ui, p: pi } of pairs) {
      if (unitDone.has(ui) || postDone.has(pi)) continue
      unitDone.add(ui)
      postDone.add(pi)
      const u = units[ui]
      const target = posts[pi]
      if (!u || !target) continue
      if (teleport) {
        ;[u.lon, u.lat] = target
        u.order = { kind: 'front', target }
        u.path = []
        continue
      }
      const prev = u.order.kind === 'front' ? u.order.target : undefined
      const sameSlot =
        prev && distanceKm(prev[0], prev[1], target[0], target[1]) < SLOT_TOLERANCE_KM
      // Même poste : on ne recalcule rien, sauf si l'unité est arrêtée loin de ce poste.
      const stuck =
        u.path.length === 0 && distanceKm(u.lon, u.lat, target[0], target[1]) > SLOT_TOLERANCE_KM
      if (sameSlot && !stuck) continue
      u.order = { kind: 'front', target }
      planPath(ctx, u, target)
    }
  }
  place(line, 2)
  place(rear, 7)
}

/** Deux tronçons du front dont les extrémités sont plus proches que ça sont raccordés (fleuve, lac). */
const TRACE_JOIN_KM = 25
/** Tronçon plus court que ça (poche isolée à l'arrière) : non tracé, sauf s'il est le seul. */
const TRACE_MIN_CELLS = 6
/** Nombre de points visé pour l'ensemble du tracé. */
const TRACE_POINTS = 160

/** Plus court chemin (8-voisinage) entre `from` et la cellule du groupe la plus éloignée. */
function farthestPath(grid: SimContext['grid'], group: Set<number>, from: number): number[] {
  const W = grid.width
  const parent = new Map<number, number>([[from, -1]])
  const queue = [from]
  let last = from
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q] as number
    last = i
    const x = i % W
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        if (x + dx < 0 || x + dx >= W) continue
        const n = i + dy * W + dx
        if (!group.has(n) || parent.has(n)) continue
        parent.set(n, i)
        queue.push(n)
      }
    }
  }
  const path: number[] = []
  for (let i = last; i !== -1; i = parent.get(i) ?? -1) path.push(i)
  return path
}

/**
 * Tracé du front (pour l'affichage) : les cellules de front sont regroupées par contiguïté ; chaque
 * groupe donne la chaîne la plus longue qui le traverse (sans les éperons des zones épaisses), placée
 * sur la ligne de contact (demi-cellule vers l'ennemi) puis lissée. Les tronçons proches sont raccordés,
 * les petites poches isolées ignorées.
 */
export function traceFront(ctx: SimContext, cells: FrontCell[]): LonLat[][] {
  if (cells.length === 0) return []
  const { grid } = ctx
  const W = grid.width
  const byCell = new Map(cells.map((c) => [c.cell, c]))
  const left = new Set(byCell.keys())

  // Chaînes : une par groupe de cellules contiguës.
  const chains: number[][] = []
  while (left.size > 0) {
    const seed = left.values().next().value as number
    const group = new Set<number>([seed])
    const queue = [seed]
    left.delete(seed)
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q] as number
      const x = i % W
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (x + dx < 0 || x + dx >= W) continue
          const n = i + dy * W + dx
          if (!left.has(n)) continue
          left.delete(n)
          group.add(n)
          queue.push(n)
        }
      }
    }
    const end = farthestPath(grid, group, seed)[0] as number
    chains.push(farthestPath(grid, group, end))
  }

  // Points sur la ligne de contact, orientés comme la portion (t croissant).
  const point = (i: number): LonLat => {
    const back = byCell.get(i)?.back ?? [0, 0]
    return [grid.lonOf(i) - (back[0] * grid.cell) / 2, grid.latOf(i) - (back[1] * grid.cell) / 2]
  }
  let lines = chains.map((chain) => {
    const first = byCell.get(chain[0] as number)?.t ?? 0
    const last = byCell.get(chain[chain.length - 1] as number)?.t ?? 0
    return (first <= last ? chain : [...chain].reverse()).map(point)
  })

  // Raccord des tronçons dont les extrémités se touchent presque, le plus proche d'abord.
  const ends = (l: LonLat[]): [LonLat, LonLat] => [l[0] as LonLat, l[l.length - 1] as LonLat]
  for (;;) {
    let best: { a: number; b: number; flipA: boolean; flipB: boolean; d: number } | null = null
    for (let a = 0; a < lines.length; a++) {
      for (let b = a + 1; b < lines.length; b++) {
        const [a0, a1] = ends(lines[a] as LonLat[])
        const [b0, b1] = ends(lines[b] as LonLat[])
        const options: Array<[boolean, boolean, LonLat, LonLat]> = [
          [false, false, a1, b0],
          [false, true, a1, b1],
          [true, false, a0, b0],
          [true, true, a0, b1],
        ]
        for (const [flipA, flipB, p, q] of options) {
          const d = distanceKm(p[0], p[1], q[0], q[1])
          if (d < TRACE_JOIN_KM && (!best || d < best.d)) best = { a, b, flipA, flipB, d }
        }
      }
    }
    if (!best) break
    const la = lines[best.a] as LonLat[]
    const lb = lines[best.b] as LonLat[]
    const joined = [
      ...(best.flipA ? [...la].reverse() : la),
      ...(best.flipB ? [...lb].reverse() : lb),
    ]
    lines = lines.filter((_, k) => k !== best.a && k !== best.b)
    lines.push(joined)
  }

  // Poches isolées : ignorées face aux vrais secteurs.
  const longest = Math.max(...lines.map((l) => l.length))
  lines = lines.filter((l) => l.length > 1 && (l.length >= TRACE_MIN_CELLS || l.length === longest))

  // Lissage (moyenne glissante sur 5 points, extrémités conservées) puis échantillonnage.
  const total = lines.reduce((s, l) => s + l.length, 0)
  const step = Math.max(1, Math.round(total / TRACE_POINTS))
  return lines
    .map((l) => {
      const smooth = l.map((p, k): LonLat => {
        const r = Math.min(2, k, l.length - 1 - k)
        let lon = 0
        let lat = 0
        for (let j = k - r; j <= k + r; j++) {
          lon += (l[j] as LonLat)[0]
          lat += (l[j] as LonLat)[1]
        }
        return [lon / (2 * r + 1), lat / (2 * r + 1)]
      })
      const out = smooth.filter((_, k) => k % step === 0)
      const tail = smooth[smooth.length - 1] as LonLat
      if (out[out.length - 1] !== tail) out.push(tail)
      return out
    })
    .sort((x, y) => y.length - x.length)
}

/**
 * Accroche les extrémités d'une portion tracée par le joueur aux cellules de front les plus proches,
 * pour que la portion suive le front réel.
 */
export function snapToFront(
  ctx: SimContext,
  side: number,
  segment: [LonLat, LonLat],
): [LonLat, LonLat] {
  const cells = frontCells(ctx, side, null)
  const snap = (p: LonLat): LonLat => {
    let best: LonLat = p
    let bestD = 150
    for (const c of cells) {
      const q: LonLat = [ctx.grid.lonOf(c.cell), ctx.grid.latOf(c.cell)]
      const d = distanceKm(p[0], p[1], q[0], q[1])
      if (d < bestD) {
        bestD = d
        best = q
      }
    }
    return best
  }
  return [snap(segment[0]), snap(segment[1])]
}

function nearestT(ctx: SimContext, cells: FrontCell[], u: UnitState): number {
  let best = 0
  let bestD = Infinity
  const step = Math.max(1, Math.floor(cells.length / 200))
  for (let k = 0; k < cells.length; k += step) {
    const c = cells[k]
    if (!c) continue
    const d = distanceKm(u.lon, u.lat, ctx.grid.lonOf(c.cell), ctx.grid.latOf(c.cell))
    if (d < bestD) {
      bestD = d
      best = c.t
    }
  }
  return best
}

/**
 * Lance l'offensive planifiée d'une armée : les unités de ligne attaquent vers la pointe de la flèche,
 * réparties sur sa largeur ; l'artillerie avance jusqu'au tiers de la flèche pour rester à portée.
 */
export function launchOffensive(ctx: SimContext, army: ArmyState): void {
  const off = army.offensive
  if (!off || off.launched) return
  const chosen = off.unitIds ? new Set(off.unitIds) : null
  const members = army.unitIds
    .filter((id) => !chosen || chosen.has(id))
    .map((id) => ctx.units.get(id))
    .filter((u): u is UnitState => !!u && !runtimeOf(ctx, u.id).routed)
  // Unités choisies : toutes participent (y compris hors ligne) ; sinon les unités de ligne.
  const line = chosen
    ? members.filter((u) => u.kind !== 'art')
    : members.filter((u) => isLineUnit(u.kind))
  const [fx, fy] = off.from
  const [tx, ty] = off.to
  // Perpendiculaire à la flèche, normalisée en degrés approximatifs.
  const len = Math.hypot(tx - fx, ty - fy) || 1
  const px = -(ty - fy) / len
  const py = (tx - fx) / len
  const spread = 0.12
  line.forEach((u, k) => {
    const offset = (k - (line.length - 1) / 2) * spread
    const target: LonLat = [tx + px * offset, ty + py * offset]
    u.order = { kind: 'attack', target }
    planPath(ctx, u, target)
  })
  for (const u of members.filter((m) => m.kind === 'art')) {
    const target: LonLat = [fx + (tx - fx) * 0.33, fy + (ty - fy) * 0.33]
    u.order = { kind: 'move', target }
    planPath(ctx, u, target)
  }
  off.launched = true
  ctx.log(`${army.name} lance son offensive`, army.owner)
}

/** Une fois que plus aucune unité n'attaque, l'offensive est terminée et l'armée revient à son front. */
export function updateArmies(ctx: SimContext): void {
  for (const army of ctx.armies.values()) {
    army.unitIds = army.unitIds.filter((id) => ctx.units.has(id))
    if (army.offensive?.launched) {
      const attacking = army.unitIds.some((id) => ctx.units.get(id)?.order.kind === 'attack')
      if (!attacking) {
        army.offensive = null
        ctx.log(`${army.name} termine son offensive`, army.owner)
      } else continue
    }
    if (army.front || army.wholeFront) assignFront(ctx, army)
  }
}
