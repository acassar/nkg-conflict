import { runtimeOf, sideIndex, type SimContext } from '../context'
import type { UnitState } from '../core/types'
import type { WarIndex } from './spatial'

/**
 * Règle de flanc : une unité au contact attaquée depuis deux côtés ou plus, ou enfoncée dans un
 * saillant ennemi, défend moins bien et perd plus vite son organisation (moral). Recalculée à chaque
 * heure de combat pour les seules unités au contact.
 */
export interface Flank {
  /** 1 = flanc menacé (deux côtés ou saillant), 2 = presque encerclée. */
  level: 1 | 2
  /** Ouverture des directions d'où viennent les ennemis proches, en degrés (0 à 360). */
  spreadDeg: number
  /** Unité dans un saillant : les cellules ennemies dominent autour d'elle. */
  salient: boolean
}

/** Ennemis pris en compte pour les directions d'attaque : un peu au-delà du contact. */
export const FLANK_KM = 15
/** Ouverture à partir de laquelle l'unité est attaquée de deux côtés (front droit : ~110°). */
export const TWO_SIDES_DEG = 150
/** Ouverture à partir de laquelle l'unité est presque encerclée. */
export const SURROUNDED_DEG = 250
/** Rayon et part de cellules ennemies qui font un saillant. */
const SALIENT_KM = 20
export const SALIENT_SHARE = 0.6
/** Défense : −15 % flanc menacé, −30 % presque encerclée. */
export const FLANK_DEFENSE = [1, 0.85, 0.7] as const
/** Pertes d'organisation subies : +25 % flanc menacé, +50 % presque encerclée. */
export const FLANK_ORG_LOSS = [1, 1.25, 1.5] as const

/** Ouverture angulaire (degrés) d'un ensemble de directions : 360 moins le plus grand écart. */
export function angularSpread(bearings: number[]): number {
  if (bearings.length < 2) return 0
  const sorted = [...bearings].map((b) => ((b % 360) + 360) % 360).sort((a, b) => a - b)
  let maxGap = 360 - ((sorted[sorted.length - 1] as number) - (sorted[0] as number))
  for (let k = 1; k < sorted.length; k++) {
    maxGap = Math.max(maxGap, (sorted[k] as number) - (sorted[k - 1] as number))
  }
  return 360 - maxGap
}

/** Cap (degrés, 0 = nord, sens horaire) de `a` vers `b`, en projection locale. */
function bearing(a: UnitState, b: UnitState): number {
  const dx = (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180)
  const dy = b.lat - a.lat
  return (Math.atan2(dx, dy) * 180) / Math.PI
}

/** Part des cellules praticables tenues par un camp hostile autour de l'unité. */
export function enemyShare(ctx: SimContext, u: UnitState): number {
  const { grid, matrix } = ctx
  const side = sideIndex(ctx, u.owner)
  let hostile = 0
  let total = 0
  grid.cellsWithin(u.lon, u.lat, SALIENT_KM, (i) => {
    if (!grid.passable(i)) return
    total++
    const o = grid.owner[i] ?? 0
    if (o !== 0 && matrix.hostile(side, o)) hostile++
  })
  return total > 0 ? hostile / total : 0
}

/** Situation de flanc d'une unité au contact (undefined si elle n'est pas menacée sur ses flancs). */
export function assessFlank(ctx: SimContext, u: UnitState, index: WarIndex): Flank | undefined {
  const bearings: number[] = []
  index.forEachEnemy(u, FLANK_KM, (e) => {
    if (!runtimeOf(ctx, e.id).routed) bearings.push(bearing(u, e))
  })
  if (bearings.length === 0) return undefined
  const spreadDeg = angularSpread(bearings)
  const salient = enemyShare(ctx, u) >= SALIENT_SHARE
  if (spreadDeg >= SURROUNDED_DEG) return { level: 2, spreadDeg, salient }
  if (spreadDeg >= TWO_SIDES_DEG || salient) return { level: 1, spreadDeg, salient }
  return undefined
}

/** Met à jour la situation de flanc des unités au contact (les autres n'en ont pas). */
export function updateFlanks(ctx: SimContext, index: WarIndex): void {
  for (const rt of ctx.runtime.values()) delete rt.flank
  for (const u of index.units) {
    const rt = runtimeOf(ctx, u.id)
    if (rt.engagedWith === null) continue
    const flank = assessFlank(ctx, u, index)
    if (flank) rt.flank = flank
  }
}

function levelOf(ctx: SimContext, u: UnitState): 0 | 1 | 2 {
  return ctx.runtime.get(u.id)?.flank?.level ?? 0
}

/** Facteur de défense dû aux flancs. */
export function flankDefenseFactor(ctx: SimContext, u: UnitState): number {
  return FLANK_DEFENSE[levelOf(ctx, u)]
}

/** Facteur des pertes d'organisation dû aux flancs. */
export function flankOrgLossFactor(ctx: SimContext, u: UnitState): number {
  return FLANK_ORG_LOSS[levelOf(ctx, u)]
}

/** Libellé court pour l'écran de bataille, ou null. */
export function flankText(f: Flank | undefined): string | null {
  if (!f) return null
  if (f.level === 2) return 'presque encerclée'
  return f.spreadDeg >= TWO_SIDES_DEG ? 'attaquée de deux côtés' : 'en saillant'
}
