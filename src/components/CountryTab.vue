<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import type { Stance } from '@/stores/game'
import { stanceColor } from '@/map/territoryImage'
import { AID_LEVEL_NAMES, AID_MONEY_SHARE, AID_SHARE } from '@/sim/politics/aidLevels'
import { money } from '@/composables/budget'
import type { AidLevel } from '@/sim/politics/types'
import NkgIcon from './NkgIcon.vue'

const game = useGameStore()

const STANCE_LABELS: Record<Stance, string> = {
  player: 'Votre pays',
  enemy: 'En guerre contre vous',
  ally: 'Allié',
  war: 'En guerre',
  neutral: 'Neutre',
}

/** own : tiroir Diplomatie (votre pays) ; sinon fiche du pays choisi (inspecteur). */
const props = defineProps<{ own?: boolean }>()

const me = computed(() => game.snapshot?.playerCountry ?? '')
const code = computed(() => (props.own ? me.value : (game.selectedCountryCode ?? me.value)))
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

// ---------- Coalition ----------

const myWars = computed(
  () =>
    politics.value?.wars.filter(
      (w) => w.attackers.includes(me.value) || w.defenders.includes(me.value),
    ) ?? [],
)
/** Le pays affiché combat déjà dans le camp du joueur. */
const fightsWithMe = computed(() =>
  myWars.value.some((w) =>
    (w.attackers.includes(me.value) ? w.attackers : w.defenders).includes(code.value),
  ),
)
const passages = computed(() => politics.value?.passages ?? [])
/** Droit de passage accordé au joueur par le pays affiché. */
const passageToMe = computed(() =>
  passages.value.some((p) => p.from === me.value && p.to === code.value),
)
/** Pays qui accordent au pays affiché un droit de passage, et pays qui le reçoivent de lui. */
const passagesHeld = computed(() =>
  passages.value.filter((p) => p.from === code.value).map((p) => p.to),
)
const passagesGiven = computed(() =>
  passages.value.filter((p) => p.to === code.value).map((p) => p.from),
)
const canAskJoin = computed(
  () =>
    myWars.value.length > 0 &&
    sameAlliance.value &&
    !fightsWithMe.value &&
    !atWarWithMe.value &&
    !offMap.value,
)
const canAskPassage = computed(
  () =>
    myWars.value.length > 0 &&
    !fightsWithMe.value &&
    !atWarWithMe.value &&
    !passageToMe.value &&
    !offMap.value,
)
const owned = computed(() => {
  const v = game.snapshot?.territoryHeld[code.value]
  return v === undefined ? null : Math.round(v * 100)
})
/** Pays hors carte (théâtre régional) : diplomatie et aide seulement. */
const offMap = computed(() => country.value?.offMap === true)
const offMapCountries = computed(
  () => game.snapshot?.countries.filter((c) => c.offMap && c.id !== code.value) ?? [],
)
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
  lastDay: {
    munitions: number
    production: number
    construction: number
    equipment: number
    money?: number
  }
}): string => {
  const d = a.lastDay
  const cash = d.money ?? 0
  if (d.munitions + d.production + d.construction + d.equipment + cash === 0) {
    return 'Premier versement à la fin de la journée'
  }
  const parts = [
    `${fmt(d.munitions)} munitions`,
    `${fmt(d.production)} production`,
    `${fmt(d.equipment)} matériel`,
  ]
  if (cash > 0) parts.push(`${money(cash)} d'argent`)
  if (d.construction > 0) parts.push(`${fmt(d.construction)} construction`)
  return `Par jour : ${parts.join(' · ')}`
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

// ---------- Fiche ----------

const swatch = computed(() =>
  country.value ? `rgb(${stanceColor(stance.value, country.value.color).join(',')})` : '',
)
/** Sous-titre de la fiche : camp, alliances et organisations. */
const subtitle = computed(() =>
  [
    STANCE_LABELS[stance.value],
    ...alliances.value.map((a) => a.name),
    ...organizations.value.map((o) => o.name),
  ].join(' · '),
)
/** Position du repère sur l'échelle des relations (−100 à +100). */
const relationPos = computed(() => `${Math.max(0, Math.min(100, (relation.value + 100) / 2))}%`)
const gaugeColor = (v: number): string =>
  v >= 0.7 ? 'var(--nkg-good)' : v >= 0.4 ? 'var(--nkg-warn)' : 'var(--nkg-bad)'
const forcesText = computed(() =>
  offMap.value
    ? 'Hors du théâtre'
    : pol.value?.mobilized
      ? `${unitCount.value} unités`
      : `${pol.value?.forceSize ?? 0} unités non mobilisées`,
)
const involvesMeWar = (w: { attackers: string[]; defenders: string[] }): boolean =>
  w.attackers.includes(me.value) || w.defenders.includes(me.value)

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
  <!-- Grand écran : fiche compacte, actions en tuiles, explications en infobulle. -->
  <div
    v-if="country && pol"
    class="country-tab desk"
    :data-testid="own ? 'country-own' : 'country-tab'"
  >
    <div class="ident">
      <span class="flag" :style="{ background: swatch }" />
      <div class="who">
        <div v-if="own" class="name">{{ country.name }}</div>
        <div class="sub" :class="stance">{{ subtitle }}</div>
      </div>
      <button
        v-if="!isMe"
        class="mine"
        title="Revenir à votre pays"
        @click="game.selectCountry(me)"
      >
        Mon pays
      </button>
    </div>

    <div class="bars">
      <div title="Multiplie la production et la construction">
        <div class="bar-head">
          <span>Stabilité</span><span class="num">{{ pct(pol.stability) }}</span>
        </div>
        <div class="bar">
          <i :style="{ width: pct(pol.stability), background: gaugeColor(pol.stability) }" />
        </div>
      </div>
      <div title="Main-d'œuvre, récupération des unités, volonté de poursuivre la guerre">
        <div class="bar-head">
          <span>Soutien à la guerre</span><span class="num">{{ pct(pol.warSupport) }}</span>
        </div>
        <div class="bar">
          <i :style="{ width: pct(pol.warSupport), background: gaugeColor(pol.warSupport) }" />
        </div>
      </div>
    </div>

    <div v-if="!isMe" class="relation">
      <div class="bar-head">
        <span>Relations</span>
        <span :class="{ bad: relation <= -20, good: relation >= 20 }"
          >{{ relationLabel(relation) }} · {{ relation > 0 ? '+' : ''
          }}{{ Math.round(relation) }}</span
        >
      </div>
      <div class="scale"><span :style="{ left: relationPos }" /></div>
    </div>

    <div class="chips">
      <span
        class="chip"
        :title="offMap ? 'Hors du théâtre : aide et diplomatie seulement' : 'Forces armées'"
        >{{ forcesText }}</span
      >
      <span v-if="owned !== null && wars.length" class="chip" title="Part du territoire de départ"
        >{{ owned }} % du territoire</span
      >
      <span v-if="!wars.length" class="chip">En paix</span>
      <span
        v-if="passagesHeld.length"
        class="chip"
        :title="`Droit de passage chez ${names(passagesHeld)}`"
        >Passage chez {{ passagesHeld.length }} pays</span
      >
      <span
        v-if="passagesGiven.length"
        class="chip"
        :title="`Passage accordé à ${names(passagesGiven)}`"
        >Passage accordé à {{ passagesGiven.length }} pays</span
      >
      <span v-if="sanctionsAgainst" class="chip bad"
        >Sanctionné par {{ sanctionsAgainst }} pays</span
      >
    </div>

    <div class="divider" />

    <!-- Actions sur un autre pays -->
    <div v-if="!isMe" class="acts">
      <button
        v-if="!atWarWithMe"
        class="act"
        title="+10 de relations, une fois par mois et par pays"
        @click="game.improveRelations(country.id)"
      >
        <NkgIcon name="heart" :size="22" />Améliorer les relations
      </button>
      <button
        v-if="!sameAlliance && !atWarWithMe"
        class="act"
        title="Il faut des relations d'au moins +60"
        @click="game.proposeAlliance(country.id)"
      >
        <NkgIcon name="handshake" :size="22" />Proposer une alliance
      </button>
      <button
        v-if="canAskJoin"
        class="act"
        data-testid="ask-join"
        title="L'allié décide selon vos relations, vos ennemis communs, la distance de la guerre et son soutien à la guerre"
        @click="game.askToJoin(country.id)"
      >
        <NkgIcon name="call" :size="22" />Demander de participer à la guerre
      </button>
      <button
        v-if="canAskPassage"
        class="act"
        data-testid="ask-passage"
        title="Vos unités pourront traverser son territoire et s'y ravitailler pendant vos guerres"
        @click="game.askPassage(country.id)"
      >
        <NkgIcon name="road" :size="22" />Demander le droit de passage
      </button>
      <button
        v-if="passageToMe"
        class="act"
        title="Vos unités quittent son territoire"
        @click="game.renouncePassage(country.id)"
      >
        <NkgIcon name="road" :size="22" />Renoncer au droit de passage
      </button>
      <button
        class="act"
        :class="{ on: sanctioned }"
        :title="
          sanctioned
            ? 'Lever les sanctions contre ce pays'
            : 'Freine son économie ; dégrade vos relations'
        "
        @click="game.toggleSanction(country.id)"
      >
        <NkgIcon name="ban" :size="22" />{{ sanctioned ? 'Lever les sanctions' : 'Sanctionner' }}
      </button>
      <button
        v-if="!atWarWithMe && !offMap"
        class="act war"
        :disabled="sameAlliance"
        :title="
          sameAlliance
            ? 'Impossible contre un membre de votre alliance'
            : 'Ses alliés peuvent entrer en guerre contre vous'
        "
        @click="confirmWar"
      >
        <NkgIcon name="forces" :size="22" />Déclarer la guerre
      </button>
    </div>

    <!-- Actions sur son propre pays -->
    <div
      v-else-if="!pol.mobilized || (wars.length && myAlliances.length) || myAlliances.length"
      class="acts"
    >
      <button
        v-if="!pol.mobilized"
        class="act"
        title="Lève les forces armées ; coûte un peu de stabilité en temps de paix"
        @click="game.mobilize()"
      >
        <NkgIcon name="shield" :size="22" />Mobiliser
      </button>
      <button
        v-if="wars.length && myAlliances.length"
        class="act"
        title="Demande à vos alliés d'entrer en guerre à vos côtés"
        @click="game.callAllies()"
      >
        <NkgIcon name="call" :size="22" />Appeler les alliés
      </button>
      <button
        v-for="a in myAlliances"
        :key="a.id"
        class="act war"
        title="Ses membres ne vous défendront plus"
        @click="confirmLeave(a)"
      >
        <NkgIcon name="exit" :size="22" />Quitter {{ a.name }}
      </button>
    </div>

    <template v-if="wars.length">
      <div class="label">{{ wars.length > 1 ? 'Guerres' : 'Guerre' }}</div>
      <ul class="wars">
        <li v-for="w in wars" :key="w.id" :class="{ mine: involvesMeWar(w) }">
          <div class="war-name">{{ w.name }}</div>
          <div class="sides">{{ names(w.attackers) }} contre {{ names(w.defenders) }}</div>
          <div v-if="involvesMeWar(w)" class="peace">
            <button
              title="Chaque camp retrouve ses frontières d'avant-guerre ; l'adversaire refuse s'il gagne du terrain"
              @click="game.proposePeace(w.id, 'white')"
            >
              <NkgIcon name="dove" :size="16" />Paix blanche
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
    </template>

    <div class="aid" data-testid="aid-section">
      <div class="label">Aide étrangère</div>
      <!-- Entre le joueur et ce pays -->
      <template v-if="!isMe && !atWarWithMe">
        <div v-if="myAidFrom" class="row" :title="flow(myAidFrom)">
          <span class="who-row">Vous aide · {{ myAidFrom.unitsDelivered }} unité(s) livrée(s)</span>
          <span class="chip">{{ LEVEL_NAMES[myAidFrom.level] }}</span>
          <button class="small" @click="game.revokeAid(myAidFrom.id)">Renoncer</button>
        </div>
        <button
          v-else
          class="wide"
          title="Le pays décide selon vos relations, vos alliances et vos ennemis communs"
          @click="game.requestAid(country.id)"
        >
          <NkgIcon name="aid" :size="18" />Demander une aide
        </button>
        <div v-if="myAidTo" class="give" :title="flow(myAidTo)">
          <span class="give-label">Vous l'aidez</span>
          <div class="segs">
            <button
              v-for="l in LEVELS"
              :key="l"
              class="seg"
              :class="{ on: myAidTo.level === l }"
              @click="game.setAidLevel(myAidTo.id, l)"
            >
              {{ LEVEL_NAMES[l] }}
            </button>
          </div>
          <button class="small danger" @click="game.revokeAid(myAidTo.id)">Arrêter</button>
        </div>
        <div v-else-if="!offMap" class="give">
          <span class="give-label">Accorder une aide</span>
          <div class="segs">
            <button
              v-for="l in LEVELS"
              :key="l"
              class="seg"
              :title="`Prélève chaque jour ${Math.round(AID_SHARE[l] * 100)} % de votre production militaire et de vos munitions, et ${Math.round(AID_MONEY_SHARE[l] * 100)} % de votre budget en argent`"
              @click="game.grantAid(country.id, l)"
            >
              {{ LEVEL_NAMES[l] }}
            </button>
          </div>
        </div>
      </template>

      <!-- Aides du pays affiché -->
      <ul class="aid-rows">
        <li v-for="a in received" :key="`r${a.id}`" class="row" :title="flow(a)">
          <span class="who-row"
            ><span class="dir">de</span> <b>{{ name(a.from) }}</b></span
          >
          <span class="chip">{{ LEVEL_NAMES[a.level] }}</span>
          <button
            v-if="isMe"
            class="icon-btn"
            :aria-label="`Renoncer à l'aide de ${name(a.from)}`"
            title="Renoncer"
            @click="game.revokeAid(a.id)"
          >
            <NkgIcon name="close" :size="14" />
          </button>
        </li>
        <li v-for="a in given" :key="`g${a.id}`" class="row" :title="flow(a)">
          <span class="who-row"
            ><span class="dir">à</span> <b>{{ name(a.to) }}</b></span
          >
          <span class="chip">{{ LEVEL_NAMES[a.level] }}</span>
          <button
            v-if="isMe"
            class="icon-btn"
            :aria-label="`Arrêter l'aide à ${name(a.to)}`"
            title="Arrêter"
            @click="game.revokeAid(a.id)"
          >
            <NkgIcon name="close" :size="14" />
          </button>
        </li>
        <li v-if="received.length + given.length === 0" class="none">Aucune aide en cours</li>
      </ul>
    </div>

    <template v-if="offMapCountries.length">
      <div class="label" title="Pays hors de la carte : aide et diplomatie seulement">
        Pays hors carte
      </div>
      <div class="offmap" data-testid="offmap-list">
        <button
          v-for="c in offMapCountries"
          :key="c.id"
          class="small"
          :data-offmap="c.id"
          @click="game.selectCountry(c.id)"
        >
          {{ c.name }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.offmap {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 8px;
}
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
/* Grand écran (charte : docs/charte.md). */
.desk {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.desk .ident {
  display: flex;
  align-items: center;
  gap: 12px;
}
.desk .flag {
  width: 42px;
  height: 28px;
  flex: none;
  border: 1px solid var(--nkg-brass);
}
.desk .who {
  flex: 1;
  min-width: 0;
}
.desk .name {
  font-family: var(--nkg-serif);
  font-size: 20px;
  font-weight: 600;
  line-height: 1.15;
}
.desk .sub {
  font-size: 12px;
  color: var(--nkg-text-muted);
}
.desk .sub.player {
  color: var(--nkg-player-line);
}
.desk .sub.enemy {
  color: var(--nkg-bad-text);
}
.desk .sub.ally {
  color: var(--nkg-good-text);
}
.desk .sub.war {
  color: var(--nkg-warn-text);
}
.desk .bars {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.desk .bar-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--nkg-text-muted);
}
.desk .bar-head > span:last-child {
  color: var(--nkg-text);
  font-variant-numeric: tabular-nums;
}
.desk .bar-head > span.good {
  color: var(--nkg-good-text);
  font-weight: 600;
}
.desk .bar-head > span.bad {
  color: var(--nkg-bad-text);
  font-weight: 600;
}
.desk .bar {
  height: 6px;
  border-radius: 3px;
  background: #2b333e;
  overflow: hidden;
}
.desk .bar i {
  display: block;
  height: 100%;
}
.desk .scale {
  position: relative;
  height: 8px;
  border-radius: 4px;
  background: linear-gradient(90deg, #a8473c, var(--nkg-line-strong) 50%, var(--nkg-good));
}
.desk .scale span {
  position: absolute;
  top: -4px;
  width: 4px;
  height: 16px;
  margin-left: -2px;
  border-radius: 1px;
  background: var(--nkg-brass-pale);
}
.desk .chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.desk .chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 9px;
  border: 1px solid #3a4452;
  border-radius: 999px;
  background: #1a212a;
  font-size: 12px;
  color: var(--nkg-text-soft);
  white-space: nowrap;
}
.desk .chip.bad {
  color: var(--nkg-bad-text);
}
.desk .divider {
  height: 1px;
  background: var(--nkg-divider);
}
.desk .label {
  margin: 2px 0 -4px;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--nkg-label);
}
.desk .acts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.country-tab.desk .acts .act {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 74px;
  padding: 6px 4px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.2;
  text-align: center;
}
.desk .act .nkg-icon {
  color: var(--nkg-brass);
}
.country-tab.desk .acts .act.on {
  background: var(--nkg-tile-on-bg);
  border-color: var(--nkg-brass-light);
  color: var(--nkg-brass-pale);
}
.country-tab.desk .acts .act.war {
  border-color: var(--nkg-danger-line);
  background: linear-gradient(180deg, #2a1a18, #1c1514);
  color: #f0b0a5;
}
.country-tab.desk .acts .act.war:hover:not(:disabled) {
  background: linear-gradient(180deg, #2a1a18, #1c1514);
  border-color: var(--nkg-bad-text);
}
.country-tab.desk .acts .act.on:hover:not(:disabled),
.country-tab.desk .segs .seg.on:hover:not(:disabled) {
  background: var(--nkg-tile-on-bg);
}
.desk .act.war .nkg-icon {
  color: var(--nkg-bad-text);
}
.desk .wars {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.desk .wars li {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--nkg-line);
  border-radius: 6px;
  background: var(--nkg-surface);
}
.desk .wars li.mine {
  border-color: var(--nkg-danger-line);
  background: linear-gradient(180deg, #2a1a18, #1c1514);
}
.desk .war-name {
  font-family: var(--nkg-serif);
  font-size: 16px;
  font-weight: 600;
}
.desk .sides {
  font-size: 12.5px;
  color: #c9b5ad;
}
.desk .peace {
  display: flex;
  gap: 6px;
}
.country-tab.desk .peace button,
.country-tab.desk .aid .wide {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
}
.desk .peace .nkg-icon,
.desk .aid .wide .nkg-icon {
  color: var(--nkg-brass);
}
.desk .aid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.desk .aid .wide {
  align-self: stretch;
}
.desk .aid-rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 220px;
  overflow: auto;
}
.desk .row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border: 1px solid var(--nkg-line);
  border-radius: 5px;
  background: var(--nkg-surface);
  font-size: 13px;
}
.desk .who-row {
  flex: 1;
  min-width: 0;
}
.desk .who-row b {
  font-weight: 600;
}
.desk .dir {
  color: var(--nkg-text-faint);
}
.desk .none {
  font-size: 12px;
  color: var(--nkg-text-faint);
}
.country-tab.desk .row .icon-btn {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
}
.desk .give {
  display: flex;
  align-items: center;
  gap: 8px;
}
.desk .give-label {
  font-size: 12.5px;
  color: var(--nkg-text-muted);
  white-space: nowrap;
}
.desk .segs {
  display: flex;
  flex: 1;
}
.country-tab.desk .segs .seg {
  flex: 1;
  height: 30px;
  padding: 0 4px;
  border-radius: 0;
  font-size: 12px;
}
.country-tab.desk .segs .seg:first-child {
  border-radius: 4px 0 0 4px;
}
.country-tab.desk .segs .seg:last-child {
  border-radius: 0 4px 4px 0;
}
.country-tab.desk .segs .seg + .seg {
  border-left: none;
}
.country-tab.desk .segs .seg.on {
  background: var(--nkg-tile-on-bg);
  border-color: var(--nkg-brass-light);
  color: var(--nkg-brass-pale);
}
.desk .offmap {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
</style>
