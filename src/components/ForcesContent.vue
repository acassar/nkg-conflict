<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/game'
import ArmyRecruitment from './ArmyRecruitment.vue'
import ArmyComposition from './ArmyComposition.vue'
import ForcesTree from './ForcesTree.vue'
import EchelonSymbol from './EchelonSymbol.vue'
import { useProductionStats } from '@/composables/production'
import { isTouch, layout } from '@/composables/layout'
import NkgIcon, { type IconName } from './NkgIcon.vue'
import { selectionFormation } from '@/composables/composition'
import { countSubordinates, spanText } from '@/sim/systems/command'
import { battalionsOf, compositionText, templateLabel, templateOf } from '@/sim/units/templates'
import { BATTALIONS } from '@/sim/units/battalions'
import { EMBARK_KM } from '@/sim/systems/naval'
import { MODE_NAMES } from '@/sim/systems/transport'
import {
  AIR_COLORS,
  AIR_MISSION_NAMES,
  AIR_MISSIONS,
  AIR_RANGE_KM,
  AIR_ZONE_KM,
  AIR_ZONES_MAX,
} from '@/sim/systems/air'
import { distanceKm } from '@/sim/theater/grid'
import { borderSummary } from '@/map/borderPaint'
import { POSTURE_ORDER, POSTURES } from '@/sim/units/postures'
import {
  missionGroups,
  MISSION_NAMES,
  MISSION_SHORT,
  MISSION_TEXT,
  isLineMission,
  missionAction,
} from '@/composables/missions'
import type {
  DefendPointKinds,
  ArmyState,
  Encirclement,
  MissionKind,
  NavalSnapshot,
  TransportSnapshot,
  OrderKind,
  Posture,
  UnitSnapshot,
} from '@/sim/core/types'

const game = useGameStore()

/** Marine provisoire du joueur : ports tenus, capacité, unités en mer. */
const naval = computed(
  () => game.snapshot?.naval ?? { capacity: 0, ports: [], atSea: [] as NavalSnapshot['atSea'] },
)
/** Aviation provisoire du joueur : puissance et zones de mission. */
const air = computed(() => game.snapshot?.air ?? { power: 0, zones: [], enemyZones: [] })
/** Transport stratégique du joueur : unités en route vers une ville. */
const transport = computed(
  () =>
    game.snapshot?.transport ?? {
      airCapacity: 0,
      inTransit: [] as TransportSnapshot['inTransit'],
    },
)
/** « Débarquer » : une unité choisie près d'un port tenu, et de la place dans les convois. */
const landing = computed(() => {
  const free = naval.value.capacity - naval.value.atSea.length
  const near = selectedUnits.value.filter((u) =>
    naval.value.ports.some((p) => distanceKm(u.lon, u.lat, p.lon, p.lat) <= EMBARK_KM),
  ).length
  if (near === 0)
    return { ok: false, title: `Aucune unité choisie à moins de ${EMBARK_KM} km d'un port tenu` }
  if (free <= 0)
    return { ok: false, title: 'Capacité navale épuisée : toutes les places sont en mer' }
  return {
    ok: true,
    title: `Embarquer ${Math.min(near, free)} brigade(s) au port le plus proche, puis cliquer sur une côte (${free} place(s) libre(s))`,
  }
})
const { selectedUnits, armies, selectedArmy, selectedArmyId, armyView } = storeToRefs(game)
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
  equipment: number
  org: number
  engaged: number
  unsupplied: number
} {
  const n = Math.max(1, list.length)
  return {
    strength: list.reduce((s, u) => s + u.strength, 0) / n,
    equipment: list.reduce((s, u) => s + u.equipment, 0) / n,
    org: list.reduce((s, u) => s + u.org, 0) / n,
    engaged: list.filter((u) => u.engaged).length,
    unsupplied: list.filter((u) => !u.supplied).length,
  }
}
const selectionSummary = computed(() => summary(selectedUnits.value))
/** Division (et corps) des unités choisies : « 3e division · IIe corps ». */
const formationLabel = computed(() => {
  const f = selectionFormation(selectedUnits.value, game.snapshot?.formations ?? [])
  if (!f) return null
  return [f.division?.name, f.corps?.name].filter(Boolean).join(' · ')
})
/**
 * Liste de l'inspecteur : les brigades choisies, groupées par division quand elles en mêlent plusieurs
 * (pile de pions, sélection par zone). Un clic sur une division la sélectionne entière, un clic sur une
 * brigade la sélectionne seule.
 */
const unitGroups = computed(() => {
  const list = selectedUnits.value
  const formations = game.snapshot?.formations ?? []
  const keys = new Set(list.map((u) => u.divisionId))
  if (keys.size <= 1) return [{ key: 'all', division: null, total: 0, units: list }]
  const groups = new Map<number | null, UnitSnapshot[]>()
  for (const u of list) groups.set(u.divisionId, [...(groups.get(u.divisionId) ?? []), u])
  const number = (id: number | null): number =>
    formations.find((f) => f.id === id)?.number ?? Number.MAX_SAFE_INTEGER
  return [...groups]
    .sort(([a], [b]) => number(a) - number(b))
    .map(([id, units]) => {
      const f = id === null ? undefined : formations.find((x) => x.id === id)
      return {
        key: `d${id ?? 'none'}`,
        division: f ? { id: f.id, name: f.name } : null,
        total: f ? divisionMembers(f.id).length : units.length,
        units,
      }
    })
})
/** Brigades du joueur d'une division. */
const divisionMembers = (id: number): number[] => {
  const s = game.snapshot
  return (
    s?.units.filter((u) => u.owner === s.playerCountry && u.divisionId === id).map((u) => u.id) ??
    []
  )
}
const pickUnit = (u: UnitSnapshot): void => game.selectUnits([u.id], false)
const pickDivision = (id: number): void => game.selectUnits(divisionMembers(id), false)
/** Bataillons d'une brigade (composition, pour une brigade choisie seule). */
const battalionRows = (u: UnitSnapshot) =>
  battalionsOf(templateOf({ kind: u.kind, template: u.template ?? undefined }) ?? '').map((b) => ({
    ...b,
    name: BATTALIONS[b.kind].name,
  }))
