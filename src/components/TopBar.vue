<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGameStore } from '@/stores/game'
import { STANCE_COLORS } from '@/map/territoryImage'
import { isMobile } from '@/composables/layout'

const game = useGameStore()
const fmt = (v: number): string => Math.round(v).toLocaleString('fr-FR')
const resources = computed(() => {
  const e = game.snapshot?.economy
  if (!e) return null
  return [
    {
      label: 'Production',
      value: fmt(e.production),
      delta: `+${fmt(e.daily.production)}/j`,
      title: 'Production militaire : formations et renforts',
      low: false,
    },
    {
      label: 'Munitions',
      value: fmt(e.munitions),
      delta: `+${fmt(e.daily.munitions)}/j`,
      title: 'Munitions : à zéro, la puissance de feu est divisée par deux',
      low: e.munitions < 200,
    },
    {
      label: "Main-d'œuvre",
      value: `${fmt(e.manpower)} k`,
      delta: `+${e.daily.manpower.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k/j`,
      title: "Main-d'œuvre disponible, en milliers d'hommes",
      low: e.manpower < 5,
    },
    {
      label: 'Construction',
      value: `${fmt(e.daily.construction)}/j`,
      delta: '',
      title: 'Points de construction par jour (usines civiles)',
      low: false,
    },
  ]
})
const held = computed(() => {
  const s = game.snapshot
  const v = s?.territoryHeld[s.playerCountry]
  return v === undefined
    ? null
    : (v * 100).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
})
const fileInput = ref<HTMLInputElement | null>(null)
const pctOf = (v: number): string => `${Math.round(v * 100)} %`

function openCountry(): void {
  game.selectCountry(null)
  game.panelTab = 'country'
}

function quit(): void {
  if (confirm('Revenir au menu ? Pensez à sauvegarder la partie en cours.')) game.quitToMenu()
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
      <div class="country">
        <span
          v-if="game.playerCountry"
          class="flag"
          :style="{ background: `rgb(${STANCE_COLORS.player.join(',')})` }"
        />
        {{ game.playerCountry?.name ?? '…' }}
        <span v-if="held !== null" class="held" title="Part du territoire de départ conservée">
          {{ held }} %
        </span>
        <span
          v-if="game.playerPolitics"
          class="held gauge"
          title="Stabilité · soutien à la guerre (cliquez pour la diplomatie)"
          @click="openCountry"
        >
          Stab. {{ pctOf(game.playerPolitics.stability) }} · Guerre
          {{ pctOf(game.playerPolitics.warSupport) }}
        </span>
      </div>

      <div v-if="resources" class="resources">
        <span
          v-for="r in resources"
          :key="r.label"
          :title="r.title"
          :class="{ low: r.low, secondary: r.label === 'Construction' }"
        >
          <span class="rlabel">{{ r.label }}</span> {{ r.value }}
          <span class="delta">{{ r.delta }}</span>
        </span>
      </div>

      <div class="time">
        <button
          class="pause"
          :aria-label="game.paused ? 'Reprendre' : 'Pause'"
          @click="game.togglePause()"
        >
          {{ game.paused ? '▶' : '❚❚' }}
        </button>
        <span class="date" :class="{ paused: game.paused }">{{ game.dateLabel }}</span>
        <div class="speeds" role="group" aria-label="Vitesse">
          <button
            v-for="s in speeds"
            :key="s"
            :class="{ active: game.speed === s }"
            :aria-pressed="game.speed === s"
            @click="game.setSpeed(s)"
          >
            {{ s }}
          </button>
        </div>
        <button title="Avancer d'un jour (tour par tour)" @click="game.step(24)">+24 h</button>
      </div>

      <div class="files">
        <button title="Revenir au menu (la partie en cours sera perdue)" @click="quit">Menu</button>
        <button title="Sauvegarder la partie dans un fichier" @click="game.saveToFile()">
          Sauver
        </button>
        <button title="Charger une partie sauvegardée" @click="fileInput?.click()">Charger</button>
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
        <dl v-if="resources" class="menu-resources">
          <template v-for="r in resources" :key="r.label">
            <dt>{{ r.label }}</dt>
            <dd :class="{ low: r.low }">
              {{ r.value }} <span class="delta">{{ r.delta }}</span>
            </dd>
          </template>
          <template v-if="game.playerPolitics">
            <dt>Stabilité</dt>
            <dd>{{ pctOf(game.playerPolitics.stability) }}</dd>
            <dt>Soutien à la guerre</dt>
            <dd>{{ pctOf(game.playerPolitics.warSupport) }}</dd>
          </template>
        </dl>
        <div class="menu-actions">
          <button @click="menuAction(() => game.step(24))">+24 h</button>
          <button @click="menuAction(openCountry)">Diplomatie</button>
          <button @click="menuAction(game.saveToFile)">Sauver</button>
          <button @click="menuAction(() => fileInput?.click())">Charger</button>
          <button @click="menuAction(quit)">Menu principal</button>
        </div>
      </div>
    </template>
    <input ref="fileInput" type="file" accept="application/json" hidden @change="onFile" />
  </header>
</template>

<style scoped>
.topbar.compact {
  padding: calc(6px + env(safe-area-inset-top)) 8px 6px;
  gap: 8px;
  flex-wrap: nowrap;
}
.compact .country {
  gap: 6px;
}
.compact .time {
  gap: 6px;
}
.compact .date {
  min-width: 0;
  font-size: 13px;
}
.compact button {
  padding: 6px 10px;
}
.compact .speed {
  min-width: 42px;
}
.menu-btn {
  font-size: 16px;
}
.menu {
  position: absolute;
  top: 100%;
  right: 8px;
  margin-top: 4px;
  width: min(300px, calc(100vw - 16px));
  background: #14181f;
  border: 1px solid #2c323c;
  border-radius: 8px;
  padding: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
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
.menu-resources .low {
  color: #fca5a5;
}
.menu-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 16px;
  background: rgba(20, 24, 31, 0.92);
  color: #e8eaed;
  font:
    14px/1.2 system-ui,
    sans-serif;
  border-bottom: 1px solid #2c323c;
}
.country {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}
.topbar * {
  white-space: nowrap;
}
.resources {
  display: flex;
  gap: 12px;
  font-variant-numeric: tabular-nums;
}
.rlabel,
.delta {
  color: #9aa3af;
}
.delta {
  font-size: 12px;
}
.resources .low {
  color: #fca5a5;
}
@media (max-width: 1500px) {
  .delta,
  .resources .secondary {
    display: none;
  }
}
@media (max-width: 1180px) {
  .resources {
    display: none;
  }
}
.held {
  font-weight: 400;
  color: #b8bec8;
  font-variant-numeric: tabular-nums;
}
.gauge {
  cursor: pointer;
}
@media (max-width: 1300px) {
  .gauge {
    display: none;
  }
}
.flag {
  width: 14px;
  height: 14px;
  border-radius: 3px;
}
.time,
.files,
.speeds {
  display: flex;
  align-items: center;
  gap: 6px;
}
.date {
  min-width: 170px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.date.paused {
  color: #f2b84b;
}
button {
  background: #2c323c;
  color: inherit;
  border: 1px solid #3b4250;
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
  font: inherit;
}
button:hover {
  background: #363d49;
}
.speeds button {
  padding: 4px 8px;
}
.speeds button.active {
  background: #2563eb;
  border-color: #2563eb;
}
</style>
