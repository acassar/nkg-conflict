import { sideIndex, type SimContext } from '../context'
import { frontCells } from '../systems/armies'
import { SOURCE_RADIUS_KM } from '../systems/supply'
import type { BuildingKind, CountryId } from '../core/types'
import { distanceKm } from '../theater/grid'
import { citiesOf } from './economy'
import { BUILDINGS, FORT_RADIUS_KM } from './rules'

/**
 * Conseils de construction « quoi, puis où » : pour un bâtiment choisi, les villes du joueur les
 * mieux placées, avec la raison. Calculé par le Worker à la demande, sans effet sur la partie.
 * Les usines, quand elles seront posées librement sur le territoire (budget national, phase F),
 * recevront des emplacements conseillés : `BuildAdvice` porte déjà une position.
 */
export interface BuildAdvice {
  city: string
  lon: number
  lat: number
  /** Distance au front en km (null sans front : pays en paix). */
  frontKm: number | null
  /** Unités du pays à portée du bâtiment (fortification, dépôt), sinon 0. */
  unitsInRange: number
  /** Places libres dans la ville pour ce bâtiment, chantiers en cours déduits. */
  free: number
  risk: 'élevé' | 'moyen' | 'faible' | null
  /** Raisons courtes, dans l'ordre d'importance. */
  reasons: string[]
  score: number
}

/** Distance au front sous laquelle une ville risque d'être prise. */
export const RISK_HIGH_KM = 30
export const RISK_MEDIUM_KM = 100

/** Portée utile du bâtiment pour compter les unités (0 : sans objet). */
function rangeKm(kind: BuildingKind): number {
  if (kind === 'fort') return FORT_RADIUS_KM
  if (kind === 'depot') return SOURCE_RADIUS_KM
  return 0
}

/** Note d'une ville pour un bâtiment ; plus haut vaut mieux. */
function scoreOf(kind: BuildingKind, a: Omit<BuildAdvice, 'reasons' | 'score'>, pop: number) {
  const size = Math.log10(Math.max(pop, 1e4)) - 4 // 0 à 10 000 hab., 3 à 10 M
  const d = a.frontKm
  switch (kind) {
    case 'fort':
      // Près du front, là où se tiennent les unités.
      return a.unitsInRange * 2 + (d === null ? 0 : d < 60 ? 6 : d < 150 ? 2 : 0) + size
    case 'depot':
      // Une source de ravitaillement juste derrière la ligne.
      return (
        a.unitsInRange + (d === null ? 0 : d < 10 ? 1 : d < 80 ? 6 : d < 200 ? 3 : 0) + size * 0.5
      )
    case 'barracks':
      // Assez près pour que les recrues arrivent vite, assez loin pour ne pas être prise.
      return (d === null ? 2 : d < 40 ? 0 : d < 300 ? 5 : 2) + size + a.free * 0.2
    case 'civ':
    case 'mil':
      // Loin du front : une usine perdue coûte des mois.
      return (
        (d === null ? 4 : d < RISK_HIGH_KM ? -4 : d < RISK_MEDIUM_KM ? 1 : 5) + size + a.free * 0.1
      )
  }
}

function reasonsOf(kind: BuildingKind, a: Omit<BuildAdvice, 'reasons' | 'score'>): string[] {
  const out: string[] = []
  const d = a.frontKm
  out.push(d === null ? 'pas de front' : `à ${Math.round(d)} km du front`)
  if (rangeKm(kind) > 0) {
    out.push(
      a.unitsInRange === 0
        ? `aucune unité à ${rangeKm(kind)} km`
        : `${a.unitsInRange} unité${a.unitsInRange > 1 ? 's' : ''} à portée`,
    )
  }
  const max = BUILDINGS[kind].maxPerCity
  if (max > 1) out.push(`${a.free} place${a.free > 1 ? 's' : ''} libre${a.free > 1 ? 's' : ''}`)
  if (a.risk) out.push(`risque de prise ${a.risk}`)
  return out
}

/** Les `count` villes conseillées pour construire `kind`, de la meilleure à la moins bonne. */
export function adviseBuild(
  ctx: SimContext,
  country: CountryId,
  kind: BuildingKind,
  count = 3,
): BuildAdvice[] {
  const eco = ctx.economies.get(country)
  if (!eco) return []
  const side = sideIndex(ctx, country)
  const g = ctx.grid
  // Échantillon du front (200 cellules au plus), comme l'économie de l'IA.
  const cells = frontCells(ctx, side, null)
  const step = Math.max(1, Math.floor(cells.length / 200))
  const front: Array<[number, number]> = []
  for (let k = 0; k < cells.length; k += step) {
    const c = cells[k]
    if (c) front.push([g.lonOf(c.cell), g.latOf(c.cell)])
  }
  const range = rangeKm(kind)
  const own = range > 0 ? [...ctx.units.values()].filter((u) => u.owner === country) : []
  const type = BUILDINGS[kind]
  const out: BuildAdvice[] = []
  for (const c of citiesOf(ctx, country)) {
    const queued = eco.construction.filter((q) => q.city === c.def.name && q.kind === kind).length
    const free = type.maxPerCity - c.buildings[kind] - queued
    if (free <= 0) continue
    let frontKm: number | null = null
    for (const [lon, lat] of front) {
      const dist = distanceKm(c.def.lon, c.def.lat, lon, lat)
      if (frontKm === null || dist < frontKm) frontKm = dist
    }
    let unitsInRange = 0
    for (const u of own) if (distanceKm(c.def.lon, c.def.lat, u.lon, u.lat) <= range) unitsInRange++
    const risk: BuildAdvice['risk'] =
      frontKm === null
        ? null
        : frontKm < RISK_HIGH_KM
          ? 'élevé'
          : frontKm < RISK_MEDIUM_KM
            ? 'moyen'
            : 'faible'
    const base = {
      city: c.def.name,
      lon: c.def.lon,
      lat: c.def.lat,
      frontKm,
      unitsInRange,
      free,
      risk,
    }
    out.push({ ...base, reasons: reasonsOf(kind, base), score: scoreOf(kind, base, c.def.pop) })
  }
  return out.sort((a, b) => b.score - a.score || a.city.localeCompare(b.city)).slice(0, count)
}
