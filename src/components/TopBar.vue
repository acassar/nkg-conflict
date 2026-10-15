<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGameStore } from '@/stores/game'
import { STANCE_COLORS } from '@/map/territoryImage'
import { isMobile } from '@/composables/layout'
import { openHelp } from '@/composables/help'
import { useGauges } from '@/composables/useGauges'
import type { GaugeId } from '@/composables/gauges'
import NkgIcon, { type IconName } from './NkgIcon.vue'

const game = useGameStore()
const gauges = useGauges()

/** Ouvre la fenêtre de détail d'une jauge ; un second clic la ferme. */
function toggleGauge(id: GaugeId): void {
  game.gaugeOpen = game.gaugeOpen === id ? null : id
}

const held = computed(() => {
  const s = game.snapshot
  const v = s?.territoryHeld[s.playerCountry]
  return v === undefined
    ? null
    : (v * 100).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
})
/** Le joueur est-il dans une guerre en cours ? */
const atWar = computed(() => {
  const s = game.snapshot
  if (!s) return false
  return s.politics.wars.some(
    (w) => w.attackers.includes(s.playerCountry) || w.defenders.includes(s.playerCountry),
  )
})

/** Icône de chaque jauge, et regroupement : économie (industrie), armée (le reste). */
const GAUGE_ICONS: Record<GaugeId, IconName> = {
  industry: 'factory',
  munitions: 'shell',
  manpower: 'person',
  army: 'shield',
}
const groups = computed(() => {
  const all = gauges.value ?? []
  return [
    { name: 'Économie', gauges: all.filter((g) => g.id === 'industry') },
    { name: 'Armée', gauges: all.filter((g) => g.id !== 'industry') },
  ]
})
const fileInput = ref<HTMLInputElement | null>(null)
const pctOf = (v: number): string => `${Math.round(v * 100)} %`

function openCountry(): void {
  game.openDomain('country')
}

function quit(): void {
  if (confirm('Revenir au menu ? La partie est sauvegardée automatiquement.')) {
    void game.quitToMenu()
  }
}
const speeds = [1, 2, 3, 4, 5] as const
const menuOpen = ref(false)
/** Barre compacte : un seul bouton fait défiler les vitesses. */
function nextSpeed(): void {
  void game.setSpeed((game.speed % 5) + 1)
}
/** Date courte pour la barre compacte (« 25 janv. 2026 · 11 h »). */
const shortDate = computed(() => game.dateLabel.replace(/, (\d\d):00$/, ' · $1 h'))
function menuAction(fn: () => unknown): void {
  menuOpen.value = false
  void fn()
}

async function onFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    await game.loadFromFile(file)
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err))
  } finally {
    input.value = ''
  }
}
</script>

