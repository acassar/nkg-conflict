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

/** Pactes de défense bilatéraux ou régionaux (alliances militaires), début 2026. */
const DEFENSE_PACTS: Array<{ id: string; name: string; members: CountryId[] }> = [
  { id: 'usa-jpn', name: 'Traité de sécurité nippo-américain', members: ['USA', 'JPN'] },
  { id: 'usa-kor', name: 'Traité de défense américano-coréen', members: ['USA', 'KOR'] },
  { id: 'anzus', name: 'ANZUS', members: ['USA', 'AUS', 'NZL'] },
  { id: 'usa-phl', name: 'Traité de défense américano-philippin', members: ['USA', 'PHL'] },
  { id: 'chn-prk', name: "Traité sino-nord-coréen d'amitié", members: ['CHN', 'PRK'] },
  { id: 'rus-prk', name: 'Partenariat stratégique russo-nord-coréen', members: ['RUS', 'PRK'] },
]

/** Organisations régionales (bonus de relations, sans obligation militaire). */
const ORGANIZATIONS: Array<{ id: string; name: string; members: CountryId[]; bonus: number }> = [
  {
    id: 'ue',
    name: 'Union européenne',
    bonus: 25,
    members: [
      'AUT',
      'BEL',
      'BGR',
      'HRV',
      'CYP',
      'CZE',
      'DNK',
      'EST',
      'FIN',
      'FRA',
      'DEU',
      'GRC',
      'HUN',
      'IRL',
      'ITA',
      'LVA',
      'LTU',
      'LUX',
      'MLT',
      'NLD',
      'POL',
      'PRT',
      'ROU',
      'SVK',
      'SVN',
      'ESP',
      'SWE',
    ],
  },
  {
    id: 'asean',
    name: 'ASEAN',
    bonus: 15,
    members: ['BRN', 'KHM', 'IDN', 'LAO', 'MYS', 'MMR', 'PHL', 'SGP', 'THA', 'VNM'],
  },
  {
    id: 'ligue-arabe',
    name: 'Ligue arabe',
    bonus: 15,
    members: [
      'DZA',
      'BHR',
      'COM',
      'DJI',
      'EGY',
      'IRQ',
      'JOR',
      'KWT',
      'LBN',
      'LBY',
      'MRT',
      'MAR',
      'OMN',
      'PSX',
      'QAT',
      'SAU',
      'SOM',
      'SDN',
      'SYR',
      'TUN',
      'ARE',
      'YEM',
    ],
  },
  { id: 'ua', name: 'Union africaine', bonus: 10, members: [] },
  {
    id: 'ocs',
    name: 'Organisation de coopération de Shanghai',
    bonus: 10,
    members: ['CHN', 'RUS', 'IND', 'PAK', 'KAZ', 'KGZ', 'TJK', 'UZB', 'IRN', 'BLR'],
  },
  { id: 'mercosur', name: 'Mercosur', bonus: 15, members: ['ARG', 'BRA', 'PRY', 'URY', 'BOL'] },
  {
    id: 'ccg',
    name: 'Conseil de coopération du Golfe',
    bonus: 15,
    members: ['SAU', 'ARE', 'QAT', 'KWT', 'BHR', 'OMN'],
  },
]

/** Affinités de langue et d'histoire (bonus de relations). Hypothèses de jeu. */
const AFFINITIES: Array<{ bonus: number; members: CountryId[] }> = [
  { bonus: 15, members: ['USA', 'GBR', 'CAN', 'AUS', 'NZL', 'IRL'] },
  {
    bonus: 10,
    members: [
      'FRA',
      'BEL',
      'CHE',
      'LUX',
      'CAN',
      'SEN',
      'CIV',
      'MLI',
      'BFA',
      'NER',
      'TCD',
      'CMR',
      'GAB',
      'COG',
      'COD',
      'BEN',
      'TGO',
      'GIN',
      'MDG',
      'HTI',
      'TUN',
    ],
  },
  {
    bonus: 10,
    members: [
      'ESP',
      'MEX',
      'GTM',
      'HND',
      'SLV',
      'NIC',
      'CRI',
      'PAN',
      'CUB',
      'DOM',
      'COL',
      'VEN',
      'ECU',
      'PER',
      'BOL',
      'CHL',
      'ARG',
      'URY',
      'PRY',
    ],
  },
  { bonus: 10, members: ['PRT', 'BRA', 'AGO', 'MOZ', 'CPV', 'GNB', 'STP', 'TLS'] },
  { bonus: 10, members: ['DEU', 'AUT', 'CHE', 'LIE', 'LUX'] },
  { bonus: 15, members: ['NOR', 'SWE', 'DNK', 'FIN', 'ISL'] },
  { bonus: 10, members: ['TUR', 'AZE', 'KAZ', 'UZB', 'TKM', 'KGZ'] },
]

