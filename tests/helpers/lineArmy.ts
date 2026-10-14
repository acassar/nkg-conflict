import type { Simulation } from '@/sim/simulation'
import type { ArmyState } from '@/sim/core/types'
import { assignFront } from '@/sim/systems/armies'

/**
 * Armée ukrainienne sans secteur connu (« Forces terrestres ukrainiennes ») : elle part en réserve ;
 * remise sur la ligne de tout le front, déployée tout de suite comme au départ d'une armée qui la tient.
 */
export function wholeFrontArmy(sim: Simulation): ArmyState {
  const army = [...sim.ctx.armies.values()].find((a) => a.owner === 'UKR' && a.wholeFront)
  if (!army) throw new Error('armée introuvable')
  delete army.mission
  assignFront(sim.ctx, army, true)
  assignFront(sim.ctx, army, true)
  return army
}
