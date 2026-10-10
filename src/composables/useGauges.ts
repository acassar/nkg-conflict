import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import { gaugeViews } from './gauges'
import { useProductionStats } from './production'
import { useSustainability } from './sustainability'

/** Jauges de la barre du haut du joueur (voir gauges.ts). */
export function useGauges() {
  const game = useGameStore()
  const sustain = useSustainability()
  const stats = useProductionStats()
  return computed(() => {
    const eco = game.snapshot?.economy
    if (!eco) return null
    const st = stats.value
    return gaugeViews({
      eco,
      sustain: sustain.value,
      history: game.resourceHistory,
      freeBarracks: st ? Math.max(0, st.recruitment.max - st.recruitment.active) : 0,
    })
  })
}
