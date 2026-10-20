<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/game'
import { formationSlots, recruitCostOf } from '@/sim/economy/rules'
import { armyAnchors, expandOrder, planArmyRecruit } from '@/sim/economy/armyRecruit'
import { BRIGADE_TEMPLATES, DIVISION_TEMPLATES } from '@/sim/units/templates'
import type { ArmyState, FormationState, LonLat, RecruitItem } from '@/sim/core/types'
import { useProductionStats } from '@/composables/production'
import NkgIcon from './NkgIcon.vue'

/**
 * Volet « Renforts » d'une armée ou d'une division (phase D3, par modèle) : onglet Divisions (divisions
 * entières d'un modèle) et onglet Brigades (brigades d'un modèle pour une division donnée, ou la plus
 * proche qui a une place) ; coût total face au stock, hommes, délai d'arrivée au front, part lancée plus
 * tard si la production manque, casernes utilisées, puis commandes en cours. Depuis la fiche d'une
 * division (`division`), seules ses brigades se commandent.
 */
const props = defineProps<{ army: ArmyState; division?: FormationState | null }>()
const game = useGameStore()
const { economy, snapshot } = storeToRefs(game)
const stats = useProductionStats()

const BRIGADES = Object.values(BRIGADE_TEMPLATES)
const DIVISIONS = Object.values(DIVISION_TEMPLATES)
/** Plafond d'une commande par modèle (saisie directe). */
const MAX_PER_KIND = 200

const brigades = reactive<Record<string, number>>({})
const divisions = reactive<Record<string, number>>({})
/** Division rejointe par les brigades commandées (null : la plus proche qui a une place). */
const target = ref<number | null>(props.division?.id ?? null)
/** Onglet affiché : divisions entières ou brigades. */
const tab = ref<'divisions' | 'brigades'>('brigades')
const clear = (): void => {
  for (const t of BRIGADES) brigades[t.id] = 0
  for (const d of DIVISIONS) divisions[d.id] = 0
}
clear()
// Changer d'armée ou de division remet la commande à zéro.
watch(
  () => [props.army.id, props.division?.id],
  () => {
    clear()
    target.value = props.division?.id ?? null
  },
)

const bump = (bag: Record<string, number>, id: string, n: number): void => {
  bag[id] = Math.max(0, Math.min(MAX_PER_KIND, (bag[id] ?? 0) + n))
}
function setCount(bag: Record<string, number>, id: string, raw: string): void {
  const n = Math.floor(Number(raw))
  bag[id] = Number.isFinite(n) ? Math.max(0, Math.min(MAX_PER_KIND, n)) : 0
}

/** Divisions de l'armée, à rejoindre par les brigades commandées. */
const armyDivisions = computed(() => {
  const s = snapshot.value
  if (!s) return []
  const ids = new Set(props.army.unitIds)
  const used = new Set(s.units.filter((u) => ids.has(u.id)).map((u) => u.divisionId))
  return s.formations
    .filter((f) => f.kind === 'division' && used.has(f.id))
    .sort((a, b) => a.number - b.number)
})
watch(armyDivisions, (list) => {
  if (props.division) return
  if (target.value !== null && !list.some((d) => d.id === target.value)) target.value = null
})

const order = computed(() => ({
  brigades: { ...brigades },
  divisions: props.division ? {} : { ...divisions },
  divisionId: props.division?.id ?? target.value,
}))
const lines = computed(() => expandOrder(order.value))
const total = computed(() => lines.value.length)

const plan = computed(() => {
  const s = snapshot.value
  const eco = economy.value
  if (!s || !eco || total.value === 0) return null
  const positions = new Map(s.units.map((u) => [u.id, [u.lon, u.lat] as LonLat]))
  return planArmyRecruit({
    sites: s.cities
      .filter((c) => c.owner === s.playerCountry && c.buildings.barracks > 0)
      .map((c) => ({
        name: c.name,
        lon: c.lon,
        lat: c.lat,
        barracks: formationSlots(c.buildings.barracks),
      })),
    queue: eco.recruitment,
    anchors: armyAnchors(props.army, (id) => positions.get(id)),
    lines: lines.value,
    stock: eco.production,
    productionPerDay: eco.daily.production,
  })
})

