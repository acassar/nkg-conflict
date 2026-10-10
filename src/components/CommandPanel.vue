<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/game'
import ProductionTab from './ProductionTab.vue'
import CountryTab from './CountryTab.vue'
import EventLog from './EventLog.vue'
import ArmyRecruitment from './ArmyRecruitment.vue'
import { isMobile, isTouch, layout } from '@/composables/layout'
import { MODERN_CATALOG } from '@/sim/units/catalog'
import { POSTURE_ORDER, POSTURES } from '@/sim/units/postures'
import type {
  ArmyState,
  Encirclement,
  MissionKind,
  OrderKind,
  UnitSnapshot,
} from '@/sim/core/types'

const game = useGameStore()
const { selectedUnits, armies, selectedArmy, selectedArmyId, panelTab: tab } = storeToRefs(game)
const armyName = ref('')
const collapsed = ref(false)
const panel = ref<HTMLElement | null>(null)
const portrait = computed(() => layout.value === 'portrait')
/** Corps du panneau visible : replié en bureau/paysage, tiroir fermé en portrait. */
const bodyVisible = computed(() =>
  portrait.value ? game.drawer !== 'collapsed' : !collapsed.value,
)

function selectTab(next: typeof tab.value): void {
  tab.value = next
  if (portrait.value && game.drawer === 'collapsed') game.drawer = 'half'
}

// ---------- Tiroir (portrait) ----------

const DRAWER_STATES = ['collapsed', 'half', 'full'] as const
/** Hauteur pendant un glisser du tiroir (null hors glisser). */
const dragHeight = ref<number | null>(null)
let dragStart: { y: number; height: number; moved: boolean } | null = null

function heights(): Record<(typeof DRAWER_STATES)[number], number> {
  const vh = window.innerHeight
  const header = panel.value?.querySelector('header')?.getBoundingClientRect().height ?? 56
  return { collapsed: header + 14, half: Math.round(vh * 0.48), full: vh - 52 }
}

function onHandleDown(e: PointerEvent): void {
  if (!portrait.value || !panel.value) return
  dragStart = { y: e.clientY, height: panel.value.getBoundingClientRect().height, moved: false }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onHandleMove(e: PointerEvent): void {
  if (!dragStart) return
  const dy = dragStart.y - e.clientY
  if (Math.abs(dy) > 6) dragStart.moved = true
  if (!dragStart.moved) return
  const h = heights()
  dragHeight.value = Math.max(h.collapsed, Math.min(h.full, dragStart.height + dy))
}

function onHandleUp(): void {
  if (!dragStart) return
  const start = dragStart
  dragStart = null
  if (!start.moved) {
    // Simple toucher de la poignée : état suivant.
    const k = DRAWER_STATES.indexOf(game.drawer)
    game.drawer = DRAWER_STATES[(k + 1) % DRAWER_STATES.length] ?? 'half'
    return
  }
  const h = heights()
  const now = dragHeight.value ?? start.height
  let best: (typeof DRAWER_STATES)[number] = 'half'
  for (const st of DRAWER_STATES) if (Math.abs(h[st] - now) < Math.abs(h[best] - now)) best = st
  game.drawer = best
  dragHeight.value = null
}

const drawerStyle = computed(() =>
  portrait.value && dragHeight.value !== null ? { height: `${dragHeight.value}px` } : undefined,
)

// Hauteur réelle du tiroir, pour placer les boutons flottants au-dessus.
let observer: ResizeObserver | null = null
onMounted(() => {
  observer = new ResizeObserver(() => {
    game.drawerHeight = portrait.value ? (panel.value?.offsetHeight ?? 0) : 0
  })
  if (panel.value) observer.observe(panel.value)
})
onBeforeUnmount(() => observer?.disconnect())
watch(portrait, (p) => {
  game.drawerHeight = p ? (panel.value?.offsetHeight ?? 0) : 0
})

// Pendant la saisie d'un ordre, le tiroir se replie pour dégager la carte, puis revient.
let drawerBeforeOrder: typeof game.drawer | null = null
watch(
  () => game.mode.kind,
  (kind) => {
    if (!portrait.value) return
    if (kind !== 'select' && drawerBeforeOrder === null) {
      drawerBeforeOrder = game.drawer
      game.drawer = 'collapsed'
    } else if (kind === 'select' && drawerBeforeOrder !== null) {
      game.drawer = drawerBeforeOrder
      drawerBeforeOrder = null
    }
  },
)
// Une sélection, une ville ou un pays choisis sur la carte ouvrent le tiroir.
watch(
  () => game.selection.length,
  (n, before) => {
    if (!portrait.value || n === 0 || before > 0 || game.mode.kind !== 'select') return
    tab.value = 'units'
    if (game.drawer === 'collapsed') game.drawer = 'half'
  },
)
watch(tab, () => {
  if (portrait.value && game.drawer === 'collapsed' && game.mode.kind === 'select') {
    game.drawer = 'half'
  }
})

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

const MISSION_NAMES: Record<MissionKind, string> = {
  hold: 'Tenir',
  keyPoints: 'Points clés',
  depth: 'Profondeur',
  reserve: 'Réserve',
  advance: 'Avancer',
  breach: 'Percée',
  retreat: 'Retraite',
  encircle: 'Encercler',
}
const MISSION_ORDER: MissionKind[] = [
  'hold',
  'keyPoints',
  'depth',
  'reserve',
  'advance',
  'breach',
  'retreat',
  'encircle',
]
/** Missions qui gardent le front de l'armée, appliquées d'un clic. */
const LINE_MISSIONS: ReadonlyArray<MissionKind> = ['hold', 'keyPoints', 'depth', 'reserve']
/** Aide affichée sous les missions de ligne autres que « Tenir ». */
const LINE_MISSION_TEXT: Partial<Record<MissionKind, string>> = {
  keyPoints:
    'Unités concentrées sur les villes, passages de fleuve et nœuds routiers du front (repères orange sur la carte) ; simple écran ailleurs.',
  depth:
    "Trois cinquièmes des unités de ligne tiennent le contact, les autres une seconde ligne 25 km en arrière ; la première ligne décroche plus tôt et cède du terrain pour user l'attaquant.",
  reserve:
    "Unités en retrait, 40 km derrière le front de l'armée ; elles contre-attaquent toute percée à moins de 150 km, puis reviennent.",
}
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
const armyView = ref<'command' | 'recruit'>('command')

/** Onglet de mission affiché pour l'armée choisie (suit la mission réelle quand elle change). */
const missionView = ref<MissionKind>('hold')
watch(
  () => (selectedArmy.value ? `${selectedArmy.value.id}:${missionOf(selectedArmy.value)}` : ''),
  () => {
    if (selectedArmy.value) missionView.value = missionOf(selectedArmy.value)
  },
  { immediate: true },
)

function chooseMission(kind: MissionKind): void {
  const a = selectedArmy.value
  if (!a) return
  missionView.value = kind
  // Les missions de ligne s'appliquent tout de suite ; « Avancer » et « Encercler » demandent un but.
  const current = a.mission?.kind ?? 'hold'
  if (kind === current) return
  if (kind === 'hold') void game.holdArmy(a.id)
  else if (kind === 'keyPoints' || kind === 'depth' || kind === 'reserve') {
    void game.lineMissionArmy(a.id, kind)
  }
}

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
  tab.value = 'armies'
}
</script>

