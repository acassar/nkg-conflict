import type { ArmyState, LonLat, RecruitItem, UnitKind } from '../core/types'
import { distanceKm } from '../theater/grid'
import { RECRUIT_COSTS } from './rules'

/**
 * Recrutement par armée : répartition des formations entre les casernes du pays.
 * Fonctions pures, partagées par la simulation (commande) et l'interface (aperçu avant validation),
 * pour que l'aperçu annonce exactement les casernes que la commande utilisera.
 */

/** Ville de caserne candidate. */
export interface BarracksSite {
  name: string
  lon: number
  lat: number
  barracks: number
}

/** Commande : nombre d'unités voulues par type. */
export type RecruitOrder = Partial<Record<UnitKind, number>>

export interface RecruitPlanCity {
  name: string
  /** Formations de la commande envoyées dans cette ville. */
  count: number
  /** Distance au front (ou aux unités) de l'armée, en km. */
  distanceKm: number
  /** Formations qui doivent attendre qu'une caserne de la ville se libère. */
  waiting: number
}

export interface RecruitPlan {
  /** Formations dans l'ordre de la commande, avec leur ville. */
  items: { kind: UnitKind; city: string }[]
  cities: RecruitPlanCity[]
  production: number
  manpower: number
  /** Jours avant la sortie de la dernière recrue, au rythme maximal des casernes. */
  barracksDays: number
  /** Jours imposés par la production (stock et revenu quotidien), toute la file comprise. */
  productionDays: number
  /** Estimation retenue : le plus long des deux délais. */
  days: number
  /**
   * Formations de la commande couvertes par le stock de production actuel (après la file déjà
   * engagée) ; les suivantes attendent que la production rentre.
   */
  affordable: number
  /** Production qui manque pour toute la commande (0 si le stock suffit). */
  shortfall: number
  /** Jours avant l'arrivée de la dernière recrue au front : sortie de caserne, puis trajet. */
  arrivalDays: number
}

/** Vitesse de trajet supposée des recrues vers le front, pour départager les casernes (km par jour). */
export const RECRUIT_TRAVEL_KM_PER_DAY = 50
/** Points du front retenus au plus pour mesurer les distances (le tracé peut être long). */
const MAX_ANCHORS = 64

/** Points de référence d'une armée : son tracé de front, sinon la position de ses unités. */
export function armyAnchors(
  army: Pick<ArmyState, 'frontLine' | 'unitIds'>,
  unitPos: (id: number) => LonLat | undefined,
): LonLat[] {
  const line = (army.frontLine ?? []).flat()
  const points =
    line.length > 0 ? line : army.unitIds.map(unitPos).filter((p): p is LonLat => p !== undefined)
  if (points.length <= MAX_ANCHORS) return points
  const step = points.length / MAX_ANCHORS
  return Array.from({ length: MAX_ANCHORS }, (_, k) => points[Math.floor(k * step)] as LonLat)
}

function distanceTo(anchors: LonLat[], lon: number, lat: number): number {
  let best = anchors.length > 0 ? Infinity : 0
  for (const [x, y] of anchors) best = Math.min(best, distanceKm(x, y, lon, lat))
  return best
}

/** Jours restants d'une formation au rythme maximal de sa caserne. */
function remainingDays(item: Pick<RecruitItem, 'kind' | 'progress' | 'cost'>): number {
  return Math.max(
    1,
    Math.ceil(((item.cost - item.progress) / item.cost) * RECRUIT_COSTS[item.kind].days),
  )
}

/** Développe une commande en liste de types, dans l'ordre des types fourni. */
export function expandOrder(order: RecruitOrder, kinds: UnitKind[]): UnitKind[] {
  const list: UnitKind[] = []
  for (const kind of kinds) {
    const n = Math.max(0, Math.floor(order[kind] ?? 0))
    for (let k = 0; k < n; k++) list.push(kind)
  }
  return list
}

