import type { Flank } from './systems/flanks'
import type { Random } from './core/random'
import type {
  ArmyState,
  Buildings,
  CountryDef,
  CountryId,
  EconomyState,
  LonLat,
  UnitState,
} from './core/types'
import type { CityDef, Grid } from './theater/grid'
import type { UnitType } from './units/catalog'
import type { UnitKind } from './core/types'
import type { Pathfinder } from './systems/pathfinding'
import type { SideMatrix } from './politics/matrix'
import type { PoliticsState } from './politics/types'
import type { ObstacleField } from './systems/obstacles'
import type { Reaction } from './systems/breakthrough'
import type { Stance } from './systems/fallback'

/** État calculé par les systèmes à chaque tour (contact, ravitaillement, déroute, commandement). */
export interface UnitRuntime {
  engagedWith: number | null
  supplied: boolean
  routed: boolean
  /** À portée d'un QG de son camp : bonus de combat et récupération plus rapide. */
  commanded: boolean
  /** Riposte en cours à une percée (bloquer, couper la base ou contre-attaquer). */
  reaction?: Reaction
  /** Unité menacée : tenir retranchée ou décrocher vers la ligne suivante, avec son motif. */
  stance?: Stance
  /** Attaquée de plusieurs côtés ou en saillant : malus de défense et de moral (recalculé chaque heure). */
  flank?: Flank
  /** Poste du front attribué, chemin à calculer (étalé sur plusieurs ticks, voir planQueuedPaths). */
  pathPending?: boolean
}

/** Ville de la partie : propriétaire courant (index de camp) et bâtiments. */
export interface CityRuntime {
  def: CityDef
  owner: number
  buildings: Buildings
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
  /** Index de camp de chaque pays (inverse de `sides`). */
  sideIndex: Map<CountryId, number>
  /** Pays de la partie (nom, couleur, position de repli). */
  countries: Map<CountryId, CountryDef>
  /** Guerres et cobelligérances entre camps, recalculées à chaque changement diplomatique. */
  matrix: SideMatrix
  politics: PoliticsState
  /** Points d'où part le ravitaillement de chaque camp. */
  supplySources: Record<CountryId, LonLat[]>
  /** Cellules reliées au ravitaillement, par index de camp (1 = relié). */
  supplyReach: Uint8Array[]
  /** Cellules praticables d'un camp non reliées à son ravitaillement au dernier calcul (poches). */
  unsuppliedCells: number[][]
  cities: CityDef[]
  /** Propriétaire de chaque cellule au début de la partie (territoire national de chaque pays). */
  homeOwner: Uint8Array
  /** État des villes (propriétaire, bâtiments), par nom. */
  cityStates: Map<string, CityRuntime>
  economies: Map<CountryId, EconomyState>
  /** Effectifs perdus par pays depuis le dernier bilan quotidien (en fractions d'unité). */
  losses: Map<CountryId, number>
  /** Obstacles (mines, barbelés, positions préparées), par cellule. */
  obstacles: Map<number, ObstacleField>
  /** Nouvel identifiant unique (unités, armées, files d'attente). */
  allocId(): number
  /** `minor` : gardé seulement pour le joueur et les pays en guerre. */
  log(text: string, owner: CountryId | null, minor?: boolean): void
}

export function sideIndex(ctx: SimContext, country: CountryId): number {
  return ctx.sideIndex.get(country) ?? -1
}

/** Pays hors carte : présent seulement par son économie et sa diplomatie. */
export function isOffMap(ctx: SimContext, country: CountryId): boolean {
  return ctx.countries.get(country)?.offMap === true
}

/** Les deux pays sont-ils en guerre l'un contre l'autre ? */
export function hostileCountries(ctx: SimContext, a: CountryId, b: CountryId): boolean {
  return ctx.matrix.hostile(sideIndex(ctx, a), sideIndex(ctx, b))
}

export function countryName(ctx: SimContext, code: CountryId | null): string {
  return (code && ctx.countries.get(code)?.name) || code || 'personne'
}

export function runtimeOf(ctx: SimContext, id: number): UnitRuntime {
  let r = ctx.runtime.get(id)
  if (!r) {
    r = { engagedWith: null, supplied: true, routed: false, commanded: false }
    ctx.runtime.set(id, r)
  }
  return r
}

/** Unités des pays en guerre contre `owner`. */
export function enemiesOf(ctx: SimContext, owner: CountryId): UnitState[] {
  const side = sideIndex(ctx, owner)
  const out: UnitState[] = []
  for (const u of ctx.units.values()) {
    if (ctx.matrix.hostile(side, sideIndex(ctx, u.owner))) out.push(u)
  }
  return out
}
