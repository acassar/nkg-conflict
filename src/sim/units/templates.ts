import type { UnitKind, UnitState } from '../core/types'
import { BATTALIONS, type BattalionKind } from './battalions'
import { MODERN_CATALOG, type UnitType } from './catalog'
import { kindTerrainTables } from './kinds'

/**
 * Modèles de brigade et de division (phase D3, modèles prédéfinis ; le concepteur viendra plus tard).
 * Une brigade interarmes suit un modèle, liste de bataillons (units/battalions.ts) dont elle tire ses
 * valeurs : attaque et défense sommées, vitesse du bataillon le plus lent, poids du matériel, effets du
 * terrain, rapports de force entre types et munitions pondérés par la part de chaque type.
 * Une division suit un modèle de 2 à 4 brigades. Les identifiants des modèles de brigade sont les types
 * des ordres de bataille réels (src/sim/data/real).
 */

export interface BrigadeTemplate {
  id: string
  name: string
  /** Rôle dans la simulation (tenue de la ligne, appui, nom par défaut). */
  kind: UnitKind
  battalions: Partial<Record<BattalionKind, number>>
}

export interface DivisionTemplate {
  id: string
  name: string
  /** Modèles de ses brigades (2 à 4). */
  brigades: string[]
}

const t = (
  id: string,
  name: string,
  kind: UnitKind,
  battalions: Partial<Record<BattalionKind, number>>,
): BrigadeTemplate => ({ id, name, kind, battalions })

/** Modèles de brigade prédéfinis, un par type des ordres de bataille réels (et l'artillerie à roquettes). */
export const BRIGADE_TEMPLATES: Record<string, BrigadeTemplate> = Object.fromEntries(
  [
    t('infanterie_legere', "Brigade d'infanterie légère", 'inf', { lightInf: 4, support: 1 }),
    t('motorisee', 'Brigade motorisée', 'inf', { motInf: 4, support: 1 }),
    t('mecanisee', 'Brigade mécanisée', 'mech', { mechInf: 3, tank: 1, support: 1 }),
    t('blindee', 'Brigade blindée', 'tank', { tank: 3, mechInf: 1, support: 1 }),
    t('artillerie', "Brigade d'artillerie", 'art', { gunArt: 4, support: 1 }),
    t('artillerie_roquettes', "Brigade d'artillerie à roquettes", 'art', {
      rocketArt: 3,
      support: 1,
    }),
    t('defense_territoriale', 'Brigade de défense territoriale', 'tdf', { territorial: 4 }),
    t('garde_nationale', 'Brigade de garde nationale', 'inf', {
      motInf: 3,
      territorial: 1,
      support: 1,
    }),
    t('montagne', 'Brigade de montagne', 'inf', { lightInf: 4, recon: 1, support: 1 }),
    t('aeroportee', 'Brigade aéroportée', 'inf', { lightInf: 3, recon: 1, support: 1 }),
    t('aeromobile', 'Brigade aéromobile', 'inf', { motInf: 3, recon: 1, support: 1 }),
    t('infanterie_marine', "Brigade d'infanterie de marine", 'inf', {
      motInf: 3,
      mechInf: 1,
      support: 1,
    }),
    t('forces_speciales', 'Brigade de forces spéciales', 'inf', {
      lightInf: 2,
      recon: 2,
      support: 1,
    }),
    t('reconnaissance', 'Brigade de reconnaissance', 'mech', { recon: 4, support: 1 }),
    t('genie', 'Brigade du génie', 'inf', { engineer: 4, support: 1 }),
    t('defense_sol_air', 'Brigade de défense sol-air', 'art', { airDefense: 4, support: 1 }),
    t('soutien', 'Brigade de soutien', 'art', { support: 3, engineer: 1 }),
    // Hélicoptères assimilés à la reconnaissance, en attendant l'aviation.
    t('aviation_legere', "Brigade d'aviation légère", 'art', { recon: 3, support: 1 }),
  ].map((x) => [x.id, x]),
)

/** Modèle d'une brigade sans modèle explicite, selon son rôle (les anciens types d'unité). */
export const DEFAULT_BRIGADE_TEMPLATE: Partial<Record<UnitKind, string>> = {
  inf: 'infanterie_legere',
  mech: 'mecanisee',
  tank: 'blindee',
  art: 'artillerie',
  tdf: 'defense_territoriale',
}

const d = (id: string, name: string, brigades: string[]): DivisionTemplate => ({
  id,
  name,
  brigades,
})

