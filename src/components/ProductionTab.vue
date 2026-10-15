<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/game'
import {
  BUILDING_KINDS,
  BUILDINGS,
  FORMATIONS_PER_BARRACKS,
  WAR_ECONOMY,
} from '@/sim/economy/rules'
import type { BudgetSector, WarEconomyLevel } from '@/sim/core/types'
import { productionQueue, warEconomyEffects } from '@/composables/productionQueue'
import {
  budgetForecast,
  budgetView,
  currentAllocation,
  historySeries,
  money,
  nearestOwnCity,
  rebalance,
  sparkPoints,
  type Allocation,
} from '@/composables/budget'
import { useProductionStats } from '@/composables/production'
import { useSustainability } from '@/composables/sustainability'
import { fortBonusPct, fortSummary } from '@/sim/economy/forts'
import { layout } from '@/composables/layout'
import NkgIcon, { type IconName } from './NkgIcon.vue'

/** domain : tiroir Production ; city : fiche de la ville choisie (inspecteur). */
withDefaults(defineProps<{ part?: 'domain' | 'city' }>(), { part: 'domain' })

const game = useGameStore()
const { economy, selectedCity } = storeToRefs(game)

const isMine = computed(
  () => !!selectedCity.value && selectedCity.value.owner === game.snapshot?.playerCountry,
)
const queuedHere = (kind: string): number =>
  economy.value?.construction.filter((q) => q.city === selectedCity.value?.name && q.kind === kind)
    .length ?? 0

/** Fortifications de la ville sélectionnée : bonus, portée, unités du propriétaire couvertes. */
const fort = computed(() => {
  const city = selectedCity.value
  const snap = game.snapshot
  if (!city || !snap) return null
  return fortSummary(city, snap.cities, snap.units)
})
const fortQueued = computed(() => queuedHere('fort'))

const stats = useProductionStats()
const sustain = useSustainability()
const signedRound = (v: number): string =>
  `${v >= 0 ? '+' : '−'}${Math.round(Math.abs(v)).toLocaleString('fr-FR')}`
const ratio = (a: number, b: number): string => `${b > 0 ? Math.min(100, (100 * a) / b) : 0}%`

const round = (v: number): string => Math.round(v).toLocaleString('fr-FR')

/** File unique des chantiers et des formations. */
const queue = computed(() => {
  const eco = economy.value
  const s = stats.value
  if (!eco || !s) return []
  return productionQueue(
    eco,
    s.construction.max,
    s.recruitment.max,
    (id) => game.armies.find((a) => a.id === id)?.name ?? null,
  )
})
/** Choix de bâtiment en cours et ville cliquée sur la carte, hors villes conseillées. */
const { buildChoice } = storeToRefs(game)
const pickedCity = computed(() => {
  const choice = buildChoice.value
  const city = selectedCity.value
  if (!choice || !city || city.owner !== game.snapshot?.playerCountry) return null
  if (choice.advice.some((a) => a.city === city.name)) return null
  const type = BUILDINGS[choice.kind]
  const queued =
    economy.value?.construction.filter((q) => q.city === city.name && q.kind === choice.kind)
      .length ?? 0
  const has = city.buildings[choice.kind] + queued
  return {
    name: city.name,
    canBuild: has < type.maxPerCity,
    note: has < type.maxPerCity ? `${has}/${type.maxPerCity}` : 'maximum atteint',
  }
})
// Les conseils suivent la file (chantier lancé ou annulé) et chaque nouvelle journée.
watch(
  () => [economy.value?.construction.length, game.snapshot?.economy?.daily.construction],
  () => void game.refreshBuildAdvice(),
)
const freeBarracks = computed(() =>
  stats.value ? Math.max(0, stats.value.recruitment.max - stats.value.recruitment.active) : 0,
)

const WAR_LEVELS: WarEconomyLevel[] = [0, 1, 2]
const budget = computed(() => budgetView(economy.value))
/** Aide en argent du dernier jour : reçue et versée. */
const aidText = computed(() => {
  const a = budget.value?.aid
  if (!a) return ''
  const parts: string[] = []
  if (a.in > 0) parts.push(`reçue +${money(a.in)}/j`)
  if (a.out > 0) parts.push(`versée −${money(a.out)}/j`)
  return parts.join(' · ')
})
// Curseurs du budget : brouillon local pendant le glissement, envoyé au relâcher.
const draft = ref<Allocation | null>(null)
const allocation = computed(() => draft.value ?? currentAllocation(economy.value))
const shownShare = (sector: BudgetSector): number => allocation.value?.[sector] ?? 0
const forecast = computed(() =>
  allocation.value ? budgetForecast(economy.value, allocation.value) : null,
)
const history = computed(() => historySeries(economy.value))
const SPARK_W = 120
const SPARK_H = 22
function slide(sector: BudgetSector, pct: number): void {
  const a = allocation.value
  if (a) draft.value = rebalance(a, sector, pct / 100)
}
function commitDraft(): void {
  if (draft.value) void game.setBudgetAllocation({ ...draft.value })
}
function toggleAuto(auto: boolean): void {
  draft.value = null
  void game.setBudgetAllocation(auto ? null : { ...(currentAllocation(economy.value) ?? {}) })
}
// Le brouillon disparaît quand la simulation a repris la répartition choisie.
watch(
  () => economy.value?.budget?.allocation,
  () => (draft.value = null),
)
/** Emplacement libre choisi pour une usine : ville la plus proche. */
const spot = computed(() => {
  const at = game.factorySpot
  const me = game.snapshot?.playerCountry
  if (!at || !me || !game.snapshot) return null
  return nearestOwnCity(game.snapshot.cities, me, at[0], at[1])
})
const warLevel = computed<WarEconomyLevel>(() => economy.value?.warEconomy ?? 0)
const warEffects = computed(() => warEconomyEffects(warLevel.value))
const signed = (v: number): string => `${v >= 1 ? '+' : '−'}${Math.round(Math.abs(v - 1) * 100)} %`
/** Grand écran : deux onglets (budget, chantiers) ; le téléphone garde la liste complète. */
const desktop = computed(() => layout.value === 'desktop')
const tab = ref<'budget' | 'build'>('budget')
const showBudget = computed(() => !desktop.value || tab.value === 'budget')
const showBuild = computed(() => !desktop.value || tab.value === 'build')

