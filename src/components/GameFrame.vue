<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useGameStore } from '@/stores/game'
import FrameContent from './FrameContent.vue'
import { isTouch, layout } from '@/composables/layout'
import { DOMAINS, mobileSheet, type Domain, type InspectKind } from '@/stores/frame'

/**
 * Cadre de la partie (concept A) :
 * - grand écran : rail à gauche (Forces, Production, Diplomatie, Journal) qui ouvre un tiroir
 *   par domaine, inspecteur à droite pour la sélection (unités, armée, ville, pays) ;
 * - téléphone en portrait : un seul panneau en tiroir à poignée, barre du bas à quatre entrées ;
 * - téléphone couché : le même panneau sur le côté droit, entrées en haut.
 */
const game = useGameStore()
const panel = ref<HTMLElement | null>(null)
const desktop = computed(() => layout.value === 'desktop')
const portrait = computed(() => layout.value === 'portrait')

const domainName = (d: Domain): string => DOMAINS.find((x) => x.id === d)?.name ?? ''

/** Titre de l'inspecteur selon ce qu'il montre. */
function inspectorTitle(view: InspectKind): string {
  if (view === 'units') {
    const n = game.selection.length
    return `${n} unité${n > 1 ? 's' : ''} sélectionnée${n > 1 ? 's' : ''}`
  }
  if (view === 'army') return game.selectedArmy?.name ?? 'Armée'
  if (view === 'city') return game.selectedCity?.name ?? 'Ville'
  return game.selectedCountry?.name ?? 'Pays'
}

/** Ferme l'inspecteur et oublie la sélection qu'il montrait. */
function closeInspector(): void {
  const view = game.inspector
  if (view === 'units' || view === 'army') game.clearSelection()
  else if (view === 'city') game.selectCity(null)
  else if (view === 'country') game.selectCountry(null)
  game.inspect = null
  game.sheet = 'domain'
}

// ---------- Téléphone : panneau unique ----------

const sheet = computed(() => mobileSheet(game.sheet, game.inspector, game.panelTab))
const sheetTitle = computed(() =>
  sheet.value.kind === 'inspector'
    ? inspectorTitle(sheet.value.view as InspectKind)
    : domainName(sheet.value.view as Domain),
)
const activeDomain = computed(() =>
  sheet.value.kind === 'domain' ? (sheet.value.view as Domain) : null,
)
/** Corps visible : tiroir ouvert en portrait, toujours sur le côté en paysage. */
const bodyVisible = computed(() => !portrait.value || game.drawer !== 'collapsed')

function openDrawerIfClosed(): void {
  if (portrait.value && game.drawer === 'collapsed' && game.mode.kind === 'select') {
    game.drawer = 'half'
  }
}

function tapDomain(d: Domain): void {
  game.openDomain(d)
  openDrawerIfClosed()
}

function backToInspector(): void {
  game.sheet = 'inspector'
  openDrawerIfClosed()
}

const DRAWER_STATES = ['collapsed', 'half', 'full'] as const
/** Hauteur pendant un glisser du tiroir (null hors glisser). */
const dragHeight = ref<number | null>(null)
let dragStart: { y: number; height: number; moved: boolean } | null = null

function heights(): Record<(typeof DRAWER_STATES)[number], number> {
  const vh = window.innerHeight
  const bar = panel.value?.querySelector('.bar')?.getBoundingClientRect().height ?? 56
  return { collapsed: bar + 20, half: Math.round(vh * 0.48), full: vh - 52 }
}

