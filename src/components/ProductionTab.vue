<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/game'
import { BUILDING_KINDS, BUILDINGS, RECRUIT_COSTS } from '@/sim/economy/rules'
import { MODERN_CATALOG } from '@/sim/units/catalog'
import type { UnitKind } from '@/sim/core/types'

const game = useGameStore()
const { economy, selectedCity, armies } = storeToRefs(game)
const UNIT_KINDS = Object.keys(RECRUIT_COSTS) as UnitKind[]

/** Armée rejointe par les nouvelles recrues : la première armée par défaut, ou la réserve. */
const recruitArmy = ref<number | 'none' | 'default'>('default')
const recruitArmyId = computed<number | null>(() => {
  if (recruitArmy.value === 'none') return null
  if (recruitArmy.value === 'default') return armies.value[0]?.id ?? null
  return recruitArmy.value
})

const isMine = computed(
  () => !!selectedCity.value && selectedCity.value.owner === game.snapshot?.playerCountry,
)
const queuedHere = (kind: string): number =>
  economy.value?.construction.filter((q) => q.city === selectedCity.value?.name && q.kind === kind)
    .length ?? 0

const pct = (progress: number, cost: number): number => Math.min(100, (100 * progress) / cost)
const round = (v: number): string => Math.round(v).toLocaleString('fr-FR')
const unitLabel = (kind: UnitKind): string => MODERN_CATALOG[kind].name
</script>

<template>
  <div class="production">
    <label class="auto">
      <input
        type="checkbox"
        :checked="game.snapshot?.autoEconomy ?? false"
        @change="game.setAutoEconomy(($event.target as HTMLInputElement).checked)"
      />
      Gestion automatique (constructions et formations)
    </label>

    <!-- Ville sélectionnée -->
    <section v-if="selectedCity" class="city">
      <h3>
        {{ selectedCity.name }}
        <span class="meta">
          {{ (selectedCity.pop / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) }} M
          hab.
          <template v-if="!isMine"> · adverse</template>
        </span>
      </h3>
      <ul class="buildings">
        <li v-for="kind in BUILDING_KINDS" :key="kind">
          <span class="bname" :title="BUILDINGS[kind].description">{{ BUILDINGS[kind].name }}</span>
          <span class="level">
            {{ selectedCity.buildings[kind]
            }}<span class="meta">/{{ BUILDINGS[kind].maxPerCity }}</span>
            <span v-if="queuedHere(kind)" class="meta"> (+{{ queuedHere(kind) }})</span>
          </span>
          <button
            v-if="isMine"
            :disabled="
              selectedCity.buildings[kind] + queuedHere(kind) >= BUILDINGS[kind].maxPerCity
            "
            :title="`${BUILDINGS[kind].cost} points de construction, ${BUILDINGS[kind].minDays} jours minimum`"
            @click="game.queueConstruction(selectedCity.name, kind)"
          >
            Construire
          </button>
        </li>
      </ul>

      <template v-if="isMine && selectedCity.buildings.barracks > 0">
        <div class="label">Former une unité ici</div>
        <select v-model="recruitArmy" aria-label="Armée rejointe par la recrue">
          <option value="default">Rejoint : {{ armies[0]?.name ?? 'réserve' }}</option>
          <option value="none">Rejoint : réserve (sans armée)</option>
          <option v-for="a in armies" :key="a.id" :value="a.id">Rejoint : {{ a.name }}</option>
        </select>
        <div class="recruit">
          <button
            v-for="kind in UNIT_KINDS"
            :key="kind"
            :disabled="(economy?.manpower ?? 0) < RECRUIT_COSTS[kind].manpower"
            :title="`${RECRUIT_COSTS[kind].production} production, ${RECRUIT_COSTS[kind].manpower} k hommes, ${RECRUIT_COSTS[kind].days} jours minimum`"
            @click="game.queueRecruit(kind, selectedCity.name, recruitArmyId)"
          >
            {{ unitLabel(kind) }}
          </button>
        </div>
      </template>
      <p v-else-if="isMine" class="meta">
        Pas de caserne : construisez-en une pour former des unités.
      </p>
    </section>
    <p v-else class="empty">Cliquez sur une ville pour voir ses bâtiments et y construire.</p>

    <!-- Files d'attente -->
    <section v-if="economy" class="queues">
      <div class="label">Constructions ({{ economy.construction.length }})</div>
      <p v-if="economy.construction.length === 0" class="meta">Aucune</p>
      <ul>
        <li v-for="q in economy.construction" :key="q.id">
          <div class="row">
            <span>{{ BUILDINGS[q.kind].name }} · {{ q.city }}</span>
            <button class="x" aria-label="Annuler" @click="game.cancelConstruction(q.id)">×</button>
          </div>
          <div class="bar"><div :style="{ width: `${pct(q.progress, q.cost)}%` }" /></div>
        </li>
      </ul>

      <div class="label">Formations ({{ economy.recruitment.length }})</div>
      <p v-if="economy.recruitment.length === 0" class="meta">Aucune</p>
      <ul>
        <li v-for="q in economy.recruitment" :key="q.id">
          <div class="row">
            <span>{{ unitLabel(q.kind) }} · {{ q.city }}</span>
            <button class="x" aria-label="Annuler" @click="game.cancelRecruit(q.id)">×</button>
          </div>
          <div class="bar"><div :style="{ width: `${pct(q.progress, q.cost)}%` }" /></div>
        </li>
      </ul>

      <p class="meta daily">
        Par jour : +{{ round(economy.daily.construction) }} construction, +{{
          round(economy.daily.production)
        }}
        production. Renforts versés hier : {{ Math.round(economy.daily.reinforcements * 100) }} %
        d'une unité.
      </p>
    </section>
  </div>
</template>

<style scoped>
.auto {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 8px;
  color: #cbd2dc;
}
h3 {
  margin: 4px 0 6px;
  font-size: 14px;
  display: flex;
  flex-direction: column;
}
.meta,
.empty {
  color: #9aa3af;
  font-weight: 400;
}
.label {
  color: #9aa3af;
  font-size: 12px;
  margin: 10px 0 4px;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.buildings li {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 8px;
  align-items: center;
  padding: 3px 0;
}
.bname {
  cursor: help;
}
.level {
  font-variant-numeric: tabular-nums;
}
.recruit {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}
select {
  width: 100%;
  background: #11151b;
  border: 1px solid #3b4250;
  border-radius: 6px;
  color: inherit;
  padding: 4px 6px;
  font: inherit;
}
.queues li {
  padding: 4px 0;
}
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.x {
  padding: 0 6px;
}
.bar {
  height: 4px;
  background: #11151b;
  border-radius: 2px;
  margin-top: 3px;
}
.bar div {
  height: 100%;
  background: #4ade80;
  border-radius: 2px;
}
.daily {
  margin-top: 10px;
  font-size: 12px;
}
button {
  background: #2c323c;
  color: inherit;
  border: 1px solid #3b4250;
  border-radius: 6px;
  padding: 3px 8px;
  cursor: pointer;
  font: inherit;
}
button:hover:not(:disabled) {
  background: #363d49;
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