<template>
  <header class="topbar" :class="{ compact: isMobile }">
    <template v-if="!isMobile">
      <button
        class="country"
        title="Diplomatie de votre pays"
        data-testid="topbar-country"
        @click="openCountry"
      >
        <span
          v-if="game.playerCountry"
          class="flag"
          :style="{ background: `rgb(${STANCE_COLORS.player.join(',')})` }"
        />
        <span class="who">
          <span class="name">{{ game.playerCountry?.name ?? '…' }}</span>
          <span class="sub">
            {{ atWar ? 'En guerre' : 'En paix' }}
            <template v-if="held !== null">
              · <span title="Part du territoire de départ conservée">territoire {{ held }} %</span>
            </template>
          </span>
        </span>
      </button>
      <span class="sep" aria-hidden="true" />

      <div v-if="gauges" class="resources" data-testid="gauges">
        <div v-for="grp in groups" :key="grp.name" class="group" :aria-label="grp.name">
          <button
            v-for="g in grp.gauges"
            :key="g.id"
            class="res"
            :class="[g.level, { open: game.gaugeOpen === g.id }]"
            :title="g.title"
            :aria-expanded="game.gaugeOpen === g.id"
            :data-testid="g.id === 'army' ? 'sustain' : `gauge-${g.id}`"
            @click="toggleGauge(g.id)"
          >
            <NkgIcon :name="GAUGE_ICONS[g.id]" class="ricon" />
            <span class="rlabel">{{ g.label }}</span>
            <span class="rvalue">{{ g.value }}</span>
            <span v-if="g.trend" class="delta">{{ g.trend }}</span>
          </button>
        </div>
      </div>
      <button
        v-if="game.playerPolitics"
        class="res gauge"
        :title="`Stabilité ${pctOf(game.playerPolitics.stability)} · soutien à la guerre ${pctOf(game.playerPolitics.warSupport)} (diplomatie)`"
        @click="openCountry"
      >
        <NkgIcon name="flag" class="ricon" />
        <span class="rlabel">Soutien</span>
        <span class="rvalue">{{ pctOf(game.playerPolitics.warSupport) }}</span>
      </button>

      <div class="right">
        <div class="time">
          <button
            class="pause"
            :aria-label="game.paused ? 'Reprendre' : 'Pause'"
            @click="game.togglePause()"
          >
            <svg v-if="game.paused" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 4l13 8-13 8z" />
            </svg>
            <svg v-else width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
            </svg>
          </button>
          <span class="date" :class="{ paused: game.paused }">{{ game.dateLabel }}</span>
          <div class="speeds" role="group" aria-label="Vitesse">
            <button
              v-for="s in speeds"
              :key="s"
              :class="{ active: game.speed >= s }"
              :aria-pressed="game.speed === s"
              :aria-label="`Vitesse ${s}`"
              :title="`Vitesse ${s}`"
              @click="game.setSpeed(s)"
            >
              <span :style="{ height: `${5 + s * 3}px` }" />
            </button>
          </div>
          <button class="step" title="Avancer d'un jour (tour par tour)" @click="game.step(24)">
            +24 h
          </button>
        </div>

        <div class="files">
          <button
            class="icon-btn menu-btn"
            :aria-expanded="menuOpen"
            aria-label="Menu"
            data-testid="menu-button"
            @click="menuOpen = !menuOpen"
          >
            <NkgIcon name="menu" />
          </button>
          <div v-if="menuOpen" class="menu" role="menu">
            <div class="menu-actions">
              <button @click="menuAction(() => game.saveLocal())">Sauver</button>
              <button @click="menuAction(game.exportToFile)">Exporter</button>
              <button @click="menuAction(() => fileInput?.click())">Importer</button>
              <button data-testid="menu-help" @click="menuAction(() => openHelp())">Aide</button>
              <button @click="menuAction(quit)">Menu principal</button>
            </div>
          </div>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="country">
        <span
          class="flag"
          :style="{ background: `rgb(${STANCE_COLORS.player.join(',')})` }"
          :title="game.playerCountry?.name"
        />
        <span v-if="held !== null" class="held">{{ held }} %</span>
      </div>
      <div class="time">
        <button
          class="pause"
          :aria-label="game.paused ? 'Reprendre' : 'Pause'"
          @click="game.togglePause()"
        >
          {{ game.paused ? '▶' : '❚❚' }}
        </button>
        <span class="date" :class="{ paused: game.paused }">{{ shortDate }}</span>
        <button class="speed" aria-label="Vitesse suivante" @click="nextSpeed">
          ×{{ game.speed }}
        </button>
      </div>
      <button
        class="menu-btn"
        :aria-expanded="menuOpen"
        aria-label="Menu"
        data-testid="menu-button"
        @click="menuOpen = !menuOpen"
      >
        ☰
      </button>
      <div v-if="menuOpen" class="menu" role="menu">
        <div class="menu-country">{{ game.playerCountry?.name }}</div>
        <div v-if="gauges" class="menu-gauges">
          <button
            v-for="g in gauges"
            :key="g.id"
            class="menu-gauge"
            :class="g.level"
            :data-testid="g.id === 'army' ? 'sustain-mobile' : `gauge-${g.id}-mobile`"
            @click="menuAction(() => (game.gaugeOpen = g.id))"
          >
            <span class="rlabel">{{ g.label }}</span>
            <span class="rvalue">
              {{ g.value }} <span v-if="g.trend" class="delta">{{ g.trend }}</span>
            </span>
          </button>
        </div>
        <dl v-if="game.playerPolitics" class="menu-resources">
          <dt>Stabilité</dt>
          <dd>{{ pctOf(game.playerPolitics.stability) }}</dd>
          <dt>Soutien à la guerre</dt>
          <dd>{{ pctOf(game.playerPolitics.warSupport) }}</dd>
        </dl>
        <div class="menu-actions">
          <button @click="menuAction(() => game.step(24))">+24 h</button>
          <button @click="menuAction(openCountry)">Diplomatie</button>
          <button @click="menuAction(() => game.saveLocal())">Sauver</button>
          <button @click="menuAction(game.exportToFile)">Exporter</button>
          <button @click="menuAction(() => fileInput?.click())">Importer</button>
          <button data-testid="menu-help" @click="menuAction(() => openHelp())">Aide</button>
          <button @click="menuAction(quit)">Menu principal</button>
        </div>
      </div>
    </template>
    <input ref="fileInput" type="file" accept="application/json" hidden @change="onFile" />
  </header>