function onHandleDown(e: PointerEvent): void {
  if (!portrait.value || !panel.value) return
  dragStart = { y: e.clientY, height: panel.value.getBoundingClientRect().height, moved: false }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onHandleMove(e: PointerEvent): void {
  if (!dragStart) return
  const dy = dragStart.y - e.clientY
  if (Math.abs(dy) > 6) dragStart.moved = true
  if (!dragStart.moved) return
  const h = heights()
  dragHeight.value = Math.max(h.collapsed, Math.min(h.full, dragStart.height + dy))
}

function onHandleUp(): void {
  if (!dragStart) return
  const start = dragStart
  dragStart = null
  if (!start.moved) {
    // Simple toucher de la poignée : état suivant.
    const k = DRAWER_STATES.indexOf(game.drawer)
    game.drawer = DRAWER_STATES[(k + 1) % DRAWER_STATES.length] ?? 'half'
    return
  }
  const h = heights()
  const now = dragHeight.value ?? start.height
  let best: (typeof DRAWER_STATES)[number] = 'half'
  for (const st of DRAWER_STATES) if (Math.abs(h[st] - now) < Math.abs(h[best] - now)) best = st
  game.drawer = best
  dragHeight.value = null
}

const drawerStyle = computed(() =>
  portrait.value && dragHeight.value !== null ? { height: `${dragHeight.value}px` } : undefined,
)

// Hauteur réelle du tiroir, pour placer les boutons flottants au-dessus.
let observer: ResizeObserver | null = null
onMounted(() => {
  observer = new ResizeObserver(() => {
    game.drawerHeight = portrait.value ? (panel.value?.offsetHeight ?? 0) : 0
  })
  if (panel.value) observer.observe(panel.value)
  if (!portrait.value) game.drawerHeight = 0
})
onBeforeUnmount(() => observer?.disconnect())

// Pendant la saisie d'un ordre, le tiroir se replie pour dégager la carte, puis revient.
let drawerBeforeOrder: typeof game.drawer | null = null
watch(
  () => game.mode.kind,
  (kind) => {
    if (!portrait.value) return
    if (kind !== 'select' && drawerBeforeOrder === null) {
      drawerBeforeOrder = game.drawer
      game.drawer = 'collapsed'
    } else if (kind === 'select' && drawerBeforeOrder !== null) {
      game.drawer = drawerBeforeOrder
      drawerBeforeOrder = null
    }
  },
)
// Une nouvelle sélection (unités, armée, ville, pays) ou un domaine choisi ouvrent le tiroir.
watch(
  () => [game.inspect, game.sheet, game.panelTab],
  () => {
    if (game.sheet === 'inspector' && !game.inspect) return
    openDrawerIfClosed()
  },
)
</script>

<template>
  <!-- Grand écran : rail, tiroir du domaine, inspecteur -->
  <template v-if="desktop">
    <nav class="rail" aria-label="Domaines" data-testid="rail">
      <button
        v-for="d in DOMAINS"
        :key="d.id"
        :class="{ active: game.panelTab === d.id }"
        :aria-pressed="game.panelTab === d.id"
        :title="d.name"
        :data-testid="`rail-${d.id}`"
        @click="game.openDomain(d.id, true)"
      >
        <span class="icon" aria-hidden="true">{{ d.icon }}</span>
        <span class="name">{{ d.name }}</span>
        <span v-if="d.id === 'forces'" class="count">{{ game.armies.length }}</span>
      </button>
    </nav>
    <aside
      v-if="game.panelTab"
      class="frame-panel drawer-left"
      :class="{ touch: isTouch }"
      :data-testid="`drawer-${game.panelTab}`"
    >
      <header>
        <h2>{{ domainName(game.panelTab) }}</h2>
        <button class="close" aria-label="Fermer le tiroir" @click="game.panelTab = null">×</button>
      </header>
      <div class="body">
        <FrameContent kind="domain" :view="game.panelTab" />
      </div>
    </aside>
    <aside
      v-if="game.inspector"
      class="frame-panel inspector"
      :class="{ touch: isTouch }"
      :data-testid="`inspector-${game.inspector}`"
    >
      <header>
        <h2>{{ inspectorTitle(game.inspector) }}</h2>
        <button class="close" aria-label="Fermer l'inspecteur" @click="closeInspector">×</button>
      </header>
      <div class="body" data-testid="inspector">
        <FrameContent kind="inspector" :view="game.inspector" />
      </div>
    </aside>
  </template>

  <!-- Téléphone : un seul panneau, tiroir à poignée en portrait, sur le côté en paysage -->
  <aside
    v-else
    ref="panel"
    class="frame-panel mobile"
    :class="{
      drawer: portrait,
      side: !portrait,
      touch: isTouch,
      collapsed: !bodyVisible,
      [`drawer-${game.drawer}`]: portrait,
      dragging: dragHeight !== null,
    }"
    :style="drawerStyle"
    data-testid="command-panel"
  >
    <div
      v-if="portrait"
      class="handle"
      role="button"
      aria-label="Agrandir ou réduire le panneau"
      data-testid="drawer-handle"
      @pointerdown="onHandleDown"
      @pointermove="onHandleMove"
      @pointerup="onHandleUp"
      @pointercancel="onHandleUp"
    >
      <span />
    </div>
    <template v-if="bodyVisible">
      <header>
        <h2>{{ sheetTitle }}</h2>
        <button
          v-if="sheet.kind === 'domain' && game.inspector"
          class="back"
          data-testid="sheet-inspector"
          @click="backToInspector"
        >
          ‹ {{ inspectorTitle(game.inspector) }}
        </button>
        <button
          v-else-if="sheet.kind === 'inspector'"
          class="close"
          aria-label="Fermer l'inspecteur"
          @click="closeInspector"
        >
          ×
        </button>
      </header>
      <div class="body" :data-testid="sheet.kind === 'inspector' ? 'inspector' : undefined">
        <FrameContent :kind="sheet.kind" :view="sheet.view" />
      </div>
    </template>
    <nav class="bar" aria-label="Domaines">
      <button
        v-for="d in DOMAINS"
        :key="d.id"
        :class="{ active: activeDomain === d.id }"
        :data-testid="`rail-${d.id}`"
        @click="tapDomain(d.id)"
      >
        <span class="icon" aria-hidden="true">{{ d.icon }}</span>
        <span class="name">{{ d.short }}</span>
      </button>
    </nav>
  </aside>