/**
 * Répartit une commande entre les casernes.
 * Choix de la ville : les formations déjà en file occupent les casernes de leur ville, et chaque
 * nouvelle recrue va là où elle rejoindrait l'armée le plus tôt (attente d'une caserne de la ville
 * + trajet estimé à 50 km par jour). Une caserne libre proche du front est donc prise d'abord,
 * la commande se répartit quand une seule ne suffit pas, et attend sinon.
 * Délai : règle de la simulation, les premières formations de la file avancent, autant que
 * le pays a de casernes.
 */
export function planArmyRecruit(input: {
  sites: BarracksSite[]
  queue: Pick<RecruitItem, 'kind' | 'city' | 'progress' | 'cost'>[]
  anchors: LonLat[]
  kinds: UnitKind[]
  stock: number
  productionPerDay: number
}): RecruitPlan {
  const { sites, queue, anchors, kinds } = input
  // Pour chaque ville : date de libération de chaque caserne, en jours.
  const slots = new Map<string, number[]>()
  const dist = new Map<string, number>()
  for (const s of sites) {
    if (s.barracks <= 0) continue
    slots.set(
      s.name,
      Array.from({ length: s.barracks }, () => 0),
    )
    dist.set(s.name, distanceTo(anchors, s.lon, s.lat))
  }
  const take = (free: number[], days: number): number => {
    let k = 0
    for (let j = 1; j < free.length; j++) if ((free[j] ?? 0) < (free[k] ?? 0)) k = j
    const start = free[k] ?? 0
    free[k] = start + days
    return start
  }
  // File commune du pays : autant de formations en cours que de casernes.
  const total = sites.reduce((n, s) => n + Math.max(0, s.barracks), 0)
  const shared = Array.from({ length: total }, () => 0)
  let queuedCost = 0
  for (const q of queue) {
    queuedCost += Math.max(0, q.cost - q.progress)
    const days = remainingDays(q)
    const free = slots.get(q.city)
    if (free) take(free, days)
    if (total > 0) take(shared, days)
  }

  const items: RecruitPlan['items'] = []
  const perCity = new Map<string, RecruitPlanCity>()
  let barracksDays = 0
  let production = 0
  let manpower = 0
  let affordable = 0
  let lastOut = 0
  const available = input.stock - queuedCost
  for (const kind of kinds) {
    const cost = RECRUIT_COSTS[kind]
    production += cost.production
    manpower += cost.manpower
    let best: string | null = null
    let bestScore = Infinity
    for (const [name, free] of slots) {
      const wait = Math.min(...free)
      const score = wait + (dist.get(name) ?? 0) / RECRUIT_TRAVEL_KM_PER_DAY
      if (score < bestScore - 1e-9) {
        best = name
        bestScore = score
      }
    }
    if (best === null) continue
    take(slots.get(best) as number[], cost.days)
    const start = take(shared, cost.days)
    barracksDays = Math.max(barracksDays, start + cost.days)
    if (production <= available) affordable++
    lastOut = Math.max(
      lastOut,
      start + cost.days + (dist.get(best) ?? 0) / RECRUIT_TRAVEL_KM_PER_DAY,
    )
    items.push({ kind, city: best })
    const entry = perCity.get(best) ?? {
      name: best,
      count: 0,
      distanceKm: Math.round(dist.get(best) ?? 0),
      waiting: 0,
    }
    entry.count++
    if (start > 0) entry.waiting++
    perCity.set(best, entry)
  }
  const missing = Math.max(0, queuedCost + production - input.stock)
  const productionDays =
    missing <= 0
      ? 0
      : input.productionPerDay > 0
        ? Math.ceil(missing / input.productionPerDay)
        : Infinity
  return {
    items,
    cities: [...perCity.values()].sort((a, b) => a.distanceKm - b.distanceKm),
    production,
    manpower,
    barracksDays,
    productionDays,
    days: Math.max(barracksDays, productionDays),
    affordable,
    shortfall: missing,
    // Trajet de la ville la plus lointaine utilisée, ajouté au délai de production s'il est plus long.
    arrivalDays: Math.ceil(
      Math.max(
        lastOut,
        productionDays +
          Math.max(0, ...items.map((i) => dist.get(i.city) ?? 0)) / RECRUIT_TRAVEL_KM_PER_DAY,
      ),
    ),
  }
}
