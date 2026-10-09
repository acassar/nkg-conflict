import { COORDINATE_SYSTEM, type Layer } from '@deck.gl/core'
import {
  BitmapLayer,
  IconLayer,
  PathLayer,
  PolygonLayer,
  ScatterplotLayer,
  TextLayer,
} from '@deck.gl/layers'
import type { ArmyState, CityState, LonLat, SimSnapshot, UnitSnapshot } from '@/sim/core/types'
import { MODERN_CATALOG } from '@/sim/units/catalog'
import { stackIcon, unitIcon } from './unitIcons'
import { isStack, stackUnits, type MapUnit } from './clusters'
import { stanceColor, type TerritoryTile } from './territoryImage'
import type { Stance } from '@/stores/game'

export interface LayerInput {
  snapshot: SimSnapshot | null
  /** Territoire en tuiles (seules les tuiles modifiées changent de canvas). */
  territory: TerritoryTile[]
  /** Relief, forêts et marais (fixe). */
  terrain: TerritoryTile[]
  /** Position de chaque pays vis-à-vis du joueur (couleurs). */
  stances: Map<string, Stance>
  selection: Set<number>
  selectedArmy: ArmyState | null
  /** Premier point posé d'un tracé en cours (front ou offensive). */
  pendingPoint: LonLat | null
  /** Zoom de la carte : sert à regrouper les pions qui se chevauchent à l'écran. */
  zoom: number
  selectedCity: string | null
  /**
   * Vue « Production » (onglet ouvert) : casernes occupées par ville du joueur.
   * Les villes du joueur affichent alors leurs casernes (occupées/total) et leurs fortifications.
   */
  production: Map<string, number> | null
}

type Rgb = [number, number, number]

/** Pointe de flèche (triangle) au bout d'un segment, en degrés. */
function arrowHead(from: LonLat, to: LonLat, size = 0.12): LonLat[] {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const base: LonLat = [to[0] - ux * size * 1.6, to[1] - uy * size * 1.6]
  return [
    to,
    [base[0] - uy * size, base[1] + ux * size],
    [base[0] + uy * size, base[1] - ux * size],
  ]
}

/**
 * Villes affichées selon le zoom : sur la carte du monde, seules les capitales et les très grandes villes
 * apparaissent de loin ; tout s'affiche en zoomant.
 */
function visibleCities(snapshot: SimSnapshot, zoom: number): CityState[] {
  if (snapshot.cities.length < 120 || zoom >= 5.5) return snapshot.cities
  const atWar = new Set(snapshot.politics.wars.flatMap((w) => [...w.attackers, ...w.defenders]))
  return snapshot.cities.filter((c) => {
    if (c.owner === snapshot.playerCountry && (c.capital || zoom >= 4)) return true
    if (zoom >= 4.5) return c.capital || c.pop >= 1_500_000
    if (zoom >= 3.5) return c.capital && (c.pop >= 1_000_000 || atWar.has(c.owner ?? ''))
    return c.capital && atWar.has(c.owner ?? '') && c.pop >= 1_000_000
  })
}