const noBarracks = computed(() => (stats.value?.recruitment.max ?? 0) === 0)
const manpowerShort = computed(
  () => !!plan.value && plan.value.manpower > (economy.value?.manpower ?? 0),
)

async function submit(): Promise<void> {
  if (total.value === 0) return
  const ok = await game.queueArmyRecruit(props.army.id, order.value)
  if (ok) clear()
}

/** Commandes en cours destinées à cette armée (ou à cette division). */
const pending = computed(
  () =>
    economy.value?.recruitment.filter((q) =>
      props.division ? q.divisionId === props.division.id : q.armyId === props.army.id,
    ) ?? [],
)
/** Formations commandées par onglet (pastille). */
const tabCount = (bag: Record<string, number>): number =>
  Object.values(bag).reduce((s, n) => s + n, 0)

/** Part du stock de production que demande la commande (jauge), et dépassement. */
const stockShare = computed(() => {
  const p = plan.value
  const stock = economy.value?.production ?? 0
  if (!p) return { pct: 0, over: false }
  return {
    pct: stock > 0 ? Math.min(100, (100 * p.production) / stock) : 100,
    over: p.shortfall > 0,
  }
})
const brigadeCost = (id: string) => recruitCostOf(BRIGADE_TEMPLATES[id]?.kind ?? 'inf', id)
const costLine = (id: string): string => {
  const c = brigadeCost(id)
  return `${round(c.production)} prod · ${men(c.manpower)} h. · ${c.days} j`
}
const divisionLine = (id: string): string => {
  const list = DIVISION_TEMPLATES[id]?.brigades ?? []
  const prod = list.reduce((s, b) => s + brigadeCost(b).production, 0)
  const man = list.reduce((s, b) => s + brigadeCost(b).manpower, 0)
  return `${list.length} brigades · ${round(prod)} prod · ${men(man)} h.`
}
/** Hommes (la main-d'œuvre se compte en milliers). */
const men = (k: number): string => (Math.round(k * 10) * 100).toLocaleString('fr-FR')
const round = (v: number): string => Math.round(v).toLocaleString('fr-FR')
const pct = (progress: number, cost: number): number => Math.min(100, (100 * progress) / cost)
const itemLabel = (q: RecruitItem): string => {
  const t = q.template ? BRIGADE_TEMPLATES[q.template]?.name : null
  const d = q.divisionTemplate ? DIVISION_TEMPLATES[q.divisionTemplate]?.name : null
  return [t ?? q.kind, d ? `(${d})` : null].filter(Boolean).join(' ')
}
const daysText = (d: number): string => (Number.isFinite(d) ? `≈ ${Math.max(1, d)} j` : 'sans fin')
</script>

