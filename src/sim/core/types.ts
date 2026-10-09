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
  /**
   * Pays hors carte (théâtre régional) : sans territoire ni armée, il a une économie, une diplomatie et
   * peut aider ou être sollicité ; il ne peut ni déclarer ni subir de guerre.
   */
  offMap?: boolean
  /** Famille de couleur de la carte politique (1 à 9, voisins différents). */
  mapColor?: number
  pop?: number
  gdpB?: number
}

export type UnitKind = 'inf' | 'mech' | 'tank' | 'art' | 'log' | 'hq' | 'tdf'

/** Économie de guerre : 0 paix, 1 mobilisation partielle, 2 guerre totale. */
export type WarEconomyLevel = 0 | 1 | 2

export type OrderKind = 'idle' | 'move' | 'attack' | 'hold' | 'retreat' | 'front' | 'pursue'

export interface Order {
  kind: OrderKind
  /** Destination (move, attack, retreat, front) ; dernière position connue de la cible (pursue). */
  target?: LonLat
  /** Unité ennemie poursuivie (pursue). */
  unitId?: number
}

/** Ordres offensifs : valeur d'attaque au combat, pas de retranchement, passage en force. */
export function isOffensiveOrder(kind: OrderKind): boolean {
  return kind === 'attack' || kind === 'pursue'
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
  /** Posture de combat (équilibrée si absente) ; posée par le joueur, elle active aussi des réflexes. */
  posture?: Posture
  /**
   * Ordre direct du joueur (déplacement, repli, attaque, poursuite), ou évacuation après une paix :
   * l'unité sort de la répartition automatique de son armée jusqu'à la fin de l'ordre. `doneAt` = heure de fin de l'ordre ; l'armée
   * la reprend à sa répartition suivante, après au moins une heure de tenue sur place.
   */
  direct?: { doneAt?: number }
}

/** Postures de combat, de la plus prudente à la plus agressive. */
export type Posture = 'maxDefense' | 'defensive' | 'balanced' | 'offensive' | 'maxDamage'

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
  posture: Posture
  /** Unité ennemie au contact (pour regrouper les combats en batailles). */
  engagedWith: number | null
  /** Unité menacée : décision et motif (« tient : position forte », « décroche : … »). */
  stance: string | null
}

/** Unité dans le rapport de bataille. */
export interface BattleUnit {
  id: number
  name: string
  owner: CountryId
  kind: UnitKind
  strength: number
  org: number
  posture: Posture
  firePower: number
  defense: number
  routed: boolean
  attacking: boolean
  engagedWith: number | null
  /** Un fleuve sépare l'unité de son adversaire (défense de l'adversaire +40 % si elle attaque). */
  riverCrossing: boolean
  /** Obstacles de son camp sous l'unité (0 à 1) : mines, barbelés, positions préparées. */
  obstacles: number
  modifiers: {
    attack: Array<{ label: string; value: number }>
    defense: Array<{ label: string; value: number }>
  }
}

/** Bataille en cours : deux camps (a : celui du joueur s'il est engagé), lieu et terrain. */
export interface BattleReport {
  place: string
  terrain: string
  lon: number
  lat: number
  a: BattleUnit[]
  b: BattleUnit[]
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
  offensive: {
    from: LonLat
    to: LonLat
    launched: boolean
    /** Unités engagées (toutes les unités de ligne de l'armée si absent) ; les autres tiennent le front. */
    unitIds?: number[]
  } | null
  /** Groupe d'encerclement (absent pour une armée ordinaire). */
  encirclement?: Encirclement
  /** Posture donnée à toute l'armée (les nouvelles recrues la reçoivent aussi). */
  posture?: Posture
  /** Tracé du front tenu (lignes qui suivent les cellules de contact), pour l'affichage. */
  frontLine?: LonLat[][]
  /**
   * Mission en cours (absente = « Tenir »). La mission dit quoi faire, la posture dit comment.
   * L'encerclement (`encirclement`) est la troisième mission, gardée dans son propre champ.
   */
  mission?: ArmyMission
}

/** Missions d'armée : tenir la ligne (comportement par défaut), avancer, encercler. */
export type MissionKind = 'hold' | 'advance' | 'encircle'

/** But d'une mission « Avancer » : frontière avec un pays, trait libre ou objectif ponctuel. */
export type AdvanceGoal =
  | { kind: 'border'; country: CountryId }
  | { kind: 'line'; points: LonLat[] }
  | { kind: 'objective'; point: LonLat }

