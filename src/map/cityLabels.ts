import type { CityState } from '@/sim/core/types'
import { toPixels } from './clusters'

/**
 * Rendu des villes sur la carte : point en trois tailles selon la population, étoile pour les
 * capitales, nom à halo sombre dont la taille suit le zoom, et petites villes masquées quand leurs
 * noms se chevauchent à l'écran.
 */

/** Classe de taille d'une ville : 0 sous 250 000 habitants, 1 sous un million, 2 au-delà. */
export function cityTier(pop: number): 0 | 1 | 2 {
  if (pop >= 1_000_000) return 2
  if (pop >= 250_000) return 1
  return 0
}

/** Rayon du point de ville, en pixels, selon sa classe de taille. */
export const CITY_DOT_RADIUS = [3, 4.5, 6] as const

/** Taille de l'étoile d'une capitale, en pixels (avant facteur de zoom). */
export const CAPITAL_STAR_SIZE = 18

/** Facteur de taille selon le zoom : textes plus petits de loin, plus grands de près. */
export function zoomScale(zoom: number): number {
  return Math.min(1.25, Math.max(0.8, 0.9 + 0.08 * (zoom - 4)))
}

/** Taille de base du nom selon la classe de la ville, en pixels. */
const NAME_SIZE = [11, 12, 13.5] as const

/** Taille du nom d'une ville en pixels : selon sa classe, plus grand pour une capitale. */
export function cityNameSize(city: CityState, zoom: number): number {
  const base = city.capital ? 15 : NAME_SIZE[cityTier(city.pop)]
  return Math.round(base * zoomScale(zoom) * 10) / 10
}

/** Décalage vertical du nom au-dessus du point, en pixels. */
export function cityNameOffset(city: CityState, zoom: number): number {
  const mark = city.capital
    ? CAPITAL_STAR_SIZE * zoomScale(zoom) * 0.5
    : CITY_DOT_RADIUS[cityTier(city.pop)]
  return -(mark + 2 + cityNameSize(city, zoom) * 0.55)
}

/** Ordre de priorité à l'affichage : ville sélectionnée, capitales, puis population décroissante. */
function priority(city: CityState, selected: string | null): number {
  if (city.name === selected) return Number.MAX_VALUE
  return (city.capital ? 1e12 : 0) + city.pop
}

/** Largeur moyenne d'un caractère, en fraction de la taille de police (police sans empattement). */
const CHAR_WIDTH = 0.58
/** Marge autour de chaque nom, en pixels. */
const LABEL_MARGIN = 3
/** Taille des cases de la grille d'indexation des noms placés, en pixels. */
const BUCKET_PX = 96

/**
 * Villes dont le nom tient sans en chevaucher un autre au zoom donné. Placement glouton par ordre de
 * priorité ; la ville sélectionnée et les capitales sont toujours gardées. Les noms placés sont rangés
 * dans une grille de cases de BUCKET_PX pixels, d'où un coût linéaire même sur la carte du monde.
 */
export function declutterCities(
  cities: CityState[],
  zoom: number,
  selected: string | null = null,
): CityState[] {
  const order = cities
    .map((c, i) => ({ c, i, p: priority(c, selected) }))
    .sort((a, b) => b.p - a.p || a.i - b.i)
  type Box = { x0: number; y0: number; x1: number; y1: number }
  const grid = new Map<number, Box[]>()
  const kept = new Uint8Array(cities.length)
  const keyOf = (bx: number, by: number): number => bx * 1_000_003 + by

  for (const { c, i } of order) {
    const size = cityNameSize(c, zoom)
    const [px, py] = toPixels(c.lon, c.lat, zoom)
    const half = (c.name.length * size * CHAR_WIDTH) / 2 + LABEL_MARGIN
    const cy = py + cityNameOffset(c, zoom)
    const x0 = px - half
    const x1 = px + half
    const y0 = cy - size / 2 - LABEL_MARGIN
    const y1 = cy + size / 2 + LABEL_MARGIN
    const bx0 = Math.floor(x0 / BUCKET_PX)
    const bx1 = Math.floor(x1 / BUCKET_PX)
    const by0 = Math.floor(y0 / BUCKET_PX)
    const by1 = Math.floor(y1 / BUCKET_PX)
    const forced = c.capital || c.name === selected
    if (!forced) {
      let hit = false
      for (let bx = bx0; bx <= bx1 && !hit; bx++) {
        for (let by = by0; by <= by1 && !hit; by++) {
          for (const b of grid.get(keyOf(bx, by)) ?? []) {
            if (x0 < b.x1 && x1 > b.x0 && y0 < b.y1 && y1 > b.y0) {
              hit = true
              break
            }
          }
        }
      }
      if (hit) continue
    }
    const b = { x0, y0, x1, y1 }
    for (let bx = bx0; bx <= bx1; bx++) {
      for (let by = by0; by <= by1; by++) {
        const k = keyOf(bx, by)
        const list = grid.get(k)
        if (list) list.push(b)
        else grid.set(k, [b])
      }
    }
    kept[i] = 1
  }
  return cities.filter((_, i) => kept[i])
}

/** Étoile à cinq branches (SVG en data URL), teintée par la couche d'icônes (masque). */
export const STAR_ICON = {
  id: 'capital-star',
  url:
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
        '<polygon fill="#fff" points="32,2 39.6,23.5 62,23.5 44,37 50.6,60 32,46.5 13.4,60 20,37 2,23.5 24.4,23.5"/>' +
        '</svg>',
    ),
  width: 64,
  height: 64,
  mask: true,
}
