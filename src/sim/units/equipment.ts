import type { UnitKind, UnitState } from '../core/types'
import { profileOf } from './templates'

/**
 * Effectifs et matériel séparés (choix d'Adrien, 10 oct. : deux jauges par unité). `strength` est la
 * jauge des effectifs (hommes), `equipment` celle du matériel (chars, pièces, véhicules, armes), toutes
 * deux de 0 à 1. Les hommes sont remplacés par la main-d'œuvre, le matériel par la production (que
 * l'aide étrangère alimente). Les stocks par catégorie de matériel viendront plus tard (phase D2).
 *
 * La force d'une unité au combat combine les deux jauges : effectifs^(1 − p) × matériel^p, où p est le
 * poids du matériel pour son type (les blindés valent surtout par leurs chars, l'infanterie par ses
 * hommes). À jauges égales, la force vaut cette jauge : l'équilibrage d'avant est conservé.
 */

/**
 * Poids du matériel dans la force, par rôle (valeurs de référence ; une brigade prend la moyenne de ses
 * bataillons, voir units/templates.ts).
 */
export const EQUIPMENT_WEIGHT: Record<UnitKind, number> = {
  inf: 0.35,
  tdf: 0.25,
  mech: 0.55,
  tank: 0.75,
  art: 0.75,
  log: 0.5,
  hq: 0.3,
}

/** Jauge du matériel (absente : égale aux effectifs, comme avant la séparation). */
export function equipmentOf(u: Pick<UnitState, 'strength' | 'equipment'>): number {
  return u.equipment ?? u.strength
}

/** Force de combat d'une unité, 0 à 1 : effectifs et matériel pondérés selon le type. */
export function combatStrength(
  u: Pick<UnitState, 'kind' | 'template' | 'strength' | 'equipment'>,
): number {
  const w = profileOf(u).equipmentWeight
  const men = Math.max(0, u.strength)
  const gear = Math.max(0, equipmentOf(u))
  // Jauges égales (unité neuve ou au complet) : pas de calcul de puissance.
  if (gear === men) return men
  return men ** (1 - w) * gear ** w
}

/** Facteurs des deux jauges dans la force de combat (écran de bataille) : effectifs, matériel. */
export function strengthFactors(
  u: Pick<UnitState, 'kind' | 'template' | 'strength' | 'equipment'>,
): {
  men: number
  gear: number
} {
  const w = profileOf(u).equipmentWeight
  return { men: Math.max(0, u.strength) ** (1 - w), gear: Math.max(0, equipmentOf(u)) ** w }
}

/**
 * Pertes d'une unité, en part de sa force : réparties entre hommes et matériel selon le type, de sorte
 * qu'à jauges égales la force baisse d'autant qu'avant la séparation.
 */
export function applyLosses(u: UnitState, lost: number): void {
  if (lost <= 0) return
  const p = profileOf(u)
  const w = p.equipmentWeight
  const r = p.equipmentLossRatio
  const men = 1 / (1 - w + w * r)
  u.equipment = Math.max(0, equipmentOf(u) - lost * r * men)
  u.strength = Math.max(0, u.strength - lost * men)
}

/** Une unité est détruite sous cette force de combat. */
export const DESTROYED_BELOW = 0.05
