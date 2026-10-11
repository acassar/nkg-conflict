import type { CountryId, FormationKind, FormationState, UnitSnapshot } from '@/sim/core/types'

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
  formation?: { id: number; kind: FormationKind; name: string }
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

/** Rayon, en pixels, dans lequel les brigades d'une formation sont réunies en un seul pion. */
export const FORMATION_RADIUS_PX = 60

/**
 * Pions de formation selon le zoom : les brigades d'un corps (au moins deux divisions) ou d'une division
 * qui tiennent dans un rayon de `radiusPx` autour de leur centre forment un seul pion. Un corps n'est
 * réuni qu'au zoom où toutes ses brigades proches tiennent dans ce rayon ; sinon ses divisions, sinon
 * les brigades une à une. Les brigades écartées (riposte, relève) restent des pions séparés.
 */
export function formationPawns(
  units: UnitSnapshot[],
  formations: ReadonlyMap<number, FormationState>,
  zoom: number,
  radiusPx = FORMATION_RADIUS_PX,
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
  const byCorps = new Map<number | null, number[]>()
  for (const id of byDivision.keys()) {
    const parent = formations.get(id)?.parentId ?? null
    const list = byCorps.get(parent)
    if (list) list.push(id)
    else byCorps.set(parent, [id])
  }
  const r2 = radiusPx * radiusPx
  /** Sépare les brigades proches du centre du groupe (en pixels) des écartées. */
  const split = (list: UnitSnapshot[]): { near: UnitSnapshot[]; far: UnitSnapshot[] } => {
    const pos = list.map((u) => toPixels(u.lon, u.lat, zoom))
    // Centre : moyenne, puis moyenne des seules brigades à moins de 2 rayons (une écartée ne le déplace pas).
    const mean = (pts: Array<[number, number]>): [number, number] => [
      pts.reduce((s, p) => s + p[0], 0) / Math.max(1, pts.length),
      pts.reduce((s, p) => s + p[1], 0) / Math.max(1, pts.length),
    ]
    let c = mean(pos)
    const core = pos.filter((p) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 <= 4 * r2)
    if (core.length > 0) c = mean(core)
    const near: UnitSnapshot[] = []
    const far: UnitSnapshot[] = []
    list.forEach((u, k) => {
      const p = pos[k] as [number, number]
      if ((p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 <= r2) near.push(u)
      else far.push(u)
    })
    return { near, far }
  }
  const pawn = (f: FormationState, list: UnitSnapshot[]): UnitStack => ({
    stack: true,
    key: `f${f.id}`,
    owner: f.owner,
    lon: list.reduce((s, u) => s + u.lon, 0) / list.length,
    lat: list.reduce((s, u) => s + u.lat, 0) / list.length,
    units: list,
    formation: { id: f.id, kind: f.kind, name: f.name },
  })
  for (const [corpsId, divisionIds] of byCorps) {
    const corps = corpsId === null ? undefined : formations.get(corpsId)
    if (corps && divisionIds.length >= 2) {
      const all = divisionIds.flatMap((id) => byDivision.get(id) ?? [])
      const { near, far } = split(all)
      const divisionsNear = new Set(near.map((u) => u.divisionId))
      // Corps réuni : toutes ses divisions (ou presque toutes ses brigades) dans le rayon.
      if (divisionsNear.size >= 2 && near.length >= 0.75 * all.length) {
        out.push(pawn(corps, near))
        out.push(...far)
        continue
      }
    }
    for (const id of divisionIds) {
      const list = byDivision.get(id) ?? []
      const f = formations.get(id)
      const { near, far } = split(list)
      if (!f || near.length < 2) {
        out.push(...list)
        continue
      }
      out.push(pawn(f, near))
      out.push(...far)
    }
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
