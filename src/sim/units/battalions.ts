import type { UnitKind } from '../core/types'

/**
 * Types de bataillon (phase D3) : le bataillon n'existe que dans la composition d'une brigade
 * (units/templates.ts). Les valeurs d'une brigade se calculent à partir des siens.
 */

export type BattalionKind =
  | 'lightInf'
  | 'motInf'
  | 'mechInf'
  | 'tank'
  | 'gunArt'
  | 'rocketArt'
  | 'recon'
  | 'engineer'
  | 'airDefense'
  | 'territorial'
  | 'support'

export interface BattalionType {
  kind: BattalionKind
  name: string
  /** Effectif théorique, en hommes. */
  men: number
  /** Puissance offensive et défensive : une brigade additionne celles de ses bataillons. */
  attack: number
  defense: number
  /** Vitesse en km/h de jeu : une brigade va au pas de son bataillon le plus lent. */
  speedKmh: number
  /** Zone de contrôle, en km (0 = n'en tient pas : le soutien). */
  zocKm: number
  /** Portée d'appui feu, en km (0 = pas de tir à distance). */
  rangeKm: number
  /** Poids du matériel dans la force (units/equipment.ts). */
  equipmentWeight: number
  /** Part du matériel dans les pertes, rapportée à celle des hommes. */
  equipmentLossRatio: number
  /** Munitions consommées par tir. */
  munitions: number
  /** Dépend du carburant. */
  motorized: boolean
  /** Famille de terrain : les effets du terrain propres à ce type d'unité (units/kinds.ts). */
  terrain: UnitKind | null
  /** Rôle dans les rapports de force entre types. */
  armor?: boolean
  foot?: boolean
  artillery?: boolean
}

const b = (t: BattalionType): BattalionType => t

/**
 * Les cinq anciens types d'unité deviennent des bataillons : infanterie (légère et motorisée),
 * mécanisée, chars, artillerie (canons et roquettes), défense territoriale. Valeurs de départ, réglées
 * pour que les brigades des modèles par défaut gardent les valeurs de l'ancien catalogue.
 */
export const BATTALIONS: Record<BattalionKind, BattalionType> = {
  lightInf: b({
    kind: 'lightInf',
    name: 'Infanterie légère',
    men: 900,
    attack: 4,
    defense: 7,
    speedKmh: 3,
    zocKm: 12,
    rangeKm: 0,
    equipmentWeight: 0.35,
    equipmentLossRatio: 0.8,
    munitions: 1,
    motorized: false,
    terrain: 'inf',
    foot: true,
  }),
  motInf: b({
    kind: 'motInf',
    name: 'Infanterie motorisée',
    men: 850,
    attack: 4.5,
    defense: 6.5,
    speedKmh: 5,
    zocKm: 12,
    rangeKm: 0,
    equipmentWeight: 0.4,
    equipmentLossRatio: 0.9,
    munitions: 1,
    motorized: true,
    terrain: 'inf',
    foot: true,
  }),
  mechInf: b({
    kind: 'mechInf',
    name: 'Infanterie mécanisée',
    men: 700,
    attack: 5.5,
    defense: 7.5,
    speedKmh: 6,
    zocKm: 12,
    rangeKm: 0,
    equipmentWeight: 0.55,
    equipmentLossRatio: 1.1,
    munitions: 1.025,
    motorized: true,
    terrain: 'mech',
  }),
  tank: b({
    kind: 'tank',
    name: 'Chars',
    men: 450,
    attack: 11.5,
    defense: 5.5,
    speedKmh: 6,
    zocKm: 12,
    rangeKm: 0,
    equipmentWeight: 0.75,
    equipmentLossRatio: 1.35,
    munitions: 1.325,
    motorized: true,
    terrain: 'tank',
    armor: true,
  }),
  gunArt: b({
    kind: 'gunArt',
    name: 'Artillerie (canons)',
    men: 550,
    attack: 6,
    defense: 2,
    speedKmh: 4,
    zocKm: 5,
    rangeKm: 30,
    equipmentWeight: 0.75,
    equipmentLossRatio: 1.3,
    munitions: 2,
    motorized: true,
    terrain: 'art',
    artillery: true,
  }),
  rocketArt: b({
    kind: 'rocketArt',
    name: 'Artillerie (roquettes)',
    men: 450,
    attack: 7,
    defense: 1.5,
    speedKmh: 5,
    zocKm: 5,
    rangeKm: 60,
    equipmentWeight: 0.8,
    equipmentLossRatio: 1.3,
    munitions: 2.5,
    motorized: true,
    terrain: 'art',
    artillery: true,
  }),
  recon: b({
    kind: 'recon',
    name: 'Reconnaissance',
    men: 450,
    attack: 4,
    defense: 4,
    speedKmh: 7,
    zocKm: 12,
    rangeKm: 0,
    equipmentWeight: 0.5,
    equipmentLossRatio: 1,
    munitions: 0.9,
    motorized: true,
    terrain: 'mech',
  }),
  engineer: b({
    kind: 'engineer',
    name: 'Génie',
    men: 600,
    attack: 2.5,
    defense: 5,
    speedKmh: 5,
    zocKm: 10,
    rangeKm: 0,
    equipmentWeight: 0.45,
    equipmentLossRatio: 0.9,
    munitions: 0.7,
    motorized: true,
    terrain: 'inf',
    foot: true,
  }),
  airDefense: b({
    kind: 'airDefense',
    name: 'Défense sol-air',
    men: 450,
    attack: 1,
    defense: 3,
    speedKmh: 5,
    zocKm: 5,
    rangeKm: 0,
    equipmentWeight: 0.8,
    equipmentLossRatio: 1.2,
    munitions: 0.5,
    motorized: true,
    terrain: 'art',
  }),
  territorial: b({
    kind: 'territorial',
    name: 'Défense territoriale',
    men: 1500,
    attack: 2,
    defense: 5,
    speedKmh: 3,
    zocKm: 9,
    rangeKm: 0,
    equipmentWeight: 0.25,
    equipmentLossRatio: 0.7,
    munitions: 0.75,
    motorized: false,
    terrain: 'tdf',
    foot: true,
  }),
  support: b({
    kind: 'support',
    name: 'Soutien',
    men: 1000,
    attack: 0,
    defense: 0,
    speedKmh: 6,
    zocKm: 0,
    rangeKm: 0,
    equipmentWeight: 0.5,
    equipmentLossRatio: 1,
    munitions: 0,
    motorized: true,
    terrain: null,
  }),
}
