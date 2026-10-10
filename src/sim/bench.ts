import type { SimContext } from './context'

/**
 * Mesure des performances : multiplie les unités en place par `factor` (3 pour une armée de
 * brigades à venir, au lieu des grandes unités actuelles). Chaque unité est scindée en `factor`
 * unités de même type, sur la même position et dans la même armée ; la force totale est conservée.
 * Réservé aux mesures (scripts/simulate.ts, tests) : les parties normales n'y passent jamais.
 */
export function multiplyForces(ctx: SimContext, factor: number): void {
  const k = Math.floor(factor)
  if (k <= 1) return
  for (const u of [...ctx.units.values()]) {
    u.strength /= k
    const army = u.armyId !== null ? ctx.armies.get(u.armyId) : undefined
    for (let i = 1; i < k; i++) {
      const copy = structuredClone(u)
      copy.id = ctx.allocId()
      copy.name = `${u.name} (${i + 1})`
      ctx.units.set(copy.id, copy)
      army?.unitIds.push(copy.id)
    }
  }
}

/** Profil trié : systèmes du plus coûteux au moins coûteux, en ms par heure simulée. */
export function profileReport(
  profile: Map<string, number>,
  hours: number,
): { name: string; msPerHour: number; share: number }[] {
  const total = [...profile.values()].reduce((a, b) => a + b, 0) || 1
  return [...profile.entries()]
    .map(([name, ms]) => ({ name, msPerHour: ms / Math.max(1, hours), share: ms / total }))
    .sort((a, b) => b.msPerHour - a.msPerHour)
}
