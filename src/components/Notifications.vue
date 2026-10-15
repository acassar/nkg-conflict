<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import { isMobile } from '@/composables/layout'
import type { AlertKind, PlayerAlert } from '@/sim/core/types'
import NkgIcon from './NkgIcon.vue'

/** Un bandeau (consigne d'un ordre, message) occupe le haut de l'écran : on passe dessous. */
const props = defineProps<{ belowBanner?: boolean }>()

const game = useGameStore()
/** Grand écran : à droite, à côté de l'inspecteur, pour laisser libres le rail et son tiroir. */
const placement = computed(() =>
  isMobile.value ? undefined : { left: 'auto', right: game.inspector ? '344px' : '12px' },
)
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
  <div
    class="notifications"
    :class="{ 'below-banner': props.belowBanner, desk: !isMobile }"
    :style="placement"
  >
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
    <!-- Grand écran : repliée, la liste disparaît ; la cloche de la barre du haut la rouvre. -->
    <section
      v-if="game.alerts.length && (isMobile || !game.alertsFolded)"
      class="alerts"
      data-testid="player-alerts"
    >
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
            <template v-if="isMobile">×</template><NkgIcon v-else name="close" :size="14" />
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
  .notifications.below-banner {
    top: calc(104px + env(safe-area-inset-top));
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
  .below-banner .alerts {
    top: 100px;
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

/* Grand écran (charte : docs/charte.md). */
.desk {
  font: 13px/1.4 var(--nkg-sans);
}
.desk .offer,
.desk .toast,
.desk .alerts {
  background: var(--nkg-panel-bg);
  color: var(--nkg-text);
  border: 1px solid var(--nkg-brass-dark);
  border-radius: 4px;
  box-shadow:
    0 0 0 2px #10141a,
    0 10px 24px rgba(0, 0, 0, 0.45);
}
.desk .toast {
  border-left: 3px solid var(--nkg-brass);
}
.desk .toast.danger {
  border-left-color: var(--nkg-bad);
}
.desk .toast.success {
  border-left-color: var(--nkg-good);
}
.desk .offer {
  padding: 12px 14px;
  border-left: 3px solid var(--nkg-good);
}
.desk .offer.aid {
  border-left-color: var(--nkg-warn);
}
.desk .offer strong {
  font-family: var(--nkg-serif);
  font-size: 16px;
  font-weight: 600;
}
.desk .muted {
  color: var(--nkg-text-faint);
}
.desk button {
  height: 30px;
  padding: 0 12px;
  background: var(--nkg-tile-bg);
  border: 1px solid var(--nkg-line-strong);
  border-radius: 4px;
}
.desk button:hover {
  border-color: var(--nkg-brass);
}
.desk button.ok {
  background: var(--nkg-gold-bg);
  border-color: var(--nkg-brass-pale);
  color: #1a140a;
  font-weight: 600;
}
.desk .alerts {
  gap: 4px;
  padding: 6px;
}
.desk .alerts-head {
  height: 26px;
  background: transparent;
  border-color: transparent;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--nkg-label);
}
.desk .alerts-head:hover {
  border-color: transparent;
}
.desk .dot {
  background: #d9822b;
}
.desk .alert {
  gap: 8px;
  padding: 4px 4px 4px 10px;
  background: var(--nkg-surface);
  border: 1px solid var(--nkg-line);
  border-left: 3px solid var(--nkg-warn);
  border-radius: 4px;
  font-size: 12.5px;
}
.desk .alert.encircled {
  border-left-color: var(--nkg-bad);
}
.desk .alert.breach {
  border-left-color: #d9822b;
}
.desk .alert button {
  height: 26px;
  padding: 0 10px;
}
.desk .alert button.close {
  display: grid;
  place-items: center;
  width: 26px;
  padding: 0;
  background: transparent;
  border-color: transparent;
  color: var(--nkg-text-faint);
}
.desk .more {
  color: var(--nkg-text-faint);
}
</style>
