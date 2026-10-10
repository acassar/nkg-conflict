import { runtimeOf, sideIndex, type SimContext } from '../context'
import type { AlertKind, CountryId, LonLat, PlayerAlert, UnitState } from '../core/types'
import { distanceKm } from '../theater/grid'
import { isLineUnit } from '../units/catalog'
import { enemyShare } from './flanks'

/**
 * Alertes du joueur : situations qui demandent son attention, recalculées toutes les quelques heures.
 * - front percé : unités ennemies enfoncées dans un saillant de son territoire ;
 * - unités encerclées : ses unités coupées du ravitaillement (en poche ou trop avancées) ;
 * - poche en formation : ses unités encore ravitaillées mais presque entourées.
 * Les unités proches sont regroupées en une seule alerte, placée sur le groupe.
 */

/** Rayon et part de cellules du joueur autour d'une unité ennemie qui font une percée. */
const BREACH_KM = 25
export const BREACH_SHARE = 0.6
/** Part de cellules ennemies autour d'une unité ravitaillée qui annonce une poche. */
export const POCKET_SHARE = 0.7
/** Distance de regroupement des unités d'une même alerte. */
export const GROUP_KM = 40

/** Part des cellules praticables du camp `side` (ou de ses alliés) autour d'une unité. */
function friendlyShare(ctx: SimContext, side: number, e: UnitState): number {
  const { grid, matrix } = ctx
  let ours = 0
  let total = 0
  grid.cellsWithin(e.lon, e.lat, BREACH_KM, (i) => {
    if (!grid.passable(i)) return
    total++
    const o = grid.owner[i] ?? 0
    if (o !== 0 && matrix.friendly(side, o)) ours++
  })
  return total > 0 ? ours / total : 0
}

/** Regroupe les unités proches (lien simple à `GROUP_KM`). */
function groups(units: UnitState[]): UnitState[][] {
  const out: UnitState[][] = []
  const seen = new Set<number>()
  for (const start of units) {
    if (seen.has(start.id)) continue
    seen.add(start.id)
    const group = [start]
    for (let k = 0; k < group.length; k++) {
      const a = group[k] as UnitState
      for (const b of units) {
        if (seen.has(b.id) || distanceKm(a.lon, a.lat, b.lon, b.lat) > GROUP_KM) continue
        seen.add(b.id)
        group.push(b)
      }
    }
    out.push(group)
  }
  return out
}

/** Unité du groupe la plus proche de son centre (le centre peut tomber hors du groupe). */
function center(group: UnitState[]): LonLat {
  const lon = group.reduce((s, u) => s + u.lon, 0) / group.length
  const lat = group.reduce((s, u) => s + u.lat, 0) / group.length
  let best = group[0] as UnitState
  for (const u of group) {
    if (distanceKm(u.lon, u.lat, lon, lat) < distanceKm(best.lon, best.lat, lon, lat)) best = u
  }
  return [best.lon, best.lat]
}

/** Alertes d'un pays (le joueur), les plus graves en premier : encerclées, poches, percées. */
export function computeAlerts(
  ctx: SimContext,
  country: CountryId,
  placeOf: (at: LonLat) => string,
): PlayerAlert[] {
  const side = sideIndex(ctx, country)
  if (ctx.matrix.atWar[side] !== 1) return []
  const own: UnitState[] = []
  const intruders: UnitState[] = []
  for (const u of ctx.units.values()) {
    const rt = runtimeOf(ctx, u.id)
    if (u.owner === country) own.push(u)
    else if (
      !rt.routed &&
      isLineUnit(u.kind) &&
      ctx.matrix.hostile(side, sideIndex(ctx, u.owner))
    ) {
      intruders.push(u)
    }
  }

  const encircled = own.filter((u) => !runtimeOf(ctx, u.id).supplied)
  const threatened = own.filter((u) => {
    const rt = runtimeOf(ctx, u.id)
    if (!rt.supplied || !isLineUnit(u.kind)) return false
    return rt.flank?.level === 2 || enemyShare(ctx, u) >= POCKET_SHARE
  })
  const breaches = intruders.filter((e) => friendlyShare(ctx, side, e) >= BREACH_SHARE)

  const alerts: PlayerAlert[] = []
  const add = (kind: AlertKind, units: UnitState[]): void => {
    for (const group of groups(units)) {
      const ids = group.map((u) => u.id).sort((a, b) => a - b)
      const at = center(group)
      const alert = { kind, key: `${kind}:${ids[0]}`, at, unitIds: ids, place: placeOf(at) }
      alerts.push({ ...alert, text: alertText(alert) })
    }
  }
  add('encircled', encircled)
  add('pocket', threatened)
  add('breach', breaches)
  return alerts
}

/** Texte d'une alerte, pour le journal et l'interface. */
export function alertText(a: Omit<PlayerAlert, 'text'>): string {
  const n = a.unitIds.length
  const s = n > 1 ? 's' : ''
  switch (a.kind) {
    case 'encircled':
      return `${n} unité${s} coupée${s} du ravitaillement près de ${a.place}`
    case 'pocket':
      return `Poche en formation près de ${a.place} : ${n} unité${s} presque entourée${s}`
    case 'breach':
      return `Front percé près de ${a.place} : ${n} unité${s} ennemie${s}`
  }
}
