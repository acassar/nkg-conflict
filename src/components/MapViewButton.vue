<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import { layout } from '@/composables/layout'
import { FORT_RADIUS_KM } from '@/sim/economy/rules'
import { fortBonusPct } from '@/sim/economy/forts'

const game = useGameStore()

/** Position : à côté du bouton de sélection par zone (voir LassoButton). */
const style = computed(() => {
  if (layout.value === 'portrait') return { left: '62px', bottom: `${game.drawerHeight + 10}px` }
  if (layout.value === 'landscape') return { left: '62px', bottom: '10px' }
  return { right: '104px', bottom: '10px' }
})

/**
 * Légende : au-dessus des boutons sur téléphone ; sur ordinateur en haut à gauche, à droite du rail
 * et du tiroir ouvert.
 */
const legendStyle = computed(() => {
  if (layout.value === 'portrait') return { left: '10px', bottom: `${game.drawerHeight + 62}px` }
  if (layout.value === 'landscape') return { left: '10px', bottom: '62px' }
  return { left: game.panelTab ? '440px' : '98px', top: '60px' }
})

/** Bouton du filtre « Pays », juste avant celui de la logistique. */
const countriesStyle = computed(() => {
  if (layout.value === 'portrait') return { left: '114px', bottom: `${game.drawerHeight + 10}px` }
  if (layout.value === 'landscape') return { left: '114px', bottom: '10px' }
  return { right: '156px', bottom: '10px' }
})

const active = computed(() => game.mapView === 'logistics')
const countries = computed(() => game.mapView === 'countries')
const view = computed(() => game.supply?.view ?? null)
const pockets = computed(() => view.value?.pockets.length ?? 0)

function toggle(): void {
  game.setMapView(active.value ? 'political' : 'logistics')
}

function toggleCountries(): void {
  game.setMapView(countries.value ? 'political' : 'countries')
}
</script>

<template>
  <template v-if="!(layout === 'portrait' && game.drawer === 'full')">
    <button
      class="mode"
      :class="{ active, desk: layout === 'desktop' }"
      :style="style"
      :aria-pressed="active"
      title="Carte logistique : ravitaillement, portée des dépôts et des QG, poches (L)"
      aria-label="Carte logistique"
      data-testid="logistics-button"
      @click="toggle"
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path
          d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linejoin="round"
        />
        <circle cx="7" cy="17.5" r="1.8" fill="currentColor" />
        <circle cx="17" cy="17.5" r="1.8" fill="currentColor" />
      </svg>
    </button>
    <button
      class="mode"
      :class="{ active: countries, desk: layout === 'desktop' }"
      :style="countriesStyle"
      :aria-pressed="countries"
      title="Filtre « Pays » : une teinte par pays (P)"
      aria-label="Filtre Pays"
      data-testid="countries-button"
      @click="toggleCountries"
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path
          d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14 M15 6v14"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linejoin="round"
        />
      </svg>
    </button>
    <div
      v-if="countries"
      class="legend"
      :class="{ desk: layout === 'desktop' }"
      :style="legendStyle"
      data-testid="countries-legend"
    >
      <strong>Pays</strong>
      <p class="note">Une teinte par pays ; deux voisins n'ont jamais la même.</p>
      <ul>
        <li><span class="line border" />Frontière</li>
        <li><span class="line border-war" />Frontière entre pays en guerre</li>
      </ul>
    </div>
    <div
      v-if="active"
      class="legend"
      :class="{ desk: layout === 'desktop' }"
      :style="legendStyle"
      data-testid="logistics-legend"
    >
      <strong>Logistique</strong>
      <p v-if="view && !view.atWar" class="peace">En paix : tout le territoire est ravitaillé.</p>
      <ul>
        <li><span class="sw ok" />Territoire relié aux sources</li>
        <li><span class="sw cut" />Coupé (île, enclave)</li>
        <li>
          <span class="sw pocket" />Poche
          <template v-if="pockets"> ({{ pockets }})</template>
        </li>
        <li><span class="ring source" />Source : capitale, grande ville, dépôt (30 km)</li>
        <li><span class="ring logi" />Unité logistique (60 km)</li>
        <li><span class="ring hq" />QG : commandement (120 km)</li>
        <li>
          <span class="ring fort" />Fortifications : +{{ fortBonusPct(1) }} % de défense par niveau
          ({{ FORT_RADIUS_KM }}
          km)
        </li>
      </ul>
      <label class="roads-toggle">
        <!-- Focus rendu à la page : les raccourcis clavier (L, espace) restent actifs. -->
        <input
          v-model="game.showRoads"
          type="checkbox"
          data-testid="roads-toggle"
          @change="($event.target as HTMLInputElement).blur()"
        />
        Routes et voies ferrées
      </label>
      <ul v-if="game.showRoads" data-testid="roads-legend">
        <li><span class="sw major" />Grand axe (autoroute, voie rapide)</li>
        <li><span class="sw road" />Route principale</li>
        <li><span class="sw rail" />Voie ferrée</li>
      </ul>
    </div>
  </template>
