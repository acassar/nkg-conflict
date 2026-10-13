import type { CountryId, LonLat } from '../core/types'
import type { CountryForces, ForceArmy } from './forces'
import sectorTable from '../data/real/front-sectors.json'

/**
 * Secteurs réels du front russo-ukrainien au départ (phase D3, étape « Scénarios ») : chaque corps
 * ukrainien et chaque armée russe dans sa direction du front, d'après les sources citées dans
 * src/sim/data/real/front-sectors.json. Une armée prend les directions de ses corps et la sienne ;
 * sans direction connue (ou hors du front), elle reste en garnison.
 */

interface SectorEntry {
  sector: string | null
}
interface SectorFile {
  directions: Record<string, { name: string; lon: number; lat: number; front?: boolean }>
  [country: string]: unknown
}

const TABLE = sectorTable as unknown as SectorFile

/** Direction d'une formation (null : inconnue ou hors du front). */
function directionOf(country: CountryId, name: string): LonLat | null {
  const entries = TABLE[country] as Record<string, SectorEntry> | undefined
  const key = entries?.[name]?.sector
  const d = key ? TABLE.directions[key] : undefined
  if (!d || d.front === false) return null
  return [d.lon, d.lat]
}

/** Ancres d'une armée : directions de l'armée et de ses corps, sans doublon. */
export function armyAnchors(country: CountryId, army: ForceArmy): LonLat[] {
  const out: LonLat[] = []
  for (const name of [army.name, ...army.corps.map((c) => c.name)]) {
    const p = directionOf(country, name)
    if (p && !out.some((q) => q[0] === p[0] && q[1] === p[1])) out.push(p)
  }
  return out
}

/** Pays dont les secteurs du front sont connus. */
export const SECTOR_COUNTRIES: CountryId[] = ['UKR', 'RUS']

/** Secteurs de départ des armées des pays couverts, par pays et nom d'armée. */
export function forceSectors(
  forces: Record<CountryId, CountryForces>,
): Record<CountryId, Record<string, LonLat[]>> {
  const out: Record<CountryId, Record<string, LonLat[]>> = {}
  for (const country of SECTOR_COUNTRIES) {
    const f = forces[country]
    if (!f) continue
    const map: Record<string, LonLat[]> = {}
    for (const a of f.armies) map[a.name] = armyAnchors(country, a)
    out[country] = map
  }
  return out
}

/** Forces limitées aux armées qui ont un secteur sur le front (théâtre ukrainien). */
export function frontOnly(country: CountryId, forces: CountryForces): CountryForces {
  return { ...forces, armies: forces.armies.filter((a) => armyAnchors(country, a).length > 0) }
}
