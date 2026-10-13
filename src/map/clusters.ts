import type {
  CountryId,
  FormationKind,
  FormationState,
  LonLat,
  UnitSnapshot,
} from '@/sim/core/types'
import { distanceKm } from '@/sim/theater/grid'

/**
 * Pions d'un même camp trop proches à l'écran, affichés comme une seule pile ; ou pion d'une formation
 * (division, corps) quand le zoom regroupe ses brigades (`formation`).
 */
export interface UnitStack {
  stack: true
  key: string
  owner: CountryId
  lon: number
  lat: number
  units: UnitSnapshot[]
  /** Pion de formation : division, corps ou armée (`id` d'armée pour une armée). */
  formation?: { id: number; kind: FormationKind | 'army'; name: string }
}

export type MapUnit = UnitSnapshot | UnitStack

export function isStack(item: MapUnit): item is UnitStack {
  return 'stack' in item
}

/** Position en pixels Web Mercator au niveau de zoom donné (tuiles de 512 px, comme MapLibre). */
export function toPixels(lon: number, lat: number, zoom: number): [number, number] {
  const scale = 512 * 2 ** zoom
  const sin = Math.sin((lat * Math.PI) / 180)
  return [
    ((lon + 180) / 360) * scale,
    (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  ]
}

/** Inverse de toPixels. */
export function fromPixels(x: number, y: number, zoom: number): LonLat {
  const scale = 512 * 2 ** zoom
  const lon = (x / scale) * 360 - 180
  const n = Math.PI - (2 * Math.PI * y) / scale
  return [lon, (180 / Math.PI) * Math.atan(Math.sinh(n))]
}

/** Position d'un pion ou d'une pile. */
function itemUnits(item: MapUnit): UnitSnapshot[] {
  return isStack(item) ? item.units : [item]
}

/**
 * Regroupe les pions (ou pions de formation) d'un même camp distants de moins de `radiusPx` à l'écran.
 * Deux pions de formation qui se chevauchent deviennent une pile ordinaire.
 * Regroupement glouton, suffisant pour quelques centaines d'unités.
 */
export function stackUnits(items: MapUnit[], zoom: number, radiusPx = 38): MapUnit[] {
  const pos = items.map((u) => toPixels(u.lon, u.lat, zoom))
  const used = new Uint8Array(items.length)
  const out: MapUnit[] = []
  const r2 = radiusPx * radiusPx

  for (let i = 0; i < items.length; i++) {
    if (used[i]) continue
    const u = items[i]
    const p = pos[i]
    if (!u || !p) continue
    used[i] = 1
    const group = [u]
    for (let j = i + 1; j < items.length; j++) {
      const v = items[j]
      const q = pos[j]
      if (used[j] || !v || !q || v.owner !== u.owner) continue
      const dx = q[0] - p[0]
      const dy = q[1] - p[1]
      if (dx * dx + dy * dy <= r2) {
        used[j] = 1
        group.push(v)
      }
    }
    if (group.length === 1) {
      out.push(u)
    } else {
      const units = group.flatMap(itemUnits)
      out.push({
        stack: true,
        key: units
          .map((g) => g.id)
          .sort((a, b) => a - b)
          .join('-'),
        owner: u.owner,
        lon: units.reduce((s, g) => s + g.lon, 0) / units.length,
        lat: units.reduce((s, g) => s + g.lat, 0) / units.length,
        units,
      })
    }
  }
  return out
}

/** Rayon, en pixels, dans lequel les pions d'un corps ou d'une armée sont réunis en un seul pion. */
export const FORMATION_RADIUS_PX = 60
/** Une brigade à plus de cette distance du centre de sa division (riposte, relève) a son propre pion. */
export const DETACHED_KM = 60

/**
 * Pions de formation selon le zoom (phase D3) : chaque division est un pion au centre de ses brigades
 * (les brigades écartées de plus de DETACHED_KM gardent le leur). Les divisions d'un corps sont réunies
 * en un pion de corps quand elles tiennent toutes dans un rayon de `radiusPx` à l'écran, puis les pions
 * d'une armée (`armies`) en un pion d'armée de la même façon : division de près, corps à zoom moyen,
 * armée de loin. Les brigades ne s'affichent une à une qu'à la sélection (brigadeSpots).
 */
export function formationPawns(
  units: UnitSnapshot[],
  formations: ReadonlyMap<number, FormationState>,
  zoom: number,
  radiusPx = FORMATION_RADIUS_PX,
  armies: ReadonlyMap<number, { name: string }> = new Map(),
): MapUnit[] {
  const out: MapUnit[] = []
  const byDivision = new Map<number, UnitSnapshot[]>()
  for (const u of units) {
    if (u.divisionId === null || !formations.has(u.divisionId)) out.push(u)
    else {
      const list = byDivision.get(u.divisionId)
      if (list) list.push(u)
      else byDivision.set(u.divisionId, [u])
    }
  }
  const pawn = (
    key: string,
    formation: NonNullable<UnitStack['formation']>,
    list: UnitSnapshot[],
  ): UnitStack => ({
    stack: true,
    key,
    owner: list[0]?.owner ?? '',
    lon: list.reduce((s, u) => s + u.lon, 0) / list.length,
    lat: list.reduce((s, u) => s + u.lat, 0) / list.length,
    units: list,
    formation,
  })
  /** Divisions : brigades proches du centre (en km), les écartées à part. */
  interface Pawn {
    stack: UnitStack
    armyId: number
  }
  const divisionPawns = new Map<number | null, Pawn[]>()
  for (const [id, list] of byDivision) {
    const f = formations.get(id) as FormationState
    // Centre : la brigade qui a le plus de voisines à moins de DETACHED_KM ; ses voisines forment le pion.
    const around = (u: UnitSnapshot): UnitSnapshot[] =>
      list.filter((v) => distanceKm(u.lon, u.lat, v.lon, v.lat) <= DETACHED_KM)
    let near: UnitSnapshot[] = []
    for (const u of list) {
      const n = around(u)
      if (n.length > near.length) near = n
    }
    out.push(...list.filter((u) => !near.includes(u)))
    if (near.length === 0) continue
    const p = {
      stack: pawn(`f${f.id}`, { id: f.id, kind: f.kind, name: f.name }, near),
      armyId: f.armyId,
    }
    const group = divisionPawns.get(f.parentId)
    if (group) group.push(p)
    else divisionPawns.set(f.parentId, [p])
  }
  const r2 = radiusPx * radiusPx
  /** Les pions tiennent tous dans le rayon autour de leur centre, à l'écran. */
  const fits = (list: Pawn[]): boolean => {
    const pos = list.map((p) => toPixels(p.stack.lon, p.stack.lat, zoom))
    const cx = pos.reduce((s, q) => s + q[0], 0) / pos.length
    const cy = pos.reduce((s, q) => s + q[1], 0) / pos.length
    return pos.every((q) => (q[0] - cx) ** 2 + (q[1] - cy) ** 2 <= r2)
  }
  // Corps : réunis quand toutes leurs divisions tiennent dans le rayon.
  const byArmy = new Map<number, Pawn[]>()
  const toArmy = (p: Pawn): void => {
    const list = byArmy.get(p.armyId)
    if (list) list.push(p)
    else byArmy.set(p.armyId, [p])
  }
  for (const [corpsId, list] of divisionPawns) {
    const corps = corpsId === null ? undefined : formations.get(corpsId)
    if (corps && list.length >= 2 && fits(list)) {
      toArmy({
        stack: pawn(
          `f${corps.id}`,
          { id: corps.id, kind: corps.kind, name: corps.name },
          list.flatMap((p) => p.stack.units),
        ),
        armyId: corps.armyId,
      })
    } else list.forEach(toArmy)
  }
  // Armées : réunies quand tous leurs pions de corps et de division tiennent dans le rayon.
  for (const [armyId, list] of byArmy) {
    const army = armies.get(armyId)
    if (army && list.length >= 2 && fits(list)) {
      out.push(
        pawn(
          `a${armyId}`,
          { id: armyId, kind: 'army', name: army.name },
          list.flatMap((p) => p.stack.units),
        ),
      )
    } else out.push(...list.map((p) => p.stack))
  }
  return out
}

/** Brigade affichée autour d'un pion de formation choisi, reliée à lui par un trait. */
export interface BrigadeSpot {
  unit: UnitSnapshot
  /** Position affichée : la sienne, ou autour du pion si elle se confond avec lui. */
  at: LonLat
  /** Centre du pion de formation. */
  from: LonLat
}

/** Écart minimal, en pixels, entre une brigade affichée et le pion de sa formation. */
export const SPOT_RING_PX = 36

/**
 * Brigades des pions de formation dont une brigade au moins est choisie : chacune à sa position, ou
 * en couronne autour du pion quand elle serait cachée dessous.
 */
export function brigadeSpots(
  pawns: ReadonlyArray<MapUnit>,
  zoom: number,
  selected: ReadonlySet<number>,
): BrigadeSpot[] {
  const out: BrigadeSpot[] = []
  for (const m of pawns) {
    if (!isStack(m) || !m.formation || !m.units.some((u) => selected.has(u.id))) continue
    const c = toPixels(m.lon, m.lat, zoom)
    const from: LonLat = [m.lon, m.lat]
    const hidden = m.units.filter((u) => {
      const p = toPixels(u.lon, u.lat, zoom)
      return (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 < SPOT_RING_PX * SPOT_RING_PX
    })
    for (const u of m.units) {
      const k = hidden.indexOf(u)
      if (k < 0) {
        out.push({ unit: u, at: [u.lon, u.lat], from })
        continue
      }
      const a = -Math.PI / 2 + (2 * Math.PI * k) / hidden.length
      out.push({
        unit: u,
        at: fromPixels(c[0] + SPOT_RING_PX * Math.cos(a), c[1] + SPOT_RING_PX * Math.sin(a), zoom),
        from,
      })
    }
  }
  return out
}

/**
 * Secteurs de front à tracer pour une sélection : celui de chaque division touchée, ou celui du corps
 * quand toutes ses divisions le sont.
 */
export function selectedSectors(
  units: ReadonlyArray<UnitSnapshot>,
  formations: ReadonlyArray<FormationState>,
  selected: ReadonlySet<number>,
): Array<{ id: number; kind: FormationKind; sector: LonLat[] }> {
  const touched = new Set<number>()
  for (const u of units) if (selected.has(u.id) && u.divisionId !== null) touched.add(u.divisionId)
  const byId = new Map(formations.map((f) => [f.id, f]))
  const out: Array<{ id: number; kind: FormationKind; sector: LonLat[] }> = []
  const corpsDone = new Set<number>()
  for (const id of touched) {
    const d = byId.get(id)
    if (!d) continue
    const corps = d.parentId !== null ? byId.get(d.parentId) : undefined
    if (corps) {
      const all = formations.filter((f) => f.parentId === corps.id)
      if (all.every((f) => touched.has(f.id))) {
        if (!corpsDone.has(corps.id) && corps.sector && corps.sector.length >= 2)
          out.push({ id: corps.id, kind: 'corps', sector: corps.sector })
        corpsDone.add(corps.id)
        continue
      }
    }
    if (d.sector && d.sector.length >= 2) out.push({ id: d.id, kind: 'division', sector: d.sector })
  }
  return out
}

/** Brigades d'une formation (division : les siennes ; corps : celles de ses divisions). */
export function formationMembers(
  units: ReadonlyArray<UnitSnapshot>,
  formations: ReadonlyArray<FormationState>,
  id: number,
): UnitSnapshot[] {
  const divisions = new Set(
    formations.filter((f) => f.id === id || f.parentId === id).map((f) => f.id),
  )
  return units.filter((u) => u.divisionId !== null && divisions.has(u.divisionId))
}
