<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/game'
import ArmyRecruitment from './ArmyRecruitment.vue'
import ArmyComposition from './ArmyComposition.vue'
import { useProductionStats } from '@/composables/production'
import { isTouch } from '@/composables/layout'
import { MODERN_CATALOG } from '@/sim/units/catalog'
import { POSTURE_ORDER, POSTURES } from '@/sim/units/postures'
import {
  MISSION_GROUPS,
  MISSION_NAMES,
  MISSION_SHORT,
  MISSION_TEXT,
  isLineMission,
  missionAction,
} from '@/composables/missions'
import type {
  ArmyState,
  Encirclement,
  MissionKind,
  OrderKind,
  Posture,
  UnitSnapshot,
} from '@/sim/core/types'

const game = useGameStore()
const { selectedUnits, armies, selectedArmy, selectedArmyId } = storeToRefs(game)
const armyName = ref('')

/**
 * Contenu des forces, repris de l'ancien panneau à onglets :
 * - forces : encart de guerre et liste des armées (tiroir « Forces ») ;
 * - units : unités sélectionnées et leurs ordres (inspecteur) ;
 * - army : fiche de l'armée choisie (inspecteur).
 */
defineProps<{ section: 'forces' | 'units' | 'army' }>()

const ORDER_NAMES: Record<OrderKind, string> = {
  idle: 'En attente',
  move: 'En mouvement',
  attack: 'Attaque',
  hold: 'Tient la position',
  retreat: 'Repli',
  front: 'Tient le front',
  pursue: 'Poursuite',
}

const pct = (v: number): string => `${Math.round(v * 100)} %`
/** Largeur CSS (sans espace, contrairement à l'affichage). */
const cssPct = (v: number): string => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`
const status = (u: UnitSnapshot): string => {
  if (u.routed) return 'En déroute'
  const parts = [ORDER_NAMES[u.order]]
  if (u.posture !== 'balanced') parts.push(POSTURES[u.posture].name.toLowerCase())
  if (u.engaged) parts.push('au contact')
  if (u.stance) parts.push(u.stance)
  if (u.relief) parts.push('en relève')
  if (u.fatigue >= 0.3) parts.push(`fatigue ${Math.round(u.fatigue * 100)} %`)
  if (!u.supplied) parts.push('hors ravitaillement')
  if (!u.commanded && u.kind !== 'hq') parts.push('hors commandement')
  return parts.join(' · ')
}

const armyOf = (id: number | null): string =>
  armies.value.find((a) => a.id === id)?.name ?? 'Sans armée'

/** Synthèse d'un groupe d'unités : effectifs et organisation moyens, contacts, ravitaillement. */
function summary(list: UnitSnapshot[]): {
  strength: number
  org: number
  engaged: number
  unsupplied: number
} {
  const n = Math.max(1, list.length)
  return {
    strength: list.reduce((s, u) => s + u.strength, 0) / n,
    org: list.reduce((s, u) => s + u.org, 0) / n,
    engaged: list.filter((u) => u.engaged).length,
    unsupplied: list.filter((u) => !u.supplied).length,
  }
}
const selectionSummary = computed(() => summary(selectedUnits.value))
/** Posture commune de la sélection, ou null si elle est mêlée. */
const selectionPosture = computed(() => {
  const set = new Set(selectedUnits.value.map((u) => u.posture))
  return set.size === 1 ? [...set][0] : null
})
const armySummary = (a: { unitIds: number[] }): ReturnType<typeof summary> => {
  const ids = new Set(a.unitIds)
  return summary(game.snapshot?.units.filter((u) => ids.has(u.id)) ?? [])
}

/** État lisible d'un encerclement : mise en place, puis siège avec le temps restant. */
function encirclementStatus(enc: Encirclement): string {
  const tick = game.snapshot?.tick ?? 0
  if (enc.phase === 'staging') {
    return `Mise en place sur les flancs · ${enc.targetIds.length} ennemi(s) visé(s)`
  }
  const left = Math.max(0, Math.ceil((7 * 24 - (tick - (enc.closeTick ?? tick))) / 24))
  return `Anneau fermé · ${enc.targetIds.length} ennemi(s) encerclé(s) · retour dans ${left} j`
}

// ---------- Missions ----------

/** Infobulle des cartes de mission. */
const MISSION_HELP: Record<MissionKind, string> = {
  hold: "L'armée tient sa ligne (portion de front ou tout le front) ; une offensive ponctuelle reste possible",
  keyPoints:
    "L'armée tient son front en force sur les points clés (villes, passages de fleuve, nœuds routiers) et ne laisse qu'un écran ailleurs",
  depth:
    "L'armée tient son front sur deux lignes ; la première décroche plus tôt et cède du terrain pour user l'attaquant",
  reserve: "L'armée reste en retrait de son front et intervient sur les percées",
  advance:
    "L'armée avance jusqu'à une frontière, un trait ou un objectif, en ligne continue ; la posture règle le rythme",
  breach:
    "La moitié des unités de ligne perce en colonne serrée vers un point choisi ; le reste de l'armée tient le front et couvre les flancs de la percée",
  retreat:
    "L'armée se replie jusqu'à un trait ou une frontière par bonds alternés, un échelon couvrant l'autre, puis tient la ligne atteinte",
  encircle: "L'armée détache un groupe autour d'une cible ennemie et garde son front avec le reste",
}

function missionOf(a: ArmyState): MissionKind {
  if (a.encirclement) return 'encircle'
  return a.mission?.kind ?? 'hold'
}

/** État lisible de la mission d'une armée, pour la liste et la fiche. */
function missionStatus(a: ArmyState): string {
  if (a.encirclement) return encirclementStatus(a.encirclement)
  const m = a.mission
  if (m?.kind === 'advance') {
    const bonds = a.posture === 'defensive' || a.posture === 'maxDefense'
    const pace = bonds
      ? m.phase === 'digging'
        ? ' · arrêt, retranchement'
        : ' · bond en cours'
      : ''
    return `Avancer : ${m.label} · ${Math.round(m.progress * 100)} % du tracé tenu${pace}`
  }
  if (m?.kind === 'retreat') {
    return `Retraite : ${m.label} · ${Math.round(m.progress * 100)} % des unités sur la ligne`
  }
  if (m?.kind === 'breach') {
    return `Percée : ${m.shockIds.length} unité(s) de choc · ${Math.round(m.progress * 100)} % de l'axe tenu`
  }
  const where = a.wholeFront ? 'tout le front' : a.front ? 'portion de front' : 'sans front'
  let text =
    m?.kind === 'keyPoints'
      ? `Points clés : ${where}${a.keyPoints ? ` · ${a.keyPoints.length} point(s) clé(s) tenu(s)` : ''}`
      : m?.kind === 'depth'
        ? `Défense en profondeur : ${where}`
        : m?.kind === 'reserve'
          ? `Réserve : derrière ${where === 'sans front' ? 'sa position' : where}`
          : `Tenir : ${where}`
  if (a.offensive) {
    text += ` · offensive ${a.offensive.launched ? 'en cours' : 'planifiée'}`
    if (a.offensive.unitIds) text += ` (${a.offensive.unitIds.length} unités)`
  }
  return text
}

