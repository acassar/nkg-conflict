<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGameStore } from '@/stores/game'
import { formatGameDate, tickToDate } from '@/sim/core/clock'
import { layout } from '@/composables/layout'
import NkgIcon, { type IconName } from './NkgIcon.vue'

const props = withDefaults(defineProps<{ embedded?: boolean; limit?: number }>(), {
  embedded: false,
  limit: 7,
})
const game = useGameStore()
const events = computed(() => (game.snapshot?.events ?? []).slice(-props.limit).reverse())
const colorOf = (owner: string | null): string => {
  const c = game.snapshot?.countries.find((x) => x.id === owner)?.color
  return c ? `rgb(${c.join(',')})` : '#9aa3af'
}
const when = (tick: number): string =>
  game.snapshot ? formatGameDate(tickToDate(game.snapshot.startDate, tick)) : ''

// ---------- Journal du tiroir, grand écran : filtres, jours, une icône par catégorie ----------

type Category = 'combat' | 'diplomacy' | 'economy' | 'other'
type Filter = 'all' | 'combat' | 'mine' | 'diplomacy' | 'economy'
const FILTERS: { id: Filter; name: string }[] = [
  { id: 'all', name: 'Tout' },
  { id: 'combat', name: 'Combats' },
  { id: 'mine', name: 'Mon pays' },
  { id: 'diplomacy', name: 'Diplomatie' },
  { id: 'economy', name: 'Économie' },
]
// Les événements n'ont pas de type : la catégorie se déduit du texte.
const DIPLOMACY = /guerre|paix|allian|sanction|relations|passage|aide|accorde|refuse|coalition/i
const ECONOMY =
  /économie|chantier|construction|usine|caserne|dépôt|fortification|budget|nouvelle unité|renfort|matériel|mobilis|recrut/i
const COMBAT =
  /percée|perc|décroche|contre-attaqu|offensive|encercl|bloque|tient|attaque|bataille|repli|recul|détruit|prise|capture|front|posture/i
const categoryOf = (text: string): Category =>
  ECONOMY.test(text) && !/^Alerte/.test(text)
    ? 'economy'
    : COMBAT.test(text)
      ? 'combat'
      : DIPLOMACY.test(text)
        ? 'diplomacy'
        : 'other'
const ICON: Record<Category, IconName> = {
  combat: 'forces',
  diplomacy: 'handshake',
  economy: 'plus',
  other: 'shield',
}

const desktop = computed(() => props.embedded && layout.value === 'desktop')
const filter = ref<Filter>('all')
const me = computed(() => game.snapshot?.playerCountry ?? '')
const countryName = (id: string | null): string =>
  (id && game.snapshot?.countries.find((c) => c.id === id)?.name) || ''

/** Événements du tiroir regroupés par jour, les plus récents en haut. */
const days = computed(() => {
  const snap = game.snapshot
  if (!snap) return []
  const all = snap.events.slice(-Math.max(props.limit, 80)).reverse()
  const out: {
    day: string
    items: { key: string; text: string; hour: string; who: string; cat: Category; mine: boolean }[]
  }[] = []
  let k = 0
  for (const e of all) {
    const cat = categoryOf(e.text)
    const mine = e.owner === me.value
    k++
    if (filter.value === 'mine' ? !mine : filter.value !== 'all' && filter.value !== cat) continue
    const d = tickToDate(snap.startDate, e.tick)
    const label = formatGameDate(d)
    const day = label.slice(0, label.lastIndexOf(','))
    const hour = `${String(d.getUTCHours()).padStart(2, '0')} h`
    const who = mine ? '' : countryName(e.owner)
    let group = out.at(-1)
    if (!group || group.day !== day) {
      group = { day, items: [] }
      out.push(group)
    }
    group.items.push({ key: `${e.tick}-${k}`, text: e.text, hour, who, cat, mine })
    if (out.reduce((n, g) => n + g.items.length, 0) >= props.limit) break
  }
  return out
})
</script>

