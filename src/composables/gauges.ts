import type { EconomyState } from '@/sim/core/types'
import { MUNITIONS_CAP, WAR_ECONOMY } from '@/sim/economy/rules'
import type { SustainLevel, SustainView } from './sustainability'

/**
 * Jauges de la barre du haut : Industrie, Munitions, Main-d'œuvre, Armée.
 * Chaque jauge donne la valeur, la tendance par jour et une couleur d'état ; sa fenêtre détaille
 * l'origine et l'usage de la ressource et donne des conseils. Règles pures, testées sans navigateur.
 */

/** Stocks relevés une fois par jour de jeu, pour la tendance. */
export interface ResourceSample {
  day: number
  production: number
  munitions: number
  manpower: number
}

/** Fenêtre de la tendance : variation moyenne du stock sur les derniers jours. */
export const TREND_DAYS = 7
/** Seuils d'épuisement (jours au rythme actuel) : rouge, puis ambre. */
export const CRITICAL_DAYS = 30
export const WARNING_DAYS = 90
/** Munitions : part du plafond à partir de laquelle la production risque d'être perdue. */
export const MUNITIONS_NEAR_CAP = 0.9
/** Stocks bas : munitions (feu divisé par deux à zéro) et main-d'œuvre (milliers d'hommes). */
export const LOW_MUNITIONS = 200
export const LOW_MANPOWER = 5

/** Ajoute le relevé du jour ; un retour en arrière (chargement) repart de zéro. */
export function pushSample(list: ResourceSample[], sample: ResourceSample): ResourceSample[] {
  const last = list.at(-1)
  if (last && sample.day < last.day) return [sample]
  const kept = last?.day === sample.day ? list.slice(0, -1) : list
  return [...kept, sample].slice(-(TREND_DAYS + 1))
}

/** Variation moyenne du stock par jour, ou null tant qu'il n'y a pas deux jours relevés. */
export function trendPerDay(
  list: ResourceSample[],
  key: 'production' | 'munitions' | 'manpower',
): number | null {
  const first = list[0]
  const last = list.at(-1)
  if (!first || !last || last.day <= first.day) return null
  return (last[key] - first[key]) / (last.day - first.day)
}

/** Jours avant épuisement au rythme actuel (null : stock stable ou en hausse). */
export function daysLeft(stock: number, trend: number | null): number | null {
  if (trend === null || trend >= -1e-6) return null
  return Math.max(0, stock / -trend)
}

function depletion(days: number | null): SustainLevel {
  if (days === null) return 'ok'
  if (days < CRITICAL_DAYS) return 'critical'
  if (days < WARNING_DAYS) return 'warning'
  return 'ok'
}

export type GaugeId = 'industry' | 'munitions' | 'manpower' | 'army'

export interface GaugeRow {
  label: string
  value: string
}

export interface GaugeView {
  id: GaugeId
  label: string
  /** Valeur courte (stock, ou état de l'armée). */
  value: string
  /** Tendance courte (« +12/j »), vide tant qu'elle n'est pas mesurée. */
  trend: string
  level: SustainLevel
  /** Infobulle : synthèse sur une ligne par information. */
  title: string
  /** Ce que la fenêtre détaille. */
  summary: string
  origin: GaugeRow[]
  uses: GaugeRow[]
  advice: string[]
}

export interface GaugeInput {
  eco: EconomyState
  sustain: SustainView | null
  history: ResourceSample[]
  /** Casernes du joueur sans formation en cours. */
  freeBarracks: number
}

const fmt = (v: number): string => Math.round(v).toLocaleString('fr-FR')
const fmtK = (v: number): string => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })
const signed = (v: number, f: (x: number) => string = fmt): string =>
  `${v >= 0 ? '+' : '−'}${f(Math.abs(v))}`

function trendText(t: number | null, unit = '', f: (x: number) => string = fmt): string {
  return t === null ? '' : `${signed(t, f)}${unit}/j`
}

