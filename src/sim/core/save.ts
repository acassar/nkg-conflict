import type { ArmyState, GameEvent, GameOutcome, UnitState } from './types'

export const SAVE_VERSION = 2

export interface SaveFile {
  version: typeof SAVE_VERSION
  savedAt: string
  scenarioId: string
  tick: number
  speed: number
  rngState: number
  nextId: number
  units: UnitState[]
  armies: ArmyState[]
  events: GameEvent[]
  outcome: GameOutcome | null
  /** Dernière offensive de l'IA, par pays (un nombre seul dans les sauvegardes plus anciennes). */
  aiLastOffensiveTick: number | Record<string, number>
  /** Propriétaires de la grille, encodés par plages [valeur, longueur, …]. */
  owner: number[]
  /** Cellules reliées au ravitaillement par camp (par plages), pour reprendre la partie à l'identique. */
  supplyReach: number[][]
  /** État de combat des unités : [id, engagée avec, ravitaillée, en déroute, commandée]. */
  runtime: Array<[number, number | null, boolean, boolean, boolean?]>
  /** Dernier propriétaire connu de chaque ville (pour détecter les prises). */
  cityOwner: Array<[string, number]>
}

export function encodeRle(arr: ArrayLike<number>): number[] {
  const out: number[] = []
  if (arr.length === 0) return out
  let v = arr[0] ?? 0
  let n = 0
  for (let i = 0; i < arr.length; i++) {
    const a = arr[i] ?? 0
    if (a === v) n++
    else {
      out.push(v, n)
      v = a
      n = 1
    }
  }
  out.push(v, n)
  return out
}

export function serializeSave(save: SaveFile): string {
  return JSON.stringify(save)
}

/** Lit une sauvegarde et vérifie sa forme. Lève une erreur explicite si elle est invalide. */
export function parseSave(text: string): SaveFile {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('Sauvegarde illisible : JSON invalide')
  }
  if (typeof data !== 'object' || data === null) throw new Error('Sauvegarde invalide')
  const d = data as Record<string, unknown>
  if (d.version !== SAVE_VERSION) {
    throw new Error(`Version de sauvegarde non prise en charge : ${String(d.version)}`)
  }
  if (typeof d.tick !== 'number' || d.tick < 0) throw new Error('Sauvegarde invalide : tick')
  if (typeof d.scenarioId !== 'string') throw new Error('Sauvegarde invalide : scénario')
  if (!Array.isArray(d.units) || !Array.isArray(d.armies) || !Array.isArray(d.owner)) {
    throw new Error('Sauvegarde invalide : unités, armées ou carte manquantes')
  }
  return d as unknown as SaveFile
}
