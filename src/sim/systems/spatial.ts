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
  /** Par case : unités et leur camp (tableaux parallèles, sans recherche dans une Map à chaque test). */
  private buckets = new Map<number, { units: UnitState[]; sides: number[] }>()
  readonly sideOf = new Map<number, number>()
  readonly units: UnitState[] = []

  constructor(private readonly ctx: SimContext) {
    for (const u of ctx.units.values()) {
      const side = sideIndex(ctx, u.owner)
      if (ctx.matrix.atWar[side] !== 1) continue
      this.units.push(u)
      this.sideOf.set(u.id, side)
      const key = WarIndex.key(Math.floor(u.lon / BUCKET_DEG), Math.floor(u.lat / BUCKET_DEG))
      const bucket = this.buckets.get(key)
      if (bucket) {
        bucket.units.push(u)
        bucket.sides.push(side)
      } else this.buckets.set(key, { units: [u], sides: [side] })
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
    let best: UnitState | null = null
    let bestD = maxKm
    this.forEachEnemy(u, maxKm, (e, d) => {
      if (d <= bestD) {
        bestD = d
        best = e
      }
    })
    return best
  }

  /** Appelle `fn` pour chaque ennemi à moins de `maxKm` (avec sa distance). */
  forEachEnemy(u: UnitState, maxKm: number, fn: (e: UnitState, km: number) => void): void {
    const side = this.sideOf.get(u.id) ?? sideIndex(this.ctx, u.owner)
    this.forEachEnemyAt(side, u.lon, u.lat, maxKm, (e, d) => {
      fn(e, d)
      return false
    })
  }

  /**
   * Ennemis du camp `side` à moins de `maxKm` d'un point, dans l'ordre de l'index. `fn` renvoie vrai
   * pour arrêter la recherche ; la méthode renvoie alors vrai.
   */
  forEachEnemyAt(
    side: number,
    lon: number,
    lat: number,
    maxKm: number,
    fn: (e: UnitState, km: number) => boolean,
  ): boolean {
    const matrix = this.ctx.matrix
    if (matrix.atWar[side] !== 1) return false
    const dLat = maxKm / KM_PER_DEG
    const dLon = maxKm / (KM_PER_DEG * Math.max(0.2, Math.cos((lat * Math.PI) / 180)))
    const bx0 = Math.floor((lon - dLon) / BUCKET_DEG)
    const bx1 = Math.floor((lon + dLon) / BUCKET_DEG)
    const by0 = Math.floor((lat - dLat) / BUCKET_DEG)
    const by1 = Math.floor((lat + dLat) / BUCKET_DEG)
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const bucket = this.buckets.get(WarIndex.key(bx, by))
        if (!bucket) continue
        const { units, sides } = bucket
        for (let k = 0; k < units.length; k++) {
          if (!matrix.hostile(side, sides[k] ?? -1)) continue
          const e = units[k]
          if (!e) continue
          const d = distanceKm(lon, lat, e.lon, e.lat)
          if (d <= maxKm && fn(e, d)) return true
        }
      }
    }
    return false
  }
}
