import { ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import type { Layer } from '@deck.gl/core'
import type { SimSnapshot, UnitKind, UnitSnapshot } from '@/sim/core/types'

const KIND_LABEL: Record<UnitKind, string> = {
  inf: 'INF',
  mech: 'MEC',
  tank: 'BLD',
  art: 'ART',
  log: 'LOG',
  hq: 'QG',
}

/** Couches deck.gl des unités. Placeholder du Jalon 0 : pions ronds, les symboles OTAN viendront au Jalon 1. */
export function unitLayers(snapshot: SimSnapshot | null): Layer[] {
  if (!snapshot) return []
  const colors = new Map(snapshot.countries.map((c) => [c.id, c.color]))
  const colorOf = (u: UnitSnapshot): [number, number, number] =>
    colors.get(u.owner) ?? [120, 120, 120]

  return [
    new ScatterplotLayer<UnitSnapshot>({
      id: 'units',
      data: snapshot.units,
      getPosition: (u) => [u.lon, u.lat],
      getFillColor: (u) => [...colorOf(u), 230],
      getLineColor: [255, 255, 255, 255],
      lineWidthMinPixels: 1.5,
      stroked: true,
      radiusUnits: 'pixels',
      getRadius: (u) => 9 + 5 * u.strength,
      pickable: true,
    }),
    new TextLayer<UnitSnapshot>({
      id: 'unit-labels',
      data: snapshot.units,
      getPosition: (u) => [u.lon, u.lat],
      getText: (u) => KIND_LABEL[u.kind],
      getSize: 10,
      getColor: [255, 255, 255, 255],
      fontWeight: 700,
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
    }),
  ]
}
