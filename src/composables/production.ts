import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import { MAX_PARALLEL_CONSTRUCTION } from '@/sim/economy/rules'

/**
 * Indicateurs de production du joueur : chantiers et formations en cours face aux capacités,
 * production et construction employées face aux gains du jour.
 * Les formations en cours sont les premières de la file, une par caserne (règle de la simulation).
 */
export function useProductionStats() {
  const game = useGameStore()
  return computed(() => {
    const s = game.snapshot
    const eco = s?.economy
    if (!s || !eco) return null
    const mine = s.cities.filter((c) => c.owner === s.playerCountry)
    const barracks = mine.reduce((n, c) => n + c.buildings.barracks, 0)
    const active = eco.recruitment.slice(0, barracks)
    const busyByCity = new Map<string, number>()
    for (const q of active) busyByCity.set(q.city, (busyByCity.get(q.city) ?? 0) + 1)
    return {
      construction: {
        active: Math.min(eco.construction.length, MAX_PARALLEL_CONSTRUCTION),
        max: MAX_PARALLEL_CONSTRUCTION,
        queued: eco.construction.length,
        used: eco.daily.constructionUsed ?? 0,
        gain: eco.daily.construction,
      },
      recruitment: {
        active: active.length,
        max: barracks,
        queued: eco.recruitment.length,
      },
      production: {
        used: eco.daily.productionUsed ?? 0,
        gain: eco.daily.production,
        stock: eco.production,
      },
      busyByCity,
    }
  })
}
