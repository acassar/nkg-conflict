import type { ScenarioDef } from '../core/types'
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
}

export const SCENARIOS: ScenarioInfo[] = [
  {
    id: 'world-2026',
    name: 'Monde 2026',
    description:
      'Tous les pays du monde. Choisissez le vôtre, la guerre russo-ukrainienne est en cours.',
    theater: 'world',
    defaultCountry: 'FRA',
  },
  {
    id: 'ukraine-2026',
    name: 'Ukraine – Russie (théâtre)',
    description: 'Le théâtre ukrainien seul, à grande échelle (cellules de 5 km).',
    theater: 'ukraine',
    playable: ['UKR', 'RUS'],
    defaultCountry: 'UKR',
  },
]

export const WORLD_TABLE = worldTable as unknown as {
  countries: WorldCountryRow[]
} & Omit<TheaterData, 'owner' | 'terrain'>

/** Scénario prêt à jouer. Le pays du joueur est choisi au lancement. */
export function buildScenario(id: string, playerCountry?: string): ScenarioDef {
  const base = id === 'ukraine-2026' ? ukraine2026 : buildWorld2026(WORLD_TABLE.countries)
  const info = SCENARIOS.find((s) => s.id === id)
  return { ...base, playerCountry: playerCountry ?? info?.defaultCountry ?? base.playerCountry }
}
