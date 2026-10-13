import type { UnitKind, UnitState } from '../core/types'
import { Terrain, TERRAIN_RULES } from '../theater/grid'
import { profileOf } from './templates'

/**
 * Différences entre types d'unités : effets du terrain propres à chaque type, rapports de force
 * entre types et consommation (munitions par tir, dépendance au carburant).
 * Ces effets s'ajoutent aux règles communes du terrain (theater/grid) et du combat (systems/combat).
 * Une brigade combine ceux de ses bataillons, selon la part de chaque type (units/templates.ts).
 */

/** Unité dont on lit les valeurs : son rôle et son modèle de brigade. */
type Typed = Pick<UnitState, 'kind' | 'template'>

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

/** Tables d'effets du terrain d'une famille de bataillons (null : aucun effet propre). */
export function kindTerrainTables(kind: UnitKind | null): Tables {
  return (kind && TABLES.get(kind)) || NEUTRAL
}

/** Multiplicateur de vitesse d'une unité sur un terrain (son bataillon le plus gêné). */
export function kindTerrainSpeed(u: Typed, terrain: number | undefined): number {
  return profileOf(u).terrainSpeed[terrain ?? 0] ?? 1
}
/** Multiplicateur de puissance de feu d'une unité selon le terrain où elle se trouve. */
export function kindTerrainAttack(u: Typed, terrain: number | undefined): number {
  return profileOf(u).terrainAttack[terrain ?? 0] ?? 1
}
/** Multiplicateur de défense d'une unité selon le terrain où elle se trouve. */
export function kindTerrainDefense(u: Typed, terrain: number | undefined): number {
  return profileOf(u).terrainDefense[terrain ?? 0] ?? 1
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

/**
 * Rapport de force entre le tireur et sa cible (null = aucun), pondéré par la part de chaque type :
 * part des chars dans l'attaque du tireur, part des fantassins dans la cible, part de l'artillerie.
 */
export function matchup(
  from: UnitState,
  target: UnitState,
  targetTerrain: number | undefined,
): { factor: number; label: string } | null {
  const pf = profileOf(from)
  const armorVsFoot = pf.armor * profileOf(target).foot
  if (armorVsFoot > 0) {
    if (targetTerrain === Terrain.PLAIN) {
      return {
        factor: 1 + (ARMOR_OPEN_FACTOR - 1) * armorVsFoot,
        label: 'Blindés contre infanterie à découvert',
      }
    }
    if (targetTerrain === Terrain.URBAN && target.entrench >= URBAN_ENTRENCH_MIN) {
      return {
        factor: 1 + (ARMOR_URBAN_FACTOR - 1) * armorVsFoot,
        label: 'Blindés contre infanterie retranchée en ville',
      }
    }
  }
  if (pf.artillery > 0 && target.path.length === 0 && target.entrench < STATIC_ENTRENCH_MAX) {
    return {
      factor: 1 + (ARTILLERY_STATIC_FACTOR - 1) * pf.artillery,
      label: 'Artillerie contre cible immobile à découvert',
    }
  }
  return null
}

// ---------- Consommation ----------

/** Munitions consommées par un tir de cette unité : la somme de ses bataillons (units/templates.ts). */
export function munitionsPerShot(u: Typed): number {
  return profileOf(u).munitions
}

/** Une unité motorisée dépend du carburant apporté par le ravitaillement. */
export function isMotorized(u: Typed): boolean {
  return profileOf(u).motorized
}

/** Au-delà de ces heures sans ravitaillement, les réservoirs d'une unité motorisée sont vides. */
export const FUEL_HOURS = 24
/** Vitesse d'une unité motorisée sans carburant. */
export const NO_FUEL_SPEED = 0.4

/** Multiplicateur de vitesse lié au carburant (1 = plein ou type non motorisé). */
export function fuelSpeedFactor(u: UnitState): number {
  return isMotorized(u) && u.hoursOutOfSupply > FUEL_HOURS ? NO_FUEL_SPEED : 1
}