/** Sous-onglet de la fiche d'armée : commandement (missions, posture) ou recrutement. */
const armyView = ref<'command' | 'composition' | 'recruit'>('command')

/** Casernes libres du pays (pastille de l'onglet « Renforts »). */
const prodStats = useProductionStats()
const freeBarracks = computed(() => {
  const r = prodStats.value?.recruitment
  return r ? Math.max(0, r.max - r.active) : 0
})

/** Onglet de mission affiché pour l'armée choisie (suit la mission réelle quand elle change). */
const missionView = ref<MissionKind>('hold')
watch(
  () => (selectedArmy.value ? `${selectedArmy.value.id}:${missionOf(selectedArmy.value)}` : ''),
  () => {
    if (selectedArmy.value) missionView.value = missionOf(selectedArmy.value)
  },
  { immediate: true },
)

/** Choisit une carte de mission : rien n'est appliqué avant « Appliquer » ou la visée sur la carte. */
function chooseMission(kind: MissionKind): void {
  missionView.value = kind
}

const action = computed(() =>
  selectedArmy.value ? missionAction(missionView.value, missionOf(selectedArmy.value)) : null,
)

/** Applique la mission de ligne choisie. */
function applyMission(): void {
  const a = selectedArmy.value
  const kind = missionView.value
  if (!a || !isLineMission(kind) || missionOf(a) === kind) return
  if (kind === 'hold') void game.holdArmy(a.id)
  else void game.lineMissionArmy(a.id, kind)
}

/** Revient à la mission en cours (abandonne la carte choisie et son aperçu). */
function cancelChoice(): void {
  if (selectedArmy.value) missionView.value = missionOf(selectedArmy.value)
}

