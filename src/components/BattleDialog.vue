<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useGameStore } from '@/stores/game'
import type { BattleReport, BattleUnit } from '@/sim/core/types'
import { MODERN_CATALOG } from '@/sim/units/catalog'
import { POSTURES } from '@/sim/units/postures'
import { isMobile } from '@/composables/layout'

const game = useGameStore()
const report = ref<BattleReport | null>(null)
/** Effectifs à l'ouverture de la fenêtre, pour afficher les pertes depuis. */
const initial = new Map<number, number>()
const expanded = ref<number | null>(null)
let busy = false
let lastFetch = 0

async function refresh(force = false): Promise<void> {
  if (busy || !game.battleIds) return
  const now = performance.now()
  if (!force && now - lastFetch < 400) return
  busy = true
  lastFetch = now
  try {
    const next = await game.fetchBattle()
    report.value = next
    for (const u of [...(next?.a ?? []), ...(next?.b ?? [])]) {
      if (!initial.has(u.id)) initial.set(u.id, u.strength)
    }
  } finally {
    busy = false
  }
}

watch(
  () => game.battleIds?.join(),
  (key, before) => {
    if (key && !before) {
      initial.clear()
      report.value = null
      void refresh(true)
    }
    if (!key) report.value = null
  },
)
watch(
  () => game.snapshot?.tick,
  () => void refresh(),
)
onBeforeUnmount(() => game.closeBattle())

const name = (c: string): string => game.countryByCode.get(c)?.name ?? c
const pct = (v: number): string => `${Math.round(v * 100)} %`
const factor = (v: number): string => `×${v.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`
const loss = (u: BattleUnit): number => Math.max(0, (initial.get(u.id) ?? u.strength) - u.strength)

interface SideView {
  title: string
  units: BattleUnit[]
  fire: number
  defense: number
  losses: number
}
const sides = computed<SideView[]>(() => {
  const r = report.value
  if (!r) return []
  const view = (units: BattleUnit[]): SideView => ({
    title: [...new Set(units.map((u) => name(u.owner)))].join(', '),
    units,
    fire: units.reduce((s, u) => s + u.firePower, 0),
    defense: units.reduce((s, u) => s + u.defense, 0),
    losses: units.reduce((s, u) => s + loss(u), 0),
  })
  return [view(r.a), view(r.b)]
})
/** Rapport de force : feu de A sur défense de B, comparé au feu de B sur défense de A. */
const balance = computed(() => {
  const [a, b] = sides.value
  if (!a || !b) return 0.5
  const ra = a.fire / Math.max(0.05, b.defense)
  const rb = b.fire / Math.max(0.05, a.defense)
  return ra / Math.max(0.0001, ra + rb)
})
const river = computed(() =>
  [...(report.value?.a ?? []), ...(report.value?.b ?? [])].some((u) => u.riverCrossing),
)
function focus(): void {
  const r = report.value
  if (r) game.focus = { at: [r.lon, r.lat], zoom: 8, nonce: Date.now() }
}
</script>

