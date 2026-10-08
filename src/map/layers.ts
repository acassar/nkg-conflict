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

export interface LayerInput {
  snapshot: SimSnapshot | null
  territory: HTMLCanvasElement | null
  /** Relief, forêts et marais (fixe). */
  terrain: HTMLCanvasElement | null
  bbox: [number, number, number, number] | null
  selection: Set<number>
  selectedArmy: ArmyState | null
  /** Premier point posé d'un tracé en cours (front ou offensive). */
  pendingPoint: LonLat | null
  /** Zoom de la carte : sert à regrouper les pions qui se chevauchent à l'écran. */
  zoom: number
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

export function buildLayers(input: LayerInput): Layer[] {
  const { snapshot, territory, bbox, selection, selectedArmy, pendingPoint } = input
  if (!snapshot) return []
  const colors = new Map<string, Rgb>(snapshot.countries.map((c) => [c.id, c.color]))
  const colorOf = (id: string | null): Rgb => (id ? colors.get(id) : undefined) ?? [140, 140, 140]
  const selectedUnits = snapshot.units.filter((u) => selection.has(u.id))
  const layers: Layer[] = []

  if (input.terrain && bbox) {
    layers.push(
      new BitmapLayer({
        id: 'terrain',
        image: input.terrain,
        bounds: bbox,
        _imageCoordinateSystem: COORDINATE_SYSTEM.LNGLAT,
        textureParameters: { minFilter: 'nearest', magFilter: 'nearest' },
      }),
    )
  }
  if (territory && bbox) {
    layers.push(
      new BitmapLayer({
        id: 'territory',
        image: territory,
        bounds: bbox,
        // La grille est en lon/lat régulières : deck.gl la reprojette sur la carte Web Mercator.
        _imageCoordinateSystem: COORDINATE_SYSTEM.LNGLAT,
        textureParameters: { minFilter: 'nearest', magFilter: 'nearest' },
      }),
    )
  }

  layers.push(
    new ScatterplotLayer<CityState>({
      id: 'cities',
      data: snapshot.cities,
      getPosition: (c) => [c.lon, c.lat],
      getFillColor: (c) => [...colorOf(c.owner), 255],
      getLineColor: [20, 24, 31, 255],
      stroked: true,
      lineWidthMinPixels: 1,
      radiusUnits: 'pixels',
      getRadius: (c) => (c.capital ? 6 : 3.5),
      updateTriggers: { getFillColor: snapshot.cities.map((c) => c.owner).join() },
    }),
    new TextLayer<CityState>({
      id: 'city-names',
      data: snapshot.cities,
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

  layers.push(
    new IconLayer<MapUnit>({
      id: 'units',
      data: stackUnits(snapshot.units, input.zoom),
      getPosition: (m) => [m.lon, m.lat],
      getIcon: (m) =>
        isStack(m)
          ? stackIcon(
              m.units,
              colorOf(m.owner),
              m.units.some((u) => selection.has(u.id)),
            )
          : unitIcon(m, colorOf(m.owner), selection.has(m.id)),
      getSize: 34,
      sizeUnits: 'pixels',
      pickable: true,
      updateTriggers: { getIcon: [...selection].join() },
    }),
  )
  return layers
}
