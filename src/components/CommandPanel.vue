<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/game'
import ProductionTab from './ProductionTab.vue'
import CountryTab from './CountryTab.vue'
import EventLog from './EventLog.vue'
import { isMobile, isTouch, layout } from '@/composables/layout'
import { MODERN_CATALOG } from '@/sim/units/catalog'
import type { OrderKind, UnitSnapshot } from '@/sim/core/types'

const game = useGameStore()
const { selectedUnits, armies, selectedArmy, selectedArmyId, panelTab: tab } = storeToRefs(game)
const armyName = ref('')
const collapsed = ref(false)
const panel = ref<HTMLElement | null>(null)
const portrait = computed(() => layout.value === 'portrait')
/** Corps du panneau visible : replié en bureau/paysage, tiroir fermé en portrait. */
const bodyVisible = computed(() =>
  portrait.value ? game.drawer !== 'collapsed' : !collapsed.value,
)

function selectTab(next: typeof tab.value): void {
  tab.value = next
  if (portrait.value && game.drawer === 'collapsed') game.drawer = 'half'
}

// ---------- Tiroir (portrait) ----------

const DRAWER_STATES = ['collapsed', 'half', 'full'] as const
/** Hauteur pendant un glisser du tiroir (null hors glisser). */
const dragHeight = ref<number | null>(null)
let dragStart: { y: number; height: number; moved: boolean } | null = null

function heights(): Record<(typeof DRAWER_STATES)[number], number> {
  const vh = window.innerHeight
  const header = panel.value?.querySelector('header')?.getBoundingClientRect().height ?? 56
  return { collapsed: header + 14, half: Math.round(vh * 0.48), full: vh - 52 }
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
})
onBeforeUnmount(() => observer?.disconnect())
watch(portrait, (p) => {
  game.drawerHeight = p ? (panel.value?.offsetHeight ?? 0) : 0
})

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
// Une sélection, une ville ou un pays choisis sur la carte ouvrent le tiroir.
watch(
  () => game.selection.length,
  (n, before) => {
    if (!portrait.value || n === 0 || before > 0 || game.mode.kind !== 'select') return
    tab.value = 'units'
    if (game.drawer === 'collapsed') game.drawer = 'half'
  },
)
watch(tab, () => {
  if (portrait.value && game.drawer === 'collapsed' && game.mode.kind === 'select') {
    game.drawer = 'half'
  }
})

const ORDER_NAMES: Record<OrderKind, string> = {
  idle: 'En attente',
  move: 'En mouvement',
  attack: 'Attaque',
  hold: 'Tient la position',
  retreat: 'Repli',
  front: 'Tient le front',
}

const pct = (v: number): string => `${Math.round(v * 100)} %`
const status = (u: UnitSnapshot): string => {
  if (u.routed) return 'En déroute'
  const parts = [ORDER_NAMES[u.order]]
  if (u.engaged) parts.push('au contact')
  if (!u.supplied) parts.push('hors ravitaillement')
  if (!u.commanded && u.kind !== 'hq') parts.push('hors commandement')
  return parts.join(' · ')
}

const armyOf = (id: number | null): string =>
  armies.value.find((a) => a.id === id)?.name ?? 'Sans armée'

const unitsOfArmy = computed(() => {
  const a = selectedArmy.value
  if (!a) return []
  const ids = new Set(a.unitIds)
  return game.snapshot?.units.filter((u) => ids.has(u.id)) ?? []
})

const attachTo = ref<number | null>(null)
async function attach(): Promise<void> {
  const id = attachTo.value ?? armies.value[0]?.id
  if (id !== undefined && id !== null) await game.addSelectionToArmy(id)
}

async function createArmy(): Promise<void> {
  await game.createArmyFromSelection(armyName.value)
  armyName.value = ''
  tab.value = 'armies'
}
</script>

