#!/usr/bin/env node
/**
 * Génère la grille du théâtre Ukraine – Russie à partir de Natural Earth.
 *
 * Usage : node scripts/build-theater.mjs <dossier natural-earth-vector/geojson>
 * Fichiers lus : ne_50m_admin_0_countries, ne_10m_rivers_lake_centerlines, ne_10m_populated_places_simple.
 * Sortie : src/sim/data/theater-ukraine.json
 *
 * Ligne de départ : frontières de facto de Natural Earth (Crimée rattachée à la Russie).
 * Pour changer de point de départ, modifier OWNER_OVERRIDES ci-dessous ou fournir un autre fichier de pays.
 */
import fs from 'node:fs'
import path from 'node:path'

const [, , neDir] = process.argv
if (!neDir) {
  console.error('Usage : node scripts/build-theater.mjs <natural-earth-vector/geojson>')
  process.exit(1)
}

const BBOX = { lon0: 20, lat0: 43, lon1: 46, lat1: 57.5 }
const CELL = 0.05
const WIDTH = Math.round((BBOX.lon1 - BBOX.lon0) / CELL)
const HEIGHT = Math.round((BBOX.lat1 - BBOX.lat0) / CELL)

/** Pays jouables : index dans la grille des propriétaires (0 = aucun). */
const SIDES = ['', 'UKR', 'RUS']
/** Terrain : 0 plaine, 1 eau (infranchissable), 2 pays neutre (infranchissable), 3 fleuve, 4 urbain. */
const T = { PLAIN: 0, WATER: 1, NEUTRAL: 2, RIVER: 3, URBAN: 4 }
const RIVERS = new Set([
  'Dnipro',
  'Dnepre',
  'Dniester',
  'Don',
  'Pripyat',
  'Donets',
  'Oka',
  'Desna',
  'Southern Bug',
  'Seym',
  'Volga',
])
const MIN_CITY_POP = 250_000
const CAPITALS = { UKR: 'Kyiv', RUS: 'Moscow' }

const read = (name) => JSON.parse(fs.readFileSync(path.join(neDir, `${name}.geojson`), 'utf8'))
const polygonsOf = (geom) =>
  geom.type === 'Polygon'
    ? [geom.coordinates]
    : geom.type === 'MultiPolygon'
      ? geom.coordinates
      : []
const linesOf = (geom) =>
  !geom
    ? []
    : geom.type === 'LineString'
      ? [geom.coordinates]
      : geom.type === 'MultiLineString'
        ? geom.coordinates
        : []

const owner = new Uint8Array(WIDTH * HEIGHT)
const terrain = new Uint8Array(WIDTH * HEIGHT).fill(T.WATER)
const idx = (x, y) => y * WIDTH + x
const toX = (lon) => Math.floor((lon - BBOX.lon0) / CELL)
const toY = (lat) => Math.floor((lat - BBOX.lat0) / CELL)

/** Remplissage par balayage (pair-impair sur tous les anneaux du polygone), au centre des cellules. */
function fillPolygon(rings, apply) {
  for (let y = 0; y < HEIGHT; y++) {
    const lat = BBOX.lat0 + (y + 0.5) * CELL
    const xs = []
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]
        const [xj, yj] = ring[j]
        if (yi > lat !== yj > lat) xs.push(xi + ((lat - yi) * (xj - xi)) / (yj - yi))
      }
    }
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil((xs[k] - BBOX.lon0) / CELL - 0.5))
      const to = Math.min(WIDTH - 1, Math.floor((xs[k + 1] - BBOX.lon0) / CELL - 0.5))
      for (let x = from; x <= to; x++) apply(idx(x, y))
    }
  }
}

