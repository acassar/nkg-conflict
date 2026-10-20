import { MODERN_CATALOG } from '@/sim/units/catalog'
import type { FormationState, UnitKind, UnitSnapshot } from '@/sim/core/types'

/** Ligne de l'onglet « Composition » d'une armée : un type d'unité, son nombre et sa force moyenne. */
export interface CompositionRow {
  kind: UnitKind
  name: string
  count: number
  /** Effectifs moyens, 0 à 1. */
  strength: number
  /** Matériel moyen, 0 à 1. */
  equipment: number
  /** Organisation moyenne, 0 à 1. */
  org: number
}

/** Composition par type, dans l'ordre du catalogue ; les types absents sont omis. */
export function armyComposition(
  units: ReadonlyArray<Pick<UnitSnapshot, 'kind' | 'strength' | 'equipment' | 'org'>>,
): CompositionRow[] {
  const rows: CompositionRow[] = []
  for (const kind of Object.keys(MODERN_CATALOG) as UnitKind[]) {
    const list = units.filter((u) => u.kind === kind)
    if (list.length === 0) continue
    rows.push({
      kind,
      name: MODERN_CATALOG[kind].name,
      count: list.length,
      strength: list.reduce((s, u) => s + u.strength, 0) / list.length,
      equipment: list.reduce((s, u) => s + u.equipment, 0) / list.length,
      org: list.reduce((s, u) => s + u.org, 0) / list.length,
    })
  }
  return rows
}

/** État d'une force moyenne : bonne, entamée ou faible (couleur de la jauge). */
export function strengthTone(strength: number): 'ok' | 'warn' | 'bad' {
  if (strength >= 0.8) return 'ok'
  if (strength >= 0.5) return 'warn'
  return 'bad'
}

/** Division de l'ordre de bataille : ses brigades et leur état moyen. */
export interface DivisionRow {
  id: number
  name: string
  unitIds: number[]
  strength: number
  org: number
}

/** Corps de l'ordre de bataille (id null : divisions sans corps). */
export interface CorpsRow {
  id: number | null
  name: string
  unitIds: number[]
  divisions: DivisionRow[]
}

type OobUnit = Pick<UnitSnapshot, 'id' | 'strength' | 'org' | 'divisionId'>

/**
 * Ordre de bataille d'une armée : corps, puis divisions, avec les brigades de chacune (unités de
 * l'armée seulement). Les brigades sans division et les unités d'appui (logistique, QG) n'y figurent pas.
 */
export function orderOfBattle(
  units: ReadonlyArray<OobUnit>,
  formations: ReadonlyArray<FormationState>,
): CorpsRow[] {
  const byId = new Map(formations.map((f) => [f.id, f]))
  const divisions = new Map<number, DivisionRow>()
  for (const u of units) {
    if (u.divisionId === null) continue
    const f = byId.get(u.divisionId)
    if (!f) continue
    const d = divisions.get(f.id) ?? { id: f.id, name: f.name, unitIds: [], strength: 0, org: 0 }
    d.unitIds.push(u.id)
    d.strength += u.strength
    d.org += u.org
    divisions.set(f.id, d)
  }
  const corps = new Map<number | null, CorpsRow>()
  const number = (id: number | null): number =>
    id === null ? Infinity : (byId.get(id)?.number ?? 0)
  for (const d of divisions.values()) {
    d.strength /= d.unitIds.length
    d.org /= d.unitIds.length
    const parent = byId.get(d.id)?.parentId ?? null
    const c = byId.get(parent ?? -1)
    const key = c ? c.id : null
    const row = corps.get(key) ?? {
      id: key,
      name: c ? c.name : 'Divisions hors corps',
      unitIds: [],
      divisions: [],
    }
    row.divisions.push(d)
    row.unitIds.push(...d.unitIds)
    corps.set(key, row)
  }
  const out = [...corps.values()].sort((a, b) => number(a.id) - number(b.id))
  for (const c of out) c.divisions.sort((a, b) => number(a.id) - number(b.id))
  return out
}

/**
 * Formation d'une sélection : la division commune à toutes les unités choisies, et son corps ; le corps
 * seul quand elles appartiennent à plusieurs divisions d'un même corps. Null sinon.
 */
export function selectionFormation(
  units: ReadonlyArray<Pick<UnitSnapshot, 'divisionId'>>,
  formations: ReadonlyArray<FormationState>,
): { division: FormationState | null; corps: FormationState | null } | null {
  if (units.length === 0) return null
  const byId = new Map(formations.map((f) => [f.id, f]))
  const divisions = new Set(units.map((u) => u.divisionId))
  if (divisions.has(null)) return null
  const list = [...divisions].map((id) => byId.get(id ?? -1))
  if (list.some((d) => !d)) return null
  const parents = new Set(list.map((d) => d?.parentId ?? null))
  const corpsId = parents.size === 1 ? [...parents][0] : null
  const corps = corpsId !== null && corpsId !== undefined ? (byId.get(corpsId) ?? null) : null
  if (list.length === 1) return { division: list[0] ?? null, corps }
  return corps ? { division: null, corps } : null
}