export function buildLayers(input: LayerInput): Layer[] {
  const { snapshot, selection, selectedArmy, pendingPoint } = input
  if (!snapshot) return []
  const colors = new Map<string, Rgb>(
    snapshot.countries.map((c) => [
      c.id,
      stanceColor(input.stances.get(c.id) ?? 'neutral', c.color),
    ]),
  )
  const colorOf = (id: string | null): Rgb => (id ? colors.get(id) : undefined) ?? [140, 140, 140]
  const selectedUnits = snapshot.units.filter((u) => selection.has(u.id))
  const cities = visibleCities(snapshot, input.zoom)
  const layers: Layer[] = []

  // Relief puis territoire, en tuiles reprojetées de lon/lat vers Web Mercator.
  for (const [prefix, tiles] of [
    ['terrain', input.terrain],
    ['territory', input.territory],
  ] as const) {
    for (const t of tiles) {
      layers.push(
        new BitmapLayer({
          id: `${prefix}-${t.id}`,
          image: t.canvas,
          bounds: t.bounds,
          _imageCoordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          textureParameters: { minFilter: 'nearest', magFilter: 'nearest' },
        }),
      )
    }
  }

  layers.push(
    // Fortifications : anneau gris d'autant plus épais que le niveau est élevé.
    new ScatterplotLayer<CityState>({
      id: 'city-forts',
      data: cities.filter((c) => c.buildings.fort > 0),
      getPosition: (c) => [c.lon, c.lat],
      filled: false,
      stroked: true,
      getLineColor: [55, 60, 70, 230],
      getLineWidth: (c) => 1.5 * c.buildings.fort,
      lineWidthUnits: 'pixels',
      radiusUnits: 'pixels',
      getRadius: (c) => (c.capital ? 11 : 9),
      updateTriggers: { getLineWidth: snapshot.cities.map((c) => c.buildings.fort).join() },
    }),
    // Dépôts : carré blanc sous la ville.
    new TextLayer<CityState>({
      id: 'city-depots',
      data: cities.filter((c) => c.buildings.depot > 0),
      getPosition: (c) => [c.lon, c.lat],
      getText: () => '■',
      getSize: 11,
      getColor: [250, 250, 250, 255],
      getPixelOffset: [0, 12],
      outlineWidth: 2,
      outlineColor: [20, 24, 31, 255],
      fontSettings: { sdf: true },
      characterSet: ['■'],
    }),
    new ScatterplotLayer<CityState>({
      id: 'cities',
      data: cities,
      getPosition: (c) => [c.lon, c.lat],
      getFillColor: (c) => [...colorOf(c.owner), 255],
      getLineColor: (c) =>
        c.name === input.selectedCity ? [250, 204, 21, 255] : [20, 24, 31, 255],
      getLineWidth: (c) => (c.name === input.selectedCity ? 3 : 1),
      lineWidthUnits: 'pixels',
      stroked: true,
      radiusUnits: 'pixels',
      getRadius: (c) => (c.capital ? 6 : 4),
      pickable: true,
      updateTriggers: {
        getFillColor: [snapshot.cities.map((c) => c.owner).join(), input.stances],
        getLineColor: input.selectedCity,
        getLineWidth: input.selectedCity,
      },
    }),
  )

  // Vue « Production » : casernes et fortifications des villes du joueur.
  if (input.production) {
    const busy = input.production
    const mine = snapshot.cities.filter(
      (c) =>
        c.owner === snapshot.playerCountry && (c.buildings.barracks > 0 || c.buildings.fort > 0),
    )
    const free = (c: CityState): number => c.buildings.barracks - (busy.get(c.name) ?? 0)
    layers.push(
      new ScatterplotLayer<CityState>({
        id: 'prod-free-barracks',
        data: mine.filter((c) => free(c) > 0),
        getPosition: (c) => [c.lon, c.lat],
        filled: false,
        stroked: true,
        getLineColor: [34, 197, 94, 230],
        getLineWidth: 2.5,
        lineWidthUnits: 'pixels',
        radiusUnits: 'pixels',
        getRadius: 14,
        updateTriggers: { data: [...busy.entries()].join() },
      }),
      new TextLayer<CityState>({
        id: 'prod-labels',
        data: mine,
        getPosition: (c) => [c.lon, c.lat],
        getText: (c) => {
          const parts: string[] = []
          if (c.buildings.barracks > 0) {
            parts.push(`Caserne ${busy.get(c.name) ?? 0}/${c.buildings.barracks}`)
          }
          if (c.buildings.fort > 0) parts.push(`Fort ${c.buildings.fort}`)
          return parts.join(' · ')
        },
        getColor: (c) =>
          c.buildings.barracks > 0 && free(c) > 0 ? [21, 128, 61, 255] : [146, 64, 14, 255],
        getSize: 11,
        getPixelOffset: [0, 18],
        fontWeight: 700,
        outlineWidth: 3,
        outlineColor: [255, 255, 255, 230],
        fontSettings: { sdf: true },
        characterSet: 'auto',
        updateTriggers: {
          getText: [...busy.entries()].join(),
          getColor: [...busy.entries()].join(),
        },
      }),
    )
  }

  // Rayon de commandement des QG sélectionnés.
  const commandRange = (u: UnitSnapshot): number => MODERN_CATALOG[u.kind].commandRadiusKm
  layers.push(
    new ScatterplotLayer<UnitSnapshot>({
      id: 'command-range',
      data: selectedUnits.filter((u) => commandRange(u) > 0),
      getPosition: (u) => [u.lon, u.lat],
      getRadius: (u) => commandRange(u) * 1000,
      radiusUnits: 'meters',
      filled: true,
      getFillColor: [250, 204, 21, 25],
      stroked: true,
      getLineColor: [250, 204, 21, 200],
      lineWidthMinPixels: 1.5,
    }),
  )

  // Chemins et objectifs des unités sélectionnées.
  layers.push(
    new PathLayer<UnitSnapshot>({
      id: 'paths',
      data: selectedUnits.filter((u) => u.path.length > 0),
      getPath: (u) => [[u.lon, u.lat], ...u.path],
      getColor: (u) => (u.order === 'attack' ? [249, 115, 22, 220] : [250, 250, 250, 200]),
      getWidth: 2,
      widthUnits: 'pixels',
    }),
  )

  // Front et offensive de l'armée sélectionnée.
  if (selectedArmy?.front) {
    layers.push(
      new PathLayer({
        id: 'army-front',
        data: [selectedArmy.front],
        getPath: (f: [LonLat, LonLat]) => f,
        getColor: [250, 204, 21, 230],
        getWidth: 5,
        widthUnits: 'pixels',
        capRounded: true,
      }),
    )
  }
  const offensive = selectedArmy?.offensive
  if (offensive) {
    const color: [number, number, number, number] = offensive.launched
      ? [249, 115, 22, 230]
      : [250, 204, 21, 230]
    layers.push(
      new PathLayer({
        id: 'offensive-shaft',
        data: [[offensive.from, offensive.to]],
        getPath: (p: LonLat[]) => p,
        getColor: color,
        getWidth: 6,
        widthUnits: 'pixels',
      }),
      new PolygonLayer({
        id: 'offensive-head',
        data: [arrowHead(offensive.from, offensive.to)],
        getPolygon: (p: LonLat[]) => p,
        getFillColor: color,
        stroked: false,
      }),
    )
  }
  if (pendingPoint) {
    layers.push(
      new ScatterplotLayer({
        id: 'pending-point',
        data: [pendingPoint],
        getPosition: (p: LonLat) => p,
        getFillColor: [250, 204, 21, 255],
        radiusUnits: 'pixels',
        getRadius: 6,
      }),
    )
  }

  // Pions : ceux des pays neutres (garnisons du temps de paix) plus petits et plus discrets.
  const involved = snapshot.units.filter(
    (u) => (input.stances.get(u.owner) ?? 'neutral') !== 'neutral' || selection.has(u.id),
  )
  const neutral = snapshot.units.filter(
    (u) => (input.stances.get(u.owner) ?? 'neutral') === 'neutral' && !selection.has(u.id),
  )
  for (const [id, list, size, opacity] of [
    ['units-neutral', neutral, 24, 0.75],
    ['units', involved, 34, 1],
  ] as const) {
    layers.push(
      new IconLayer<MapUnit>({
        id,
        data: stackUnits(list, input.zoom, size + 4),
        getPosition: (m) => [m.lon, m.lat],
        getIcon: (m) =>
          isStack(m)
            ? stackIcon(
                m.units,
                colorOf(m.owner),
                m.units.some((u) => selection.has(u.id)),
              )
            : unitIcon(m, colorOf(m.owner), selection.has(m.id)),
        getSize: size,
        sizeUnits: 'pixels',
        opacity,
        pickable: true,
        updateTriggers: { getIcon: [[...selection].join(), input.stances] },
      }),
    )
  }
  // Noms des villes au-dessus des pions, pour rester lisibles.
  layers.push(
    new TextLayer<CityState>({
      id: 'city-names',
      data: cities,
      getPosition: (c) => [c.lon, c.lat],
      getText: (c) => c.name,
      getSize: (c) => (c.capital ? 14 : 11),
      getColor: [30, 34, 40, 255],
      getPixelOffset: [0, -12],
      fontWeight: 600,
      outlineWidth: 3,
      outlineColor: [255, 255, 255, 200],
      fontSettings: { sdf: true },
      characterSet: 'auto',
    }),
  )
  return layers
}
