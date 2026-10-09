import type { ScenarioDef, ScenarioOptions } from '../core/types'
import type { TheaterData } from '../theater/grid'
import worldTable from '../data/world/countries.json'
import { ukraine2026 } from './ukraine-2026'
import { buildWorld2026, type WorldCountryRow } from './world-2026'

export interface ScenarioInfo {
  id: string
  name: string
  description: string
  theater: 'ukraine' | 'world'
  /** Pays jouables (tous les pays du théâtre si absent). */
  playable?: string[]
  defaultCountry: string
  /** Options proposées à l'écran de départ. */
  options: Array<keyof ScenarioOptions>
}

export const SCENARIOS: ScenarioInfo[] = [
  {
    id: 'world-2026',
    name: 'Monde 2026',
    description:
      'Tous les pays du monde. Choisissez le vôtre, la guerre russo-ukrainienne est en cours.',
    theater: 'world',
    defaultCountry: 'FRA',
    options: ['noAffiliations', 'noWars'],
  },
  {
    id: 'ukraine-2026',
    name: 'Ukraine – Russie (théâtre)',
    description: 'Le théâtre ukrainien seul, à grande échelle (cellules de 5 km).',
    theater: 'ukraine',
    playable: ['UKR', 'RUS'],
    defaultCountry: 'UKR',
    // Le théâtre est bâti autour de sa guerre (unités placées sur la ligne de front) : pas de
    // « Sans guerres de départ ».
    options: ['noAffiliations'],
  },
]

export const WORLD_TABLE = worldTable as unknown as {
  countries: WorldCountryRow[]
} & Omit<TheaterData, 'owner' | 'terrain'>

/**
 * Applique les options de l'écran de départ à la politique du scénario. Sans affiliations : ni
 * alliances, ni organisations, ni relations de départ (affinités, voisinage, tensions), ni sanctions,
 * ni aides ; restent les guerres, la stabilité, le soutien à la guerre et les forces armées.
 * Sans guerres : aucune guerre en cours, donc aucune mobilisation forcée au départ.
 */
export function applyOptions(def: ScenarioDef, options: ScenarioOptions = {}): ScenarioDef {
  const chosen: ScenarioOptions = {}
  if (options.noAffiliations) chosen.noAffiliations = true
  if (options.noWars) chosen.noWars = true
  if (!chosen.noAffiliations && !chosen.noWars) return def
  const politics = { ...def.politics }
  if (chosen.noAffiliations) {
    politics.relations = []
    politics.alliances = []
    politics.organizations = []
    politics.neighborRelation = 0
    politics.sanctions = []
    politics.aids = []
  }
  if (chosen.noWars) politics.wars = []
  return { ...def, politics, options: chosen }
}

/** Scénario prêt à jouer. Le pays du joueur et les options sont choisis au lancement. */
export function buildScenario(
  id: string,
  playerCountry?: string,
  options?: ScenarioOptions,
): ScenarioDef {
  const base = id === 'ukraine-2026' ? ukraine2026 : buildWorld2026(WORLD_TABLE.countries)
  const info = SCENARIOS.find((s) => s.id === id)
  // Seules les options proposées par le scénario sont appliquées.
  const allowed: ScenarioOptions = {}
  for (const key of info?.options ?? []) if (options?.[key]) allowed[key] = true
  return applyOptions(
    { ...base, playerCountry: playerCountry ?? info?.defaultCountry ?? base.playerCountry },
    allowed,
  )
}