<template>
  <div class="army-recruit" data-testid="army-recruit">
    <p v-if="noBarracks" class="warn">
      Aucune caserne : construisez-en une (fiche d'une de vos villes) pour former des unités.
    </p>
    <p v-if="division" class="for" data-testid="recruit-for">
      Brigades pour <strong>{{ division.name }}</strong>
    </p>
    <div v-else class="tabs" role="tablist">
      <button
        class="tab"
        :class="{ on: tab === 'divisions' }"
        role="tab"
        :aria-selected="tab === 'divisions'"
        data-testid="recruit-tab-divisions"
        @click="tab = 'divisions'"
      >
        Divisions<span v-if="tabCount(divisions)" class="badge">{{ tabCount(divisions) }}</span>
      </button>
      <button
        class="tab"
        :class="{ on: tab === 'brigades' }"
        role="tab"
        :aria-selected="tab === 'brigades'"
        data-testid="recruit-tab-brigades"
        @click="tab = 'brigades'"
      >
        Brigades<span v-if="tabCount(brigades)" class="badge">{{ tabCount(brigades) }}</span>
      </button>
    </div>
    <template v-if="division || tab === 'brigades'">
      <label v-if="!division" class="target">
        <span>Pour</span>
        <select v-model="target" data-testid="recruit-division" aria-label="Division rejointe">
          <option :value="null">la division la plus proche qui a une place</option>
          <option v-for="d in armyDivisions" :key="d.id" :value="d.id">{{ d.name }}</option>
        </select>
      </label>
      <ul class="kinds">
        <li v-for="t in BRIGADES" :key="t.id" class="rec" :class="{ picked: brigades[t.id] }">
          <span class="kname" :title="costLine(t.id)"
            >{{ t.name }}<small>{{ costLine(t.id) }}</small></span
          >
          <button
            class="step"
            :disabled="!brigades[t.id]"
            :aria-label="`Retirer : ${t.name}`"
            @click="bump(brigades, t.id, -1)"
          >
            −
          </button>
          <input
            class="count"
            type="number"
            min="0"
            :max="MAX_PER_KIND"
            inputmode="numeric"
            :value="brigades[t.id]"
            :aria-label="`Nombre : ${t.name}`"
            :data-testid="`recruit-count-${t.id}`"
            @change="setCount(brigades, t.id, ($event.target as HTMLInputElement).value)"
          />
          <button
            class="step"
            :aria-label="`Ajouter : ${t.name}`"
            :data-testid="`recruit-add-${t.id}`"
            @click="bump(brigades, t.id, 1)"
          >
            +
          </button>
        </li>
      </ul>
    </template>
    <ul v-else class="kinds">
      <li v-for="d in DIVISIONS" :key="d.id" class="rec" :class="{ picked: divisions[d.id] }">
        <span class="kname" :title="divisionLine(d.id)"
          >{{ d.name }}<small>{{ divisionLine(d.id) }}</small></span
        >
        <button
          class="step"
          :disabled="!divisions[d.id]"
          :aria-label="`Retirer : ${d.name}`"
          @click="bump(divisions, d.id, -1)"
        >
          −
        </button>
        <input
          class="count"
          type="number"
          min="0"
          :max="MAX_PER_KIND"
          inputmode="numeric"
          :value="divisions[d.id]"
          :aria-label="`Nombre : ${d.name}`"
          :data-testid="`recruit-division-count-${d.id}`"
          @change="setCount(divisions, d.id, ($event.target as HTMLInputElement).value)"
        />
        <button
          class="step"
          :aria-label="`Ajouter : ${d.name}`"
          :data-testid="`recruit-division-add-${d.id}`"
          @click="bump(divisions, d.id, 1)"
        >
          +
        </button>
      </li>
    </ul>

    <div class="foot">
      <div v-if="plan" class="preview" data-testid="recruit-preview">
        <div class="row">
          <span class="key">Production</span>
          <span class="num"
            >{{ round(plan.production) }} / stock {{ round(economy?.production ?? 0) }}</span
          >
        </div>
        <div class="bar">
          <div :class="{ over: stockShare.over }" :style="{ width: `${stockShare.pct}%` }" />
        </div>
        <div class="row">
          <span class="key">Hommes</span>
          <span class="num" :class="{ warnc: manpowerShort }"
            >{{ round(plan.manpower) }} k / {{ round(economy?.manpower ?? 0) }} k</span
          >
        </div>
        <div class="row">
          <span class="key">Arrivée au front</span>
          <span class="num" data-testid="recruit-eta">{{ daysText(plan.arrivalDays) }}</span>
        </div>
        <p v-if="plan.shortfall > 0" class="warn" data-testid="recruit-later">
          Il manque {{ round(plan.shortfall) }} de production :
          {{ total - plan.affordable }} formation(s) sur {{ total }} partiront plus tard, dans
          {{ daysText(plan.productionDays) }} au rythme actuel ({{
            round(economy?.daily.production ?? 0)
          }}
          par jour).
        </p>
        <p v-else class="ok">Le stock couvre toute la commande.</p>
        <p v-if="manpowerShort" class="warn">
          Main-d'œuvre insuffisante : seules les premières formations seront lancées.
        </p>
        <p class="meta">
          {{ total }} unité(s) · sortie de caserne {{ daysText(plan.barracksDays) }}, puis trajet
          jusqu'au front.
        </p>
        <ul class="sites" data-testid="recruit-sites">
          <li v-for="c in plan.cities" :key="c.name">
            {{ c.name }} : {{ c.count }}
            <span class="meta"
              >· {{ round(c.distanceKm) }} km<template v-if="c.waiting">
                · {{ c.waiting }} en attente de caserne</template
              ></span
            >
          </li>
        </ul>
      </div>
      <p v-else class="meta">
        Les recrues partent dans les casernes d'où elles rejoindront
        {{ division ? 'la division' : "l'armée" }} le plus tôt (caserne libre proche de son front
        d'abord), puis la rejoignent à leur sortie.
      </p>
      <div class="actions">
        <button
          class="gold"
          :disabled="total === 0 || noBarracks"
          data-testid="recruit-submit"
          @click="submit"
        >
          {{ total > 0 ? `Commander ${total} unité${total > 1 ? 's' : ''}` : 'Commander' }}
        </button>
        <button class="clear" :disabled="total === 0" @click="clear">Effacer</button>
      </div>
    </div>

    <div class="label">Commandes en cours ({{ pending.length }})</div>
    <p v-if="pending.length === 0" class="meta">Aucune</p>
    <ul class="pending" data-testid="recruit-pending">
      <li
        v-for="q in pending"
        :key="q.id"
        :class="{ waiting: !stats?.recruitment.activeIds.has(q.id) }"
      >
        <div class="row">
          <span>{{ itemLabel(q) }} · {{ q.city }}</span>
          <span class="meta">{{
            stats?.recruitment.activeIds.has(q.id)
              ? `${Math.round(pct(q.progress, q.cost))} %`
              : 'en attente de caserne'
          }}</span>
          <button class="x" aria-label="Annuler" @click="game.cancelRecruit(q.id)">
            <NkgIcon name="close" :size="14" />
          </button>
        </div>
        <div class="bar"><div :style="{ width: `${pct(q.progress, q.cost)}%` }" /></div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
/*
 * Charte (docs/charte.md). Le volet est téléporté hors du cadre sur grand écran, mais inclus dans un
 * tiroir sur téléphone : les boutons sont préfixés de quatre classes ou plus pour passer devant le style
 * de bouton par défaut du cadre (GameFrame.vue).
 */
.army-recruit {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--nkg-text);
  font: 13px/1.4 var(--nkg-sans);
}
.kinds,
.sites,
.pending {
  list-style: none;
  margin: 0;
  padding: 0;
}
.kinds {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.for {
  margin: 0;
  color: var(--nkg-text-soft);
}
.for strong {
  color: var(--nkg-brass-pale);
  font-weight: 600;
}
.army-recruit.army-recruit .tabs {
  display: flex;
  border-bottom: 1px solid var(--nkg-brass-line);
}
.army-recruit.army-recruit .tabs .tab {
  flex: 1;
  height: 34px;
  min-height: 0;
  padding: 0 6px;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: none;
  color: var(--nkg-text-muted);
  font: 500 13px var(--nkg-sans);
  cursor: pointer;
}
.army-recruit.army-recruit .tabs .tab:hover:not(:disabled) {
  background: none;
  color: var(--nkg-text);
}
.army-recruit.army-recruit .tabs .tab.on,
.army-recruit.army-recruit .tabs .tab.on:hover {
  border-bottom-color: var(--nkg-brass-light);
  color: var(--nkg-brass-pale);
}
.badge {
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--nkg-brass-deep);
  color: var(--nkg-brass-pale);
  font-size: 11px;
}
.target {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  color: var(--nkg-text-muted);
}
.target select {
  flex: 1;
  min-width: 0;
  height: 30px;
  background: var(--nkg-surface-sunken);
  color: var(--nkg-text);
  border: 1px solid var(--nkg-line-strong);
  border-radius: 4px;
  padding: 0 6px;
  font: inherit;
}
.rec {
  display: grid;
  grid-template-columns: 1fr auto 40px auto;
  gap: 6px;
  align-items: center;
  padding: 7px 8px 7px 10px;
  border: 1px solid var(--nkg-line);
  border-radius: 5px;
  background: var(--nkg-surface);
}
.rec.picked {
  border-color: var(--nkg-brass-dark);
}
.kname {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  font-weight: 500;
}
.kname small {
  color: var(--nkg-text-faint);
  font-size: 11.5px;
  font-weight: 400;
  overflow: hidden;
  text-overflow: ellipsis;
}
.army-recruit.army-recruit .rec .step {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  min-height: 0;
  padding: 0;
  border: 1px solid var(--nkg-line-strong);
  border-radius: 4px;
  background: var(--nkg-tile-bg);
  color: var(--nkg-text);
  font: 500 16px/1 var(--nkg-sans);
  cursor: pointer;
}
.army-recruit.army-recruit .rec .step:hover:not(:disabled) {
  border-color: var(--nkg-brass);
}
.army-recruit.army-recruit .rec .step:disabled {
  opacity: 0.4;
  cursor: default;
}
.count {
  width: 40px;
  height: 30px;
  box-sizing: border-box;
  padding: 0 2px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--nkg-text-faint);
  font: 600 13px var(--nkg-sans);
  font-variant-numeric: tabular-nums;
  text-align: center;
  appearance: textfield;
  -moz-appearance: textfield;
}
.count::-webkit-outer-spin-button,
.count::-webkit-inner-spin-button {
  margin: 0;
  -webkit-appearance: none;
}
.count:hover,
.count:focus {
  border-color: var(--nkg-line-strong);
  background: var(--nkg-surface-sunken);
  outline: none;
}
.rec.picked .count {
  color: var(--nkg-brass-pale);
}
.foot {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px 12px;
  border: 1px solid var(--nkg-brass-line);
  border-radius: 5px;
  background: var(--nkg-surface-sunken);
}
.preview {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.preview p {
  margin: 0;
}
.key {
  color: var(--nkg-text-muted);
}
.num {
  font-variant-numeric: tabular-nums;
  font-size: 12.5px;
}
.ok {
  color: var(--nkg-good-text);
  font-size: 12px;
}
.warnc {
  color: var(--nkg-warn-text);
}
.preview .bar {
  height: 6px;
  border-radius: 3px;
  background: #2b333e;
  overflow: hidden;
}
.preview .bar div {
  height: 100%;
  background: var(--nkg-good);
}
.preview .bar div.over {
  background: var(--nkg-warn);
}
.actions {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}
.army-recruit.army-recruit .actions .gold {
  flex: 1;
  height: 38px;
  border: 1px solid var(--nkg-brass-pale);
  border-radius: 4px;
  background: var(--nkg-gold-bg);
  color: #1a140a;
  font: 600 13px var(--nkg-sans);
  cursor: pointer;
}
.army-recruit.army-recruit .actions .gold:hover:not(:disabled) {
  background: var(--nkg-gold-bg);
  border-color: #fff3d0;
  filter: brightness(1.06);
}
.army-recruit.army-recruit .actions .clear {
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--nkg-line-strong);
  border-radius: 4px;
  background: var(--nkg-tile-bg);
  color: var(--nkg-text-soft);
  font: 500 13px var(--nkg-sans);
  cursor: pointer;
}
.army-recruit.army-recruit .actions .clear:hover:not(:disabled) {
  border-color: var(--nkg-brass);
}
.army-recruit.army-recruit .actions button:disabled {
  opacity: 0.45;
  cursor: default;
  filter: none;
}
.label {
  margin-top: 4px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--nkg-label);
}
.meta {
  margin: 0;
  color: var(--nkg-text-faint);
  font-size: 12px;
}
.warn {
  margin: 0;
  color: var(--nkg-warn-text);
  font-size: 12px;
}
.pending {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pending li {
  padding: 6px 8px 7px 10px;
  border: 1px solid var(--nkg-line);
  border-radius: 5px;
  background: var(--nkg-surface);
}
.pending li.waiting {
  opacity: 0.6;
}
.row {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: space-between;
}
.army-recruit.army-recruit .pending .x {
  display: grid;
  place-items: center;
  flex: none;
  width: 24px;
  height: 24px;
  min-height: 0;
  padding: 0;
  border: 1px solid var(--nkg-line);
  border-radius: 4px;
  background: var(--nkg-surface-raised);
  color: var(--nkg-text-muted);
  cursor: pointer;
}
.army-recruit.army-recruit .pending .x:hover {
  border-color: var(--nkg-danger-line);
  color: #f0b0a5;
}
.pending .bar {
  height: 3px;
  margin-top: 5px;
  background: #2b333e;
  border-radius: 2px;
  overflow: hidden;
}
.pending .bar div {
  height: 100%;
  background: var(--nkg-brass);
}
</style>
