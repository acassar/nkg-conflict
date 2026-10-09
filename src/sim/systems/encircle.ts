import { runtimeOf, sideIndex, type SimContext } from '../context'
import type { ArmyState, LonLat, UnitState } from '../core/types'
import { distanceKm } from '../theater/grid'
import { isLineUnit } from '../units/catalog'
import { planPath } from './movement'
import { assignFront } from './armies'

const KM_PER_DEG = 111.32
/** Ennemis à moins de cette distance de la cible : ils font partie du groupe à encercler. */
const GROUP_KM = 25
/** Marge au-delà du groupe ennemi pour l'anneau d'encerclement. */
const RING_MARGIN_KM = 15
const RING_MIN_KM = 20
/** Les bras de la tenaille couvrent ±150° autour de l'arrière de la cible : le front reste tenu. */
const ARC_DEG = 150
/** Points d'attente : sur les flancs (à ±100° de l'arrière au moins), un peu plus loin que l'anneau. */
const STAGING_DEG = 100
const STAGING_EXTRA_KM = 20
/** Une unité est prête à moins de cette distance de son point d'attente. */
const READY_KM = 8
/** Délai maximal d'attente : passé ce délai, l'anneau se ferme avec les unités prêtes. */
const STAGING_MAX_TICKS = 72
/** Durée du siège après la fermeture de l'anneau, avant le retour à l'armée. */
const SIEGE_TICKS = 7 * 24

/** Unités ennemies du groupe visé (la cible et ses voisines du même camp). */
export function targetGroup(ctx: SimContext, target: UnitState): UnitState[] {
  const side = sideIndex(ctx, target.owner)
  return [...ctx.units.values()].filter(
    (u) =>
      sideIndex(ctx, u.owner) === side &&
      distanceKm(u.lon, u.lat, target.lon, target.lat) <= GROUP_KM,
  )
}

interface Geometry {
  cx: number
  cy: number
  cos: number
  radiusKm: number
  /** Direction de nos unités vers la cible (radians). */
  base: number
}

function geometry(group: UnitState[], units: UnitState[]): Geometry {
  const cx = group.reduce((s, u) => s + u.lon, 0) / group.length
  const cy = group.reduce((s, u) => s + u.lat, 0) / group.length
  const spread = Math.max(...group.map((u) => distanceKm(u.lon, u.lat, cx, cy)))
  const cos = Math.max(0.2, Math.cos((cy * Math.PI) / 180))
  const ox = units.reduce((s, u) => s + u.lon, 0) / units.length
  const oy = units.reduce((s, u) => s + u.lat, 0) / units.length
  const base = Math.atan2(cy - oy, (cx - ox) * cos)
  return { cx, cy, cos, radiusKm: Math.max(RING_MIN_KM, spread + RING_MARGIN_KM), base }
}

const pointAt = (g: Geometry, angle: number, km: number): LonLat => [
  g.cx + (Math.cos(angle) * km) / (KM_PER_DEG * g.cos),
  g.cy + (Math.sin(angle) * km) / KM_PER_DEG,
]

/** Unités triées par angle autour de la cible, pour que les bras ne se croisent pas. */
function byAngle(g: Geometry, units: UnitState[]): UnitState[] {
  const angleOf = (u: UnitState): number => {
    const a = Math.atan2(u.lat - g.cy, (u.lon - g.cx) * g.cos) - g.base
    return Math.atan2(Math.sin(a), Math.cos(a))
  }
  return [...units].sort((a, b) => angleOf(a) - angleOf(b))
}

/** Angle de l'unité de rang k sur l'arc (0 = derrière la cible, vu de nos lignes). */
const arcAngle = (g: Geometry, k: number, n: number): number => {
  const t = n === 1 ? 0.5 : k / (n - 1)
  return g.base + ((-ARC_DEG + 2 * ARC_DEG * t) * Math.PI) / 180
}

/**
 * Phase 1 : chaque unité gagne son point d'attente, sur le flanc de la cible du côté de son bras.
 * Renvoie les points d'attente, par unité.
 */
