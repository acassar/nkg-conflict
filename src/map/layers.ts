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
import type { SupplyPocket, SupplyView } from '@/sim/systems/supplyView'

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
  /** Trait en cours de tracé (mission « Avancer »). */
  pendingLine: LonLat[]
  /** Zoom de la carte : sert à regrouper les pions qui se chevauchent à l'écran. */
  zoom: number
  selectedCity: string | null
  /**
   * Vue « Production » (onglet ouvert) : casernes occupées par ville du joueur.
   * Les villes du joueur affichent alors leurs casernes (occupées/total) et leurs fortifications.
   */
  production: Map<string, number> | null
  /**
   * Mode « Logistique » : état du ravitaillement (calque en tuiles et vue du Worker).
   * Affiche aussi la portée des sources, des unités logistiques et des QG du joueur.
   */
  logistics: { tiles: TerritoryTile[]; roads: TerritoryTile[]; view: SupplyView | null } | null
  /** Batailles en cours (icône cliquable). */
  battles: Array<{ key: string; ids: number[]; at: LonLat; mine: boolean }>
}

/** Icône de bataille : deux sabres croisés sur un disque. */
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

  if (input.logistics) layers.push(...logisticsLayers(input.logistics, snapshot))

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
  if (pendingLine.length > 0) {
    layers.push(
      new PathLayer({
        id: 'pending-line',
        data: [pendingLine],
        getPath: (p: LonLat[]) => p,
        getColor: [56, 189, 248, 200],
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
        getFillColor: [56, 189, 248, 255],
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
  if (input.logistics) layers.push(...pocketLabels(input.logistics.view))
  return layers
}