const BUILDING_ICONS: Record<string, IconName> = {
  civ: 'factory',
  mil: 'milfactory',
  barracks: 'barracks',
  depot: 'depot',
  fort: 'fort',
}
/** Trésor (réserve en argent) et parts du budget pour la barre empilée. */
const treasury = computed(() => economy.value?.budget?.treasury ?? null)
const SECTOR_COLORS: Record<BudgetSector, string> = {
  defense: '#c0723a',
  construction: '#7fb069',
  research: '#5b8fd9',
  reserve: '#b8a77a',
}
const defenseNote = computed(() => {
  const n = budget.value?.lines.find((l) => l.sector === 'defense')?.note ?? ''
  return n.charAt(0).toUpperCase() + n.slice(1)
})
const warTitle = (level: WarEconomyLevel): string => {
  const r = WAR_ECONOMY[level]
  if (level === 0) return 'Industrie civile et militaire à leur niveau ordinaire'
  return `Production et munitions ${signed(r.production)}, construction ${signed(r.construction)} ; stabilité et soutien à la guerre s'usent plus vite`
}
</script>

<template>
  <div class="production" :class="{ desk: desktop }">
    <template v-if="part === 'city'">
      <!-- Ville sélectionnée : une tuile par bâtiment, l'explication en infobulle. -->
      <section v-if="selectedCity" class="city" data-testid="city-sheet">
        <div class="city-head">
          <NkgIcon name="city" :size="32" class="city-icon" />
          <div>
            <h3>{{ selectedCity.name }}</h3>
            <span class="meta">
              {{ (selectedCity.pop / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) }}
              M hab.<template v-if="!isMine"> · adverse</template>
            </span>
          </div>
        </div>
        <ul class="buildings">
          <li
            v-for="kind in BUILDING_KINDS"
            :key="kind"
            :class="{ wide: kind === 'fort' }"
            :title="BUILDINGS[kind].description"
          >
            <span class="bname">
              <NkgIcon :name="BUILDING_ICONS[kind] ?? 'factory'" :size="20" />
              {{ BUILDINGS[kind].name }}
            </span>
            <span class="pips" aria-hidden="true">
              <span
                v-for="k in BUILDINGS[kind].maxPerCity"
                :key="k"
                :class="{
                  f: k <= selectedCity.buildings[kind],
                  n:
                    k > selectedCity.buildings[kind] &&
                    k <= selectedCity.buildings[kind] + queuedHere(kind),
                }"
              />
            </span>
            <span class="level meta">
              {{ selectedCity.buildings[kind] }} / {{ BUILDINGS[kind].maxPerCity }}
              <template v-if="queuedHere(kind)"> · +{{ queuedHere(kind) }} en chantier</template>
            </span>
            <button
              v-if="isMine"
              class="add"
              :disabled="
                selectedCity.buildings[kind] + queuedHere(kind) >= BUILDINGS[kind].maxPerCity
              "
              :aria-label="`Construire : ${BUILDINGS[kind].name}`"
              :title="`Construire : ${BUILDINGS[kind].cost} points de construction, ${BUILDINGS[kind].minDays} jours minimum`"
              @click="game.queueConstruction(selectedCity.name, kind)"
            >
              <NkgIcon name="plus" :size="16" />
            </button>
          </li>
        </ul>

        <!-- Fortifications : effet en combat et portée (cercle sur la carte). -->
        <div v-if="fort" class="fort" data-testid="city-fort">
          <template v-if="fort.level > 0">
            <div>
              Niveau {{ fort.level }} : <b>+{{ fort.bonusPct }} % de défense</b> à moins de
              {{ fort.radiusKm }} km<template v-if="!isMine"> pour les unités adverses</template>
            </div>
            <div
              class="meta"
              title="Le meilleur niveau à portée compte, sans cumul ; détruites si la ville est prise."
            >
              {{ fort.covered }} unité{{ fort.covered > 1 ? 's' : '' }}
              {{ isMine ? 'à vous' : 'adverse' + (fort.covered > 1 ? 's' : '') }} à portée<template
                v-if="fort.coveredBetter > 0"
              >
                (dont {{ fort.coveredBetter }} mieux protégée{{
                  fort.coveredBetter > 1 ? 's' : ''
                }}
                par une autre ville)</template
              >
            </div>
          </template>
          <div v-else class="meta">
            Sans fortification. Chaque niveau : +{{ fortBonusPct(1) }} % de défense
            {{ isMine ? 'à vos unités' : 'aux unités du propriétaire' }} à moins de
            {{ fort.radiusKm }} km<template v-if="fortQueued > 0">, un niveau en chantier</template
            >.
          </div>
        </div>

        <p
          v-if="isMine"
          class="meta foot"
          data-testid="city-recruit-note"
          :title="
            selectedCity.buildings.barracks > 0
              ? 'Les formations se commandent depuis une armée (Renforts) et partent des casernes les plus proches de son front.'
              : undefined
          "
        >
          <template v-if="selectedCity.buildings.barracks > 0">
            {{ selectedCity.buildings.barracks }} caserne(s) : formations commandées depuis une
            armée.
          </template>
          <template v-else>Pas de caserne : construisez-en une pour former des unités.</template>
        </p>
      </section>
    </template>
    <template v-else>
      <nav v-if="desktop" class="tabs" aria-label="Production">
        <button
          class="tab"
          :class="{ on: tab === 'budget' }"
          :aria-pressed="tab === 'budget'"
          data-testid="production-tab-budget"
          @click="tab = 'budget'"
        >
          Budget
        </button>
        <button
          class="tab"
          :class="{ on: tab === 'build' }"
          :aria-pressed="tab === 'build'"
          data-testid="production-tab-build"
          @click="tab = 'build'"
        >
          Chantiers ({{ queue.length }})
        </button>
      </nav>

      <template v-if="showBudget">
        <!-- Économie de guerre : sélecteur à trois crans, effets principaux, le reste en infobulle. -->
        <div class="war-economy" data-testid="war-economy">
          <p class="label">Économie</p>
          <div class="segs">
            <button
              v-for="level in WAR_LEVELS"
              :key="level"
              class="seg"
              :class="{ on: warLevel === level }"
              :aria-pressed="warLevel === level"
              :title="warTitle(level)"
              @click="game.setWarEconomy(level)"
            >
              {{ WAR_ECONOMY[level].name }}
            </button>
          </div>
          <p class="effects" :title="warEffects.join('\n')" data-testid="war-economy-effects">
            {{ warEffects.slice(0, 2).join(' · ') }}
          </p>
        </div>

        <!-- Budget national : chiffres clés, répartition, résumé ; le détail est replié. -->
        <section v-if="budget" class="budget" data-testid="budget">
          <div class="kpis">
            <div class="kpi">
              <span class="label">Budget</span><b>{{ money(budget.budget) }}/j</b>
            </div>
            <div class="kpi">
              <span class="label">PIB</span><b>{{ money(budget.gdpB * 1000) }}/an</b>
            </div>
            <div
              class="kpi"
              :class="{ alarm: forecast && forecast.reserveDays !== null }"
              title="Trésor : argent mis de côté"
            >
              <span class="label">Réserve</span>
              <b>{{ treasury === null ? '…' : money(treasury) }}</b>
              <span v-if="forecast && forecast.reserveDays !== null" class="alarm-text">
                Vide dans {{ forecast.reserveDays }} j
              </span>
            </div>
          </div>

          <div class="alloc-head">
            <p class="label">Répartition</p>
            <label
              class="auto-alloc"
              title="Usines à plein régime, 5 % de recherche, le reste en réserve"
            >
              <input
                type="checkbox"
                data-testid="budget-auto"
                :checked="budget.auto"
                @change="toggleAuto(($event.target as HTMLInputElement).checked)"
              />
              Automatique
            </label>
          </div>
          <div class="stack" aria-hidden="true">
            <span
              v-for="line in budget.lines"
              :key="line.sector"
              :style="{
                width: `${Math.round(shownShare(line.sector) * 100)}%`,
                background: SECTOR_COLORS[line.sector],
              }"
            />
          </div>
          <ul class="sectors">
            <li
              v-for="line in budget.lines"
              :key="line.sector"
              :data-sector="line.sector"
              :title="line.note"
            >
              <span class="sw" :style="{ background: SECTOR_COLORS[line.sector] }" />
              <span class="sname">{{ line.name }}</span>
              <input
                v-if="!budget.auto"
                class="slider"
                type="range"
                min="0"
                max="100"
                step="1"
                :style="{ accentColor: SECTOR_COLORS[line.sector] }"
                :aria-label="`Part du budget : ${line.name}`"
                :data-testid="`budget-slider-${line.sector}`"
                :value="Math.round(shownShare(line.sector) * 100)"
                @input="slide(line.sector, ($event.target as HTMLInputElement).valueAsNumber)"
                @change="commitDraft"
              />
              <span v-else class="bar">
                <i
                  :style="{
                    width: `${Math.round(line.share * 100)}%`,
                    background: SECTOR_COLORS[line.sector],
                  }"
                />
              </span>
              <span class="num">{{ money(shownShare(line.sector) * budget.budget) }}</span>
            </li>
          </ul>

          <div v-if="forecast" class="summary" data-testid="budget-forecast">
            <p class="sline">{{ defenseNote }}</p>
            <p
              v-if="budget.upkeep"
              class="sline"
              :class="{ warn: forecast.upkeepPaid < 1 }"
              data-testid="budget-upkeep"
            >
              Entretien de l'armée : {{ money(budget.upkeep.need) }}/j,
              {{ Math.round(forecast.upkeepPaid * 100) }} % payé<template
                v-if="forecast.upkeepPaid < 1"
              >
                (les renforts ralentissent d'autant)</template
              >
            </p>
            <p class="sline" :class="{ warn: forecast.reserve < 0 }">
              Réserve : {{ forecast.reserve >= 0 ? '+' : '−'
              }}{{ money(Math.abs(forecast.reserve)) }}/j<template
                v-if="forecast.reserveDays !== null"
              >
                (vide dans {{ forecast.reserveDays }} j, puis les usines ralentissent)</template
              >
            </p>
            <p v-if="budget.manpower" class="sline" data-testid="budget-manpower">
              Réserve mobilisable : {{ round(budget.manpower.pool) }} k hommes · conscription ≈
              {{ budget.manpower.perDay.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) }}
              k/j
            </p>
            <p
              v-if="budget.aid.in > 0 || budget.aid.out > 0"
              class="sline"
              data-testid="budget-aid"
            >
              Aide étrangère en argent : {{ aidText }} (comptée dans la réserve)
            </p>
            <details class="more">
              <summary>Détail des dépenses</summary>
              <ul class="effects-list">
                <li>
                  Usines militaires : {{ Math.round(forecast.milUse * 100) }} % payées par la
                  défense · production ≈ {{ round(forecast.production) }}/j, munitions ≈
                  {{ round(forecast.munitions) }}/j
                </li>
                <li v-if="forecast.hasChantiers">
                  Usines civiles : {{ Math.round(forecast.civUse * 100) }} % payées · construction ≈
                  {{ round(forecast.construction) }} pts/j
                </li>
                <li v-else>Aucun chantier : l'argent de la construction va à la réserve</li>
                <li>Recherche : +{{ money(forecast.research) }}/j</li>
                <li>
                  Usines : {{ budget.factories.mil }} militaires (rouge sur la carte) et
                  {{ budget.factories.civ }} civiles (bleu)<template v-if="budget.factories.offMap">
                    , dont {{ budget.factories.offMap }} hors carte</template
                  ><template v-if="budget.factories.damaged">
                    , {{ budget.factories.damaged }} endommagée(s)</template
                  ><template v-if="budget.mobilizationPct < -0.05">
                    ; mobilisation :
                    {{ budget.mobilizationPct.toFixed(1).replace('.', ',') }} % d'activité</template
                  >
                </li>
              </ul>
              <div
                v-if="history[0] && history[0].values.length > 1"
                class="history"
                data-testid="budget-history"
              >
                <div v-for="h in history" :key="h.key" class="spark">
                  <span class="meta">{{ h.name }}</span>
                  <svg
                    :viewBox="`0 0 ${SPARK_W} ${SPARK_H}`"
                    :width="SPARK_W"
                    :height="SPARK_H"
                    aria-hidden="true"
                  >
                    <polyline :points="sparkPoints(h.values, SPARK_W, SPARK_H)" />
                  </svg>
                  <span class="num" :class="{ warn: (h.change ?? 0) < -0.05 }">{{
                    h.change === null
                      ? ''
                      : `${h.change >= 0 ? '+' : '−'}${Math.round(Math.abs(h.change) * 100)} %`
                  }}</span>
                </div>
                <p class="meta">Évolution sur {{ history[0].values.length }} jours.</p>
              </div>
            </details>
          </div>
        </section>

        <!-- Soutenabilité : l'économie peut-elle maintenir l'armée au rythme actuel des pertes ? -->
        <details v-if="sustain" class="sustain" :class="sustain.level" data-testid="sustain-panel">
          <summary class="slabel">
            Soutenabilité de l'armée : <strong>{{ sustain.value }}</strong>
            <span v-if="sustain.delta" class="meta">&nbsp;({{ sustain.delta }})</span>
          </summary>
          <p class="meta">{{ sustain.summary }}</p>
          <table v-if="sustain.rows.length">
            <thead>
              <tr>
                <th />
                <th title="Moyenne glissante sur une semaine">Besoins/j</th>
                <th>Revenus/j</th>
                <th>Solde/j</th>
                <th>Stock</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in sustain.rows" :key="r.resource" :title="r.detail">
                <td>{{ r.label }}</td>
                <td>{{ round(r.need) }}</td>
                <td>{{ round(r.income) }}</td>
                <td :class="{ neg: r.balance < 0 }">{{ signedRound(r.balance) }}</td>
                <td>{{ round(r.stock) }}</td>
              </tr>
            </tbody>
          </table>
        </details>
      </template>

      <template v-if="showBuild">
        <!-- Construire « quoi, puis où » : bâtiment d'abord, puis villes conseillées. -->
        <section class="build" data-testid="build-choice">
          <p class="label">Construire, puis choisir où</p>
          <div class="kinds">
            <button
              v-for="kind in BUILDING_KINDS"
              :key="kind"
              class="kind"
              :class="{ on: buildChoice?.kind === kind }"
              :aria-pressed="buildChoice?.kind === kind"
              :title="BUILDINGS[kind].description"
              :data-testid="`build-kind-${kind}`"
              @click="game.chooseBuilding(kind)"
            >
              <NkgIcon :name="BUILDING_ICONS[kind] ?? 'factory'" :size="22" class="kicon" />
              <span>{{ BUILDINGS[kind].name }}</span>
            </button>
          </div>
          <template v-if="buildChoice">
            <p class="meta">
              {{ round(BUILDINGS[buildChoice.kind].cost) }} points,
              {{ BUILDINGS[buildChoice.kind].minDays }} j au moins. Villes conseillées cerclées sur
              la carte ; cliquez sur une autre de vos villes pour la choisir.
            </p>
            <ol class="advice">
              <li v-for="(a, k) in buildChoice.advice" :key="a.city" data-testid="build-advice">
                <span class="rank">{{ k + 1 }}</span>
                <span class="where"
                  ><b>{{ a.city }}</b
                  ><span class="meta">{{ a.reasons.join(' · ') }}</span></span
                >
                <button @click="game.queueConstruction(a.city, buildChoice.kind)">
                  Construire
                </button>
              </li>
            </ol>
            <p v-if="buildChoice.advice.length === 0" class="meta">
              Aucune de vos villes n'a de place pour ce bâtiment.
            </p>
            <p v-if="buildChoice.kind === 'civ' || buildChoice.kind === 'mil'" class="meta">
              Une usine se pose aussi n'importe où sur votre territoire : cliquez sur la carte.
            </p>
            <div v-if="game.factorySpot && spot" class="picked" data-testid="build-spot">
              <span
                >Emplacement choisi :
                <b
                  >{{ spot.km < 3 ? 'à' : `${Math.round(spot.km)} km de` }} {{ spot.name }}</b
                ></span
              >
              <button @click="game.queueFactory()">Construire ici</button>
            </div>
            <div v-if="pickedCity" class="picked" data-testid="build-picked">
              <span
                >Ville choisie : <b>{{ pickedCity.name }}</b>
                <span class="meta">{{ pickedCity.note }}</span></span
              >
              <button
                :disabled="!pickedCity.canBuild"
                @click="game.queueConstruction(pickedCity.name, buildChoice.kind)"
              >
                Construire ici
              </button>
            </div>
            <button class="close-choice" @click="game.chooseBuilding(null)">Fermer</button>
          </template>
        </section>

        <!-- File unique : chantiers et formations, ce qui avance d'abord. -->
        <section v-if="economy" class="queues" data-testid="production-queue">
          <p class="label">File de production</p>
          <p v-if="queue.length === 0" class="meta">
            Rien en cours. Choisissez un bâtiment ci-dessus ; les formations se commandent depuis
            une armée.
          </p>
          <ul>
            <li
              v-for="r in queue"
              :key="r.id"
              :class="{ waiting: !r.active }"
              :data-testid="`queue-${r.type}`"
            >
              <div class="row">
                <span class="tag" :class="r.type">{{ r.tag }}</span>
                <span class="what"
                  ><b>{{ r.name }}</b> · {{ r.city
                  }}<span v-if="r.army" class="meta"> → {{ r.army }}</span>
                  <span class="meta status">{{ r.status }}</span></span
                >
                <span class="moves">
                  <button
                    class="x"
                    :disabled="r.index === 0"
                    :aria-label="`Monter dans la file des ${r.type === 'build' ? 'chantiers' : 'formations'}`"
                    :title="`Monter dans la file des ${r.type === 'build' ? 'chantiers' : 'formations'}`"
                    @click="game.moveQueueItem(r.id, -1)"
                  >
                    <NkgIcon name="up" :size="14" />
                  </button>
                  <button
                    class="x"
                    :disabled="r.index === r.size - 1"
                    :aria-label="`Descendre dans la file des ${r.type === 'build' ? 'chantiers' : 'formations'}`"
                    :title="`Descendre dans la file des ${r.type === 'build' ? 'chantiers' : 'formations'}`"
                    @click="game.moveQueueItem(r.id, 1)"
                  >
                    <NkgIcon name="down" :size="14" />
                  </button>
                  <button
                    class="x"
                    aria-label="Annuler"
                    title="Annuler"
                    @click="
                      r.type === 'build' ? game.cancelConstruction(r.id) : game.cancelRecruit(r.id)
                    "
                  >
                    <NkgIcon name="close" :size="14" />
                  </button>
                </span>
              </div>
              <div class="bar"><i :style="{ width: `${r.pct}%` }" /></div>
            </li>
          </ul>
          <p
            v-if="queue.length > 1"
            class="meta"
            title="Les premiers chantiers et une formation par caserne avancent."
          >
            Les flèches changent l'ordre dans chaque file.
          </p>
        </section>

        <!-- Capacités : ce qui tourne face à ce qui pourrait tourner. -->
        <div v-if="stats" class="capacity" data-testid="production-capacity">
          <div
            class="cap"
            :title="`${round(stats.construction.used)}/${round(stats.construction.gain)} points de construction par jour`"
          >
            <span class="cap-label">Chantiers</span>
            <span class="cap-value"
              >{{ stats.construction.active }}/{{ stats.construction.max }}</span
            >
            <span class="gauge"
              ><i :style="{ width: ratio(stats.construction.active, stats.construction.max) }"
            /></span>
          </div>
          <div
            class="cap"
            :title="`Places de formation occupées (${FORMATIONS_PER_BARRACKS} par caserne)`"
          >
            <span class="cap-label">Casernes</span>
            <span class="cap-value"
              >{{ stats.recruitment.active }}/{{ stats.recruitment.max }}</span
            >
            <span class="gauge"
              ><i :style="{ width: ratio(stats.recruitment.active, stats.recruitment.max) }"
            /></span>
          </div>
          <div
            class="cap"
            :title="`Production engagée/gagnée par jour · stock ${round(stats.production.stock)}`"
          >
            <span class="cap-label">Production</span>
            <span class="cap-value"
              >{{ round(stats.production.used) }}/{{ round(stats.production.gain) }}</span
            >
            <span class="gauge"
              ><i :style="{ width: ratio(stats.production.used, stats.production.gain) }"
            /></span>
          </div>
          <p v-if="stats.recruitment.max === 0" class="warn">
            Aucune caserne : construisez-en une pour former des unités.
          </p>
          <div v-else-if="freeBarracks > 0" class="free-tip" data-testid="free-barracks">
            <span
              >{{ freeBarracks }} place{{ freeBarracks > 1 ? 's' : '' }} de formation libre{{
                freeBarracks > 1 ? 's' : ''
              }}<template v-if="stats.production.stock > 300">
                et {{ round(stats.production.stock) }} de production en stock</template
              >.</span
            >
            <button
              v-if="game.armies.length"
              data-testid="free-barracks-recruit"
              @click="game.openArmyRecruit()"
            >
              Commander des renforts
            </button>
          </div>
        </div>

        <!-- Gestion automatique : constructions et renforts des armées, séparément. -->
        <div class="auto" data-testid="auto-economy">
          <label title="Fortifications au front, usines à l'arrière">
            <input
              type="checkbox"
              data-testid="auto-build"
              :checked="game.snapshot?.autoEconomy.build ?? false"
              @change="game.setAutoEconomy('build', ($event.target as HTMLInputElement).checked)"
            />
            Constructions automatiques
          </label>
          <label title="Casernes proches du front, recrues vers l'armée du front">
            <input
              type="checkbox"
              data-testid="auto-recruit"
              :checked="game.snapshot?.autoEconomy.recruit ?? false"
              @change="game.setAutoEconomy('recruit', ($event.target as HTMLInputElement).checked)"
            />
            Renforts automatiques des armées
          </label>
          <p v-if="economy" class="meta daily">
            Par jour : +{{ round(economy.daily.construction) }} construction, +{{
              round(economy.daily.production)
            }}
            production. Renforts versés hier :
            {{ Math.round(economy.daily.reinforcements * 100) }} % d'une unité.
          </p>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.production {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.meta {
  color: var(--nkg-text-faint, #9aa3af);
  font-weight: 400;
}
.label {
  margin: 0 0 6px;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--nkg-label, #9aa3af);
}
ul,
ol {
  list-style: none;
  margin: 0;
  padding: 0;
}
p {
  margin: 0;
}
.num {
  font-variant-numeric: tabular-nums;
}
.warn {
  color: var(--nkg-warn-text, #f59e0b);
}
button {
  background: var(--nkg-tile-bg, #2c323c);
  color: inherit;
  border: 1px solid var(--nkg-line-strong, #3b4250);
  border-radius: 4px;
  padding: 4px 10px;
  cursor: pointer;
  font: inherit;
}
button:hover:not(:disabled) {
  border-color: var(--nkg-brass, #4c8dff);
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}

/* Onglets du tiroir (grand écran). */
.tabs {
  display: flex;
  margin: -12px -14px 0;
  padding: 0 14px;
  border-bottom: 1px solid var(--nkg-brass-line, #263140);
}
.tabs button {
  flex: 1;
  height: 36px;
  padding: 0;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  color: var(--nkg-text-muted);
}
.tabs button.on {
  border-bottom-color: var(--nkg-brass-light);
  color: var(--nkg-brass-pale);
}
.tabs button:hover:not(:disabled) {
  border-color: transparent;
  border-bottom-color: var(--nkg-brass-dark);
  color: var(--nkg-text);
}
.tabs button.on:hover {
  border-bottom-color: var(--nkg-brass-light);
}

/* Économie de guerre. */
.segs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.seg {
  min-height: 38px;
  padding: 4px 2px;
  border-radius: 0;
  font-size: 12px;
  line-height: 1.15;
  white-space: normal;
}
.seg:first-child {
  border-radius: 4px 0 0 4px;
}
.seg:last-child {
  border-radius: 0 4px 4px 0;
}
.seg + .seg {
  border-left: none;
}
.seg.on {
  background: var(--nkg-tile-on-bg, #4c8dff);
  border-color: var(--nkg-brass-light, #4c8dff);
  color: var(--nkg-brass-pale, #fff);
  font-weight: 600;
}
.effects {
  margin-top: 6px;
  font-size: 12px;
  color: var(--nkg-text-muted, #9aa3af);
  cursor: help;
}

/* Budget. */
.kpis {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 14px;
}
.kpi {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  background: var(--nkg-chip, #1b2028);
  border: 1px solid #2e3540;
  border-radius: 4px;
}
.kpi .label {
  margin: 0;
  font-size: 10px;
}
.kpi b {
  font-size: 15px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.kpi.alarm {
  border-color: #8a5a2b;
}
.alarm-text {
  font-size: 11px;
  color: var(--nkg-warn-text, #f59e0b);
}
.alloc-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.auto-alloc {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--nkg-text-soft);
  cursor: pointer;
}
input[type='checkbox'] {
  accent-color: var(--nkg-brass, #f59e0b);
}
.stack {
  display: flex;
  height: 12px;
  margin-bottom: 10px;
  overflow: hidden;
  border: 1px solid var(--nkg-brass-deep, #263140);
  border-radius: 2px;
}
.sectors {
  display: grid;
  gap: 8px;
}
.sectors li {
  display: grid;
  grid-template-columns: 10px 96px 1fr 64px;
  align-items: center;
  gap: 8px;
}
.sw {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
.sectors .num {
  text-align: right;
}
.slider {
  width: 100%;
  margin: 0;
}
.bar {
  display: block;
  height: 6px;
  overflow: hidden;
  background: #2b333e;
  border-radius: 3px;
}
.bar i {
  display: block;
  height: 100%;
  background: var(--nkg-good, #4ade80);
  border-radius: 3px;
}
.summary {
  display: grid;
  gap: 5px;
  margin-top: 12px;
  padding: 10px 12px;
  background: var(--nkg-surface-sunken, #1b2028);
  border: 1px solid #2e3540;
  border-radius: 5px;
  font-size: 12.5px;
}
.more summary,
.sustain summary {
  cursor: pointer;
  color: var(--nkg-brass, #93c5fd);
  font-size: 12.5px;
}
.effects-list {
  display: grid;
  gap: 4px;
  margin: 6px 0;
  color: var(--nkg-text-muted);
  font-size: 12px;
}
.history {
  display: grid;
  gap: 2px;
  margin-top: 6px;
}
.spark {
  display: grid;
  grid-template-columns: 90px 120px 1fr;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.spark polyline {
  fill: none;
  stroke: var(--nkg-brass, #f59e0b);
  stroke-width: 1.5;
}

/* Soutenabilité, repliée. */
.sustain {
  padding: 8px 10px;
  background: var(--nkg-surface-sunken, #1b2028);
  border: 1px solid #2e3540;
  border-left: 3px solid var(--nkg-good, #22c55e);
  border-radius: 4px;
}
.sustain summary {
  color: var(--nkg-text);
}
.sustain.warning {
  border-left-color: var(--nkg-warn, #f59e0b);
}
.sustain.critical {
  border-left-color: var(--nkg-bad, #ef4444);
}
.sustain.unknown {
  border-left-color: #4b5563;
}
.sustain p {
  margin: 6px 0;
}
.sustain table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.sustain th {
  color: var(--nkg-text-faint);
  font-weight: 400;
  text-align: right;
}
.sustain td {
  text-align: right;
  padding: 1px 0;
}
.sustain td:first-child {
  text-align: left;
  color: var(--nkg-text-faint);
}
.sustain td.neg {
  color: var(--nkg-bad-text, #fca5a5);
}

/* Construire. */
.kinds {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
}
.kinds button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 70px;
  padding: 6px 2px;
  border-radius: 6px;
  font-size: 11.5px;
  line-height: 1.15;
  text-align: center;
  white-space: normal;
}
.kicon {
  color: var(--nkg-brass, currentColor);
}
.kinds button.on {
  background: var(--nkg-tile-on-bg, #4c8dff);
  border-color: var(--nkg-brass-light, #4c8dff);
  color: var(--nkg-brass-pale, #fff);
}
.build > .meta {
  margin: 8px 0 4px;
  font-size: 11.5px;
}
.advice li,
.picked {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 5px 0;
}
.rank {
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid var(--nkg-brass, #c2410c);
  color: var(--nkg-brass-pale, #fff);
  font-size: 11px;
  font-weight: 700;
  display: grid;
  place-items: center;
}
.where,
.picked > span {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.where .meta,
.picked .meta {
  font-size: 11px;
}
.close-choice {
  margin-top: 4px;
  font-size: 12px;
}

/* File de production. */
.queues ul {
  display: grid;
  gap: 6px;
}
.queues li {
  padding: 8px 10px;
  background: var(--nkg-surface, #1b2028);
  border: 1px solid var(--nkg-line, #333c49);
  border-radius: 5px;
}
.queues li.waiting {
  opacity: 0.65;
}
.queues > .meta {
  margin-top: 6px;
  font-size: 11.5px;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.tag {
  flex: none;
  align-self: flex-start;
  margin-top: 2px;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 10px;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.tag.build {
  background: #3b3220;
  color: #fcd34d;
}
.tag.train {
  background: #1e2b40;
  color: #93c5fd;
}
.what {
  flex: 1;
  min-width: 0;
}
.what b {
  font-weight: 600;
}
.status {
  display: block;
  font-size: 11px;
}
.moves {
  display: flex;
  gap: 3px;
  flex: none;
}
.x {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  padding: 0;
}
.queues .bar {
  height: 4px;
  margin-top: 6px;
}
.queues .bar i {
  background: #7fb069;
}

/* Capacités et automatismes. */
.capacity {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  background: var(--nkg-surface-sunken, #1b2028);
  border: 1px solid #2e3540;
  border-radius: 5px;
}
.cap {
  display: grid;
  grid-template-columns: 78px 64px 1fr;
  align-items: center;
  gap: 8px;
  cursor: help;
}
.cap-label {
  color: var(--nkg-text-muted, #9aa3af);
}
.cap-value {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.gauge {
  height: 6px;
  overflow: hidden;
  background: #2b333e;
  border-radius: 3px;
}
.gauge i {
  display: block;
  height: 100%;
  background: var(--nkg-good, #22c55e);
}
.capacity .free-tip {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: center;
  color: var(--nkg-brass-light, #fcd34d);
  font-size: 12px;
}
.auto {
  display: grid;
  gap: 6px;
  color: var(--nkg-text-soft, #cbd2dc);
}
.auto label {
  display: flex;
  gap: 8px;
  align-items: center;
  cursor: pointer;
}
.daily {
  font-size: 12px;
}

/* Fiche de ville. */
.city {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.city-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.city-icon {
  color: var(--nkg-brass-light, #e0c27a);
  stroke-width: 1.4;
}
h3 {
  margin: 0;
  font: 600 22px/1.1 var(--nkg-serif, system-ui);
}
.buildings {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.buildings li {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 10px 12px;
  background: var(--nkg-tile-bg, #1b2028);
  border: 1px solid var(--nkg-line-strong, #3b4250);
  border-radius: 6px;
  cursor: help;
}
.buildings li.wide {
  grid-column: span 2;
}
.bname {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 28px;
  font-weight: 500;
}
.bname :deep(.nkg-icon) {
  color: var(--nkg-brass, currentColor);
}
.pips {
  display: flex;
  gap: 2px;
}
.pips span {
  flex: 1;
  height: 6px;
  border-radius: 1px;
  background: #2b333e;
}
.pips span.f {
  background: var(--nkg-brass, #4ade80);
}
.pips span.n {
  background: #7fb069;
}
.level {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.add {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  padding: 0;
  background: #2a2418;
  border-color: var(--nkg-brass-dark, #3b4250);
  color: var(--nkg-brass-pale, #fff);
}
.fort {
  display: grid;
  gap: 3px;
  padding: 8px 10px;
  background: var(--nkg-surface-sunken, #161b22);
  border: 1px solid #2e3540;
  border-radius: 4px;
  font-size: 12.5px;
  line-height: 1.45;
}
.foot {
  font-size: 12px;
  cursor: help;
}
/*
 * Le cadre (GameFrame) impose un style à tous les boutons des tiroirs avec un sélecteur fort ;
 * onglets, crans et tuiles le remplacent ici sur grand écran.
 */
.production.desk .tabs .tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  color: var(--nkg-text-muted);
}
.production.desk .tabs .tab:hover:not(:disabled) {
  background: none;
  border-bottom-color: var(--nkg-brass-dark);
  color: var(--nkg-text);
}
.production.desk .tabs .tab.on,
.production.desk .tabs .tab.on:hover:not(:disabled) {
  border-bottom-color: var(--nkg-brass-light);
  color: var(--nkg-brass-pale);
  font-weight: 600;
}
.production.desk .segs .seg {
  border-radius: 0;
  font-size: 12px;
  line-height: 1.15;
}
.production.desk .segs .seg:first-child {
  border-radius: 4px 0 0 4px;
}
.production.desk .segs .seg:last-child {
  border-radius: 0 4px 4px 0;
}
.production.desk .segs .seg + .seg {
  border-left: none;
}
.production.desk .segs .seg.on {
  background: var(--nkg-tile-on-bg);
  border-color: var(--nkg-brass-light);
  color: var(--nkg-brass-pale);
}
.production.desk .kinds .kind {
  padding: 6px 2px;
  border-radius: 6px;
  font-size: 11.5px;
  line-height: 1.15;
}
.production.desk .kinds .kind.on {
  background: var(--nkg-tile-on-bg);
  border-color: var(--nkg-brass-light);
  color: var(--nkg-brass-pale);
}
</style>