// 1. Pays : les deux camps sont jouables, les autres terres sont neutres et infranchissables.
const countries = read('ne_50m_admin_0_countries')
for (const f of countries.features) {
  const code = f.properties.ADM0_A3
  const side = SIDES.indexOf(code)
  for (const poly of polygonsOf(f.geometry)) {
    fillPolygon(poly, (i) => {
      terrain[i] = side > 0 ? T.PLAIN : T.NEUTRAL
      owner[i] = side > 0 ? side : 0
    })
  }
}

// Kaliningrad est isolé du théâtre : traité comme neutre.
for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < toX(24); x++) {
    const i = idx(x, y)
    if (owner[i] === SIDES.indexOf('RUS')) {
      owner[i] = 0
      terrain[i] = T.NEUTRAL
    }
  }
}

// 2. Fleuves majeurs, tracés cellule par cellule sur les terres des deux camps.
function drawLine(a, b) {
  const steps = Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / (CELL / 2)) + 1
  for (let s = 0; s <= steps; s++) {
    const t = s / steps
    const x = toX(a[0] + (b[0] - a[0]) * t)
    const y = toY(a[1] + (b[1] - a[1]) * t)
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) continue
    const i = idx(x, y)
    if (terrain[i] === T.PLAIN) terrain[i] = T.RIVER
  }
}
for (const f of read('ne_10m_rivers_lake_centerlines').features) {
  if (!RIVERS.has(f.properties.name)) continue
  for (const line of linesOf(f.geometry)) {
    for (let k = 1; k < line.length; k++) drawLine(line[k - 1], line[k])
  }
}

// 3. Villes : zones urbaines (bonus défensif) et objectifs.
const cities = []
for (const f of read('ne_10m_populated_places_simple').features) {
  const p = f.properties
  const [lon, lat] = f.geometry.coordinates
  if (!SIDES.includes(p.adm0_a3) || !p.adm0_a3) continue
  if (lon < BBOX.lon0 || lon > BBOX.lon1 || lat < BBOX.lat0 || lat > BBOX.lat1) continue
  if (p.pop_max < MIN_CITY_POP) continue
  const capital = CAPITALS[p.adm0_a3] === p.name
  cities.push({
    name: p.name,
    country: p.adm0_a3,
    lon: +lon.toFixed(3),
    lat: +lat.toFixed(3),
    pop: p.pop_max,
    capital,
  })
  const r = p.pop_max > 2_000_000 ? 3 : p.pop_max > 700_000 ? 2 : 1
  const cx = toX(lon)
  const cy = toY(lat)
  for (let dy = -r + 1; dy < r; dy++) {
    for (let dx = -r + 1; dx < r; dx++) {
      const x = cx + dx
      const y = cy + dy
      if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) continue
      const i = idx(x, y)
      if (terrain[i] === T.PLAIN || terrain[i] === T.RIVER) terrain[i] = T.URBAN
    }
  }
}
cities.sort((a, b) => b.pop - a.pop)

/** Encodage par plages : [valeur, longueur, valeur, longueur, …]. */
function rle(arr) {
  const out = []
  let v = arr[0]
  let n = 0
  for (const a of arr) {
    if (a === v) n++
    else {
      out.push(v, n)
      v = a
      n = 1
    }
  }
  out.push(v, n)
  return out
}

const result = {
  id: 'ukraine',
  source: 'Natural Earth (domaine public), frontières de facto',
  bbox: BBOX,
  cell: CELL,
  width: WIDTH,
  height: HEIGHT,
  sides: SIDES,
  owner: rle(owner),
  terrain: rle(terrain),
  cities,
}
const out = path.resolve('src/sim/data/theater-ukraine.json')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify(result))
const count = (arr, v) => arr.reduce((n, a) => n + (a === v ? 1 : 0), 0)
console.log(
  `${WIDTH}×${HEIGHT} cellules · UKR ${count(owner, 1)} · RUS ${count(owner, 2)} · fleuves ${count(terrain, T.RIVER)} · urbain ${count(terrain, T.URBAN)} · ${cities.length} villes → ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} Ko)`,
)
