import type { PoliticsSnapshot } from '../politics/types'

/** Types partagés entre le Worker de simulation et l'interface. Données sérialisables uniquement. */

export type CountryId = string
export type LonLat = [number, number]

export interface CountryDef {
  id: CountryId
  name: string
  /** Couleur d'affichage [r, g, b]. */
  color: [number, number, number]
  /** Point de repli (centre du pays) quand il n'a plus de ville. */
  label?: LonLat
  /** Famille de couleur de la carte politique (1 à 9, voisins différents). */
  mapColor?: number
  pop?: number
  gdpB?: number
}

export type UnitKind = 'inf' | 'mech' | 'tank' | 'art' | 'log' | 'hq'

export type OrderKind = 'idle' | 'move' | 'attack' | 'hold' | 'retreat' | 'front'

export interface Order {
  kind: OrderKind
  /** Destination (move, attack, retreat, front). */
  target?: LonLat
}

/** État complet d'une unité. Sert aussi de format de sauvegarde. */
export interface UnitState {
  id: number
  name: string
  owner: CountryId
  kind: UnitKind
  lon: number
  lat: number
  /** Effectifs, 0 à 1. */
  strength: number
  /** Organisation (cohésion), 0 à 1. En dessous de 0,15 l'unité décroche. */
  org: number
  /** Retranchement accumulé en tenant une position, 0 à 1. */
  entrench: number
  order: Order
  /** Chemin en cours (points), recalculé à chaque nouvel ordre. */
  path: LonLat[]
  armyId: number | null
  /** Heures passées hors ravitaillement d'affilée. */
  hoursOutOfSupply: number
}

export interface UnitSnapshot {
  id: number
  name: string
  owner: CountryId
  kind: UnitKind
  lon: number
  lat: number
  strength: number
  org: number
  order: OrderKind
  target: LonLat | null
  path: LonLat[]
  armyId: number | null
  engaged: boolean
  supplied: boolean
  routed: boolean
  commanded: boolean
}

export interface ArmyState {
  id: number
  name: string
  owner: CountryId
  unitIds: number[]
  /** Portion de front tenue : deux points, les unités se répartissent entre eux. */
  front: [LonLat, LonLat] | null
  /** Tient tout le front du camp (prioritaire sur `front` s'il est vrai). */
  wholeFront: boolean
  /** Offensive planifiée : flèche d'un point à un autre. */
  offensive: { from: LonLat; to: LonLat; launched: boolean } | null
}

export interface GameEvent {
  tick: number
  text: string
  /** Camp concerné, pour la couleur dans le journal. */
  owner: CountryId | null
}

export interface GameOutcome {
  winner: CountryId
  reason: string
}

export type BuildingKind = 'civ' | 'mil' | 'barracks' | 'depot' | 'fort'
export type Buildings = Record<BuildingKind, number>

export interface CityState {
  name: string
  lon: number
  lat: number
  capital: boolean
  owner: CountryId | null
  pop: number
  buildings: Buildings
}

export interface ConstructionItem {
  id: number
  city: string
  kind: BuildingKind
  /** Points de construction déjà investis. */
  progress: number
  cost: number
}

export interface RecruitItem {
  id: number
  kind: UnitKind
  /** Ville de caserne où l'unité sera formée puis déployée. */
  city: string
  /** Production militaire déjà investie. */
  progress: number
  cost: number
  /** Armée rejointe à la sortie (null = réserve). */
  armyId: number | null
}

/** Économie d'un pays. Les stocks sont en points, la main-d'œuvre en milliers d'hommes. */
export interface EconomyState {
  country: CountryId
  production: number
  munitions: number
  manpower: number
  construction: ConstructionItem[]
  recruitment: RecruitItem[]
  /** Numéro de la prochaine unité de chaque type (noms des nouvelles unités). */
  unitCounters: Record<UnitKind, number>
  /** Flux du dernier jour, pour l'affichage. */
  daily: {
    construction: number
    production: number
    munitions: number
    munitionsUsed: number
    manpower: number
    reinforcements: number
  }
}

/** Ressources de départ et apports extérieurs au théâtre (industrie hors carte, aide, réserves). */
export interface ScenarioEconomy {
  production: number
  munitions: number
  manpower: number
  /** Apports quotidiens venant de hors du théâtre. */
  productionPerDay: number
  munitionsPerDay: number
  manpowerPerDay: number
}

export interface GridSnapshot {
  version: number
  width: number
  height: number
  bbox: [number, number, number, number]
  /** Index de camp par cellule (0 = aucun), ligne 0 = sud. */
  owner: Uint8Array
  /** Terrain par cellule (voir Terrain). */
  terrain: Uint8Array
  /** Codes des camps : sides[index] = id de pays. */
  sides: CountryId[]
}

export interface SimSnapshot {
  scenarioId: string
  tick: number
  startDate: string
  paused: boolean
  speed: number
  playerCountry: CountryId
  countries: CountryDef[]
  units: UnitSnapshot[]
  armies: ArmyState[]
  cities: CityState[]
  /** Économie du joueur (celle de l'IA n'est pas publiée). */
  economy: EconomyState | null
  /** L'économie du joueur est gérée automatiquement. */
  autoEconomy: boolean
  politics: PoliticsSnapshot
  events: GameEvent[]
  /** Part du territoire de départ conservée par chaque camp, 0 à 1. */
  territoryHeld: Record<CountryId, number>
  outcome: GameOutcome | null
  /** Grille complète : seulement au chargement d'une partie. */
  grid: GridSnapshot | null
  /** Cellules modifiées depuis la publication précédente : [cellule, propriétaire, …]. */
  gridPatch: number[] | null
  gridVersion: number
}

export interface ScenarioUnit {
  owner: CountryId
  kind: UnitKind
  name: string
  /** Position fixe ; absente = déploiement automatique le long du front. */
  lon?: number
  lat?: number
  strength?: number
}

export interface ScenarioDef {
  id: string
  name: string
  epoch: string
  theater: string
  startDate: string
  playerCountry: CountryId
  countries: CountryDef[]
  /** Points d'où part le ravitaillement de chaque camp (zones de 30 km). */
  supplySources: Record<CountryId, LonLat[]>
  economy: Record<CountryId, ScenarioEconomy>
  /** Unités explicites (théâtre) ; sinon levées à la mobilisation selon `politics.forceSize`. */
  units: ScenarioUnit[]
  politics?: ScenarioPolitics
}

export interface ScenarioPolitics {
  /** Unités levées à la mobilisation, par pays (défaut : 8). */
  forceSize?: Record<CountryId, number>
  /** Relations de départ [a, b, valeur], -100 à 100. */
  relations?: Array<[CountryId, CountryId, number]>
  alliances?: Array<{ id: string; name: string; members: CountryId[] }>
  /** Guerres en cours au début de la partie. */
  wars?: Array<{ name: string; attackers: CountryId[]; defenders: CountryId[] }>
  stability?: Record<CountryId, number>
  warSupport?: Record<CountryId, number>
  /** Aides étrangères en place au début de la partie (niveau 1 à 3). */
  aids?: Array<{ from: CountryId; to: CountryId; level: 1 | 2 | 3 }>
}
