<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapboxOverlay } from '@deck.gl/mapbox'
import type { PickingInfo } from '@deck.gl/core'
import { Protocol } from 'pmtiles'
import { storeToRefs } from 'pinia'
import type { CityState, GridSnapshot, LonLat } from '@/sim/core/types'
import { isStack, type MapUnit } from './clusters'
import { useGameStore } from '@/stores/game'
import { baseStyle, neutralizeCountryFills, OFFLINE_STYLE } from './style'
import { buildLayers } from './layers'
import { terrainTiles, TerritoryTiles, type TerritoryTile } from './territoryImage'
import { isTouch } from '@/composables/layout'
import { useProductionStats } from '@/composables/production'
import { useBattles } from '@/composables/battles'

const container = ref<HTMLDivElement | null>(null)
const game = useGameStore()
const { snapshot, grid, gridTick, selection, selectedArmy, mode, selectedCity, stances, focus } =
  storeToRefs(game)

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

const productionStats = useProductionStats()
const battles = useBattles()
let map: maplibregl.Map | null = null
const zoom = ref(4)
let overlay: MapboxOverlay | null = null
const protocol = new Protocol()

// Territoire en tuiles : recréé quand une grille complète arrive, puis mis à jour cellule par cellule.
let tiles: TerritoryTiles | null = null
let tilesGrid: GridSnapshot | null = null
let territory: TerritoryTile[] = []
let terrain: TerritoryTile[] = []
let colorKey = ''

function syncTerritory(): void {
  const s = snapshot.value
  const g = grid.value
  if (!s || !g) {
    tiles = null
    tilesGrid = null
    territory = []
    terrain = []
    return
  }
  const st = stances.value
  if (g !== tilesGrid) {
    tiles = new TerritoryTiles(g, s.countries, st.map, game.hostilePairs)
    terrain = terrainTiles(g)
    tilesGrid = g
    colorKey = st.key
    game.takePendingCells()
  } else if (tiles) {
    if (st.key !== colorKey) {
      colorKey = st.key
      game.takePendingCells()
      tiles.setColors(s.countries, st.map, game.hostilePairs)
    } else {
      const cells = game.takePendingCells()
      if (cells.length) tiles.applyCells(cells)
    }
  }
  territory = tiles?.layers() ?? []
}

function refresh(): void {
  syncTerritory()
  const m = mode.value
  overlay?.setProps({
    layers: buildLayers({
      snapshot: snapshot.value,
      territory,
      terrain,
      stances: stances.value.map,
      selection: new Set(selection.value),
      selectedArmy: selectedArmy.value,
      pendingPoint: m.kind === 'front' || m.kind === 'offensive' ? m.first : null,
      zoom: zoom.value,
      selectedCity: selectedCity.value?.name ?? null,
      battles: battles.value,
      production:
        game.panelTab === 'production' ? (productionStats.value?.busyByCity ?? null) : null,
    }),
  })
}

function onClick(info: PickingInfo, event: { srcEvent?: MouseEvent }): void {
  const point = info.coordinate ? ([info.coordinate[0], info.coordinate[1]] as LonLat) : null
  const me = game.snapshot?.playerCountry
  const additive = event.srcEvent?.shiftKey ?? false
  if (info.layer?.id === 'battles' && info.object) {
    game.openBattle((info.object as { ids: number[] }).ids)
    return
  }
  const item = info.layer?.id.startsWith('units') ? (info.object as MapUnit | undefined) : undefined
  if (item) {
    const units = isStack(item) ? item.units : [item]
    // Un ordre en cours de saisie peut viser une unité (attaque, encerclement).
    if (point && game.mapClick(point, units)) return
    const mine = units.filter((u) => u.owner === me)
    if (mine.length > 0) {
      game.selectUnits(
        mine.map((u) => u.id),
        additive,
      )
    } else if (units[0]) {
      // Pion d'un autre pays : ouvre la fiche de ce pays.
      if (!additive) game.clearSelection()
      game.selectCountry(units[0].owner)
    }
    return
  }
  if (point && game.mapClick(point)) return
  if (info.layer?.id === 'cities' && info.object) {
    const city = info.object as CityState
    // Ville du joueur : production ; ville étrangère : fiche du pays.
    if (city.owner === me) game.selectCity(city.name)
    else if (city.owner) game.selectCountry(city.owner)
    return
  }
  if (!additive) {
    // Clic sur un territoire : sans unités sélectionnées, ouvre la fiche du pays.
    const hadSelection = game.selection.length > 0
    game.clearSelection()
    if (!hadSelection && point) {
      const code = game.ownerAt(point[0], point[1])
      if (code) game.selectCountry(code)
    }
  }
}

onMounted(() => {
  if (!container.value) return
  maplibregl.addProtocol('pmtiles', protocol.tile)

  map = new maplibregl.Map({
    container: container.value,
    style: baseStyle(),
    center: [15, 45],
    zoom: 4,
    minZoom: 1.5,
    maxZoom: 11,
    attributionControl: { compact: true },
  })
  // Sur écran tactile, le zoom se fait au pincement : pas de boutons.
  if (!isTouch.value) {
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
  }
  map.touchZoomRotate.disableRotation()
  map.on('style.load', () => map && neutralizeCountryFills(map))
  // Fond de carte injoignable (hors ligne, réseau filtré) : sans style chargé, la carte ne se redessine
  // plus et le jeu paraît figé. On bascule alors sur un fond uni.
  let offline = false
  map.on('error', () => {
    if (!map || offline || map.isStyleLoaded()) return
    offline = true
    map.setStyle(OFFLINE_STYLE)
  })
  // Les piles de pions dépendent du zoom : on les recalcule à la fin de chaque zoom.
  map.on('zoomend', () => {
    zoom.value = map?.getZoom() ?? zoom.value
  })
  // Clic droit : déplacement direct des unités sélectionnées.
  map.on('contextmenu', (e) => game.quickMove([e.lngLat.lng, e.lngLat.lat]))

  overlay = new MapboxOverlay({
    interleaved: false,
    layers: [],
    onClick,
    // Au doigt, une cible de quelques pixels est difficile à toucher.
    pickingRadius: isTouch.value ? 12 : 4,
    getCursor: ({ isHovering }) =>
      mode.value.kind !== 'select' ? 'crosshair' : isHovering ? 'pointer' : 'grab',
  })
  map.addControl(overlay)
  // Accès à la carte pour les tests de fumée (projection d'une position en pixels).
  ;(window as unknown as { __nkgMap: unknown }).__nkgMap = map
  if (focus.value)
    map.jumpTo({ center: [focus.value.at[0], focus.value.at[1]], zoom: focus.value.zoom })
  refresh()
})

watch(focus, (f) => {
  if (f && map) map.flyTo({ center: [f.at[0], f.at[1]], zoom: f.zoom, duration: 1200 })
})

watch(
  [snapshot, gridTick, selection, selectedArmy, mode, zoom, selectedCity, () => game.panelTab],
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

function panLoop(): void {
  panFrame = 0
  if (!map || held.size === 0) return
  let dx = 0
  let dy = 0
  for (const code of held) {
    const d = PAN_KEYS[code]
    if (d) {
      dx += d[0]
      dy += d[1]
    }
  }
  const speed = fast ? 28 : 12
  if (dx || dy) map.panBy([dx * speed, dy * speed], { duration: 0 })
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
  map?.remove()
  map = null
  overlay = null
  maplibregl.removeProtocol('pmtiles')
})
</script>

<template>
  <div ref="container" class="map" />
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
</template>

<style scoped>
.map {
  position: absolute;
  inset: 0;
}
.lasso-layer {
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
