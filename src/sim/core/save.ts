import type { CountryDef, SimSnapshot, UnitSnapshot } from './types'

export const SAVE_VERSION = 1

export interface SaveFile {
  version: typeof SAVE_VERSION
  savedAt: string
  tick: number
  startDate: string
  speed: number
  playerCountry: string
  countries: CountryDef[]
  units: UnitSnapshot[]
}

export function toSave(snapshot: SimSnapshot, now = new Date()): SaveFile {
  return {
    version: SAVE_VERSION,
    savedAt: now.toISOString(),
    tick: snapshot.tick,
    startDate: snapshot.startDate,
    speed: snapshot.speed,
    playerCountry: snapshot.playerCountry,
    countries: snapshot.countries.map((c) => ({ ...c, color: [...c.color] })),
    units: snapshot.units.map((u) => ({ ...u })),
  }
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
  if (typeof d.startDate !== 'string' || Number.isNaN(Date.parse(d.startDate))) {
    throw new Error('Sauvegarde invalide : date de départ')
  }
  if (!Array.isArray(d.countries) || !Array.isArray(d.units)) {
    throw new Error('Sauvegarde invalide : pays ou unités manquants')
  }
  return d as unknown as SaveFile
}
