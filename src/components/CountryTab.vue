<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import type { Stance } from '@/stores/game'
import { stanceColor } from '@/map/territoryImage'
import { AID_LEVEL_NAMES, AID_SHARE } from '@/sim/politics/aidLevels'
import type { AidLevel } from '@/sim/politics/types'

const game = useGameStore()

const STANCE_LABELS: Record<Stance, string> = {
  player: 'Votre pays',
  enemy: 'En guerre contre vous',
  ally: 'Allié',
  war: 'En guerre',
  neutral: 'Neutre',
}

const me = computed(() => game.snapshot?.playerCountry ?? '')
const code = computed(() => game.selectedCountryCode ?? me.value)
const country = computed(() => game.countryByCode.get(code.value) ?? null)
const pol = computed(() => game.politicsByCode.get(code.value) ?? null)
const isMe = computed(() => code.value === me.value)
const stance = computed<Stance>(() => game.stances.map.get(code.value) ?? 'neutral')
const relation = computed(() => game.snapshot?.politics.playerRelations[code.value] ?? 0)
const politics = computed(() => game.snapshot?.politics ?? null)

const alliances = computed(
  () => politics.value?.alliances.filter((a) => a.members.includes(code.value)) ?? [],
)
const myAlliances = computed(
  () => politics.value?.alliances.filter((a) => a.members.includes(me.value)) ?? [],
)
const organizations = computed(
  () => politics.value?.organizations.filter((o) => o.members.includes(code.value)) ?? [],
)
const wars = computed(
  () =>
    politics.value?.wars.filter(
      (w) => w.attackers.includes(code.value) || w.defenders.includes(code.value),
    ) ?? [],
)
const atWarWithMe = computed(() =>
  (politics.value?.wars ?? []).some(
    (w) =>
      (w.attackers.includes(me.value) && w.defenders.includes(code.value)) ||
      (w.defenders.includes(me.value) && w.attackers.includes(code.value)),
  ),
)
const sanctioned = computed(
  () => politics.value?.sanctions.includes(`${me.value}>${code.value}`) ?? false,
)
const sanctionsAgainst = computed(
  () => politics.value?.sanctions.filter((s) => s.endsWith(`>${code.value}`)).length ?? 0,
)
const sameAlliance = computed(() => myAlliances.value.some((a) => a.members.includes(code.value)))
const owned = computed(() => {
  const v = game.snapshot?.territoryHeld[code.value]
  return v === undefined ? null : Math.round(v * 100)
})
const unitCount = computed(
  () => game.snapshot?.units.filter((u) => u.owner === code.value).length ?? 0,
)

// ---------- Aide étrangère ----------

const LEVEL_NAMES = AID_LEVEL_NAMES
const LEVELS: AidLevel[] = [1, 2, 3]
// Sur la fiche d'un autre pays, l'aide échangée avec le joueur est affichée à part.
const involvesMe = (a: { from: string; to: string }): boolean =>
  !isMe.value && (a.from === me.value || a.to === me.value)
const received = computed(() => game.aids.filter((a) => a.to === code.value && !involvesMe(a)))
const given = computed(() => game.aids.filter((a) => a.from === code.value && !involvesMe(a)))
/** Aide entre le joueur et le pays affiché (dans un sens ou dans l'autre). */
const myAidTo = computed(() => game.aids.find((a) => a.from === me.value && a.to === code.value))
const myAidFrom = computed(() => game.aids.find((a) => a.from === code.value && a.to === me.value))
const fmt = (v: number): string => Math.round(v).toLocaleString('fr-FR')
const flow = (a: {
  lastDay: { munitions: number; production: number; construction: number; equipment: number }
}): string => {
  const d = a.lastDay
  if (d.munitions + d.production + d.construction + d.equipment === 0) {
    return 'Premier versement à la fin de la journée'
  }
  return `Par jour : ${fmt(d.munitions)} munitions · ${fmt(d.production)} production · ${fmt(d.equipment)} matériel · ${fmt(d.construction)} construction`
}

const name = (c: string): string => game.countryByCode.get(c)?.name ?? c
const names = (list: string[]): string => list.map(name).join(', ')
const pct = (v: number): string => `${Math.round(v * 100)} %`
const relationLabel = (v: number): string =>
  v >= 60
    ? 'Excellentes'
    : v >= 20
      ? 'Bonnes'
      : v > -20
        ? 'Neutres'
        : v > -60
          ? 'Tendues'
          : 'Hostiles'

function confirmLeave(a: { id: string; name: string }): void {
  if (confirm(`Quitter ${a.name} ? Ses membres ne vous défendront plus.`)) {
    void game.leaveAlliance(a.id)
  }
}

