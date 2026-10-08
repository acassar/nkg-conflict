<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import MapView from '@/map/MapView.vue'
import TopBar from '@/components/TopBar.vue'
import CommandPanel from '@/components/CommandPanel.vue'
import EventLog from '@/components/EventLog.vue'
import GameOver from '@/components/GameOver.vue'
import StartScreen from '@/components/StartScreen.vue'
import Notifications from '@/components/Notifications.vue'
import { useGameStore } from '@/stores/game'

const game = useGameStore()

// Raccourcis : espace = pause, 1 à 5 = vitesse, M/A/H/R = ordres, Échap = annuler.
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
  } else if (key === 'a') {
    game.startOrder('attack')
  } else if (key === 'r') {
    game.startOrder('retreat')
  } else if (key === 'h') {
    game.hold()
  } else if (key === 'escape') {
    if (game.mode.kind !== 'select') game.cancelMode()
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
    <p v-if="game.modeHint" class="hint">{{ game.modeHint }}</p>
    <p v-else-if="game.notice" class="hint notice" role="alert">{{ game.notice }}</p>
    <CommandPanel />
    <EventLog />
    <Notifications />
    <p class="disclaimer">Scénario hypothétique · sans prétention historique</p>
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
