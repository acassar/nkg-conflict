import type { Reaction } from '../systems/breakthrough'
import type { Stance } from '../systems/fallback'
import type {
  ArmyState,
  Buildings,
  EconomyState,
  GameEvent,
  GameOutcome,
  ScenarioOptions,
  UnitState,
} from './types'
import type { Aid, AidRequest, Alliance, CountryPolitics, PeaceOffer, War } from '../politics/types'

export const SAVE_VERSION = 5
/** Versions encore lisibles (les champs ajoutés depuis prennent leur valeur par défaut). */
const READABLE_VERSIONS = [4, 5]

export interface SaveFile {
  version: number
  savedAt: string
  scenarioId: string
  /** Options de l'écran de départ (absentes des sauvegardes antérieures : aucune). */
  options?: ScenarioOptions
  playerCountry: string
  tick: number
  speed: number
  rngState: number
  nextId: number
  units: UnitState[]
  armies: ArmyState[]
  events: GameEvent[]
  outcome: GameOutcome | null
  /** Dernière offensive de l'IA militaire, par pays. */
  aiLastOffensiveTick: Record<string, number>
  /** Propriétaires de la grille, encodés par plages [valeur, longueur, …]. */
  owner: number[]
  /** Cellules reliées au ravitaillement par camp (par plages), pour reprendre la partie à l'identique. */
  supplyReach: number[][]
  /**
   * État de combat des unités : [id, engagée avec, ravitaillée, en déroute, commandée, riposte,
   * décrochage en cours].
   */
  runtime: Array<
    [
      number,
      number | null,
      boolean,
      boolean,
      boolean?,
      (Reaction | null)?,
      (Stance | null)?,
      boolean?,
    ]
  >
  /** Villes : propriétaire (index de camp) et bâtiments. */
  cities: Array<{ name: string; owner: number; buildings: Buildings }>
  economies: EconomyState[]
  autoEconomy?: boolean
  politics: {
    countries: CountryPolitics[]
    relations: Array<[string, number]>
    wars: War[]
    alliances: Alliance[]
    sanctions: string[]
    offers: PeaceOffer[]
    /** Absents des sauvegardes de version 4. */
    aids?: Aid[]
    aidRequests?: AidRequest[]
    aidRefusals?: Array<[string, number]>
    nextId: number
  }
  armylessSince: Array<[string, number]>
  /** Pertes depuis le dernier bilan quotidien (usure politique). */
  losses: Array<[string, number]>
  /** Obstacles : [cellule, niveau, camp]. Absents des sauvegardes antérieures. */
  obstacles?: Array<[number, number, number]>
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
  if (typeof d.version !== 'number' || !READABLE_VERSIONS.includes(d.version)) {
    throw new Error(`Version de sauvegarde non prise en charge : ${String(d.version)}`)
  }
  if (typeof d.tick !== 'number' || d.tick < 0) throw new Error('Sauvegarde invalide : tick')
  if (typeof d.scenarioId !== 'string') throw new Error('Sauvegarde invalide : scénario')
  if (!Array.isArray(d.units) || !Array.isArray(d.armies) || !Array.isArray(d.owner)) {
    throw new Error('Sauvegarde invalide : unités, armées ou carte manquantes')
  }
  return d as unknown as SaveFile
}
