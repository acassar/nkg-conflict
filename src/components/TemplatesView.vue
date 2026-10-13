<script setup lang="ts">
import { computed } from 'vue'
import { BATTALIONS } from '@/sim/units/battalions'
import {
  BRIGADE_TEMPLATES,
  DIVISION_TEMPLATES,
  battalionsOf,
  brigadeProfile,
} from '@/sim/units/templates'
import { recruitCostOf } from '@/sim/economy/rules'
import EchelonSymbol from './EchelonSymbol.vue'

/**
 * Onglet « Modèles » de la vue Forces (phase D3, lecture seule) : modèles de brigade (bataillons,
 * effectif, coût, vitesse, attaque, défense) et modèles de division (leurs brigades). Le concepteur
 * viendra plus tard.
 */
const brigades = computed(() =>
  Object.values(BRIGADE_TEMPLATES).map((t) => {
    const p = brigadeProfile(t.id)
    const cost = recruitCostOf(t.kind, t.id)
    return {
      id: t.id,
      name: t.name,
      kind: t.kind,
      battalions: battalionsOf(t.id)
        .map(({ kind, count }) => `${count} ${BATTALIONS[kind].name}`)
        .join(', '),
      men: p.men,
      cost,
      speed: p.type.speedKmh,
      attack: p.type.attack,
      defense: p.type.defense,
    }
  }),
)
const divisions = computed(() =>
  Object.values(DIVISION_TEMPLATES).map((d) => ({
    id: d.id,
    name: d.name,
    kind: BRIGADE_TEMPLATES[d.brigades[0] ?? '']?.kind ?? 'inf',
    brigades: d.brigades.map((b) => BRIGADE_TEMPLATES[b]?.name ?? b),
    men: d.brigades.reduce((s, b) => s + (BRIGADE_TEMPLATES[b] ? brigadeProfile(b).men : 0), 0),
  })),
)
const num = (v: number, digits = 0): string =>
  v.toLocaleString('fr-FR', { maximumFractionDigits: digits })
</script>

<template>
  <div class="templates" data-testid="templates-view">
    <p class="meta">Modèles prédéfinis, en lecture seule ; le concepteur viendra plus tard.</p>
    <h4>Brigades</h4>
    <ul>
      <li v-for="t in brigades" :key="t.id" :data-testid="`template-${t.id}`">
        <div class="head">
          <EchelonSymbol echelon="brigade" :kind="t.kind" :size="24" />
          <strong>{{ t.name }}</strong>
        </div>
        <div class="meta">{{ t.battalions }}</div>
        <div class="stats">
          <span>{{ num(t.men) }} hommes</span>
          <span>{{ num(t.cost.production) }} prod · {{ t.cost.days }} j</span>
          <span>vitesse {{ num(t.speed, 1) }}</span>
          <span>attaque {{ num(t.attack, 1) }}</span>
          <span>défense {{ num(t.defense, 1) }}</span>
        </div>
      </li>
    </ul>
    <h4>Divisions</h4>
    <ul>
      <li v-for="d in divisions" :key="d.id" :data-testid="`division-template-${d.id}`">
        <div class="head">
          <EchelonSymbol echelon="division" :kind="d.kind" :size="24" />
          <strong>{{ d.name }}</strong>
        </div>
        <div class="meta">{{ d.brigades.join(' · ') }}</div>
        <div class="stats">
          <span>{{ d.brigades.length }} brigades</span><span>{{ num(d.men) }} hommes</span>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
h4 {
  margin: 10px 0 4px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.75;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
li {
  padding: 6px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.meta {
  font-size: 12px;
  opacity: 0.75;
}
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
</style>
