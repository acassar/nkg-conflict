import type { Random } from './core/random'
import type { ArmyState, CountryId, LonLat, UnitState } from './core/types'
import type { CityDef, Grid } from './theater/grid'
import type { UnitType } from './units/catalog'
import type { UnitKind } from './core/types'
import type { Pathfinder } from './systems/pathfinding'

/** État de tour calculé par les systèmes, non sauvegardé (recalculé à la demande). */
export interface UnitRuntime {
  engagedWith: number | null
  supplied: boolean
  routed: boolean
}

/** Tout ce que les systèmes partagent. Les systèmes sont des fonctions pures sur ce contexte. */
export interface SimContext {
  grid: Grid
  rng: Random
  tick: number
  units: Map<number, UnitState>
  armies: Map<number, ArmyState>
  runtime: Map<number, UnitRuntime>
  catalog: Record<UnitKind, UnitType>
  pathfinder: Pathfinder
  /** sides[index] = pays ; l'index 0 est réservé aux cellules sans propriétaire. */
  sides: CountryId[]
  /** Points d'où part le ravitaillement de chaque camp. */
  supplySources: Record<CountryId, LonLat[]>
  /** Cellules reliées au ravitaillement, par index de camp (1 = relié). */
  supplyReach: Uint8Array[]
  /** Cellules praticables d'un camp non reliées à son ravitaillement au dernier calcul (poches). */
  unsuppliedCells: number[][]
  cities: CityDef[]
  log(text: string, owner: CountryId | null): void
}

export function sideIndex(ctx: SimContext, country: CountryId): number {
  return ctx.sides.indexOf(country)
}

export function runtimeOf(ctx: SimContext, id: number): UnitRuntime {
  let r = ctx.runtime.get(id)
  if (!r) {
    r = { engagedWith: null, supplied: true, routed: false }
    ctx.runtime.set(id, r)
  }
  return r
}

export function enemiesOf(ctx: SimContext, owner: CountryId): UnitState[] {
  const out: UnitState[] = []
  for (const u of ctx.units.values()) if (u.owner !== owner) out.push(u)
  return out
}
