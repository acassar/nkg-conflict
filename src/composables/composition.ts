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
