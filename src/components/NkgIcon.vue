<script lang="ts">
/**
 * Icônes au trait de la charte (docs/charte.md) : 24 × 24, trait de 1,7, couleur du texte.
 * Une icône est une liste de tracés SVG ; les cercles et rectangles sont écrits en tracés.
 */
const ICONS = {
  forces: ['M5 5l11 11M19 5L8 16M4 15l5 5M20 15l-5 5'],
  factory: ['M3 20V11l5 3v-3l5 3V6h4v14z'],
  flag: ['M6 21V4M6 4h11l-2 4 2 4H6'],
  journal: ['M7 4h10v16H7zM10 8h4M10 12h4M10 16h2'],
  coin: [
    'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16',
    'M14.5 9.5c-.4-.9-1.3-1.5-2.5-1.5-1.5 0-2.5.8-2.5 1.9 0 2.6 5 1.4 5 4.2 0 1.1-1 1.9-2.5 1.9-1.2 0-2.1-.6-2.5-1.5M12 6.5V8M12 16v1.5',
  ],
  shell: ['M9 21V10l3-6 3 6v11zM9 16h6'],
  person: ['M12 4.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7', 'M5 20c1-4 4-6 7-6s6 2 7 6'],
  shield: ['M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z'],
  bell: ['M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4'],
  menu: ['M4 7h16M4 12h16M4 17h16'],
  close: ['M7 7l10 10M17 7L7 17'],
  map: ['M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14'],
  truck: [
    'M2 7h12v9H2zM14 10h4l3 3v3h-7',
    'M6 16.4a1.6 1.6 0 1 0 0 3.2a1.6 1.6 0 1 0 0-3.2M17 16.4a1.6 1.6 0 1 0 0 3.2a1.6 1.6 0 1 0 0-3.2',
  ],
  lasso: ['M4 4h4M10 4h4M16 4h4v4M20 10v4M20 16v4h-4M14 20h-4M8 20H4v-4M4 14v-4M4 8V4'],
  up: ['M6 14l6-6 6 6'],
  down: ['M6 10l6 6 6-6'],
  left: ['M14 6l-6 6 6 6'],
  right: ['M10 6l6 6-6 6'],
  plus: ['M12 5v14M5 12h14'],
  move: ['M4 12h13M13 7l5 5-5 5'],
  hold: ['M6 4v16M18 4v16M6 12h12'],
  retreat: ['M20 12H7M11 7l-5 5 5 5'],
  mission: ['M6 21V4M6 4h11l-2 4 2 4H6'],
  info: ['M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16', 'M12 8v4M12 16h.01'],
  alert: ['M12 4l9 16H3zM12 10v4M12 17h.01'],
  milfactory: ['M3 20V11l5 3v-3l5 3V6h4v14zM14 10l4-4'],
  barracks: ['M4 20V9l8-5 8 5v11zM9 20v-6h6v6'],
  depot: ['M3 9l9-5 9 5v11H3zM7 13h10M7 17h10'],
  fort: ['M4 20V8h3v3h3V8h4v3h3V8h3v12z'],
  clock: ['M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16', 'M12 8v4l3 2'],
  city: ['M3 21V10l4-3 4 3V5l5-2 5 2v16zM3 21h18M14 8h2M14 12h2M14 16h2M6 14h2M6 17h2'],
} as const

export type IconName = keyof typeof ICONS
</script>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 18 })
const paths = computed(() => ICONS[props.name])
</script>

<template>
  <svg
    class="nkg-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="(d, i) in paths" :key="i" :d="d" />
  </svg>
</template>

<style scoped>
.nkg-icon {
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
