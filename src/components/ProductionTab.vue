<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/game'
import { BUILDING_KINDS, BUILDINGS, WAR_ECONOMY } from '@/sim/economy/rules'
import type { WarEconomyLevel } from '@/sim/core/types'
import { productionQueue, warEconomyEffects } from '@/composables/productionQueue'
import { useProductionStats } from '@/composables/production'
import { useSustainability } from '@/composables/sustainability'
import { fortBonusPct, fortSummary } from '@/sim/economy/forts'

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
const freeBarracks = computed(() =>
  stats.value ? Math.max(0, stats.value.recruitment.max - stats.value.recruitment.active) : 0,
)

const WAR_LEVELS: WarEconomyLevel[] = [0, 1, 2]
const warLevel = computed<WarEconomyLevel>(() => economy.value?.warEconomy ?? 0)
const warEffects = computed(() => warEconomyEffects(warLevel.value))
const signed = (v: number): string => `${v >= 1 ? '+' : '−'}${Math.round(Math.abs(v - 1) * 100)} %`
const warTitle = (level: WarEconomyLevel): string => {
  const r = WAR_ECONOMY[level]
  if (level === 0) return 'Industrie civile et militaire à leur niveau ordinaire'
  return `Production et munitions ${signed(r.production)}, construction ${signed(r.construction)} ; stabilité et soutien à la guerre s'usent plus vite`
}
</script>

