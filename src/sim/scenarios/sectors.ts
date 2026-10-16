import type { CountryId, LonLat } from '../core/types'
import {
  GEN_ARMY_CORPS,
  ordinal,
  type CountryForces,
  type ForceArmy,
  type ForceCorps,
} from './forces'
import sectorTable from '../data/real/front-sectors.json'
import commandTable from '../data/real/commands.json'

/**
 * Secteurs réels du front russo-ukrainien au départ (phase D3, étape « Scénarios ») : chaque corps
 * ukrainien et chaque armée russe dans sa direction du front, d'après les sources citées dans
 * src/sim/data/real/front-sectors.json. Les corps sont d'abord regroupés sous leurs commandements
 * réels (groupByCommand) ; chaque corps part dans sa direction. Une armée prend les directions de ses
 * corps et la sienne ;
 * sans direction connue, elle part en réserve derrière tout le front (formations dispersées : VDV,
 * infanterie navale, Garde nationale, défense territoriale) ; hors du front (Kaliningrad, Arménie, frontière nord…), elle reste en
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

interface CommandEntry {
  name: string
  corps: string[]
}
const COMMANDS = commandTable as unknown as Record<string, unknown>

/** Commandements réels d'un pays (vide s'ils ne sont pas connus). */
function commandsOf(country: CountryId): CommandEntry[] {
  const list = COMMANDS[country]
  return Array.isArray(list) ? (list as CommandEntry[]) : []
}

/** Rang de la direction d'une formation le long du front (ordre du fichier, du nord au sud ; inconnue : après). */
function frontRank(country: CountryId, name: string): number {
  const entries = TABLE[country] as Record<string, SectorEntry> | undefined
  const key = entries?.[name]?.sector
  const k = key ? Object.keys(TABLE.directions).indexOf(key) : -1
  return k < 0 ? Number.MAX_SAFE_INTEGER : k
}

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
 * Commandements réels au-dessus des corps (phase D3) : chaque commandement de
 * src/sim/data/real/commands.json devient une armée de jeu qui regroupe ses corps, dans l'ordre du front
 * (Ukraine : forces opérationnelles et tactiques). Les corps sans commandement connu restent dans leur
 * armée d'origine.
 */
export function groupByCommand(country: CountryId, forces: CountryForces): CountryForces {
  const list = commandsOf(country)
  if (list.length === 0) return forces
  const wanted = new Set(list.flatMap((c) => c.corps))
  const taken = new Map<string, ForceCorps>()
  const rest = forces.armies.map((a) => ({
    ...a,
    corps: a.corps.filter((c) => {
      if (!wanted.has(c.name)) return true
      taken.set(c.name, c)
      return false
    }),
  }))
  const commands: ForceArmy[] = list
    .map((c) => ({
      name: c.name,
      corps: c.corps
        .map((name) => taken.get(name))
        .filter((x): x is ForceCorps => !!x)
        .sort((a, b) => frontRank(country, a.name) - frontRank(country, b.name)),
      divisions: [],
    }))
    .filter((a) => a.corps.length > 0)
  return {
    ...forces,
    armies: [...commands, ...rest.filter((a) => a.corps.length > 0 || a.divisions.length > 0)],
  }
}

/**
 * Armées de plus de GEN_ARMY_CORPS corps sans échelon armée réel (armée de terre entière d'un pays,
 * corps ukrainiens sans commandement connu) : réparties en armées de jeu de taille voisine (à valider),
 * corps dans l'ordre du front s'il est connu. Les commandements réels gardent tous leurs corps.
 */
export function splitLargeArmies(country: CountryId, forces: CountryForces): CountryForces {
  const real = new Set(commandsOf(country).map((c) => c.name))
  const armies: ForceArmy[] = []
  for (const a of forces.armies) {
    if (real.has(a.name) || a.corps.length <= GEN_ARMY_CORPS) {
      armies.push(a)
      continue
    }
    const corps = [...a.corps].sort(
      (x, y) => frontRank(country, x.name) - frontRank(country, y.name),
    )
    const n = Math.ceil(corps.length / GEN_ARMY_CORPS)
    const size = Math.ceil(corps.length / n)
    for (let k = 0; k < n; k++) {
      armies.push({
        name: `${ordinal(k + 1)} armée (${a.name})`,
        corps: corps.slice(k * size, (k + 1) * size),
        divisions: [],
      })
    }
    // Divisions rattachées directement à l'armée : elles gardent son nom.
    if (a.divisions.length > 0) armies.push({ name: a.name, corps: [], divisions: a.divisions })
  }
  return { ...forces, armies }
}

/** Direction de départ de chaque corps des pays couverts (placement initial de ses brigades). */
function withCorpsSectors(country: CountryId, forces: CountryForces): CountryForces {
  return {
    ...forces,
    armies: forces.armies.map((a) => ({
      ...a,
      corps: a.corps.map((c) => {
        const p = directionOf(country, c.name)
        return Array.isArray(p) ? { ...c, sector: p } : c
      }),
    })),
  }
}

/**
 * Forces d'un pays au départ : corps regroupés sous leurs commandements réels, directions des corps
 * (pays aux secteurs connus), puis armées trop grandes réparties.
 */
export function sectorForces(country: CountryId, forces: CountryForces): CountryForces {
  const placed = SECTOR_COUNTRIES.includes(country)
    ? withCorpsSectors(country, groupByCommand(country, forces))
    : groupByCommand(country, forces)
  return splitLargeArmies(country, placed)
}
