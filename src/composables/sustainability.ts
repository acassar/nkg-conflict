import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import type { Sustainability, SustainResource } from '@/sim/core/types'
import {
  SUSTAIN_CRITICAL_DAYS,
  SUSTAIN_RESOURCES,
  SUSTAIN_WARNING_DAYS,
} from '@/sim/economy/sustainability'

export const SUSTAIN_LABELS: Record<SustainResource, string> = {
  production: 'Production',
  munitions: 'Munitions',
  manpower: "Main-d'œuvre",
}
/** Ressource limitante, dans une phrase (« faute de munitions »). */
const LACK: Record<SustainResource, string> = {
  production: 'de production',
  munitions: 'de munitions',
  manpower: "de main-d'œuvre",
}

export type SustainLevel = 'ok' | 'warning' | 'critical' | 'unknown'

export interface SustainRow {
  resource: SustainResource
  label: string
  need: number
  income: number
  balance: number
  stock: number
  /** Détail affiché sous la ligne (renforts, remplacements, aide). */
  detail: string
}

export interface SustainView {
  level: SustainLevel
  /** Valeur courte de la barre du haut (« durable », « 44 j »). */
  value: string
  /** Complément court (« ×3,3 », « production »). */
  delta: string
  /** Phrase de synthèse. */
  summary: string
  rows: SustainRow[]
  /** Texte de l'infobulle (détail par ressource). */
  title: string
}

const fmt = (v: number): string => Math.round(v).toLocaleString('fr-FR')
const signed = (v: number): string => `${v >= 0 ? '+' : '−'}${fmt(Math.abs(v))}`
const unit = (r: SustainResource): string => (r === 'manpower' ? ' k' : '')

/** Vue de l'indicateur à partir de la mesure de la simulation et des stocks. */
export function sustainView(
  s: Sustainability | null | undefined,
  stock: Record<SustainResource, number>,
): SustainView {
  if (!s) {
    const summary = 'Mesure en cours : il faut une journée complète de pertes et de revenus.'
    return { level: 'unknown', value: '…', delta: '', summary, rows: [], title: summary }
  }
  const rows: SustainRow[] = SUSTAIN_RESOURCES.map((r) => {
    const parts = [`renforts ${fmt(s.reinforce[r])}`, `unités détruites ${fmt(s.replace[r])}`]
    if (r === 'munitions') parts.splice(0, 2, 'tirs des unités au contact')
    const aid = r === 'manpower' ? 0 : s.aid[r]
    return {
      resource: r,
      label: SUSTAIN_LABELS[r],
      need: s.need[r],
      income: s.income[r],
      balance: s.income[r] - s.need[r],
      stock: stock[r],
      detail: `besoins : ${parts.join(', ')}${aid > 0.5 ? ` · dont aide reçue ${fmt(aid)}/j` : ''}`,
    }
  })
  let level: SustainLevel = 'ok'
  let value = 'durable'
  let delta = ''
  let summary: string
  if (s.days !== null && s.limiting) {
    level =
      s.days < SUSTAIN_CRITICAL_DAYS ? 'critical' : s.days < SUSTAIN_WARNING_DAYS ? 'warning' : 'ok'
    value = `${fmt(s.days)} j`
    delta = SUSTAIN_LABELS[s.limiting].toLowerCase()
    summary = `Au rythme actuel des pertes, les stocks s'épuisent dans ${fmt(s.days)} jours, faute ${LACK[s.limiting]}.`
  } else if (s.coverage === null) {
    summary = "Aucune perte ni consommation ces derniers jours : l'armée actuelle est durable."
  } else {
    delta = `×${s.coverage.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}`
    summary =
      s.coverage >= 1
        ? `Les revenus couvrent les besoins de l'armée (×${s.coverage.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} sur la ressource la plus tendue) : armée durable.`
        : "Revenus inférieurs aux besoins, mais les stocks tiennent plus d'un an : armée durable."
  }
  const lines = rows.map(
    (r) =>
      `${r.label} : besoins ${fmt(r.need)}${unit(r.resource)}/j, revenus ${fmt(r.income)}${unit(r.resource)}/j, solde ${signed(r.balance)}${unit(r.resource)}/j, stock ${fmt(r.stock)}${unit(r.resource)} (${r.detail})`,
  )
  const title = [
    "Soutenabilité de l'armée (moyenne glissante sur une semaine)",
    summary,
    ...lines,
  ].join('\n')
  return { level, value, delta, summary, rows, title }
}

/** Indicateur de soutenabilité de l'armée du joueur. */
export function useSustainability() {
  const game = useGameStore()
  return computed(() => {
    const eco = game.snapshot?.economy
    if (!eco) return null
    return sustainView(eco.sustain, {
      production: eco.production,
      munitions: eco.munitions,
      manpower: eco.manpower,
    })
  })
}
