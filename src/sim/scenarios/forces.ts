import type { CountryId, UnitKind } from '../core/types'
import { BRIGADE_TEMPLATES, brigadeProfile, divisionTemplateFor } from '../units/templates'
import forcesTable from '../data/forces.json'

/**
 * Forces de départ (phase D3, étape « Scénarios ») : ordre de bataille réel pour une trentaine de pays
 * (src/sim/data/real, compactés dans forces.json par scripts/build-forces.mjs), génération à partir des
 * effectifs réels pour les autres. Le résultat a la même forme dans les deux cas : armées, corps,
 * divisions et brigades nommés, chaque brigade avec son modèle (units/templates.ts).
 *
 * Règles (plan D3 et choix d'Adrien du 12 oct.) :
 * - deux régiments forment une brigade de jeu (un régiment seul en forme une) ;
 * - divisions de jeu : les brigades rattachées directement à un corps ou à une armée sont regroupées en
 *   divisions de 3 ou 4, nommées d'après leur formation et marquées comme créées par le jeu ;
 * - appuis (artillerie, génie, défense sol-air, soutien, aviation légère) : pas de division à eux ;
 *   répartis entre les divisions de leur corps ou de leur armée ;
 * - pays sans ordre de bataille : armée de terre = 60 % des forces armées (Banque mondiale), une brigade
 *   pour 4 500 hommes ; modèles selon la richesse ; divisions de 3 brigades, un corps dès 3 divisions,
 *   une seconde armée au-delà de 5 corps ;
 * - ordre de bataille de faible confiance : gardé s'il compte entre la moitié et le double des brigades
 *   de l'estimation automatique ; complété par des brigades générées s'il en compte moins de la moitié.
 */

/** Brigade : nom, type (modèle), échelon (« b » brigade, « r » régiment). */
type RawBrigade = [string, string, 'b' | 'r']
interface RawDivision {
  name: string
  type: string
  brigades: RawBrigade[]
}
interface RawCorps {
  name: string
  brigades: RawBrigade[]
  divisions: RawDivision[]
}
interface RawArmy {
  name: string
  generated: boolean
  brigades: RawBrigade[]
  corps: RawCorps[]
  divisions: RawDivision[]
}
export interface RawCountry {
  gdpB: number | null
  pop: number | null
  armedForces: number | null
  oob?: {
    asOf: string
    confidence: string
    armyPersonnel: number | null
    armies: RawArmy[]
  }
}

export interface ForceBrigade {
  name: string
  template: string
}
export interface ForceDivision {
  name: string
  template: string
  /** Division créée par le jeu (brigades rattachées directement à un corps ou une armée). */
  generated?: boolean
  brigades: ForceBrigade[]
}
export interface ForceCorps {
  name: string
  divisions: ForceDivision[]
}
export interface ForceArmy {
  name: string
  corps: ForceCorps[]
  /** Divisions sans corps. */
  divisions: ForceDivision[]
}
export interface CountryForces {
  /** Origine : ordre de bataille réel, génération, ou réel complété par la génération. */
  source: 'oob' | 'generated' | 'combined'
  armies: ForceArmy[]
  /**
   * Effectif de départ des brigades (part de leur effectif théorique) : effectif réel de l'armée de terre
   * rapporté à celui de ses brigades au complet, quand l'ordre de bataille le donne (1 sinon).
   */
  fill?: number
}

/** Effectif de départ minimal d'une brigade. */
export const MIN_FILL = 0.5

const TABLE = forcesTable as unknown as Record<CountryId, RawCountry>

/** Part de l'armée de terre dans les forces armées (pays sans ordre de bataille). */
export const LAND_SHARE = 0.6
/** Hommes par brigade de jeu (pays sans ordre de bataille). */
export const MEN_PER_BRIGADE = 4500
/** Brigades par division générée ; divisions par corps ; corps par armée. */
export const GEN_DIVISION_BRIGADES = 3
export const GEN_CORPS_DIVISIONS = 3
export const GEN_ARMY_CORPS = 5
/** Brigades de manœuvre au plus par division de jeu. */
const GAME_DIVISION_MAX = 4

/** Données réelles d'un pays (null : pays absent des données). */
export function rawCountry(code: CountryId): RawCountry | null {
  return TABLE[code] ?? null
}

const ordinal = (n: number, feminine = true): string =>
  n === 1 ? (feminine ? '1re' : '1er') : `${n}e`