<template>
  <div class="production">
    <template v-if="part === 'city'">
      <!-- Ville sélectionnée -->
      <section v-if="selectedCity" class="city" data-testid="city-sheet">
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
            <span class="bname" :title="BUILDINGS[kind].description">{{
              BUILDINGS[kind].name
            }}</span>
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

        <!-- Fortifications : effet en combat et portée (cercle sur la carte). -->
        <div v-if="fort" class="fort" data-testid="city-fort">
          <template v-if="fort.level > 0">
            <div>
              Fortifications niveau {{ fort.level }} : <b>+{{ fort.bonusPct }} % de défense</b> à
              moins de {{ fort.radiusKm }} km
              <template v-if="!isMine"> pour les unités adverses</template>
            </div>
            <div class="meta">
              {{ fort.covered }} unité{{ fort.covered > 1 ? 's' : '' }}
              {{ isMine ? 'à vous' : 'adverse' + (fort.covered > 1 ? 's' : '') }} à portée<template
                v-if="fort.coveredBetter > 0"
              >
                (dont {{ fort.coveredBetter }} mieux protégée{{
                  fort.coveredBetter > 1 ? 's' : ''
                }}
                par une autre ville)</template
              >. Le meilleur niveau à portée compte, sans cumul ; détruites si la ville est prise.
            </div>
          </template>
          <div v-else class="meta">
            Aucune fortification. Chaque niveau donne +{{ fortBonusPct(1) }} % de défense
            {{ isMine ? 'à vos unités' : 'aux unités du propriétaire' }} à moins de
            {{ fort.radiusKm }} km ({{ fort.max }} niveaux au plus)<template v-if="fortQueued > 0"
              >, un niveau en chantier</template
            >.
          </div>
        </div>

        <p v-if="isMine" class="meta" data-testid="city-recruit-note">
          <template v-if="selectedCity.buildings.barracks > 0">
            {{ selectedCity.buildings.barracks }} caserne(s) : les formations se commandent depuis
            une armée (onglet « Renforts » de sa fiche) et partent des casernes les plus proches de
            son front.
          </template>
          <template v-else>Pas de caserne : construisez-en une pour former des unités.</template>
        </p>
      </section>
    </template>
    <template v-else>
      <!-- Capacités : ce qui tourne face à ce qui pourrait tourner. -->
      <div v-if="stats" class="capacity" data-testid="production-capacity">
        <div class="cap">
          <span class="cap-label">Chantiers</span>
          <span class="cap-value"
            >{{ stats.construction.active }}/{{ stats.construction.max }}</span
          >
          <span class="gauge"
            ><i :style="{ width: ratio(stats.construction.active, stats.construction.max) }"
          /></span>
          <span class="meta"
            >{{ round(stats.construction.used) }}/{{ round(stats.construction.gain) }} pts/j</span
          >
        </div>
        <div class="cap">
          <span class="cap-label">Casernes</span>
          <span class="cap-value">{{ stats.recruitment.active }}/{{ stats.recruitment.max }}</span>
          <span class="gauge"
            ><i :style="{ width: ratio(stats.recruitment.active, stats.recruitment.max) }"
          /></span>
          <span class="meta">occupées par une formation</span>
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
        <div v-else-if="freeBarracks > 0" class="free-tip" data-testid="free-barracks">
          <span
            >{{ freeBarracks }} caserne{{ freeBarracks > 1 ? 's' : '' }} libre{{
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

      <!-- Économie de guerre : sélecteur à trois crans et effets du cran choisi. -->
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
        <ul class="effects" data-testid="war-economy-effects">
          <li v-for="line in warEffects" :key="line">{{ line }}</li>
        </ul>
      </div>

      <!-- Gestion automatique : constructions et renforts des armées, séparément. -->
      <div class="auto" data-testid="auto-economy">
        <p class="label">Gestion automatique</p>
        <label>
          <input
            type="checkbox"
            data-testid="auto-build"
            :checked="game.snapshot?.autoEconomy.build ?? false"
            @change="game.setAutoEconomy('build', ($event.target as HTMLInputElement).checked)"
          />
          <span
            >Constructions
            <span class="meta">fortifications au front, usines à l'arrière</span></span
          >
        </label>
        <label>
          <input
            type="checkbox"
            data-testid="auto-recruit"
            :checked="game.snapshot?.autoEconomy.recruit ?? false"
            @change="game.setAutoEconomy('recruit', ($event.target as HTMLInputElement).checked)"
          />
          <span
            >Renforts des armées
            <span class="meta">casernes proches du front, recrues vers l'armée du front</span></span
          >
        </label>
      </div>

      <!-- Soutenabilité : l'économie peut-elle maintenir l'armée au rythme actuel des pertes ? -->
      <div v-if="sustain" class="sustain" :class="sustain.level" data-testid="sustain-panel">
        <div class="label">
          Soutenabilité de l'armée : <strong>{{ sustain.value }}</strong>
          <span v-if="sustain.delta" class="meta">&nbsp;({{ sustain.delta }})</span>
        </div>
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
      </div>

      <!-- File unique : chantiers et formations, ce qui avance d'abord. -->
      <section v-if="economy" class="queues" data-testid="production-queue">
        <div class="label">File de production ({{ queue.length }})</div>
        <p v-if="queue.length === 0" class="meta">
          Rien en cours. Cliquez sur une de vos villes pour y construire ; les formations se
          commandent depuis une armée.
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
                >{{ r.name }} · {{ r.city }}<span v-if="r.army" class="meta"> → {{ r.army }}</span>
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
                  ▲
                </button>
                <button
                  class="x"
                  :disabled="r.index === r.size - 1"
                  :aria-label="`Descendre dans la file des ${r.type === 'build' ? 'chantiers' : 'formations'}`"
                  :title="`Descendre dans la file des ${r.type === 'build' ? 'chantiers' : 'formations'}`"
                  @click="game.moveQueueItem(r.id, 1)"
                >
                  ▼
                </button>
                <button
                  class="x"
                  aria-label="Annuler"
                  title="Annuler"
                  @click="
                    r.type === 'build' ? game.cancelConstruction(r.id) : game.cancelRecruit(r.id)
                  "
                >
                  ×
                </button>
              </span>
            </div>
            <div class="bar"><div :style="{ width: `${r.pct}%` }" /></div>
          </li>
        </ul>
        <p v-if="queue.length > 1" class="meta">
          Les premiers chantiers et une formation par caserne avancent ; ▲ et ▼ changent l'ordre
          dans chaque file.
        </p>

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
    </template>
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
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: center;
  margin: 2px 0 0;
  color: #fcd34d;
  font-size: 12px;
}
li.waiting {
  opacity: 0.6;
}
.sustain {
  margin: 0 0 10px;
  padding: 8px;
  background: #1b2028;
  border-radius: 6px;
  border-left: 3px solid #22c55e;
}
.sustain.warning {
  border-left-color: #f59e0b;
}
.sustain.critical {
  border-left-color: #ef4444;
}
.sustain.unknown {
  border-left-color: #4b5563;
}
.sustain p {
  margin: 4px 0;
}
.sustain table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.sustain th {
  color: #9aa3af;
  font-weight: 400;
  text-align: right;
}
.sustain td {
  text-align: right;
  padding: 1px 0;
}
.sustain td:first-child {
  text-align: left;
  color: #9aa3af;
}
.sustain td.neg {
  color: #fca5a5;
}
.war-economy {
  margin: 6px 0 10px;
}
.segs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border: 1px solid var(--frame-line, #263140);
  border-radius: 6px;
  overflow: hidden;
}
.seg {
  border: none;
  border-radius: 0;
  padding: 5px 2px;
  font-size: 11px;
  line-height: 1.15;
  background: #1b2028;
  white-space: normal;
}
.seg + .seg {
  border-left: 1px solid var(--frame-line, #263140);
}
.seg.on {
  background: var(--frame-blue, #4c8dff);
  color: #fff;
}
.effects {
  margin: 4px 0 0;
  font-size: 11px;
  color: #9aa3af;
}
.auto {
  display: grid;
  gap: 3px;
  margin-bottom: 10px;
  color: #cbd2dc;
}
.auto label {
  display: flex;
  gap: 6px;
  align-items: baseline;
}
.auto .meta {
  display: block;
  font-size: 11px;
}
.tag {
  flex: none;
  align-self: flex-start;
  margin-top: 2px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 0 4px;
  border-radius: 3px;
  margin-right: 6px;
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
.status {
  display: block;
  font-size: 11px;
}
.moves {
  display: flex;
  gap: 2px;
  flex: none;
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
.fort {
  margin-top: 6px;
  padding: 6px 8px;
  border-left: 3px solid #6b7280;
  background: #161b22;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.4;
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
  padding: 0 5px;
  font-size: 11px;
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
