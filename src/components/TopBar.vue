<script setup lang="ts">
import { ref } from 'vue'
import { useGameStore } from '@/stores/game'

const game = useGameStore()
const fileInput = ref<HTMLInputElement | null>(null)
const speeds = [1, 2, 3, 4, 5] as const

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
  <header class="topbar">
    <div class="country">
      <span
        v-if="game.playerCountry"
        class="flag"
        :style="{ background: `rgb(${game.playerCountry.color.join(',')})` }"
      />
      {{ game.playerCountry?.name ?? '…' }}
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
      <button @click="game.saveToFile()">Sauvegarder</button>
      <button @click="fileInput?.click()">Charger</button>
      <input ref="fileInput" type="file" accept="application/json" hidden @change="onFile" />
    </div>
  </header>
</template>

<style scoped>
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
@media (max-width: 640px) {
  .topbar {
    flex-wrap: wrap;
    justify-content: center;
  }
  .files {
    display: none;
  }
}
</style>
