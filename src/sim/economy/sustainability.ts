import type { SimContext } from '../context'
import type { CountryId, Sustainability, SustainResource, UnitKind } from '../core/types'
import { RECRUIT_COSTS } from './rules'

/**
 * Soutenabilité de l'armée : l'économie du pays peut-elle maintenir l'armée actuelle au rythme
 * des pertes actuelles ? Chaque jour, on compare les besoins (renforts pour combler les pertes
 * des unités encore en vie, remplacement des unités détruites, munitions tirées) aux revenus
 * (production, munitions, main-d'œuvre, aide reçue comprise), en moyenne glissante. Le
 * ravitaillement ne coûte rien dans les règles actuelles : il n'entre pas dans le calcul.
 * Calculé pour tous les pays (l'IA pourra s'en servir), affiché pour le joueur.
 */

/** Poids du dernier jour dans la moyenne glissante (environ une semaine). */
export const SUSTAIN_SMOOTHING = 1 / 7
/** Un déficit inférieur à cette part des besoins est négligé (bruit d'un jour à l'autre). */
export const SUSTAIN_TOLERANCE = 0.02
/** Au-delà, l'armée est considérée comme durable (stocks pour plus d'un an). */
export const SUSTAIN_MAX_DAYS = 365
/** Seuils d'alerte de l'indicateur, en jours tenables. */
export const SUSTAIN_CRITICAL_DAYS = 30
export const SUSTAIN_WARNING_DAYS = 90

export const SUSTAIN_RESOURCES: SustainResource[] = ['production', 'munitions', 'manpower']

type Amounts = Record<SustainResource, number>
const zero = (): Amounts => ({ production: 0, munitions: 0, manpower: 0 })

/** Effectifs de la veille par unité, pour mesurer les pertes du jour. Vide après un chargement. */
const previous = new WeakMap<SimContext, Map<number, Seen>>()

interface Seen {
  owner: CountryId
  kind: UnitKind
  strength: number
}

/** Pertes du jour par pays, valorisées au prix des renforts et des unités neuves. */
interface DayLosses {
  /** Renforts à verser aux unités encore en vie (production, main-d'œuvre). */
  reinforce: Amounts
  /** Remplacement des unités détruites, au prix d'une unité neuve. */
  replace: Amounts
}

function measureLosses(ctx: SimContext): Map<CountryId, DayLosses> | null {
  const before = previous.get(ctx)
  const now = new Map<number, Seen>()
  for (const u of ctx.units.values()) {
    now.set(u.id, { owner: u.owner, kind: u.kind, strength: u.strength })
  }
  previous.set(ctx, now)
  if (!before) return null
  const out = new Map<CountryId, DayLosses>()
  const entry = (c: CountryId): DayLosses => {
    let e = out.get(c)
    if (!e) out.set(c, (e = { reinforce: zero(), replace: zero() }))
    return e
  }
  for (const [id, prev] of before) {
    const u = ctx.units.get(id)
    if (u && u.owner !== prev.owner) continue
    const cost = RECRUIT_COSTS[prev.kind]
    if (!u) {
      const e = entry(prev.owner)
      e.replace.production += cost.production
      e.replace.manpower += cost.manpower
      continue
    }
    const lost = prev.strength - u.strength
    if (lost <= 0) continue
    // Même prix que les renforts de la simulation : moitié de la production, pleine main-d'œuvre.
    const e = entry(u.owner)
    e.reinforce.production += lost * cost.production * 0.5
    e.reinforce.manpower += lost * cost.manpower
  }
  return out
}

const blend = (old: number, value: number, a: number): number => old + (value - old) * a

/**
 * Jours tenables, ressource limitante et couverture à partir des moyennes et des stocks.
 * Exportée pour les tests et pour l'IA.
 */
export function assess(
  need: Amounts,
  income: Amounts,
  stock: Amounts,
): Pick<Sustainability, 'days' | 'limiting' | 'coverage'> {
  let days: number | null = null
  let limiting: SustainResource | null = null
  let coverage: number | null = null
  for (const r of SUSTAIN_RESOURCES) {
    if (need[r] <= 1e-9) continue
    coverage = Math.min(coverage ?? Infinity, income[r] / need[r])
    const deficit = need[r] - income[r]
    if (deficit <= need[r] * SUSTAIN_TOLERANCE) continue
    const d = Math.max(0, stock[r]) / deficit
    if (d > SUSTAIN_MAX_DAYS) continue
    if (days === null || d < days) {
      days = d
      limiting = r
    }
  }
  return { days, limiting, coverage }
}

/** Une journée de mesure, à appeler après l'économie du jour (revenus et aide versés). */
export function updateSustainability(ctx: SimContext): void {
  const losses = measureLosses(ctx)
  if (!losses) return
  // Aide reçue la veille, matériel compris (il devient des unités équipées).
  const aid = new Map<CountryId, { production: number; munitions: number; equipment: number }>()
  for (const a of ctx.politics.aids) {
    const d = a.lastDay
    if (!d) continue
    const cur = aid.get(a.to) ?? { production: 0, munitions: 0, equipment: 0 }
    cur.production += d.production + d.equipment
    cur.munitions += d.munitions
    cur.equipment += d.equipment
    aid.set(a.to, cur)
  }
  for (const eco of ctx.economies.values()) {
    const l = losses.get(eco.country) ?? { reinforce: zero(), replace: zero() }
    const got = aid.get(eco.country) ?? { production: 0, munitions: 0, equipment: 0 }
    const today = {
      reinforce: l.reinforce,
      replace: l.replace,
      need: {
        production: l.reinforce.production + l.replace.production,
        munitions: eco.daily.munitionsSpent ?? 0,
        manpower: l.reinforce.manpower + l.replace.manpower,
      },
      income: {
        // La production du jour compte déjà l'aide en argent ; le matériel livré s'y ajoute.
        production: eco.daily.production + got.equipment,
        munitions: eco.daily.munitions,
        manpower: eco.daily.manpower,
      },
    }
    const prev = eco.sustain
    const samples = (prev?.samples ?? 0) + 1
    const a = Math.max(SUSTAIN_SMOOTHING, 1 / samples)
    const mix = (o: Amounts | undefined, v: Amounts): Amounts => ({
      production: blend(o?.production ?? v.production, v.production, a),
      munitions: blend(o?.munitions ?? v.munitions, v.munitions, a),
      manpower: blend(o?.manpower ?? v.manpower, v.manpower, a),
    })
    const need = mix(prev?.need, today.need)
    const income = mix(prev?.income, today.income)
    const reinforce = mix(prev?.reinforce, today.reinforce)
    const replace = mix(prev?.replace, today.replace)
    const aidAvg = {
      production: blend(prev?.aid.production ?? got.production, got.production, a),
      munitions: blend(prev?.aid.munitions ?? got.munitions, got.munitions, a),
    }
    const stock = { production: eco.production, munitions: eco.munitions, manpower: eco.manpower }
    eco.sustain = {
      samples,
      need,
      income,
      reinforce,
      replace,
      aid: aidAvg,
      ...assess(need, income, stock),
    }
  }
}

/** Soutenabilité d'un pays (null avant la deuxième journée économique). */
export function sustainabilityOf(ctx: SimContext, country: CountryId): Sustainability | null {
  return ctx.economies.get(country)?.sustain ?? null
}
