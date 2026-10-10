<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import { useGauges } from '@/composables/useGauges'
import { isMobile } from '@/composables/layout'

/** Fenêtre ouverte depuis une jauge de la barre du haut : origine, usage et conseils. */
const game = useGameStore()
const gauges = useGauges()
const gauge = computed(() => gauges.value?.find((g) => g.id === game.gaugeOpen) ?? null)

function openProduction(): void {
  game.gaugeOpen = null
  game.openDomain('production')
}
</script>

<template>
  <section
    v-if="gauge"
    class="resource-dialog"
    :class="{ mobile: isMobile }"
    role="dialog"
    :aria-label="gauge.label"
    data-testid="resource-dialog"
  >
    <header>
      <h2>
        <span class="dot" :class="gauge.level" />
        {{ gauge.label }}
        <span class="value">{{ gauge.value }}</span>
        <span v-if="gauge.trend" class="trend">{{ gauge.trend }}</span>
      </h2>
      <button class="close" aria-label="Fermer" @click="game.gaugeOpen = null">×</button>
    </header>
    <p class="summary">{{ gauge.summary }}</p>
    <div class="cols">
      <div>
        <h3>Origine</h3>
        <dl>
          <template v-for="r in gauge.origin" :key="r.label">
            <dt>{{ r.label }}</dt>
            <dd>{{ r.value }}</dd>
          </template>
        </dl>
      </div>
      <div>
        <h3>Usage</h3>
        <dl>
          <template v-for="r in gauge.uses" :key="r.label">
            <dt>{{ r.label }}</dt>
            <dd>{{ r.value }}</dd>
          </template>
        </dl>
      </div>
    </div>
    <h3>Conseil</h3>
    <ul v-if="gauge.advice.length" class="advice" data-testid="resource-advice">
      <li v-for="a in gauge.advice" :key="a">{{ a }}</li>
    </ul>
    <p v-else class="meta">Rien à signaler.</p>
    <p class="meta">
      Tendance : variation moyenne du stock sur les 7 derniers jours de jeu (mesurée depuis le début
      de la partie ou le dernier chargement).
    </p>
    <button class="primary" @click="openProduction">Tiroir Production</button>
  </section>
</template>

<style scoped>
.resource-dialog {
  position: absolute;
  top: 54px;
  left: 50%;
  z-index: 30;
  transform: translateX(-50%);
  width: min(520px, calc(100vw - 24px));
  max-height: calc(100% - 80px);
  overflow-y: auto;
  padding: 10px 14px 12px;
  background: rgba(21, 28, 36, 0.98);
  color: #e8eaed;
  border: 1px solid #263140;
  border-top: 2px solid #4c8dff;
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  font:
    13px/1.4 'Barlow',
    system-ui,
    sans-serif;
}
.resource-dialog.mobile {
  top: calc(52px + env(safe-area-inset-top));
  left: 8px;
  right: 8px;
  width: auto;
  transform: none;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
h2 {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  font:
    600 16px/1.2 'Barlow Condensed',
    'Barlow',
    system-ui,
    sans-serif;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.value,
.trend,
dd {
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
  text-transform: none;
}
.trend {
  color: #9aa3af;
  font-size: 12px;
}
h3 {
  margin: 10px 0 4px;
  color: #9aa3af;
  font:
    600 12px/1.2 'Barlow Condensed',
    'Barlow',
    system-ui,
    sans-serif;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.summary {
  margin: 6px 0 0;
}
.cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.mobile .cols {
  grid-template-columns: 1fr;
  gap: 0;
}
dl {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px 8px;
  margin: 0;
}
dt {
  color: #b8c2cf;
}
dd {
  margin: 0;
  text-align: right;
}
.advice {
  margin: 0;
  padding-left: 18px;
  color: #f2a33a;
}
.meta {
  margin: 6px 0;
  color: #9aa3af;
  font-size: 12px;
}
.dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #6b7280;
}
.dot.ok {
  background: #22c55e;
}
.dot.warning {
  background: #f2a33a;
}
.dot.critical {
  background: #ef4444;
}
button {
  background: #222c38;
  color: inherit;
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
  font: inherit;
}
button.primary {
  margin-top: 4px;
  background: #4c8dff;
  border-color: #4c8dff;
  color: #fff;
}
</style>
