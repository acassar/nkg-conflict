import type { UnitKind } from '../core/types'

export interface UnitType {
  kind: UnitKind
  name: string
  /** Puissance offensive et défensive de base (sans unité). */
  attack: number
  defense: number
  /** Vitesse moyenne en km/h de jeu, haltes comprises, en plaine et en territoire ami. */
  speedKmh: number
  /** Portée d'appui feu en km (0 = pas d'appui à distance). */
  supportRangeKm: number
  /** Rayon de contrôle du terrain autour de l'unité, en km. */
  zocKm: number
  /** Une unité logistique prolonge le ravitaillement autour d'elle. */
  supplyRadiusKm: number
}

/** Catalogue de l'époque moderne. Valeurs de départ, à équilibrer en jouant. */
export const MODERN_CATALOG: Record<UnitKind, UnitType> = {
  inf: {
    kind: 'inf',
    name: 'Infanterie',
    attack: 4,
    defense: 7,
    speedKmh: 3,
    supportRangeKm: 0,
    zocKm: 12,
    supplyRadiusKm: 0,
  },
  mech: {
    kind: 'mech',
    name: 'Infanterie mécanisée',
    attack: 7,
    defense: 7,
    speedKmh: 6,
    supportRangeKm: 0,
    zocKm: 12,
    supplyRadiusKm: 0,
  },
  tank: {
    kind: 'tank',
    name: 'Blindés',
    attack: 10,
    defense: 6,
    speedKmh: 6,
    supportRangeKm: 0,
    zocKm: 12,
    supplyRadiusKm: 0,
  },
  art: {
    kind: 'art',
    name: 'Artillerie',
    attack: 6,
    defense: 2,
    speedKmh: 4,
    supportRangeKm: 30,
    zocKm: 6,
    supplyRadiusKm: 0,
  },
  log: {
    kind: 'log',
    name: 'Logistique',
    attack: 0,
    defense: 1,
    speedKmh: 6,
    supportRangeKm: 0,
    zocKm: 4,
    supplyRadiusKm: 60,
  },
  hq: {
    kind: 'hq',
    name: 'Quartier général',
    attack: 1,
    defense: 2,
    speedKmh: 6,
    supportRangeKm: 0,
    zocKm: 4,
    supplyRadiusKm: 0,
  },
}

/** Les unités de mêlée tiennent la ligne ; les autres restent en retrait. */
export function isLineUnit(kind: UnitKind): boolean {
  return kind === 'inf' || kind === 'mech' || kind === 'tank'
}