/** Échelon d'une ligne de la vue Forces ou de l'en-tête de l'inspecteur. */
export type Echelon = 'army' | 'corps' | 'division' | 'brigade'

/** Marque OTAN de l'échelon, au-dessus du cadre. */
export const ECHELON_MARK: Record<Echelon, string> = {
  army: 'XXXX',
  corps: 'XXX',
  division: 'XX',
  brigade: 'X',
}

/** Chemin de la vue Forces : armée, puis corps, puis division (absents : niveau au-dessus). */
export interface ForcesPath {
  army?: number
  corps?: number
  division?: number
}

type TreeUnit = Pick<
  UnitSnapshot,
  | 'id'
  | 'name'
  | 'kind'
  | 'strength'
  | 'equipment'
  | 'org'
  | 'divisionId'
  | 'armyId'
  | 'engaged'
  | 'supplied'
>

/** Ligne de la vue Forces : une formation (ou une brigade) et l'état moyen de ses brigades. */
export interface ForcesRow {
  key: string
  echelon: Echelon
  id: number
  name: string
  unitIds: number[]
  /** Type dominant de ses brigades (symbole du cadre). */
  kind: UnitKind
  strength: number
  equipment: number
  org: number
  engaged: number
  unsupplied: number
  /** Sous-niveau ouvrable (une brigade n'en a pas). */
  open: boolean
}

function dominant(list: ReadonlyArray<TreeUnit>): UnitKind {
  const count = new Map<UnitKind, number>()
  for (const u of list) count.set(u.kind, (count.get(u.kind) ?? 0) + 1)
  let best: UnitKind = list[0]?.kind ?? 'inf'
  for (const [k, n] of count) if (n > (count.get(best) ?? 0)) best = k
  return best
}

function row(
  echelon: Echelon,
  id: number,
  name: string,
  list: ReadonlyArray<TreeUnit>,
  open = true,
): ForcesRow {
  const n = Math.max(1, list.length)
  return {
    key: `${echelon}${id}`,
    echelon,
    id,
    name,
    unitIds: list.map((u) => u.id),
    kind: dominant(list),
    strength: list.reduce((s, u) => s + u.strength, 0) / n,
    equipment: list.reduce((s, u) => s + u.equipment, 0) / n,
    org: list.reduce((s, u) => s + u.org, 0) / n,
    engaged: list.filter((u) => u.engaged).length,
    unsupplied: list.filter((u) => !u.supplied).length,
    open,
  }
}

/**
 * Lignes d'un niveau de la vue Forces (phase D3) : armées ; dans une armée, ses corps, ses divisions
 * hors corps puis ses brigades hors division ; dans un corps, ses divisions ; dans une division, ses
 * brigades. Les brigades comptées sont celles de l'armée ouverte (une brigade détachée ailleurs suit
 * l'armée qui la tient).
 */
export function forcesRows(
  path: ForcesPath,
  units: ReadonlyArray<TreeUnit>,
  formations: ReadonlyArray<FormationState>,
  armies: ReadonlyArray<{ id: number; name: string; unitIds: number[] }>,
): ForcesRow[] {
  const byId = new Map(units.map((u) => [u.id, u]))
  if (path.army === undefined) {
    return armies.map((a) =>
      row(
        'army',
        a.id,
        a.name,
        a.unitIds.map((id) => byId.get(id)).filter((u): u is TreeUnit => !!u),
      ),
    )
  }
  const members = units.filter((u) => u.armyId === path.army)
  const ofDivision = (id: number): TreeUnit[] => members.filter((u) => u.divisionId === id)
  const byNumber = (a: FormationState, b: FormationState): number => a.number - b.number
  const divisionRows = (list: FormationState[]): ForcesRow[] =>
    list
      .sort(byNumber)
      .map((d) => row('division', d.id, d.name, ofDivision(d.id)))
      .filter((r) => r.unitIds.length > 0)
  const brigadeRows = (list: TreeUnit[]): ForcesRow[] =>
    list.map((u) => row('brigade', u.id, u.name, [u], false))
  if (path.division !== undefined) return brigadeRows(ofDivision(path.division))
  if (path.corps !== undefined) {
    return divisionRows(
      formations.filter((f) => f.kind === 'division' && f.parentId === path.corps),
    )
  }
  const divisions = new Set(members.map((u) => u.divisionId))
  const mine = formations.filter((f) => f.kind === 'division' && divisions.has(f.id))
  const corpsIds = new Set(mine.map((d) => d.parentId).filter((id): id is number => id !== null))
  const corps = formations
    .filter((f) => corpsIds.has(f.id))
    .sort(byNumber)
    .map((c) =>
      row(
        'corps',
        c.id,
        c.name,
        members.filter((u) => mine.some((d) => d.id === u.divisionId && d.parentId === c.id)),
      ),
    )
  const known = new Set(mine.map((d) => d.id))
  return [
    ...corps,
    ...divisionRows(mine.filter((d) => d.parentId === null)),
    ...brigadeRows(members.filter((u) => u.divisionId === null || !known.has(u.divisionId))),
  ]
}