const kindOf = (template: string): UnitKind => BRIGADE_TEMPLATES[template]?.kind ?? 'inf'

/** Appui : brigade sans place de manœuvre (artillerie, génie, sol-air, soutien, aviation légère). */
export function isSupportTemplate(template: string): boolean {
  return kindOf(template) === 'art' || template === 'genie'
}

/** Modèle connu, sinon infanterie motorisée (type absent des modèles). */
function knownTemplate(type: string): string {
  return BRIGADE_TEMPLATES[type] ? type : 'motorisee'
}

/** Deux régiments forment une brigade de jeu ; les brigades restent telles quelles. */
export function pairRegiments(list: RawBrigade[]): ForceBrigade[] {
  const out: ForceBrigade[] = []
  const pending = new Map<string, string>()
  for (const [name, type, echelon] of list) {
    const template = knownTemplate(type)
    if (echelon !== 'r') {
      out.push({ name, template })
      continue
    }
    const first = pending.get(template)
    if (first === undefined) {
      pending.set(template, name)
      continue
    }
    pending.delete(template)
    out.push({ name: `${first} et ${name}`, template })
  }
  for (const [template, name] of pending) out.push({ name, template })
  return out
}

/** Modèle de division le plus fréquent parmi ses brigades de manœuvre. */
function dominantDivisionTemplate(brigades: ForceBrigade[]): string {
  const count = new Map<string, number>()
  for (const b of brigades) {
    if (isSupportTemplate(b.template)) continue
    const t = divisionTemplateFor(b.template)
    count.set(t, (count.get(t) ?? 0) + 1)
  }
  let best = 'div_infanterie'
  let n = 0
  for (const [t, c] of count) {
    if (c > n) {
      best = t
      n = c
    }
  }
  return best
}

/** Modèle d'une division réelle d'après son type (« blindee » : division blindée). */
function divisionTemplateOfType(type: string, brigades: ForceBrigade[]): string {
  return type ? divisionTemplateFor(knownTemplate(type)) : dominantDivisionTemplate(brigades)
}

/** Répartit des appuis entre des divisions, à tour de rôle. */
function spreadSupport(support: ForceBrigade[], divisions: ForceDivision[]): void {
  if (divisions.length === 0) return
  for (const [k, b] of support.entries()) divisions[k % divisions.length]?.brigades.push(b)
}

/**
 * Divisions de jeu : brigades de manœuvre rattachées directement à une formation, en divisions de 3 ou 4
 * (« 1re division (3e corps d'armée) ») ; les appuis rejoignent ces divisions.
 */
export function gameDivisions(owner: string, brigades: ForceBrigade[]): ForceDivision[] {
  const maneuver = brigades.filter((b) => !isSupportTemplate(b.template))
  const support = brigades.filter((b) => isSupportTemplate(b.template))
  const out: ForceDivision[] = []
  if (maneuver.length > 0) {
    const count = Math.ceil(maneuver.length / GAME_DIVISION_MAX)
    const size = Math.ceil(maneuver.length / count)
    for (let k = 0; k < count; k++) {
      const part = maneuver.slice(k * size, (k + 1) * size)
      if (part.length === 0) continue
      out.push({
        name: `${ordinal(out.length + 1)} division (${owner})`,
        template: dominantDivisionTemplate(part),
        generated: true,
        brigades: part,
      })
    }
  } else if (support.length > 0) {
    // Seulement des appuis : une division d'appui, à défaut d'autre.
    out.push({
      name: `${ordinal(1)} division (${owner})`,
      template: 'div_infanterie',
      generated: true,
      brigades: [],
    })
  }
  spreadSupport(support, out)
  return out
}

