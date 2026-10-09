<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useGameStore } from '@/stores/game'
import { SLOT_LABELS, type SaveSlot } from '@/stores/saves'

const game = useGameStore()

interface Choice {
  code: string
  name: string
  pop: number
}

const scenarioId = ref('world-2026')
const epoch = ref('modern')
const countries = ref<Choice[]>([])
const country = ref<string | null>(null)
const search = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const noAffiliations = ref(false)
const noWars = ref(false)

const EPOCHS = [
  { id: 'modern', name: 'Époque moderne (2026)', available: true },
  { id: 'cold-war', name: 'Guerre froide (~1985)', available: false },
  { id: 'ww2', name: 'Seconde Guerre mondiale (1939)', available: false },
  { id: 'ww1', name: 'Première Guerre mondiale (1914)', available: false },
  { id: 'napoleon', name: 'Époque napoléonienne (~1805)', available: false },
]

const scenario = computed(() => game.scenarios.find((s) => s.id === scenarioId.value) ?? null)
const offers = (key: 'noAffiliations' | 'noWars'): boolean =>
  scenario.value?.options?.includes(key) ?? false

watch(
  scenarioId,
  async (id) => {
    const list = await game.playableCountries(id)
    countries.value = list
    const def = game.scenarios.find((s) => s.id === id)?.defaultCountry
    country.value = list.some((c) => c.code === def) ? (def ?? null) : (list[0]?.code ?? null)
  },
  { immediate: true },
)

/** Recherche sans tenir compte des accents ni de la casse. */
const normalize = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const filtered = computed(() => {
  const q = normalize(search.value.trim())
  if (!q) return countries.value
  return countries.value.filter((c) => normalize(c.name).includes(q) || c.code.toLowerCase() === q)
})

const chosen = computed(() => countries.value.find((c) => c.code === country.value) ?? null)

const fmtPop = (pop: number): string =>
  pop >= 1e6
    ? `${(pop / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M hab.`
    : `${Math.round(pop / 1e3).toLocaleString('fr-FR')} k hab.`

function start(): void {
  if (!country.value || game.loading) return
  void game.newGame(scenarioId.value, country.value, {
    noAffiliations: offers('noAffiliations') && noAffiliations.value,
    noWars: offers('noWars') && noWars.value,
  })
}

const savedAt = (iso: string): string =>
  new Date(iso).toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
const scenarioName = (id: string): string => game.scenarios.find((s) => s.id === id)?.name ?? id
function confirmDelete(slot: SaveSlot): void {
  if (confirm('Supprimer cette sauvegarde ?')) game.removeSave(slot)
}

async function onFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) await game.loadFromFile(file)
  input.value = ''
}
</script>

