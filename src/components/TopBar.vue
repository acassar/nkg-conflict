<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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

// Le menu est une fenêtre « En pause » qui arrête le temps et le relance en partant.
let resumeOnClose = false
watch(menuOpen, (open) => {
  if (open) {
    resumeOnClose = !game.paused
    if (resumeOnClose) void game.togglePause()
  } else if (resumeOnClose) {
    resumeOnClose = false
    if (game.paused && game.snapshot) void game.togglePause()
  }
})
function quitFromPause(): void {
  if (!confirm('Revenir au menu ? La partie est sauvegardée automatiquement.')) return
  resumeOnClose = false
  menuOpen.value = false
  void game.quitToMenu()
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && menuOpen.value) menuOpen.value = false
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

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
            class="icon-btn bell"
            :class="{ on: game.alerts.length && !game.alertsFolded }"
            :disabled="!game.alerts.length"
            :aria-label="`Alertes : ${game.alerts.length}`"
            :aria-pressed="game.alerts.length > 0 && !game.alertsFolded"
            :title="
              game.alerts.length
                ? game.alertsFolded
                  ? 'Afficher les alertes'
                  : 'Masquer les alertes'
                : 'Aucune alerte'
            "
            data-testid="alerts-bell"
            @click="game.alertsFolded = !game.alertsFolded"
          >
            <NkgIcon name="bell" />
            <span v-if="game.alerts.length" class="badge">{{ game.alerts.length }}</span>
          </button>
          <button
            class="icon-btn menu-btn"
            :aria-expanded="menuOpen"
            aria-label="Menu"
            data-testid="menu-button"
            @click="menuOpen = !menuOpen"
          >
            <NkgIcon name="menu" />
          </button>
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
          <svg v-if="game.paused" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 4l13 8-13 8z" />
          </svg>
          <svg v-else width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
          </svg>
        </button>
        <span class="date" :class="{ paused: game.paused }">{{ shortDate }}</span>
        <button class="speed" aria-label="Vitesse suivante" @click="nextSpeed">
          ×{{ game.speed }}
        </button>
      </div>
      <button
        class="icon-btn menu-btn"
        :aria-expanded="menuOpen"
        aria-label="Menu"
        data-testid="menu-button"
        @click="menuOpen = !menuOpen"
      >
        <NkgIcon name="menu" />
      </button>
    </template>
    <div v-if="menuOpen" class="pause-veil" @click.self="menuOpen = false">
      <div class="pause-menu" role="dialog" aria-label="Menu" data-testid="pause-menu">
        <h2>En pause</h2>
        <p class="pause-sub">{{ game.playerCountry?.name }} · {{ game.dateLabel }}</p>
        <!-- Téléphone : les jauges de la barre du haut, faute de place, sont ici. -->
        <div v-if="isMobile && gauges" class="menu-gauges">
          <button
            v-for="g in gauges"
            :key="g.id"
            class="menu-gauge"
            :class="g.level"
            :data-testid="g.id === 'army' ? 'sustain-mobile' : `gauge-${g.id}-mobile`"
            @click="menuAction(() => (game.gaugeOpen = g.id))"
          >
            <NkgIcon :name="GAUGE_ICONS[g.id]" :size="14" class="ricon" />
            <span class="rlabel">{{ g.label }}</span>
            <span class="rvalue">
              {{ g.value }} <span v-if="g.trend" class="delta">{{ g.trend }}</span>
            </span>
          </button>
          <button v-if="game.playerPolitics" class="menu-gauge" @click="menuAction(openCountry)">
            <NkgIcon name="flag" :size="14" class="ricon" />
            <span class="rlabel">Stabilité · soutien</span>
            <span class="rvalue"
              >{{ pctOf(game.playerPolitics.stability) }} ·
              {{ pctOf(game.playerPolitics.warSupport) }}</span
            >
          </button>
        </div>
        <button class="mi gold" @click="menuOpen = false">Reprendre</button>
        <button v-if="isMobile" class="mi" @click="menuAction(() => game.step(24))">
          Avancer d'un jour
        </button>
        <button class="mi" @click="menuAction(() => game.saveLocal())">Sauvegarder</button>
        <button class="mi" @click="menuAction(() => fileInput?.click())">
          Importer une partie
        </button>
        <button class="mi" @click="menuAction(game.exportToFile)">Exporter la partie</button>
        <button class="mi" data-testid="menu-help" @click="menuAction(() => openHelp())">
          Règles du jeu
        </button>
        <div class="pause-rule" />
        <button class="mi quit" @click="quitFromPause">Quitter vers l'écran de départ</button>
      </div>
    </div>
    <input ref="fileInput" type="file" accept="application/json" hidden @change="onFile" />
  </header>
