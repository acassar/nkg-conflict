import { runtimeOf, sideIndex, type SimContext } from '../context'
import {
  isOffensiveOrder,
  type ArmyState,
  type DefendPointKinds,
  type DefendPointsMission,
  type LonLat,
  type UnitState,
} from '../core/types'
import { distanceKm } from '../theater/grid'
import { isLineUnit } from '../units/catalog'
import { planPath } from './movement'
import { portNames } from './naval'
import { AIRFIELD_POP } from './transport'
import { LARGE_GRID_CELLS } from './armies'
import { detachedDivision } from './divisionOrders'

/**
 * Mission « Défendre des points » (phase G2) : les brigades de ligne d'une armée se répartissent entre
 * les villes, ports, bases et aérodromes de son pays (ou d'une zone), selon l'importance de chaque point.
 */

/** Poids d'une capitale : au-dessus de toute autre ville. */
export const CAPITAL_WEIGHT = 5
/** Poids d'une ville : 1, plus 1 par million d'habitants (3 au plus). */
export const CITY_POP_WEIGHT_MAX = 3
/** Poids ajouté par un port, par type de base (caserne, dépôt, fortification) et par un aérodrome. */
export const PORT_WEIGHT = 1
export const BASE_WEIGHT = 0.5
export const AIRFIELD_WEIGHT = 0.5
/** Rayon de l'anneau sur lequel les brigades d'un même point se placent. */
export const POINT_RING_KM = 4

export interface DefendPoint {
  name: string
  at: LonLat
  weight: number
}

/** Points à défendre d'un pays, les plus importants d'abord. */
export function defendPoints(
  ctx: SimContext,
  army: ArmyState,
  zone: DefendPointsMission['zone'],
  kinds: DefendPointKinds,
): DefendPoint[] {
  const side = sideIndex(ctx, army.owner)
  const ports = kinds.ports ? portNames(ctx) : null
  const out: DefendPoint[] = []
  for (const c of ctx.cityStates.values()) {
    if (c.owner !== side) continue
    const { def } = c
    if (zone && distanceKm(def.lon, def.lat, zone.center[0], zone.center[1]) > zone.km) continue
    let weight = 0
    if (kinds.cities) {
      weight +=
        def.capital && def.country === army.owner
          ? CAPITAL_WEIGHT
          : 1 + Math.min(CITY_POP_WEIGHT_MAX, def.pop / 1_000_000)
    }
    if (ports?.has(def.name)) weight += PORT_WEIGHT
    if (kinds.bases) {
      for (const b of ['barracks', 'depot', 'fort'] as const)
        if ((c.buildings[b] ?? 0) > 0) weight += BASE_WEIGHT
    }
    if (kinds.airfields && def.pop >= AIRFIELD_POP) weight += AIRFIELD_WEIGHT
    if (weight > 0) out.push({ name: def.name, at: [def.lon, def.lat], weight })
  }
  return out.sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name))
}

/**
 * Brigades par point : chacun des `count` points les plus importants en reçoit une, le reste est réparti
 * au prorata du poids (plus forts restes).
 */
export function quotas(points: DefendPoint[], units: number): number[] {
  const k = Math.min(points.length, units)
  if (k === 0) return []
  const top = points.slice(0, k)
  const total = top.reduce((s, p) => s + p.weight, 0)
  const extra = units - k
  const raw = top.map((p) => (extra * p.weight) / total)
  const q = raw.map((r) => 1 + Math.floor(r))
  let left = units - q.reduce((s, v) => s + v, 0)
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac)
  for (const { i } of order) {
    if (left <= 0) break
    q[i] = (q[i] ?? 0) + 1
    left--
  }
  return q
}

/** Envoie une unité à son poste, sauf si elle y va déjà. */
function sendTo(ctx: SimContext, u: UnitState, target: LonLat, teleport: boolean): void {
  if (teleport) {
    ;[u.lon, u.lat] = target
    u.order = { kind: 'front', target }
    u.path = []
    return
  }
  const prev = u.order.kind === 'front' ? u.order.target : undefined
  if (prev && distanceKm(prev[0], prev[1], target[0], target[1]) < 1) return
  u.order = { kind: 'front', target }
  if (ctx.grid.size > LARGE_GRID_CELLS) {
    u.path = []
    runtimeOf(ctx, u.id).pathPending = true
  } else planPath(ctx, u, target)
}

/**
 * Répartit l'armée sur ses points : chaque brigade de ligne va au point le plus proche qui a encore une
 * place (paires triées par distance), sur un anneau de POINT_RING_KM autour de la ville ; l'appui
 * (artillerie, logistique, QG) rejoint le point le plus proche. Met à jour les points affichés.
 * `division` : ordre d'une division (`army` ne contient alors que ses unités) ; sinon, les divisions
 * sous ordre de défense propre sont laissées (divisionOrders.ts).
 */
export function assignDefendPoints(
  ctx: SimContext,
  army: ArmyState,
  m: DefendPointsMission,
  teleport = false,
  division?: number,
): void {
  const members = army.unitIds
    .map((id) => ctx.units.get(id))
    .filter(
      (u): u is UnitState =>
        !!u &&
        !u.direct &&
        !isOffensiveOrder(u.order.kind) &&
        !runtimeOf(ctx, u.id).routed &&
        (division !== undefined || !detachedDivision(ctx, u)),
    )
  const line = members.filter((u) => isLineUnit(u.kind))
  const points = defendPoints(ctx, army, m.zone, m.kinds)
  const q = quotas(points, line.length)
  const top = points.slice(0, q.length)
  m.points = top.map((p, i) => ({ name: p.name, at: p.at, weight: p.weight, units: q[i] ?? 0 }))
  if (top.length === 0) return
  const P = top.length
  const pairs: Array<{ u: number; p: number; d: number }> = []
  line.forEach((u, ui) =>
    top.forEach((p, pi) =>
      pairs.push({ u: ui, p: pi, d: distanceKm(u.lon, u.lat, p.at[0], p.at[1]) }),
    ),
  )
  pairs.sort((a, b) => a.d - b.d || a.u - b.u || a.p - b.p)
  const left = q.slice()
  const pointOf = new Int32Array(line.length).fill(-1)
  for (const { u, p } of pairs) {
    if (pointOf[u] !== -1 || (left[p] ?? 0) <= 0) continue
    pointOf[u] = p
    left[p] = (left[p] ?? 0) - 1
  }
  const seat = new Int32Array(P)
  line.forEach((u, ui) => {
    const pi = pointOf[ui] ?? -1
    const p = top[pi]
    if (!p) return
    const n = q[pi] ?? 1
    const k = seat[pi] ?? 0
    seat[pi] = k + 1
    const angle = (2 * Math.PI * k) / n
    const ring = n > 1 ? POINT_RING_KM : 0
    const target: LonLat = [
      p.at[0] + (ring * Math.cos(angle)) / (111 * Math.cos((p.at[1] * Math.PI) / 180)),
      p.at[1] + (ring * Math.sin(angle)) / 111,
    ]
    sendTo(ctx, u, target, teleport)
  })
  for (const u of members) {
    if (isLineUnit(u.kind)) continue
    let best = top[0] as DefendPoint
    for (const p of top) {
      if (
        distanceKm(u.lon, u.lat, p.at[0], p.at[1]) <
        distanceKm(u.lon, u.lat, best.at[0], best.at[1])
      )
        best = p
    }
    sendTo(ctx, u, best.at, teleport)
  }
}
