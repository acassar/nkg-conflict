import type {
  CountryDef,
  CountryId,
  ScenarioDef,
  ScenarioEconomy,
  ScenarioUnit,
  UnitKind,
} from '../core/types'
import { unitName } from '../units/names'

/** Génère un ordre de bataille numéroté, déployé automatiquement le long du front. */
function forces(owner: CountryId, counts: Record<UnitKind, number>): ScenarioUnit[] {
  const out: ScenarioUnit[] = []
  for (const kind of Object.keys(counts) as UnitKind[]) {
    for (let n = 1; n <= counts[kind]; n++) out.push({ owner, kind, name: unitName(kind, n) })
  }
  return out
}

/** Donneurs hors carte, présents par leur économie et leur diplomatie. */
const OFF_MAP: CountryDef[] = [
  { id: 'USA', name: 'États-Unis', color: [60, 90, 160], offMap: true },
  { id: 'DEU', name: 'Allemagne', color: [90, 90, 90], offMap: true },
  { id: 'GBR', name: 'Royaume-Uni', color: [130, 40, 70], offMap: true },
  { id: 'POL', name: 'Pologne', color: [200, 60, 90], offMap: true },
  { id: 'FRA', name: 'France', color: [70, 110, 200], offMap: true },
  { id: 'PRK', name: 'Corée du Nord', color: [150, 40, 40], offMap: true },
  { id: 'IRN', name: 'Iran', color: [40, 140, 80], offMap: true },
]

/** Revenus des donneurs : ce qu'ils peuvent céder dépend de leur industrie (part fixée par le niveau d'aide). */
const flows = (production: number, munitions: number): ScenarioEconomy => ({
  production: production * 20,
  munitions: munitions * 20,
  manpower: 0,
  productionPerDay: production,
  munitionsPerDay: munitions,
  manpowerPerDay: 0,
})

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
    // Pays hors carte : ils aident, négocient et peuvent être sollicités, sans territoire ni armée.
    ...OFF_MAP,
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
  // Apports hors théâtre : industrie et réserves hors carte des deux pays. L'aide étrangère passe par
  // les donneurs hors carte (voir `politics.aids`).
  economy: {
    UKR: {
      production: 1500,
      munitions: 1500,
      manpower: 60,
      productionPerDay: 26,
      munitionsPerDay: 12,
      manpowerPerDay: 1.2,
    },
    RUS: {
      production: 2000,
      munitions: 2000,
      manpower: 90,
      productionPerDay: 50,
      munitionsPerDay: 30,
      manpowerPerDay: 1.8,
    },
    USA: flows(140, 90),
    DEU: flows(80, 45),
    GBR: flows(70, 45),
    POL: flows(55, 40),
    FRA: flows(70, 45),
    PRK: flows(30, 45),
    IRN: flows(40, 25),
  },
  units: [
    ...forces('UKR', { inf: 10, mech: 5, tank: 3, art: 3, log: 2, hq: 2 }),
    ...forces('RUS', { inf: 10, mech: 6, tank: 5, art: 4, log: 2, hq: 2 }),
  ],
  politics: {
    wars: [{ name: 'Guerre russo-ukrainienne', attackers: ['RUS'], defenders: ['UKR'] }],
    warSupport: { UKR: 0.7, RUS: 0.55 },
    stability: { USA: 0.8, DEU: 0.8, GBR: 0.8, POL: 0.8, FRA: 0.75, PRK: 0.85, IRN: 0.7 },
    relations: [
      ['UKR', 'USA', 60],
      ['UKR', 'DEU', 55],
      ['UKR', 'GBR', 65],
      ['UKR', 'POL', 70],
      ['UKR', 'FRA', 55],
      ['UKR', 'PRK', -40],
      ['UKR', 'IRN', -30],
      ['RUS', 'USA', -55],
      ['RUS', 'DEU', -50],
      ['RUS', 'GBR', -60],
      ['RUS', 'POL', -65],
      ['RUS', 'FRA', -50],
      ['RUS', 'PRK', 60],
      ['RUS', 'IRN', 45],
      ['USA', 'PRK', -60],
      ['USA', 'IRN', -50],
    ],
    alliances: [
      { id: 'otan', name: 'OTAN', members: ['USA', 'DEU', 'GBR', 'POL', 'FRA'] },
      { id: 'rus-prk', name: 'Partenariat stratégique russo-nord-coréen', members: ['RUS', 'PRK'] },
    ],
    // Aides en cours au début de 2026, comme dans « Monde 2026 ». Hypothèses de jeu.
    aids: [
      { from: 'USA', to: 'UKR', level: 2 },
      { from: 'DEU', to: 'UKR', level: 2 },
      { from: 'GBR', to: 'UKR', level: 2 },
      { from: 'POL', to: 'UKR', level: 1 },
      { from: 'FRA', to: 'UKR', level: 1 },
      { from: 'PRK', to: 'RUS', level: 2 },
      { from: 'IRN', to: 'RUS', level: 1 },
    ],
  },
}