</template>

<style scoped>
/* ---------- Téléphone : barre compacte (inchangée) ---------- */
.topbar.compact {
  padding: calc(6px + env(safe-area-inset-top)) 8px 6px;
  gap: 8px;
  flex-wrap: nowrap;
  background: rgba(20, 24, 31, 0.92);
  color: #e8eaed;
  font:
    14px/1.2 system-ui,
    sans-serif;
  border-bottom: 1px solid #2c323c;
}
.compact .country {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}
.compact .time {
  display: flex;
  align-items: center;
  gap: 6px;
}
.compact .date {
  min-width: 0;
  font-size: 13px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.compact .date.paused {
  color: #f2b84b;
}
.compact .flag {
  width: 14px;
  height: 14px;
  border-radius: 3px;
}
.compact .held {
  font-weight: 400;
  color: #b8bec8;
  font-variant-numeric: tabular-nums;
}
.compact button {
  background: #2c323c;
  color: inherit;
  border: 1px solid #3b4250;
  border-radius: 6px;
  padding: 6px 10px;
  cursor: pointer;
  font: inherit;
}
.compact button:hover {
  background: #363d49;
}
.compact .speed {
  min-width: 42px;
}
.compact .menu-btn {
  font-size: 16px;
}
.compact .menu {
  background: #14181f;
  border: 1px solid #2c323c;
  border-radius: 8px;
}
.menu-country {
  font-weight: 600;
  margin-bottom: 6px;
}
.menu-resources {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
  margin: 0 0 10px;
  font-variant-numeric: tabular-nums;
}
.menu-resources dt {
  color: #9aa3af;
}
.menu-resources dd {
  margin: 0;
}
.menu-gauges {
  display: grid;
  gap: 4px;
  margin-bottom: 8px;
}
.menu-gauge {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border-bottom-width: 2px;
  text-align: left;
}
.menu-gauge .rlabel,
.menu-gauge .delta {
  color: #9aa3af;
}
.menu-gauge.ok {
  border-bottom-color: #22c55e;
}
.menu-gauge.warning {
  border-bottom-color: #f2a33a;
}
.menu-gauge.critical {
  border-bottom-color: #ef4444;
}
.menu-gauge.warning .rvalue {
  color: #f2a33a;
}
.menu-gauge.critical .rvalue {
  color: #fca5a5;
}

/* ---------- Commun ---------- */
.topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  /* Au-dessus du panneau : le menu déroulant doit rester accessible. */
  z-index: 15;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.topbar * {
  white-space: nowrap;
}
.menu {
  position: absolute;
  top: 100%;
  right: 8px;
  margin-top: 4px;
  width: min(300px, calc(100vw - 16px));
  padding: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.menu-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

/* ---------- Grand écran (charte : docs/charte.md) ---------- */
.topbar:not(.compact) {
  height: 52px;
  box-sizing: border-box;
  gap: 14px;
  padding: 0 12px 0 10px;
  background: linear-gradient(180deg, #1c232d, #12171d);
  color: var(--nkg-text);
  border-bottom: 1px solid var(--nkg-brass-dark);
  box-shadow:
    0 1px 0 #10141a,
    0 6px 18px rgba(0, 0, 0, 0.45);
  font: 13px/1.2 var(--nkg-sans);
  justify-content: flex-start;
}
.topbar:not(.compact) button {
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.topbar:not(.compact) .country {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 6px;
  background: none;
  border: none;
  border-radius: 4px;
}
.topbar:not(.compact) .country:hover {
  background: rgba(255, 255, 255, 0.04);
}
.topbar:not(.compact) .flag {
  width: 30px;
  height: 20px;
  border: 1px solid var(--nkg-brass);
}
.who {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
  text-align: left;
}
.who .name {
  font: 600 17px/1.15 var(--nkg-serif);
}
.who .sub {
  font-size: 11px;
  color: #a99a7a;
  font-variant-numeric: tabular-nums;
}
.sep {
  width: 1px;
  height: 30px;
  background: var(--nkg-brass-line);
}
.resources {
  display: flex;
  gap: 12px;
  font-variant-numeric: tabular-nums;
}
.group {
  display: flex;
  gap: 4px;
}
/* Jauge : icône, valeur, tendance ; liseré bas de couleur d'état (vert, ambre, rouge). */
.res {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 36px;
  box-sizing: border-box;
  padding: 0 10px;
  background: var(--nkg-chip);
  border: 1px solid #2e3540;
  border-bottom: 2px solid #2e3540;
  border-radius: 4px;
}
.res .ricon {
  color: var(--nkg-brass-light);
}
.res .rlabel {
  color: var(--nkg-text-muted);
  font-size: 12px;
}
.res .rvalue {
  font-weight: 600;
  font-size: 13px;
}
.res .delta {
  font-size: 11px;
  color: var(--nkg-text-faint);
}
.res.ok {
  border-bottom-color: var(--nkg-good);
}
.res.warning {
  border-bottom-color: var(--nkg-warn);
}
.res.critical {
  border-bottom-color: var(--nkg-bad);
}
.res.warning .rvalue {
  color: var(--nkg-warn-text);
}
.res.critical .rvalue {
  color: var(--nkg-bad-text);
}
.res:hover,
.res.open {
  border-color: var(--nkg-brass-dark);
  background: #1d1a15;
}
.right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}
/* Cartouche du temps : lecture, date, vitesse en barres croissantes, pas d'un jour. */
.topbar:not(.compact) .time {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 38px;
  box-sizing: border-box;
  padding: 0 4px 0 3px;
  background: #14110c;
  border: 1px solid var(--nkg-brass-dark);
  border-radius: 4px;
}
.topbar:not(.compact) .pause {
  width: 32px;
  height: 30px;
  display: grid;
  place-items: center;
  background: #2a2418;
  border: none;
  border-radius: 3px;
}
.pause svg {
  fill: var(--nkg-brass-light);
}
.topbar:not(.compact) .date {
  min-width: 170px;
  text-align: center;
  font: 15px/1 var(--nkg-serif);
  color: var(--nkg-brass-pale);
  font-variant-numeric: tabular-nums;
}
.topbar:not(.compact) .date.paused {
  color: var(--nkg-warn-text);
}
.speeds {
  display: flex;
  align-items: flex-end;
  height: 26px;
  padding: 0 2px;
}
.topbar:not(.compact) .speeds button {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  width: 10px;
  height: 26px;
  padding: 0 0 3px;
  background: none;
  border: none;
}
.speeds button span {
  display: block;
  width: 5px;
  border-radius: 1px;
  background: var(--nkg-brass-deep);
}
.speeds button.active span {
  background: var(--nkg-brass-light);
}
.speeds button:hover span {
  background: var(--nkg-brass-pale);
}
.topbar:not(.compact) .step {
  height: 28px;
  padding: 0 8px;
  background: none;
  border: 1px solid transparent;
  border-left-color: var(--nkg-brass-line);
  border-radius: 0 3px 3px 0;
  color: #a99a7a;
  font-size: 12px;
}
.topbar:not(.compact) .step:hover {
  color: var(--nkg-brass-pale);
}
.files {
  display: flex;
  align-items: center;
  gap: 6px;
}
.topbar:not(.compact) .icon-btn {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  padding: 0;
  background: var(--nkg-chip);
  border: 1px solid #2e3540;
  border-radius: 4px;
  color: var(--nkg-text-soft);
}
.topbar:not(.compact) .icon-btn:hover {
  border-color: var(--nkg-brass-dark);
}
.topbar:not(.compact) .menu {
  background: var(--nkg-panel-bg);
  border: 1px solid var(--nkg-brass-dark);
  border-radius: 4px;
  box-shadow: var(--nkg-panel-shadow);
}
.topbar:not(.compact) .menu-actions button {
  height: 34px;
  background: var(--nkg-tile-bg);
  border: 1px solid var(--nkg-line-strong);
  border-radius: 4px;
}
.topbar:not(.compact) .menu-actions button:hover {
  border-color: var(--nkg-brass);
}
/* Écrans moyens : on retire d'abord les libellés, puis les tendances, puis le soutien. */
@media (max-width: 1480px) {
  .res .rlabel {
    display: none;
  }
}
@media (max-width: 1280px) {
  .res .delta,
  .res.gauge,
  .topbar:not(.compact) .step {
    display: none;
  }
}
@media (max-width: 1080px) {
  .resources {
    display: none;
  }
}
</style>
