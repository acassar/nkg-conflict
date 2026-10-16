<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useGameStore } from '@/stores/game'
import type { BattleReport, BattleUnit } from '@/sim/core/types'
import { templateLabel } from '@/sim/units/templates'
import { POSTURES } from '@/sim/units/postures'
import { isMobile } from '@/composables/layout'
import { openHelp } from '@/composables/help'
import { MODIFIER_HELP } from '@/help/rules'
import type { ModifierKey } from '@/sim/core/types'
import NkgIcon from './NkgIcon.vue'

const game = useGameStore()
const report = ref<BattleReport | null>(null)
/** Effectifs à l'ouverture de la fenêtre, pour afficher les pertes depuis. */
const initial = new Map<number, number>()
const expanded = ref<number | null>(null)
/** Modificateur dont l'explication est dépliée (unité et clé), au toucher comme au clic. */
const explained = ref<string | null>(null)
const explainKey = (id: number, side: string, key: ModifierKey): string => `${id}:${side}:${key}`
function toggleExplain(k: string): void {
  explained.value = explained.value === k ? null : k
}
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
/** Rapport de force lisible : « 2,8 contre 1 » en faveur du camp le plus fort. */
const ratioText = computed(() => {
  const b = balance.value
  const r = b >= 0.5 ? b / Math.max(0.0001, 1 - b) : (1 - b) / Math.max(0.0001, b)
  const n = r.toLocaleString('fr-FR', { maximumFractionDigits: 1 })
  return b >= 0.5 ? `${n} contre 1` : `1 contre ${n}`
})
const role = (units: BattleUnit[]): string =>
  units.some((u) => u.attacking) ? 'Attaque' : 'Défend'
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
        <button
          class="icon"
          title="Règles du combat et des modificateurs"
          aria-label="Aide"
          data-testid="battle-help"
          @click="openHelp('combat')"
        >
          <NkgIcon name="info" :size="16" />
        </button>
        <button title="Centrer la carte sur la bataille" @click="focus">
          {{ isMobile ? 'Voir' : 'Voir sur la carte' }}
        </button>
        <button class="icon" aria-label="Fermer" @click="game.closeBattle()">
          <NkgIcon name="close" :size="16" />
        </button>
      </div>
    </header>

    <p v-if="!report" class="meta">Plus de combat ici.</p>
    <template v-else>
      <!-- Les deux camps de part et d'autre du rapport de force. -->
      <div v-if="sides.length === 2" class="versus">
        <div class="camp a">
          <span class="camp-name">{{ sides[0]?.title }}</span>
          <span class="camp-meta"
            >{{ role(sides[0]?.units ?? []) }} · {{ sides[0]?.units.length }} unité(s)</span
          >
        </div>
        <div class="ratio" :title="`Rapport de force : ${pct(balance)} en faveur du premier camp`">
          <div class="balance"><span :style="{ width: `${balance * 100}%` }" /></div>
          <span class="ratio-text">Rapport de force {{ ratioText }}</span>
        </div>
        <div class="camp b">
          <span class="camp-name">{{ sides[1]?.title }}</span>
          <span class="camp-meta"
            >{{ role(sides[1]?.units ?? []) }} · {{ sides[1]?.units.length }} unité(s)</span
          >
        </div>
      </div>
      <div
        v-else
        class="balance"
        :title="`Rapport de force : ${pct(balance)} en faveur du premier camp`"
      >
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
          <ul
            title="Cliquez une unité pour voir ses modificateurs, puis un modificateur pour son explication"
          >
            <li
              v-for="u in side.units"
              :key="u.id"
              :class="{ routed: u.routed, open: expanded === u.id }"
              @click="expanded = expanded === u.id ? null : u.id"
            >
              <div class="row">
                <span class="uname">{{ u.name }}</span>
                <span class="meta">
                  {{ templateLabel(u) }} · {{ POSTURES[u.posture].name }}
                  <template v-if="u.attacking"> · attaque</template>
                  <template v-if="u.routed"> · en déroute</template>
                  <template v-if="u.obstacles >= 0.01">
                    · obstacles {{ pct(u.obstacles) }}</template
                  >
                  <template v-if="u.flank">
                    · <span class="flank">{{ u.flank }}</span></template
                  >
                </span>
              </div>
              <div class="row">
                <span class="gauge" :title="`Effectifs ${pct(u.strength)}`">
                  <i class="strength" :style="{ width: `${u.strength * 100}%` }" />
                </span>
                <span class="gauge" :title="`Matériel ${pct(u.equipment)}`">
                  <i class="equipment" :style="{ width: `${u.equipment * 100}%` }" />
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
                  <template v-for="m in u.modifiers.attack" :key="m.label">
                    <div
                      class="mod"
                      :title="MODIFIER_HELP[m.key].text"
                      data-testid="battle-modifier"
                      @click.stop="toggleExplain(explainKey(u.id, 'attack', m.key))"
                    >
                      <span class="mlabel">{{ m.label }}</span>
                      <span :class="{ up: m.value > 1.001, down: m.value < 0.999 }">{{
                        factor(m.value)
                      }}</span>
                    </div>
                    <div
                      v-if="explained === explainKey(u.id, 'attack', m.key)"
                      class="explain"
                      data-testid="battle-modifier-help"
                    >
                      {{ MODIFIER_HELP[m.key].text }}
                      <button class="more" @click.stop="openHelp(MODIFIER_HELP[m.key].section)">
                        Règles
                      </button>
                    </div>
                  </template>
                </div>
                <div>
                  <strong>Défense</strong>
                  <template v-for="m in u.modifiers.defense" :key="m.label">
                    <div
                      class="mod"
                      :title="MODIFIER_HELP[m.key].text"
                      data-testid="battle-modifier"
                      @click.stop="toggleExplain(explainKey(u.id, 'defense', m.key))"
                    >
                      <span class="mlabel">{{ m.label }}</span>
                      <span :class="{ up: m.value > 1.001, down: m.value < 0.999 }">{{
                        factor(m.value)
                      }}</span>
                    </div>
                    <div
                      v-if="explained === explainKey(u.id, 'defense', m.key)"
                      class="explain"
                      data-testid="battle-modifier-help"
                    >
                      {{ MODIFIER_HELP[m.key].text }}
                      <button class="more" @click.stop="openHelp(MODIFIER_HELP[m.key].section)">
                        Règles
                      </button>
                    </div>
                  </template>
                </div>
              </div>
            </li>
          </ul>
        </section>
      </div>
      <p v-if="isMobile" class="meta foot">
        Touchez ou cliquez une unité pour voir ses modificateurs, puis un modificateur pour son
        explication.
      </p>
    </template>
  </div>
