import type { EconomyState } from '@/sim/core/types'
import { BUILDINGS, RECRUIT_COSTS, WAR_ECONOMY } from '@/sim/economy/rules'
import { MODERN_CATALOG } from '@/sim/units/catalog'
import type { WarEconomyLevel } from '@/sim/core/types'

/** Une ligne de la file unique du tiroir Production : chantier ou formation. */
export interface QueueRow {
  id: number
  type: 'build' | 'train'
  /** Étiquette du type : « Chantier » ou « Formation ». */
  tag: string
  name: string
  city: string
  /** Armée rejointe à la sortie (formations). */
  army: string | null
  /** Avancement, 0 à 100. */
  pct: number
  /** L'élément avance aujourd'hui (chantier ouvert, caserne occupée). */
  active: boolean
  /** Délai restant au rythme maximal, en jours (null en attente). */
  etaDays: number | null
  /** Texte d'état : « 42 % · ≈ 12 j » ou « en attente de caserne ». */
  status: string
  /** Rang dans sa propre file (chantiers ou formations), pour monter et descendre. */
  index: number
  /** Taille de sa propre file. */
  size: number
}

const pctOf = (progress: number, cost: number): number =>
  cost > 0 ? Math.min(100, (100 * progress) / cost) : 100
const etaOf = (progress: number, cost: number, minDays: number): number =>
  Math.max(1, Math.ceil(((cost - progress) / Math.max(cost, 1e-9)) * minDays))

/**
 * File unique des chantiers et des formations : ce qui avance d'abord, puis ce qui attend ;
 * dans chaque groupe, chantiers puis formations, dans l'ordre de leur propre file (celui de la
 * simulation : les premiers chantiers selon les points du jour, une formation par caserne).
 */
export function productionQueue(
  eco: Pick<EconomyState, 'construction' | 'recruitment'>,
  buildSlots: number,
  barracks: number,
  armyName: (id: number) => string | null = () => null,
): QueueRow[] {
  const build: QueueRow[] = eco.construction.map((q, k) => {
    const active = k < buildSlots
    const eta = active ? etaOf(q.progress, q.cost, BUILDINGS[q.kind].minDays) : null
    const pct = pctOf(q.progress, q.cost)
    return {
      id: q.id,
      type: 'build',
      tag: 'Chantier',
      name: BUILDINGS[q.kind].name,
      city: q.city,
      army: null,
      pct,
      active,
      etaDays: eta,
      status: active ? `${Math.round(pct)} % · ≈ ${eta} j` : 'en attente de chantier',
      index: k,
      size: eco.construction.length,
    }
  })
  const train: QueueRow[] = eco.recruitment.map((q, k) => {
    const active = k < barracks
    const eta = active ? etaOf(q.progress, q.cost, RECRUIT_COSTS[q.kind].days) : null
    const pct = pctOf(q.progress, q.cost)
    return {
      id: q.id,
      type: 'train',
      tag: 'Formation',
      name: MODERN_CATALOG[q.kind].name,
      city: q.city,
      army: q.armyId !== null ? armyName(q.armyId) : null,
      pct,
      active,
      etaDays: eta,
      status: active ? `${Math.round(pct)} % · ≈ ${eta} j` : 'en attente de caserne',
      index: k,
      size: eco.recruitment.length,
    }
  })
  return [
    ...build.filter((r) => r.active),
    ...train.filter((r) => r.active),
    ...build.filter((r) => !r.active),
    ...train.filter((r) => !r.active),
  ]
}

/** Effets d'un cran d'économie de guerre, en lignes courtes pour le sélecteur. */
export function warEconomyEffects(level: WarEconomyLevel): string[] {
  const r = WAR_ECONOMY[level]
  const signed = (v: number): string =>
    v === 1 ? 'inchangée' : `${v > 1 ? '+' : '−'}${Math.round(Math.abs(v - 1) * 100)} %`
  // Stabilité et soutien à la guerre vont de 0 à 1 : 0,0005 par jour = 1,5 point par mois.
  const wear = (v: number): string =>
    v > 0
      ? `−${(v * 3000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} pt/mois`
      : 'aucune'
  return [
    `Production et munitions : ${signed(r.production)}`,
    `Construction : ${signed(r.construction)}`,
    `Usure de la stabilité : ${wear(r.stabilityPerDay)}, du soutien à la guerre : ${wear(r.warSupportPerDay)}`,
  ]
}
