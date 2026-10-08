import type { AidLevel } from './types'

// Module sans dépendance : partagé par la simulation et l'interface.

/** Part des revenus quotidiens du donneur (munitions, production, construction) envoyée au receveur. */
export const AID_SHARE: Record<AidLevel, number> = { 1: 0.06, 2: 0.12, 3: 0.2 }
export const AID_LEVEL_NAMES: Record<AidLevel, string> = {
  1: 'limitée',
  2: 'soutenue',
  3: 'massive',
}
