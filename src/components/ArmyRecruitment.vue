<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/game'
import { RECRUIT_COSTS } from '@/sim/economy/rules'
import { armyAnchors, expandOrder, planArmyRecruit } from '@/sim/economy/armyRecruit'
import { MODERN_CATALOG } from '@/sim/units/catalog'
import type { ArmyState, LonLat, UnitKind } from '@/sim/core/types'
import { useProductionStats } from '@/composables/production'

/**
 * Onglet « Renforts » d'une armée, seul point d'entrée du recrutement : commande par type d'unité,
 * coût total face au stock, hommes, délai d'arrivée au front, part lancée plus tard si la production
 * manque, casernes utilisées, puis commandes en cours de cette armée.
 */
const props = defineProps<{ army: ArmyState }>()
const game = useGameStore()
const { economy, snapshot } = storeToRefs(game)
const stats = useProductionStats()

const UNIT_KINDS = Object.keys(RECRUIT_COSTS) as UnitKind[]
/** Plafond d'une commande par type (saisie directe). */
const MAX_PER_KIND = 200

const order = reactive<Record<UnitKind, number>>(
  Object.fromEntries(UNIT_KINDS.map((k) => [k, 0])) as Record<UnitKind, number>,
)
const clear = (): void => {
  for (const k of UNIT_KINDS) order[k] = 0
}
// Changer d'armée remet la commande à zéro.
watch(() => props.army.id, clear)

const add = (kind: UnitKind, n: number): void => {
  order[kind] = Math.max(0, Math.min(MAX_PER_KIND, order[kind] + n))
}
function setCount(kind: UnitKind, raw: string): void {
  const n = Math.floor(Number(raw))
  order[kind] = Number.isFinite(n) ? Math.max(0, Math.min(MAX_PER_KIND, n)) : 0
}

const total = computed(() => UNIT_KINDS.reduce((n, k) => n + order[k], 0))

const plan = computed(() => {
  const s = snapshot.value
  const eco = economy.value
  if (!s || !eco || total.value === 0) return null
  const positions = new Map(s.units.map((u) => [u.id, [u.lon, u.lat] as LonLat]))
  return planArmyRecruit({
    sites: s.cities
      .filter((c) => c.owner === s.playerCountry && c.buildings.barracks > 0)
      .map((c) => ({ name: c.name, lon: c.lon, lat: c.lat, barracks: c.buildings.barracks })),
    queue: eco.recruitment,
    anchors: armyAnchors(props.army, (id) => positions.get(id)),
    kinds: expandOrder(order, UNIT_KINDS),
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
  const ok = await game.queueArmyRecruit(props.army.id, { ...order })
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
const costLine = (kind: UnitKind): string => {
  const c = RECRUIT_COSTS[kind]
  return `${c.production} prod · ${c.manpower} k h. · ${c.days} j`
}
const round = (v: number): string => Math.round(v).toLocaleString('fr-FR')
const pct = (progress: number, cost: number): number => Math.min(100, (100 * progress) / cost)
const unitLabel = (kind: UnitKind): string => MODERN_CATALOG[kind].name
const daysText = (d: number): string => (Number.isFinite(d) ? `≈ ${Math.max(1, d)} j` : 'sans fin')
</script>

<template>
  <div class="army-recruit" data-testid="army-recruit">
    <p v-if="noBarracks" class="warn">
      Aucune caserne : construisez-en une (fiche d'une de vos villes) pour former des unités.
    </p>
    <ul class="kinds">
      <li v-for="kind in UNIT_KINDS" :key="kind">
        <span
          class="kname"
          :title="`${RECRUIT_COSTS[kind].production} production, ${RECRUIT_COSTS[kind].manpower} k hommes, ${RECRUIT_COSTS[kind].days} jours minimum`"
          >{{ unitLabel(kind) }}<small>{{ costLine(kind) }}</small></span
        >
        <button
          class="step"
          :disabled="order[kind] === 0"
          :aria-label="`Retirer : ${unitLabel(kind)}`"
          @click="add(kind, -1)"
        >
          −
        </button>
        <input
          type="number"
          min="0"
          :max="MAX_PER_KIND"
          inputmode="numeric"
          :value="order[kind]"
          :aria-label="`Nombre : ${unitLabel(kind)}`"
          :data-testid="`recruit-count-${kind}`"
          @change="setCount(kind, ($event.target as HTMLInputElement).value)"
        />
        <button
          class="step"
          :aria-label="`Ajouter : ${unitLabel(kind)}`"
          :data-testid="`recruit-add-${kind}`"
          @click="add(kind, 1)"
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
          <span>{{ unitLabel(q.kind) }} · {{ q.city }}</span>
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
