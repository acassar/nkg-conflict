import type { BudgetSector, EconomyState } from '@/sim/core/types'
import { SECTOR_NAMES, SECTORS } from '@/sim/economy/budget'
import { CONSTRUCTION_PER_CIV, MUNITIONS_PER_MIL, PRODUCTION_PER_MIL } from '@/sim/economy/rules'

/** Ligne du bloc « Budget » du tiroir Production. */
export interface BudgetLine {
  sector: BudgetSector
  name: string
  /** Montant du jour, en millions de dollars, et part du budget (0 à 1). */
  amount: number
  share: number
  /** Détail de l'emploi : usines employées, réserve, points cumulés. */
  note: string
}

export interface BudgetView {
  /** PIB annualisé (milliards de dollars) et budget du jour (millions). */
  gdpB: number
  budget: number
  /** Répartition automatique (aucun choix du joueur). */
  auto: boolean
  lines: BudgetLine[]
  /** Usines tenues (état pondéré, hors carte comprises). */
  factories: { civ: number; mil: number; offMap: number; damaged: number }
  /** Effet de la mobilisation sur l'activité, en points de PIB (négatif). */
  mobilizationPct: number
  /** Aide étrangère en argent du dernier jour (M$) : reçue et versée. */
  aid: { in: number; out: number }
}

const pct = (v: number): string => `${Math.round(v * 100)} %`
const fmt = (v: number): string =>
  v.toLocaleString('fr-FR', { maximumFractionDigits: v < 10 ? 1 : 0 })

/** Montant en millions de dollars, lisible (« 42 M$ », « 1,2 Md$ »). */
export function money(m: number): string {
  return Math.abs(m) >= 1000 ? `${fmt(m / 1000)} Md$` : `${fmt(m)} M$`
}

/** Vue du budget national du joueur (null pour un pays sans budget, ou avant la première journée). */
export function budgetView(eco: EconomyState | null | undefined): BudgetView | null {
  const b = eco?.budget
  const last = b?.last
  if (!eco || !b || !last) return null
  const notes: Record<BudgetSector, string> = {
    defense: `usines militaires à ${pct(last.use.mil)}`,
    construction:
      last.allocated.construction > 0 || last.use.civ > 0
        ? `usines civiles à ${pct(last.use.civ)}`
        : 'aucun chantier à financer',
    research: `${fmt(b.research)} M$ cumulés`,
    reserve: `réserve : ${money(b.treasury)}`,
  }
  return {
    gdpB: (last.gdp * 365) / 1000,
    budget: last.budget,
    auto: !b.allocation,
    lines: SECTORS.map((sector) => ({
      sector,
      name: SECTOR_NAMES[sector],
      amount: last.allocated[sector],
      share: last.budget > 0 ? last.allocated[sector] / last.budget : 0,
      note: notes[sector],
    })),
    factories: {
      civ: eco.factories.filter((f) => f.kind === 'civ').length + b.offMap.civ,
      mil: eco.factories.filter((f) => f.kind === 'mil').length + b.offMap.mil,
      offMap: b.offMap.civ + b.offMap.mil,
      damaged: eco.factories.filter((f) => f.condition < 1).length,
    },
    mobilizationPct: -(1 - b.gdpIndex) * 100,
    aid: { in: last.aid?.in ?? 0, out: last.aid?.out ?? 0 },
  }
}

/** Répartition affichée : celle du joueur, sinon les parts du dernier jour (répartition automatique). */
export function currentAllocation(eco: EconomyState | null | undefined): Allocation | null {
  const b = eco?.budget
  if (!b) return null
  if (b.allocation) return { ...b.allocation }
  const last = b.last
  if (!last || last.budget <= 0)
    return { defense: 0.5, construction: 0.2, research: 0.05, reserve: 0.25 }
  return Object.fromEntries(SECTORS.map((s) => [s, last.allocated[s] / last.budget])) as Allocation
}

export type Allocation = Record<BudgetSector, number>

/**
 * Curseur d'un secteur porté à `value` (0 à 1) : les autres secteurs se partagent le reste au prorata
 * de leurs parts (à parts égales s'ils sont tous à zéro). La somme reste 1.
 */
export function rebalance(a: Allocation, sector: BudgetSector, value: number): Allocation {
  const v = Math.max(0, Math.min(1, value))
  const others = SECTORS.filter((s) => s !== sector)
  const rest = others.reduce((sum, s) => sum + a[s], 0)
  const out = { ...a, [sector]: v }
  for (const s of others) out[s] = rest > 0 ? ((1 - v) * a[s]) / rest : (1 - v) / others.length
  return out
}

