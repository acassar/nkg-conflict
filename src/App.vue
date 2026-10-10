<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import MapView from '@/map/MapView.vue'
import TopBar from '@/components/TopBar.vue'
import GameFrame from '@/components/GameFrame.vue'
import EventLog from '@/components/EventLog.vue'
import GameOver from '@/components/GameOver.vue'
import StartScreen from '@/components/StartScreen.vue'
import Notifications from '@/components/Notifications.vue'
import LassoButton from '@/components/LassoButton.vue'
import MapViewButton from '@/components/MapViewButton.vue'
import BattleDialog from '@/components/BattleDialog.vue'
import RulesHelp from '@/components/RulesHelp.vue'
import ResourceDialog from '@/components/ResourceDialog.vue'
import { computed } from 'vue'
import { isMobile, isTouch, layout } from '@/composables/layout'
import { useGameStore } from '@/stores/game'

const game = useGameStore()

/** Consigne du mode en cours, reformulée pour le doigt sur écran tactile. */
const hint = computed(() => {
  if (game.lasso) return 'Sélection par zone : glissez un rectangle sur vos unités'
  const text = game.modeHint ?? ''
  return isTouch.value
    ? text.replace(/cliquez/g, 'touchez').replace(' (Échap pour annuler)', '')
    : text
})

/** Visée d'une mission d'armée (point, trait, frontière ou cible) : bandeau en bas de l'écran. */
const aiming = computed(() => {
  const m = game.mode
  return (
    m.kind === 'breach' ||
    (m.kind === 'advance' && m.armyId !== undefined) ||
    (m.kind === 'target' && m.armyId !== undefined)
  )
})

// Raccourcis : espace = pause, 1 à 5 = vitesse, M/T/H/R = ordres, L = carte logistique, Échap = annuler.
// ZQSD (WASD en QWERTY) et les flèches déplacent la carte (voir MapView).
function onKey(event: KeyboardEvent): void {
  const target = event.target
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
  if (!game.started) return
  const key = event.key.toLowerCase()
  if (event.code === 'Space') {
    event.preventDefault()
    void game.togglePause()
  } else if (/^[1-5]$/.test(key)) {
    void game.setSpeed(Number(key))
  } else if (key === 'm') {
    game.startOrder('move')
  } else if (key === 't') {
    game.startOrder('attack')
  } else if (key === 'r') {
    game.startOrder('retreat')
  } else if (key === 'h') {
    game.hold()
  } else if (key === 'l') {
    game.setMapView(game.mapView === 'logistics' ? 'political' : 'logistics')
  } else if (key === 'enter' && game.mode.kind === 'advance') {
    game.finishAdvanceLine()
  } else if (key === 'escape') {
    if (game.gaugeOpen) game.gaugeOpen = null
    else if (game.battleIds) game.closeBattle()
    else if (game.mode.kind !== 'select' || game.lasso) game.cancelMode()
    else game.clearSelection()
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <MapView />
  <template v-if="game.started">
    <TopBar />
    <p
      v-if="game.modeHint || game.lasso"
      class="hint"
      :class="{ mobile: isMobile, aim: aiming && !isMobile }"
      :data-testid="aiming ? 'aim-banner' : undefined"
    >
      {{ hint }}
      <button
        v-if="game.mode.kind === 'advance' && game.mode.goal === 'line'"
        class="hint-cancel"
        data-testid="advance-line-done"
        @click="game.finishAdvanceLine()"
      >
        Valider
      </button>
      <button v-if="isMobile" class="hint-cancel" @click="game.cancelMode()">Annuler</button>
    </p>
    <p v-else-if="game.notice" class="hint notice" :class="{ mobile: isMobile }" role="alert">
      {{ game.notice }}
    </p>
    <GameFrame :key="layout" />
    <EventLog v-if="!isMobile && !game.panelTab" />
    <Notifications />
    <LassoButton />
    <MapViewButton />
    <BattleDialog />
    <RulesHelp />
    <ResourceDialog />
    <p v-if="!isMobile" class="disclaimer">Scénario hypothétique · sans prétention historique</p>
    <GameOver />
  </template>
  <StartScreen v-else />
</template>

<style>
html,
body,
#app {
  margin: 0;
  height: 100%;
  overflow: hidden;
  background: #14181f;
  overscroll-behavior: none;
  -webkit-tap-highlight-color: transparent;
}
#app {
  height: 100dvh;
}
.hint {
  position: absolute;
  top: 60px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  margin: 0;
  padding: 6px 12px;
  background: #facc15;
  color: #1f2937;
  border-radius: 6px;
  font:
    600 13px/1.3 system-ui,
    sans-serif;
}
/* Bandeau de visée d'une mission d'armée : en bas, au-dessus du bandeau de description. */
.hint.aim {
  top: auto;
  bottom: 52px;
  background: #151c24;
  color: #e8eaed;
  border: 1px solid #f2a33a;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}
.hint.aim::before {
  content: '';
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 8px;
  border-radius: 50%;
  background: #f2a33a;
}
.hint.aim .hint-cancel {
  background: #4c8dff;
}
.hint.mobile {
  top: calc(52px + env(safe-area-inset-top));
  left: 8px;
  right: 8px;
  transform: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.hint-cancel {
  background: #1f2937;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 6px 10px;
  font: inherit;
}
.hint:not(.mobile) .hint-cancel {
  margin-left: 8px;
  padding: 2px 8px;
}
.hint.notice {
  background: #fca5a5;
}
.disclaimer {
  position: absolute;
  left: 12px;
  bottom: 12px;
  z-index: 10;
  margin: 0;
  padding: 4px 10px;
  background: rgba(20, 24, 31, 0.85);
  color: #b8bec8;
  font:
    11px/1.2 system-ui,
    sans-serif;
  letter-spacing: 0.04em;
  border-radius: 4px;
}
</style>
