<script setup lang="ts">
import { computed } from 'vue'
import type { UnitKind } from '@/sim/core/types'
import { ECHELON_MARK, type Echelon } from '@/composables/composition'

/**
 * Symbole OTAN simplifié d'un échelon : marque (X à XXXX) au-dessus d'un cadre, avec le symbole du
 * type dominant (infanterie, blindés, mécanisée, artillerie, défense territoriale).
 */
const props = withDefaults(
  defineProps<{ echelon: Echelon; kind?: UnitKind; size?: number; color?: string }>(),
  { kind: 'inf', size: 28, color: '#2563eb' },
)
const mark = computed(() => ECHELON_MARK[props.echelon])
const width = computed(() => props.size)
const height = computed(() => Math.round(props.size * 0.95))
</script>

<template>
  <svg
    class="echelon"
    :width="width"
    :height="height"
    viewBox="0 0 40 38"
    role="img"
    :aria-label="`Échelon ${mark}`"
    data-testid="echelon-symbol"
  >
    <text x="20" y="9" text-anchor="middle" class="mark">{{ mark }}</text>
    <rect x="3" y="13" width="34" height="22" :fill="color" stroke="#fff" stroke-width="2" />
    <g stroke="#fff" stroke-width="2" fill="none">
      <template v-if="kind === 'inf' || kind === 'mech' || kind === 'tdf'">
        <path
          d="M3 13 L37 35 M37 13 L3 35"
          :stroke-dasharray="kind === 'tdf' ? '3 2' : undefined"
        />
      </template>
      <ellipse v-if="kind === 'tank' || kind === 'mech'" cx="20" cy="24" rx="11" ry="6" />
      <circle v-if="kind === 'art'" cx="20" cy="24" r="3.5" fill="#fff" />
    </g>
  </svg>
</template>

<style scoped>
.echelon {
  flex: none;
  vertical-align: middle;
}
.mark {
  font:
    bold 9px system-ui,
    sans-serif;
  fill: currentColor;
}
</style>
