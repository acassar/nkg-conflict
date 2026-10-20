<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import { armyComposition, defenseTag, orderOfBattle, strengthTone } from '@/composables/composition'
import type { ArmyState } from '@/sim/core/types'

/**
 * Onglet « Composition » d'une armée : nombre d'unités par type, effectifs et organisation moyens,
 * puis ordre de bataille en corps et divisions (un clic sur une formation sélectionne ses brigades).
 */
const props = defineProps<{ army: ArmyState }>()
const game = useGameStore()

const members = computed(() => {
  const ids = new Set(props.army.unitIds)
  return game.snapshot?.units.filter((u) => ids.has(u.id)) ?? []
})
const rows = computed(() => armyComposition(members.value))
const oob = computed(() => orderOfBattle(members.value, game.snapshot?.formations ?? []))
/** Ordre propre d'une division de l'ordre de bataille, ou null. */
const tagOf = (id: number): ReturnType<typeof defenseTag> =>
  defenseTag(game.snapshot?.formations.find((f) => f.id === id))
const pct = (v: number): string => `${Math.round(v * 100)} %`
const width = (v: number): string => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`
</script>

<template>
  <div class="composition" data-testid="army-composition">
    <p class="kicker">Par type</p>
    <p v-if="rows.length === 0" class="meta">Aucune unité.</p>
    <ul>
      <li v-for="r in rows" :key="r.kind" :data-testid="`composition-${r.kind}`">
        <div class="row">
          <span>{{ r.name }}</span>
          <span class="num">{{ r.count }}</span>
        </div>
        <div class="row small">
          <span class="bar" :title="`Effectifs moyens ${pct(r.strength)}`"
            ><i :class="strengthTone(r.strength)" :style="{ width: width(r.strength) }"
          /></span>
          <span class="num">{{ pct(r.strength) }}</span>
        </div>
        <div class="meta">
          Matériel {{ pct(r.equipment) }} · organisation moyenne {{ pct(r.org) }}
        </div>
      </li>
    </ul>
    <p class="kicker">Ordre de bataille</p>
    <p v-if="oob.length === 0" class="meta">Aucune division.</p>
    <div v-for="c in oob" :key="c.id ?? 'hors'" class="corps" data-testid="oob-corps">
      <button
        class="formation corps-name"
        :disabled="c.id === null"
        :title="c.id === null ? '' : 'Sélectionner les brigades du corps'"
        @click="game.selectUnits(c.unitIds, false)"
      >
        <span>{{ c.name }}</span>
        <span class="num">{{ c.unitIds.length }} br.</span>
      </button>
      <ul>
        <li v-for="d in c.divisions" :key="d.id">
          <button
            class="formation"
            data-testid="oob-division"
            title="Sélectionner les brigades de la division"
            @click="game.selectUnits(d.unitIds, false)"
          >
            <span>{{ d.name }}</span>
            <span class="num">{{ d.unitIds.length }} br. · {{ pct(d.strength) }}</span>
          </button>
          <span class="bar"
            ><i :class="strengthTone(d.strength)" :style="{ width: width(d.strength) }"
          /></span>
          <div v-if="tagOf(d.id)" class="own-row" data-testid="oob-defense-tag">
            <span class="own" :title="tagOf(d.id)?.title">{{ tagOf(d.id)?.label }}</span>
            <button
              class="rejoin"
              title="La division reprend sa place dans la ligne et l'ordre de son armée"
              data-testid="oob-defense-rejoin"
              @click="game.divisionDefense(d.id, null, 'La division rejoint la ligne de son armée')"
            >
              Réintégrer l'armée
            </button>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
ul {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
}
li {
  padding: 6px 8px;
  margin-bottom: 4px;
  background: #1b2028;
  border-radius: 6px;
}
.kicker {
  margin: 0 0 4px;
  color: #9aa3af;
  font:
    600 11px/1.2 'Barlow Condensed',
    system-ui,
    sans-serif;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.small {
  margin-top: 3px;
}
.bar {
  flex: 1;
  height: 5px;
  background: #2c323c;
  border-radius: 3px;
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
}
.bar .ok {
  background: #3fb37f;
}
.bar .warn {
  background: #f2a33a;
}
.bar .bad {
  background: #e5484d;
}
.num {
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 12px;
}
.meta {
  color: #9aa3af;
  font-size: 12px;
}
.corps {
  margin-bottom: 6px;
}
.formation {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 0;
  background: none;
  border: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.formation:disabled {
  cursor: default;
}
.own-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 4px;
}
.own {
  font-size: 11px;
  padding: 0 6px;
  border-radius: 8px;
  background: rgba(250, 204, 21, 0.2);
  color: #fde68a;
}
.composition .own-row .rejoin {
  font-size: 11px;
  padding: 2px 8px;
  border: 1px solid var(--nkg-line-strong);
  border-radius: 4px;
  background: var(--nkg-tile-bg);
  color: inherit;
  cursor: pointer;
}
.corps-name {
  font-weight: 600;
  padding: 4px 0;
}
.corps li .bar {
  display: block;
  margin-top: 3px;
}
</style>
