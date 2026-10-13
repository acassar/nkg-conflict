import type { CountryId, LonLat } from '../core/types'
import type { CountryForces, ForceArmy } from './forces'
import sectorTable from '../data/real/front-sectors.json'

/**
 * Secteurs réels du front russo-ukrainien au départ (phase D3, étape « Scénarios ») : chaque corps
 * ukrainien et chaque armée russe dans sa direction du front, d'après les sources citées dans
 * src/sim/data/real/front-sectors.json. Une armée prend les directions de ses corps et la sienne ;
 * sans direction connue, elle couvre tout le front (formations dispersées : VDV, infanterie navale,
 * défense territoriale) ; hors du front (Kaliningrad, Arménie, frontière nord…), elle reste en
 * garnison.
 */

interface SectorEntry {
  sector: string | null
}
interface SectorFile {
  directions: Record<
    string,
    { name: string; lon: number | null; lat: number | null; front?: boolean }
  >
  [country: string]: unknown
}

const TABLE = sectorTable as unknown as SectorFile

/** Direction d'une formation : point du front, 'off' hors du front, null inconnue. */
function directionOf(country: CountryId, name: string): LonLat | 'off' | null {
  const entries = TABLE[country] as Record<string, SectorEntry> | undefined
  const key = entries?.[name]?.sector
  const d = key ? TABLE.directions[key] : undefined
  if (!d) return null
  if (d.front === false || d.lon === null || d.lat === null) return 'off'
  return [d.lon, d.lat]
}

/**
 * Ancres d'une armée : directions de l'armée et de ses corps sur le front, sans doublon ; liste vide
 * si aucune n'est connue (tout le front) ; null si l'armée est hors du front.
 */
export function armyAnchors(country: CountryId, army: ForceArmy): LonLat[] | null {
  const out: LonLat[] = []
  let off = false
  for (const name of [army.name, ...army.corps.map((c) => c.name)]) {
    const p = directionOf(country, name)
    if (p === 'off') off = true
    else if (p && !out.some((q) => q[0] === p[0] && q[1] === p[1])) out.push(p)
  }
  return out.length === 0 && off ? null : out
}

/** Pays dont les secteurs du front sont connus. */
export const SECTOR_COUNTRIES: CountryId[] = ['UKR', 'RUS']

/** Secteurs de départ des armées des pays couverts, par pays et nom d'armée (absente : garnison). */
export function forceSectors(
  forces: Record<CountryId, CountryForces>,
): Record<CountryId, Record<string, LonLat[]>> {
  const out: Record<CountryId, Record<string, LonLat[]>> = {}
  for (const country of SECTOR_COUNTRIES) {
    const f = forces[country]
    if (!f) continue
    const map: Record<string, LonLat[]> = {}
    for (const a of f.armies) {
      const anchors = armyAnchors(country, a)
      if (anchors) map[a.name] = anchors
    }
    out[country] = map
  }
  return out
}

/** Forces limitées aux armées engagées sur le front (théâtre ukrainien). */
export function frontOnly(country: CountryId, forces: CountryForces): CountryForces {
  return { ...forces, armies: forces.armies.filter((a) => armyAnchors(country, a) !== null) }
}

/**
 * Armées dont les corps tiennent des secteurs différents (Forces terrestres ukrainiennes) : chaque corps
 * qui a son secteur devient une armée en jeu, à son nom, pour partir sur sa portion de front ; le reste
 * (corps sans secteur, divisions et brigades rattachées à l'armée) garde le nom de l'armée.
 */
export function splitBySector(country: CountryId, forces: CountryForces): CountryForces {
  const armies: ForceArmy[] = []
  for (const a of forces.armies) {
    const placed = a.corps.filter((c) => directionOf(country, c.name) !== null)
    const keys = new Set(placed.map((c) => JSON.stringify(directionOf(country, c.name))))
    if (keys.size < 2) {
      armies.push(a)
      continue
    }
    for (const c of placed) armies.push({ name: c.name, corps: [c], divisions: [] })
    const rest = a.corps.filter((c) => !placed.includes(c))
    if (rest.length > 0 || a.divisions.length > 0) {
      armies.push({ name: a.name, corps: rest, divisions: a.divisions })
    }
  }
  return { ...forces, armies }
}

/** Forces d'un pays, découpées par secteur s'il en a (sinon inchangées). */
export function sectorForces(country: CountryId, forces: CountryForces): CountryForces {
  return SECTOR_COUNTRIES.includes(country) ? splitBySector(country, forces) : forces
}
