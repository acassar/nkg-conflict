import type { UnitRuntime } from '../context'
import type { UnitState } from '../core/types'
import { isLineUnit } from '../units/catalog'
import type { WarIndex } from './spatial'

/**
 * Fatigue et relève. Une unité longtemps au front s'use : la fatigue (0 à 1) monte au contact, plus
 * vite en attaque, un peu en tenant le front sans combat, et redescend au repos, loin de l'ennemi.
 * Elle réduit la puissance de feu, la défense et la récupération de l'organisation (le moral).
 * La répartition du front (armies.ts) envoie les unités les plus fatiguées au repos, en retrait,
 * et confie leurs postes au reste de l'armée : c'est la relève, pour le joueur comme pour l'IA.
 */

/** Fatigue gagnée par heure au contact (une semaine de combat continu épuise une unité). */
export const FATIGUE_COMBAT_PER_HOUR = 0.006
/** Multiplicateur au contact quand l'unité attaque. */
export const FATIGUE_ATTACK_FACTOR = 1.5
/** Fatigue gagnée par heure au front sans combat (ennemi à moins de `REST_KM`). */
export const FATIGUE_FRONT_PER_HOUR = 0.0015
/** Fatigue perdue par heure au repos (environ 3 jours et demi pour récupérer entièrement). */
export const FATIGUE_REST_PER_HOUR = 0.012
/** Au-delà de cette distance de tout ennemi, l'unité se repose. */
export const REST_KM = 25
/** Malus maximal de puissance de feu et de défense (unité épuisée). */
export const FATIGUE_COMBAT_MALUS = 0.3
/** Malus maximal sur la récupération de l'organisation. */
export const FATIGUE_RECOVERY_MALUS = 0.5
/** Une unité de ligne part en relève à partir de cette fatigue… */
export const RELIEF_START = 0.6
/** … et reprend sa place dans la ligne quand elle est redescendue sous celle-ci. */
export const RELIEF_END = 0.2
/** Part au plus des unités de ligne d'une armée au repos en même temps. */
export const RELIEF_MAX_SHARE = 0.25

export function fatigueOf(u: UnitState): number {
  return u.fatigue ?? 0
}

/** Facteur de puissance de feu et de défense dû à la fatigue (1 pour une unité fraîche). */
export function fatigueFactor(u: UnitState): number {
  return 1 - FATIGUE_COMBAT_MALUS * fatigueOf(u)
}

/** Facteur de récupération de l'organisation dû à la fatigue. */
export function fatigueRecoveryFactor(u: UnitState): number {
  return 1 - FATIGUE_RECOVERY_MALUS * fatigueOf(u)
}

/**
 * Une heure de fatigue : au contact, au front, ou au repos. `index` : unités des camps en guerre ;
 * une unité d'un camp en paix se repose.
 */
export function updateFatigue(
  u: UnitState,
  rt: UnitRuntime,
  offensive: boolean,
  index: WarIndex,
): void {
  const before = fatigueOf(u)
  let next: number
  if (rt.engagedWith !== null) {
    next = before + FATIGUE_COMBAT_PER_HOUR * (offensive ? FATIGUE_ATTACK_FACTOR : 1)
  } else if (enemyNear(u, index)) {
    next = before + FATIGUE_FRONT_PER_HOUR
  } else {
    next = before - FATIGUE_REST_PER_HOUR
  }
  next = Math.min(1, Math.max(0, next))
  if (next > 0) u.fatigue = next
  else if (u.fatigue !== undefined) u.fatigue = 0
}

/** Un ennemi à moins de `REST_KM` (arrêt au premier trouvé) ? */
function enemyNear(u: UnitState, index: WarIndex): boolean {
  const side = index.sideOf.get(u.id)
  if (side === undefined) return false
  return index.forEachEnemyAt(side, u.lon, u.lat, REST_KM, () => true)
}

/**
 * Relève d'une armée : parmi ses unités de ligne, celles qui doivent se reposer. Une unité part à
 * `RELIEF_START` de fatigue et revient sous `RELIEF_END` ; au plus `RELIEF_MAX_SHARE` des unités de
 * ligne à la fois (les plus fatiguées d'abord), et jamais une armée de moins de 3 unités de ligne.
 * Met à jour `relief` sur les unités et renvoie celles au repos.
 */
export function selectRelief(line: UnitState[], share = RELIEF_MAX_SHARE): UnitState[] {
  const units = line.filter((u) => isLineUnit(u.kind))
  const max = units.length >= 3 ? Math.floor(units.length * share) : 0
  const wanting = units
    .filter((u) => fatigueOf(u) >= (u.relief ? RELIEF_END : RELIEF_START))
    .sort((a, b) => fatigueOf(b) - fatigueOf(a) || a.id - b.id)
  const resting = wanting.slice(0, max)
  const chosen = new Set(resting.map((u) => u.id))
  for (const u of units) {
    if (chosen.has(u.id)) u.relief = true
    else if (u.relief) u.relief = undefined
  }
  return resting
}