/** Couleur du joueur, pour les symboles d'échelon. */
const playerColor = computed(() => {
  const s = game.snapshot
  const c = s?.countries.find((x) => x.id === s.playerCountry)?.color
  return c ? `rgb(${c.join(',')})` : '#2563eb'
})
/** En-tête de l'inspecteur : symbole de l'échelon choisi, son nom et le fil d'Ariane au-dessus. */
const echelonHead = computed(() => {
  const info = game.selectionInfo
  const first = selectedUnits.value[0]
  if (!info?.echelon || !first) return null
  const counts = new Map<string, number>()
  for (const u of selectedUnits.value) counts.set(u.kind, (counts.get(u.kind) ?? 0) + 1)
  const kind = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? first.kind
  const above = [
    info.army?.name,
    info.echelon !== 'corps' && info.echelon !== 'army' ? info.corps?.name : undefined,
    info.echelon === 'brigade' ? info.division?.name : undefined,
  ].filter((x) => x && x !== info.name)
  return {
    echelon: info.echelon,
    kind: kind as typeof first.kind,
    name: info.echelon === 'brigade' ? first.name : (info.name ?? ''),
    crumbs: info.echelon === 'army' ? 'Armée' : above.join(' › '),
  }
})
/** Étendue de commandement du corps des unités choisies (sélection d'un corps entier ou d'une partie). */
const corpsSpan = computed(() => {
  const formations = game.snapshot?.formations ?? []
  const corps = selectionFormation(selectedUnits.value, formations)?.corps
  if (!corps) return null
  return `Étendue du ${corps.name} : ${spanText(countSubordinates(formations, { corps: corps.id }))}`
})
/** Étendue de commandement de l'armée affichée. */
const armySpan = computed(() =>
  selectedArmy.value
    ? spanText(countSubordinates(game.snapshot?.formations ?? [], { army: selectedArmy.value.id }))
    : '',
)
/** Posture commune de la sélection, ou null si elle est mêlée. */
const selectionPosture = computed(() => {
  const set = new Set(selectedUnits.value.map((u) => u.posture))
  return set.size === 1 ? [...set][0] : null
})
/** Mission en cours d'une armée et unités au contact, pour la vue Forces. */
const armyStatusById = (id: number): string => {
  const a = armies.value.find((x) => x.id === id)
  if (!a) return ''
  const engaged = armySummary(a).engaged
  return `${missionStatus(a)}${engaged ? ` · ${engaged} au contact` : ''}`
}
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
  defendPoints:
    "L'armée répartit ses brigades entre les villes, ports, bases et aérodromes du pays ou d'une zone, selon leur importance",
}

function missionOf(a: ArmyState): MissionKind {
  if (a.encirclement) return 'encircle'
  return a.mission?.kind ?? 'hold'
}

/** En paix, les cartes Percée, Encercler et Retraite sont masquées. */
const atWar = computed(() => [...game.stances.map.values()].includes('enemy'))
const visibleGroups = computed(() =>
  missionGroups(atWar.value, selectedArmy.value ? missionOf(selectedArmy.value) : 'hold'),
)

/** L'armée tient une ligne : portion de front, tout le front ou une frontière. */
const holdsLine = (a: ArmyState): boolean => !!(a.front || a.wholeFront || a.border?.length)

