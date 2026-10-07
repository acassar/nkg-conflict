/** Types partagés entre le Worker de simulation et l'interface. Données sérialisables uniquement. */

export type CountryId = string
export type LonLat = [number, number]

export interface CountryDef {
  id: CountryId
  name: string
  /** Couleur d'affichage [r, g, b]. */
  color: [number, number, number]
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

export interface CityState {
  name: string
  lon: number
  lat: number
  capital: boolean
  owner: CountryId | null
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
  tick: number
  startDate: string
  paused: boolean
  speed: number
  playerCountry: CountryId
  countries: CountryDef[]
  units: UnitSnapshot[]
  armies: ArmyState[]
  cities: CityState[]
  events: GameEvent[]
  /** Part du territoire de départ conservée par chaque camp, 0 à 1. */
  territoryHeld: Record<CountryId, number>
  outcome: GameOutcome | null
  /** Présent seulement quand la grille a changé depuis la dernière publication. */
  grid: GridSnapshot | null
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
  units: ScenarioUnit[]
}
