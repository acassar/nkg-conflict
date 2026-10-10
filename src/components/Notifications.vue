<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import type { AlertKind, PlayerAlert } from '@/sim/core/types'

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
/** Alertes affichées au plus ; les suivantes sont seulement comptées. */
const MAX_ALERTS = 3
const shownAlerts = computed(() => game.alerts.slice(0, MAX_ALERTS))
const hiddenAlerts = computed(() => Math.max(0, game.alerts.length - MAX_ALERTS))
const ALERT_TITLES: Record<AlertKind, string> = {
  breach: 'Front percé',
  encircled: 'Coupées',
  pocket: 'Poche',
}
/** Nombre d'unités de l'alerte, en clair. */
function countText(a: PlayerAlert): string {
  const n = a.unitIds.length
  const s = n > 1 ? 's' : ''
  return a.kind === 'breach' ? `${n} ennemie${s}` : `${n} unité${s}`
}
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
    <section v-if="game.alerts.length" class="alerts" data-testid="player-alerts">
      <button
        class="alerts-head"
        :aria-expanded="!game.alertsFolded"
        :title="game.alertsFolded ? 'Afficher les alertes' : 'Masquer les alertes'"
        @click="game.alertsFolded = !game.alertsFolded"
      >
        <span class="dot" />
        {{ game.alerts.length }} alerte{{ game.alerts.length > 1 ? 's' : '' }}
        <span class="fold">{{ game.alertsFolded ? 'Afficher' : 'Masquer' }}</span>
      </button>
      <template v-if="!game.alertsFolded">
        <div
          v-for="a in shownAlerts"
          :key="a.key"
          class="alert"
          :class="a.kind"
          role="alert"
          :title="a.text"
          data-testid="player-alert"
        >
          <strong>{{ ALERT_TITLES[a.kind] }}</strong>
          <span class="alert-text">{{ a.place }} · {{ countText(a) }}</span>
          <button title="Centrer la carte sur l'alerte" @click="game.focusAlert(a)">Centrer</button>
          <button
            class="close"
            title="Fermer l'alerte"
            aria-label="Fermer"
            @click="game.dismissAlert(a.key)"
          >
            ×
          </button>
        </div>
        <div v-if="hiddenAlerts" class="more">
          + {{ hiddenAlerts }} autre{{ hiddenAlerts > 1 ? 's' : '' }}
        </div>
      </template>
    </section>
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
/* Alertes : en haut au centre sur grand écran (la légende logistique occupe le coin gauche),
   dans la colonne des notifications sur téléphone. */
.alerts {
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 3px;
  background: rgba(20, 24, 31, 0.92);
  border: 1px solid #2c323c;
  border-radius: 6px;
  padding: 4px;
  color: #e8eaed;
}
@media (min-width: 760px) and (min-height: 500px) {
  .alerts {
    position: fixed;
    top: 56px;
    left: 50%;
    transform: translateX(-50%);
    width: min(440px, calc(100vw - 760px));
    min-width: 300px;
  }
}
.alerts-head {
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 0;
  padding: 2px 4px;
  font-size: 12px;
  font-weight: 600;
  text-align: left;
}
.alerts-head .fold {
  margin-left: auto;
  color: #9aa3af;
  font-weight: 400;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f59e0b;
}
.alert {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 2px 2px 6px;
  border-left: 3px solid #f59e0b;
  font-size: 12px;
}
.alert.encircled {
  border-left-color: #dc2626;
}
.alert.breach {
  border-left-color: #f97316;
}
.alert strong {
  white-space: nowrap;
}
.alert-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.alert button {
  padding: 2px 8px;
  font-size: 12px;
}
.alert button.close {
  padding: 2px 6px;
  background: transparent;
  border-color: transparent;
  color: #9aa3af;
}
.more {
  color: #9aa3af;
  font-size: 11px;
  padding: 0 6px;
}
</style>
