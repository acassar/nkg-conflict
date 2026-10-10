import { MODERN_CATALOG } from '@/sim/units/catalog'
import type { UnitKind, UnitSnapshot } from '@/sim/core/types'

/** Ligne de l'onglet « Composition » d'une armée : un type d'unité, son nombre et sa force moyenne. */
export interface CompositionRow {
  kind: UnitKind
  name: string
  count: number
  /** Effectifs moyens, 0 à 1. */
  strength: number
  /** Organisation moyenne, 0 à 1. */
  org: number
}

/** Composition par type, dans l'ordre du catalogue ; les types absents sont omis. */
export function armyComposition(
  units: ReadonlyArray<Pick<UnitSnapshot, 'kind' | 'strength' | 'org'>>,
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