<template>
  <div
    v-if="game.battleIds"
    class="battle"
    :class="{ mobile: isMobile }"
    role="dialog"
    aria-label="Bataille en cours"
    data-testid="battle-dialog"
  >
    <header>
      <div>
        <strong>Bataille près de {{ report?.place ?? '…' }}</strong>
        <div class="meta">
          {{ report?.terrain }}
          <template v-if="river">
            · franchissement de fleuve (défense de l'adversaire +40 %)</template
          >
        </div>
      </div>
      <div class="actions">
        <button title="Centrer la carte sur la bataille" @click="focus">Voir</button>
        <button aria-label="Fermer" @click="game.closeBattle()">✕</button>
      </div>
    </header>

    <p v-if="!report" class="meta">Plus de combat ici.</p>
    <template v-else>
      <div class="balance" :title="`Rapport de force : ${pct(balance)} en faveur du premier camp`">
        <span :style="{ width: `${balance * 100}%` }" />
      </div>
      <div class="sides">
        <section v-for="(side, k) in sides" :key="k" class="side" :class="k === 0 ? 'a' : 'b'">
          <h3>{{ side.title }}</h3>
          <div class="totals">
            <span title="Somme des puissances de feu">Feu {{ side.fire.toFixed(2) }}</span>
            <span title="Somme des valeurs défensives">Défense {{ side.defense.toFixed(2) }}</span>
            <span title="Effectifs perdus depuis l'ouverture de cette fenêtre" class="loss">
              Pertes {{ pct(side.losses) }} d'unité
            </span>
          </div>
          <ul>
            <li
              v-for="u in side.units"
              :key="u.id"
              :class="{ routed: u.routed }"
              @click="expanded = expanded === u.id ? null : u.id"
            >
              <div class="row">
                <span class="uname">{{ u.name }}</span>
                <span class="meta">
                  {{ MODERN_CATALOG[u.kind].name }} · {{ POSTURES[u.posture].name }}
                  <template v-if="u.attacking"> · attaque</template>
                  <template v-if="u.routed"> · en déroute</template>
                  <template v-if="u.obstacles >= 0.01">
                    · obstacles {{ pct(u.obstacles) }}</template
                  >
                </span>
              </div>
              <div class="row">
                <span class="gauge" :title="`Effectifs ${pct(u.strength)}`">
                  <i class="strength" :style="{ width: `${u.strength * 100}%` }" />
                </span>
                <span class="gauge" :title="`Organisation ${pct(u.org)}`">
                  <i class="org" :style="{ width: `${u.org * 100}%` }" />
                </span>
                <span class="meta nums"
                  >feu {{ u.firePower.toFixed(2) }} · déf. {{ u.defense.toFixed(2) }}</span
                >
              </div>
              <div v-if="expanded === u.id" class="mods">
                <div>
                  <strong>Attaque</strong>
                  <div v-for="m in u.modifiers.attack" :key="m.label" class="mod">
                    <span>{{ m.label }}</span>
                    <span :class="{ up: m.value > 1.001, down: m.value < 0.999 }">{{
                      factor(m.value)
                    }}</span>
                  </div>
                </div>
                <div>
                  <strong>Défense</strong>
                  <div v-for="m in u.modifiers.defense" :key="m.label" class="mod">
                    <span>{{ m.label }}</span>
                    <span :class="{ up: m.value > 1.001, down: m.value < 0.999 }">{{
                      factor(m.value)
                    }}</span>
                  </div>
                </div>
              </div>
            </li>
          </ul>
        </section>
      </div>
      <p class="meta foot">Touchez ou cliquez une unité pour voir ses modificateurs.</p>
    </template>
  </div>
</template>

<style scoped>
.battle {
  position: absolute;
  left: 50%;
  top: 70px;
  transform: translateX(-50%);
  z-index: 26;
  width: min(720px, calc(100% - 380px));
  max-height: calc(100% - 140px);
  overflow: auto;
  background: rgba(17, 21, 27, 0.97);
  color: #e8eaed;
  border: 1px solid #3b4250;
  border-radius: 10px;
  padding: 12px 14px;
  font:
    13px/1.35 system-ui,
    sans-serif;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}
.battle.mobile {
  left: 6px;
  right: 6px;
  top: calc(52px + env(safe-area-inset-top));
  transform: none;
  width: auto;
  max-height: 60%;
  z-index: 26;
}
header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.actions {
  display: flex;
  gap: 6px;
  align-items: flex-start;
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
.meta {
  color: #9aa3af;
  font-size: 12px;
}
.balance {
  height: 8px;
  border-radius: 4px;
  background: #dc2626;
  overflow: hidden;
  margin-bottom: 10px;
}
.balance span {
  display: block;
  height: 100%;
  background: #2563eb;
}
.sides {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.battle.mobile .sides {
  grid-template-columns: 1fr;
}
.side h3 {
  margin: 0 0 4px;
  font-size: 14px;
}
.side.a h3 {
  color: #93b4f5;
}
.side.b h3 {
  color: #fca5a5;
}
.totals {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  font-variant-numeric: tabular-nums;
  margin-bottom: 6px;
}
.loss {
  color: #fca5a5;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
li {
  padding: 6px 8px;
  margin-bottom: 4px;
  background: #1b2028;
  border-radius: 6px;
  cursor: pointer;
}
li.routed {
  opacity: 0.6;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.uname {
  font-weight: 600;
}
.nums {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.gauge {
  flex: 1;
  height: 5px;
  background: #2c323c;
  border-radius: 3px;
  overflow: hidden;
  max-width: 90px;
}
.gauge i {
  display: block;
  height: 100%;
}
.gauge .strength {
  background: #22c55e;
}
.gauge .org {
  background: #3b82f6;
}
.mods {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 6px;
  font-size: 12px;
}
.mod {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  color: #cbd2dc;
}
.up {
  color: #6ee7b7;
}
.down {
  color: #fca5a5;
}
.foot {
  margin: 6px 0 0;
}
</style>