<template>
  <div class="start" data-testid="start-screen">
    <div class="card">
      <h1>nkg-conflict</h1>
      <p class="tagline">Grande stratégie en temps réel, sur la carte du monde.</p>

      <section v-if="game.saves.length" data-testid="saves">
        <h2>Reprendre</h2>
        <ul class="saves">
          <li v-for="s in game.saves" :key="s.slot">
            <div>
              <strong>{{ s.countryName }}</strong> · {{ s.dateLabel }}
              <div class="meta">
                {{ SLOT_LABELS[s.slot] }} du {{ savedAt(s.savedAt) }} ·
                {{ scenarioName(s.scenarioId) }}
              </div>
            </div>
            <div class="save-actions">
              <button
                class="primary"
                :disabled="game.loading"
                :data-slot="s.slot"
                @click="game.loadLocal(s.slot)"
              >
                Reprendre
              </button>
              <button
                title="Supprimer cette sauvegarde"
                aria-label="Supprimer"
                @click="confirmDelete(s.slot)"
              >
                ✕
              </button>
            </div>
          </li>
        </ul>
      </section>

      <section>
        <h2>Scénario</h2>
        <div class="scenarios">
          <button
            v-for="s in game.scenarios"
            :key="s.id"
            class="scenario"
            :class="{ active: s.id === scenarioId }"
            :data-scenario="s.id"
            @click="scenarioId = s.id"
          >
            <strong>{{ s.name }}</strong>
            <span>{{ s.description }}</span>
          </button>
        </div>
      </section>

      <section>
        <h2>Époque</h2>
        <select v-model="epoch" aria-label="Époque">
          <option v-for="e in EPOCHS" :key="e.id" :value="e.id" :disabled="!e.available">
            {{ e.name }}{{ e.available ? '' : ' · bientôt' }}
          </option>
        </select>
      </section>

      <section v-if="offers('noAffiliations') || offers('noWars')" data-testid="start-options">
        <h2>Options</h2>
        <label v-if="offers('noAffiliations')" class="option">
          <input v-model="noAffiliations" type="checkbox" data-option="noAffiliations" />
          <span>
            <strong>Sans affiliations de départ</strong>
            <span>
              Ni alliances, ni organisations, ni sanctions, ni aides ; relations toutes neutres.
            </span>
          </span>
        </label>
        <label v-if="offers('noWars')" class="option">
          <input v-model="noWars" type="checkbox" data-option="noWars" />
          <span>
            <strong>Sans guerres de départ</strong>
            <span>Tous les pays démarrent en paix, sans mobilisation forcée.</span>
          </span>
        </label>
      </section>

      <section>
        <h2>Votre pays</h2>
        <input
          v-if="countries.length > 6"
          v-model="search"
          type="search"
          placeholder="Rechercher un pays…"
          aria-label="Rechercher un pays"
        />
        <ul class="countries" role="listbox" aria-label="Pays">
          <li
            v-for="c in filtered"
            :key="c.code"
            role="option"
            :aria-selected="c.code === country"
            :class="{ active: c.code === country }"
            :data-country="c.code"
            @click="country = c.code"
            @dblclick="start"
          >
            <span>{{ c.name }}</span>
            <span class="pop">{{ c.pop ? fmtPop(c.pop) : '' }}</span>
          </li>
          <li v-if="filtered.length === 0" class="none">Aucun pays trouvé</li>
        </ul>
      </section>

      <div class="actions">
        <button class="primary" :disabled="!chosen || game.loading" @click="start">
          {{
            game.loading ? 'Chargement…' : chosen ? `Jouer ${chosen.name}` : 'Choisissez un pays'
          }}
        </button>
        <button :disabled="game.loading" @click="fileInput?.click()">Importer un fichier</button>
        <input ref="fileInput" type="file" accept="application/json" hidden @change="onFile" />
      </div>
      <p v-if="game.notice" class="error" role="alert">{{ game.notice }}</p>
      <p class="footnote">
        Scénario hypothétique, sans prétention de reconstitution historique.
        {{
          scenario?.theater === 'world'
            ? 'Les forces sont estimées à partir du PIB et de la population.'
            : ''
        }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.start {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  background:
    radial-gradient(circle at 30% 20%, rgba(37, 99, 235, 0.25), transparent 50%),
    rgba(14, 17, 22, 0.88);
  color: #e8eaed;
  font:
    14px/1.4 system-ui,
    sans-serif;
  overflow: auto;
  padding: 16px;
}
.card {
  width: min(560px, 100%);
  background: #14181f;
  border: 1px solid #2c323c;
  border-radius: 12px;
  padding: 24px 28px;
  box-sizing: border-box;
  /* Centrée quand elle tient à l'écran, défilable sinon. */
  margin: auto;
}
h1 {
  margin: 0;
  font-size: 28px;
  letter-spacing: 0.02em;
}
.tagline {
  margin: 4px 0 16px;
  color: #9aa3af;
}
h2 {
  margin: 16px 0 6px;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #9aa3af;
}
.scenarios {
  display: grid;
  gap: 6px;
}
button {
  background: #2c323c;
  color: inherit;
  border: 1px solid #3b4250;
  border-radius: 8px;
  padding: 8px 14px;
  cursor: pointer;
  font: inherit;
}
button:hover:not(:disabled) {
  background: #363d49;
}
button:disabled {
  opacity: 0.6;
  cursor: default;
}
.scenario {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  gap: 2px;
}
.scenario span {
  color: #b8bec8;
  font-size: 13px;
}
.scenario.active {
  border-color: #2563eb;
  background: #1c2a45;
}
select,
input:not([type='checkbox']) {
  width: 100%;
  box-sizing: border-box;
  background: #11151b;
  border: 1px solid #3b4250;
  border-radius: 6px;
  color: inherit;
  padding: 7px 10px;
  font: inherit;
}
.option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 0;
  cursor: pointer;
}
.option input {
  margin: 3px 0 0;
  flex: none;
  accent-color: #2563eb;
}
.option > span {
  display: flex;
  flex-direction: column;
}
.option > span > span {
  color: #9aa3af;
  font-size: 12px;
}
.countries {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  max-height: 220px;
  overflow: auto;
  border: 1px solid #2c323c;
  border-radius: 6px;
}
.countries li {
  display: flex;
  justify-content: space-between;
  padding: 5px 10px;
  cursor: pointer;
}
.countries li:hover {
  background: #1b2028;
}
.countries li.active {
  background: #2563eb;
}
.countries .pop {
  color: #9aa3af;
  font-variant-numeric: tabular-nums;
}
.countries li.active .pop {
  color: #dbe5ff;
}
.countries .none {
  color: #9aa3af;
  cursor: default;
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 18px;
  flex-wrap: wrap;
}
.primary {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
  font-weight: 600;
  flex: 1;
}
.primary:hover:not(:disabled) {
  background: #1d4ed8;
}
.error {
  color: #fca5a5;
}
.saves {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}
.saves li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: #1b2028;
  border: 1px solid #2c323c;
  border-radius: 8px;
}
.saves .meta {
  color: #9aa3af;
  font-size: 12px;
}
.save-actions {
  display: flex;
  gap: 6px;
  flex: none;
}
.footnote {
  margin: 14px 0 0;
  color: #7d8592;
  font-size: 12px;
}
</style>
