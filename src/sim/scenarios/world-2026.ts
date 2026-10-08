import type { CountryDef, CountryId, ScenarioDef, ScenarioEconomy } from '../core/types'
import { forceSizeOf } from '../politics/mobilization'

export interface WorldCountryRow {
  code: CountryId
  name: string
  pop: number
  gdpB: number
  continent: string
  mapColor: number
  label: [number, number]
}

/** Palette des pays neutres (familles de couleur Natural Earth, voisins toujours différents). */
const MAP_PALETTE: Array<[number, number, number]> = [
  [181, 167, 140],
  [158, 176, 140],
  [190, 160, 160],
  [150, 165, 185],
  [196, 182, 128],
  [170, 150, 180],
  [140, 175, 170],
  [185, 170, 150],
  [160, 160, 160],
]

/**
 * Militarisation : correction du nombre d'unités levées par rapport à la seule taille de l'économie.
 * Estimations de jeu, à équilibrer.
 */
const MILITARIZATION: Record<CountryId, number> = {
  RUS: 1.6,
  UKR: 1.8,
  PRK: 3,
  ISR: 1.6,
  IRN: 1.4,
  CHN: 1.2,
  USA: 1.1,
  IND: 1.1,
  PAK: 1.4,
  TUR: 1.2,
  KOR: 1.3,
  BLR: 1.3,
  SAU: 1.2,
  EGY: 1.2,
  TWN: 1.3,
  ARM: 1.3,
  AZE: 1.3,
}

/** OTAN et OTSC (membres au début de 2026). */
const NATO: CountryId[] = [
  'ALB',
  'BEL',
  'BGR',
  'CAN',
  'HRV',
  'CZE',
  'DNK',
  'EST',
  'FIN',
  'FRA',
  'DEU',
  'GRC',
  'HUN',
  'ISL',
  'ITA',
  'LVA',
  'LTU',
  'LUX',
  'MNE',
  'NLD',
  'MKD',
  'NOR',
  'POL',
  'PRT',
  'ROU',
  'SVK',
  'SVN',
  'ESP',
  'SWE',
  'TUR',
  'GBR',
  'USA',
]
const CSTO: CountryId[] = ['RUS', 'BLR', 'KAZ', 'KGZ', 'TJK']

/** Tensions de départ (relations négatives). Hypothèses de jeu. */
const TENSIONS: Array<[CountryId, CountryId, number]> = [
  ['PRK', 'KOR', -70],
  ['IND', 'PAK', -55],
  ['ISR', 'IRN', -75],
  ['ARM', 'AZE', -55],
  ['CHN', 'TWN', -60],
  ['SRB', 'KOS', -45],
  ['ETH', 'ERI', -40],
  ['VEN', 'GUY', -35],
  ['SDN', 'SDS', -40],
  ['MAR', 'DZA', -35],
  ['CYP', 'CYN', -40],
  ['USA', 'IRN', -50],
  ['USA', 'PRK', -60],
  ['CHN', 'IND', -20],
  ['CHN', 'USA', -25],
]

/** Aides en cours au début de 2026 (niveau 1 limitée, 2 soutenue, 3 massive). Hypothèses de jeu. */
const AIDS_2026: Array<{ from: CountryId; to: CountryId; level: 1 | 2 | 3 }> = [
  ...(['USA', 'DEU', 'GBR'] as const).map((from) => ({ from, to: 'UKR', level: 2 as const })),
  ...(['POL', 'FRA', 'NLD', 'CAN', 'SWE', 'DNK', 'NOR', 'ITA', 'FIN'] as const).map((from) => ({
    from,
    to: 'UKR',
    level: 1 as const,
  })),
  { from: 'PRK', to: 'RUS', level: 2 },
  { from: 'IRN', to: 'RUS', level: 1 },
]

function economyOf(row: WorldCountryRow): ScenarioEconomy {
  const popM = row.pop / 1e6
  const gdp = Math.max(0, row.gdpB)
  return {
    production: Math.round(300 + 20 * Math.sqrt(gdp)),
    munitions: Math.round(300 + 15 * Math.sqrt(gdp)),
    manpower: Math.round(10 + 0.6 * popM),
    productionPerDay: Math.round(5 + 1.2 * Math.sqrt(gdp)),
    munitionsPerDay: Math.round(4 + Math.sqrt(gdp)),
    manpowerPerDay: Math.round((0.2 + 0.01 * popM) * 10) / 10,
  }
}

/**
 * Scénario « Monde 2026 » : tous les pays de la carte, au choix du joueur.
 * Scénario hypothétique de jeu, sans prétention de reconstitution historique.
 */
export function buildWorld2026(rows: WorldCountryRow[]): ScenarioDef {
  const countries: CountryDef[] = rows.map((r) => ({
    id: r.code,
    name: r.name,
    color: MAP_PALETTE[(r.mapColor - 1 + MAP_PALETTE.length) % MAP_PALETTE.length] ?? [
      160, 160, 160,
    ],
    label: r.label,
    mapColor: r.mapColor,
    pop: r.pop,
    gdpB: r.gdpB,
  }))
  const economy: Record<CountryId, ScenarioEconomy> = {}
  const forceSize: Record<CountryId, number> = {}
  for (const r of rows) {
    economy[r.code] = economyOf(r)
    forceSize[r.code] = forceSizeOf(r.gdpB, r.pop / 1e6, MILITARIZATION[r.code] ?? 1)
  }
  const relations: Array<[CountryId, CountryId, number]> = [...TENSIONS]
  const pairs = (list: CountryId[], v: number): void => {
    for (const a of list) for (const b of list) if (a < b) relations.push([a, b, v])
  }
  pairs(NATO, 60)
  pairs(CSTO, 60)
  for (const n of NATO) relations.push([n, 'RUS', -50], [n, 'UKR', 40], [n, 'BLR', -35])
  relations.push(['RUS', 'CHN', 40], ['RUS', 'IRN', 35], ['RUS', 'PRK', 40])

  return {
    id: 'world-2026',
    name: 'Monde 2026',
    epoch: 'modern',
    theater: 'world',
    startDate: '2026-01-01T00:00:00Z',
    playerCountry: 'FRA',
    countries,
    supplySources: {},
    economy,
    units: [],
    politics: {
      forceSize,
      relations,
      alliances: [
        { id: 'nato', name: 'OTAN', members: NATO.filter((c) => economy[c]) },
        { id: 'csto', name: 'OTSC', members: CSTO.filter((c) => economy[c]) },
      ],
      wars: [{ name: 'Guerre russo-ukrainienne', attackers: ['RUS'], defenders: ['UKR'] }],
      warSupport: { UKR: 0.7, RUS: 0.55 },
      aids: AIDS_2026,
    },
  }
}
