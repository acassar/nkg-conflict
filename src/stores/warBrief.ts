import type { CountryId } from '@/sim/core/types'

interface WarSides {
  id: number
  attackers: CountryId[]
  defenders: CountryId[]
}

/**
 * Guerres apparues depuis le dernier relevé (`known`, complété au passage) qui concernent le joueur,
 * avec leur adversaire principal (premier pays du camp d'en face).
 */
export function newPlayerWars(
  wars: WarSides[],
  known: Set<number>,
  player: CountryId,
): Array<{ warId: number; enemy: CountryId }> {
  const out: Array<{ warId: number; enemy: CountryId }> = []
  for (const w of wars) {
    if (known.has(w.id)) continue
    known.add(w.id)
    const other = w.attackers.includes(player)
      ? w.defenders
      : w.defenders.includes(player)
        ? w.attackers
        : null
    const enemy = other?.[0]
    if (enemy) out.push({ warId: w.id, enemy })
  }
  return out
}
