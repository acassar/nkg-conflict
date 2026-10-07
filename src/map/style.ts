import type { StyleSpecification } from 'maplibre-gl'
import { layers, namedFlavor } from '@protomaps/basemaps'

/** Style de secours tant qu'aucun fichier .pmtiles n'est configuré : carte mondiale légère de MapLibre. */
const FALLBACK_STYLE_URL = 'https://demotiles.maplibre.org/style.json'

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
