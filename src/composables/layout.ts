import { computed, ref } from 'vue'

/**
 * Mise en page selon l'écran :
 * - desktop : panneau à droite, journal en bas à gauche ;
 * - portrait (téléphone) : barre du haut compacte, panneau en tiroir en bas ;
 * - landscape (téléphone couché) : barre compacte, panneau sur le côté.
 */
export type Layout = 'desktop' | 'portrait' | 'landscape'

const width = ref(window.innerWidth)
const height = ref(window.innerHeight)
const coarseQuery = window.matchMedia?.('(pointer: coarse)')
const coarse = ref(coarseQuery?.matches ?? false)

window.addEventListener('resize', () => {
  width.value = window.innerWidth
  height.value = window.innerHeight
})
coarseQuery?.addEventListener?.('change', (e) => (coarse.value = e.matches))

export const layout = computed<Layout>(() => {
  const w = width.value
  const h = height.value
  const small = w < 760 || h < 500
  if (!small) return 'desktop'
  return h >= w ? 'portrait' : 'landscape'
})

export const isMobile = computed(() => layout.value !== 'desktop')
/** Écran tactile : pas de survol, cibles plus grandes, pas de boutons de zoom. */
export const isTouch = computed(() => coarse.value)
