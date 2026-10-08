<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapboxOverlay } from '@deck.gl/mapbox'
import type { PickingInfo } from '@deck.gl/core'
import { Protocol } from 'pmtiles'
import { storeToRefs } from 'pinia'
import type { LonLat } from '@/sim/core/types'
import { isStack, type MapUnit } from './clusters'
import { useGameStore } from '@/stores/game'
import { baseStyle, neutralizeCountryFills } from './style'
import { buildLayers } from './layers'
import { terrainCanvas, territoryCanvas } from './territoryImage'

const container = ref<HTMLDivElement | null>(null)
const game = useGameStore()
const { snapshot, grid, selection, selectedArmy, mode } = storeToRefs(game)

let map: maplibregl.Map | null = null
const zoom = ref(5)
let overlay: MapboxOverlay | null = null
const protocol = new Protocol()

// Le canvas du territoire n'est redessiné que lorsqu'une nouvelle grille arrive.
let territory: HTMLCanvasElement | null = null
let territoryVersion = -1
let terrain: HTMLCanvasElement | null = null

function refresh(): void {
  const s = snapshot.value
  const g = grid.value
  if (s && g && g.version !== territoryVersion) {
    territory = territoryCanvas(g, s.countries)
    territoryVersion = g.version
    terrain ??= terrainCanvas(g)
  }
  const m = mode.value
  overlay?.setProps({
    layers: buildLayers({
      snapshot: s,
      territory,
      terrain,
      bbox: g?.bbox ?? null,
      selection: new Set(selection.value),
      selectedArmy: selectedArmy.value,
      pendingPoint: m.kind === 'front' || m.kind === 'offensive' ? m.first : null,
      zoom: zoom.value,
    }),
  })
}

function onClick(info: PickingInfo, event: { srcEvent?: MouseEvent }): void {
  const point = info.coordinate ? ([info.coordinate[0], info.coordinate[1]] as LonLat) : null
  if (point && game.mapClick(point)) return
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
    game.clearSelection()
  }
}

onMounted(() => {
  if (!container.value) return
  maplibregl.addProtocol('pmtiles', protocol.tile)

  map = new maplibregl.Map({
    container: container.value,
    style: baseStyle(),
    center: [34.5, 49.2],
    zoom: 5,
    minZoom: 3,
    maxZoom: 11,
    attributionControl: { compact: true },
  })
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
  map.on('style.load', () => map && neutralizeCountryFills(map))
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
  refresh()
})

watch([snapshot, grid, selection, selectedArmy, mode, zoom], refresh, { deep: false })

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
