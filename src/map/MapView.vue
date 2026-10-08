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

const container = ref<HTMLDivElement | null>(null)
const game = useGameStore()
const { snapshot, grid, gridTick, selection, selectedArmy, mode, selectedCity, stances, focus } =
  storeToRefs(game)

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
    }),
  })
}

function onClick(info: PickingInfo, event: { srcEvent?: MouseEvent }): void {
  const point = info.coordinate ? ([info.coordinate[0], info.coordinate[1]] as LonLat) : null
  if (point && game.mapClick(point)) return
  if (info.layer?.id === 'cities' && info.object) {
    game.selectCity((info.object as CityState).name)
    return
  }
  const item = info.layer?.id === 'units' ? (info.object as MapUnit | undefined) : undefined
  const additive = event.srcEvent?.shiftKey ?? false
  if (item && isStack(item)) {
    // Clic sur une pile : sélectionne toutes ses unités (celles du joueur seulement).
    game.selectUnits(
      item.units.map((u) => u.id),
      additive,
    )
  } else if (item) {
    game.selectUnit(item.id, additive)
  } else if (!additive) {
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
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
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
    getCursor: ({ isHovering }) =>
      mode.value.kind !== 'select' ? 'crosshair' : isHovering ? 'pointer' : 'grab',
  })
  map.addControl(overlay)
  if (focus.value)
    map.jumpTo({ center: [focus.value.at[0], focus.value.at[1]], zoom: focus.value.zoom })
  refresh()
})

watch(focus, (f) => {
  if (f && map) map.flyTo({ center: [f.at[0], f.at[1]], zoom: f.zoom, duration: 1200 })
})

watch([snapshot, gridTick, selection, selectedArmy, mode, zoom, selectedCity], refresh, {
  deep: false,
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
</template>

<style scoped>
.map {
  position: absolute;
  inset: 0;
}
</style>
