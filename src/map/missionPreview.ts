import type { LonLat, UnitSnapshot } from '@/sim/core/types'
import { distanceKm } from '@/sim/theater/grid'
import { GROUP_KM, RING_MARGIN_KM, RING_MIN_KM } from '@/sim/systems/encircleRules'

/**
 * Aperçus de mission pendant la visée (fiche de l'armée) : axe de la percée vers le pointeur, anneau
 * d'encerclement autour du groupe ennemi survolé. Calculs légers côté interface, mêmes règles que la
 * simulation (missions.ts, encircle.ts).
 */

/** Axe d'une percée vers `aim` : du point du front de l'armée le plus proche (ou de `fallback`). */
export function breachAxis(
  frontLine: LonLat[][] | undefined,
  fallback: LonLat | null,
  aim: LonLat,
): [LonLat, LonLat] | null {
  let origin = fallback
  let best = Infinity
  for (const line of frontLine ?? []) {
    for (const p of line) {
      const d = distanceKm(p[0], p[1], aim[0], aim[1])
      if (d < best) {
        best = d
        origin = p
      }
    }
  }
  return origin
    ? [
        [origin[0], origin[1]],
        [aim[0], aim[1]],
      ]
    : null
}

/** Distance maximale entre le pointeur et l'unité ennemie visée pour afficher l'anneau. */
const AIM_PICK_KM = 30
const RING_POINTS = 48

/**
 * Anneau d'encerclement autour du groupe ennemi le plus proche du pointeur (cible et voisines du même
 * pays à moins de `GROUP_KM`), ou null si aucun ennemi n'est assez proche.
 */
export function encircleRing(
  units: UnitSnapshot[],
  isEnemy: (owner: string) => boolean,
  aim: LonLat,
): LonLat[] | null {
  let target: UnitSnapshot | null = null
  let best = AIM_PICK_KM
  for (const u of units) {
    if (!isEnemy(u.owner)) continue
    const d = distanceKm(u.lon, u.lat, aim[0], aim[1])
    if (d < best) {
      best = d
      target = u
    }
  }
  if (!target) return null
  const t = target
  const group = units.filter(
    (u) => u.owner === t.owner && distanceKm(u.lon, u.lat, t.lon, t.lat) <= GROUP_KM,
  )
  const cx = group.reduce((s, u) => s + u.lon, 0) / group.length
  const cy = group.reduce((s, u) => s + u.lat, 0) / group.length
  const spread = Math.max(...group.map((u) => distanceKm(u.lon, u.lat, cx, cy)))
  const radius = Math.max(RING_MIN_KM, spread + RING_MARGIN_KM)
  const cos = Math.max(0.2, Math.cos((cy * Math.PI) / 180))
  const ring: LonLat[] = []
  for (let k = 0; k <= RING_POINTS; k++) {
    const a = (k / RING_POINTS) * 2 * Math.PI
    ring.push([cx + (Math.cos(a) * radius) / (111.32 * cos), cy + (Math.sin(a) * radius) / 111.32])
  }
  return ring
}
