<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import { armyComposition, strengthTone } from '@/composables/composition'
import type { ArmyState } from '@/sim/core/types'

/**
 * Onglet « Composition » d'une armée : nombre d'unités par type, effectifs et organisation moyens.
 * L'ordre de bataille en corps et divisions viendra avec la phase D.
 */
const props = defineProps<{ army: ArmyState }>()
const game = useGameStore()

const rows = computed(() => {
  const ids = new Set(props.army.unitIds)
  return armyComposition(game.snapshot?.units.filter((u) => ids.has(u.id)) ?? [])
})
const pct = (v: number): string => `${Math.round(v * 100)} %`
const width = (v: number): string => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`
</script>

<template>
  <div class="composition" data-testid="army-composition">
    <p class="kicker">Par type</p>
    <p v-if="rows.length === 0" class="meta">Aucune unité.</p>
    <ul>
      <li v-for="r in rows" :key="r.kind" :data-testid="`composition-${r.kind}`">
        <div class="row">
          <span>{{ r.name }}</span>
          <span class="num">{{ r.count }}</span>
        </div>
        <div class="row small">
          <span class="bar" :title="`Effectifs moyens ${pct(r.strength)}`"
            ><i :class="strengthTone(r.strength)" :style="{ width: width(r.strength) }"
          /></span>
          <span class="num">{{ pct(r.strength) }}</span>
        </div>
        <div class="meta">Organisation moyenne {{ pct(r.org) }}</div>
      </li>
    </ul>
    <p class="meta">
      L'ordre de bataille en corps et divisions s'affichera ici quand ils existeront (phase D).
    </p>
  </div>
</template>

<style scoped>
ul {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
}
li {
  padding: 6px 8px;
  margin-bottom: 4px;
  background: #1b2028;
  border-radius: 6px;
}
.kicker {
  margin: 0 0 4px;
  color: #9aa3af;
  font:
    600 11px/1.2 'Barlow Condensed',
    system-ui,
    sans-serif;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.small {
  margin-top: 3px;
}
.bar {
  flex: 1;
  height: 5px;
  background: #2c323c;
  border-radius: 3px;
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
}
.bar .ok {
  background: #3fb37f;
}
.bar .warn {
  background: #f2a33a;
}
.bar .bad {
  background: #e5484d;
}
.num {
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 12px;
}
.meta {
  color: #9aa3af;
  font-size: 12px;
}
</style>
