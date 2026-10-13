import type { CountryDef, ScenarioDef, ScenarioEconomy } from '../core/types'
import { countryForces } from './forces'
import { forceSectors, frontOnly, sectorForces } from './sectors'

/**
 * Ordres de bataille réels (phase D3) : toute l'armée ukrainienne, et les armées russes qui ont un
 * secteur sur le front ; chaque armée sur son secteur au départ.
 */
const FORCES = {
  UKR: sectorForces('UKR', countryForces('UKR')),
  RUS: frontOnly('RUS', sectorForces('RUS', countryForces('RUS'))),
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
 * Ligne de départ : frontières de facto des données Natural Earth. Ordres de bataille réels
 * (src/sim/data/real), limités à la carte.
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
  // Budget tiré du PIB (FMI) et des dépenses militaires (SIPRI), comme la carte du monde ; Ukraine en
  // guerre totale, Russie en mobilisation partielle au départ (conscription réelle) ; usines des villes du théâtre
  // plus usines hors carte (industrie du pays hors du théâtre, et part de l'industrie civile qui
  // travaille pour l'armée). La Russie n'a qu'une partie de son PIB sur la carte. L'aide étrangère
  // passe par les donneurs hors carte (voir `politics.aids`).
  economy: {
    UKR: {
      production: 1500,
      munitions: 1500,
      manpower: 60,
      productionPerDay: 0,
      munitionsPerDay: 0,
      manpowerPerDay: 1.2,
      gdpB: 212.9,
      popM: 39,
      defensePct: 39.6,
      warEconomy: 2,
      offMapFactories: { civ: 0, mil: 21 },
    },
    RUS: {
      production: 2000,
      munitions: 2000,
      manpower: 90,
      productionPerDay: 0,
      munitionsPerDay: 0,
      manpowerPerDay: 1.8,
      gdpB: 2587.9,
      gdpOnMap: 0.4,
      popM: 143.5,
      defensePct: 7.5,
      warEconomy: 1,
      offMapFactories: { civ: 0, mil: 25 },
    },
    USA: flows(140, 90),
    DEU: flows(80, 45),
    GBR: flows(70, 45),
    POL: flows(55, 40),
    FRA: flows(70, 45),
    PRK: flows(30, 45),
    IRN: flows(40, 25),
  },
  units: [],
  forces: FORCES,
  forceSectors: forceSectors(FORCES),
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