<template>
  <aside
    ref="panel"
    class="panel"
    :class="{
      collapsed: !bodyVisible,
      drawer: portrait,
      side: layout === 'landscape',
      touch: isTouch,
      [`drawer-${game.drawer}`]: portrait,
      dragging: dragHeight !== null,
    }"
    :style="drawerStyle"
    data-testid="command-panel"
  >
    <div
      v-if="portrait"
      class="handle"
      role="button"
      aria-label="Agrandir ou réduire le panneau"
      data-testid="drawer-handle"
      @pointerdown="onHandleDown"
      @pointermove="onHandleMove"
      @pointerup="onHandleUp"
      @pointercancel="onHandleUp"
    >
      <span />
    </div>
    <header>
      <nav>
        <button :class="{ active: tab === 'units' }" @click="selectTab('units')">
          Unités <span class="count">{{ selectedUnits.length }}</span>
        </button>
        <button :class="{ active: tab === 'armies' }" @click="selectTab('armies')">
          Armées <span class="count">{{ armies.length }}</span>
        </button>
        <button :class="{ active: tab === 'production' }" @click="selectTab('production')">
          {{ portrait ? 'Prod.' : 'Production' }}
        </button>
        <button
          :class="{ active: tab === 'country' }"
          data-testid="tab-country"
          @click="selectTab('country')"
        >
          {{ portrait ? 'Diplo.' : 'Diplomatie' }}
        </button>
        <button v-if="isMobile" :class="{ active: tab === 'log' }" @click="selectTab('log')">
          Journal
        </button>
      </nav>
      <button
        v-if="!portrait"
        class="toggle"
        :aria-label="collapsed ? 'Déplier' : 'Replier'"
        @click="collapsed = !collapsed"
      >
        {{ collapsed ? '▾' : '▴' }}
      </button>
    </header>

    <div v-if="bodyVisible" class="body">
      <!-- Unités sélectionnées -->
      <template v-if="tab === 'units'">
        <p v-if="selectedUnits.length === 0" class="empty">
          {{
            isTouch
              ? 'Touchez une de vos unités pour la sélectionner, ou utilisez la sélection par zone (▢).'
              : 'Cliquez sur une de vos unités pour la sélectionner, Maj + clic pour en ajouter.'
          }}
        </p>
        <template v-else>
          <div class="summary" data-testid="selection-summary">
            <strong
              >{{ selectedUnits.length }} unité{{ selectedUnits.length > 1 ? 's' : '' }}</strong
            >
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
              <div class="meta">
                {{ armyOf(u.armyId) }} · {{ game.terrainNameAt(u.lon, u.lat) }}
              </div>
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

      <ProductionTab v-else-if="tab === 'production'" />

      <CountryTab v-else-if="tab === 'country'" />

      <EventLog v-else-if="tab === 'log'" embedded :limit="40" />

      <!-- Armées -->
      <template v-else>
        <section v-if="game.warBrief" class="war-brief" data-testid="war-brief">
          <h3>Guerre contre {{ game.warBrief.enemyName }}</h3>
          <template v-if="briefArmy">
            <p>
              <strong>{{ briefArmy.name }}</strong> ·
              <span data-testid="war-brief-status">{{ missionStatus(briefArmy) }}</span>
            </p>
            <p v-if="missionOf(briefArmy) === 'hold' && !briefArmy.offensive" class="meta">
              Elle se déploie sur la frontière et la tient sans attaquer : elle se retranche et
              répond aux percées. Pour prendre l'initiative :
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
          <p v-else class="meta">Aucune armée : formez-en une depuis l'onglet Unités.</p>
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

        <section v-if="selectedArmy" class="army">
          <h3>{{ selectedArmy.name }}</h3>
          <p class="meta">
            {{ unitsOfArmy.filter((u) => u.engaged).length }} au contact ·
            {{ unitsOfArmy.filter((u) => !u.supplied).length }} hors ravitaillement
          </p>
          <div class="subtabs" role="tablist">
            <button
              role="tab"
              :class="{ active: armyView === 'command' }"
              data-testid="army-view-command"
              @click="armyView = 'command'"
            >
              Commandement
            </button>
            <button
              role="tab"
              :class="{ active: armyView === 'recruit' }"
              data-testid="army-view-recruit"
              @click="armyView = 'recruit'"
            >
              Recrutement
            </button>
          </div>
          <ArmyRecruitment v-if="armyView === 'recruit'" :army="selectedArmy" />
          <template v-else>
            <div class="group" data-testid="army-mission">
              <span class="label">Mission</span>
              <button
                v-for="k in MISSION_ORDER"
                :key="k"
                :class="{ active: missionView === k, current: missionOf(selectedArmy) === k }"
                :disabled="!!selectedArmy.encirclement && k !== 'encircle'"
                :title="MISSION_HELP[k]"
                :data-testid="`mission-${k}`"
                @click="chooseMission(k)"
              >
                {{ MISSION_NAMES[k] }}
              </button>
              <span class="meta" data-testid="mission-status">{{
                missionStatus(selectedArmy)
              }}</span>
            </div>
            <template v-if="LINE_MISSIONS.includes(missionView) && !selectedArmy.encirclement">
              <p
                v-if="LINE_MISSION_TEXT[missionView]"
                class="meta"
                :data-testid="`mission-help-${missionView}`"
              >
                {{ LINE_MISSION_TEXT[missionView] }}
              </p>
              <div class="group">
                <span class="label">Front tenu</span>
                <button @click="game.startFront(selectedArmy.id)">Assigner une portion</button>
                <button @click="game.setWholeFront(selectedArmy.id)">Tout le front</button>
                <button @click="game.clearFront(selectedArmy.id)">Aucun</button>
              </div>
              <div class="group">
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
              <span class="label">Avancer jusqu'à…</span>
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
              <span class="meta">
                Rythme selon la posture : continu en équilibrée ou offensive ; par bonds de 25 km,
                avec retranchement à chaque arrêt, en défensive.
              </span>
            </div>
            <div v-else-if="missionView === 'breach'" class="group" data-testid="breach-group">
              <span class="label">Percée sur un axe</span>
              <button
                title="Cliquez ensuite sur le point visé, chez l'ennemi"
                data-testid="breach-target"
                @click="game.startBreach(selectedArmy.id)"
              >
                {{
                  missionOf(selectedArmy) === 'breach'
                    ? 'Changer le point visé'
                    : 'Choisir le point visé'
                }}
              </button>
              <span class="meta">
                La moitié des unités de ligne, les plus proches du point de départ, attaque en
                colonne serrée vers le point visé. Le reste de l'armée tient son front et se
                concentre de part et d'autre de la percée pour couvrir ses flancs<template
                  v-if="!selectedArmy.front && !selectedArmy.wholeFront"
                >
                  (assignez d'abord un front à l'armée, sinon les flancs restent
                  découverts)</template
                >. Fin au point visé : l'armée reprend son front.
              </span>
            </div>
            <div v-else-if="missionView === 'retreat'" class="group" data-testid="retreat-group">
              <span class="label">Se replier jusqu'à…</span>
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
              <span class="meta">
                Au contact, les unités de ligne reculent par bonds de 20 km en deux échelons : l'un
                se replie pendant que l'autre tient et couvre son départ. Loin de l'ennemi, repli
                d'une traite ; l'appui part en premier. Arrivée : l'armée tient la ligne atteinte.
              </span>
            </div>
            <div v-else-if="selectedArmy.encirclement" class="group">
              <span class="label">Encerclement de {{ selectedArmy.encirclement.targetName }}</span>
              <button data-testid="end-encirclement" @click="game.endEncirclement(selectedArmy.id)">
                Rejoindre l'armée
              </button>
            </div>
            <div v-else class="group">
              <span class="label">Encerclement</span>
              <button
                title="L'armée détache un tiers de ses unités de ligne autour d'une cible ennemie et garde son front avec le reste"
                data-testid="army-encircle"
                @click="game.startTargetOrder('encircle', selectedArmy.id)"
              >
                Détachement automatique
              </button>
            </div>
            <div class="group">
              <span class="label">Posture de l'armée</span>
              <button
                v-for="p in POSTURE_ORDER"
                :key="p"
                :class="{ active: (selectedArmy.posture ?? 'balanced') === p }"
                :title="POSTURES[p].description"
                @click="game.setArmyPosture(selectedArmy.id, p)"
              >
                {{ POSTURES[p].name }}
              </button>
            </div>
            <button class="danger" @click="game.disbandArmy(selectedArmy.id)">
              Dissoudre l'armée
            </button>
          </template>
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
  width: 320px;
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
/* Sous-onglets de la fiche d'armée. */
.subtabs {
  display: flex;
  gap: 4px;
  margin: 4px 0 8px;
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
/* Mission réellement en cours (l'onglet affiché peut être un autre, le temps de choisir un but). */
button.current {
  box-shadow: inset 0 -3px 0 #38bdf8;
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
/* Les onglets (production, diplomatie…) partagent le style des boutons du panneau. */
.panel :deep(button) {
  background: #2c323c;
  color: inherit;
  border: 1px solid #3b4250;
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
  font: inherit;
}
.panel :deep(button:hover:not(:disabled)) {
  background: #363d49;
}
.panel :deep(button:disabled) {
  opacity: 0.45;
  cursor: default;
}
.panel :deep(button.active) {
  background: #2563eb;
  border-color: #2563eb;
}
.panel :deep(button.danger) {
  border-color: #7f1d1d;
}
.count {
  display: inline-block;
  min-width: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.12);
  font-size: 11px;
  text-align: center;
}
/* Cibles tactiles plus grandes. */
.panel.touch :deep(button) {
  min-height: 36px;
  padding: 6px 10px;
}
.panel.touch {
  font-size: 14px;
}

/* ---------- Téléphone en portrait : tiroir en bas ---------- */
.panel.drawer {
  top: auto;
  left: 0;
  right: 0;
  bottom: 0;
  width: auto;
  max-height: none;
  border-radius: 14px 14px 0 0;
  border-bottom: none;
  padding-bottom: env(safe-area-inset-bottom);
  transition: height 0.2s ease;
}
.panel.drawer.dragging {
  transition: none;
}
.panel.drawer-half {
  height: 48dvh;
}
.panel.drawer-full {
  height: calc(100dvh - 52px);
}
.panel.drawer header {
  padding-top: 0;
}
.panel.drawer nav {
  overflow-x: auto;
  scrollbar-width: none;
  flex-wrap: nowrap;
}
.panel.drawer nav button {
  flex: none;
  padding: 6px 8px;
}
.panel.drawer .body {
  flex: 1;
  min-height: 0;
}
.handle {
  display: flex;
  justify-content: center;
  padding: 8px 0 6px;
  touch-action: none;
  cursor: grab;
}
.handle span {
  width: 44px;
  height: 5px;
  border-radius: 3px;
  background: #4b5563;
}

/* ---------- Téléphone couché : panneau sur le côté ---------- */
.panel.side {
  top: 48px;
  right: 6px;
  bottom: 6px;
  width: min(320px, 46vw);
  max-height: none;
}
.panel.side.collapsed {
  bottom: auto;
}
.panel.side nav {
  flex-wrap: wrap;
}
</style>
