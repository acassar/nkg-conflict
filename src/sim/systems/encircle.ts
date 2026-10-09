import { runtimeOf, sideIndex, type SimContext } from '../context'
import type { LonLat, UnitState } from '../core/types'
import { distanceKm } from '../theater/grid'
import { isLineUnit } from '../units/catalog'
import { planPath } from './movement'

const KM_PER_DEG = 111.32
/** Ennemis à moins de cette distance de la cible : ils font partie du groupe à encercler. */
const GROUP_KM = 25
/** Marge au-delà du groupe ennemi pour l'anneau d'encerclement. */
const RING_MARGIN_KM = 15
const RING_MIN_KM = 20
/** Les bras de la tenaille couvrent ±150° autour de l'arrière de la cible : le front reste tenu. */
const ARC_DEG = 150

/** Unités ennemies du groupe visé (la cible et ses voisines du même camp). */
export function targetGroup(ctx: SimContext, target: UnitState): UnitState[] {
  const side = sideIndex(ctx, target.owner)
  return [...ctx.units.values()].filter(
    (u) =>
      sideIndex(ctx, u.owner) === side &&
      distanceKm(u.lon, u.lat, target.lon, target.lat) <= GROUP_KM,
  )
}

/**
 * Encerclement : les unités se répartissent sur un arc qui passe derrière le groupe ennemi
 * (côté opposé à leurs propres lignes), pour lui couper la retraite. Chacune attaque vers son point
 * de l'anneau puis le tient.
 */
export function encircle(ctx: SimContext, units: UnitState[], target: UnitState): LonLat[] {
  const group = targetGroup(ctx, target)
  const cx = group.reduce((s, u) => s + u.lon, 0) / group.length
  const cy = group.reduce((s, u) => s + u.lat, 0) / group.length
  const spread = Math.max(...group.map((u) => distanceKm(u.lon, u.lat, cx, cy)))
  const radiusKm = Math.max(RING_MIN_KM, spread + RING_MARGIN_KM)
  const cos = Math.max(0.2, Math.cos((cy * Math.PI) / 180))
  // Direction de nos unités vers la cible (en km), prolongée derrière elle.
  const ox = units.reduce((s, u) => s + u.lon, 0) / units.length
  const oy = units.reduce((s, u) => s + u.lat, 0) / units.length
  let dx = (cx - ox) * cos
  let dy = cy - oy
  const len = Math.hypot(dx, dy) || 1
  dx /= len
  dy /= len
  const base = Math.atan2(dy, dx)
  // Unités triées par angle autour de la cible, pour que les bras ne se croisent pas.
  const angleOf = (u: UnitState): number => {
    const a = Math.atan2(u.lat - cy, (u.lon - cx) * cos) - base
    return Math.atan2(Math.sin(a), Math.cos(a))
  }
  const ordered = [...units].sort((a, b) => angleOf(a) - angleOf(b))
  const points: LonLat[] = []
  ordered.forEach((u, k) => {
    const t = ordered.length === 1 ? 0 : k / (ordered.length - 1)
    const a = base + ((-ARC_DEG + 2 * ARC_DEG * t) * Math.PI) / 180
    const point: LonLat = [
      cx + (Math.cos(a) * radiusKm) / (KM_PER_DEG * cos),
      cy + (Math.sin(a) * radiusKm) / KM_PER_DEG,
    ]
    u.order = { kind: 'attack', target: point }
    planPath(ctx, u, point)
    points.push(point)
  })
  return points
}

/** Détachement automatique : le tiers des unités de ligne d'une armée, les plus proches de la cible. */
export function autoDetachment(
  ctx: SimContext,
  armyUnits: UnitState[],
  target: UnitState,
): UnitState[] {
  const line = armyUnits
    .filter((u) => isLineUnit(u.kind) && !runtimeOf(ctx, u.id).routed)
    .sort(
      (a, b) =>
        distanceKm(a.lon, a.lat, target.lon, target.lat) -
        distanceKm(b.lon, b.lat, target.lon, target.lat),
    )
  const n = Math.min(12, Math.max(2, Math.ceil(line.length / 3)))
  return line.slice(0, Math.min(n, Math.max(0, line.length - 1)))
}
