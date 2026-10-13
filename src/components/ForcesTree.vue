<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useGameStore } from '@/stores/game'
import {
  forcesCrumbs,
  forcesRows,
  openRow,
  type ForcesPath,
  type ForcesRow,
} from '@/composables/composition'
import EchelonSymbol from './EchelonSymbol.vue'
import TemplatesView from './TemplatesView.vue'

/**
 * Vue Forces hiérarchique (phase D3) : les armées, puis, d'un clic, leurs corps, leurs divisions et
 * leurs brigades ; un fil d'Ariane (Forces › 1re armée › IIe corps) permet de remonter. Chaque ligne :
 * symbole de l'échelon, nom, jauges effectifs, matériel, organisation et situation. Ouvrir une ligne
 * sélectionne aussi la formation (fiche d'armée, ou inspecteur pour un corps ou une division) ; une
 * brigade se sélectionne seule. Onglet « Modèles » : modèles de brigade et de division.
 */
const props = defineProps<{ armyStatus: (id: number) => string }>()
const game = useGameStore()

const tab = ref<'tree' | 'templates'>('tree')
const path = ref<ForcesPath>({})
const snapshot = computed(() => game.snapshot)
const mine = computed(() => {
  const s = snapshot.value
  if (!s) return { units: [], armies: [], formations: [] }
  const me = s.playerCountry
  return {
    units: s.units.filter((u) => u.owner === me),
    armies: s.armies.filter((a) => a.owner === me),
    formations: s.formations.filter((f) => f.owner === me),
  }
})
// Une armée ou une formation disparue ramène au niveau des armées.
watch(mine, (m) => {
  const p = path.value
  if (p.army !== undefined && !m.armies.some((a) => a.id === p.army)) path.value = {}
  else if (
    (p.corps !== undefined && !m.formations.some((f) => f.id === p.corps)) ||
    (p.division !== undefined && !m.formations.some((f) => f.id === p.division))
  )
    path.value = p.army !== undefined ? { army: p.army } : {}
})
const rows = computed(() =>
  forcesRows(path.value, mine.value.units, mine.value.formations, mine.value.armies),
)
const crumbs = computed(() => forcesCrumbs(path.value, mine.value.formations, mine.value.armies))
const color = computed(() => {
  const s = snapshot.value
  const c = s?.countries.find((x) => x.id === s.playerCountry)?.color
  return c ? `rgb(${c.join(',')})` : '#2563eb'
})