// Aperçu sur la carte de la mission de ligne choisie, tant qu'elle n'est pas appliquée. Recalculé quand
// le front de l'armée change de portion.
watch(
  () => {
    const a = selectedArmy.value
    if (!a || a.encirclement) return ''
    const view = missionView.value
    if (!isLineMission(view) || view === missionOf(a)) return ''
    return `${a.id}:${view}:${a.wholeFront ? 'all' : JSON.stringify(a.front ?? null)}`
  },
  (key) => {
    const a = selectedArmy.value
    const view = missionView.value
    void game.previewMission(a?.id ?? 0, key && a && isLineMission(view) ? view : null)
  },
  { immediate: true },
)
onBeforeUnmount(() => void game.previewMission(0, null))

/** Libellés courts des postures (sélecteur à cinq crans). */
const POSTURE_SHORT: Record<Posture, string> = {
  maxDefense: 'Déf. max',
  defensive: 'Défens.',
  balanced: 'Équil.',
  offensive: 'Offens.',
  maxDamage: 'Dégâts max',
}
const armyPosture = computed(() => POSTURES[selectedArmy.value?.posture ?? 'balanced'])
/** Multiplicateur affiché à la française : ×0,85. */
const factor = (v: number): string => `×${String(v).replace('.', ',')}`

/** Synthèse de l'armée choisie pour l'en-tête de sa fiche. */
const sheetSummary = computed(() => {
  const list = unitsOfArmy.value
  return {
    ...summary(list),
    supplied: list.length ? list.filter((u) => u.supplied).length / list.length : 1,
  }
})

/** Armée visée par l'encart de guerre : celle choisie, sinon la plus grande. */
const briefArmy = computed(
  () =>
    selectedArmy.value ??
    [...armies.value].sort((a, b) => b.unitIds.length - a.unitIds.length)[0] ??
    null,
)

/** Action de l'encart de guerre qui passe par la carte : l'encart se ferme. */
function briefAction(fn: () => void): void {
  fn()
  game.warBrief = null
}

/** Unités sélectionnées qui appartiennent à l'armée choisie (offensive partielle). */
const chosenInArmy = computed(() => {
  const a = selectedArmy.value
  if (!a) return 0
  const ids = new Set(a.unitIds)
  return game.selection.filter((id) => ids.has(id)).length
})

const unitsOfArmy = computed(() => {
  const a = selectedArmy.value
  if (!a) return []
  const ids = new Set(a.unitIds)
  return game.snapshot?.units.filter((u) => ids.has(u.id)) ?? []
})

const attachTo = ref<number | null>(null)
async function attach(): Promise<void> {
  const id = attachTo.value ?? armies.value[0]?.id
  if (id !== undefined && id !== null) await game.addSelectionToArmy(id)
}

async function createArmy(): Promise<void> {
  await game.createArmyFromSelection(armyName.value)
  armyName.value = ''
}
</script>