<template>
  <aside
    ref="panel"
    class="panel"
    :class="{
      collapsed: !bodyVisible,
      drawer: portrait,
      side: layout === 'landscape',
      touch: isTouch,
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
    <header>
      <nav>
        <button :class="{ active: tab === 'units' }" @click="selectTab('units')">
          Unités <span class="count">{{ selectedUnits.length }}</span>
        </button>
        <button :class="{ active: tab === 'armies' }" @click="selectTab('armies')">
          Armées <span class="count">{{ armies.length }}</span>
        </button>
        <button :class="{ active: tab === 'production' }" @click="selectTab('production')">
          {{ portrait ? 'Prod.' : 'Production' }}
        </button>
        <button
          :class="{ active: tab === 'country' }"
          data-testid="tab-country"
          @click="selectTab('country')"
        >
          {{ portrait ? 'Diplo.' : 'Diplomatie' }}
        </button>
        <button v-if="isMobile" :class="{ active: tab === 'log' }" @click="selectTab('log')">
          Journal
        </button>
      </nav>
      <button
        v-if="!portrait"
        class="toggle"
        :aria-label="collapsed ? 'Déplier' : 'Replier'"
        @click="collapsed = !collapsed"
      >
        {{ collapsed ? '▾' : '▴' }}
      </button>
    </header>

    <div v-if="bodyVisible" class="body">
      <!-- Unités sélectionnées -->
      <template v-if="tab === 'units'">
        <p v-if="selectedUnits.length === 0" class="empty">
          {{
            isTouch
              ? 'Touchez une de vos unités pour la sélectionner, ou utilisez la sélection par zone (▢).'
              : 'Cliquez sur une de vos unités pour la sélectionner, Maj + clic pour en ajouter.'
          }}
        </p>
        <template v-else>
          <div class="orders">
            <button
              title="Déplacer (M) — ou clic droit sur la carte"
              @click="game.startOrder('move')"
            >
              Déplacer
            </button>
            <button title="Attaquer (A)" @click="game.startOrder('attack')">Attaquer</button>
            <button title="Tenir la position (H)" @click="game.hold()">Tenir</button>
            <button title="Se replier (R)" @click="game.startOrder('retreat')">Se replier</button>
          </div>
          <ul class="units">
            <li v-for="u in selectedUnits" :key="u.id">
              <div class="name">{{ u.name }}</div>
              <div class="meta">
                {{ MODERN_CATALOG[u.kind].name }} · {{ armyOf(u.armyId) }} ·
                {{ game.terrainNameAt(u.lon, u.lat) }}
              </div>
              <div class="bars">
                <span title="Effectifs">Eff. {{ pct(u.strength) }}</span>
                <span title="Organisation">Org. {{ pct(u.org) }}</span>
              </div>
              <div class="status" :class="{ warn: u.routed || !u.supplied }">{{ status(u) }}</div>
            </li>
          </ul>
          <form v-if="armies.length" class="create" @submit.prevent="attach">
            <select v-model="attachTo" aria-label="Armée à rejoindre">
              <option v-for="a in armies" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
            <button type="submit">Rattacher la sélection à cette armée</button>
          </form>
          <form class="create" @submit.prevent="createArmy">
            <input v-model="armyName" placeholder="Nom de la nouvelle armée" maxlength="40" />
            <button type="submit">Créer une armée</button>
          </form>
        </template>
      </template>

      <ProductionTab v-else-if="tab === 'production'" />

      <CountryTab v-else-if="tab === 'country'" />

      <EventLog v-else-if="tab === 'log'" embedded :limit="40" />

      <!-- Armées -->
      <template v-else>
        <ul class="armies">
          <li
            v-for="a in armies"
            :key="a.id"
            :class="{ active: a.id === selectedArmyId }"
            @click="game.selectArmy(a.id)"
          >
            <span class="name">{{ a.name }}</span>
            <span class="meta">
              {{ a.unitIds.length }} unités ·
              {{ a.wholeFront ? 'tout le front' : a.front ? 'portion de front' : 'sans front' }}
              <template v-if="a.offensive">
                · offensive {{ a.offensive.launched ? 'en cours' : 'planifiée' }}
              </template>
            </span>
          </li>
        </ul>

        <section v-if="selectedArmy" class="army">
          <h3>{{ selectedArmy.name }}</h3>
          <p class="meta">
            {{ unitsOfArmy.filter((u) => u.engaged).length }} au contact ·
            {{ unitsOfArmy.filter((u) => !u.supplied).length }} hors ravitaillement
          </p>
          <div class="group">
            <span class="label">Front</span>
            <button @click="game.startFront(selectedArmy.id)">Assigner une portion</button>
            <button @click="game.setWholeFront(selectedArmy.id)">Tout le front</button>
            <button @click="game.clearFront(selectedArmy.id)">Aucun</button>
          </div>
          <div class="group">
            <span class="label">Offensive</span>
            <button @click="game.startOffensive(selectedArmy.id)">Planifier</button>
            <button
              :disabled="!selectedArmy.offensive || selectedArmy.offensive.launched"
              @click="game.launchOffensive(selectedArmy.id)"
            >
              Lancer
            </button>
            <button
              :disabled="!selectedArmy.offensive"
              @click="game.cancelOffensive(selectedArmy.id)"
            >
              Annuler
            </button>
          </div>
          <button class="danger" @click="game.disbandArmy(selectedArmy.id)">
            Dissoudre l'armée
          </button>
        </section>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.panel {
  position: absolute;
  top: 60px;
  right: 12px;
  z-index: 10;
  width: 320px;
  max-height: calc(100% - 140px);
  display: flex;
  flex-direction: column;
  background: rgba(20, 24, 31, 0.94);
  color: #e8eaed;
  border: 1px solid #2c323c;
  border-radius: 8px;
  font:
    13px/1.35 system-ui,
    sans-serif;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px;
  border-bottom: 1px solid #2c323c;
}
nav {
  display: flex;
  gap: 4px;
}
.body {
  overflow-y: auto;
  padding: 8px;
}
button {
  background: #2c323c;
  color: inherit;
  border: 1px solid #3b4250;
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
  font: inherit;
}
button:hover:not(:disabled) {
  background: #363d49;
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
button.active {
  background: #2563eb;
  border-color: #2563eb;
}
button.danger {
  margin-top: 8px;
  border-color: #7f1d1d;
}
.toggle {
  padding: 2px 8px;
}
.empty,
.meta {
  color: #9aa3af;
}
.orders,
.group {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 8px;
  align-items: center;
}
.label {
  width: 100%;
  color: #9aa3af;
  font-size: 12px;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.units li,
.armies li {
  padding: 6px 8px;
  border-radius: 6px;
  margin-bottom: 4px;
  background: #1b2028;
}
.armies li {
  cursor: pointer;
  display: flex;
  flex-direction: column;
}
.armies li.active {
  outline: 1px solid #2563eb;
}
.name {
  font-weight: 600;
}
.bars {
  display: flex;
  gap: 12px;
  font-variant-numeric: tabular-nums;
}
.status.warn {
  color: #fca5a5;
}
.create {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}
input,
select {
  background: #11151b;
  border: 1px solid #3b4250;
  border-radius: 6px;
  color: inherit;
  padding: 5px 8px;
  font: inherit;
}
h3 {
  margin: 12px 0 2px;
  font-size: 14px;
}
/* Les onglets (production, diplomatie…) partagent le style des boutons du panneau. */
.panel :deep(button) {
  background: #2c323c;
  color: inherit;
  border: 1px solid #3b4250;
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
  font: inherit;
}
.panel :deep(button:hover:not(:disabled)) {
  background: #363d49;
}
.panel :deep(button:disabled) {
  opacity: 0.45;
  cursor: default;
}
.panel :deep(button.active) {
  background: #2563eb;
  border-color: #2563eb;
}
.panel :deep(button.danger) {
  border-color: #7f1d1d;
}
.count {
  display: inline-block;
  min-width: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.12);
  font-size: 11px;
  text-align: center;
}
/* Cibles tactiles plus grandes. */
.panel.touch :deep(button) {
  min-height: 36px;
  padding: 6px 10px;
}
.panel.touch {
  font-size: 14px;
}

/* ---------- Téléphone en portrait : tiroir en bas ---------- */
.panel.drawer {
  top: auto;
  left: 0;
  right: 0;
  bottom: 0;
  width: auto;
  max-height: none;
  border-radius: 14px 14px 0 0;
  border-bottom: none;
  padding-bottom: env(safe-area-inset-bottom);
  transition: height 0.2s ease;
}
.panel.drawer.dragging {
  transition: none;
}
.panel.drawer-half {
  height: 48dvh;
}
.panel.drawer-full {
  height: calc(100dvh - 52px);
}
.panel.drawer header {
  padding-top: 0;
}
.panel.drawer nav {
  overflow-x: auto;
  scrollbar-width: none;
  flex-wrap: nowrap;
}
.panel.drawer nav button {
  flex: none;
  padding: 6px 8px;
}
.panel.drawer .body {
  flex: 1;
  min-height: 0;
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

/* ---------- Téléphone couché : panneau sur le côté ---------- */
.panel.side {
  top: 48px;
  right: 6px;
  bottom: 6px;
  width: min(320px, 46vw);
  max-height: none;
}
.panel.side.collapsed {
  bottom: auto;
}
.panel.side nav {
  flex-wrap: wrap;
}
</style>