function depletionAdvice(days: number | null, what: string, remedy: string): string[] {
  if (days === null || days >= WARNING_DAYS) return []
  return [`Au rythme actuel, ${what} s'épuise dans ${fmt(days)} jours : ${remedy}.`]
}

/** Les quatre jauges, dans l'ordre de la barre. */
export function gaugeViews({ eco, sustain, history, freeBarracks }: GaugeInput): GaugeView[] {
  const d = eco.daily
  const s = eco.sustain

  // ---------- Industrie (production militaire) ----------
  const prodTrend = trendPerDay(history, 'production')
  const prodDays = daysLeft(eco.production, prodTrend)
  const prodUsed = d.productionUsed ?? 0
  const industryAdvice: string[] = []
  if (freeBarracks > 0) {
    industryAdvice.push(
      `${freeBarracks} caserne${freeBarracks > 1 ? 's' : ''} libre${freeBarracks > 1 ? 's' : ''} : commandez des renforts depuis une armée (onglet « Renforts » de sa fiche).`,
    )
  }
  if (d.production > 0 && eco.production >= 10 * d.production && prodUsed < 0.5 * d.production) {
    industryAdvice.push(
      `Stock de ${fmt(eco.production)} qui dort (${fmt(eco.production / d.production)} jours de production) : formez des unités ou des défenses territoriales.`,
    )
  }
  industryAdvice.push(
    ...depletionAdvice(
      prodDays,
      'le stock de production',
      "réduisez les formations, ou passez à un niveau d'économie de guerre supérieur",
    ),
  )
  const industryOrigin: GaugeRow[] = [
    { label: 'Production du jour', value: `${fmt(d.production)}/j` },
  ]
  if ((d.productionFromConstruction ?? 0) > 0.5) {
    industryOrigin.push({
      label: 'dont points de construction inutilisés',
      value: `${fmt(d.productionFromConstruction ?? 0)}/j`,
    })
  }
  if (s && s.aid.production > 0.5) {
    industryOrigin.push({ label: 'dont aide reçue (7 j)', value: `${fmt(s.aid.production)}/j` })
  }
  industryOrigin.push({ label: 'Économie de guerre', value: WAR_ECONOMY[eco.warEconomy].name })
  const industryUses: GaugeRow[] = [
    { label: 'Dépensée hier (formations, renforts)', value: `${fmt(prodUsed)}/j` },
  ]
  if (s)
    industryUses.push({ label: "Besoins de l'armée (7 j)", value: `${fmt(s.need.production)}/j` })

  // ---------- Munitions ----------
  const munTrend = trendPerDay(history, 'munitions')
  const munDays = daysLeft(eco.munitions, munTrend)
  const nearCap = eco.munitions >= MUNITIONS_NEAR_CAP * MUNITIONS_CAP
  let munLevel = depletion(munDays)
  if (eco.munitions < LOW_MUNITIONS) munLevel = 'critical'
  else if (nearCap && munLevel === 'ok') munLevel = 'warning'
  const munAdvice: string[] = []
  if (eco.munitions < LOW_MUNITIONS) {
    munAdvice.push('Stock bas : à zéro, la puissance de feu de vos unités est divisée par deux.')
  }
  if (nearCap) {
    munAdvice.push(
      `Plafond de ${fmt(MUNITIONS_CAP)} presque atteint : les munitions produites au-delà sont perdues ; c'est le moment de les tirer.`,
    )
  }
  munAdvice.push(
    ...depletionAdvice(
      munDays,
      'le stock de munitions',
      "limitez les offensives, ou passez à un niveau d'économie de guerre supérieur",
    ),
  )
  const munOrigin: GaugeRow[] = [{ label: 'Production du jour', value: `${fmt(d.munitions)}/j` }]
  if (s && s.aid.munitions > 0.5) {
    munOrigin.push({ label: 'dont aide reçue (7 j)', value: `${fmt(s.aid.munitions)}/j` })
  }
  munOrigin.push({ label: 'Plafond du stock', value: fmt(MUNITIONS_CAP) })
  const munUses: GaugeRow[] = [{ label: 'Tirées hier', value: `${fmt(d.munitionsSpent ?? 0)}/j` }]
  if (s) munUses.push({ label: 'Tirs moyens (7 j)', value: `${fmt(s.need.munitions)}/j` })

  // ---------- Main-d'œuvre ----------
  const manTrend = trendPerDay(history, 'manpower')
  const manDays = daysLeft(eco.manpower, manTrend)
  let manLevel = depletion(manDays)
  if (eco.manpower < LOW_MANPOWER) manLevel = 'critical'
  const manAdvice: string[] = []
  if (eco.manpower < LOW_MANPOWER) {
    manAdvice.push(
      "Main-d'œuvre presque épuisée : formations et renforts attendent de nouveaux hommes.",
    )
  }
  manAdvice.push(
    ...depletionAdvice(
      manDays,
      "la main-d'œuvre",
      'ménagez vos unités au contact et réservez les hommes aux renforts',
    ),
  )
  const manUses: GaugeRow[] = s
    ? [
        { label: 'Renforts des unités (7 j)', value: `${fmtK(s.reinforce.manpower)} k/j` },
        { label: 'Unités détruites à remplacer (7 j)', value: `${fmtK(s.replace.manpower)} k/j` },
      ]
    : [{ label: 'Formations et renforts', value: 'mesure en cours' }]

  // ---------- Armée (soutenabilité) ----------
  const armyAdvice: string[] = []
  if (sustain && (sustain.level === 'warning' || sustain.level === 'critical')) {
    armyAdvice.push(
      'Les pertes dépassent les revenus : économie de guerre, aide étrangère, ou postures plus défensives pour les ménager.',
    )
  }

  const views: GaugeView[] = [
    {
      id: 'industry',
      label: 'Industrie',
      value: fmt(eco.production),
      trend: trendText(prodTrend),
      level: depletion(prodDays),
      summary:
        'Production militaire en stock : elle paie les formations et les renforts des unités.',
      title: '',
      origin: industryOrigin,
      uses: industryUses,
      advice: industryAdvice,
    },
    {
      id: 'munitions',
      label: 'Munitions',
      value: fmt(eco.munitions),
      trend: trendText(munTrend),
      level: munLevel,
      summary:
        'Munitions en stock : chaque tir en consomme ; à zéro, la puissance de feu est divisée par deux.',
      title: '',
      origin: munOrigin,
      uses: munUses,
      advice: munAdvice,
    },
    {
      id: 'manpower',
      label: "Main-d'œuvre",
      value: `${fmt(eco.manpower)} k`,
      trend: trendText(manTrend, ' k', fmtK),
      level: manLevel,
      summary: 'Hommes disponibles, en milliers : ils forment les unités et comblent leurs pertes.',
      title: '',
      origin: [{ label: 'Nouveaux hommes du jour', value: `${fmtK(d.manpower)} k/j` }],
      uses: manUses,
      advice: manAdvice,
    },
    {
      id: 'army',
      label: 'Armée',
      value: sustain?.value ?? '…',
      trend: sustain?.delta ?? '',
      level: sustain?.level ?? 'unknown',
      summary: sustain?.summary ?? 'Mesure en cours.',
      title: sustain?.title ?? '',
      origin: (sustain?.rows ?? []).map((r) => ({
        label: `${r.label} : revenus`,
        value: `${fmt(r.income)}${r.resource === 'manpower' ? ' k' : ''}/j`,
      })),
      uses: (sustain?.rows ?? []).map((r) => ({
        label: `${r.label} : besoins`,
        value: `${fmt(r.need)}${r.resource === 'manpower' ? ' k' : ''}/j`,
      })),
      advice: armyAdvice,
    },
  ]
  for (const v of views) {
    if (v.title) continue
    v.title = [
      `${v.label} : ${v.value}${v.trend ? ` (${v.trend})` : ''}`,
      v.summary,
      ...v.advice,
      'Cliquez pour le détail.',
    ].join('\n')
  }
  return views
}