</template>

<style scoped>
/* ---------- Téléphone : barre compacte, à la charte ---------- */
.topbar.compact {
  padding: calc(6px + env(safe-area-inset-top)) 8px 6px;
  gap: 8px;
  flex-wrap: nowrap;
  background: linear-gradient(180deg, #1c232d, #12171d);
  color: var(--nkg-text);
  font: 14px/1.2 var(--nkg-sans);
  border-bottom: 1px solid var(--nkg-brass-dark);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
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
  gap: 4px;
  padding: 2px;
  background: #14110c;
  border: 1px solid var(--nkg-brass-dark);
  border-radius: 4px;
}
.compact .date {
  min-width: 0;
  padding: 0 4px;
  font: 14px/1 var(--nkg-serif);
  color: var(--nkg-brass-pale);
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.compact .date.paused {
  color: var(--nkg-warn-text);
}
.compact .flag {
  width: 22px;
  height: 15px;
  border: 1px solid var(--nkg-brass);
}
.compact .held {
  font-weight: 400;
  color: #a99a7a;
  font-variant-numeric: tabular-nums;
}
.compact button {
  color: inherit;
  cursor: pointer;
  font: inherit;
}
.compact .pause,
.compact .speed {
  min-width: 34px;
  height: 30px;
  display: grid;
  place-items: center;
  padding: 0 6px;
  background: #2a2418;
  border: none;
  border-radius: 3px;
  color: var(--nkg-brass-light);
}
.compact .icon-btn {
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
.menu-gauges {
  display: grid;
  gap: 4px;
  margin-bottom: 4px;
}
.menu-gauge {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 10px;
  background: var(--nkg-chip);
  color: inherit;
  border: 1px solid #2e3540;
  border-bottom: 2px solid #2e3540;
  border-radius: 4px;
  font: inherit;
  font-variant-numeric: tabular-nums;
  text-align: left;
  cursor: pointer;
}
.menu-gauge .ricon {
  color: var(--nkg-brass-light);
}
.menu-gauge .rlabel {
  flex: 1;
  color: var(--nkg-text-muted);
}
.menu-gauge .rvalue {
  font-weight: 600;
}
.menu-gauge .delta {
  font-weight: 400;
  color: var(--nkg-text-faint);
}
.menu-gauge.ok {
  border-bottom-color: var(--nkg-good);
}
.menu-gauge.warning {
  border-bottom-color: var(--nkg-warn);
}
.menu-gauge.critical {
  border-bottom-color: var(--nkg-bad);
}
.menu-gauge.warning .rvalue {
  color: var(--nkg-warn-text);
}
.menu-gauge.critical .rvalue {
  color: var(--nkg-bad-text);
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
/* Cloche des alertes. */
.topbar:not(.compact) .files {
  display: flex;
  gap: 8px;
}
.bell {
  position: relative;
}
.topbar:not(.compact) .bell:disabled {
  opacity: 0.5;
  cursor: default;
}
.topbar:not(.compact) .bell.on {
  border-color: var(--nkg-brass-dark);
  color: var(--nkg-brass-light);
}
.bell .badge {
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  box-sizing: border-box;
  border-radius: 9px;
  background: #d9822b;
  color: #14110c;
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}
/* Fenêtre « En pause ». */
.pause-veil {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  background: rgba(8, 10, 14, 0.6);
}
.pause-menu {
  width: min(340px, calc(100vw - 24px));
  max-height: calc(100dvh - 24px);
  overflow: auto;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 24px;
  background: var(--nkg-panel-bg);
  border: 1px solid var(--nkg-brass-dark);
  border-radius: 4px;
  box-shadow: var(--nkg-panel-shadow);
}
.pause-menu h2 {
  margin: 0;
  font-family: var(--nkg-serif);
  font-size: 26px;
  font-weight: 600;
  text-align: center;
  color: var(--nkg-brass-pale);
}
.pause-sub {
  margin: -6px 0 8px;
  text-align: center;
  font-size: 12.5px;
  color: #a99a7a;
}
.topbar .pause-menu .mi {
  height: 40px;
  padding: 0 14px;
  background: var(--nkg-tile-bg);
  border: 1px solid var(--nkg-line-strong);
  border-radius: 4px;
  color: var(--nkg-text);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.topbar .pause-menu .mi:hover {
  border-color: var(--nkg-brass);
}
.topbar .pause-menu .mi.gold {
  background: var(--nkg-gold-bg);
  border-color: var(--nkg-brass-pale);
  color: #1a140a;
  font-weight: 600;
}
.topbar .pause-menu .mi.quit {
  color: #f0b0a5;
}
.pause-rule {
  height: 1px;
  margin: 6px 0;
  background: var(--nkg-divider);
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