function confirmWar(): void {
  const c = country.value
  if (!c) return
  const allies = alliances.value.flatMap((a) => a.members).filter((m) => m !== c.id)
  const warn = allies.length
    ? `\n\nSes alliés (${allies.length} pays) peuvent entrer en guerre contre vous.`
    : ''
  if (confirm(`Déclarer la guerre à ${c.name} ?${warn}`)) void game.declareWar(c.id)
}
</script>

<template>
  <div v-if="country && pol" class="country-tab" data-testid="country-tab">
    <div class="head">
      <span
        class="swatch"
        :style="{ background: `rgb(${stanceColor(stance, country.color).join(',')})` }"
      />
      <div>
        <div class="title">{{ country.name }}</div>
        <div class="stance" :class="stance">{{ STANCE_LABELS[stance] }}</div>
      </div>
      <button
        v-if="!isMe"
        class="small"
        title="Revenir à votre pays"
        @click="game.selectCountry(null)"
      >
        Mon pays
      </button>
    </div>

    <dl class="gauges">
      <dt title="Multiplie la production et la construction">Stabilité</dt>
      <dd>
        <meter min="0" max="1" low="0.4" optimum="1" :value="pol.stability" />
        {{ pct(pol.stability) }}
      </dd>
      <dt title="Main-d'œuvre, récupération des unités, volonté de poursuivre la guerre">
        Soutien à la guerre
      </dt>
      <dd>
        <meter min="0" max="1" low="0.3" optimum="1" :value="pol.warSupport" />
        {{ pct(pol.warSupport) }}
      </dd>
      <dt>Forces</dt>
      <dd>
        {{
          pol.mobilized
            ? `${unitCount} unités sur la carte`
            : `${pol.forceSize} unités, non mobilisées`
        }}
      </dd>
      <dt v-if="owned !== null && wars.length">Territoire tenu</dt>
      <dd v-if="owned !== null && wars.length">{{ owned }} % du territoire de départ</dd>
      <template v-if="!isMe">
        <dt>Relations</dt>
        <dd :class="{ bad: relation <= -20, good: relation >= 20 }">
          {{ relationLabel(relation) }} ({{ relation > 0 ? '+' : '' }}{{ Math.round(relation) }})
        </dd>
      </template>
      <dt>Alliances</dt>
      <dd>{{ alliances.map((a) => a.name).join(', ') || 'Aucune' }}</dd>
      <template v-if="organizations.length">
        <dt>Organisations</dt>
        <dd>{{ organizations.map((o) => o.name).join(', ') }}</dd>
      </template>
      <template v-if="sanctionsAgainst">
        <dt>Sanctions subies</dt>
        <dd class="bad">{{ sanctionsAgainst }} pays</dd>
      </template>
    </dl>

    <!-- Actions sur un autre pays -->
    <div v-if="!isMe" class="actions">
      <button v-if="!atWarWithMe" class="danger" :disabled="sameAlliance" @click="confirmWar">
        Déclarer la guerre
      </button>
      <button
        v-if="!atWarWithMe"
        title="+10 de relations, une fois par mois et par pays"
        @click="game.improveRelations(country.id)"
      >
        Améliorer les relations
      </button>
      <button @click="game.toggleSanction(country.id)">
        {{ sanctioned ? 'Lever les sanctions' : 'Sanctionner' }}
      </button>
      <button
        v-if="!sameAlliance && !atWarWithMe"
        title="Il faut des relations d'au moins +60"
        @click="game.proposeAlliance(country.id)"
      >
        Proposer une alliance
      </button>
    </div>

    <!-- Actions sur son propre pays -->
    <div v-else class="actions">
      <button
        v-if="!pol.mobilized"
        title="Lève les forces armées ; coûte un peu de stabilité en temps de paix"
        @click="game.mobilize()"
      >
        Mobiliser
      </button>
      <button v-if="wars.length && myAlliances.length" @click="game.callAllies()">
        Appeler les alliés
      </button>
      <button v-for="a in myAlliances" :key="a.id" class="danger" @click="confirmLeave(a)">
        Quitter {{ a.name }}
      </button>
    </div>

    <h3>{{ wars.length ? 'Guerres' : 'En paix' }}</h3>
    <ul class="wars">
      <li v-for="w in wars" :key="w.id">
        <div class="war-name">{{ w.name }}</div>
        <div class="sides">
          <span>{{ names(w.attackers) }}</span>
          <span class="vs">contre</span>
          <span>{{ names(w.defenders) }}</span>
        </div>
        <div v-if="w.attackers.includes(me) || w.defenders.includes(me)" class="peace">
          <button
            title="Chaque camp retrouve ses frontières d'avant-guerre ; l'adversaire refuse s'il gagne du terrain"
            @click="game.proposePeace(w.id, 'white')"
          >
            Paix blanche
          </button>
          <button
            title="Chacun garde ce qu'il tient ; l'adversaire refuse s'il a perdu du terrain"
            @click="game.proposePeace(w.id, 'lines')"
          >
            Paix sur les lignes
          </button>
        </div>
      </li>
    </ul>
    <h3>Aide étrangère</h3>
    <div class="aid" data-testid="aid-section">
      <!-- Entre le joueur et ce pays -->
      <template v-if="!isMe && !atWarWithMe">
        <div v-if="myAidFrom" class="aid-row">
          <div>
            Vous aide (<strong>{{ LEVEL_NAMES[myAidFrom.level] }}</strong
            >), {{ myAidFrom.unitsDelivered }} unité(s) livrée(s)
            <div class="meta">{{ flow(myAidFrom) }}</div>
          </div>
          <button class="small" @click="game.revokeAid(myAidFrom.id)">Renoncer</button>
        </div>
        <button
          v-else
          title="Le pays décide selon vos relations, vos alliances et vos ennemis communs"
          @click="game.requestAid(country.id)"
        >
          Demander une aide
        </button>
        <div v-if="myAidTo" class="aid-row">
          <div>
            Vous l'aidez (<strong>{{ LEVEL_NAMES[myAidTo.level] }}</strong
            >)
            <div class="meta">{{ flow(myAidTo) }}</div>
          </div>
          <div class="levels">
            <button
              v-for="l in LEVELS"
              :key="l"
              :class="{ active: myAidTo.level === l }"
              @click="game.setAidLevel(myAidTo.id, l)"
            >
              {{ LEVEL_NAMES[l] }}
            </button>
            <button class="danger" @click="game.revokeAid(myAidTo.id)">Arrêter</button>
          </div>
        </div>
        <div v-else class="levels">
          <span class="label">Accorder une aide :</span>
          <button
            v-for="l in LEVELS"
            :key="l"
            :title="`Prélève ${Math.round(AID_SHARE[l] * 100)} % de vos revenus militaires et civils chaque jour`"
            @click="game.grantAid(country.id, l)"
          >
            {{ LEVEL_NAMES[l] }}
          </button>
        </div>
      </template>

      <!-- Aides du pays affiché -->
      <ul class="aid-list">
        <li v-for="a in received" :key="`r${a.id}`">
          <span
            >Reçue de <strong>{{ name(a.from) }}</strong> ({{ LEVEL_NAMES[a.level] }})</span
          >
          <span class="meta">{{ flow(a) }}</span>
          <button v-if="isMe" class="small" @click="game.revokeAid(a.id)">Renoncer</button>
        </li>
        <li v-for="a in given" :key="`g${a.id}`">
          <span
            >Accordée à <strong>{{ name(a.to) }}</strong> ({{ LEVEL_NAMES[a.level] }})</span
          >
          <span class="meta">{{ flow(a) }}</span>
          <button v-if="isMe" class="small danger" @click="game.revokeAid(a.id)">Arrêter</button>
        </li>
        <li v-if="received.length + given.length === 0" class="meta">Aucune aide en cours</li>
      </ul>
    </div>

    <p v-if="isMe" class="tip">Cliquez sur un pays de la carte pour ouvrir sa fiche.</p>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.head > div {
  flex: 1;
}
.swatch {
  width: 18px;
  height: 18px;
  border-radius: 4px;
}
.title {
  font-weight: 700;
  font-size: 16px;
}
.stance {
  font-size: 12px;
  color: #9aa3af;
}
.stance.player {
  color: #93b4f5;
}
.stance.enemy {
  color: #fca5a5;
}
.stance.ally {
  color: #6ee7b7;
}
.stance.war {
  color: #fbbf24;
}
.gauges {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
  margin: 0 0 8px;
}
dt {
  color: #9aa3af;
}
dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
meter {
  width: 80px;
  vertical-align: middle;
}
.bad {
  color: #fca5a5;
}
.good {
  color: #6ee7b7;
}
.actions,
.peace {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 6px 0;
}
.wars {
  list-style: none;
  margin: 0;
  padding: 0;
}
.wars li {
  background: #1b2028;
  border-radius: 6px;
  padding: 6px 8px;
  margin-bottom: 4px;
}
.war-name {
  font-weight: 600;
}
.sides {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  color: #d1d5db;
}
.vs {
  color: #9aa3af;
}
h3 {
  margin: 12px 0 4px;
  font-size: 14px;
}
.aid-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 6px;
}
.aid-row > button {
  align-self: flex-start;
}
.aid > button {
  margin-bottom: 6px;
}
.levels {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  margin-bottom: 6px;
}
.levels button.active {
  background: #2563eb;
  border-color: #2563eb;
}
.label {
  color: #9aa3af;
}
.meta {
  color: #9aa3af;
  font-size: 12px;
}
.aid-list {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  max-height: 180px;
  overflow: auto;
}
.aid-list li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0;
  border-top: 1px solid #262c35;
}
.aid-list li button {
  align-self: flex-start;
}
.tip {
  color: #9aa3af;
  font-size: 12px;
}
.small {
  padding: 2px 8px;
  font-size: 12px;
}
</style>
