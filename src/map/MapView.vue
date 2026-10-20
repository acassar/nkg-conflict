<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapboxOverlay } from '@deck.gl/mapbox'
import type { PickingInfo } from '@deck.gl/core'
import { Protocol } from 'pmtiles'
import { storeToRefs } from 'pinia'
import type { CityState, GridSnapshot, LonLat } from '@/sim/core/types'
import type { SupplyView } from '@/sim/systems/supplyView'
import { formationMembers, isStack, type BrigadeSpot, type MapUnit } from './clusters'
import { useGameStore } from '@/stores/game'
import { baseStyle, neutralizeCountryFills, OFFLINE_STYLE } from './style'
import { buildLayers, type BorderShapes, type MissionPreviewShapes } from './layers'
import { borderCellsNear, brushCells, cellSquare } from './borderPaint'
import { breachAxis, encircleRing } from './missionPreview'
import { terrainTiles, TerritoryTiles, type TerritoryTile } from './territoryImage'
import { BorderLines, type BorderBlocks } from './borders'
import { SupplyTiles } from './supplyImage'
import { roadLines, roadOpacity, roadTiles, type RoadLines } from './roadsImage'
import { visibleBlocks } from './lineBlocks'
import { describePoint } from './cellInfo'
import { isMobile, isTouch, layout } from '@/composables/layout'
import { useProductionStats } from '@/composables/production'
import { useBattles } from '@/composables/battles'
import { glErrorText } from './webgl'
import { mapCursor } from './cursors'
import { transportRoutes, type TransportRoute } from './transports'

const container = ref<HTMLDivElement | null>(null)
const game = useGameStore()
const {
  snapshot,
  grid,
  gridTick,
  selection,
  selectedArmy,
  mode,
  selectedCity,
  stances,
  focus,
  mapView,
  supply,
  showRoads,
} = storeToRefs(game)

// ---------- Sélection par zone ----------

/** Rectangle en cours de tracé, en pixels relatifs à la carte. */
const box = ref<{ x0: number; y0: number; x1: number; y1: number } | null>(null)

function localPoint(e: PointerEvent): { x: number; y: number } {
  const r = container.value?.getBoundingClientRect()
  return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }
}

