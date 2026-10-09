import type { BuildingKind, Buildings, UnitKind, WarEconomyLevel } from '../core/types'

export interface BuildingType {
  kind: BuildingKind
  name: string
  /** Coût en points de construction. */
  cost: number
  /** Durée minimale de construction, en jours (même avec assez de points). */
  minDays: number
  /** Nombre maximal par ville. */
  maxPerCity: number
  description: string
}

/**
 * Bâtiments de l'époque moderne. Valeurs provisoires (la refonte de l'économie viendra en phase F) :
 * une usine se construit en plusieurs mois et un chantier n'absorbe que coût / durée minimale par jour,
 * soit 10 points pour une usine ; une usine civile rembourse son coût en 600 jours environ.
 */
export const BUILDINGS: Record<BuildingKind, BuildingType> = {
  civ: {
    kind: 'civ',
    name: 'Usine civile',
    cost: 2400,
    minDays: 240,
    maxPerCity: 10,
    description: 'Fournit des points de construction',
  },
  mil: {
    kind: 'mil',
    name: 'Usine militaire',
    cost: 1800,
    minDays: 180,
    maxPerCity: 10,
    description: 'Fournit de la production militaire et des munitions',
  },
  barracks: {
    kind: 'barracks',
    name: 'Caserne',
    cost: 600,
    minDays: 60,
    maxPerCity: 3,
    description: 'Forme une unité à la fois et la déploie dans la ville',
  },
  depot: {
    kind: 'depot',
    name: 'Dépôt',
    cost: 300,
    minDays: 30,
    maxPerCity: 1,
    description: 'Source de ravitaillement (30 km autour de la ville)',
  },
  fort: {
    kind: 'fort',
    name: 'Fortification',
    cost: 210,
    minDays: 14,
    maxPerCity: 3,
    description: '+15 % de défense par niveau à moins de 15 km de la ville',
  },
}

export const BUILDING_KINDS = Object.keys(BUILDINGS) as BuildingKind[]

/** Production quotidienne par bâtiment. */
export const CONSTRUCTION_PER_CIV = 4
export const PRODUCTION_PER_MIL = 3
export const MUNITIONS_PER_MIL = 4
/** Main-d'œuvre quotidienne (en milliers) par million d'habitants des villes tenues. */
export const MANPOWER_PER_MILLION = 0.15
export const MUNITIONS_CAP = 3000
export const FORT_BONUS_PER_LEVEL = 0.15
export const FORT_RADIUS_KM = 15
/** Constructions menées en parallèle au maximum. */
export const MAX_PARALLEL_CONSTRUCTION = 5
/** Points de construction quotidiens par chantier ouvert : un petit pays mène moins de chantiers. */
export const CONSTRUCTION_POINTS_PER_SITE = 20

/** Chantiers menés en parallèle selon les points de construction du jour (1 à 5). */
export function constructionSlots(pointsPerDay: number): number {
  return Math.max(
    1,
    Math.min(MAX_PARALLEL_CONSTRUCTION, Math.ceil(pointsPerDay / CONSTRUCTION_POINTS_PER_SITE)),
  )
}

export interface RecruitCost {
  /** Production militaire. */
  production: number
  /** Main-d'œuvre, en milliers d'hommes. */
  manpower: number
  /** Durée minimale de formation, en jours. */
  days: number
}

export const RECRUIT_COSTS: Record<UnitKind, RecruitCost> = {
  inf: { production: 300, manpower: 5, days: 10 },
  mech: { production: 600, manpower: 5, days: 14 },
  tank: { production: 900, manpower: 4, days: 18 },
  art: { production: 500, manpower: 3, days: 12 },
  log: { production: 300, manpower: 2, days: 8 },
  hq: { production: 400, manpower: 1, days: 8 },
  // Défense territoriale : peu de matériel, beaucoup d'hommes ; tient les secteurs calmes.
  tdf: { production: 100, manpower: 6, days: 7 },
}

/** Points de construction inutilisés du jour : cette part devient de la production militaire. */
export const CONSTRUCTION_SPILLOVER = 0.3

export interface WarEconomyRule {
  name: string
  /** Multiplicateurs de la production militaire (et des munitions) et des points de construction. */
  production: number
  construction: number
  /** Usure quotidienne supplémentaire de la stabilité et du soutien à la guerre. */
  stabilityPerDay: number
  warSupportPerDay: number
}

/** Économie de guerre : une part de l'industrie civile passe à l'armée, au prix de l'usure politique. */
export const WAR_ECONOMY: Record<WarEconomyLevel, WarEconomyRule> = {
  0: { name: 'Paix', production: 1, construction: 1, stabilityPerDay: 0, warSupportPerDay: 0 },
  1: {
    name: 'Mobilisation partielle',
    production: 1.3,
    construction: 0.7,
    stabilityPerDay: 0.0005,
    warSupportPerDay: 0.0005,
  },
  2: {
    name: 'Guerre totale',
    production: 1.6,
    construction: 0.4,
    stabilityPerDay: 0.0015,
    warSupportPerDay: 0.0015,
  },
}

/** Renfort quotidien maximal d'une unité ravitaillée hors combat (part des effectifs). */
export const REINFORCE_PER_DAY = 0.08
/** Munitions consommées par tir (une unité au contact tire une fois par heure). */
export const MUNITIONS_PER_SHOT = 0.25
/** Puissance de feu d'un camp à court de munitions. */
export const NO_MUNITIONS_FACTOR = 0.5

export function emptyBuildings(): Buildings {
  return { civ: 0, mil: 0, barracks: 0, depot: 0, fort: 0 }
}

/** Bâtiments de départ d'une ville selon sa population (industrie concentrée dans les grandes villes). */
/** Modèle national : l'industrie existante est comptée au niveau du pays ; les villes n'ont que des casernes. */
export function initialNationalBuildings(pop: number, capital: boolean): Buildings {
  const b = emptyBuildings()
  b.barracks = (pop >= 300_000 ? 1 : 0) + (capital ? 1 : 0)
  return b
}

export function initialBuildings(pop: number, capital: boolean): Buildings {
  const b = emptyBuildings()
  b.civ = Math.min(6, Math.max(1, Math.round(pop / 350_000)))
  b.mil = Math.min(5, Math.round(pop / 500_000))
  b.barracks = (pop >= 700_000 ? 1 : 0) + (capital ? 1 : 0)
  return b
}