function open(r: ForcesRow): void {
  if (r.echelon === 'army') game.selectArmy(r.id)
  else game.selectUnits(r.unitIds, false)
  if (r.open) path.value = openRow(path.value, r, mine.value.formations)
}
function goTo(p: ForcesPath): void {
  path.value = p
  if (p.division !== undefined || p.corps !== undefined) {
    const id = p.division ?? p.corps
    const r = forcesRows(
      { army: p.army },
      mine.value.units,
      mine.value.formations,
      mine.value.armies,
    ).find((x) => x.id === id && x.echelon !== 'brigade')
    if (r) game.selectUnits(r.unitIds, false)
  } else if (p.army !== undefined) game.selectArmy(p.army)
}
const cssPct = (v: number): string => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`
const pct = (v: number): string => `${Math.round(v * 100)} %`
const selected = (r: ForcesRow): boolean =>
  r.unitIds.length > 0 && r.unitIds.every((id) => game.selection.includes(id))
</script>

<template>
  <div class="tree" data-testid="forces-tree">
    <div class="subtabs" role="tablist">
      <button
        role="tab"
        :class="{ active: tab === 'tree' }"
        data-testid="forces-tab-tree"
        @click="tab = 'tree'"
      >
        Armées
      </button>
      <button
        role="tab"
        :class="{ active: tab === 'templates' }"
        data-testid="forces-tab-templates"
        @click="tab = 'templates'"
      >
        Modèles
      </button>
    </div>
    <TemplatesView v-if="tab === 'templates'" />
    <template v-else>
      <nav class="crumbs" aria-label="Échelon" data-testid="forces-crumbs">
        <template v-for="(c, i) in crumbs" :key="i">
          <span v-if="i > 0" class="sep">›</span>
          <button v-if="i < crumbs.length - 1" class="crumb" @click="goTo(c.path)">
            {{ c.label }}
          </button>
          <strong v-else class="crumb">{{ c.label }}</strong>
        </template>
      </nav>
      <ul class="rows armies">
        <li
          v-for="r in rows"
          :key="r.key"
          :class="{ active: selected(r) }"
          :data-testid="`forces-row-${r.echelon}`"
          @click="open(r)"
        >
          <EchelonSymbol :echelon="r.echelon" :kind="r.kind" :color="color" />
          <span class="body">
            <span class="line">
              <span class="name">{{ r.name }}</span>
              <span v-if="r.echelon !== 'brigade'" class="meta"
                >{{ r.unitIds.length }} brigade{{ r.unitIds.length > 1 ? 's' : '' }}</span
              >
              <span v-if="r.open" class="chev" aria-hidden="true">›</span>
            </span>
            <span class="line">
              <span class="gauge" :title="`Effectifs ${pct(r.strength)}`"
                ><i :style="{ width: cssPct(r.strength) }" class="strength"
              /></span>
              <span class="gauge" :title="`Matériel ${pct(r.equipment)}`"
                ><i :style="{ width: cssPct(r.equipment) }" class="equipment"
              /></span>
              <span class="gauge" :title="`Organisation ${pct(r.org)}`"
                ><i :style="{ width: cssPct(r.org) }" class="org"
              /></span>
              <span v-if="r.engaged" class="chip warn" title="Brigades au contact"
                >⚔ {{ r.engaged }}</span
              >
              <span v-if="r.unsupplied" class="chip bad" title="Brigades hors ravitaillement"
                >⛔ {{ r.unsupplied }}</span
              >
              <span v-if="!r.engaged && !r.unsupplied && r.echelon !== 'army'" class="chip"
                >en réserve</span
              >
            </span>
            <span v-if="r.echelon === 'army'" class="meta">{{ props.armyStatus(r.id) }}</span>
          </span>
        </li>
      </ul>
      <p v-if="rows.length === 0" class="empty">
        {{
          path.army === undefined
            ? "Aucune armée : sélectionnez des unités et créez-en une depuis l'inspecteur."
            : 'Aucune brigade à cet échelon.'
        }}
      </p>
    </template>
  </div>
</template>

<style scoped>
.subtabs {
  display: flex;
  gap: 4px;
  margin-bottom: 6px;
}
.subtabs button.active {
  border-color: #facc15;
}
.crumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 4px;
  font-size: 12px;
  margin-bottom: 6px;
}
.crumb {
  background: none;
  border: none;
  padding: 2px 0;
  color: inherit;
  font: inherit;
}
button.crumb {
  text-decoration: underline;
  cursor: pointer;
  opacity: 0.8;
}
.sep {
  opacity: 0.5;
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
}
.rows li {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 6px 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  cursor: pointer;
}
.rows li.active {
  background: rgba(250, 204, 21, 0.1);
}
.body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}
.line {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chev {
  margin-left: auto;
  opacity: 0.6;
}
.meta {
  font-size: 12px;
  opacity: 0.75;
}
.gauge {
  display: inline-block;
  width: 44px;
  height: 5px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 3px;
  overflow: hidden;
}
.gauge i {
  display: block;
  height: 100%;
}
.strength {
  background: #22c55e;
}
.equipment {
  background: #f59e0b;
}
.org {
  background: #3b82f6;
}
.chip {
  font-size: 11px;
  padding: 0 5px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.1);
}
.chip.warn {
  background: rgba(249, 115, 22, 0.25);
}
.chip.bad {
  background: rgba(239, 68, 68, 0.3);
}
.empty {
  opacity: 0.75;
  font-size: 13px;
}
</style>
