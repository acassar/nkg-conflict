<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/game'
import { MODERN_CATALOG } from '@/sim/units/catalog'
import type { OrderKind, UnitSnapshot } from '@/sim/core/types'

const game = useGameStore()
const { selectedUnits, armies, selectedArmy, selectedArmyId } = storeToRefs(game)
const tab = ref<'units' | 'armies'>('units')
const armyName = ref('')
const collapsed = ref(false)

const ORDER_NAMES: Record<OrderKind, string> = {
  idle: 'En attente',
  move: 'En mouvement',
  attack: 'Attaque',
  hold: 'Tient la position',
  retreat: 'Repli',
  front: 'Tient le front',
}

const pct = (v: number): string => `${Math.round(v * 100)} %`
const status = (u: UnitSnapshot): string => {
  if (u.routed) return 'En déroute'
  const parts = [ORDER_NAMES[u.order]]
  if (u.engaged) parts.push('au contact')
  if (!u.supplied) parts.push('hors ravitaillement')
  if (!u.commanded && u.kind !== 'hq') parts.push('hors commandement')
  return parts.join(' · ')
}

const armyOf = (id: number | null): string =>
  armies.value.find((a) => a.id === id)?.name ?? 'Sans armée'

const unitsOfArmy = computed(() => {
  const a = selectedArmy.value
  if (!a) return []
  const ids = new Set(a.unitIds)
  return game.snapshot?.units.filter((u) => ids.has(u.id)) ?? []
})

async function createArmy(): Promise<void> {
  await game.createArmyFromSelection(armyName.value)
  armyName.value = ''
  tab.value = 'armies'
}
</script>

