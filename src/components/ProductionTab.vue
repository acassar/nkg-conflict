<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/game'
import { BUILDING_KINDS, BUILDINGS, RECRUIT_COSTS, WAR_ECONOMY } from '@/sim/economy/rules'
import { MODERN_CATALOG } from '@/sim/units/catalog'
import type { UnitKind, WarEconomyLevel } from '@/sim/core/types'
import { useProductionStats } from '@/composables/production'

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

const stats = useProductionStats()
/** Jours restants au rythme maximal (borne basse). */
const etaDays = (progress: number, cost: number, minDays: number): number =>
  Math.max(1, Math.ceil(((cost - progress) / cost) * minDays))
const ratio = (a: number, b: number): string => `${b > 0 ? Math.min(100, (100 * a) / b) : 0}%`

const pct = (progress: number, cost: number): number => Math.min(100, (100 * progress) / cost)
const round = (v: number): string => Math.round(v).toLocaleString('fr-FR')
const unitLabel = (kind: UnitKind): string => MODERN_CATALOG[kind].name

const WAR_LEVELS: WarEconomyLevel[] = [0, 1, 2]
const signed = (v: number): string => `${v >= 1 ? '+' : '−'}${Math.round(Math.abs(v - 1) * 100)} %`
const warTitle = (level: WarEconomyLevel): string => {
  const r = WAR_ECONOMY[level]
  if (level === 0) return 'Industrie civile et militaire à leur niveau ordinaire'
  return `Production et munitions ${signed(r.production)}, construction ${signed(r.construction)} ; stabilité et soutien à la guerre s'usent plus vite`
}
</script>

<template>
  <div class="production">
    <!-- Capacités : ce qui tourne face à ce qui pourrait tourner. -->
    <div v-if="stats" class="capacity" data-testid="production-capacity">
      <div class="cap">
        <span class="cap-label">Chantiers</span>
        <span class="cap-value">{{ stats.construction.active }}/{{ stats.construction.max }}</span>
        <span class="gauge"
          ><i :style="{ width: ratio(stats.construction.active, stats.construction.max) }"
        /></span>
        <span class="meta"
          >{{ round(stats.construction.used) }}/{{ round(stats.construction.gain) }} pts/j</span
        >
      </div>
      <div class="cap">
        <span class="cap-label">Formations</span>
        <span class="cap-value">{{ stats.recruitment.active }}/{{ stats.recruitment.max }}</span>
        <span class="gauge"
          ><i :style="{ width: ratio(stats.recruitment.active, stats.recruitment.max) }"
        /></span>
        <span class="meta">casernes occupées</span>
      </div>
      <div class="cap">
        <span class="cap-label">Production</span>
        <span class="cap-value"
          >{{ round(stats.production.used) }}/{{ round(stats.production.gain) }}</span
        >
        <span class="gauge"
          ><i :style="{ width: ratio(stats.production.used, stats.production.gain) }"
        /></span>
        <span class="meta"
          >engagée/gagnée par jour · stock {{ round(stats.production.stock) }}</span
        >
      </div>
      <p v-if="stats.recruitment.max === 0" class="warn">
        Aucune caserne : construisez-en une pour former des unités.
      </p>
      <p
        v-else-if="stats.recruitment.active < stats.recruitment.max && stats.production.stock > 300"
        class="free-tip"
      >
        {{ stats.recruitment.max - stats.recruitment.active }} caserne(s) libre(s) : choisissez une
        ville pour y former des unités.
      </p>
    </div>

    <label class="auto">
      <input
        type="checkbox"
        :checked="game.snapshot?.autoEconomy ?? false"
        @change="game.setAutoEconomy(($event.target as HTMLInputElement).checked)"
      />
      Gestion automatique (constructions et formations)
    </label>

    <div class="war-economy" data-testid="war-economy">
      <span class="label">Économie</span>
      <button
        v-for="level in WAR_LEVELS"
        :key="level"
        :class="{ active: (economy?.warEconomy ?? 0) === level }"
        :title="warTitle(level)"
        @click="game.setWarEconomy(level)"
      >
        {{ WAR_ECONOMY[level].name }}
      </button>
    </div>

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
        <li
          v-for="(q, k) in economy.construction"
          :key="q.id"
          :class="{ waiting: k >= (stats?.construction.max ?? 0) }"
        >
          <div class="row">
            <span>{{ BUILDINGS[q.kind].name }} · {{ q.city }}</span>
            <span class="meta">
              {{
                k >= (stats?.construction.max ?? 0)
                  ? 'en attente'
                  : `${Math.round(pct(q.progress, q.cost))} % · ≈ ${etaDays(q.progress, q.cost, BUILDINGS[q.kind].minDays)} j`
              }}
            </span>
            <button class="x" aria-label="Annuler" @click="game.cancelConstruction(q.id)">×</button>
          </div>
          <div class="bar"><div :style="{ width: `${pct(q.progress, q.cost)}%` }" /></div>
        </li>
      </ul>

      <div class="label">Formations ({{ economy.recruitment.length }})</div>
      <p v-if="economy.recruitment.length === 0" class="meta">Aucune</p>
      <ul>
        <li
          v-for="q in economy.recruitment"
          :key="q.id"
          :class="{ waiting: !stats?.recruitment.activeIds.has(q.id) }"
        >
          <div class="row">
            <span>{{ unitLabel(q.kind) }} · {{ q.city }}</span>
            <span class="meta">
              {{
                !stats?.recruitment.activeIds.has(q.id)
                  ? 'en attente de caserne'
                  : `${Math.round(pct(q.progress, q.cost))} % · ≈ ${etaDays(q.progress, q.cost, RECRUIT_COSTS[q.kind].days)} j`
              }}
            </span>
            <button class="x" aria-label="Annuler" @click="game.cancelRecruit(q.id)">×</button>
          </div>
          <div class="bar"><div :style="{ width: `${pct(q.progress, q.cost)}%` }" /></div>
        </li>
      </ul>

      <p class="meta daily">
        Par jour : +{{ round(economy.daily.construction) }} construction, +{{
          round(economy.daily.production)
        }}
        production<template v-if="economy.daily.productionFromConstruction"
          >, dont {{ round(economy.daily.productionFromConstruction) }} venue des points de
          construction inutilisés</template
        >. Renforts versés hier : {{ Math.round(economy.daily.reinforcements * 100) }} % d'une
        unité.
      </p>
    </section>
  </div>
</template>

<style scoped>
.capacity {
  display: grid;
  gap: 6px;
  margin-bottom: 10px;
  padding: 8px;
  background: #1b2028;
  border-radius: 6px;
}
.cap {
  display: grid;
  grid-template-columns: 78px 54px 1fr;
  align-items: center;
  gap: 2px 8px;
}
.cap .meta {
  grid-column: 2 / 4;
  font-size: 11px;
}
.cap-label {
  color: #9aa3af;
}
.cap-value {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.gauge {
  height: 6px;
  background: #2c323c;
  border-radius: 3px;
  overflow: hidden;
}
.gauge i {
  display: block;
  height: 100%;
  background: #22c55e;
}
.capacity .warn {
  margin: 2px 0 0;
  color: #fca5a5;
}
.capacity .free-tip {
  margin: 2px 0 0;
  color: #fcd34d;
  font-size: 12px;
}
li.waiting {
  opacity: 0.6;
}
.war-economy {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin: 6px 0 10px;
}
.war-economy .label {
  margin-right: 4px;
}
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
