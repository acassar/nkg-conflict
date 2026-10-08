import { sideIndex, type SimContext } from '../context'
import type { UnitState } from '../core/types'
import { distanceKm } from '../theater/grid'

/** Taille des cases de l'index, en degrés (~55 km en latitude). */
const BUCKET_DEG = 0.5
const KM_PER_DEG = 111.32

/**
 * Index spatial des unités des camps en guerre, reconstruit à chaque heure de combat.
 * Les unités des pays en paix n'ont aucun ennemi : elles n'y figurent pas, ce qui rend
 * la recherche de contacts indépendante des milliers d'unités en garnison dans le monde.
 */
export class WarIndex {
  private buckets = new Map<number, UnitState[]>()
  readonly sideOf = new Map<number, number>()
  readonly units: UnitState[] = []

  constructor(private readonly ctx: SimContext) {
    for (const u of ctx.units.values()) {
      const side = sideIndex(ctx, u.owner)
      if (ctx.matrix.atWar[side] !== 1) continue
      this.units.push(u)
      this.sideOf.set(u.id, side)
      const key = WarIndex.key(Math.floor(u.lon / BUCKET_DEG), Math.floor(u.lat / BUCKET_DEG))
      const list = this.buckets.get(key)
      if (list) list.push(u)
      else this.buckets.set(key, [u])
    }
  }

  private static key(bx: number, by: number): number {
    return (by + 1000) * 10000 + (bx + 1000)
  }

  /** L'unité appartient-elle à un camp en guerre ? */
  has(u: UnitState): boolean {
    return this.sideOf.has(u.id)
  }

  /** Ennemi le plus proche à moins de `maxKm`, ou null. */
  nearestEnemy(u: UnitState, maxKm: number): UnitState | null {
    const side = this.sideOf.get(u.id) ?? sideIndex(this.ctx, u.owner)
    if (this.ctx.matrix.atWar[side] !== 1) return null
    const dLat = maxKm / KM_PER_DEG
    const dLon = maxKm / (KM_PER_DEG * Math.max(0.2, Math.cos((u.lat * Math.PI) / 180)))
    const bx0 = Math.floor((u.lon - dLon) / BUCKET_DEG)
    const bx1 = Math.floor((u.lon + dLon) / BUCKET_DEG)
    const by0 = Math.floor((u.lat - dLat) / BUCKET_DEG)
    const by1 = Math.floor((u.lat + dLat) / BUCKET_DEG)
    let best: UnitState | null = null
    let bestD = maxKm
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const list = this.buckets.get(WarIndex.key(bx, by))
        if (!list) continue
        for (const e of list) {
          if (!this.ctx.matrix.hostile(side, this.sideOf.get(e.id) ?? -1)) continue
          const d = distanceKm(u.lon, u.lat, e.lon, e.lat)
          if (d <= bestD) {
            bestD = d
            best = e
          }
        }
      }
    }
    return best
  }
}