</template>

<style scoped>
.mode {
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
.mode.active {
  background: #22c55e;
  border-color: #22c55e;
  color: #052e16;
}
.legend {
  position: absolute;
  z-index: 12;
  max-width: 250px;
  padding: 8px 10px;
  background: rgba(20, 24, 31, 0.92);
  color: #e8eaed;
  border: 1px solid #3b4250;
  border-radius: 8px;
  font:
    12px/1.35 system-ui,
    sans-serif;
  transition: bottom 0.2s ease;
}
.legend ul {
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}
.legend li {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}
.peace {
  margin: 4px 0 0;
  color: #86efac;
}
.note {
  margin: 4px 0 0;
}
.line {
  flex: none;
  width: 14px;
  background: #e8eaed;
}
.line.border {
  height: 1px;
}
.line.border-war {
  height: 3px;
}
.sw,
.ring {
  flex: none;
  width: 14px;
  height: 14px;
  border-radius: 3px;
}
.sw.ok {
  background: rgba(34, 197, 94, 0.55);
}
.sw.cut {
  background: repeating-linear-gradient(
    45deg,
    rgba(234, 88, 12, 0.9) 0 3px,
    rgba(234, 88, 12, 0.35) 3px 6px
  );
}
.sw.pocket {
  background: repeating-linear-gradient(
    45deg,
    rgba(185, 28, 28, 0.95) 0 3px,
    rgba(220, 38, 38, 0.5) 3px 6px
  );
}
.sw.major {
  background: rgb(250, 204, 21);
}
.sw.road {
  background: rgba(250, 245, 225, 0.75);
}
.sw.rail {
  background: rgb(30, 27, 75);
  border: 1px solid #6b7280;
}
.roads-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  cursor: pointer;
}
.roads-toggle input {
  margin: 0;
}
.ring {
  border-radius: 50%;
  border: 2px solid;
}
.ring.source {
  border-color: #15803d;
  background: rgba(22, 163, 74, 0.3);
}
.ring.logi {
  border-color: #2563eb;
  background: rgba(59, 130, 246, 0.25);
}
.ring.hq {
  border-color: #ca8a04;
}
.ring.fort {
  border-color: #475569;
  background: rgba(71, 85, 105, 0.35);
}

/* Grand écran : charte (docs/charte.md). */
.mode.desk {
  width: 44px;
  background: var(--nkg-panel-bg);
  color: var(--nkg-text-soft);
  border-color: var(--nkg-brass-dark);
  border-radius: 4px;
  box-shadow:
    0 0 0 2px #10141a,
    0 6px 16px rgba(0, 0, 0, 0.45);
}
.mode.desk:hover {
  color: var(--nkg-text);
  border-color: var(--nkg-brass);
}
.mode.desk.active {
  background: var(--nkg-tile-on-bg);
  border-color: var(--nkg-brass-light);
  color: var(--nkg-brass-pale);
}
.legend.desk {
  background: var(--nkg-panel-bg);
  color: var(--nkg-text);
  border-color: var(--nkg-brass-dark);
  border-radius: 4px;
  box-shadow: var(--nkg-panel-shadow);
  font-family: var(--nkg-sans);
}
</style>
