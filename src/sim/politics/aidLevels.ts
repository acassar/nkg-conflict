import type { AidLevel } from './types'

// Module sans dépendance : partagé par la simulation et l'interface.

/** Part des revenus quotidiens du donneur (munitions, production ; construction pour un donneur sans budget) envoyée au receveur. */
export const AID_SHARE: Record<AidLevel, number> = { 1: 0.06, 2: 0.12, 3: 0.2 }
/** Argent versé par un donneur à budget : part de son budget du jour. */
export const AID_MONEY_SHARE: Record<AidLevel, number> = { 1: 0.01, 2: 0.02, 3: 0.04 }
/** Plafond de cet argent : part du budget du jour du receveur (il ne peut en employer davantage). */
export const AID_CAP: Record<AidLevel, number> = { 1: 0.1, 2: 0.2, 3: 0.35 }
export const AID_LEVEL_NAMES: Record<AidLevel, string> = {
  1: 'limitée',
  2: 'soutenue',
  3: 'massive',
}
