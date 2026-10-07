<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import MapView from '@/map/MapView.vue'
import TopBar from '@/components/TopBar.vue'
import { useGameStore } from '@/stores/game'

const game = useGameStore()

// Raccourcis : espace = pause, 1 à 5 = vitesse.
function onKey(event: KeyboardEvent): void {
  if (event.target instanceof HTMLInputElement) return
  if (event.code === 'Space') {
    event.preventDefault()
    void game.togglePause()
  } else if (/^[1-5]$/.test(event.key)) {
    void game.setSpeed(Number(event.key))
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <TopBar />
  <MapView />
  <p class="disclaimer">Scénario hypothétique · pas une reconstitution historique</p>
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
.disclaimer {
  position: absolute;
  left: 16px;
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
