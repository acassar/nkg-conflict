import { COORDINATE_SYSTEM, type BinaryAttribute, type Layer } from '@deck.gl/core'
import {
  BitmapLayer,
  IconLayer,
  LineLayer,
  PathLayer,
  PolygonLayer,
  ScatterplotLayer,
  TextLayer,
} from '@deck.gl/layers'
import type {
  ArmyState,
  CityState,
  FactorySite,
  LonLat,
  SimSnapshot,
  UnitSnapshot,
} from '@/sim/core/types'
import { MODERN_CATALOG } from '@/sim/units/catalog'
import { FORT_RADIUS_KM, formationSlots } from '@/sim/economy/rules'
import { fortBonusLabel } from '@/sim/economy/forts'
import {
  FORMATION_ICON_SCALE,
  formationIcon,
  gaugeIcon,
  stackIcon,
  unitIcon,
  type GaugeShape,
} from './unitIcons'
import { formationPawns, isStack, stackUnits, type MapUnit } from './clusters'
import { stanceColor, type TerritoryTile } from './territoryImage'
import { BASE_ROAD_WIDTH, type RoadLines } from './roadsImage'
import type { LineBlock } from './lineBlocks'
import { BORDER_STYLE, type BorderBlocks } from './borders'
import {
  CAPITAL_STAR_SIZE,
  CITY_DOT_RADIUS,
  STAR_ICON,
  cityNameOffset,
  cityNameSize,
  cityTier,
  declutterCities,
  zoomScale,
} from './cityLabels'
import type { Stance } from '@/stores/game'
import type { SupplyPocket, SupplyView } from '@/sim/systems/supplyView'
import { AIR_COLORS, AIR_ZONE_KM } from '@/sim/systems/air'
import { TRANSPORT_COLORS, type TransportRoute } from './transports'

export interface MissionPreviewShapes {
  posts: LonLat[]
  lines: LonLat[][]
  points: LonLat[]
  axis: [LonLat, LonLat] | null
  ring: LonLat[] | null
}

/** Frontières tenues, en carrés de cellules : armée sélectionnée, autres armées, geste en cours. */
export interface BorderShapes {
  held: LonLat[][]
  others: LonLat[][]
  painting: LonLat[][]
}

export interface LayerInput {
  snapshot: SimSnapshot | null
  /** Territoire en tuiles (seules les tuiles modifiées changent de canvas). */
  territory: TerritoryTile[]
  /** Relief, forêts, marais, fleuves et villes (fixe). */
  terrain: TerritoryTile[]
  /**
   * Réseau de transport de la carte par défaut, en traits fins sous le territoire : grands axes et
   * voies ferrées d'une part, routes de l'autre (blocs proches de la vue), chacun avec son opacité
   * selon le zoom. Null en mode
   * Logistique (qui dessine le réseau en cellules au-dessus de ses zones) ou si le joueur l'a masqué.
   */
  roads: {
    main: RoadLines[]
    minor: RoadLines[]
    mainOpacity: number
    minorOpacity: number
  } | null
  /** Frontières nationales (blocs proches de la vue), au-dessus du territoire, dans tous les modes. */
  borders: BorderBlocks | null
  /** Position de chaque pays vis-à-vis du joueur (couleurs). */
  stances: Map<string, Stance>
  selection: Set<number>
  selectedArmy: ArmyState | null
  /** Premier point posé d'un tracé en cours (front ou offensive). */
  pendingPoint: LonLat | null
  /** Trait en cours de tracé (mission « Avancer », ou ligne de repli si `pendingRetreat`). */
  pendingLine: LonLat[]
  pendingRetreat?: boolean
  /** Frontières tenues (phase G2) : portion de l'armée sélectionnée, des autres pendant la peinture. */
  armyBorders?: BorderShapes | null
  /**
   * Aperçu de la mission choisie dans la fiche de l'armée, avant validation : postes des unités de ligne,
   * lignes en retrait (seconde ligne, réserve), points clés ; pendant la visée, axe de percée ou anneau
   * d'encerclement.
   */
  preview?: MissionPreviewShapes | null
  /** Zoom de la carte : sert à regrouper les pions qui se chevauchent à l'écran. */
  zoom: number
  selectedCity: string | null
  /**
   * Vue « Production » (onglet ouvert) : casernes occupées par ville du joueur.
   * Les villes du joueur affichent alors leurs casernes (occupées/total) et leurs fortifications.
   */
  production: Map<string, number> | null
  /** Construire « quoi, puis où » : villes conseillées pour le bâtiment choisi, dans l'ordre. */
  buildAdvice?: Array<{ city: string; lon: number; lat: number }> | null
  /** Vue « Production » : usines du joueur à leur emplacement. */
  factories?: FactorySite[] | null
  /** Emplacement choisi pour une nouvelle usine, en attente de validation. */
  factorySpot?: LonLat | null
  /**
   * Mode « Logistique » : état du ravitaillement (calque en tuiles et vue du Worker).
   * Affiche aussi la portée des sources, des unités logistiques et des QG du joueur.
   */
  logistics: { tiles: TerritoryTile[]; roads: TerritoryTile[]; view: SupplyView | null } | null
  /** Batailles en cours (icône cliquable). */
  battles: Array<{ key: string; ids: number[]; at: LonLat; mine: boolean }>
  /** Transports stratégiques du joueur affichés (bouton « En route ») : trajets et position. */
  transports?: TransportRoute[] | null
}

