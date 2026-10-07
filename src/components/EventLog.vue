<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import { formatGameDate, tickToDate } from '@/sim/core/clock'

const game = useGameStore()
const events = computed(() => (game.snapshot?.events ?? []).slice(-7).reverse())
const colorOf = (owner: string | null): string => {
  const c = game.snapshot?.countries.find((x) => x.id === owner)?.color
  return c ? `rgb(${c.join(',')})` : '#9aa3af'
}
const when = (tick: number): string =>
  game.snapshot ? formatGameDate(tickToDate(game.snapshot.startDate, tick)) : ''
</script>

<template>
  <section v-if="events.length" class="log" aria-live="polite">
    <p v-for="(e, k) in events" :key="`${e.tick}-${k}`">
      <span class="dot" :style="{ background: colorOf(e.owner) }" />
      <span class="when">{{ when(e.tick) }}</span>
      {{ e.text }}
    </p>
  </section>
</template>

<style scoped>
.log {
  position: absolute;
  left: 12px;
  bottom: 44px;
  z-index: 10;
  max-width: min(420px, calc(100% - 24px));
  padding: 6px 10px;
  background: rgba(20, 24, 31, 0.88);
  color: #e8eaed;
  border-radius: 6px;
  font:
    12px/1.4 system-ui,
    sans-serif;
}
p {
  margin: 2px 0;
}
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
}
.when {
  color: #9aa3af;
  margin-right: 6px;
  font-variant-numeric: tabular-nums;
}
@media (max-width: 640px) {
  .log {
    display: none;
  }
}
</style>