/** Modèles de division prédéfinis : brigades de manœuvre et, le plus souvent, une d'artillerie. */
export const DIVISION_TEMPLATES: Record<string, DivisionTemplate> = Object.fromEntries(
  [
    d('div_infanterie', "Division d'infanterie", [
      'motorisee',
      'motorisee',
      'motorisee',
      'artillerie',
    ]),
    d('div_legere', "Division d'infanterie légère", [
      'infanterie_legere',
      'infanterie_legere',
      'infanterie_legere',
      'artillerie',
    ]),
    d('div_mecanisee', 'Division mécanisée', ['mecanisee', 'mecanisee', 'blindee', 'artillerie']),
    d('div_blindee', 'Division blindée', ['blindee', 'blindee', 'mecanisee', 'artillerie']),
    d('div_montagne', 'Division de montagne', ['montagne', 'montagne', 'montagne', 'artillerie']),
    d('div_aeroportee', 'Division aéroportée', [
      'aeroportee',
      'aeroportee',
      'aeroportee',
      'artillerie',
    ]),
    d('div_marine', "Division d'infanterie de marine", [
      'infanterie_marine',
      'infanterie_marine',
      'artillerie',
    ]),
    d('div_territoriale', 'Division de défense territoriale', [
      'defense_territoriale',
      'defense_territoriale',
      'defense_territoriale',
    ]),
  ].map((x) => [x.id, x]),
)

/** Modèle de division formé autour d'une brigade de ce modèle (division de jeu, recrue sans place). */
export function divisionTemplateFor(brigadeTemplate: string): string {
  switch (brigadeTemplate) {
    case 'blindee':
      return 'div_blindee'
    case 'mecanisee':
    case 'reconnaissance':
      return 'div_mecanisee'
    case 'infanterie_legere':
    case 'forces_speciales':
    case 'genie':
      return 'div_legere'
    case 'montagne':
      return 'div_montagne'
    case 'aeroportee':
      return 'div_aeroportee'
    case 'infanterie_marine':
      return 'div_marine'
    case 'defense_territoriale':
      return 'div_territoriale'
    default:
      return 'div_infanterie'
  }
}

/**
 * Place d'une brigade dans une division : 2 si la place attend son modèle, 1 si elle attend une
 * brigade du même rôle (une brigade motorisée à la place d'une brigade d'infanterie légère), 0 sinon.
 */
export function slotFit(slot: string, brigadeTemplate: string): number {
  if (slot === brigadeTemplate) return 2
  const a = BRIGADE_TEMPLATES[slot]
  const b = BRIGADE_TEMPLATES[brigadeTemplate]
  return a && b && a.kind === b.kind ? 1 : 0
}

// ---------- Valeurs calculées ----------

/** Bataillons de ligne d'une brigade de référence : attaque et défense sommées, divisées par ce nombre. */
export const REFERENCE_BATTALIONS = 4

/** Valeurs d'une brigade (ou d'une unité de service : logistique, QG), tirées de ses bataillons. */
export interface UnitProfile {
  type: UnitType
  /** Modèle de brigade (null : logistique ou QG). */
  template: string | null
  men: number
  equipmentWeight: number
  equipmentLossRatio: number
  munitions: number
  motorized: boolean
  /** Part des chars dans l'attaque (rapports de force des blindés). */
  armor: number
  /** Part des fantassins dans les effectifs (cible des blindés). */
  foot: number
  /** Part de l'artillerie dans l'attaque. */
  artillery: number
  terrainSpeed: Float32Array
  terrainAttack: Float32Array
  terrainDefense: Float32Array
}

/** Logistique et QG : pas de modèle de brigade ; valeurs de l'ancien catalogue. */
const SERVICE: Partial<Record<UnitKind, { equipmentWeight: number; lossRatio: number }>> = {
  log: { equipmentWeight: 0.5, lossRatio: 1 },
  hq: { equipmentWeight: 0.3, lossRatio: 0.8 },
}

const cache = new Map<string, UnitProfile>()

function computeBrigade(template: BrigadeTemplate): UnitProfile {
  const entries = Object.entries(template.battalions) as [BattalionKind, number][]
  const list = entries.map(([k, n]) => ({ b: BATTALIONS[k], n }))
  let attack = 0
  let defense = 0
  let men = 0
  let munitions = 0
  let speed = Infinity
  let range = Infinity
  // Moyennes pondérées par les effectifs, hors soutien (il ne pèse ni sur le front ni au feu).
  let combatMen = 0
  let zoc = 0
  let weight = 0
  let lossRatio = 0
  let motorMen = 0
  let footMen = 0
  let armor = 0
  let artillery = 0
  for (const { b, n } of list) {
    attack += b.attack * n
    defense += b.defense * n
    men += b.men * n
    munitions += b.munitions * n
    speed = Math.min(speed, b.speedKmh)
    if (b.rangeKm > 0) range = Math.min(range, b.rangeKm)
    if (b.armor) armor += b.attack * n
    if (b.artillery) artillery += b.attack * n
    if (b.zocKm <= 0) continue
    combatMen += b.men * n
    zoc += b.zocKm * b.men * n
    weight += b.equipmentWeight * b.men * n
    lossRatio += b.equipmentLossRatio * b.men * n
    if (b.motorized) motorMen += b.men * n
    if (b.foot) footMen += b.men * n
  }
  const cm = Math.max(1, combatMen)
  const codes = kindTerrainTables(null).speed.length
  const terrainSpeed = new Float32Array(codes).fill(1)
  const terrainAttack = new Float32Array(codes)
  const terrainDefense = new Float32Array(codes)
  for (let c = 0; c < codes; c++) {
    let atk = 0
    let def = 0
    let slow = Infinity
    for (const { b, n } of list) {
      if (b.zocKm <= 0) continue
      const tables = kindTerrainTables(b.terrain)
      slow = Math.min(slow, tables.speed[c] ?? 1)
      atk += b.attack * n * (tables.attack[c] ?? 1)
      def += b.defense * n * (tables.defense[c] ?? 1)
    }
    terrainSpeed[c] = Number.isFinite(slow) ? slow : 1
    terrainAttack[c] = attack > 0 ? atk / attack : 1
    terrainDefense[c] = defense > 0 ? def / defense : 1
  }
  const type: UnitType = {
    kind: template.kind,
    name: template.name,
    attack: attack / REFERENCE_BATTALIONS,
    defense: defense / REFERENCE_BATTALIONS,
    speedKmh: Number.isFinite(speed) ? speed : 3,
    // Seules les brigades d'appui tirent à distance : l'artillerie d'une brigade de manœuvre compte
    // dans son attaque.
    supportRangeKm: template.kind === 'art' && Number.isFinite(range) ? range : 0,
    zocKm: zoc / cm,
    supplyRadiusKm: 0,
    commandRadiusKm: 0,
  }
  return {
    type,
    template: template.id,
    men,
    equipmentWeight: weight / cm,
    equipmentLossRatio: lossRatio / cm,
    munitions: munitions / REFERENCE_BATTALIONS,
    motorized: motorMen >= cm / 2,
    armor: attack > 0 ? armor / attack : 0,
    foot: footMen / cm,
    artillery: attack > 0 ? artillery / attack : 0,
    terrainSpeed,
    terrainAttack,
    terrainDefense,
  }
}