function onBoxDown(e: PointerEvent): void {
  const p = localPoint(e)
  box.value = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onBoxMove(e: PointerEvent): void {
  if (!box.value) return
  const p = localPoint(e)
  box.value = { ...box.value, x1: p.x, y1: p.y }
}

/** Sélectionne les unités du joueur dont le pion est dans le rectangle. */
function onBoxUp(): void {
  const b = box.value
  box.value = null
  if (!b || !map) return
  const [xa, xb] = [Math.min(b.x0, b.x1), Math.max(b.x0, b.x1)]
  const [ya, yb] = [Math.min(b.y0, b.y1), Math.max(b.y0, b.y1)]
  if (xb - xa < 8 && yb - ya < 8) return
  const s = snapshot.value
  if (!s) return
  const ids = s.units
    .filter((u) => u.owner === s.playerCountry)
    .filter((u) => {
      const p = map?.project([u.lon, u.lat])
      return !!p && p.x >= xa && p.x <= xb && p.y >= ya && p.y <= yb
    })
    .map((u) => u.id)
  game.selectUnits(ids, false)
  game.lasso = false
}

const boxStyle = (b: {
  x0: number
  y0: number
  x1: number
  y1: number
}): Record<string, string> => ({
  left: `${Math.min(b.x0, b.x1)}px`,
  top: `${Math.min(b.y0, b.y1)}px`,
  width: `${Math.abs(b.x1 - b.x0)}px`,
  height: `${Math.abs(b.y1 - b.y0)}px`,
})

// ---------- Trait libre (mission « Avancer ») ----------

/** Mode « tracer un trait » : un calque capte les gestes (pas de déplacement de la carte pendant le tracé). */
const drawing = computed(() => mode.value.kind === 'advance' && mode.value.goal === 'line')
/** Geste en cours : point de départ, et points du trait à main levée une fois le doigt parti. */
let stroke: { x: number; y: number; points: LonLat[]; last: { x: number; y: number } } | null = null
/** Trait à main levée en cours, pour l'affichage. */
const freehand = ref<LonLat[]>([])

function unproject(p: { x: number; y: number }): LonLat | null {
  if (!map) return null
  const ll = map.unproject([p.x, p.y])
  return [ll.lng, ll.lat]
}

function onDrawDown(e: PointerEvent): void {
  const p = localPoint(e)
  stroke = { x: p.x, y: p.y, points: [], last: p }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onDrawMove(e: PointerEvent): void {
  if (!stroke) return
  const p = localPoint(e)
  if (stroke.points.length === 0 && Math.hypot(p.x - stroke.x, p.y - stroke.y) < 10) return
  if (stroke.points.length === 0) {
    const first = unproject({ x: stroke.x, y: stroke.y })
    if (first) stroke.points.push(first)
  }
  // Un point tous les 12 pixels environ.
  if (Math.hypot(p.x - stroke.last.x, p.y - stroke.last.y) < 12) return
  stroke.last = p
  const ll = unproject(p)
  if (ll) stroke.points.push(ll)
  freehand.value = [...stroke.points]
}

/** Toucher bref : un point du trait ; glisser : le trait entier, qui lance la mission au relâcher. */
function onDrawUp(e: PointerEvent): void {
  const s = stroke
  stroke = null
  freehand.value = []
  if (!s) return
  if (s.points.length >= 2) {
    const end = unproject(localPoint(e))
    game.drawAdvanceLine(end ? [...s.points, end] : s.points)
    return
  }
  const ll = unproject({ x: s.x, y: s.y })
  if (ll) game.mapClick(ll)
}

// ---------- Frontière tenue (peinture au glisser) ----------

/** Mode « peindre une frontière » : un calque capte les gestes, comme pour le trait libre. */
const painting = computed(() => mode.value.kind === 'border')
/** Cellules peintes pendant le geste en cours (colorées au fur et à mesure). */
const painted = shallowRef<Set<number>>(new Set())
let paintStroke: { x: number; y: number; moved: boolean } | null = null
/** Rayon du pinceau à l'écran, en pixels. */
const BRUSH_PX = 14

function playerSide(): number {
  const g = grid.value
  const s = snapshot.value
  return g && s ? g.sides.indexOf(s.playerCountry) : -1
}

/** Ajoute au geste les cellules de frontière du joueur sous le pinceau. */
function paintAt(p: { x: number; y: number }): void {
  const g = grid.value
  const at = unproject(p)
  const edge = unproject({ x: p.x + BRUSH_PX, y: p.y })
  if (!g || !at || !edge) return
  const cells = borderCellsNear(g, playerSide(), at, brushCells(g, Math.abs(edge[0] - at[0])))
  if (cells.length === 0) return
  const next = new Set(painted.value)
  for (const c of cells) next.add(c)
  painted.value = next
}

function onPaintDown(e: PointerEvent): void {
  const p = localPoint(e)
  paintStroke = { x: p.x, y: p.y, moved: false }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onPaintMove(e: PointerEvent): void {
  if (!paintStroke) return
  const p = localPoint(e)
  if (!paintStroke.moved && Math.hypot(p.x - paintStroke.x, p.y - paintStroke.y) < 10) return
  if (!paintStroke.moved) paintAt({ x: paintStroke.x, y: paintStroke.y })
  paintStroke.moved = true
  paintAt(p)
}

/**
 * Relâcher après un glisser : la portion peinte part au Worker. Toucher bref : sur un pays voisin, toute
 * la frontière avec lui ; sur sa propre frontière, la portion sous le doigt.
 */
function onPaintUp(): void {
  const s = paintStroke
  paintStroke = null
  const cells = [...painted.value]
  painted.value = new Set()
  if (!s) return
  if (s.moved) {
    if (cells.length > 0) game.paintBorder(cells)
    else
      game.showNotice(
        'Glissez le long de la frontière ou de la côte de votre pays (Échap pour annuler)',
      )
    return
  }
  const ll = unproject({ x: s.x, y: s.y })
  if (!ll) return
  const g = grid.value
  const own = g && snapshot.value && game.ownerAt(ll[0], ll[1]) === snapshot.value.playerCountry
  if (!own) {
    game.mapClick(ll)
    return
  }
  paintAt({ x: s.x, y: s.y })
  const tapped = [...painted.value]
  painted.value = new Set()
  if (tapped.length > 0) game.paintBorder(tapped)
  else game.showNotice('Touchez la frontière ou la côte, ou un pays voisin (Échap pour annuler)')
}

/**
 * Division concernée par son ordre de défense : celle dont on peint le tronçon, à défaut la division
 * entière sélectionnée.
 */
const defenseDivision = computed(() => {
  const s = snapshot.value
  const m = mode.value
  const id =
    m.kind === 'border' || m.kind === 'defendZone'
      ? m.divisionId
      : game.selectionInfo?.echelon === 'division'
        ? game.selectionInfo.division?.id
        : undefined
  return id === undefined ? null : (s?.formations.find((f) => f.id === id) ?? null)
})

/**
 * Carrés des cellules de frontière : armée sélectionnée, autres armées (pendant la peinture), geste.
 * Division sous ordre de tronçon : son tronçon, et le reste de la frontière de son armée pendant la
 * peinture.
 */
let borderCache: { key: string; shapes: BorderShapes } | null = null
function borderShapes(): BorderShapes | null {
  const g = grid.value
  const s = snapshot.value
  if (!g || !s) return null
  const division = defenseDivision.value
  const m = mode.value
  const forDivision = m.kind === 'border' && m.divisionId !== undefined
  const army = forDivision
    ? (s.armies.find((a) => a.id === m.armyId) ?? null)
    : division?.defense?.kind === 'border'
      ? null
      : selectedArmy.value
  const own = division?.defense?.kind === 'border' ? division.defense.cells : []
  const mine = new Set(own)
  const others =
    painting.value && !forDivision
      ? s.armies.filter((a) => a.id !== army?.id && a.border?.length)
      : []
  const key = [
    army?.id,
    army?.border?.length,
    army?.border?.[0],
    army?.border?.[army.border.length - 1],
    division?.id,
    own.length,
    own[0],
    ...others.map((a) => `${a.id}:${a.border?.length}:${a.border?.[0]}`),
    painted.value.size,
  ].join('|')
  if (borderCache?.key === key) return borderCache.shapes
  const square = (c: number): LonLat[] => cellSquare(g, c)
  const shapes: BorderShapes = {
    held: (own.length ? own : forDivision ? [] : (army?.border ?? [])).map(square),
    others: forDivision
      ? (army?.border ?? []).filter((c) => !mine.has(c)).map(square)
      : others.flatMap((a) => (a.border ?? []).map(square)),
    painting: [...painted.value].map(square),
  }
  borderCache = { key, shapes }
  return shapes
}

const productionStats = useProductionStats()
const battles = useBattles()
let map: maplibregl.Map | null = null
const zoom = ref(4)
/**
 * Emprise de la vue à la fin du dernier déplacement, élargie de moitié de chaque côté (marge pour les
 * petits déplacements) : seuls les blocs du réseau routier qui la touchent sont dessinés.
 */
const viewBounds = shallowRef<[number, number, number, number] | null>(null)
let overlay: MapboxOverlay | null = null
/** Carte en cours de glissement (curseur « main fermée »). */
let dragging = false
const protocol = new Protocol()

// Territoire en tuiles : recréé quand une grille complète arrive, puis mis à jour cellule par cellule.
let tiles: TerritoryTiles | null = null
let tilesGrid: GridSnapshot | null = null
let territory: TerritoryTile[] = []
let terrain: TerritoryTile[] = []
let colorKey = ''
// Frontières nationales en traits nets, recalculées par blocs avec le territoire.
let borders: BorderLines | null = null

function syncTerritory(): void {
  const s = snapshot.value
  const g = grid.value
  if (!s || !g) {
    tiles = null
    tilesGrid = null
    borders = null
    territory = []
    terrain = []
    return
  }
  const st = stances.value
  const coloring = mapView.value === 'countries' ? 'country' : 'stance'
  const key = `${st.key}|${coloring}`
  if (g !== tilesGrid) {
    tiles = new TerritoryTiles(g, s.countries, st.map, game.hostilePairs, coloring)
    borders = new BorderLines(g, game.hostilePairs)
    terrain = terrainTiles(g)
    tilesGrid = g
    colorKey = key
    game.takePendingCells()
  } else if (tiles) {
    if (key !== colorKey) {
      colorKey = key
      const cells = game.takePendingCells()
      tiles.setColors(s.countries, st.map, game.hostilePairs, coloring)
      borders?.setHostile(game.hostilePairs)
      borders?.applyCells(cells)
    } else {
      const cells = game.takePendingCells()
      if (cells.length) {
        tiles.applyCells(cells)
        borders?.applyCells(cells)
      }
    }
  }
  territory = tiles?.layers() ?? []
}

/** Frontières des blocs proches de la vue. */
function borderLines(): BorderBlocks | null {
  const all = borders?.lines()
  if (!all) return null
  const view = viewBounds.value
  return { peace: visibleBlocks(all.peace, view), war: visibleBlocks(all.war, view) }
}

// Calque du mode Logistique : recréé avec la grille, redessiné seulement quand un nouvel état arrive.
let supplyTiles: SupplyTiles | null = null
let supplyGrid: GridSnapshot | null = null
let supplyState: Uint8Array | null = null
let supplyLayer: TerritoryTile[] = []
/** Routes et voies ferrées : dessinées une fois par grille, à la première ouverture du mode Logistique. */
let roadLayer: TerritoryTile[] | null = null

function logistics(): {
  tiles: TerritoryTile[]
  roads: TerritoryTile[]
  view: SupplyView | null
} | null {
  if (mapView.value !== 'logistics') return null
  const g = grid.value
  if (!g) return null
  if (g !== supplyGrid) {
    supplyTiles = new SupplyTiles(g)
    supplyGrid = g
    supplyState = null
    supplyLayer = []
    roadLayer = null
  }
  if (showRoads.value) roadLayer ??= roadTiles(g)
  const state = supply.value?.state ?? null
  if (state !== supplyState) {
    supplyState = state
    // En paix, aucun état de cellule : le calque est effacé.
    supplyLayer = supplyTiles?.update(state ?? new Uint8Array(g.width * g.height)) ?? []
  }
  return {
    tiles: supplyLayer,
    roads: showRoads.value ? (roadLayer ?? []) : [],
    view: supply.value?.view ?? null,
  }
}

// Réseau de transport de la carte par défaut (vue politique), en traits fins sous le territoire :
// segments calculés une fois par grille.
let baseRoadsGrid: GridSnapshot | null = null
let baseRoads: { main: RoadLines[]; minor: RoadLines[] } | null = null

function politicalRoads(): {
  main: RoadLines[]
  minor: RoadLines[]
  mainOpacity: number
  minorOpacity: number
} | null {
  const g = grid.value
  if (!g || mapView.value === 'logistics' || !showRoads.value) return null
  if (g !== baseRoadsGrid || !baseRoads) {
    baseRoads = { main: roadLines(g, 'main'), minor: roadLines(g, 'minor') }
    baseRoadsGrid = g
  }
  const cellDeg = (g.bbox[2] - g.bbox[0]) / g.width
  const view = viewBounds.value
  return {
    main: visibleBlocks(baseRoads.main, view),
    minor: visibleBlocks(baseRoads.minor, view),
    mainOpacity: roadOpacity(zoom.value, cellDeg, 'main'),
    minorOpacity: roadOpacity(zoom.value, cellDeg, 'minor'),
  }
}

/** Visée d'une mission d'armée qui suit le pointeur : percée, ou encerclement. */
function aimsWithPointer(): boolean {
  const m = mode.value
  return m.kind === 'breach' || (m.kind === 'target' && m.action === 'encircle')
}

/** Aperçu de mission à dessiner : visée en cours, sinon mission choisie dans la fiche de l'armée. */
function previewShapes(): MissionPreviewShapes | null {
  const m = mode.value
  const s = snapshot.value
  const aim = game.aimPoint
  if (s && aim && m.kind === 'breach') {
    const army = s.armies.find((a) => a.id === m.armyId)
    const own = s.units.filter((u) => army?.unitIds.includes(u.id))
    const center: LonLat | null = own.length
      ? [
          own.reduce((t, u) => t + u.lon, 0) / own.length,
          own.reduce((t, u) => t + u.lat, 0) / own.length,
        ]
      : null
    const axis = breachAxis(army?.frontLine, center, aim)
    return axis ? { posts: [], lines: [], points: [], axis, ring: null } : null
  }
  if (s && aim && m.kind === 'target' && m.action === 'encircle') {
    const ring = encircleRing(s.units, (o) => stances.value.map.get(o) === 'enemy', aim)
    return ring ? { posts: [], lines: [], points: [], axis: null, ring } : null
  }
  const p = game.missionPreview
  if (m.kind === 'select' && p && selectedArmy.value?.id === p.armyId) {
    return { posts: p.posts, lines: p.lines, points: p.points, axis: null, ring: null }
  }
  return null
}

/** Trajets des transports en cours, quand le joueur les affiche (bouton « En route »). */
function transportsShown(): TransportRoute[] | null {
  const s = snapshot.value
  if (!game.showTransports || !s) return null
  return transportRoutes(s.transport.inTransit, s.tick)
}

function refresh(): void {
  syncTerritory()
  const m = mode.value
  overlay?.setProps({
    layers: buildLayers({
      snapshot: snapshot.value,
      territory,
      terrain,
      roads: politicalRoads(),
      borders: borderLines(),
      stances: stances.value.map,
      selection: new Set(selection.value),
      selectedArmy: selectedArmy.value,
      divisionPoints:
        defenseDivision.value?.defense?.kind === 'defendPoints'
          ? defenseDivision.value.defense
          : null,
      pendingPoint: m.kind === 'front' || m.kind === 'offensive' ? m.first : null,
      pendingLine:
        freehand.value.length > 1
          ? freehand.value
          : m.kind === 'advance' && m.goal === 'line'
            ? m.points
            : [],
      pendingRetreat: m.kind === 'advance' && !!m.retreat,
      armyBorders: borderShapes(),
      preview: previewShapes(),
      zoom: zoom.value,
      selectedCity: selectedCity.value?.name ?? null,
      battles: battles.value,
      transports: transportsShown(),
      logistics: logistics(),
      production:
        game.panelTab === 'production' ? (productionStats.value?.busyByCity ?? null) : null,
      buildAdvice: game.panelTab === 'production' ? (game.buildChoice?.advice ?? null) : null,
      factories:
        game.panelTab === 'production' ? (snapshot.value?.economy?.factories ?? null) : null,
      factorySpot: game.panelTab === 'production' ? game.factorySpot : null,
    }),
  })
}

function onClick(info: PickingInfo, event: { srcEvent?: MouseEvent }): void {
  // Relâcher le doigt après un appui prolongé (bandeau de description) ne vaut pas un toucher.
  if (performance.now() < suppressClickUntil) return
  const point = info.coordinate ? ([info.coordinate[0], info.coordinate[1]] as LonLat) : null
  const me = game.snapshot?.playerCountry
  const additive = event.srcEvent?.shiftKey ?? false
  if (info.layer?.id === 'battles' && info.object) {
    game.openBattle((info.object as { ids: number[] }).ids)
    return
  }
  // Brigade affichée autour d'une formation choisie : elle seule.
  const item =
    info.layer?.id === 'units-brigades'
      ? (info.object as BrigadeSpot | undefined)?.unit
      : info.layer?.id.startsWith('units')
        ? (info.object as MapUnit | undefined)
        : undefined
  if (item) {
    // Pion de division, de corps ou d'armée : toute la formation, brigades écartées comprises.
    const snap = game.snapshot
    const units =
      isStack(item) && item.formation && snap
        ? item.formation.kind === 'army'
          ? snap.units.filter((u) => u.armyId === item.formation?.id)
          : formationMembers(snap.units, snap.formations, item.formation.id)
        : isStack(item)
          ? item.units
          : [item]
    // Un ordre en cours de saisie peut viser une unité (attaque, encerclement).
    if (point && game.mapClick(point, units)) return
    const mine = units.filter((u) => u.owner === me)
    if (mine.length > 0) {
      game.selectUnits(
        mine.map((u) => u.id),
        additive,
      )
      // La vue Forces montre l'entité choisie (sur téléphone, l'inspecteur remplace le tiroir).
      if (!isMobile.value) game.openDomain('forces')
    } else if (units[0]) {
      // Pion d'un autre pays : ouvre la fiche de ce pays.
      if (!additive) game.clearSelection()
      game.selectCountry(units[0].owner)
    }
    return
  }
  if (point && game.mapClick(point)) return
  if ((info.layer?.id === 'cities' || info.layer?.id === 'capital-stars') && info.object) {
    const city = info.object as CityState
    // Ville du joueur : production ; ville étrangère : fiche du pays.
    if (city.owner === me) game.selectCity(city.name)
    else if (city.owner) game.selectCountry(city.owner)
    return
  }
  // Choix d'une usine en cours : un clic sur votre territoire choisit son emplacement.
  if (point && game.pickFactorySpot(point)) return
  if (!additive) {
    // Clic sur un territoire : sans unités sélectionnées, ouvre la fiche du pays.
    const hadSelection = game.selection.length > 0
    game.clearSelection()
    // La sélection se ferme avec ce qui la montrait (vue Forces).
    if (hadSelection) game.closeDomain('forces')
    if (!hadSelection && point) {
      const code = game.ownerAt(point[0], point[1])
      if (code) game.selectCountry(code)
    }
  }
}

// ---------- Bandeau de description (survol, appui prolongé) ----------

/** Lignes du bandeau : ce qui se trouve sous la souris ou sous le doigt ; vide = masqué. */
const cellInfo = ref<string[]>([])
/** Dernier pointeur : doigt ou stylet (true) ou souris. */
let lastPointerTouch = false
let hoverFrame = 0
let hoverPoint: { x: number; y: number } | null = null
/** Appui prolongé en cours au doigt : minuterie, point de départ, bandeau affiché. */
let press: { timer: ReturnType<typeof setTimeout>; x: number; y: number; shown: boolean } | null =
  null
const activeTouches = new Set<number>()
/** Jusqu'à cet instant, le toucher qui suit la fin d'un appui prolongé est ignoré. */
let suppressClickUntil = 0
/** Durée d'un appui prolongé (le toucher bref de deck.gl s'arrête bien avant). */
const LONG_PRESS_MS = 500
/** Déplacement du doigt au-delà duquel l'appui devient un glissement de la carte. */
const PRESS_SLOP_PX = 10
/** Rayon de recherche d'une ville sous le pointeur, en pixels. */
const CITY_PICK_PX = 14

function describeAt(p: { x: number; y: number }): string[] {
  const g = grid.value
  const s = snapshot.value
  if (!map || !g || !s) return []
  const ll = map.unproject([p.x, p.y])
  // Kilomètres par pixel au point visé (Web Mercator, monde de 512 × 2^zoom pixels).
  const kmPerPx = (40075 * Math.cos((ll.lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom())
  return describePoint(g, s.cities, ll.lng, ll.lat, CITY_PICK_PX * kmPerPx)
}

function hoverLoop(): void {
  hoverFrame = 0
  if (hoverPoint) cellInfo.value = describeAt(hoverPoint)
  if (hoverPoint && map && aimsWithPointer()) {
    const ll = map.unproject([hoverPoint.x, hoverPoint.y])
    game.aimPoint = [ll.lng, ll.lat]
  }
}

function clearPress(): void {
  if (press) clearTimeout(press.timer)
  press = null
}

function onMapPointerDown(e: PointerEvent): void {
  lastPointerTouch = e.pointerType !== 'mouse'
  if (!lastPointerTouch) return
  activeTouches.add(e.pointerId)
  clearPress()
  cellInfo.value = []
  // Deux doigts : pincement, pas d'appui prolongé.
  if (activeTouches.size > 1) return
  const p = localPoint(e)
  press = {
    x: p.x,
    y: p.y,
    shown: false,
    timer: setTimeout(() => {
      if (!press) return
      press.shown = true
      cellInfo.value = describeAt(p)
    }, LONG_PRESS_MS),
  }
}

function onMapPointerMove(e: PointerEvent): void {
  if (e.pointerType === 'mouse') {
    lastPointerTouch = false
    hoverPoint = localPoint(e)
    if (!hoverFrame) hoverFrame = requestAnimationFrame(hoverLoop)
    return
  }
  if (!press || press.shown) return
  const p = localPoint(e)
  if (Math.hypot(p.x - press.x, p.y - press.y) > PRESS_SLOP_PX) clearPress()
}

function onMapPointerEnd(e: PointerEvent): void {
  if (e.pointerType === 'mouse') {
    if (e.type === 'pointerleave' || e.type === 'pointercancel') {
      hoverPoint = null
      cellInfo.value = []
    }
    return
  }
  activeTouches.delete(e.pointerId)
  if (press?.shown) suppressClickUntil = performance.now() + 400
  clearPress()
  cellInfo.value = []
}

const MAP_POINTER_EVENTS = {
  pointerdown: onMapPointerDown,
  pointermove: onMapPointerMove,
  pointerup: onMapPointerEnd,
  pointercancel: onMapPointerEnd,
  pointerleave: onMapPointerEnd,
} as const

/** Position du bandeau : en bas au centre sur ordinateur, au-dessus des boutons sur téléphone. */
const cellInfoStyle = computed(() => {
  if (layout.value === 'portrait') return { bottom: `${game.drawerHeight + 62}px` }
  if (layout.value === 'landscape') return { bottom: '62px' }
  return {}
})

// ---------- Contexte WebGL : création, perte, récupération ----------

/**
 * État du rendu : « ok », « lost » (contexte perdu, récupération en cours) ou « error »
 * (création impossible, ou perte sans récupération). Le message reste affiché par-dessus tout,
 * écran de départ compris.
 */
const glState = ref<'ok' | 'lost' | 'error'>('ok')
const glDetail = ref('')
/** Délai laissé au navigateur pour rendre un contexte perdu avant d'afficher l'erreur. */
const RESTORE_TIMEOUT_MS = 5000
let restoreTimer: ReturnType<typeof setTimeout> | null = null

function clearRestoreTimer(): void {
  if (restoreTimer) clearTimeout(restoreTimer)
  restoreTimer = null
}

/**
 * Crée la carte MapLibre et la couche deck.gl (chacune son canvas et son contexte WebGL ; le mode
 * entrelacé de deck.gl, qui n'en ouvre qu'un, perd la sélection des pions au clic).
 * Renvoie faux si WebGL est indisponible.
 */
function createMap(camera?: { center: LonLat; zoom: number }): boolean {
  if (!container.value) return false
  try {
    map = new maplibregl.Map({
      container: container.value,
      style: baseStyle(),
      center: camera?.center ?? [15, 45],
      zoom: camera?.zoom ?? 4,
      minZoom: 1.5,
      maxZoom: 11,
      attributionControl: { compact: true },
    })
  } catch (e) {
    map = null
    glDetail.value = glErrorText(e)
    glState.value = 'error'
    return false
  }
  const m = map
  // Sur écran tactile, le zoom se fait au pincement : pas de boutons.
  if (!isTouch.value) {
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
  }
  m.touchZoomRotate.disableRotation()
  m.on('style.load', () => neutralizeCountryFills(m))
  // Fond de carte injoignable (hors ligne, réseau filtré) : sans style chargé, la carte ne se redessine
  // plus et le jeu paraît figé. On bascule alors sur un fond uni.
  let offline = false
  m.on('error', () => {
    if (offline || m.isStyleLoaded()) return
    offline = true
    m.setStyle(OFFLINE_STYLE)
  })
  // Les piles de pions dépendent du zoom : on les recalcule à la fin de chaque zoom.
  m.on('zoomend', () => {
    zoom.value = m.getZoom()
  })
  m.on('moveend', () => {
    const b = m.getBounds()
    const dx = (b.getEast() - b.getWest()) / 2
    const dy = (b.getNorth() - b.getSouth()) / 2
    viewBounds.value = [b.getWest() - dx, b.getSouth() - dy, b.getEast() + dx, b.getNorth() + dy]
  })
  // Clic droit : déplacement direct des unités sélectionnées. Au doigt, l'appui prolongé déclenche
  // aussi « contextmenu » : il sert au bandeau de description, sans donner d'ordre.
  m.on('contextmenu', (e) => {
    if (lastPointerTouch) return
    game.quickMove([e.lngLat.lng, e.lngLat.lat])
  })
  overlay = new MapboxOverlay({
    interleaved: false,
    layers: [],
    onClick,
    // Au doigt, une cible de quelques pixels est difficile à toucher.
    pickingRadius: isTouch.value ? 12 : 4,
    // Appelé à chaque image : le curseur suit l'action en cours (voir cursors.ts).
    getCursor: ({ isHovering }) => {
      const kind = game.buildChoice?.kind
      const cursor = mapCursor({
        mode: mode.value,
        hovering: isHovering,
        dragging,
        placing: game.panelTab === 'production' && (kind === 'civ' || kind === 'mil'),
      })
      const target = map?.getCanvasContainer()
      if (target && target.style.cursor !== cursor) target.style.cursor = cursor
      return cursor
    },
  })
  m.on('dragstart', () => (dragging = true))
  m.on('dragend', () => (dragging = false))
  m.addControl(overlay)
  // Accès à la carte pour les tests de fumée (projection d'une position en pixels).
  ;(window as unknown as { __nkgMap: unknown }).__nkgMap = m
  glState.value = 'ok'
  glDetail.value = ''
  return true
}

/**
 * Perte d'un contexte (pilote réinitialisé, mémoire graphique saturée…), écoutée en capture sur le
 * conteneur pour couvrir les deux canvas : on attend que le navigateur le rende, puis on reconstruit
 * la carte (les ressources de l'ancien contexte sont perdues) ; sinon, message et bouton « Réessayer ».
 * Les canvas retirés par une reconstruction ne sont plus dans le conteneur : leurs événements n'arrivent pas ici.
 */
function onContextLost(e: Event): void {
  e.preventDefault()
  glState.value = 'lost'
  clearRestoreTimer()
  restoreTimer = setTimeout(() => {
    if (glState.value !== 'lost') return
    glDetail.value = 'Le contexte graphique a été perdu et le navigateur ne l’a pas rendu.'
    glState.value = 'error'
  }, RESTORE_TIMEOUT_MS)
}

function onContextRestored(): void {
  if (glState.value !== 'lost') return
  clearRestoreTimer()
  setTimeout(rebuildMap, 0)
}

function destroyMap(): void {
  clearRestoreTimer()
  try {
    map?.remove()
  } catch {
    // Carte déjà inutilisable (contexte perdu) : rien d'autre à libérer.
  }
  map = null
  overlay = null
  // La reconstruction de deck.gl recrée aussi le territoire (textures liées au contexte).
  tilesGrid = null
  supplyGrid = null
  baseRoadsGrid = null
}

/** Recrée la carte en gardant la caméra (récupération après perte, bouton « Réessayer »). */
function rebuildMap(): void {
  const camera = map
    ? {
        center: [map.getCenter().lng, map.getCenter().lat] as LonLat,
        zoom: map.getZoom(),
      }
    : undefined
  destroyMap()
  if (container.value) container.value.innerHTML = ''
  if (createMap(camera)) refresh()
}

onMounted(() => {
  if (!container.value) return
  maplibregl.addProtocol('pmtiles', protocol.tile)
  container.value.addEventListener('webglcontextlost', onContextLost, true)
  container.value.addEventListener('webglcontextrestored', onContextRestored, true)
  // Écoute passive, en capture : le bandeau ne change rien à la sélection ni aux ordres.
  for (const [type, fn] of Object.entries(MAP_POINTER_EVENTS)) {
    container.value.addEventListener(type, fn as EventListener, { capture: true, passive: true })
  }
  if (!createMap()) return
  if (focus.value && map)
    map.jumpTo({ center: [focus.value.at[0], focus.value.at[1]], zoom: focus.value.zoom })
  refresh()
})

watch(focus, (f) => {
  if (!f || !map) return
  if (f.bounds)
    map.fitBounds([f.bounds[0], f.bounds[1]], { padding: 120, maxZoom: 7, duration: 1200 })
  else map.flyTo({ center: [f.at[0], f.at[1]], zoom: f.zoom, duration: 1200 })
})

watch(
  [
    snapshot,
    gridTick,
    selection,
    selectedArmy,
    mode,
    zoom,
    viewBounds,
    selectedCity,
    () => game.panelTab,
    mapView,
    supply,
    showRoads,
    freehand,
    painted,
    () => game.aimPoint,
    () => game.missionPreview,
    () => game.buildChoice,
    () => game.showTransports,
  ],
  refresh,
  {
    deep: false,
  },
)

// ---------- Caméra au clavier : ZQSD / WASD (touches physiques) et flèches ----------

const PAN_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
}
const held = new Set<string>()
let fast = false
let panFrame = 0
/** Instant de l'image précédente du déplacement au clavier (0 : premier appui). */
let panLast = 0
/** Vitesse de la caméra au clavier, en pixels par seconde (Maj : rapide). */
const PAN_SPEED = 720
const PAN_SPEED_FAST = 1680

function panLoop(now: number): void {
  panFrame = 0
  if (!map || held.size === 0) {
    panLast = 0
    return
  }
  let dx = 0
  let dy = 0
  for (const code of held) {
    const d = PAN_KEYS[code]
    if (d) {
      dx += d[0]
      dy += d[1]
    }
  }
  // Pas proportionnel au temps écoulé : même vitesse quelle que soit la fréquence d'images
  // (plafonné après une longue image, pour ne pas faire de bond).
  const dt = panLast ? Math.min(0.1, (now - panLast) / 1000) : 1 / 60
  panLast = now
  const step = (fast ? PAN_SPEED_FAST : PAN_SPEED) * dt
  if (dx || dy) map.panBy([dx * step, dy * step], { duration: 0 })
  panFrame = requestAnimationFrame(panLoop)
}

function onPanKey(event: KeyboardEvent): void {
  const target = event.target
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
  if (target instanceof HTMLSelectElement) return
  if (!game.started || !(event.code in PAN_KEYS)) return
  if (event.ctrlKey || event.metaKey || event.altKey) return
  fast = event.shiftKey
  event.preventDefault()
  if (event.type === 'keydown') {
    held.add(event.code)
    if (!panFrame) panFrame = requestAnimationFrame(panLoop)
  } else {
    held.delete(event.code)
  }
}

function releaseKeys(): void {
  held.clear()
}

onMounted(() => {
  window.addEventListener('keydown', onPanKey)
  window.addEventListener('keyup', onPanKey)
  window.addEventListener('blur', releaseKeys)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onPanKey)
  window.removeEventListener('keyup', onPanKey)
  window.removeEventListener('blur', releaseKeys)
  if (panFrame) cancelAnimationFrame(panFrame)
})

onBeforeUnmount(() => {
  container.value?.removeEventListener('webglcontextlost', onContextLost, true)
  container.value?.removeEventListener('webglcontextrestored', onContextRestored, true)
  for (const [type, fn] of Object.entries(MAP_POINTER_EVENTS)) {
    container.value?.removeEventListener(type, fn as EventListener, true)
  }
  clearPress()
  if (hoverFrame) cancelAnimationFrame(hoverFrame)
  destroyMap()
  maplibregl.removeProtocol('pmtiles')
})
</script>

<template>
  <div ref="container" class="map" />
  <div
    v-if="glState !== 'ok'"
    class="gl-message"
    role="alert"
    :data-testid="glState === 'lost' ? 'webgl-lost' : 'webgl-error'"
  >
    <template v-if="glState === 'lost'">
      <strong>Affichage de la carte interrompu</strong>
      <p>Le contexte graphique (WebGL) a été perdu ; récupération en cours…</p>
    </template>
    <template v-else>
      <strong>La carte ne peut pas s'afficher : WebGL est indisponible</strong>
      <p>Causes possibles :</p>
      <ul>
        <li>accélération matérielle désactivée dans les réglages du navigateur ;</li>
        <li>
          pilote graphique absent, trop ancien ou bloqué par le navigateur (Firefox : page
          about:support, section « Graphiques ») ;
        </li>
        <li>navigateur ou carte graphique à bout de ressources : redémarrez le navigateur.</li>
      </ul>
      <p class="detail" v-if="glDetail">Détail : {{ glDetail }}</p>
      <p>Le reste du jeu fonctionne : une partie en cours continue et reste sauvegardable.</p>
      <button data-testid="webgl-retry" @click="rebuildMap">Réessayer</button>
    </template>
  </div>
  <div
    v-if="cellInfo.length && game.started"
    class="cell-info"
    :class="{ mobile: layout !== 'desktop' }"
    :style="cellInfoStyle"
    data-testid="cell-info"
    aria-live="polite"
  >
    <span v-for="line in cellInfo" :key="line">{{ line }}</span>
  </div>
  <div
    v-if="game.lasso"
    class="lasso-layer"
    data-testid="lasso-layer"
    @pointerdown="onBoxDown"
    @pointermove="onBoxMove"
    @pointerup="onBoxUp"
    @pointercancel="box = null"
  >
    <div v-if="box" class="lasso-box" :style="boxStyle(box)" />
  </div>
  <div
    v-if="painting"
    class="draw-layer"
    data-testid="border-paint-layer"
    @pointerdown="onPaintDown"
    @pointermove="onPaintMove"
    @pointerup="onPaintUp"
    @pointercancel="onPaintUp"
  />
  <div
    v-if="drawing"
    class="draw-layer"
    data-testid="draw-layer"
    @pointerdown="onDrawDown"
    @pointermove="onDrawMove"
    @pointerup="onDrawUp"
    @pointercancel="onDrawUp"
  />
</template>

<style scoped>
.map {
  position: absolute;
  inset: 0;
}
.gl-message {
  position: fixed;
  top: 64px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  width: min(460px, calc(100% - 32px));
  box-sizing: border-box;
  padding: 12px 14px;
  background: rgba(20, 24, 31, 0.97);
  color: #e8eaed;
  border: 1px solid #b45309;
  border-radius: 8px;
  font:
    13px/1.4 system-ui,
    sans-serif;
}
.gl-message p,
.gl-message ul {
  margin: 6px 0;
}
.gl-message ul {
  padding-left: 18px;
}
.gl-message .detail {
  color: #9aa3b2;
  font-size: 12px;
  word-break: break-word;
}
.gl-message button {
  background: #2563eb;
  color: inherit;
  border: 1px solid #2563eb;
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
  font: inherit;
}
.cell-info {
  position: absolute;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  z-index: 11;
  max-width: min(520px, calc(100% - 24px));
  display: flex;
  flex-wrap: wrap;
  gap: 2px 12px;
  padding: 4px 10px;
  background: rgba(20, 24, 31, 0.82);
  color: #e8eaed;
  border-radius: 6px;
  pointer-events: none;
  font:
    12px/1.35 system-ui,
    sans-serif;
}
.cell-info.mobile {
  left: 10px;
  right: 10px;
  max-width: none;
  transform: none;
  flex-direction: column;
}
.lasso-layer {
  position: absolute;
  inset: 0;
  z-index: 5;
  touch-action: none;
  cursor: crosshair;
}
.draw-layer {
  position: absolute;
  inset: 0;
  z-index: 5;
  touch-action: none;
  cursor: crosshair;
}
.lasso-box {
  position: absolute;
  border: 2px dashed #facc15;
  background: rgba(250, 204, 21, 0.12);
  pointer-events: none;
}
</style>
