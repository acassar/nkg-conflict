import type { UnitKind, UnitState } from '../core/types'
import { Terrain, TERRAIN_RULES } from '../theater/grid'

/**
 * Différences entre types d'unités : effets du terrain propres à chaque type, rapports de force
 * entre types et consommation (munitions par tir, dépendance au carburant).
 * Ces effets s'ajoutent aux règles communes du terrain (theater/grid) et du combat (systems/combat).
 */

/** Effet d'un terrain sur un type : multiplicateurs de vitesse, de puissance de feu et de défense. */
export interface KindTerrainEffect {
  speed?: number
  attack?: number
  defense?: number
}

/** Effets du terrain par type, en plus des effets communs (1 ou absent = pas de différence). */
export const KIND_TERRAIN: Partial<Record<UnitKind, Partial<Record<number, KindTerrainEffect>>>> = {
  tank: {
    [Terrain.FOREST]: { speed: 0.7, attack: 0.75, defense: 0.85 },
    [Terrain.URBAN]: { speed: 0.8, attack: 0.7, defense: 0.8 },
    [Terrain.MARSH]: { speed: 0.6, attack: 0.7, defense: 0.85 },
    [Terrain.MOUNTAINS]: { speed: 0.8, attack: 0.8 },
  },
  mech: {
    [Terrain.FOREST]: { speed: 0.85, attack: 0.9 },
    [Terrain.URBAN]: { attack: 0.9 },
    [Terrain.MARSH]: { speed: 0.75, attack: 0.85 },
  },
  inf: {
    [Terrain.URBAN]: { attack: 1.15, defense: 1.15 },
    [Terrain.FOREST]: { attack: 1.1, defense: 1.1 },
  },
  tdf: {
    [Terrain.URBAN]: { defense: 1.15 },
    [Terrain.FOREST]: { defense: 1.1 },
  },
  art: {
    [Terrain.MOUNTAINS]: { speed: 0.8, attack: 0.7 },
    [Terrain.FOREST]: { attack: 0.9 },
    [Terrain.MARSH]: { speed: 0.8 },
  },
}

/** Nombre de codes de terrain (tables indexées par code). */
const TERRAIN_CODES = Math.max(...Object.keys(TERRAIN_RULES).map(Number)) + 1

/** Tables plates par type et par code de terrain : lues à chaque tir et à chaque pas. */
type Tables = { speed: Float32Array; attack: Float32Array; defense: Float32Array }
const TABLES = new Map<UnitKind, Tables>()
const NEUTRAL: Tables = {
  speed: new Float32Array(TERRAIN_CODES).fill(1),
  attack: new Float32Array(TERRAIN_CODES).fill(1),
  defense: new Float32Array(TERRAIN_CODES).fill(1),
}
for (const [kind, effects] of Object.entries(KIND_TERRAIN) as [
  UnitKind,
  Partial<Record<number, KindTerrainEffect>>,
][]) {
  const t: Tables = {
    speed: NEUTRAL.speed.slice(),
    attack: NEUTRAL.attack.slice(),
    defense: NEUTRAL.defense.slice(),
  }
  for (const [code, e] of Object.entries(effects)) {
    const c = Number(code)
    t.speed[c] = e?.speed ?? 1
    t.attack[c] = e?.attack ?? 1
    t.defense[c] = e?.defense ?? 1
  }
  TABLES.set(kind, t)
}

function tables(kind: UnitKind): Tables {
  return TABLES.get(kind) ?? NEUTRAL
}

/** Multiplicateur de vitesse d'un type sur un terrain. */
export function kindTerrainSpeed(kind: UnitKind, terrain: number | undefined): number {
  return tables(kind).speed[terrain ?? 0] ?? 1
}
/** Multiplicateur de puissance de feu d'un type selon le terrain où il se trouve. */
export function kindTerrainAttack(kind: UnitKind, terrain: number | undefined): number {
  return tables(kind).attack[terrain ?? 0] ?? 1
}
/** Multiplicateur de défense d'un type selon le terrain où il se trouve. */
export function kindTerrainDefense(kind: UnitKind, terrain: number | undefined): number {
  return tables(kind).defense[terrain ?? 0] ?? 1
}

// ---------- Rapports de force entre types ----------

/** Blindés contre infanterie (ou défense territoriale) en terrain découvert. */
export const ARMOR_OPEN_FACTOR = 1.15
/** Blindés contre infanterie retranchée en ville : puissance de feu réduite. */
export const ARMOR_URBAN_FACTOR = 0.7
/** Retranchement à partir duquel l'infanterie en ville résiste aux blindés. */
export const URBAN_ENTRENCH_MIN = 0.5
/** Artillerie contre une unité immobile et pas encore retranchée (cible repérée, sans abri). */
export const ARTILLERY_STATIC_FACTOR = 1.25
/** Retranchement à partir duquel une unité immobile est à l'abri de ce bonus. */
export const STATIC_ENTRENCH_MAX = 0.5

const isFoot = (k: UnitKind): boolean => k === 'inf' || k === 'tdf'

/** Rapport de force entre le type du tireur et celui de sa cible (null = aucun). */
export function matchup(
  from: UnitState,
  target: UnitState,
  targetTerrain: number | undefined,
): { factor: number; label: string } | null {
  if (from.kind === 'tank' && isFoot(target.kind)) {
    if (targetTerrain === Terrain.PLAIN) {
      return { factor: ARMOR_OPEN_FACTOR, label: 'Blindés contre infanterie à découvert' }
    }
    if (targetTerrain === Terrain.URBAN && target.entrench >= URBAN_ENTRENCH_MIN) {
      return { factor: ARMOR_URBAN_FACTOR, label: 'Blindés contre infanterie retranchée en ville' }
    }
  }
  if (from.kind === 'art' && target.path.length === 0 && target.entrench < STATIC_ENTRENCH_MAX) {
    return {
      factor: ARTILLERY_STATIC_FACTOR,
      label: 'Artillerie contre cible immobile à découvert',
    }
  }
  return null
}

// ---------- Consommation ----------

/** Munitions consommées par tir, selon le type (1 = infanterie). */
export const MUNITIONS_PER_SHOT_BY_KIND: Record<UnitKind, number> = {
  inf: 1,
  mech: 1.1,
  tank: 1.25,
  art: 2,
  tdf: 0.75,
  log: 1,
  hq: 1,
}

/** Types motorisés : ils dépendent du carburant apporté par le ravitaillement. */
export const MOTORIZED: ReadonlySet<UnitKind> = new Set<UnitKind>([
  'tank',
  'mech',
  'art',
  'log',
  'hq',
])
/** Au-delà de ces heures sans ravitaillement, les réservoirs d'une unité motorisée sont vides. */
export const FUEL_HOURS = 24
/** Vitesse d'une unité motorisée sans carburant. */
export const NO_FUEL_SPEED = 0.4

/** Multiplicateur de vitesse lié au carburant (1 = plein ou type non motorisé). */
export function fuelSpeedFactor(u: UnitState): number {
  return MOTORIZED.has(u.kind) && u.hoursOutOfSupply > FUEL_HOURS ? NO_FUEL_SPEED : 1
}