/**
 * Mission « Avancer » : les unités de ligne prennent chacune le poste le plus proche sur le tracé visé
 * et progressent en ligne continue (aucune ne prend plus d'une vingtaine de km d'avance sur ses voisines).
 * En posture défensive ou défense max, l'avance se fait par bonds, avec retranchement à chaque arrêt.
 */
export interface AdvanceMission {
  kind: 'advance'
  goal: AdvanceGoal
  /** Libellé du but, pour l'interface (« frontière avec Russie », « trait », « objectif »). */
  label: string
  /** Cellules du tracé visé, dans l'ordre le long de la ligne. */
  cells: number[]
  /** Tracé visé, pour l'affichage. */
  line: LonLat[][]
  startTick: number
  /** Part du tracé tenue par le camp, 0 à 1. */
  progress: number
  /** Avance par bonds : phase en cours et heure de son début. */
  phase: 'moving' | 'digging'
  phaseTick: number
  /** Heure à laquelle tout le tracé a été tenu (la mission s'achève peu après). */
  reachedTick?: number
  /** Groupe détaché d'une armée : il la rejoint à la fin de la mission. */
  parentArmyId?: number | null
}

export type ArmyMission = { kind: 'hold' } | AdvanceMission

/**
 * Encerclement en deux temps : les unités gagnent d'abord leurs points d'attente sur les flancs,
 * puis, toutes prêtes, ferment l'anneau ensemble. Le groupe rejoint son armée d'origine quand le groupe
 * ennemi est détruit, 7 jours après la fermeture, ou sur ordre du joueur.
 */
export interface Encirclement {
  /** Unités ennemies visées (la cible et ses voisines). */
  targetIds: number[]
  targetName: string
  /** Armée d'origine, que le groupe rejoint à la fin. */
  parentArmyId: number | null
  phase: 'staging' | 'closing'
  startTick: number
  /** Tick de fermeture de l'anneau (phase « closing »). */
  closeTick: number | null
  /** Point d'attente de chaque unité (identifiant d'unité → position). */
  staging: Record<number, LonLat>
  /**
   * Armée entière engagée (pas de groupe créé) : son front d'avant l'encerclement, rétabli à la fin.
   */
  previousFront?: { front: [LonLat, LonLat] | null; wholeFront: boolean }
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
  /** Part de l'industrie tournée vers l'armée (voir `WAR_ECONOMY`). */
  warEconomy: WarEconomyLevel
  /** Flux du dernier jour, pour l'affichage. */
  daily: {
    construction: number
    production: number
    munitions: number
    munitionsUsed: number
    manpower: number
    reinforcements: number
    /** Production dépensée la veille (formations et renforts). */
    productionUsed?: number
    /** Points de construction employés la veille. */
    constructionUsed?: number
    /** Production venue des points de construction inutilisés la veille (déjà comptée dans `production`). */
    productionFromConstruction?: number
  }
}

/** Ressources de départ et apports extérieurs au théâtre (industrie hors carte, aide, réserves). */
export interface ScenarioEconomy {
  production: number
  munitions: number
  manpower: number
  /**
   * Revenus quotidiens hors bâtiments. Modèle « villes » : apports venant de hors du théâtre.
   * Modèle « national » : revenus du pays entier, au prorata du territoire national tenu.
   */
  productionPerDay: number
  munitionsPerDay: number
  manpowerPerDay: number
  constructionPerDay?: number
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
  /**
   * Origine des revenus. « cities » (défaut) : usines des villes, d'après leur population.
   * « national » : PIB et population du pays au prorata du territoire tenu ; les villes ne portent
   * que les bâtiments construits en cours de partie (et casernes de départ).
   */
  economyModel?: 'cities' | 'national'
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
  /** Organisations régionales : +`bonus` de relations entre membres au départ, rapprochement mensuel. */
  organizations?: Array<{ id: string; name: string; members: CountryId[]; bonus: number }>
  /** Bonus de relations entre voisins (frontière terrestre), sauf paires de `relations`. */
  neighborRelation?: number
  /** Sanctions en cours au départ [auteur, cible]. */
  sanctions?: Array<[CountryId, CountryId]>
  /** Tous les pays ont leurs armées sur la carte dès le départ (en garnison s'ils sont en paix). */
  armiesAtStart?: boolean
  /** Aides étrangères en place au début de la partie (niveau 1 à 3). */
  aids?: Array<{ from: CountryId; to: CountryId; level: 1 | 2 | 3 }>
}
