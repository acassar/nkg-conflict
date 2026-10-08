<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import { layout } from '@/composables/layout'

const game = useGameStore()

/** Position : au-dessus du tiroir en portrait, en bas à gauche en paysage, près du zoom sur ordinateur. */
const style = computed(() => {
  if (layout.value === 'portrait') return { left: '10px', bottom: `${game.drawerHeight + 10}px` }
  if (layout.value === 'landscape') return { left: '10px', bottom: '10px' }
  return { right: '52px', bottom: '10px' }
})

function toggle(): void {
  if (game.mode.kind !== 'select') game.cancelMode()
  game.lasso = !game.lasso
}
</script>

<template>
  <button
    v-if="!(layout === 'portrait' && game.drawer === 'full')"
    class="lasso"
    :class="{ active: game.lasso }"
    :style="style"
    :aria-pressed="game.lasso"
    title="Sélection par zone : glissez un rectangle sur la carte"
    aria-label="Sélection par zone"
    data-testid="lasso-button"
    @click="toggle"
  >
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <rect
        x="4"
        y="5"
        width="16"
        height="14"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-dasharray="3 2.5"
      />
    </svg>
  </button>
</template>

<style scoped>
.lasso {
  position: absolute;
  z-index: 12;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  background: rgba(20, 24, 31, 0.92);
  color: #e8eaed;
  border: 1px solid #3b4250;
  border-radius: 10px;
  cursor: pointer;
  transition: bottom 0.2s ease;
}
.lasso.active {
  background: #facc15;
  border-color: #facc15;
  color: #1f2937;
}
</style>
