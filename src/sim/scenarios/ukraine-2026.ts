import type { CountryId, ScenarioDef, ScenarioUnit, UnitKind } from '../core/types'

const KIND_NAMES: Record<UnitKind, { name: string; feminine: boolean }> = {
  inf: { name: "brigade d'infanterie", feminine: true },
  mech: { name: 'brigade mécanisée', feminine: true },
  tank: { name: 'brigade blindée', feminine: true },
  art: { name: "brigade d'artillerie", feminine: true },
  log: { name: 'groupement logistique', feminine: false },
  hq: { name: 'état-major', feminine: false },
}

/** Génère un ordre de bataille numéroté, déployé automatiquement le long du front. */
function forces(owner: CountryId, counts: Record<UnitKind, number>): ScenarioUnit[] {
  const out: ScenarioUnit[] = []
  for (const kind of Object.keys(counts) as UnitKind[]) {
    for (let n = 1; n <= counts[kind]; n++) {
      const { name, feminine } = KIND_NAMES[kind]
      const ordinal = n === 1 ? (feminine ? '1re' : '1er') : `${n}e`
      out.push({ owner, kind, name: `${ordinal} ${name}` })
    }
  }
  return out
}

/**
 * Scénario de la tranche jouable : Ukraine – Russie, époque moderne.
 * Scénario hypothétique de jeu, sans prétention de reconstitution historique.
 * Ligne de départ : frontières de facto des données Natural Earth. Ordres de bataille fictifs.
 */
export const ukraine2026: ScenarioDef = {
  id: 'ukraine-2026',
  name: 'Ukraine – Russie',
  epoch: 'modern',
  theater: 'ukraine',
  startDate: '2026-01-01T00:00:00Z',
  playerCountry: 'UKR',
  countries: [
    { id: 'UKR', name: 'Ukraine', color: [37, 99, 235] },
    { id: 'RUS', name: 'Russie', color: [220, 38, 38] },
  ],
  supplySources: {
    UKR: [
      [24.03, 49.84],
      [30.52, 50.45],
      [30.73, 46.48],
    ],
    RUS: [
      [37.62, 55.75],
      [39.2, 51.66],
      [39.72, 47.23],
      [34.1, 44.95],
    ],
  },
  units: [
    ...forces('UKR', { inf: 10, mech: 5, tank: 3, art: 3, log: 2, hq: 2 }),
    ...forces('RUS', { inf: 10, mech: 6, tank: 5, art: 4, log: 2, hq: 2 }),
  ],
}
