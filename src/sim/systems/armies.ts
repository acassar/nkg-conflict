import { runtimeOf, sideIndex, type SimContext } from '../context'
import type { ArmyState, LonLat, UnitState } from '../core/types'
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
    return o !== 0 && o !== side && grid.passable(n)
  }
  for (let i = 0; i < grid.size; i++) {
    if (owner[i] !== side) continue
    const x = i % W
    const y = (i - x) / W
    // Direction vers l'arrière : somme des vecteurs qui s'éloignent des voisins ennemis.
    let bx = 0
    let by = 0
    if (x > 0 && hostile(i - 1)) bx += 1
    if (x < W - 1 && hostile(i + 1)) bx -= 1
    if (y > 0 && hostile(i - W)) by += 1
    if (y < H - 1 && hostile(i + W)) by -= 1
    if ((bx !== 0 || by !== 0) && grid.passable(i)) {
      raw.push({ cell: i, back: [Math.sign(bx), Math.sign(by)] })
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
  if (!army.front && !army.wholeFront) return
  const cells = frontCells(ctx, side, army.wholeFront ? null : army.front)
  if (cells.length === 0) return
  const members = army.unitIds
    .map((id) => ctx.units.get(id))
    .filter((u): u is UnitState => !!u && u.order.kind !== 'attack' && !runtimeOf(ctx, u.id).routed)
  const line = members.filter((u) => isLineUnit(u.kind))
  const rear = members.filter((u) => !isLineUnit(u.kind))

  const place = (units: UnitState[], depth: number): void => {
    // On trie les unités le long du front pour éviter qu'elles se croisent.
    const ordered = units
      .map((u) => ({ u, t: nearestT(ctx, cells, u) }))
      .sort((p, q) => p.t - q.t)
      .map((p) => p.u)
    slots(cells, ordered.length).forEach((slot, k) => {
      const u = ordered[k]
      if (!u) return
      const target = behind(ctx, side, slot, depth)
      if (teleport) {
        ;[u.lon, u.lat] = target
        u.order = { kind: 'front', target }
        u.path = []
        return
      }
      const prev = u.order.kind === 'front' ? u.order.target : undefined
      const sameSlot =
        prev && distanceKm(prev[0], prev[1], target[0], target[1]) < SLOT_TOLERANCE_KM
      // Même poste : on ne recalcule rien, sauf si l'unité est arrêtée loin de ce poste.
      const stuck =
        u.path.length === 0 && distanceKm(u.lon, u.lat, target[0], target[1]) > SLOT_TOLERANCE_KM
      if (sameSlot && !stuck) return
      u.order = { kind: 'front', target }
      planPath(ctx, u, target)
    })
  }
  place(line, 2)
  place(rear, 7)
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
  const members = army.unitIds
    .map((id) => ctx.units.get(id))
    .filter((u): u is UnitState => !!u && !runtimeOf(ctx, u.id).routed)
  const line = members.filter((u) => isLineUnit(u.kind))
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
