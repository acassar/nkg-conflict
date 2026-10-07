<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '@/stores/game'

const game = useGameStore()
const outcome = computed(() => game.snapshot?.outcome ?? null)
const won = computed(() => outcome.value?.winner === game.snapshot?.playerCountry)
</script>

<template>
  <div v-if="outcome" class="overlay" role="dialog" aria-modal="true">
    <div class="card">
      <h2>{{ won ? 'Victoire' : 'Défaite' }}</h2>
      <p>{{ outcome.reason }}</p>
      <p class="date">{{ game.dateLabel }}</p>
      <button @click="game.newGame()">Nouvelle partie</button>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  background: rgba(10, 12, 16, 0.6);
}
.card {
  background: #14181f;
  color: #e8eaed;
  border: 1px solid #2c323c;
  border-radius: 10px;
  padding: 24px 32px;
  text-align: center;
  font:
    14px/1.4 system-ui,
    sans-serif;
}
h2 {
  margin: 0 0 8px;
  font-size: 24px;
}
.date {
  color: #9aa3af;
}
button {
  margin-top: 8px;
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  font: inherit;
  cursor: pointer;
}
</style>