/** Convertit un ordre de bataille réel. */
function fromOob(armies: RawArmy[]): ForceArmy[] {
  const out: ForceArmy[] = []
  for (const a of armies) {
    const army: ForceArmy = { name: a.name, corps: [], divisions: [] }
    for (const c of a.corps) {
      const real = c.divisions.map((d) => {
        const brigades = pairRegiments(d.brigades)
        return {
          name: d.name,
          template: divisionTemplateOfType(d.type, brigades),
          brigades,
        }
      })
      const direct = pairRegiments(c.brigades)
      // Appuis du corps : à ses divisions réelles s'il en a, sinon aux divisions de jeu.
      const divisions =
        real.length > 0 && direct.every((b) => isSupportTemplate(b.template))
          ? (spreadSupport(direct, real), real)
          : [...real, ...gameDivisions(c.name, direct)]
      const kept = divisions.filter((d) => d.brigades.length > 0)
      if (kept.length > 0) army.corps.push({ name: c.name, divisions: kept })
    }
    const real = a.divisions
      .map((d) => {
        const brigades = pairRegiments(d.brigades)
        return { name: d.name, template: divisionTemplateOfType(d.type, brigades), brigades }
      })
      .filter((d) => d.brigades.length > 0)
    const direct = pairRegiments(a.brigades)
    const all = [...real, ...army.corps.flatMap((c) => c.divisions)]
    if (all.length > 0 && direct.every((b) => isSupportTemplate(b.template))) {
      // Appuis d'armée : répartis entre toutes ses divisions.
      spreadSupport(direct, all)
      army.divisions = real
    } else {
      army.divisions = [...real, ...gameDivisions(a.name, direct)]
    }
    army.divisions = army.divisions.filter((d) => d.brigades.length > 0)
    if (army.corps.length > 0 || army.divisions.length > 0) out.push(army)
  }
  return out
}

/** Répartition des modèles de brigade générés selon la richesse (PIB par habitant). */
export function generatedMix(gdpPerCapita: number): Array<[string, number]> {
  if (gdpPerCapita >= 25_000) {
    return [
      ['mecanisee', 0.35],
      ['blindee', 0.15],
      ['motorisee', 0.2],
      ['infanterie_legere', 0.1],
      ['artillerie', 0.2],
    ]
  }
  if (gdpPerCapita >= 8_000) {
    return [
      ['mecanisee', 0.2],
      ['blindee', 0.1],
      ['motorisee', 0.35],
      ['infanterie_legere', 0.2],
      ['artillerie', 0.15],
    ]
  }
  return [
    ['mecanisee', 0.05],
    ['blindee', 0.05],
    ['motorisee', 0.25],
    ['infanterie_legere', 0.5],
    ['artillerie', 0.15],
  ]
}

/** Brigades d'une armée générée : effectifs de l'armée de terre ÷ 4 500 (au moins 1). */
export function generatedBrigadeCount(raw: RawCountry): number {
  const land = raw.oob?.armyPersonnel ?? LAND_SHARE * (raw.armedForces ?? 0)
  return Math.max(1, Math.round(land / MEN_PER_BRIGADE))
}

/** Modèles de `n` brigades selon la répartition (plus forts restes), les plus nombreux d'abord. */
function templatesFor(n: number, mix: Array<[string, number]>): string[] {
  const counts = mix.map(([t, share]) => ({ t, exact: n * share, n: Math.floor(n * share) }))
  let left = n - counts.reduce((s, c) => s + c.n, 0)
  for (const c of [...counts].sort((a, b) => b.exact - b.n - (a.exact - a.n))) {
    if (left <= 0) break
    c.n++
    left--
  }
  return counts.flatMap((c) => Array.from({ length: c.n }, () => c.t))
}

/**
 * Armée générée : `n` brigades de modèles selon la richesse, en divisions de 3 (une d'artillerie quand
 * il y en a), un corps dès 3 divisions, une seconde armée au-delà de 5 corps. Un petit pays a une seule
 * armée, sans corps.
 */
