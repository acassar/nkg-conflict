<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '@/stores/game'

const game = useGameStore()
const name = (c: string): string => game.countryByCode.get(c)?.name ?? c
const offers = computed(() => game.offers.filter((o) => o.to === game.snapshot?.playerCountry))
const requests = computed(() =>
  game.aidRequests.filter((r) => r.to === game.snapshot?.playerCountry),
)
const LEVELS = [
  { level: 1, name: 'Limitée' },
  { level: 2, name: 'Soutenue' },
  { level: 3, name: 'Massive' },
] as const
const daysLeft = (expires: number): number =>
  Math.max(0, Math.ceil((expires - (game.snapshot?.tick ?? 0)) / 24))
</script>

<template>
  <div class="notifications">
    <div
      v-for="o in offers"
      :key="`o${o.id}`"
      class="offer"
      role="alertdialog"
      data-testid="peace-offer"
    >
      <strong>{{ name(o.from) }} propose la paix</strong>
      <p>
        {{
          o.kind === 'white'
            ? "Paix blanche : retour aux frontières d'avant-guerre."
            : 'Paix sur les lignes : chacun garde ce qu’il tient.'
        }}
        <span class="muted">Expire dans {{ daysLeft(o.expiresTick) }} j.</span>
      </p>
      <div class="row">
        <button class="ok" @click="game.answerOffer(o.id, true)">Accepter</button>
        <button @click="game.answerOffer(o.id, false)">Refuser</button>
      </div>
    </div>
    <div
      v-for="r in requests"
      :key="`a${r.id}`"
      class="offer aid"
      role="alertdialog"
      data-testid="aid-request"
    >
      <strong>{{ name(r.from) }} demande votre aide</strong>
      <p>
        Une part de vos munitions, de votre production et de vos points de construction lui sera
        versée chaque jour.
        <span class="muted">Expire dans {{ daysLeft(r.expiresTick) }} j.</span>
      </p>
      <div class="row">
        <button
          v-for="l in LEVELS"
          :key="l.level"
          class="ok"
          :title="`Aide ${l.name.toLowerCase()}`"
          @click="game.answerAidRequest(r.id, true, l.level)"
        >
          {{ l.name }}
        </button>
        <button @click="game.answerAidRequest(r.id, false)">Refuser</button>
      </div>
    </div>
    <div
      v-for="t in game.toasts"
      :key="t.id"
      class="toast"
      :class="t.tone"
      role="status"
      @click="game.dismissToast(t.id)"
    >
      {{ t.text }}
    </div>
  </div>
</template>

<style scoped>
.notifications {
  position: absolute;
  top: 60px;
  left: 12px;
  z-index: 25;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: min(340px, calc(100% - 24px));
  font:
    13px/1.35 system-ui,
    sans-serif;
  pointer-events: none;
}
@media (max-width: 759px), (max-height: 499px) {
  .notifications {
    top: calc(52px + env(safe-area-inset-top));
    left: 8px;
    width: min(360px, calc(100% - 16px));
  }
}
.offer,
.toast {
  pointer-events: auto;
  background: rgba(20, 24, 31, 0.95);
  color: #e8eaed;
  border: 1px solid #2c323c;
  border-left: 4px solid #2563eb;
  border-radius: 6px;
  padding: 8px 10px;
}
.offer {
  border-left-color: #10b981;
}
.offer.aid {
  border-left-color: #f59e0b;
}
.offer p {
  margin: 4px 0 6px;
}
.muted {
  color: #9aa3af;
}
.row {
  display: flex;
  gap: 6px;
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
button.ok {
  background: #059669;
  border-color: #059669;
}
.toast {
  cursor: pointer;
}
.toast.danger {
  border-left-color: #dc2626;
}
.toast.success {
  border-left-color: #10b981;
}
</style>