<template>
  <div class="forces">
    <!-- Unités sélectionnées -->
    <template v-if="section === 'units'">
      <p v-if="selectedUnits.length === 0" class="empty">
        {{
          isTouch
            ? 'Touchez une de vos unités pour la sélectionner, ou utilisez la sélection par zone (▢).'
            : 'Cliquez sur une de vos unités pour la sélectionner, Maj + clic pour en ajouter.'
        }}
      </p>
      <template v-else>
        <div class="summary" data-testid="selection-summary">
          <strong>{{ selectedUnits.length }} unité{{ selectedUnits.length > 1 ? 's' : '' }}</strong>
          <span class="gauge" title="Effectifs moyens">
            <i :style="{ width: cssPct(selectionSummary.strength) }" class="strength" />
          </span>
          <span class="gauge" title="Organisation moyenne">
            <i :style="{ width: cssPct(selectionSummary.org) }" class="org" />
          </span>
          <span v-if="selectionSummary.engaged" class="chip warn">
            {{ selectionSummary.engaged }} au contact
          </span>
          <span v-if="selectionSummary.unsupplied" class="chip warn">
            {{ selectionSummary.unsupplied }} sans ravitaillement
          </span>
        </div>
        <div class="group">
          <span class="label">Mouvement</span>
          <button
            title="Déplacer (M) — ou clic droit sur la carte"
            @click="game.startOrder('move')"
          >
            Déplacer
          </button>
          <button title="Tenir la position (H)" @click="game.hold()">Tenir</button>
          <button title="Se replier (R)" @click="game.startOrder('retreat')">Se replier</button>
          <button
            title="Annule l'ordre en cours : les unités s'arrêtent (celles d'une armée reprennent leur poste)"
            data-testid="cancel-order"
            @click="game.cancelOrders()"
          >
            Annuler l'ordre
          </button>
        </div>
        <div class="group">
          <span class="label">Attaque</span>
          <button title="Attaquer une zone (T)" @click="game.startOrder('attack')">Zone</button>
          <button
            title="Attaquer la position actuelle d'une unité ennemie, puis tenir le terrain"
            data-testid="order-assault"
            @click="game.startTargetOrder('assault')"
          >
            Assaut
          </button>
          <button
            title="Suivre une unité ennemie jusqu'à sa destruction ou sa fuite"
            data-testid="order-pursue"
            @click="game.startTargetOrder('pursue')"
          >
            Poursuite
          </button>
          <button
            :disabled="selectedUnits.length < 2"
            title="Les unités sélectionnées quittent leur armée et entourent la cible ; l'armée garde son front"
            data-testid="order-encircle"
            @click="game.startTargetOrder('encircle')"
          >
            Encercler
          </button>
        </div>
        <div class="group" data-testid="group-mission">
          <span class="label">Mission « Avancer » (groupe détaché)</span>
          <button
            title="Les unités choisies forment un groupe qui avance jusqu'à la frontière avec le pays cliqué, puis rejoint son armée"
            @click="game.startAdvance('border')"
          >
            Frontière
          </button>
          <button
            title="Le groupe avance jusqu'à un trait libre (clics successifs, ou glisser), puis rejoint son armée"
            @click="game.startAdvance('line')"
          >
            Trait
          </button>
          <button
            title="Le groupe avance jusqu'au point cliqué, puis rejoint son armée"
            @click="game.startAdvance('objective')"
          >
            Objectif
          </button>
        </div>
        <div class="group" data-testid="posture">
          <span class="label">Posture</span>
          <button
            v-for="p in POSTURE_ORDER"
            :key="p"
            :class="{ active: selectionPosture === p }"
            :title="POSTURES[p].description"
            @click="game.setPosture(p)"
          >
            {{ POSTURES[p].name }}
          </button>
        </div>
        <ul class="units">
          <li v-for="u in selectedUnits" :key="u.id">
            <div class="row">
              <span class="name">{{ u.name }}</span>
              <span class="meta">{{ MODERN_CATALOG[u.kind].name }}</span>
            </div>
            <div class="row">
              <span class="gauge" :title="`Effectifs ${pct(u.strength)}`">
                <i :style="{ width: cssPct(u.strength) }" class="strength" />
              </span>
              <span class="gauge" :title="`Organisation ${pct(u.org)}`">
                <i :style="{ width: cssPct(u.org) }" class="org" />
              </span>
            </div>
            <div class="meta">{{ armyOf(u.armyId) }} · {{ game.terrainNameAt(u.lon, u.lat) }}</div>
            <div class="status" :class="{ warn: u.routed || !u.supplied }">{{ status(u) }}</div>
          </li>
        </ul>
        <form v-if="armies.length" class="create" @submit.prevent="attach">
          <select v-model="attachTo" aria-label="Armée à rejoindre">
            <option v-for="a in armies" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
          <button type="submit">Rattacher la sélection à cette armée</button>
        </form>
        <form class="create" @submit.prevent="createArmy">
          <input v-model="armyName" placeholder="Nom de la nouvelle armée" maxlength="40" />
          <button type="submit">Créer une armée</button>
        </form>
      </template>
    </template>

    <!-- Armées -->
    <template v-else-if="section === 'forces'">
      <section v-if="game.warBrief" class="war-brief" data-testid="war-brief">
        <h3>Guerre contre {{ game.warBrief.enemyName }}</h3>
        <template v-if="briefArmy">
          <p>
            <strong>{{ briefArmy.name }}</strong> ·
            <span data-testid="war-brief-status">{{ missionStatus(briefArmy) }}</span>
          </p>
          <p v-if="missionOf(briefArmy) === 'hold' && !briefArmy.offensive" class="meta">
            Elle se déploie sur la frontière et la tient sans attaquer : elle se retranche et répond
            aux percées. Pour prendre l'initiative :
          </p>
          <div class="group">
            <button
              class="primary"
              :title="`Mission « Avancer » : l'armée traverse ${game.warBrief.enemyName} jusqu'à sa frontière avec un pays tiers, en ligne continue`"
              data-testid="war-brief-border"
              @click="game.advanceToBorder(briefArmy.id, game.warBrief.enemy)"
            >
              Avancer en {{ game.warBrief.enemyName }}
            </button>
            <button
              title="Mission « Avancer » jusqu'à un trait : posez les points sur la carte (clics, puis Entrée ou « Valider »), ou dessinez-le d'un geste"
              data-testid="war-brief-line"
              @click="briefAction(() => game.startAdvance('line', briefArmy!.id))"
            >
              Jusqu'à un trait
            </button>
            <button
              title="Offensive ponctuelle de toute l'armée : deux clics sur la carte (départ, objectif), puis « Lancer »"
              data-testid="war-brief-offensive"
              @click="briefAction(() => game.startOffensive(briefArmy!.id))"
            >
              Offensive
            </button>
          </div>
          <div class="group">
            <span class="label">Posture</span>
            <button
              v-for="p in POSTURE_ORDER"
              :key="p"
              :class="{ active: (briefArmy.posture ?? 'balanced') === p }"
              :title="POSTURES[p].description"
              :data-testid="`war-brief-posture-${p}`"
              @click="game.setArmyPosture(briefArmy.id, p)"
            >
              {{ POSTURES[p].name }}
            </button>
          </div>
        </template>
        <p v-else class="meta">
          Aucune armée : sélectionnez des unités et formez-en une depuis l'inspecteur.
        </p>
        <button class="close" data-testid="war-brief-close" @click="game.warBrief = null">
          Fermer
        </button>
      </section>
      <ul class="armies">
        <li
          v-for="a in armies"
          :key="a.id"
          :class="{ active: a.id === selectedArmyId }"
          @click="game.selectArmy(a.id)"
        >
          <span class="row">
            <span class="name">{{ a.name }}</span>
            <span class="meta">{{ a.unitIds.length }} unités</span>
          </span>
          <span class="row">
            <span class="gauge" title="Effectifs moyens">
              <i :style="{ width: cssPct(armySummary(a).strength) }" class="strength" />
            </span>
            <span class="gauge" title="Organisation moyenne">
              <i :style="{ width: cssPct(armySummary(a).org) }" class="org" />
            </span>
          </span>
          <span class="meta" :class="{ enc: missionOf(a) !== 'hold' }">
            {{ missionStatus(a) }}
            <template v-if="armySummary(a).engaged">
              · {{ armySummary(a).engaged }} au contact</template
            >
          </span>
        </li>
      </ul>
      <p v-if="armies.length === 0" class="empty">
        Aucune armée : sélectionnez des unités et créez-en une depuis l'inspecteur.
      </p>
    </template>

    <!-- Fiche de l'armée choisie -->
    <template v-else-if="section === 'army'">
      <section v-if="selectedArmy" class="army" data-testid="army-sheet">
        <div class="army-head" data-testid="army-head">
          <div class="row">
            <span class="kicker">Armée · {{ selectedArmy.unitIds.length }} unités</span>
          </div>
          <div class="bar-row">
            <span>Effectifs</span>
            <span class="gauge wide"
              ><i :style="{ width: cssPct(sheetSummary.strength) }" class="strength"
            /></span>
            <span class="num">{{ pct(sheetSummary.strength) }}</span>
          </div>
          <div class="bar-row">
            <span>Organisation</span>
            <span class="gauge wide"
              ><i :style="{ width: cssPct(sheetSummary.org) }" class="org"
            /></span>
            <span class="num">{{ pct(sheetSummary.org) }}</span>
          </div>
          <div class="bar-row">
            <span>Ravitaillement</span>
            <span class="gauge wide"
              ><i
                :style="{ width: cssPct(sheetSummary.supplied) }"
                :class="sheetSummary.unsupplied ? 'cut' : 'strength'"
            /></span>
            <span :class="sheetSummary.unsupplied ? 'bad' : 'ok'">
              {{ sheetSummary.unsupplied ? `${sheetSummary.unsupplied} coupée(s)` : 'tout relié' }}
            </span>
          </div>
          <p class="current">
            En cours :
            <strong data-testid="mission-status">{{ missionStatus(selectedArmy) }}</strong> ·
            {{ POSTURES[selectedArmy.posture ?? 'balanced'].name.toLowerCase() }} ·
            {{ sheetSummary.engaged }} au contact
          </p>
        </div>
        <div class="subtabs" role="tablist">
          <button
            role="tab"
            :class="{ active: armyView === 'command' }"
            data-testid="army-view-command"
            @click="armyView = 'command'"
          >
            Ordre
          </button>
          <button
            role="tab"
            :class="{ active: armyView === 'composition' }"
            data-testid="army-view-composition"
            @click="armyView = 'composition'"
          >
            Composition
          </button>
          <button
            role="tab"
            :class="{ active: armyView === 'recruit' }"
            data-testid="army-view-recruit"
            @click="armyView = 'recruit'"
          >
            Renforts<span
              v-if="freeBarracks > 0"
              class="tag"
              :title="`${freeBarracks} caserne(s) libre(s)`"
              data-testid="free-barracks"
              >{{ freeBarracks }}</span
            >
          </button>
        </div>
        <ArmyRecruitment v-if="armyView === 'recruit'" :army="selectedArmy" />
        <ArmyComposition v-else-if="armyView === 'composition'" :army="selectedArmy" />
        <template v-else>
          <div data-testid="army-mission">
            <div v-for="g in MISSION_GROUPS" :key="g.label" class="mgroup">
              <p class="kicker">{{ g.label }}</p>
              <div class="mcards">
                <button
                  v-for="k in g.kinds"
                  :key="k"
                  class="mcard"
                  :class="{ on: missionView === k, cur: missionOf(selectedArmy) === k }"
                  :aria-pressed="missionView === k"
                  :disabled="!!selectedArmy.encirclement && k !== 'encircle'"
                  :title="MISSION_HELP[k]"
                  :data-testid="`mission-${k}`"
                  @click="chooseMission(k)"
                >
                  <span class="t"
                    >{{ MISSION_NAMES[k]
                    }}<span v-if="missionOf(selectedArmy) === k" class="tag">en cours</span></span
                  >
                  <span class="d">{{ MISSION_SHORT[k] }}</span>
                </button>
              </div>
            </div>
          </div>
          <div class="detail" data-testid="mission-detail">
            <div class="row">
              <strong>{{ MISSION_NAMES[missionView] }}</strong>
              <span
                v-if="game.missionPreview && game.missionPreview.armyId === selectedArmy.id"
                class="tag preview"
                data-testid="mission-preview"
                >aperçu sur la carte</span
              >
              <span v-else-if="action?.kind === 'aim'" class="tag preview">visée sur la carte</span>
            </div>
            <p class="meta" :data-testid="`mission-help-${missionView}`">
              {{ MISSION_TEXT[missionView] }}
            </p>
            <template v-if="isLineMission(missionView) && !selectedArmy.encirclement">
              <p
                v-if="!selectedArmy.front && !selectedArmy.wholeFront"
                class="meta warn"
                data-testid="mission-no-front"
              >
                L'armée n'a pas de front : assignez-lui une portion ou tout le front.
              </p>
              <div class="group">
                <span class="label">Front tenu</span>
                <button @click="game.startFront(selectedArmy.id)">Assigner une portion</button>
                <button @click="game.setWholeFront(selectedArmy.id)">Tout le front</button>
                <button @click="game.clearFront(selectedArmy.id)">Aucun</button>
              </div>
              <div v-if="action?.kind === 'current'" class="group">
                <span class="label">Offensive ponctuelle</span>
                <button
                  title="Toutes les unités de ligne de l'armée participent"
                  @click="game.startOffensive(selectedArmy.id)"
                >
                  Planifier (toute l'armée)
                </button>
                <button
                  :disabled="chosenInArmy === 0 || chosenInArmy === selectedArmy.unitIds.length"
                  title="Seules les unités sélectionnées de cette armée attaquent ; les autres tiennent le front. Sélectionnez-les sur la carte (clic, Maj + clic ou sélection par zone)."
                  data-testid="offensive-selection"
                  @click="game.startOffensive(selectedArmy.id, true)"
                >
                  Avec la sélection ({{ chosenInArmy }})
                </button>
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
            </template>
            <div v-else-if="missionView === 'advance'" class="group">
              <span class="label">Viser sur la carte : avancer jusqu'à…</span>
              <button
                title="Cliquez ensuite sur un pays : l'armée reprend son territoire perdu le long de sa frontière, ou traverse l'ennemi jusqu'à elle"
                data-testid="advance-border"
                @click="game.startAdvance('border', selectedArmy.id)"
              >
                Une frontière
              </button>
              <button
                title="Posez les points du trait (clics, puis Entrée ou « Valider »), ou dessinez-le d'un geste"
                data-testid="advance-line"
                @click="game.startAdvance('line', selectedArmy.id)"
              >
                Un trait
              </button>
              <button
                title="Cliquez sur le point à atteindre"
                data-testid="advance-objective"
                @click="game.startAdvance('objective', selectedArmy.id)"
              >
                Un objectif
              </button>
            </div>
            <div v-else-if="missionView === 'breach'" class="group" data-testid="breach-group">
              <p v-if="!selectedArmy.front && !selectedArmy.wholeFront" class="meta warn">
                Assignez d'abord un front à l'armée, sinon les flancs restent découverts.
              </p>
              <button
                class="primary"
                title="Cliquez ensuite sur le point visé, chez l'ennemi"
                data-testid="breach-target"
                @click="game.startBreach(selectedArmy.id)"
              >
                {{
                  missionOf(selectedArmy) === 'breach'
                    ? 'Changer le point visé'
                    : 'Viser sur la carte'
                }}
              </button>
            </div>
            <div v-else-if="missionView === 'retreat'" class="group" data-testid="retreat-group">
              <span class="label">Viser sur la carte : se replier jusqu'à…</span>
              <button
                title="Posez les points de la ligne de repli, dans votre territoire (clics, puis Entrée ou « Valider »), ou dessinez-la d'un geste"
                data-testid="retreat-line"
                @click="game.startRetreat('line', selectedArmy.id)"
              >
                Un trait
              </button>
              <button
                title="Cliquez ensuite sur un pays : l'armée se replie sur sa frontière avec lui, dans le territoire qu'elle tient"
                data-testid="retreat-border"
                @click="game.startRetreat('border', selectedArmy.id)"
              >
                Une frontière
              </button>
            </div>
            <div v-else-if="selectedArmy.encirclement" class="group">
              <span class="label">Encerclement de {{ selectedArmy.encirclement.targetName }}</span>
              <button data-testid="end-encirclement" @click="game.endEncirclement(selectedArmy.id)">
                Rejoindre l'armée
              </button>
            </div>
            <div v-else class="group">
              <button
                class="primary"
                title="L'armée détache un tiers de ses unités de ligne autour d'une cible ennemie et garde son front avec le reste"
                data-testid="army-encircle"
                @click="game.startTargetOrder('encircle', selectedArmy.id)"
              >
                Viser sur la carte
              </button>
            </div>
            <div v-if="action && action.kind !== 'current'" class="row actions">
              <button data-testid="mission-cancel" @click="cancelChoice">Annuler</button>
              <button
                v-if="action.kind === 'apply'"
                class="primary"
                data-testid="mission-apply"
                @click="applyMission"
              >
                {{ action.label }}
              </button>
            </div>
          </div>
          <div class="posture-box" data-testid="army-posture">
            <p class="kicker">Posture</p>
            <div class="segs">
              <button
                v-for="p in POSTURE_ORDER"
                :key="p"
                class="seg"
                :class="{ on: (selectedArmy.posture ?? 'balanced') === p }"
                :aria-pressed="(selectedArmy.posture ?? 'balanced') === p"
                :title="`${POSTURES[p].name} : ${POSTURES[p].description}`"
                :data-testid="`army-posture-${p}`"
                @click="game.setArmyPosture(selectedArmy.id, p)"
              >
                {{ POSTURE_SHORT[p] }}
              </button>
            </div>
            <div class="stats" data-testid="posture-stats">
              <div>
                <span>Attaque</span><span class="num">{{ factor(armyPosture.attack) }}</span>
              </div>
              <div>
                <span>Défense</span><span class="num">{{ factor(armyPosture.defense) }}</span>
              </div>
              <div>
                <span>Décroche sous</span
                ><span class="num">{{ pct(armyPosture.routOrg) }} org.</span>
              </div>
            </div>
            <p class="meta">{{ armyPosture.reflex }}</p>
          </div>
          <button class="danger" @click="game.disbandArmy(selectedArmy.id)">
            Dissoudre l'armée
          </button>
        </template>
      </section>
    </template>
  </div>
</template>

<style scoped>
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
/* Onglets de la fiche d'armée. */
.subtabs {
  display: flex;
  gap: 4px;
  margin: 4px 0 8px;
}
.subtabs .tag {
  margin-left: 4px;
}
/* Encart affiché après une déclaration de guerre. */
.war-brief {
  border: 1px solid #b91c1c;
  background: rgba(127, 29, 29, 0.25);
  border-radius: 8px;
  padding: 8px 10px;
  margin-bottom: 8px;
}
.war-brief h3 {
  margin: 0 0 4px;
  color: #fca5a5;
}
.war-brief p {
  margin: 2px 0 6px;
}
.war-brief .primary {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}
.war-brief .close {
  margin-top: 4px;
}
/* ---------- Fiche d'armée : en-tête, cartes de mission, posture (maquette A1) ---------- */
.army-head {
  padding: 8px 10px;
  margin-bottom: 8px;
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
.bar-row {
  display: grid;
  grid-template-columns: 92px 1fr auto;
  align-items: center;
  gap: 8px;
  margin: 3px 0;
  font-size: 12px;
}
.gauge.wide {
  max-width: none;
}
.gauge .cut {
  background: var(--frame-amber, #f2a33a);
}
.num {
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 12px;
}
.ok {
  color: #3fb37f;
  font-size: 12px;
}
.bad,
.meta.warn {
  color: var(--frame-amber, #f2a33a);
}
.current {
  margin: 6px 0 0;
  font-size: 12px;
  color: #c3c9d2;
}
.mgroup {
  margin-bottom: 8px;
}
.mcards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
.mcard {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-height: 52px;
  padding: 6px 8px;
  text-align: left;
  background: #1b2028;
  border-color: var(--frame-line, #263140);
}
.mcard .t {
  font:
    600 14px/1.2 'Barlow Condensed',
    system-ui,
    sans-serif;
  display: flex;
  gap: 6px;
  align-items: center;
}
.mcard .d {
  color: #9aa3af;
  font-size: 12px;
}
.mcard.on {
  border-color: var(--frame-blue, #4c8dff);
  background: rgba(76, 141, 255, 0.14);
}
.mcard.cur {
  box-shadow: inset 3px 0 0 #38bdf8;
}
.tag {
  font:
    500 10px/1.4 'IBM Plex Mono',
    ui-monospace,
    monospace;
  padding: 0 5px;
  border-radius: 4px;
  background: #263140;
  color: #9fc2ff;
}
.tag.preview {
  margin-left: auto;
}
.mcard .tag {
  position: absolute;
  top: 5px;
  right: 5px;
}
.detail {
  border: 1px solid var(--frame-blue, #4c8dff);
  border-radius: 8px;
  padding: 8px 10px;
  margin-bottom: 10px;
  background: rgba(76, 141, 255, 0.06);
}
.detail p {
  margin: 4px 0 8px;
}
.detail .row {
  justify-content: flex-start;
}
.actions {
  justify-content: flex-end !important;
}
button.primary {
  background: var(--frame-blue, #4c8dff);
  border-color: var(--frame-blue, #4c8dff);
  color: #fff;
}
.posture-box {
  margin-bottom: 8px;
}
.segs {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  border: 1px solid var(--frame-line, #263140);
  border-radius: 6px;
  overflow: hidden;
}
.seg {
  border: none;
  border-radius: 0;
  padding: 5px 2px;
  font-size: 11px;
  line-height: 1.15;
  background: #1b2028;
  white-space: normal;
}
.seg + .seg {
  border-left: 1px solid var(--frame-line, #263140);
}
.seg.on {
  background: var(--frame-blue, #4c8dff);
  color: #fff;
}
.stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  margin: 6px 0 2px;
}
.stats div {
  display: flex;
  flex-direction: column;
  padding: 4px 6px;
  background: #1b2028;
  border-radius: 6px;
  font-size: 11px;
  color: #9aa3af;
}
.stats .num {
  color: #e8eaed;
  font-size: 13px;
}
button.danger {
  margin-top: 8px;
  border-color: #7f1d1d;
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
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  margin-bottom: 8px;
  padding: 6px 8px;
  background: #1b2028;
  border-radius: 6px;
}
/* Jauge fine : effectifs (vert) et organisation (bleu). */
.gauge {
  flex: 1;
  min-width: 50px;
  max-width: 120px;
  height: 5px;
  background: #2c323c;
  border-radius: 3px;
  overflow: hidden;
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
.enc {
  color: #fcd34d;
}
.chip {
  font-size: 12px;
  padding: 1px 6px;
  border-radius: 8px;
  background: #2c323c;
}
.chip.warn {
  background: #4c1d1d;
  color: #fecaca;
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
input,
select {
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
.forces h3:first-child {
  margin-top: 0;
}
</style>