function computeService(kind: UnitKind): UnitProfile {
  const s = SERVICE[kind] ?? { equipmentWeight: 0.5, lossRatio: 1 }
  const tables = kindTerrainTables(null)
  return {
    type: MODERN_CATALOG[kind],
    template: null,
    men: 0,
    equipmentWeight: s.equipmentWeight,
    equipmentLossRatio: s.lossRatio,
    munitions: 1,
    motorized: true,
    armor: 0,
    foot: 0,
    artillery: 0,
    terrainSpeed: tables.speed,
    terrainAttack: tables.attack,
    terrainDefense: tables.defense,
  }
}

/** Valeurs d'un modèle de brigade (calculées une fois). */
export function brigadeProfile(templateId: string): UnitProfile {
  let p = cache.get(templateId)
  if (!p) {
    const template = BRIGADE_TEMPLATES[templateId]
    if (!template) throw new Error(`Modèle de brigade inconnu : ${templateId}`)
    p = computeBrigade(template)
    cache.set(templateId, p)
  }
  return p
}

/** Modèle d'une unité : le sien, sinon celui de son rôle ; null pour la logistique et les QG. */
export function templateOf(u: Pick<UnitState, 'kind' | 'template'>): string | null {
  return u.template ?? DEFAULT_BRIGADE_TEMPLATE[u.kind] ?? null
}

/** Valeurs d'une unité, d'après son modèle de brigade (ou son type pour la logistique et les QG). */
export function profileOf(u: Pick<UnitState, 'kind' | 'template'>): UnitProfile {
  const id = templateOf(u)
  if (id) return brigadeProfile(id)
  const key = `service:${u.kind}`
  let p = cache.get(key)
  if (!p) {
    p = computeService(u.kind)
    cache.set(key, p)
  }
  return p
}

/** Type (attaque, défense, vitesse, portée, zone de contrôle) d'une unité. */
export function unitType(u: Pick<UnitState, 'kind' | 'template'>): UnitType {
  return profileOf(u).type
}

/** Bataillons d'un modèle, dans l'ordre du catalogue. */
export function battalionsOf(templateId: string): Array<{ kind: BattalionKind; count: number }> {
  const template = BRIGADE_TEMPLATES[templateId]
  if (!template) return []
  return (Object.keys(BATTALIONS) as BattalionKind[])
    .filter((k) => (template.battalions[k] ?? 0) > 0)
    .map((k) => ({ kind: k, count: template.battalions[k] ?? 0 }))
}

/** Nom du modèle d'une unité (« Brigade mécanisée »), ou de son type pour la logistique et les QG. */
export function templateLabel(u: { kind: UnitKind; template?: string | null }): string {
  const id = u.template ?? DEFAULT_BRIGADE_TEMPLATE[u.kind]
  return (id && BRIGADE_TEMPLATES[id]?.name) || MODERN_CATALOG[u.kind].name
}

/** Composition d'un modèle : « 3 Infanterie mécanisée, 1 Chars, 1 Soutien · 3 550 hommes ». */
export function compositionText(u: { kind: UnitKind; template?: string | null }): string {
  const id = u.template ?? DEFAULT_BRIGADE_TEMPLATE[u.kind]
  if (!id) return ''
  const parts = battalionsOf(id).map(({ kind, count }) => `${count} ${BATTALIONS[kind].name}`)
  return `${parts.join(', ')} · ${brigadeProfile(id).men.toLocaleString('fr-FR')} hommes`
}