/** Frontière tenue, en clair : longueur, voisins, armées qui la partagent. */
function borderText(a: ArmyState): string {
  const g = game.grid
  const s = game.snapshot
  if (!g || !s || !a.border?.length) return ''
  const side = g.sides.indexOf(a.owner)
  const mine = borderSummary(g, side, a.border)
  const name = (code: string): string => s.countries.find((c) => c.id === code)?.name ?? code
  const sharing = armies.value.filter(
    (o) =>
      o.id !== a.id &&
      o.border?.length &&
      borderSummary(g, side, o.border).neighbors.some((n) => mine.neighbors.includes(n)),
  )
  const km = (v: number): number => Math.round(v / 10) * 10
  const land = mine.km - mine.coastKm
  const parts: string[] = []
  if (land > 0 && mine.neighbors.length)
    parts.push(`environ ${km(land)} km avec ${mine.neighbors.map(name).join(', ')}`)
  if (mine.coastKm > 0) parts.push(`environ ${km(mine.coastKm)} km de côte`)
  let text = `Frontière tenue : ${parts.join(' et ')}`
  if (sharing.length) text += ` · partagée avec ${sharing.map((o) => o.name).join(', ')}`
  return text
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
  if (m?.kind === 'defendPoints') {
    const units = m.points.reduce((s, p) => s + p.units, 0)
    return `Défendre des points : ${m.points.length} point(s)${m.zone ? ` dans ${m.zone.km} km` : ' du pays'} · ${units} brigade(s)`
  }
  if (m?.kind === 'breach') {
    return `Percée : ${m.shockIds.length} unité(s) de choc · ${Math.round(m.progress * 100)} % de l'axe tenu`
  }
  const where = a.wholeFront
    ? 'tout le front'
    : a.borderFront
      ? 'frontière devenue front'
      : a.front
        ? 'portion de front'
        : a.border?.length
          ? 'frontière'
          : 'sans front'
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

/** Casernes libres du pays (pastille de l'onglet « Renforts »). */
const prodStats = useProductionStats()
const freeBarracks = computed(() => {
  const r = prodStats.value?.recruitment
  return r ? Math.max(0, r.max - r.active) : 0
})

/** Mission « Défendre des points » : types cochés et rayon de la zone. */
const POINT_KINDS: ReadonlyArray<{ key: keyof DefendPointKinds; label: string }> = [
  { key: 'cities', label: 'Villes (capitale d’abord)' },
  { key: 'ports', label: 'Ports' },
  { key: 'bases', label: 'Bases (casernes, dépôts, fortifications)' },
  { key: 'airfields', label: 'Aérodromes (villes de 200 000 habitants)' },
]
const pointKinds = ref<DefendPointKinds>({
  cities: true,
  ports: true,
  bases: true,
  airfields: true,
})
const zoneKm = ref(200)

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

// ---------- Fiche compacte de la sélection et volet accolé (sous la fiche sur téléphone) ----------

const desktop = computed(() => layout.value === 'desktop')
/** Visée sur la carte en cours : le volet s'efface pour la dégager, puis revient (sauf frontière). */
const aiming = computed(() => game.mode.kind !== 'select' && game.mode.kind !== 'border')
type Flyout = 'order' | 'posture' | 'mission' | 'details' | 'recruit'
/** Volet ouvert à gauche de la fiche, ou aucun. */
const flyout = ref<Flyout | null>(null)
function toggleFlyout(f: Flyout): void {
  flyout.value = flyout.value === f ? null : f
}
const FLYOUT_TITLES: Record<Flyout, string> = {
  order: 'Ordres',
  posture: 'Posture',
  mission: 'Mission « Avancer »',
  details: 'Détails',
  recruit: 'Renforts',
}
/** Division entière sélectionnée et son armée : ses renforts se commandent depuis sa fiche. */
const recruitDivision = computed(() => {
  const info = game.selectionInfo
  if (info?.echelon !== 'division' || !info.division || !info.army) return null
  const army = armies.value.find((a) => a.id === info.army?.id)
  return army ? { division: info.division, army } : null
})
/** Brigades déjà commandées pour la division sélectionnée. */
const divisionPending = computed(() => {
  const d = recruitDivision.value?.division.id
  return d === undefined
    ? 0
    : (game.economy?.recruitment.filter((q) => q.divisionId === d).length ?? 0)
})
watch(recruitDivision, (r) => {
  if (!r && flyout.value === 'recruit') flyout.value = null
})
/** Ordre commun de la sélection, en clair. */
const selectionOrder = computed(() => {
  const set = new Set(selectedUnits.value.map((u) => u.order))
  return set.size === 1 ? ORDER_NAMES[[...set][0] as OrderKind] : 'Ordres mêlés'
})
/** Libellé du bouton « Échelon au-dessus » : la formation que la touche U sélectionnerait. */
const upTarget = computed(() => {
  const info = game.selectionInfo
  if (!info || info.echelon === 'army') return null
  if (info.echelon === 'brigade' && info.division) return info.division.name
  if ((info.echelon === 'brigade' || info.echelon === 'division') && info.corps)
    return info.corps.name
  return info.army?.name ?? null
})
/** Sous-titre de la fiche : modèle d'une brigade seule, sinon nombre de brigades. */
const sheetSubtitle = computed(() => {
  const list = selectedUnits.value
  const first = list[0]
  if (list.length === 1 && first) return templateLabel(first)
  return `${list.length} brigade${list.length > 1 ? 's' : ''}`
})
const gaugeColor = (v: number): string =>
  v >= 0.7 ? 'var(--nkg-good)' : v >= 0.4 ? 'var(--nkg-warn)' : 'var(--nkg-bad)'
const terrainHere = computed(() => {
  const u = selectedUnits.value[0]
  return u ? game.terrainNameAt(u.lon, u.lat) : ''
})
const ORDER_TILES: {
  label: string
  icon: IconName
  title: string
  testid?: string
  run: () => void
}[] = [
  {
    label: 'Déplacer',
    icon: 'move',
    title: 'Déplacer (M) — ou clic droit sur la carte',
    run: () => game.startOrder('move'),
  },
  { label: 'Tenir', icon: 'hold', title: 'Tenir la position (H)', run: () => game.hold() },
  {
    label: 'Se replier',
    icon: 'retreat',
    title: 'Se replier (R)',
    run: () => game.startOrder('retreat'),
  },
  {
    label: 'Transporter',
    icon: 'truck',
    title:
      "Transport stratégique (rail, mer ou air) : cliquer ensuite sur la ville d'arrivée, chez vous ou chez un ami",
    testid: 'order-transport',
    run: () => game.startTransport(),
  },
]
const ATTACK_TILES: {
  label: string
  icon: IconName
  title: string
  testid?: string
  run: () => void
}[] = [
  {
    label: 'Zone',
    icon: 'forces',
    title: 'Attaquer une zone (T)',
    run: () => game.startOrder('attack'),
  },
  {
    label: 'Assaut',
    icon: 'move',
    title: "Attaquer la position actuelle d'une unité ennemie, puis tenir le terrain",
    testid: 'order-assault',
    run: () => game.startTargetOrder('assault'),
  },
  {
    label: 'Poursuite',
    icon: 'right',
    title: "Suivre une unité ennemie jusqu'à sa destruction ou sa fuite",
    testid: 'order-pursue',
    run: () => game.startTargetOrder('pursue'),
  },
]

// Fiche d'armée : Mission, Posture, Composition et Renforts s'ouvrent dans le volet.
type ArmyPanel = 'command' | 'posture' | 'composition' | 'recruit'
const armyPanel = ref<ArmyPanel | null>(armyView.value === 'command' ? null : armyView.value)
/** Volet affiché, ou aucun. */
const armyShown = computed<ArmyPanel | null>(() => armyPanel.value)
function toggleArmyPanel(p: ArmyPanel): void {
  armyPanel.value = armyPanel.value === p ? null : p
  if (p !== 'posture') armyView.value = p
}
function closeArmyPanel(): void {
  armyPanel.value = null
  armyView.value = 'command'
}
// « Commander des renforts » ailleurs dans l'interface ouvre le volet des renforts.
watch(armyView, (v) => {
  if (v !== 'command') armyPanel.value = v
})
const ARMY_PANEL_TITLES: Record<ArmyPanel, string> = {
  command: 'Mission',
  posture: 'Posture',
  composition: 'Composition',
  recruit: 'Renforts',
}
/** Corps de l'armée affichée, pour l'échelon en dessous. */
const armyCorps = computed(() => {
  const a = selectedArmy.value
  if (!a) return []
  return (game.snapshot?.formations ?? []).filter((f) => f.kind === 'corps' && f.armyId === a.id)
})

/** Sélectionne les brigades d'un corps (ses divisions). */
function pickCorps(id: number): void {
  const s = game.snapshot
  if (!s) return
  const divisions = new Set(
    s.formations.filter((f) => f.id === id || f.parentId === id).map((f) => f.id),
  )
  game.selectUnits(
    s.units
      .filter(
        (u) => u.owner === s.playerCountry && u.divisionId !== null && divisions.has(u.divisionId),
      )
      .map((u) => u.id),
    false,
  )
}

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
      <!-- Fiche compacte ; ordres, posture, mission et détails dans un volet accolé (sous les tuiles sur téléphone). -->
      <div v-else class="sheet" data-testid="unit-sheet">
        <button
          v-if="upTarget"
          class="up"
          title="Sélectionner l'échelon au-dessus (U)"
          data-testid="echelon-up"
          @click="game.selectUp()"
        >
          <NkgIcon name="up" :size="16" />
          <span class="up-text"
            ><span class="up-k">Échelon au-dessus</span><span>{{ upTarget }}</span></span
          >
        </button>
        <div class="sheet-head" data-testid="selection-echelon">
          <EchelonSymbol
            v-if="echelonHead"
            :echelon="echelonHead.echelon"
            :kind="echelonHead.kind"
            :size="52"
            :color="playerColor"
          />
          <div class="sheet-title">
            <h3>{{ echelonHead?.name ?? `${selectedUnits.length} unités` }}</h3>
            <span class="sub">{{ sheetSubtitle }}</span>
            <span v-if="formationLabel" class="sub faint" data-testid="selection-formation">{{
              formationLabel
            }}</span>
          </div>
        </div>
        <div class="sheet-bars" data-testid="selection-summary">
          <div
            v-for="g in [
              { k: 'Effectifs', v: selectionSummary.strength },
              { k: 'Matériel', v: selectionSummary.equipment },
              { k: 'Organisation', v: selectionSummary.org },
            ]"
            :key="g.k"
          >
            <div class="bar-head">
              <span>{{ g.k }}</span
              ><span class="num">{{ pct(g.v) }}</span>
            </div>
            <div class="bar">
              <i :style="{ width: cssPct(g.v), background: gaugeColor(g.v) }" />
            </div>
          </div>
        </div>
        <div class="chips">
          <span class="chip"><span class="dot" />{{ selectionOrder }}</span>
          <span v-if="terrainHere" class="chip">{{ terrainHere }}</span>
          <span v-if="selectionSummary.engaged" class="chip warn"
            >{{ selectionSummary.engaged }} au contact</span
          >
          <span v-if="selectionSummary.unsupplied" class="chip warn"
            >{{ selectionSummary.unsupplied }} sans ravitaillement</span
          >
        </div>
        <p v-if="corpsSpan" class="faint small" data-testid="selection-span">{{ corpsSpan }}</p>
        <div class="divider" />
        <div class="tiles">
          <button
            class="tile"
            :class="{ on: flyout === 'order' }"
            :aria-expanded="flyout === 'order'"
            data-testid="tile-order"
            @click="toggleFlyout('order')"
          >
            <span class="tk"><NkgIcon name="move" :size="16" />Ordre</span>
            <span class="tv">{{ selectionOrder }}</span>
          </button>
          <button
            class="tile"
            :class="{ on: flyout === 'posture' }"
            :aria-expanded="flyout === 'posture'"
            data-testid="tile-posture"
            @click="toggleFlyout('posture')"
          >
            <span class="tk"><NkgIcon name="shield" :size="16" />Posture</span>
            <span class="tv">{{
              selectionPosture ? POSTURES[selectionPosture].name : 'Mêlées'
            }}</span>
          </button>
          <button
            class="tile"
            :class="{ on: flyout === 'mission' }"
            :aria-expanded="flyout === 'mission'"
            data-testid="tile-mission"
            @click="toggleFlyout('mission')"
          >
            <span class="tk"><NkgIcon name="mission" :size="16" />Mission</span>
            <span class="tv">Avancer en groupe</span>
          </button>
          <button
            class="tile"
            :class="{ on: flyout === 'details' }"
            :aria-expanded="flyout === 'details'"
            data-testid="tile-details"
            @click="toggleFlyout('details')"
          >
            <span class="tk"><NkgIcon name="info" :size="16" />Détails</span>
            <span class="tv">État, armée</span>
          </button>
          <button
            v-if="recruitDivision"
            class="tile span"
            :class="{ on: flyout === 'recruit' }"
            :aria-expanded="flyout === 'recruit'"
            data-testid="tile-recruit"
            @click="toggleFlyout('recruit')"
          >
            <span class="tk"><NkgIcon name="plus" :size="16" />Renforts</span>
            <span class="tv">{{
              divisionPending
                ? `${divisionPending} brigade${divisionPending > 1 ? 's' : ''} commandée${divisionPending > 1 ? 's' : ''}`
                : 'Nouvelles brigades'
            }}</span>
          </button>
        </div>

        <Teleport to="body" :disabled="!desktop">
          <section
            v-if="flyout && !aiming"
            class="flyout"
            :class="{ inline: !desktop, 'army-flyout': flyout === 'recruit' }"
            :aria-label="FLYOUT_TITLES[flyout]"
            :data-testid="`flyout-${flyout}`"
          >
            <header>
              <h3>{{ FLYOUT_TITLES[flyout] }}</h3>
              <button class="x" aria-label="Fermer le volet" @click="flyout = null">
                <NkgIcon name="close" :size="16" />
              </button>
            </header>
            <template v-if="flyout === 'order'">
              <div class="label">Mouvement</div>
              <div class="cmds">
                <button
                  v-for="t in ORDER_TILES"
                  :key="t.label"
                  class="cmd"
                  :title="t.title"
                  :data-testid="t.testid"
                  @click="t.run()"
                >
                  <NkgIcon :name="t.icon" :size="20" />{{ t.label }}
                </button>
                <button
                  v-if="naval.ports.length > 0"
                  class="cmd"
                  :disabled="!landing.ok"
                  :title="landing.title"
                  data-testid="order-landing"
                  @click="game.startLanding()"
                >
                  <NkgIcon name="flag" :size="20" />Débarquer
                </button>
              </div>
              <div class="label">Attaque</div>
              <div class="cmds">
                <button
                  v-for="t in ATTACK_TILES"
                  :key="t.label"
                  class="cmd"
                  :title="t.title"
                  :data-testid="t.testid"
                  @click="t.run()"
                >
                  <NkgIcon :name="t.icon" :size="20" />{{ t.label }}
                </button>
                <button
                  class="cmd"
                  :disabled="selectedUnits.length < 2"
                  title="Les unités sélectionnées quittent leur armée et entourent la cible ; l'armée garde son front"
                  data-testid="order-encircle"
                  @click="game.startTargetOrder('encircle')"
                >
                  <NkgIcon name="lasso" :size="20" />Encercler
                </button>
              </div>
              <button
                class="wide cancel"
                title="Annule l'ordre en cours : les unités s'arrêtent (celles d'une armée reprennent leur poste)"
                data-testid="cancel-order"
                @click="game.cancelOrders()"
              >
                Annuler l'ordre en cours
              </button>
            </template>
            <div v-else-if="flyout === 'posture'" class="opts" data-testid="posture">
              <button
                v-for="p in POSTURE_ORDER"
                :key="p"
                class="opt"
                :class="{ on: selectionPosture === p }"
                :aria-pressed="selectionPosture === p"
                @click="game.setPosture(p)"
              >
                <span class="ot">{{ POSTURES[p].name }}</span>
                <span class="od">{{ POSTURES[p].description }}</span>
              </button>
            </div>
            <div v-else-if="flyout === 'mission'" class="opts" data-testid="group-mission">
              <p class="faint small">
                Les unités choisies forment un groupe détaché qui avance, puis rejoint son armée.
              </p>
              <button class="opt" @click="game.startAdvance('border')">
                <span class="ot">Frontière</span>
                <span class="od">Jusqu'à la frontière avec le pays cliqué</span>
              </button>
              <button class="opt" @click="game.startAdvance('line')">
                <span class="ot">Trait</span>
                <span class="od">Jusqu'à un trait libre (clics successifs, ou glisser)</span>
              </button>
              <button class="opt" @click="game.startAdvance('objective')">
                <span class="ot">Objectif</span>
                <span class="od">Jusqu'au point cliqué</span>
              </button>
            </div>
            <ArmyRecruitment
              v-else-if="flyout === 'recruit' && recruitDivision"
              :army="recruitDivision.army"
              :division="recruitDivision.division"
            />
            <template v-else>
              <ul class="detail-list">
                <li v-for="u in selectedUnits" :key="u.id">
                  <span class="sname">{{ u.name }}</span>
                  <span class="faint small" data-testid="unit-template" :title="compositionText(u)"
                    >{{ templateLabel(u) }} · {{ armyOf(u.armyId) }}</span
                  >
                  <span class="small" :class="{ warn: u.routed || !u.supplied }">{{
                    status(u)
                  }}</span>
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
          </section>
        </Teleport>

        <!-- Échelon en dessous : bataillons d'une brigade seule, sinon brigades (par division). -->
        <template v-if="selectedUnits.length === 1 && selectedUnits[0]">
          <div class="label">Bataillons</div>
          <ul class="subs battalions" data-testid="unit-battalions">
            <li v-for="b in battalionRows(selectedUnits[0])" :key="b.kind">
              {{ b.count }} × {{ b.name }}
            </li>
          </ul>
        </template>
        <template v-else>
          <div class="label">Échelon en dessous · {{ selectedUnits.length }} brigades</div>
          <template v-for="g in unitGroups" :key="g.key">
            <button
              v-if="unitGroups.length > 1"
              class="sub-row group-row"
              data-testid="selection-group"
              :title="g.division ? 'Sélectionner toute cette division' : undefined"
              :disabled="!g.division"
              @click="g.division && pickDivision(g.division.id)"
            >
              <span class="sname">{{ g.division?.name ?? 'Sans division' }}</span>
              <span class="faint small"
                >{{ g.units.length }}{{ g.division ? ` / ${g.total}` : '' }}</span
              >
            </button>
            <button
              v-for="u in g.units"
              :key="u.id"
              class="sub-row"
              :class="{ nested: unitGroups.length > 1 }"
              data-testid="selection-unit"
              :title="`${templateLabel(u)} · sélectionner cette brigade seule`"
              @click="pickUnit(u)"
            >
              <span class="sname">{{ u.name }}</span>
              <span class="bar mini" :title="`Effectifs ${pct(u.strength)}`"
                ><i :style="{ width: cssPct(u.strength), background: gaugeColor(u.strength) }"
              /></span>
              <span
                class="bar mini"
                data-testid="unit-equipment"
                :title="`Matériel ${pct(u.equipment)}`"
                ><i :style="{ width: cssPct(u.equipment), background: gaugeColor(u.equipment) }"
              /></span>
            </button>
          </template>
        </template>
      </div>
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
      <section v-if="naval.atSea.length > 0" class="at-sea" data-testid="at-sea">
        <p class="label">
          En mer : {{ naval.atSea.length }} / {{ naval.capacity }} brigade{{
            naval.capacity > 1 ? 's' : ''
          }}
        </p>
        <ul>
          <li v-for="t in naval.atSea" :key="t.id">
            {{ t.name }} · parti de {{ t.port }} · débarque dans
            {{ Math.max(0, t.arriveTick - (game.snapshot?.tick ?? 0)) }} h
          </li>
        </ul>
      </section>
      <details v-if="air.power > 0" class="air" data-testid="air-panel">
        <summary>
          Aviation · puissance {{ Math.round(air.power) }} · {{ air.zones.length }} /
          {{ AIR_ZONES_MAX }} zones
          <span v-if="air.enemyZones.length > 0"> · {{ air.enemyZones.length }} ennemies</span>
        </summary>
        <ul v-if="air.zones.length > 0">
          <li v-for="z in air.zones" :key="z.id">
            <span class="air-dot" :style="{ background: AIR_COLORS[z.mission] }" />
            {{ AIR_MISSION_NAMES[z.mission] }}
            <button class="air-remove" title="Retirer cette zone" @click="game.removeAirZone(z.id)">
              Retirer
            </button>
          </li>
        </ul>
        <div class="air-missions">
          <button
            v-for="m in AIR_MISSIONS"
            :key="m"
            :disabled="air.zones.length >= AIR_ZONES_MAX"
            :title="`Nouvelle zone (${AIR_ZONE_KM} km de rayon, à moins de ${AIR_RANGE_KM} km d'un aérodrome tenu) : cliquer ensuite sur son centre`"
            :data-testid="`air-${m}`"
            @click="game.startAirZone(m)"
          >
            {{ AIR_MISSION_NAMES[m] }}
          </button>
        </div>
      </details>
      <section v-if="transport.inTransit.length > 0" class="at-sea" data-testid="in-transit">
        <p class="label">En route : {{ transport.inTransit.length }} unité(s)</p>
        <ul>
          <li v-for="t in transport.inTransit" :key="t.id">
            {{ t.name }} · {{ MODE_NAMES[t.mode] }} vers {{ t.dest }} · arrive dans
            {{ Math.max(0, t.arriveTick - (game.snapshot?.tick ?? 0)) }} h
          </li>
        </ul>
      </section>
      <ForcesTree :army-status="armyStatusById" />
    </template>

    <!-- Fiche de l'armée choisie -->
    <template v-else-if="section === 'army'">
      <section v-if="selectedArmy" class="army" data-testid="army-sheet">
        <div class="army-head sheet" data-testid="army-head">
          <div class="sheet-head">
            <EchelonSymbol echelon="army" kind="mech" :size="52" :color="playerColor" />
            <div class="sheet-title">
              <h3>{{ selectedArmy.name }}</h3>
              <span class="sub">Armée · {{ selectedArmy.unitIds.length }} unités</span>
            </div>
          </div>
          <div class="sheet-bars">
            <div
              v-for="g in [
                { k: 'Effectifs', v: sheetSummary.strength },
                { k: 'Matériel', v: sheetSummary.equipment },
                { k: 'Organisation', v: sheetSummary.org },
              ]"
              :key="g.k"
            >
              <div class="bar-head">
                <span>{{ g.k }}</span
                ><span class="num">{{ pct(g.v) }}</span>
              </div>
              <div class="bar">
                <i :style="{ width: cssPct(g.v), background: gaugeColor(g.v) }" />
              </div>
            </div>
          </div>
          <p class="current" :title="`Étendue de commandement : ${armySpan}`">
            <strong data-testid="mission-status">{{ missionStatus(selectedArmy) }}</strong>
          </p>
          <div class="chips">
            <span class="chip"><span class="dot" />{{ sheetSummary.engaged }} au contact</span>
            <span class="chip" :class="{ warn: sheetSummary.unsupplied }">{{
              sheetSummary.unsupplied ? `${sheetSummary.unsupplied} coupée(s)` : 'Tout relié'
            }}</span>
            <span
              class="chip"
              data-testid="army-span"
              :title="`Étendue de commandement : ${armySpan}`"
              >Étendue : {{ armySpan }}</span
            >
          </div>
          <div class="divider" />
          <div class="tiles">
            <button
              class="tile"
              :class="{ on: armyPanel === 'command' }"
              :aria-expanded="armyPanel === 'command'"
              data-testid="army-view-command"
              @click="toggleArmyPanel('command')"
            >
              <span class="tk"><NkgIcon name="mission" :size="16" />Mission</span>
              <span class="tv">{{ MISSION_NAMES[missionOf(selectedArmy)] }}</span>
            </button>
            <button
              class="tile"
              :class="{ on: armyPanel === 'posture' }"
              :aria-expanded="armyPanel === 'posture'"
              data-testid="army-tile-posture"
              @click="toggleArmyPanel('posture')"
            >
              <span class="tk"><NkgIcon name="shield" :size="16" />Posture</span>
              <span class="tv">{{ armyPosture.name }}</span>
            </button>
            <button
              class="tile"
              :class="{ on: armyPanel === 'composition' }"
              :aria-expanded="armyPanel === 'composition'"
              data-testid="army-view-composition"
              @click="toggleArmyPanel('composition')"
            >
              <span class="tk"><NkgIcon name="forces" :size="16" />Composition</span>
              <span class="tv">Bataillons, corps</span>
            </button>
            <button
              class="tile"
              :class="{ on: armyPanel === 'recruit' }"
              :aria-expanded="armyPanel === 'recruit'"
              data-testid="army-view-recruit"
              @click="toggleArmyPanel('recruit')"
            >
              <span class="tk"
                ><NkgIcon name="plus" :size="16" />Renforts<span
                  v-if="freeBarracks > 0"
                  class="tag"
                  :title="`${freeBarracks} place(s) de formation libre(s)`"
                  data-testid="free-barracks"
                  >{{ freeBarracks }}</span
                ></span
              >
              <span class="tv">Divisions, brigades</span>
            </button>
          </div>
          <template v-if="armyCorps.length">
            <div class="label">Échelon en dessous · {{ armyCorps.length }} corps</div>
            <button
              v-for="c in armyCorps"
              :key="c.id"
              class="sub-row"
              title="Sélectionner ce corps"
              data-testid="army-corps"
              @click="pickCorps(c.id)"
            >
              <EchelonSymbol echelon="corps" kind="mech" :size="22" :color="playerColor" />
              <span class="sname">{{ c.name }}</span>
            </button>
          </template>
        </div>
        <Teleport to="body" :disabled="!desktop">
          <section
            v-if="armyShown && !aiming"
            class="flyout army-flyout"
            :class="{ inline: !desktop }"
            :data-testid="`army-flyout-${armyShown}`"
          >
            <header>
              <h3>{{ ARMY_PANEL_TITLES[armyShown] }}</h3>
              <button class="x" aria-label="Fermer le volet" @click="closeArmyPanel">
                <NkgIcon name="close" :size="16" />
              </button>
            </header>
            <ArmyRecruitment v-if="armyShown === 'recruit'" :army="selectedArmy" />
            <ArmyComposition v-else-if="armyShown === 'composition'" :army="selectedArmy" />
            <template v-else>
              <div v-if="armyShown === 'command'" data-testid="army-mission">
                <div v-for="g in visibleGroups" :key="g.label" class="mgroup">
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
                        }}<span v-if="missionOf(selectedArmy) === k" class="tag"
                          >en cours</span
                        ></span
                      >
                      <span class="d">{{ MISSION_SHORT[k] }}</span>
                    </button>
                  </div>
                </div>
              </div>
              <div v-if="armyShown === 'command'" class="detail" data-testid="mission-detail">
                <div class="row">
                  <strong>{{ MISSION_NAMES[missionView] }}</strong>
                  <span
                    v-if="game.missionPreview && game.missionPreview.armyId === selectedArmy.id"
                    class="tag preview"
                    data-testid="mission-preview"
                    >aperçu sur la carte</span
                  >
                  <span v-else-if="action?.kind === 'aim'" class="tag preview"
                    >visée sur la carte</span
                  >
                </div>
                <p class="meta" :data-testid="`mission-help-${missionView}`">
                  {{ MISSION_TEXT[missionView] }}
                </p>
                <template v-if="isLineMission(missionView) && !selectedArmy.encirclement">
                  <p
                    v-if="!holdsLine(selectedArmy)"
                    class="meta warn"
                    data-testid="mission-no-front"
                  >
                    L'armée n'a pas de front : assignez-lui une portion, tout le front ou une
                    frontière.
                  </p>
                  <div class="group">
                    <span class="label">Front tenu</span>
                    <button @click="game.startFront(selectedArmy.id)">Assigner une portion</button>
                    <button @click="game.setWholeFront(selectedArmy.id)">Tout le front</button>
                    <button @click="game.clearFront(selectedArmy.id)">Aucun</button>
                  </div>
                  <div class="group">
                    <span class="label">Frontière tenue, en paix comme en guerre</span>
                    <button
                      title="Glissez le long de votre frontière (ou de votre côte, contre les débarquements) pour la peindre, ou cliquez sur un pays voisin : l'armée s'y déploie en défense, sans franchir ; si la guerre éclate avec ce voisin, la frontière devient son front"
                      data-testid="border-paint"
                      @click="game.startBorder(selectedArmy.id)"
                    >
                      Tenir une frontière
                    </button>
                    <button
                      :disabled="!selectedArmy.border?.length"
                      title="Toute la frontière avec chaque voisin déjà touché, retirée aux autres armées"
                      data-testid="border-take-all"
                      @click="game.takeWholeBorder(selectedArmy.id)"
                    >
                      Prendre toute la frontière
                    </button>
                  </div>
                  <p v-if="selectedArmy.border?.length" class="meta" data-testid="border-summary">
                    {{ borderText(selectedArmy) }}
                  </p>
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
                <div
                  v-else-if="missionView === 'defendPoints'"
                  class="group"
                  data-testid="defend-points-group"
                >
                  <span class="label">Points à défendre</span>
                  <label v-for="k in POINT_KINDS" :key="k.key" class="check">
                    <input
                      v-model="pointKinds[k.key]"
                      type="checkbox"
                      :data-testid="`defend-kind-${k.key}`"
                    />
                    {{ k.label }}
                  </label>
                  <span class="label">Où</span>
                  <button
                    class="primary"
                    title="Tous les points cochés du pays, les plus importants d'abord"
                    data-testid="defend-country"
                    @click="game.defendPointsArmy(selectedArmy.id, null, { ...pointKinds })"
                  >
                    Tout le pays
                  </button>
                  <button
                    title="Cliquez ensuite sur le centre de la zone (cercle du rayon choisi)"
                    data-testid="defend-zone"
                    @click="game.startDefendZone(selectedArmy.id, { ...pointKinds }, zoneKm)"
                  >
                    Une zone
                  </button>
                  <select
                    v-model.number="zoneKm"
                    data-testid="defend-zone-km"
                    title="Rayon de la zone"
                  >
                    <option v-for="km in [100, 200, 400]" :key="km" :value="km">{{ km }} km</option>
                  </select>
                </div>
                <div v-else-if="missionView === 'breach'" class="group" data-testid="breach-group">
                  <p v-if="!holdsLine(selectedArmy)" class="meta warn">
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
                <div
                  v-else-if="missionView === 'retreat'"
                  class="group"
                  data-testid="retreat-group"
                >
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
                  <span class="label"
                    >Encerclement de {{ selectedArmy.encirclement.targetName }}</span
                  >
                  <button
                    data-testid="end-encirclement"
                    @click="game.endEncirclement(selectedArmy.id)"
                  >
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
              <div v-if="armyShown === 'posture'" class="posture-box" data-testid="army-posture">
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
              <button
                v-if="armyShown === 'command'"
                class="danger"
                @click="game.disbandArmy(selectedArmy.id)"
              >
                Dissoudre l'armée
              </button>
            </template>
          </section>
        </Teleport>
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
.at-sea {
  border: 1px solid #1e3a5f;
  background: rgba(30, 58, 95, 0.25);
  border-radius: 8px;
  padding: 6px 10px;
  margin-bottom: 8px;
  font-size: 12px;
}
.air {
  border: 1px solid #334155;
  border-radius: 8px;
  padding: 6px 10px;
  margin-bottom: 8px;
  font-size: 12px;
}
.air summary {
  cursor: pointer;
  font-weight: 600;
}
.air ul {
  margin: 6px 0;
}
.air li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
}
.air-remove {
  margin-left: auto;
  padding: 2px 8px;
}
.air-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
}
.air-missions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}
.at-sea li {
  padding: 2px 0;
}
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
.units li.pick {
  cursor: pointer;
}
.units li.pick:hover {
  outline: 1px solid #2563eb;
}
.group-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  width: 100%;
  margin: 6px 0 4px;
  text-align: left;
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
.gauge .equipment {
  background: #f59e0b;
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
.formation-label {
  margin: 4px 0 0;
  color: #9aa3af;
  font-size: 12px;
}
.echelon-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 6px 0 2px;
}
.echelon-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.echelon-text .meta {
  color: #9aa3af;
  font-size: 12px;
}
.battalions {
  margin: 4px 0 0;
  padding-left: 16px;
  font-size: 12px;
  color: #cbd5e1;
}
/* Fiche compacte de la sélection (grand écran, charte : docs/charte.md). */
.sheet {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.forces .sheet .up.up {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: #1d1a15;
  border-color: #4a4030;
  text-align: left;
  color: var(--nkg-brass-light);
}
.up-text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
  color: var(--nkg-text);
}
.up-k {
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #a99a7a;
}
.sheet-head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 4px 0;
}
.sheet-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.sheet-title h3 {
  margin: 0;
  font-family: var(--nkg-serif);
  font-size: 22px;
  font-weight: 600;
  line-height: 1.15;
}
.sheet-title .sub {
  font-size: 13px;
  color: var(--nkg-text-muted);
}
.faint {
  color: var(--nkg-text-faint);
}
.small {
  font-size: 12px;
}
.sheet .faint.sub {
  font-size: 12px;
  color: var(--nkg-text-faint);
}
.sheet-bars {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.bar-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 3px;
  font-size: 12px;
  color: var(--nkg-text-muted);
}
.bar-head .num {
  color: var(--nkg-text);
}
.bar {
  display: block;
  height: 6px;
  border-radius: 3px;
  background: #2b333e;
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
}
.bar.mini {
  width: 44px;
  flex: none;
  height: 5px;
}
.sheet .chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.sheet .chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 9px;
  border: 1px solid #3a4452;
  border-radius: 999px;
  background: #1a212a;
  font-size: 12px;
  color: var(--nkg-text-soft);
}
.sheet .chip.warn {
  color: var(--nkg-warn-text);
}
.sheet .chip .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--nkg-good);
}
.sheet .divider {
  height: 1px;
  background: var(--nkg-divider);
}
.tiles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.forces .sheet .tiles .tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-height: 58px;
  padding: 8px 10px;
  border-radius: 6px;
  text-align: left;
}
.forces .sheet .tiles .tile.span {
  grid-column: 1 / -1;
}
.forces .sheet .tiles .tile.on,
.forces .sheet .tiles .tile.on:hover:not(:disabled) {
  background: var(--nkg-tile-on-bg);
  border-color: var(--nkg-brass-light);
}
.tk {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--nkg-label);
}
.tk .nkg-icon {
  color: var(--nkg-brass);
}
.tile.on .tk {
  color: var(--nkg-brass-light);
}
.tv {
  font-size: 13px;
  color: var(--nkg-text);
}
.sheet .label {
  margin: 4px 0 -4px;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--nkg-label);
}
.forces .sheet .sub-row.sub-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 4px;
  text-align: left;
  font-size: 13px;
}
.forces .sheet .sub-row.nested {
  margin-left: 12px;
}
.forces .sheet .sub-row.group-row {
  background: none;
  border-color: transparent;
  color: var(--nkg-brass-light);
}
.sname {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.subs {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.subs li {
  padding: 6px 10px;
  border: 1px solid var(--nkg-line);
  border-radius: 4px;
  background: var(--nkg-surface);
  font-size: 13px;
}

/* Volet accolé à gauche de la fiche (option B). */
.flyout {
  position: fixed;
  top: 70px;
  right: 366px;
  z-index: 12;
  width: 300px;
  max-height: calc(100vh - 140px);
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 14px 14px;
  box-sizing: border-box;
  background: var(--nkg-panel-bg);
  border: 1px solid var(--nkg-brass-dark);
  border-right-color: var(--nkg-brass-light);
  border-radius: 4px;
  box-shadow: var(--nkg-panel-shadow);
  color: var(--nkg-text);
  font: 13px/1.4 var(--nkg-sans);
}
.flyout header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 -14px 4px;
  padding: 10px 10px 8px 14px;
  border-bottom: 1px solid var(--nkg-brass-line);
}
.flyout h3 {
  margin: 0;
  font-family: var(--nkg-serif);
  font-size: 20px;
  font-weight: 600;
}
.flyout button {
  background: var(--nkg-tile-bg);
  border: 1px solid var(--nkg-line-strong);
  border-radius: 4px;
}
.flyout button:hover:not(:disabled) {
  background: var(--nkg-tile-bg);
  border-color: var(--nkg-brass);
}
.flyout .x {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
}
.flyout .label {
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--nkg-label);
}
.cmds {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.flyout .cmd {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 62px;
  padding: 6px 2px;
  border-radius: 6px;
  font-size: 12px;
}
.flyout .cmd .nkg-icon {
  color: var(--nkg-brass);
}
.flyout .wide {
  height: 34px;
  margin-top: 4px;
}
.flyout .cancel {
  color: #f0b0a5;
}
.opts {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.flyout .opt {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 5px;
  text-align: left;
}
.flyout .opt.on,
.flyout .opt.on:hover:not(:disabled) {
  background: var(--nkg-tile-on-bg);
  border-color: var(--nkg-brass-light);
}
.ot {
  font-weight: 600;
}
.od {
  font-size: 12px;
  color: var(--nkg-text-muted);
}
.detail-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 340px;
  overflow: auto;
}
.detail-list li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 10px;
  border: 1px solid var(--nkg-line);
  border-radius: 4px;
  background: var(--nkg-surface);
}
.detail-list .warn {
  color: var(--nkg-warn-text);
}
.flyout .create input,
.flyout .create select {
  background: #12171d;
  border: 1px solid var(--nkg-line-strong);
  border-radius: 4px;
  color: inherit;
}
.army-head.sheet .current {
  margin: 0;
  font-size: 12.5px;
  color: var(--nkg-text-soft);
}
.forces .sheet .tiles .tile .tag {
  margin-left: 4px;
}
.army-flyout {
  width: 340px;
}
/* Téléphone : le volet s'insère dans la fiche, sous ses tuiles. */
.flyout.inline {
  position: static;
  width: auto;
  max-height: none;
  margin-top: 4px;
  box-shadow: none;
  border-right-color: var(--nkg-brass-dark);
}
.army-flyout .mcards {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.army-flyout .mcard.on,
.army-flyout .seg.on {
  background: var(--nkg-tile-on-bg);
  border-color: var(--nkg-brass-light);
  color: var(--nkg-brass-pale);
}
.army-flyout .danger {
  margin-top: 6px;
  border-color: var(--nkg-danger-line);
  color: #f0b0a5;
}
.army-head.sheet {
  padding: 0;
  margin: 0;
  background: none;
}
.army-flyout .mcard.cur {
  box-shadow: inset 3px 0 0 var(--nkg-brass);
}
.army-flyout .tag {
  background: var(--nkg-brass-bg-bottom);
  color: var(--nkg-brass-light);
}
</style>