</template>

<style scoped>
/* Couleurs des maquettes : fond #0e1318, panneaux #151c24, bleu #4c8dff, ambre #f2a33a. */
.rail,
.frame-panel {
  --frame-bg: #0e1318;
  --frame-panel: #151c24;
  --frame-line: #263140;
  --frame-blue: #4c8dff;
  --frame-amber: #f2a33a;
  color: #e8eaed;
  font:
    13px/1.35 'Barlow',
    system-ui,
    sans-serif;
}
.rail {
  position: absolute;
  top: 60px;
  left: 12px;
  z-index: 11;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  background: rgba(14, 19, 24, 0.94);
  border: 1px solid var(--frame-line);
  border-radius: 10px;
}
.rail button {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 64px;
  padding: 8px 4px 6px;
  background: transparent;
  color: #b8c2cf;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  font:
    600 11px/1.1 'Barlow Condensed',
    'Barlow',
    system-ui,
    sans-serif;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.rail button:hover {
  background: #1b2430;
  color: #fff;
}
.rail button.active {
  background: rgba(76, 141, 255, 0.16);
  border-color: var(--frame-blue);
  color: #fff;
}
.rail .icon,
.bar .icon {
  font-size: 18px;
  line-height: 1;
}
.rail .count {
  position: absolute;
  top: 3px;
  right: 4px;
  min-width: 14px;
  padding: 0 3px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.14);
  font:
    600 10px/14px 'IBM Plex Mono',
    ui-monospace,
    monospace;
  text-transform: none;
}