export function stageEncirclement(
  ctx: SimContext,
  units: UnitState[],
  target: UnitState,
): Record<number, LonLat> {
  const g = geometry(targetGroup(ctx, target), units)
  const ordered = byAngle(g, units)
  const staging: Record<number, LonLat> = {}
  ordered.forEach((u, k) => {
    // Angle mesuré depuis l'arrière de la cible : les unités destinées à l'arrière attendent sur
    // le flanc de leur bras (à ±100°), celles des flancs à leur propre angle.
    const rel = arcAngle(g, k, ordered.length) - g.base
    const side = rel >= 0 ? 1 : -1
    const flank = g.base + side * Math.max(Math.abs(rel), (STAGING_DEG * Math.PI) / 180)
    const point = pointAt(g, flank, g.radiusKm + STAGING_EXTRA_KM)
    staging[u.id] = point
    u.order = { kind: 'move', target: point }
    planPath(ctx, u, point)
  })
  return staging
}

/** Phase 2 : toutes les unités ferment l'anneau ensemble, autour de la position actuelle du groupe ennemi. */
export function closeRing(ctx: SimContext, units: UnitState[], group: UnitState[]): void {
  const g = geometry(group, units)
  const ordered = byAngle(g, units)
  ordered.forEach((u, k) => {
    const point = pointAt(g, arcAngle(g, k, ordered.length), g.radiusKm)
    u.order = { kind: 'attack', target: point }
    planPath(ctx, u, point)
  })
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

/**
 * Fin d'un encerclement : les unités rejoignent leur armée d'origine (ou, à défaut, l'armée du joueur
 * qui tient tout le front) et reprennent leur place sur le front ; le groupe disparaît.
 */
export function endEncirclement(ctx: SimContext, group: ArmyState, reason: string): void {
  const parent =
    (group.encirclement?.parentArmyId !== null && group.encirclement?.parentArmyId !== undefined
      ? ctx.armies.get(group.encirclement.parentArmyId)
      : undefined) ??
    [...ctx.armies.values()].find((a) => a.owner === group.owner && a.wholeFront && a !== group)
  const name = group.encirclement?.targetName ?? ''
  for (const id of group.unitIds) {
    const u = ctx.units.get(id)
    if (!u) continue
    u.order = { kind: 'hold' }
    u.path = []
    u.armyId = parent?.id ?? null
    if (parent) parent.unitIds.push(id)
  }
  ctx.armies.delete(group.id)
  ctx.log(
    `Encerclement de ${name} terminé (${reason})${parent ? ` : retour à ${parent.name}` : ''}`,
    group.owner,
  )
  if (parent && (parent.front || parent.wholeFront)) assignFront(ctx, parent)
}

/** Suivi des encerclements en cours (toutes les quelques heures). */
export function updateEncirclements(ctx: SimContext): void {
  for (const group of [...ctx.armies.values()]) {
    const enc = group.encirclement
    if (!enc) continue
    const units = group.unitIds.map((id) => ctx.units.get(id)).filter((u): u is UnitState => !!u)
    if (units.length === 0) {
      ctx.armies.delete(group.id)
      continue
    }
    const side = sideIndex(ctx, group.owner)
    const enemies = enc.targetIds
      .map((id) => ctx.units.get(id))
      .filter((u): u is UnitState => !!u && ctx.matrix.hostile(side, sideIndex(ctx, u.owner)))
    enc.targetIds = enemies.map((u) => u.id)
    if (enemies.length === 0) {
      endEncirclement(ctx, group, 'groupe ennemi détruit')
      continue
    }
    if (enc.phase === 'staging') {
      const ready = units.every((u) => {
        const p = enc.staging[u.id]
        if (!p || runtimeOf(ctx, u.id).routed) return true
        return distanceKm(u.lon, u.lat, p[0], p[1]) <= READY_KM || u.path.length === 0
      })
      if (ready || ctx.tick - enc.startTick >= STAGING_MAX_TICKS) {
        enc.phase = 'closing'
        enc.closeTick = ctx.tick
        closeRing(ctx, units, enemies)
        ctx.log(`Encerclement de ${enc.targetName} : l'anneau se referme`, group.owner)
      }
      continue
    }
    if (enc.closeTick !== null && ctx.tick - enc.closeTick >= SIEGE_TICKS) {
      endEncirclement(ctx, group, '7 jours de siège')
    }
  }
}
