import type { BudgetSector, EconomyState } from '@/sim/core/types'
import { SECTOR_NAMES, SECTORS } from '@/sim/economy/budget'

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
  }
}