<template>
  <section v-if="desktop && events.length" class="journal" data-testid="journal">
    <div class="filters" role="group" aria-label="Filtrer le journal">
      <button
        v-for="f in FILTERS"
        :key="f.id"
        class="f"
        :class="{ on: filter === f.id }"
        :aria-pressed="filter === f.id"
        :data-testid="`journal-filter-${f.id}`"
        @click="filter = f.id"
      >
        {{ f.name }}
      </button>
    </div>
    <template v-for="g in days" :key="g.day">
      <div class="day">{{ g.day }}</div>
      <div v-for="e in g.items" :key="e.key" class="e" :class="[e.cat, { mine: e.mine }]">
        <NkgIcon :name="ICON[e.cat]" :size="18" />
        <span class="body">
          <span class="t">{{ e.text }}</span>
          <span class="d"
            >{{ e.hour }}<template v-if="e.who"> · {{ e.who }}</template></span
          >
        </span>
      </div>
    </template>
    <p v-if="days.length === 0" class="none">Aucun événement de ce type.</p>
  </section>
  <section v-else-if="events.length" class="log" :class="{ embedded }" aria-live="polite">
    <p v-for="(e, k) in events" :key="`${e.tick}-${k}`">
      <span class="dot" :style="{ background: colorOf(e.owner) }" />
      <span class="when">{{ when(e.tick) }}</span>
      {{ e.text }}
    </p>
  </section>
</template>

<style scoped>
.log {
  position: absolute;
  left: 12px;
  bottom: 44px;
  z-index: 10;
  max-width: min(420px, calc(100% - 24px));
  padding: 6px 10px;
  background: rgba(20, 24, 31, 0.88);
  color: #e8eaed;
  border-radius: 6px;
  font:
    12px/1.4 system-ui,
    sans-serif;
}
p {
  margin: 2px 0;
}
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
}
.when {
  color: #9aa3af;
  margin-right: 6px;
  font-variant-numeric: tabular-nums;
}
.log.embedded {
  position: static;
  max-width: none;
  padding: 0;
  background: none;
  font-size: 13px;
}
.log.embedded p {
  margin: 0 0 6px;
}

/* Journal du tiroir (grand écran). */
.journal {
  display: flex;
  flex-direction: column;
  font-size: 13px;
}
.filters {
  display: flex;
  gap: 4px;
  margin: -2px -14px 4px;
  padding: 0 14px 12px;
  border-bottom: 1px solid var(--nkg-brass-line);
}
section.journal .filters button.f {
  flex: 1 1 auto;
  height: 28px;
  padding: 0 6px;
  border: 1px solid #3a4452;
  border-radius: 999px;
  background: #1a212a;
  color: var(--nkg-text-soft);
  font-size: 12px;
}
section.journal .filters button.f.on,
section.journal .filters button.f.on:hover:not(:disabled) {
  border-color: var(--nkg-brass-light);
  background: #2a2418;
  color: var(--nkg-brass-pale);
}
.day {
  padding: 12px 0 2px;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--nkg-label);
}
.e {
  display: grid;
  grid-template-columns: 22px 1fr;
  gap: 10px;
  padding: 8px 4px;
  border-bottom: 1px solid var(--nkg-line-soft);
}
.e .nkg-icon {
  margin-top: 1px;
  color: var(--nkg-text-faint);
}
.e.combat .nkg-icon {
  color: var(--nkg-bad-text);
}
.e.combat.mine .nkg-icon,
.e.other.mine .nkg-icon {
  color: var(--nkg-player-line);
}
.e.economy .nkg-icon {
  color: var(--nkg-brass);
}
.e.diplomacy .nkg-icon {
  color: var(--nkg-good-text);
}
.e .body {
  display: flex;
  flex-direction: column;
}
.e .t {
  line-height: 1.45;
}
.e .d {
  font-size: 11px;
  color: var(--nkg-text-faint);
  font-variant-numeric: tabular-nums;
}
.none {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--nkg-text-faint);
}
/* Fil des derniers événements sur la carte (grand écran, sans tiroir ouvert). */
.log:not(.embedded) {
  background: var(--nkg-panel-bg);
  border: 1px solid var(--nkg-brass-deep);
  border-radius: 4px;
  font-family: var(--nkg-sans);
}
</style>
