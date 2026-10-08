import type { CountryId, UnitSnapshot } from '@/sim/core/types'

/** Pions d'un même camp trop proches à l'écran, affichés comme une seule pile. */
export interface UnitStack {
  stack: true
  key: string
  owner: CountryId
  lon: number
  lat: number
  units: UnitSnapshot[]
}

export type MapUnit = UnitSnapshot | UnitStack

export function isStack(item: MapUnit): item is UnitStack {
  return 'stack' in item
}

/** Position en pixels Web Mercator au niveau de zoom donné (tuiles de 512 px, comme MapLibre). */
function toPixels(lon: number, lat: number, zoom: number): [number, number] {
  const scale = 512 * 2 ** zoom
  const sin = Math.sin((lat * Math.PI) / 180)
  return [
    ((lon + 180) / 360) * scale,
    (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  ]
}

/**
 * Regroupe les pions d'un même camp distants de moins de `radiusPx` à l'écran.
 * Regroupement glouton, suffisant pour quelques centaines d'unités.
 */
export function stackUnits(units: UnitSnapshot[], zoom: number, radiusPx = 38): MapUnit[] {
  const pos = units.map((u) => toPixels(u.lon, u.lat, zoom))
  const used = new Uint8Array(units.length)
  const out: MapUnit[] = []
  const r2 = radiusPx * radiusPx

  for (let i = 0; i < units.length; i++) {
    if (used[i]) continue
    const u = units[i]
    const p = pos[i]
    if (!u || !p) continue
    used[i] = 1
    const group = [u]
    for (let j = i + 1; j < units.length; j++) {
      const v = units[j]
      const q = pos[j]
      if (used[j] || !v || !q || v.owner !== u.owner) continue
      const dx = q[0] - p[0]
      const dy = q[1] - p[1]
      if (dx * dx + dy * dy <= r2) {
        used[j] = 1
        group.push(v)
      }
    }
    if (group.length === 1) {
      out.push(u)
    } else {
      out.push({
        stack: true,
        key: group
          .map((g) => g.id)
          .sort((a, b) => a - b)
          .join('-'),
        owner: u.owner,
        lon: group.reduce((s, g) => s + g.lon, 0) / group.length,
        lat: group.reduce((s, g) => s + g.lat, 0) / group.length,
        units: group,
      })
    }
  }
  return out
}
