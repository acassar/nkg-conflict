import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import type { LonLat } from '@/sim/core/types'

export interface BattleMarker {
  key: string
  ids: number[]
  at: LonLat
  /** Le joueur ou un allié y est engagé. */
  mine: boolean
}

/**
 * Batailles en cours vues par le joueur : groupes d'unités reliées par leurs contacts
 * (union de proche en proche), où le joueur, un allié ou un ennemi du joueur est engagé.
 */
export function useBattles() {
  const game = useGameStore()
  return computed<BattleMarker[]>(() => {
    const s = game.snapshot
    if (!s) return []
    const engaged = s.units.filter((u) => u.engagedWith !== null)
    if (engaged.length === 0) return []
    const parent = new Map<number, number>()
    const find = (x: number): number => {
      let r = x
      while ((parent.get(r) ?? r) !== r) r = parent.get(r) ?? r
      parent.set(x, r)
      return r
    }
    for (const u of engaged) {
      if (!parent.has(u.id)) parent.set(u.id, u.id)
      const foe = u.engagedWith ?? u.id
      if (!parent.has(foe)) parent.set(foe, foe)
      parent.set(find(u.id), find(foe))
    }
    const byId = new Map(s.units.map((u) => [u.id, u]))
    const groups = new Map<number, number[]>()
    for (const id of parent.keys()) {
      const r = find(id)
      groups.set(r, [...(groups.get(r) ?? []), id])
    }
    const stance = game.stances.map
    const out: BattleMarker[] = []
    for (const ids of groups.values()) {
      const units = ids.map((id) => byId.get(id)).filter((u) => u !== undefined)
      if (units.length < 2) continue
      const involved = units.some((u) => {
        const st = stance.get(u.owner)
        return st === 'player' || st === 'ally' || st === 'enemy'
      })
      if (!involved) continue
      const mine = units.some((u) => {
        const st = stance.get(u.owner)
        return st === 'player' || st === 'ally'
      })
      const lon = units.reduce((a, u) => a + u.lon, 0) / units.length
      const lat = units.reduce((a, u) => a + u.lat, 0) / units.length
      out.push({ key: ids.sort((a, b) => a - b).join('-'), ids, at: [lon, lat], mine })
    }
    return out
  })
}