/** Icône de bataille : deux sabres croisés sur un disque. */
/** Jauges d'un pion (moyennes pour une pile ou une formation). */
interface PawnGauges {
  lon: number
  lat: number
  shape: GaugeShape
  /** Brigade et formation : effectifs, matériel, organisation ; pile : effectifs, organisation. */
  values: number[]
  routed: boolean
}

function pawnGauges(m: MapUnit): PawnGauges {
  if (!isStack(m)) {
    return {
      lon: m.lon,
      lat: m.lat,
      shape: 'unit',
      values: [m.strength, m.equipment, m.org],
      routed: m.routed,
    }
  }
  let strength = 0
  let equipment = 0
  let org = 0
  for (const u of m.units) {
    strength += u.strength
    equipment += u.equipment
    org += u.org
  }
  const n = Math.max(1, m.units.length)
  return m.formation
    ? {
        lon: m.lon,
        lat: m.lat,
        shape: 'formation',
        values: [strength / n, equipment / n, org / n],
        routed: false,
      }
    : { lon: m.lon, lat: m.lat, shape: 'stack', values: [strength / n, org / n], routed: false }
}

function battleIcon(mine: boolean): { url: string; width: number; height: number; id: string } {
  const fill = mine ? '#b91c1c' : '#57534e'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="29" fill="${fill}" stroke="#fff" stroke-width="4"/><g stroke="#fff" stroke-width="6" stroke-linecap="round"><path d="M18 18 L46 46"/><path d="M46 18 L18 46"/></g><g stroke="#fff" stroke-width="4" stroke-linecap="round"><path d="M14 40 L24 50"/><path d="M50 40 L40 50"/></g></svg>`
  return {
    id: mine ? 'battle-mine' : 'battle-other',
    url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    width: 64,
    height: 64,
  }
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

/**
 * Données binaires d'un bloc de segments, gardées par bloc : un même objet d'un rendu à l'autre évite
 * à deck.gl de renvoyer les segments au GPU à chaque image.
 */
type LineData = { length: number; attributes: Record<string, BinaryAttribute> }
const lineDataCache = new WeakMap<LineBlock, LineData>()
function lineData(lines: LineBlock): LineData {
  const cached = lineDataCache.get(lines)
  if (cached) return cached
  const data: LineData = {
    length: lines.length,
    attributes: {
      getSourcePosition: { value: lines.positions, size: 2, stride: 16, offset: 0 },
      getTargetPosition: { value: lines.positions, size: 2, stride: 16, offset: 8 },
      ...(lines.colors ? { getColor: { value: lines.colors, size: 4, type: 'unorm8' } } : {}),
    },
  }
  lineDataCache.set(lines, data)
  return data
}

/**
 * Mode « Logistique » (sous les pions) : zones ravitaillées, coupées et poches, portée des sources de ravitaillement
 * (capitale, grandes villes, dépôts), des unités logistiques et des QG du joueur.
 */
function logisticsLayers(
  logistics: NonNullable<LayerInput['logistics']>,
  snapshot: SimSnapshot,
): Layer[] {
  const { tiles, roads, view } = logistics
  const bitmap = (prefix: string, t: TerritoryTile): Layer =>
    new BitmapLayer({
      id: `${prefix}-${t.id}`,
      image: t.canvas,
      bounds: t.bounds,
      _imageCoordinateSystem: COORDINATE_SYSTEM.LNGLAT,
      textureParameters: { minFilter: 'nearest', magFilter: 'nearest' },
    })
  // Routes et voies ferrées au-dessus des zones de ravitaillement, sous les portées et les pions.
  const layers: Layer[] = [
    ...tiles.map((t) => bitmap('supply', t)),
    ...roads.map((t) => bitmap('roads', t)),
  ]
  const mine = snapshot.units.filter((u) => u.owner === snapshot.playerCountry)
  const range = (u: UnitSnapshot, key: 'supplyRadiusKm' | 'commandRadiusKm'): number =>
    MODERN_CATALOG[u.kind][key]
  if (view) {
    layers.push(
      new ScatterplotLayer<LonLat>({
        id: 'supply-sources',
        data: view.sources,
        getPosition: (p) => p,
        getRadius: view.sourceRadiusKm * 1000,
        radiusUnits: 'meters',
        filled: true,
        getFillColor: [22, 163, 74, 45],
        stroked: true,
        getLineColor: [21, 128, 61, 230],
        lineWidthMinPixels: 2,
      }),
    )
  }
  layers.push(
    // Unités logistiques : rayon où elles prolongent le ravitaillement (grisé si elles sont coupées).
    new ScatterplotLayer<UnitSnapshot>({
      id: 'supply-units',
      data: mine.filter((u) => range(u, 'supplyRadiusKm') > 0),
      getPosition: (u) => [u.lon, u.lat],
      getRadius: (u) => range(u, 'supplyRadiusKm') * 1000,
      radiusUnits: 'meters',
      filled: true,
      getFillColor: (u) => (u.supplied ? [59, 130, 246, 40] : [120, 120, 120, 30]),
      stroked: true,
      getLineColor: (u) => (u.supplied ? [37, 99, 235, 220] : [100, 100, 100, 200]),
      lineWidthMinPixels: 1.5,
      updateTriggers: { getFillColor: snapshot.tick, getLineColor: snapshot.tick },
    }),
    // QG : rayon de commandement (+15 % au combat, récupération plus rapide).
    new ScatterplotLayer<UnitSnapshot>({
      id: 'supply-command',
      data: mine.filter((u) => range(u, 'commandRadiusKm') > 0),
      getPosition: (u) => [u.lon, u.lat],
      getRadius: (u) => range(u, 'commandRadiusKm') * 1000,
      radiusUnits: 'meters',
      filled: false,
      stroked: true,
      getLineColor: [202, 138, 4, 200],
      lineWidthMinPixels: 1.5,
    }),
  )
  return layers
}

/** Étiquettes des poches du mode « Logistique », au-dessus des pions. */
function pocketLabels(view: SupplyView | null): Layer[] {
  if (!view?.pockets.length) return []
  return [
    new TextLayer<SupplyPocket>({
      id: 'supply-pockets',
      data: view.pockets,
      getPosition: (p) => p.at,
      getText: (p) =>
        p.units > 0 ? `Poche · ${p.units} unité${p.units > 1 ? 's' : ''}` : 'Poche sans défenseur',
      getSize: 12,
      // Sous le pion qui occupe souvent le centre de la poche.
      getPixelOffset: [0, 24],
      getColor: [127, 29, 29, 255],
      fontWeight: 700,
      outlineWidth: 3,
      outlineColor: [255, 255, 255, 230],
      fontSettings: { sdf: true },
      characterSet: 'auto',
    }),
  ]
}

export function buildLayers(input: LayerInput): Layer[] {
  const { snapshot, selection, selectedArmy, pendingPoint, pendingLine } = input
  if (!snapshot) return []
  const colors = new Map<string, Rgb>(
    snapshot.countries.map((c) => [
      c.id,
      stanceColor(input.stances.get(c.id) ?? 'neutral', c.color),
    ]),
  )
  const colorOf = (id: string | null): Rgb => (id ? colors.get(id) : undefined) ?? [140, 140, 140]
  const selectedUnits = snapshot.units.filter((u) => selection.has(u.id))
  const shown = visibleCities(snapshot, input.zoom)
  // Points et noms : les petites villes dont le nom chevaucherait un autre sont masquées ; les
  // fortifications et dépôts restent signalés sur toutes les villes affichées.
  const cities = declutterCities(shown, input.zoom, input.selectedCity)
  const capitals = cities.filter((c) => c.capital)
  const starSize = CAPITAL_STAR_SIZE * zoomScale(input.zoom)
  const layers: Layer[] = []

  // Relief, réseau de transport puis territoire : relief et territoire en tuiles reprojetées de
  // lon/lat vers Web Mercator, réseau en segments. Une couche invisible (réseau de loin) n'est pas créée.
  const bitmaps = (prefix: string, tiles: TerritoryTile[]): void => {
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
  bitmaps('terrain', input.terrain)
  const roads = input.roads
  if (roads) {
    for (const [set, blocks, opacity] of [
      ['minor', roads.minor, roads.minorOpacity],
      ['main', roads.main, roads.mainOpacity],
    ] as const) {
      if (opacity <= 0) continue
      for (const lines of blocks) {
        layers.push(
          new LineLayer({
            id: `roads-${lines.id}`,
            data: lineData(lines),
            getWidth: BASE_ROAD_WIDTH[set],
            widthUnits: 'pixels',
            opacity,
          }),
        )
      }
    }
  }
  bitmaps('territory', input.territory)
  // Frontières nationales : trait fin, plus épais entre pays en guerre.
  for (const kind of ['peace', 'war'] as const) {
    const style = BORDER_STYLE[kind]
    for (const lines of input.borders?.[kind] ?? []) {
      layers.push(
        new LineLayer({
          id: lines.id,
          data: lineData(lines),
          getColor: style.color,
          getWidth: style.width,
          widthUnits: 'pixels',
        }),
      )
    }
  }

  if (input.logistics) layers.push(...logisticsLayers(input.logistics, snapshot))
  layers.push(...fortRangeLayers(input, snapshot))

  layers.push(
    // Fortifications : anneau gris d'autant plus épais que le niveau est élevé.
    new ScatterplotLayer<CityState>({
      id: 'city-forts',
      data: shown.filter((c) => c.buildings.fort > 0),
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
      data: shown.filter((c) => c.buildings.depot > 0),
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
      data: cities.filter((c) => !c.capital),
      getPosition: (c) => [c.lon, c.lat],
      getFillColor: (c) => [...colorOf(c.owner), 255],
      getLineColor: (c) =>
        c.name === input.selectedCity ? [250, 204, 21, 255] : [20, 24, 31, 255],
      getLineWidth: (c) => (c.name === input.selectedCity ? 3 : 1.2),
      lineWidthUnits: 'pixels',
      stroked: true,
      radiusUnits: 'pixels',
      getRadius: (c) => CITY_DOT_RADIUS[cityTier(c.pop)],
      pickable: true,
      updateTriggers: {
        getFillColor: [snapshot.cities.map((c) => c.owner).join(), input.stances],
        getLineColor: input.selectedCity,
        getLineWidth: input.selectedCity,
      },
    }),
    // Capitales : étoile sombre (contour, jaune si sélectionnée) sous une étoile à la couleur du pays.
    new IconLayer<CityState>({
      id: 'capital-stars-outline',
      data: capitals,
      getPosition: (c) => [c.lon, c.lat],
      getIcon: () => STAR_ICON,
      getSize: (c) => starSize + (c.name === input.selectedCity ? 7 : 4),
      sizeUnits: 'pixels',
      getColor: (c) => (c.name === input.selectedCity ? [250, 204, 21, 255] : [20, 24, 31, 255]),
      updateTriggers: { getSize: [input.selectedCity, starSize], getColor: input.selectedCity },
    }),
    new IconLayer<CityState>({
      id: 'capital-stars',
      data: capitals,
      getPosition: (c) => [c.lon, c.lat],
      getIcon: () => STAR_ICON,
      getSize: starSize,
      sizeUnits: 'pixels',
      getColor: (c) => [...colorOf(c.owner), 255],
      pickable: true,
      updateTriggers: {
        getColor: [snapshot.cities.map((c) => c.owner).join(), input.stances],
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
    const free = (c: CityState): number =>
      formationSlots(c.buildings.barracks) - (busy.get(c.name) ?? 0)
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
            parts.push(
              `Formations ${busy.get(c.name) ?? 0}/${formationSlots(c.buildings.barracks)}`,
            )
          }
          if (c.buildings.fort > 0) {
            parts.push(`Fort ${c.buildings.fort} (${fortBonusLabel(c.buildings.fort)})`)
          }
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

  // Aviation provisoire : zones de mission du joueur (couleur de la mission) et zones ennemies (grises).
  const air = input.snapshot?.air
  if (air && (air.zones.length > 0 || air.enemyZones.length > 0)) {
    const rgb = (hex: string): [number, number, number] => [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ]
    const zones = [
      ...air.zones.map((z) => ({ z, color: rgb(AIR_COLORS[z.mission]) })),
      ...air.enemyZones.map((z) => ({ z, color: [71, 85, 105] as [number, number, number] })),
    ]
    layers.push(
      new ScatterplotLayer<(typeof zones)[number]>({
        id: 'air-zones',
        data: zones,
        getPosition: (a) => a.z.center,
        filled: true,
        getFillColor: (a) => [...a.color, 30],
        stroked: true,
        getLineColor: (a) => [...a.color, 200],
        getLineWidth: 2,
        lineWidthUnits: 'pixels',
        radiusUnits: 'meters',
        getRadius: AIR_ZONE_KM * 1000,
        updateTriggers: {
          getPosition: zones.map((a) => a.z.id).join(),
          getFillColor: zones.map((a) => a.z.mission).join(),
          getLineColor: zones.map((a) => a.z.mission).join(),
        },
      }),
    )
  }

  // Usines du joueur : carré bleu acier (civile) ou brun rouge (militaire), pâle si endommagée.
  if (input.factories?.length) {
    const sites = input.factories
    layers.push(
      new ScatterplotLayer<FactorySite>({
        id: 'factories',
        data: sites,
        getPosition: (f) => [f.lon, f.lat],
        filled: true,
        getFillColor: (f) =>
          f.kind === 'mil'
            ? [153, 27, 27, Math.round(110 + 145 * f.condition)]
            : [51, 85, 130, Math.round(110 + 145 * f.condition)],
        stroked: true,
        getLineColor: [255, 255, 255, 220],
        getLineWidth: 1.2,
        lineWidthUnits: 'pixels',
        radiusUnits: 'pixels',
        getRadius: 4.5,
        updateTriggers: {
          getFillColor: sites.map((f) => f.condition).join(),
        },
      }),
    )
  }
  if (input.factorySpot) {
    layers.push(
      new ScatterplotLayer<LonLat>({
        id: 'factory-spot',
        data: [input.factorySpot],
        getPosition: (p) => p,
        filled: true,
        getFillColor: [249, 115, 22, 70],
        stroked: true,
        getLineColor: [249, 115, 22, 255],
        getLineWidth: 3,
        lineWidthUnits: 'pixels',
        radiusUnits: 'pixels',
        getRadius: 12,
        updateTriggers: { getPosition: input.factorySpot.join() },
      }),
    )
  }

  // Villes conseillées pour le bâtiment choisi : anneau orange et rang.
  if (input.buildAdvice?.length) {
    const advice = input.buildAdvice.map((a, k) => ({ ...a, rank: k + 1 }))
    const key = advice.map((a) => a.city).join()
    layers.push(
      new ScatterplotLayer<(typeof advice)[number]>({
        id: 'build-advice',
        data: advice,
        getPosition: (a) => [a.lon, a.lat],
        filled: true,
        getFillColor: [249, 115, 22, 40],
        stroked: true,
        getLineColor: [249, 115, 22, 255],
        getLineWidth: 3,
        lineWidthUnits: 'pixels',
        radiusUnits: 'pixels',
        getRadius: 20,
        updateTriggers: { getPosition: key },
      }),
      new TextLayer<(typeof advice)[number]>({
        id: 'build-advice-rank',
        data: advice,
        getPosition: (a) => [a.lon, a.lat],
        getText: (a) => String(a.rank),
        getColor: [255, 255, 255, 255],
        getSize: 13,
        getPixelOffset: [16, -16],
        fontWeight: 700,
        outlineWidth: 3,
        outlineColor: [194, 65, 12, 255],
        fontSettings: { sdf: true },
        characterSet: '123',
        updateTriggers: { getPosition: key },
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

  // Transports stratégiques en cours : partie faite en trait plein, reste en trait pâle, arrivée
  // cerclée, convoi à sa position actuelle avec le nombre d'unités.
  const transports = input.transports ?? []
  if (transports.length > 0) {
    const rgb = (r: TransportRoute): Rgb => TRANSPORT_COLORS[r.mode]
    layers.push(
      new LineLayer<TransportRoute>({
        id: 'transport-left',
        data: transports,
        getSourcePosition: (r) => r.at,
        getTargetPosition: (r) => r.to,
        getColor: (r) => [...rgb(r), 110],
        getWidth: 3,
        widthUnits: 'pixels',
      }),
      new LineLayer<TransportRoute>({
        id: 'transport-done',
        data: transports,
        getSourcePosition: (r) => r.from,
        getTargetPosition: (r) => r.at,
        getColor: (r) => [...rgb(r), 240],
        getWidth: 4,
        widthUnits: 'pixels',
      }),
      new ScatterplotLayer<TransportRoute>({
        id: 'transport-dest',
        data: transports,
        getPosition: (r) => r.to,
        getFillColor: (r) => [...rgb(r), 60],
        getLineColor: (r) => [...rgb(r), 255],
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 2,
        radiusUnits: 'pixels',
        getRadius: 9,
      }),
      new ScatterplotLayer<TransportRoute>({
        id: 'transport-convoy',
        data: transports,
        getPosition: (r) => r.at,
        getFillColor: (r) => [...rgb(r), 255],
        getLineColor: [20, 24, 31, 255],
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 2,
        radiusUnits: 'pixels',
        getRadius: 10,
      }),
      new TextLayer<TransportRoute>({
        id: 'transport-count',
        data: transports,
        getPosition: (r) => r.at,
        getText: (r) => String(r.count),
        getColor: [20, 24, 31, 255],
        getSize: 12,
        fontWeight: 700,
        fontFamily: 'system-ui, sans-serif',
      }),
    )
  }

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

  // Frontière tenue par l'armée sélectionnée (jaune), par ses autres armées pendant la peinture (gris),
  // et portion en cours de peinture : cellules colorées, pas un simple trait.
  const borderSets = input.armyBorders
  if (borderSets) {
    for (const [id, data, color] of [
      ['army-border-others', borderSets.others, [148, 163, 184, 120]],
      ['army-border', borderSets.held, [250, 204, 21, 140]],
      ['army-border-paint', borderSets.painting, [250, 204, 21, 220]],
    ] as const) {
      if (data.length === 0) continue
      layers.push(
        new PolygonLayer({
          id,
          data,
          getPolygon: (p: LonLat[]) => p,
          getFillColor: [...color],
          stroked: false,
        }),
      )
    }
  }
  // Front et offensive de l'armée sélectionnée.
  // Front tenu par l'armée sélectionnée : le tracé réel, à défaut les deux extrémités.
  const frontLines = selectedArmy?.frontLine?.length
    ? selectedArmy.frontLine
    : selectedArmy?.front
      ? [selectedArmy.front]
      : []
  if (frontLines.length) {
    layers.push(
      new PathLayer({
        id: 'army-front',
        data: frontLines,
        getPath: (f: LonLat[]) => f,
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
  // Mission « Tenir les points clés » de l'armée sélectionnée : points clés tenus, en orange.
  const keyPoints =
    selectedArmy?.mission?.kind === 'keyPoints' ? (selectedArmy.keyPoints ?? []) : []
  if (keyPoints.length > 0) {
    layers.push(
      new ScatterplotLayer({
        id: 'key-points',
        data: keyPoints,
        getPosition: (p: LonLat) => p,
        getFillColor: [251, 146, 60, 120],
        getLineColor: [251, 146, 60, 255],
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 2,
        radiusUnits: 'pixels',
        getRadius: 7,
      }),
    )
  }
  // Missions « Avancer » de l'armée sélectionnée et des armées des unités choisies : tracé visé en bleu
  // clair, objectif marqué.
  const missions = snapshot.armies
    .filter((a) => a.id === selectedArmy?.id || a.unitIds.some((id) => selection.has(id)))
    .map((a) => (a.mission?.kind === 'advance' ? a.mission : null))
    .filter((m) => m !== null)
  // Retraite ordonnée de l'armée sélectionnée : ligne de repli en orange pâle.
  const retreats = snapshot.armies
    .filter((a) => a.id === selectedArmy?.id)
    .map((a) => (a.mission?.kind === 'retreat' ? a.mission : null))
    .filter((m) => m !== null)
  if (retreats.length > 0) {
    layers.push(
      new PathLayer({
        id: 'retreat-line',
        data: retreats.flatMap((m) => m.line),
        getPath: (p: LonLat[]) => p,
        getColor: [253, 186, 116, 230],
        getWidth: 5,
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
      }),
    )
  }
  // Percées de l'armée sélectionnée : axe du départ au point visé, partie conquise plus épaisse.
  const breaches = snapshot.armies
    .filter((a) => a.id === selectedArmy?.id)
    .map((a) => (a.mission?.kind === 'breach' ? a.mission : null))
    .filter((m) => m !== null)
  if (breaches.length > 0) {
    layers.push(
      new PathLayer({
        id: 'breach-axis',
        data: breaches.flatMap((m) => [
          { path: [m.origin, m.target], width: 3 },
          { path: [m.origin, m.tip], width: 7 },
        ]),
        getPath: (d: { path: LonLat[] }) => d.path,
        getColor: [244, 63, 94, 220],
        getWidth: (d: { width: number }) => d.width,
        widthUnits: 'pixels',
        capRounded: true,
      }),
      new ScatterplotLayer({
        id: 'breach-target',
        data: breaches.map((m) => m.target),
        getPosition: (p: LonLat) => p,
        getFillColor: [244, 63, 94, 90],
        getLineColor: [244, 63, 94, 255],
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 3,
        radiusUnits: 'pixels',
        getRadius: 12,
      }),
    )
  }
  if (missions.length > 0) {
    layers.push(
      new PathLayer({
        id: 'mission-line',
        data: missions.flatMap((m) => m.line),
        getPath: (p: LonLat[]) => p,
        getColor: [56, 189, 248, 230],
        getWidth: 5,
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
      }),
      new ScatterplotLayer({
        id: 'mission-objective',
        data: missions.flatMap((m) => (m.goal.kind === 'objective' ? [m.goal.point] : [])),
        getPosition: (p: LonLat) => p,
        getFillColor: [56, 189, 248, 90],
        getLineColor: [56, 189, 248, 255],
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 3,
        radiusUnits: 'pixels',
        getRadius: 12,
      }),
    )
  }
  const preview = input.preview
  if (preview) {
    const blue: [number, number, number, number] = [76, 141, 255, 220]
    if (preview.lines.length > 0) {
      layers.push(
        new PathLayer({
          id: 'preview-lines',
          data: preview.lines,
          getPath: (p: LonLat[]) => p,
          getColor: blue,
          getWidth: 3,
          widthUnits: 'pixels',
          capRounded: true,
          jointRounded: true,
        }),
      )
    }
    if (preview.ring) {
      layers.push(
        new PathLayer({
          id: 'preview-ring',
          data: [preview.ring],
          getPath: (p: LonLat[]) => p,
          getColor: [242, 163, 58, 230],
          getWidth: 4,
          widthUnits: 'pixels',
          jointRounded: true,
        }),
      )
    }
    if (preview.axis) {
      const [from, to] = preview.axis
      layers.push(
        new PathLayer({
          id: 'preview-axis',
          data: [preview.axis],
          getPath: (p: LonLat[]) => p,
          getColor: [244, 63, 94, 200],
          getWidth: 4,
          widthUnits: 'pixels',
          capRounded: true,
        }),
        new PolygonLayer({
          id: 'preview-axis-head',
          data: [arrowHead(from, to, 0.08)],
          getPolygon: (p: LonLat[]) => p,
          getFillColor: [244, 63, 94, 220],
          stroked: false,
        }),
      )
    }
    if (preview.points.length > 0) {
      layers.push(
        new ScatterplotLayer({
          id: 'preview-points',
          data: preview.points,
          getPosition: (p: LonLat) => p,
          getFillColor: [251, 146, 60, 90],
          getLineColor: [251, 146, 60, 255],
          stroked: true,
          lineWidthUnits: 'pixels',
          getLineWidth: 2,
          radiusUnits: 'pixels',
          getRadius: 7,
        }),
      )
    }
    if (preview.posts.length > 0) {
      layers.push(
        new ScatterplotLayer({
          id: 'preview-posts',
          data: preview.posts,
          getPosition: (p: LonLat) => p,
          getFillColor: [76, 141, 255, 70],
          getLineColor: blue,
          stroked: true,
          lineWidthUnits: 'pixels',
          getLineWidth: 2,
          radiusUnits: 'pixels',
          getRadius: 5,
        }),
      )
    }
  }
  if (pendingLine.length > 0) {
    const lineColor: [number, number, number, number] = input.pendingRetreat
      ? [253, 186, 116, 220]
      : [56, 189, 248, 200]
    layers.push(
      new PathLayer({
        id: 'pending-line',
        data: [pendingLine],
        getPath: (p: LonLat[]) => p,
        getColor: lineColor,
        getWidth: 4,
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
      }),
      new ScatterplotLayer({
        id: 'pending-line-points',
        data:
          pendingLine.length > 40
            ? [pendingLine[0], pendingLine[pendingLine.length - 1]]
            : pendingLine,
        getPosition: (p: LonLat) => p,
        getFillColor: lineColor,
        radiusUnits: 'pixels',
        getRadius: 5,
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
  // Divisions et corps : un pion par formation quand le zoom réunit ses brigades.
  const formations = new Map(snapshot.formations.map((f) => [f.id, f]))
  for (const [id, list, size, opacity] of [
    ['units-neutral', neutral, 24, 0.75],
    ['units', involved, 34, 1],
  ] as const) {
    const pawns = stackUnits(formationPawns(list, formations, input.zoom), input.zoom, size + 4)
    const pawnSize = (m: MapUnit): number =>
      isStack(m) && m.formation ? size * FORMATION_ICON_SCALE : size
    layers.push(
      new IconLayer<MapUnit>({
        id,
        data: pawns,
        getPosition: (m) => [m.lon, m.lat],
        getIcon: (m) =>
          isStack(m)
            ? m.formation
              ? formationIcon(
                  m.units,
                  m.formation.kind,
                  colorOf(m.owner),
                  m.units.some((u) => selection.has(u.id)),
                )
              : stackIcon(
                  m.units,
                  colorOf(m.owner),
                  m.units.some((u) => selection.has(u.id)),
                )
            : unitIcon(m, colorOf(m.owner), selection.has(m.id)),
        // Pion de formation plus haut (marque d'échelon) : même taille de cadre qu'une brigade.
        getSize: pawnSize,
        sizeUnits: 'pixels',
        opacity,
        pickable: true,
        updateTriggers: { getIcon: [[...selection].join(), input.stances] },
      }),
    )
    // Jauges sous le cadre : une couche par jauge, superposée au pion (voir gaugeIcon).
    const gauges = pawns.map(pawnGauges)
    for (const row of [0, 1, 2] as const) {
      layers.push(
        new IconLayer<PawnGauges>({
          id: `gauges-${id}-${row}`,
          // Les piles n'ont que deux jauges.
          data: row === 2 ? gauges.filter((g) => g.shape !== 'stack') : gauges,
          getPosition: (g) => [g.lon, g.lat],
          getIcon: (g) => gaugeIcon(g.shape, row, g.values[row] ?? 0, g.routed),
          getSize: (g) => (g.shape === 'formation' ? size * FORMATION_ICON_SCALE : size),
          sizeUnits: 'pixels',
          opacity,
          pickable: false,
        }),
      )
    }
  }
  // Batailles : icône au-dessus des pions, clic pour le détail.
  layers.push(
    new IconLayer<{ key: string; ids: number[]; at: LonLat; mine: boolean }>({
      id: 'battles',
      data: input.battles,
      getPosition: (b) => b.at,
      getIcon: (b) => battleIcon(b.mine),
      getSize: 22,
      sizeUnits: 'pixels',
      getPixelOffset: [0, -26],
      pickable: true,
    }),
  )
  // Noms des villes au-dessus des pions, pour rester lisibles.
  layers.push(
    ...(['names', 'capital-names'] as const).map(
      (kind) =>
        new TextLayer<CityState>({
          id: `city-${kind}`,
          data: cities.filter((c) => c.capital === (kind === 'capital-names')),
          getPosition: (c) => [c.lon, c.lat],
          getText: (c) => c.name,
          getSize: (c) => cityNameSize(c, input.zoom),
          getColor: [246, 244, 236, 255],
          getPixelOffset: (c) => [0, cityNameOffset(c, input.zoom)],
          fontFamily: 'Barlow, "Helvetica Neue", Arial, sans-serif',
          fontWeight: kind === 'capital-names' ? 700 : 500,
          // Halo sombre : lisible sur la mer, le relief comme sur toutes les couleurs de territoire.
          outlineWidth: 4,
          outlineColor: [14, 17, 23, 235],
          fontSettings: { sdf: true, buffer: 8, radius: 14 },
          characterSet: 'auto',
          updateTriggers: { getSize: input.zoom, getPixelOffset: input.zoom },
        }),
    ),
  )
  if (input.logistics) layers.push(...pocketLabels(input.logistics.view))
  return layers
}

/**
 * Portée des fortifications : disque de FORT_RADIUS_KM autour des villes fortifiées, avec leur
 * bonus de défense. Toujours pour la ville sélectionnée ; pour toutes les villes fortifiées en vue
 * « Production » (celles du joueur) et en mode « Logistique » (toutes).
 */
function fortRangeCities(input: LayerInput, snapshot: SimSnapshot): CityState[] {
  const all = input.logistics !== null
  const mine = input.production !== null
  return snapshot.cities.filter(
    (c) =>
      c.buildings.fort > 0 &&
      (c.name === input.selectedCity || all || (mine && c.owner === snapshot.playerCountry)),
  )
}

function fortRangeLayers(input: LayerInput, snapshot: SimSnapshot): Layer[] {
  const data = fortRangeCities(input, snapshot)
  if (data.length === 0) return []
  const own = (c: CityState): boolean => c.owner === snapshot.playerCountry
  const key = data.map((c) => `${c.name}:${c.buildings.fort}:${c.owner}`).join()
  const layers: Layer[] = [
    new ScatterplotLayer<CityState>({
      id: 'fort-ranges',
      data,
      getPosition: (c) => [c.lon, c.lat],
      radiusUnits: 'meters',
      getRadius: FORT_RADIUS_KM * 1000,
      filled: true,
      stroked: true,
      // Plus opaque avec le niveau ; bleu ardoise pour le joueur, brun pour les autres pays.
      getFillColor: (c) =>
        own(c)
          ? [71, 85, 105, 25 + 15 * c.buildings.fort]
          : [120, 72, 40, 25 + 15 * c.buildings.fort],
      getLineColor: (c) => (own(c) ? [51, 65, 85, 220] : [120, 53, 15, 220]),
      getLineWidth: 1.5,
      lineWidthUnits: 'pixels',
      updateTriggers: { getFillColor: key, getLineColor: key },
    }),
  ]
  // Bonus écrit sous le disque, sauf en vue « Production » où l'étiquette de la ville le donne.
  if (!input.production) {
    layers.push(
      new TextLayer<CityState>({
        id: 'fort-range-labels',
        data,
        getPosition: (c) => [c.lon, c.lat - FORT_RADIUS_KM / 111],
        getText: (c) => fortBonusLabel(c.buildings.fort),
        getColor: (c) => (own(c) ? [30, 41, 59, 255] : [120, 53, 15, 255]),
        getSize: 11,
        getPixelOffset: [0, 8],
        fontWeight: 700,
        outlineWidth: 3,
        outlineColor: [255, 255, 255, 230],
        fontSettings: { sdf: true },
        characterSet: 'auto',
        updateTriggers: { getText: key, getColor: key },
      }),
    )
  }
  return layers
}