/** Pays qui sanctionnent la Russie, la Biélorussie, l'Iran et la Corée du Nord au début de 2026. */
const SANCTIONERS: CountryId[] = [
  'USA',
  'CAN',
  'GBR',
  'AUS',
  'NZL',
  'JPN',
  'KOR',
  'NOR',
  'CHE',
  'ISL',
  'AUT',
  'BEL',
  'BGR',
  'HRV',
  'CYP',
  'CZE',
  'DNK',
  'EST',
  'FIN',
  'FRA',
  'DEU',
  'GRC',
  'HUN',
  'IRL',
  'ITA',
  'LVA',
  'LTU',
  'LUX',
  'MLT',
  'NLD',
  'POL',
  'PRT',
  'ROU',
  'SVK',
  'SVN',
  'ESP',
  'SWE',
]
const SANCTIONED: CountryId[] = ['RUS', 'BLR', 'IRN', 'PRK']

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
  ['CHN', 'JPN', -30],
  ['CHN', 'PHL', -30],
  ['CHN', 'VNM', -15],
  ['JPN', 'PRK', -50],
  ['KOR', 'JPN', 5],
  ['GRC', 'TUR', -20],
  ['ARM', 'TUR', -40],
  ['RUS', 'GEO', -50],
  ['RUS', 'MDA', -35],
  ['SAU', 'IRN', -45],
  ['ISR', 'SYR', -60],
  ['ISR', 'LBN', -50],
  ['IRN', 'ARE', -25],
  ['COL', 'VEN', -20],
  ['RWA', 'COD', -40],
  ['EGY', 'ETH', -30],
  ['PAK', 'AFG', -30],
  ['ISR', 'USA', 60],
  ['UKR', 'BLR', -40],
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

/**
 * Économie nationale d'un pays (modèle « national ») : stocks de départ et revenus quotidiens du pays
 * entier, d'après son PIB (industrie) et sa population (main-d'œuvre). La militarisation oriente une
 * plus grande part de l'industrie vers l'armée. Valeurs de jeu, à équilibrer.
 */
function economyOf(row: WorldCountryRow, militarization: number): ScenarioEconomy {
  const popM = row.pop / 1e6
  const root = Math.sqrt(Math.max(0, row.gdpB))
  const military = 0.5 + 0.5 * militarization
  return {
    production: Math.round(300 + 20 * root),
    munitions: Math.round(300 + 15 * root),
    manpower: Math.round(10 + 0.6 * popM),
    productionPerDay: Math.round((3 + 2.5 * root) * military),
    munitionsPerDay: Math.round((3 + 2.5 * root) * military),
    constructionPerDay: Math.round(4 + 3 * root),
    manpowerPerDay: Math.round((0.2 + 0.06 * popM) * 10) / 10,
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
    economy[r.code] = economyOf(r, MILITARIZATION[r.code] ?? 1)
    forceSize[r.code] = forceSizeOf(r.gdpB, r.pop / 1e6, MILITARIZATION[r.code] ?? 1)
  }

  // Affinités et organisations régionales : bonus cumulés, puis valeurs fixées (alliances, tensions).
  const bonus = new Map<string, number>()
  const key = (a: CountryId, b: CountryId): string => (a < b ? `${a}|${b}` : `${b}|${a}`)
  const africa = rows.filter((r) => r.continent === 'Africa').map((r) => r.code)
  const organizations = ORGANIZATIONS.map((o) => (o.id === 'ua' ? { ...o, members: africa } : o))
  for (const g of [...AFFINITIES, ...organizations]) {
    for (const a of g.members) {
      for (const b of g.members) {
        if (a < b) bonus.set(key(a, b), (bonus.get(key(a, b)) ?? 0) + g.bonus)
      }
    }
  }
  const relations: Array<[CountryId, CountryId, number]> = [...bonus.entries()].map(([k, v]) => {
    const [a, b] = k.split('|') as [CountryId, CountryId]
    return [a, b, Math.min(50, v)]
  })
  relations.push(...TENSIONS)
  const pairs = (list: CountryId[], v: number): void => {
    for (const a of list) for (const b of list) if (a < b) relations.push([a, b, v])
  }
  pairs(NATO, 60)
  pairs(CSTO, 60)
  for (const p of DEFENSE_PACTS) pairs(p.members, 70)
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
    economyModel: 'national',
    units: [],
    politics: {
      forceSize,
      relations,
      alliances: [
        { id: 'nato', name: 'OTAN', members: NATO.filter((c) => economy[c]) },
        { id: 'csto', name: 'OTSC', members: CSTO.filter((c) => economy[c]) },
        ...DEFENSE_PACTS,
      ],
      organizations,
      neighborRelation: 10,
      sanctions: SANCTIONERS.flatMap((from) =>
        SANCTIONED.map((to): [CountryId, CountryId] => [from, to]),
      ),
      wars: [{ name: 'Guerre russo-ukrainienne', attackers: ['RUS'], defenders: ['UKR'] }],
      warSupport: { UKR: 0.7, RUS: 0.55 },
      aids: AIDS_2026,
      armiesAtStart: true,
    },
  }
}
