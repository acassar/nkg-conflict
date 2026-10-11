import type { LonLat, TransportMode, TransportSnapshot } from '@/sim/core/types'

/** Couleur de chaque mode de transport (trajets sur la carte et liste « En route »). */
export const TRANSPORT_COLORS: Record<TransportMode, [number, number, number]> = {
  rail: [245, 158, 11],
  sea: [56, 189, 248],
  air: [196, 181, 253],
}

export const transportCss = (mode: TransportMode): string =>
  `rgb(${TRANSPORT_COLORS[mode].join(',')})`

/**
 * Trajet d'un ou plusieurs transports partis ensemble (même départ, même arrivée, même mode, même
 * heure) : ligne droite du départ à l'arrivée, position actuelle au prorata du temps écoulé.
 */
export interface TransportRoute {
  key: string
  mode: TransportMode
  from: LonLat
  to: LonLat
  at: LonLat
  /** Part du trajet faite, de 0 à 1. */
  progress: number
  count: number
}

/** Part du trajet faite à ce tick. */
export function transportProgress(
  t: { departTick: number; arriveTick: number },
  tick: number,
): number {
  const span = t.arriveTick - t.departTick
  if (span <= 0) return 1
  return Math.min(1, Math.max(0, (tick - t.departTick) / span))
}

export function transportRoutes(
  inTransit: TransportSnapshot['inTransit'],
  tick: number,
): TransportRoute[] {
  const routes = new Map<string, TransportRoute>()
  for (const t of inTransit) {
    // Départ arrondi au kilomètre près : les brigades d'une même ville partent ensemble.
    const key = `${t.mode}:${t.dest}:${t.departTick}:${t.from[0].toFixed(2)},${t.from[1].toFixed(2)}`
    const route = routes.get(key)
    if (route) {
      route.count++
      continue
    }
    const progress = transportProgress(t, tick)
    routes.set(key, {
      key,
      mode: t.mode,
      from: t.from,
      to: t.to,
      at: [
        t.from[0] + (t.to[0] - t.from[0]) * progress,
        t.from[1] + (t.to[1] - t.from[1]) * progress,
      ],
      progress,
      count: 1,
    })
  }
  return [...routes.values()]
}