</template>

<style scoped>
.flank {
  color: #fca5a5;
}
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
.gauge .equipment {
  background: #f59e0b;
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
  cursor: help;
}
.mod:hover .mlabel {
  text-decoration: underline dotted;
}
.explain {
  margin: 2px 0 4px;
  padding: 4px 6px;
  background: #11151b;
  border-radius: 4px;
  color: #cbd2dc;
  font-size: 11px;
  line-height: 1.35;
}
.explain .more {
  margin-left: 4px;
  padding: 0 6px;
  font-size: 11px;
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
/* Grand écran (charte : docs/charte.md). */
.battle:not(.mobile) {
  top: 80px;
  width: min(760px, calc(100% - 420px));
  padding: 14px 16px 16px;
}
/* Téléphone compris : même habillage, seule la place change. */
.battle.battle {
  background: var(--nkg-panel-bg);
  color: var(--nkg-text);
  border: 1px solid var(--nkg-brass-dark);
  border-radius: 4px;
  box-shadow: var(--nkg-panel-shadow);
  font: 13px/1.4 var(--nkg-sans);
}
.battle.battle header strong {
  font-family: var(--nkg-serif);
  font-size: 22px;
  font-weight: 600;
}
.battle.battle header .meta {
  color: #a99a7a;
  font-size: 12.5px;
}
.battle.battle .actions {
  align-items: center;
}
.battle.battle button {
  height: 32px;
  padding: 0 12px;
  background: var(--nkg-tile-bg);
  border: 1px solid var(--nkg-line-strong);
  border-radius: 4px;
}
.battle.battle button:hover {
  border-color: var(--nkg-brass);
}
.battle.battle button.icon {
  display: grid;
  place-items: center;
  width: 32px;
  padding: 0;
  color: var(--nkg-text-soft);
}
.versus {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 14px;
  padding: 4px 0 14px;
  margin-bottom: 12px;
  border-bottom: 1px solid transparent;
  border-image: var(--nkg-divider) 1;
}
.camp {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.camp.b {
  align-items: flex-end;
  text-align: right;
}
.camp-name {
  font-family: var(--nkg-serif);
  font-size: 18px;
  font-weight: 600;
}
.camp.a .camp-name {
  color: var(--nkg-player-line);
}
.camp.b .camp-name {
  color: #f0a39a;
}
.camp-meta {
  font-size: 12.5px;
  color: var(--nkg-text-muted);
}
.ratio {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 260px;
}
.ratio .balance {
  width: 100%;
  height: 12px;
  margin: 0;
  border: 1px solid var(--nkg-brass-dark);
  border-radius: 2px;
  background: var(--nkg-bad);
}
.ratio .balance span {
  background: var(--nkg-player);
}
.ratio-text {
  font-size: 12px;
  color: #c9bfa8;
}
.battle.battle .side h3 {
  display: none;
}
.battle.battle .totals {
  font-size: 12px;
  color: var(--nkg-text-muted);
}
.battle.battle .loss {
  color: var(--nkg-bad-text);
}
.battle.battle li {
  padding: 8px 10px;
  margin-bottom: 6px;
  background: var(--nkg-tile-bg);
  border: 1px solid var(--nkg-line-strong);
  border-radius: 5px;
}
.battle.battle li:hover {
  border-color: var(--nkg-brass);
}
.battle.battle li.open {
  background: var(--nkg-tile-on-bg);
  border-color: var(--nkg-brass-light);
}
.battle.battle .gauge {
  background: #2b333e;
}
.battle.battle .gauge .strength {
  background: var(--nkg-good);
}
.battle.battle .gauge .equipment {
  background: var(--nkg-warn);
}
.battle.battle .gauge .org {
  background: #5b8fd9;
}
.battle.battle .mods {
  padding: 6px 10px 8px;
  background: var(--nkg-surface-sunken);
  border: 1px solid #2e3540;
  border-radius: 5px;
}
.battle.battle .mods strong {
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--nkg-label);
}
.battle.battle .explain {
  background: #0e1217;
}
.battle.battle .explain .more {
  height: 22px;
  padding: 0 8px;
}
.battle.battle .up {
  color: var(--nkg-good-text);
}
.battle.battle .down {
  color: var(--nkg-bad-text);
}
.battle.mobile .versus {
  gap: 8px;
}
.battle.mobile .ratio {
  width: 96px;
}
.battle.mobile .camp-name {
  font-size: 15px;
}
</style>
