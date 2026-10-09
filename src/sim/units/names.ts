import type { UnitKind } from '../core/types'

const KIND_NAMES: Record<UnitKind, { name: string; feminine: boolean }> = {
  inf: { name: "brigade d'infanterie", feminine: true },
  mech: { name: 'brigade mécanisée', feminine: true },
  tank: { name: 'brigade blindée', feminine: true },
  art: { name: "brigade d'artillerie", feminine: true },
  log: { name: 'groupement logistique', feminine: false },
  hq: { name: 'état-major', feminine: false },
  tdf: { name: 'brigade de défense territoriale', feminine: true },
}

/** Nom d'une unité numérotée : « 1re brigade blindée », « 3e état-major », « 1er groupement logistique ». */
export function unitName(kind: UnitKind, number: number): string {
  const { name, feminine } = KIND_NAMES[kind]
  const ordinal = number === 1 ? (feminine ? '1re' : '1er') : `${number}e`
  return `${ordinal} ${name}`
}
