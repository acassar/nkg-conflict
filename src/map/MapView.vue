<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { Protocol } from 'pmtiles'
import { useGameStore } from '@/stores/game'
import { baseStyle } from './style'
import { unitLayers } from './unitLayers'

const container = ref<HTMLDivElement | null>(null)
const game = useGameStore()

let map: maplibregl.Map | null = null
let overlay: MapboxOverlay | null = null
const protocol = new Protocol()

onMounted(() => {
  if (!container.value) return
  maplibregl.addProtocol('pmtiles', protocol.tile)

  map = new maplibregl.Map({
    container: container.value,
    style: baseStyle(),
    center: [34.5, 49.2],
    zoom: 5,
    minZoom: 1.5,
    maxZoom: 12,
    attributionControl: { compact: true },
  })
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')

  overlay = new MapboxOverlay({ interleaved: false, layers: unitLayers(game.snapshot) })
  map.addControl(overlay)
})

watch(
  () => game.snapshot,
  (snapshot) => overlay?.setProps({ layers: unitLayers(snapshot) }),
)

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
