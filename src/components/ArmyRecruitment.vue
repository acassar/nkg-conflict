<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/game'
import { formationSlots, recruitCostOf } from '@/sim/economy/rules'
import { armyAnchors, expandOrder, planArmyRecruit } from '@/sim/economy/armyRecruit'
import { BRIGADE_TEMPLATES, DIVISION_TEMPLATES } from '@/sim/units/templates'
import type { ArmyState, LonLat, RecruitItem } from '@/sim/core/types'
import { useProductionStats } from '@/composables/production'

/**
 * Onglet « Renforts » d'une armée, seul point d'entrée du recrutement (phase D3, par modèle) : brigades
 * d'un modèle pour une division donnée (ou la plus proche qui a une place), divisions entières d'un
 * modèle de division ; coût total face au stock, hommes, délai d'arrivée au front, part lancée plus tard
 * si la production manque, casernes utilisées, puis commandes en cours de cette armée.
 */
const props = defineProps<{ army: ArmyState }>()
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
const target = ref<number | null>(null)
const clear = (): void => {
  for (const t of BRIGADES) brigades[t.id] = 0
  for (const d of DIVISIONS) divisions[d.id] = 0
}
clear()
// Changer d'armée remet la commande à zéro.
watch(
  () => props.army.id,
  () => {
    clear()
    target.value = null
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
  if (target.value !== null && !list.some((d) => d.id === target.value)) target.value = null
})

const order = computed(() => ({
  brigades: { ...brigades },
  divisions: { ...divisions },
  divisionId: target.value,
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

/** Commandes en cours destinées à cette armée. */
const pending = computed(
  () => economy.value?.recruitment.filter((q) => q.armyId === props.army.id) ?? [],
)

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
    <div class="label">Brigades par modèle</div>
    <label class="target">
      <span>Pour</span>
      <select v-model="target" data-testid="recruit-division" aria-label="Division rejointe">
        <option :value="null">la division la plus proche qui a une place</option>
        <option v-for="d in armyDivisions" :key="d.id" :value="d.id">{{ d.name }}</option>
      </select>
    </label>
    <ul class="kinds">
      <li v-for="t in BRIGADES" :key="t.id">
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
    <div class="label">Divisions entières</div>
    <ul class="kinds">
      <li v-for="d in DIVISIONS" :key="d.id">
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

    <div v-if="plan" class="preview" data-testid="recruit-preview">
      <div class="row">
        <span>Production</span>
        <span class="num"
          >{{ round(plan.production) }} / stock {{ round(economy?.production ?? 0) }}</span
        >
      </div>
      <div class="bar">
        <div :class="{ over: stockShare.over }" :style="{ width: `${stockShare.pct}%` }" />
      </div>
      <div class="row">
        <span>Hommes</span>
        <span class="num" :class="{ warnc: manpowerShort }"
          >{{ round(plan.manpower) }} k / {{ round(economy?.manpower ?? 0) }} k</span
        >
      </div>
      <div class="row">
        <span>Arrivée au front</span>
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
    <div class="actions">
      <button
        class="primary"
        :disabled="total === 0 || noBarracks"
        data-testid="recruit-submit"
        @click="submit"
      >
        {{ total > 0 ? `Commander ${total} unité${total > 1 ? 's' : ''}` : 'Commander' }}
      </button>
      <button :disabled="total === 0" @click="clear">Effacer</button>
    </div>
    <p class="meta">
      Les recrues partent dans les casernes d'où elles rejoindront l'armée le plus tôt (caserne
      libre proche de son front d'abord), puis la rejoignent à leur sortie.
    </p>

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
          <button class="x" aria-label="Annuler" @click="game.cancelRecruit(q.id)">×</button>
        </div>
        <div class="bar"><div :style="{ width: `${pct(q.progress, q.cost)}%` }" /></div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.kinds,
.sites,
.pending {
  list-style: none;
  margin: 0;
  padding: 0;
}
.target {
  display: flex;
  gap: 6px;
  align-items: center;
  margin: 4px 0 6px;
  font-size: 12px;
}
.target select {
  flex: 1;
  min-width: 0;
  background: #14181f;
  color: inherit;
  border: 1px solid #3b4250;
  border-radius: 6px;
  padding: 3px 4px;
}
.kinds li {
  display: grid;
  grid-template-columns: 1fr auto 56px auto;
  gap: 4px;
  align-items: center;
  margin-bottom: 4px;
}
.kname {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}
.kname small {
  color: #9aa3b2;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.num {
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 12px;
}
.ok {
  color: #3fb37f;
  font-size: 12px;
  margin: 4px 0;
}
.warnc {
  color: #fbbf24;
}
.preview .bar {
  height: 5px;
  margin: 2px 0 6px;
}
.bar div.over {
  background: #f2a33a;
}
.step {
  min-width: 30px;
}
input[type='number'] {
  width: 56px;
  box-sizing: border-box;
  background: #14181f;
  color: inherit;
  border: 1px solid #3b4250;
  border-radius: 6px;
  padding: 3px 4px;
  font: inherit;
  text-align: center;
}
.preview {
  margin: 8px 0 4px;
  padding: 6px 8px;
  border: 1px solid #2c323c;
  border-radius: 6px;
  background: rgba(37, 99, 235, 0.08);
}
.preview p {
  margin: 0 0 4px;
}
.actions {
  display: flex;
  gap: 6px;
  margin: 6px 0;
}
.primary {
  background: #2563eb;
  border-color: #2563eb;
}
.label {
  margin-top: 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #9aa3b2;
}
.meta {
  color: #9aa3b2;
  font-size: 12px;
}
.warn {
  color: #fbbf24;
  font-size: 12px;
  margin: 4px 0;
}
.pending li {
  margin: 4px 0;
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
.x {
  padding: 0 6px;
}
.bar {
  height: 3px;
  background: #2c323c;
  border-radius: 2px;
  overflow: hidden;
}
.bar div {
  height: 100%;
  background: #60a5fa;
}
</style>