/* Tiroir du domaine (gauche) et inspecteur (droite). */
.frame-panel {
  position: absolute;
  top: 60px;
  z-index: 10;
  width: 330px;
  max-height: calc(100% - 140px);
  display: flex;
  flex-direction: column;
  background: rgba(21, 28, 36, 0.96);
  border: 1px solid var(--frame-line);
  border-radius: 10px;
}
.drawer-left {
  left: 98px;
}
.inspector {
  right: 12px;
  width: 320px;
  border-top: 2px solid var(--frame-blue);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--frame-line);
}
h2 {
  margin: 0;
  overflow: hidden;
  font:
    600 15px/1.2 'Barlow Condensed',
    'Barlow',
    system-ui,
    sans-serif;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.body {
  overflow-y: auto;
  padding: 8px 10px;
}
header .close,
header .back {
  flex: none;
  background: transparent;
  color: #b8c2cf;
  border: 1px solid var(--frame-line);
  border-radius: 6px;
  padding: 2px 8px;
  cursor: pointer;
  font: inherit;
}
header .back {
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--frame-amber);
}
/* Les contenus (forces, production, diplomatie…) partagent le style des boutons du cadre. */
.body :deep(button) {
  background: #222c38;
  color: inherit;
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
  font: inherit;
}
.body :deep(button:hover:not(:disabled)) {
  background: #2b3746;
}
.body :deep(button:disabled) {
  opacity: 0.45;
  cursor: default;
}
.body :deep(button.active) {
  background: var(--frame-blue);
  border-color: var(--frame-blue);
  color: #fff;
}
.body :deep(button.danger) {
  border-color: #7f1d1d;
}
/* Cibles tactiles plus grandes. */
.frame-panel.touch :deep(button) {
  min-height: 36px;
  padding: 6px 10px;
}
.frame-panel.touch {
  font-size: 14px;
}

/* ---------- Téléphone ---------- */
.frame-panel.mobile {
  width: auto;
}
.bar {
  display: flex;
  gap: 2px;
  padding: 4px;
  border-top: 1px solid var(--frame-line);
  background: rgba(14, 19, 24, 0.96);
}
.bar button {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-height: 44px;
  padding: 4px 2px;
  background: transparent;
  color: #b8c2cf;
  border: 1px solid transparent;
  border-radius: 8px;
  font:
    600 11px/1.1 'Barlow Condensed',
    'Barlow',
    system-ui,
    sans-serif;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.bar button.active {
  background: rgba(76, 141, 255, 0.16);
  border-color: var(--frame-blue);
  color: #fff;
}
/* Portrait : tiroir en bas, barre des domaines tout en bas. */
.frame-panel.drawer {
  top: auto;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: none;
  border-radius: 14px 14px 0 0;
  border-bottom: none;
  padding-bottom: env(safe-area-inset-bottom);
  transition: height 0.2s ease;
}
.frame-panel.drawer.dragging {
  transition: none;
}
.frame-panel.drawer-half {
  height: 48dvh;
}
.frame-panel.drawer-full {
  height: calc(100dvh - 52px);
}
.frame-panel.drawer .body {
  flex: 1;
  min-height: 0;
}
.frame-panel.drawer .bar {
  margin-top: auto;
  border-radius: 0;
}
.handle {
  display: flex;
  justify-content: center;
  padding: 8px 0 6px;
  touch-action: none;
  cursor: grab;
}
.handle span {
  width: 44px;
  height: 5px;
  border-radius: 3px;
  background: #4b5563;
}
/* Paysage : panneau sur le côté droit, entrées en haut. */
.frame-panel.side {
  top: 48px;
  right: 6px;
  bottom: 6px;
  width: min(320px, 46vw);
  max-height: none;
}
.frame-panel.side .bar {
  order: -1;
  border-top: none;
  border-bottom: 1px solid var(--frame-line);
  border-radius: 10px 10px 0 0;
}
.frame-panel.side .bar button {
  flex-direction: row;
  justify-content: center;
  gap: 4px;
  min-height: 34px;
}
.frame-panel.side .body {
  flex: 1;
  min-height: 0;
}
</style>
