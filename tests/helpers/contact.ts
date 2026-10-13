import type { Simulation } from '@/sim/simulation'
import type { UnitState } from '@/sim/core/types'
import { distanceKm } from '@/sim/theater/grid'

/**
 * Brigade ukrainienne la plus proche d'une brigade russe, avancée à `km` de celle-ci : le front du
 * théâtre ne compte qu'une vingtaine de brigades par camp, rarement au contact dès le départ.
 */
export function bringToContact(sim: Simulation, km = 6): UnitState {
  const units = [...sim.ctx.units.values()]
  let best: { u: UnitState; e: UnitState; d: number } | null = null
  for (const u of units) {
    if (u.owner !== 'UKR') continue
    for (const e of units) {
      if (e.owner !== 'RUS') continue
      const d = distanceKm(u.lon, u.lat, e.lon, e.lat)
      if (!best || d < best.d) best = { u, e, d }
    }
  }
  if (!best) throw new Error('aucune paire de brigades')
  const { u, e, d } = best
  if (d > km) {
    const f = km / d
    u.lon = e.lon + (u.lon - e.lon) * f
    u.lat = e.lat + (u.lat - e.lat) * f
    u.path = []
  }
  return u
}