/** Effets attendus d'une répartition, d'après les besoins du dernier jour. */
export interface BudgetForecast {
  /** Part des usines militaires et civiles que l'argent du secteur fait tourner (hors réserve). */
  milUse: number
  civUse: number
  production: number
  munitions: number
  construction: number
  /** Chantiers à financer (sinon l'argent de la construction va à la réserve). */
  hasChantiers: boolean
  research: number
  /** Variation quotidienne de la réserve (négative : elle comble les manques). */
  reserve: number
  /** Jours avant que la réserve soit vide, si elle baisse. */
  reserveDays: number | null
}

export function budgetForecast(
  eco: EconomyState | null | undefined,
  a: Allocation,
): BudgetForecast | null {
  const b = eco?.budget
  const last = b?.last
  if (!b || !last) return null
  const money = (s: BudgetSector): number => last.budget * a[s]
  const use = (m: number, need: number): number => (need > 0 ? Math.min(1, m / need) : 0)
  const milUse = use(money('defense'), last.need.defense)
  const civUse = use(money('construction'), last.need.construction)
  // Capacité à plein régime : jours d'usine payés au prix d'une journée.
  const milDays = b.factoryDayCost > 0 ? last.need.defense / b.factoryDayCost : 0
  const civAbsorb = b.factoryDayCost > 0 ? last.need.construction / b.factoryDayCost : 0
  const extra = (m: number, need: number): number => m - need
  // L'aide en argent (reçue moins versée) va à la réserve.
  const balance =
    (last.aid?.in ?? 0) -
    (last.aid?.out ?? 0) +
    money('reserve') +
    extra(money('defense'), last.need.defense) +
    extra(money('construction'), last.need.construction)
  // La réserve comble les manques : les usines tournent à plein tant qu'elle n'est pas vide.
  const covered = b.treasury > 0
  const mil = covered ? 1 : milUse
  const civ = covered ? (last.need.construction > 0 ? 1 : 0) : civUse
  return {
    milUse,
    civUse,
    production: milDays * PRODUCTION_PER_MIL * mil,
    munitions: milDays * MUNITIONS_PER_MIL * mil,
    construction: civAbsorb * CONSTRUCTION_PER_CIV * civ,
    hasChantiers: last.need.construction > 0,
    research: money('research'),
    reserve: balance,
    reserveDays: balance < 0 ? Math.floor(b.treasury / -balance) : null,
  }
}

/** Série d'évolution (PIB, production, main-d'œuvre) : points d'une courbe et variation. */
export interface HistorySeries {
  key: 'gdp' | 'production' | 'manpower'
  name: string
  values: number[]
  /** Variation entre le premier et le dernier jour (−0,1 = −10 %), null sans valeur de départ. */
  change: number | null
  last: number
}

export function historySeries(eco: EconomyState | null | undefined): HistorySeries[] {
  const h = eco?.budget?.history ?? []
  const keys: Array<[HistorySeries['key'], string, number]> = [
    ['gdp', 'PIB', 0],
    ['production', 'Production', 1],
    ['manpower', "Main-d'œuvre", 2],
  ]
  return keys.map(([key, name, i]) => {
    const values = h.map((row) => row[i] ?? 0)
    const first = values[0] ?? 0
    const last = values[values.length - 1] ?? 0
    return {
      key,
      name,
      values,
      last,
      change: first > 0 && values.length > 1 ? last / first - 1 : null,
    }
  })
}

/** Points d'une courbe dans un cadre `w` × `h` (attribut `points` d'une polyline SVG). */
export function sparkPoints(values: number[], w: number, h: number): string {
  if (values.length < 2) return ''
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo || 1
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = h - ((v - lo) / span) * (h - 2) - 1
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

/** Ville du joueur la plus proche d'un point (nom et distance en km), pour situer une usine. */
export function nearestOwnCity(
  cities: Array<{ name: string; lon: number; lat: number; owner: string | null }>,
  owner: string,
  lon: number,
  lat: number,
): { name: string; km: number } | null {
  let best: { name: string; km: number } | null = null
  const cos = Math.cos((lat * Math.PI) / 180)
  for (const c of cities) {
    if (c.owner !== owner) continue
    const km = 111 * Math.hypot((c.lon - lon) * cos, c.lat - lat)
    if (!best || km < best.km) best = { name: c.name, km }
  }
  return best
}