/** Fil d'Ariane d'un chemin : « Forces », puis l'armée, le corps et la division ouverts. */
export function forcesCrumbs(
  path: ForcesPath,
  formations: ReadonlyArray<FormationState>,
  armies: ReadonlyArray<{ id: number; name: string }>,
): Array<{ label: string; path: ForcesPath }> {
  const out: Array<{ label: string; path: ForcesPath }> = [{ label: 'Forces', path: {} }]
  const name = (id: number | undefined): string | undefined =>
    formations.find((f) => f.id === id)?.name
  if (path.army === undefined) return out
  out.push({
    label: armies.find((a) => a.id === path.army)?.name ?? 'Armée',
    path: { army: path.army },
  })
  if (path.corps !== undefined)
    out.push({ label: name(path.corps) ?? 'Corps', path: { army: path.army, corps: path.corps } })
  if (path.division !== undefined)
    out.push({ label: name(path.division) ?? 'Division', path: { ...path } })
  return out
}

/** Chemin d'une ligne ouverte depuis un chemin. */
export function openRow(
  path: ForcesPath,
  r: ForcesRow,
  formations: ReadonlyArray<FormationState>,
): ForcesPath {
  if (r.echelon === 'army') return { army: r.id }
  if (r.echelon === 'corps') return { army: path.army, corps: r.id }
  if (r.echelon === 'division') {
    const parent = formations.find((f) => f.id === r.id)?.parentId ?? undefined
    return {
      army: path.army,
      ...(parent !== undefined && parent !== null ? { corps: parent } : {}),
      division: r.id,
    }
  }
  return path
}

/**
 * Échelon d'une sélection, pour l'en-tête de l'inspecteur : une brigade seule ; toutes les brigades
 * d'une division, d'un corps ou d'une armée (celles que l'armée tient) ; sinon null (sélection mêlée).
 * Donne aussi la division, le corps et l'armée au-dessus, pour le fil d'Ariane et la remontée.
 */
export function selectionEchelon(
  selected: ReadonlyArray<Pick<UnitSnapshot, 'id' | 'divisionId' | 'armyId'>>,
  units: ReadonlyArray<Pick<UnitSnapshot, 'id' | 'divisionId' | 'armyId'>>,
  formations: ReadonlyArray<FormationState>,
  armies: ReadonlyArray<{ id: number; name: string; unitIds: number[] }>,
): {
  echelon: Echelon | null
  name: string | null
  division: FormationState | null
  corps: FormationState | null
  army: { id: number; name: string } | null
} | null {
  if (selected.length === 0) return null
  const byId = new Map(formations.map((f) => [f.id, f]))
  const ids = new Set(selected.map((u) => u.id))
  const armyIds = new Set(selected.map((u) => u.armyId))
  const armyId = armyIds.size === 1 ? [...armyIds][0] : null
  const army =
    armyId !== null && armyId !== undefined ? (armies.find((a) => a.id === armyId) ?? null) : null
  const f = selectionFormation(selected, formations)
  const division = f?.division ?? null
  const corps = f?.corps ?? null
  const all = (
    pred: (u: Pick<UnitSnapshot, 'id' | 'divisionId' | 'armyId'>) => boolean,
  ): boolean => {
    const list = units.filter(pred)
    return list.length === ids.size && list.every((u) => ids.has(u.id))
  }
  let echelon: Echelon | null = null
  let name: string | null = null
  const first = selected[0]
  if (selected.length === 1 && first) {
    echelon = 'brigade'
  } else if (army && all((u) => u.armyId === army.id)) {
    echelon = 'army'
    name = army.name
  } else if (division && all((u) => u.divisionId === division.id && u.armyId === armyId)) {
    echelon = 'division'
    name = division.name
  } else if (
    corps &&
    !division &&
    all(
      (u) =>
        u.armyId === armyId &&
        u.divisionId !== null &&
        byId.get(u.divisionId)?.parentId === corps.id,
    )
  ) {
    echelon = 'corps'
    name = corps.name
  }
  return { echelon, name, division, corps, army: army ? { id: army.id, name: army.name } : null }
}

/**
 * Ordre de défense propre d'une division (phase G2), en clair : étiquette « Ordre propre » et infobulle,
 * ou null quand elle suit l'ordre de son armée.
 */
export function defenseTag(
  f: Pick<FormationState, 'defense'> | undefined,
): { label: string; title: string } | null {
  const d = f?.defense
  if (!d) return null
  const what =
    d.kind === 'border'
      ? d.front
        ? 'tient seule son tronçon, devenu son front'
        : 'tient seule un tronçon de frontière'
      : d.kind === 'front'
        ? 'tient seule une portion du front'
        : `défend ${d.points.length} point${d.points.length > 1 ? 's' : ''}${d.zone ? ' dans une zone' : ''}`
  return {
    label: 'Ordre propre',
    title: `La division ${what}, hors de l'ordre de son armée`,
  }
}
