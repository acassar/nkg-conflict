<script setup lang="ts">
import { computed, watch } from 'vue'
import { useGameStore } from '@/stores/game'
import { layout } from '@/composables/layout'
import { MODE_NAMES } from '@/sim/systems/transport'
import { transportCss, transportProgress } from '@/map/transports'

const game = useGameStore()

const inTransit = computed(() => game.snapshot?.transport.inTransit ?? [])
const tick = computed(() => game.snapshot?.tick ?? 0)

// Plus rien en route : les trajets se masquent, et le prochain transport ne les rouvre pas de lui-même.
watch(
  () => inTransit.value.length,
  (n) => {
    if (n === 0) game.showTransports = false
  },
)

/** Position : à côté du bouton « Pays » (voir MapViewButton). */
const style = computed(() => {
  if (layout.value === 'portrait') return { left: '166px', bottom: `${game.drawerHeight + 10}px` }
  if (layout.value === 'landscape') return { left: '166px', bottom: '10px' }
  return { right: '208px', bottom: '10px' }
})

/** Liste au-dessus des boutons. */
const panelStyle = computed(() => {
  if (layout.value === 'portrait') return { left: '10px', bottom: `${game.drawerHeight + 62}px` }
  if (layout.value === 'landscape') return { left: '10px', bottom: '62px' }
  return { right: '52px', bottom: '62px' }
})

function remaining(arriveTick: number): string {
  const h = Math.max(0, arriveTick - tick.value)
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} j`
}

const pct = (t: { departTick: number; arriveTick: number }): string =>
  `${Math.round(transportProgress(t, tick.value) * 100)}%`
</script>

<template>
  <template v-if="inTransit.length > 0 && !(layout === 'portrait' && game.drawer === 'full')">
    <button
      class="transport desk"
      :class="{ active: game.showTransports }"
      :style="style"
      :aria-pressed="game.showTransports"
      :title="`${inTransit.length} unité(s) en route : afficher les trajets`"
      aria-label="Transports en cours"
      data-testid="transport-button"
      @click="game.showTransports = !game.showTransports"
    >
      <!-- Train : le camion est déjà l'icône de la carte logistique. -->
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <rect x="5" y="3" width="14" height="13" rx="3" />
          <path d="M5 10h14M8 16l-3 5M16 16l3 5" />
        </g>
        <circle cx="9" cy="13" r="1.2" fill="currentColor" />
        <circle cx="15" cy="13" r="1.2" fill="currentColor" />
      </svg>
      <span class="count">{{ inTransit.length }}</span>
    </button>
    <div
      v-if="game.showTransports"
      class="panel desk"
      :style="panelStyle"
      role="dialog"
      aria-label="Unités en route"
      data-testid="transport-panel"
    >
      <div class="head">
        <strong>En route : {{ inTransit.length }} unité(s)</strong>
        <button class="close" aria-label="Fermer" @click="game.showTransports = false">×</button>
      </div>
      <ul>
        <li
          v-for="t in inTransit"
          :key="t.id"
          :title="`Cadrer la carte sur le trajet de ${t.name}`"
          @click="game.focusRoute(t.from, t.to)"
        >
          <span class="row">
            <i class="dot" :style="{ background: transportCss(t.mode) }" />
            <span class="name">{{ t.name }}</span>
            <span class="eta">{{ remaining(t.arriveTick) }}</span>
          </span>
          <span class="row meta">{{ MODE_NAMES[t.mode] }} vers {{ t.dest }}</span>
          <span class="bar">
            <i :style="{ width: pct(t), background: transportCss(t.mode) }" />
          </span>
        </li>
      </ul>
    </div>
  </template>
</template>

<style scoped>
.transport {
  position: absolute;
  z-index: 12;
  height: 44px;
  min-width: 44px;
  padding: 0 8px;
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(20, 24, 31, 0.92);
  color: #e8eaed;
  border: 1px solid #3b4250;
  border-radius: 10px;
  cursor: pointer;
  transition: bottom 0.2s ease;
  font:
    600 13px/1 system-ui,
    sans-serif;
}
.transport.active {
  background: #f59e0b;
  border-color: #f59e0b;
  color: #1f2937;
}
.panel {
  position: absolute;
  z-index: 12;
  width: min(300px, calc(100% - 20px));
  max-height: 45vh;
  overflow-y: auto;
  box-sizing: border-box;
  padding: 8px 10px;
  background: rgba(20, 24, 31, 0.95);
  color: #e8eaed;
  border: 1px solid #3b4250;
  border-radius: 8px;
  font:
    12px/1.35 system-ui,
    sans-serif;
  transition: bottom 0.2s ease;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.close {
  background: transparent;
  border: 0;
  color: #9aa3af;
  font-size: 16px;
  cursor: pointer;
}
ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 5px 4px;
  border-radius: 4px;
  cursor: pointer;
}
li:hover {
  background: #232a35;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.eta,
.meta {
  color: #9aa3af;
}
.meta {
  padding-left: 14px;
}
.bar {
  margin-left: 14px;
  height: 4px;
  background: #2c323c;
  border-radius: 2px;
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
}

/* Grand écran : charte (docs/charte.md). */
.transport.desk {
  background: var(--nkg-panel-bg);
  color: var(--nkg-text-soft);
  border-color: var(--nkg-brass-dark);
  border-radius: 4px;
  box-shadow:
    0 0 0 2px #10141a,
    0 6px 16px rgba(0, 0, 0, 0.45);
}
.transport.desk:hover {
  color: var(--nkg-text);
  border-color: var(--nkg-brass);
}
.transport.desk.active {
  background: var(--nkg-tile-on-bg);
  border-color: var(--nkg-brass-light);
  color: var(--nkg-brass-pale);
}
.panel.desk {
  background: var(--nkg-panel-bg);
  color: var(--nkg-text);
  border-color: var(--nkg-brass-dark);
  border-radius: 4px;
  box-shadow: var(--nkg-panel-shadow);
  font-family: var(--nkg-sans);
}
</style>
