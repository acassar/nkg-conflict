import type { StyleSpecification } from 'maplibre-gl'
import { layers, namedFlavor } from '@protomaps/basemaps'

/** Style de secours tant qu'aucun fichier .pmtiles n'est configuré : carte mondiale légère de MapLibre. */
const FALLBACK_STYLE_URL = 'https://demotiles.maplibre.org/style.json'

/** Teinte unique des terres : le fond de démo colore chaque pays, ce qui brouille le territoire du jeu. */
const LAND_COLOR = '#ece8de'

/** Uniformise tous les aplats de terres du fond de carte, pour que seule la couche de territoire porte la couleur. */
export function neutralizeCountryFills(map: {
  getStyle(): { layers?: Array<{ id: string; type: string }> } | undefined
  setPaintProperty(layer: string, name: string, value: unknown): void
}): void {
  // Le fond Protomaps a déjà des terres neutres, et ses aplats d'eau ne doivent pas être touchés.
  if (import.meta.env.VITE_PMTILES_URL) return
  for (const layer of map.getStyle()?.layers ?? []) {
    // Le fond de démo n'a que des aplats de terres (pays, Crimée…) : l'eau est la couche « background ».
    if (layer.type === 'fill') {
      map.setPaintProperty(layer.id, 'fill-color', LAND_COLOR)
    }
  }
}

/**
 * Renvoie le style du fond de carte.
 * Avec VITE_PMTILES_URL (ex. un fichier hébergé sur le VPS), on utilise le fond Protomaps.
 */
export function baseStyle(): StyleSpecification | string {
  const pmtilesUrl = import.meta.env.VITE_PMTILES_URL as string | undefined
  if (!pmtilesUrl) return FALLBACK_STYLE_URL

  return {
    version: 8,
    glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
    sprite: 'https://protomaps.github.io/basemaps-assets/sprites/v4/light',
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${pmtilesUrl}`,
        attribution:
          '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>',
      },
    },
    layers: layers('protomaps', namedFlavor('light'), { lang: 'fr' }),
  }
}