<template>
  <aside class="panel" :class="{ collapsed }">
    <header>
      <nav>
        <button :class="{ active: tab === 'units' }" @click="tab = 'units'">
          Unités ({{ selectedUnits.length }})
        </button>
        <button :class="{ active: tab === 'armies' }" @click="tab = 'armies'">
          Armées ({{ armies.length }})
        </button>
      </nav>
      <button
        class="toggle"
        :aria-label="collapsed ? 'Déplier' : 'Replier'"
        @click="collapsed = !collapsed"
      >
        {{ collapsed ? '▾' : '▴' }}
      </button>
    </header>

    <div v-if="!collapsed" class="body">
      <!-- Unités sélectionnées -->
      <template v-if="tab === 'units'">
        <p v-if="selectedUnits.length === 0" class="empty">
          Cliquez sur une de vos unités pour la sélectionner, Maj + clic pour en ajouter.
        </p>
        <template v-else>
          <div class="orders">
            <button
              title="Déplacer (M) — ou clic droit sur la carte"
              @click="game.startOrder('move')"
            >
              Déplacer
            </button>
            <button title="Attaquer (A)" @click="game.startOrder('attack')">Attaquer</button>
            <button title="Tenir la position (H)" @click="game.hold()">Tenir</button>
            <button title="Se replier (R)" @click="game.startOrder('retreat')">Se replier</button>
          </div>
          <ul class="units">
            <li v-for="u in selectedUnits" :key="u.id">
              <div class="name">{{ u.name }}</div>
              <div class="meta">{{ MODERN_CATALOG[u.kind].name }} · {{ armyOf(u.armyId) }}</div>
              <div class="bars">
                <span title="Effectifs">Eff. {{ pct(u.strength) }}</span>
                <span title="Organisation">Org. {{ pct(u.org) }}</span>
              </div>
              <div class="status" :class="{ warn: u.routed || !u.supplied }">{{ status(u) }}</div>
            </li>
          </ul>
          <form class="create" @submit.prevent="createArmy">
            <input v-model="armyName" placeholder="Nom de la nouvelle armée" maxlength="40" />
            <button type="submit">Créer une armée</button>
          </form>
        </template>
      </template>

      <!-- Armées -->
      <template v-else>
        <ul class="armies">
          <li
            v-for="a in armies"
            :key="a.id"
            :class="{ active: a.id === selectedArmyId }"
            @click="game.selectArmy(a.id)"
          >
            <span class="name">{{ a.name }}</span>
            <span class="meta">
              {{ a.unitIds.length }} unités ·
              {{ a.wholeFront ? 'tout le front' : a.front ? 'portion de front' : 'sans front' }}
              <template v-if="a.offensive">
                · offensive {{ a.offensive.launched ? 'en cours' : 'planifiée' }}
              </template>
            </span>
          </li>
        </ul>

        <section v-if="selectedArmy" class="army">
          <h3>{{ selectedArmy.name }}</h3>
          <p class="meta">
            {{ unitsOfArmy.filter((u) => u.engaged).length }} au contact ·
            {{ unitsOfArmy.filter((u) => !u.supplied).length }} hors ravitaillement
          </p>
          <div class="group">
            <span class="label">Front</span>
            <button @click="game.startFront(selectedArmy.id)">Assigner une portion</button>
            <button @click="game.setWholeFront(selectedArmy.id)">Tout le front</button>
            <button @click="game.clearFront(selectedArmy.id)">Aucun</button>
          </div>
          <div class="group">
            <span class="label">Offensive</span>
            <button @click="game.startOffensive(selectedArmy.id)">Planifier</button>
            <button
              :disabled="!selectedArmy.offensive || selectedArmy.offensive.launched"
              @click="game.launchOffensive(selectedArmy.id)"
            >
              Lancer
            </button>
            <button
              :disabled="!selectedArmy.offensive"
              @click="game.cancelOffensive(selectedArmy.id)"
            >
              Annuler
            </button>
          </div>
          <button class="danger" @click="game.disbandArmy(selectedArmy.id)">
            Dissoudre l'armée
          </button>
        </section>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.panel {
  position: absolute;
  top: 60px;
  right: 12px;
  z-index: 10;
  width: 300px;
  max-height: calc(100% - 140px);
  display: flex;
  flex-direction: column;
  background: rgba(20, 24, 31, 0.94);
  color: #e8eaed;
  border: 1px solid #2c323c;
  border-radius: 8px;
  font:
    13px/1.35 system-ui,
    sans-serif;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px;
  border-bottom: 1px solid #2c323c;
}
nav {
  display: flex;
  gap: 4px;
}
.body {
  overflow-y: auto;
  padding: 8px;
}
button {
  background: #2c323c;
  color: inherit;
  border: 1px solid #3b4250;
  border-radius: 6px;
  padding: 4px 8px;
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
button.active {
  background: #2563eb;
  border-color: #2563eb;
}
button.danger {
  margin-top: 8px;
  border-color: #7f1d1d;
}
.toggle {
  padding: 2px 8px;
}
.empty,
.meta {
  color: #9aa3af;
}
.orders,
.group {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 8px;
  align-items: center;
}
.label {
  width: 100%;
  color: #9aa3af;
  font-size: 12px;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.units li,
.armies li {
  padding: 6px 8px;
  border-radius: 6px;
  margin-bottom: 4px;
  background: #1b2028;
}
.armies li {
  cursor: pointer;
  display: flex;
  flex-direction: column;
}
.armies li.active {
  outline: 1px solid #2563eb;
}
.name {
  font-weight: 600;
}
.bars {
  display: flex;
  gap: 12px;
  font-variant-numeric: tabular-nums;
}
.status.warn {
  color: #fca5a5;
}
.create {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}
input {
  background: #11151b;
  border: 1px solid #3b4250;
  border-radius: 6px;
  color: inherit;
  padding: 5px 8px;
  font: inherit;
}
h3 {
  margin: 12px 0 2px;
  font-size: 14px;
}
@media (max-width: 640px) {
  .panel {
    top: auto;
    bottom: 12px;
    right: 8px;
    left: 8px;
    width: auto;
    max-height: 45%;
  }
}
</style>