export function generateForces(n: number, gdpPerCapita: number, start = 1): ForceArmy[] {
  const templates = templatesFor(n, generatedMix(gdpPerCapita))
  const maneuver = templates.filter((t) => !isSupportTemplate(t))
  const support = templates.filter((t) => isSupportTemplate(t))
  const numbers = new Map<string, number>()
  const brigade = (template: string): ForceBrigade => {
    const k = (numbers.get(template) ?? start - 1) + 1
    numbers.set(template, k)
    const name = BRIGADE_TEMPLATES[template]?.name ?? 'Brigade'
    return { name: `${ordinal(k)} ${name.charAt(0).toLowerCase()}${name.slice(1)}`, template }
  }
  // Divisions de 3 brigades : deux de manœuvre et une d'artillerie tant qu'il y en a, sinon trois de
  // manœuvre (les brigades d'un même modèle ensemble).
  const divisions: ForceDivision[] = []
  let m = 0
  let s = 0
  while (m < maneuver.length || s < support.length) {
    const withSupport = s < support.length && m < maneuver.length
    const take = withSupport ? GEN_DIVISION_BRIGADES - 1 : GEN_DIVISION_BRIGADES
    const part = (
      m < maneuver.length ? maneuver.slice(m, m + take) : support.slice(s, s + take)
    ).map(brigade)
    if (m < maneuver.length) m += take
    else s += take
    if (withSupport) part.push(brigade(support[s++] ?? 'artillerie'))
    divisions.push({
      name: `${ordinal(divisions.length + start)} division`,
      template: dominantDivisionTemplate(part),
      brigades: part,
    })
  }
  if (divisions.length < GEN_CORPS_DIVISIONS) {
    return [{ name: `${ordinal(start)} armée`, corps: [], divisions }]
  }
  const corps: ForceCorps[] = []
  for (let k = 0; k < divisions.length; k += GEN_CORPS_DIVISIONS) {
    corps.push({
      name: `${romanOrdinal(corps.length + 1)} corps`,
      divisions: divisions.slice(k, k + GEN_CORPS_DIVISIONS),
    })
  }
  // Un reste de 1 ou 2 divisions rejoint le corps précédent.
  const last = corps[corps.length - 1]
  if (corps.length > 1 && last && last.divisions.length < GEN_CORPS_DIVISIONS) {
    corps.pop()
    corps[corps.length - 1]?.divisions.push(...last.divisions)
  }
  const armies: ForceArmy[] = []
  for (let k = 0; k < corps.length; k += GEN_ARMY_CORPS) {
    armies.push({
      name: `${ordinal(armies.length + start)} armée`,
      corps: corps.slice(k, k + GEN_ARMY_CORPS),
      divisions: [],
    })
  }
  return armies
}

function romanOrdinal(n: number): string {
  const table: Array<[number, string]> = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ]
  let out = ''
  let left = n
  for (const [v, s] of table) {
    while (left >= v) {
      out += s
      left -= v
    }
  }
  return `${out}${n === 1 ? 'er' : 'e'}`
}

/** Nombre de brigades d'un ensemble d'armées. */
export function brigadeCount(armies: ForceArmy[]): number {
  let n = 0
  for (const a of armies) {
    for (const d of a.divisions) n += d.brigades.length
    for (const c of a.corps) for (const d of c.divisions) n += d.brigades.length
  }
  return n
}

/** PIB par habitant, en dollars (0 si inconnu). */
function perCapita(raw: RawCountry, fallbackGdpB = 0, fallbackPop = 0): number {
  const gdp = (raw.gdpB ?? fallbackGdpB) * 1e9
  const pop = raw.pop ?? fallbackPop
  return pop > 0 ? gdp / pop : 0
}

/**
 * Forces de départ d'un pays. `fallback` : PIB et population de la carte, pour un pays sans données
 * réelles.
 */
export function countryForces(
  code: CountryId,
  fallback: { gdpB: number; pop: number } = { gdpB: 0, pop: 0 },
): CountryForces {
  const raw = rawCountry(code) ?? { gdpB: null, pop: null, armedForces: null }
  const wealth = perCapita(raw, fallback.gdpB, fallback.pop)
  const oob = raw.oob ? fromOob(raw.oob.armies) : []
  if (oob.length === 0) {
    const n = raw.armedForces ? generatedBrigadeCount(raw) : 1
    return { source: 'generated', armies: generateForces(n, wealth) }
  }
  if (raw.oob?.confidence === 'faible') {
    const real = brigadeCount(oob)
    const estimate = generatedBrigadeCount(raw)
    if (real * 2 < estimate) {
      // Ordre de bataille réel trop maigre : complété par une armée générée.
      const extra = generateForces(estimate - real, wealth, oob.length + 1)
      return { source: 'combined', armies: [...oob, ...extra] }
    }
  }
  return { source: 'oob', armies: oob, fill: fillOf(raw.oob?.armyPersonnel ?? null, oob) }
}

/** Effectif réel / effectif des brigades au complet, entre MIN_FILL et 1 (1 sans effectif réel). */
export function fillOf(personnel: number | null, armies: ForceArmy[]): number {
  if (!personnel) return 1
  let nominal = 0
  for (const a of armies) {
    const walk = (d: ForceDivision): void => {
      for (const b of d.brigades) nominal += brigadeProfile(b.template).men
    }
    a.divisions.forEach(walk)
    for (const c of a.corps) c.divisions.forEach(walk)
  }
  if (nominal === 0) return 1
  return Math.max(MIN_FILL, Math.min(1, personnel / nominal))
}

/** Unités levées pour ces forces : leurs brigades (QG et logistique sont intégrés, sans pion). */
export function forceUnits(forces: CountryForces): number {
  return brigadeCount(forces.armies)
}
