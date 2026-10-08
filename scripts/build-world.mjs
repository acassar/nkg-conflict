#!/usr/bin/env node
/**
 * Génère la grille mondiale (0,1°) à partir de Natural Earth, plus le relief agrégé par la CI.
 *
 * Usage : node scripts/build-world.mjs <dossier natural-earth-vector/geojson>
 * Fichiers lus : ne_50m_admin_0_countries, ne_10m_rivers_lake_centerlines, ne_10m_populated_places_simple,
 * et data/world-terrain-raw.bin.gz s'il existe (workflow « Données mondiales »).
 * Sorties :
 * - src/sim/data/world/countries.json : emprise, pays (nom, population, PIB), villes ;
 * - public/data/world-grid.bin.gz : propriétaire puis terrain de chaque cellule (uint8, ligne 0 = sud).
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const [, , neDir] = process.argv
if (!neDir) {
  console.error('Usage : node scripts/build-world.mjs <natural-earth-vector/geojson>')
  process.exit(1)
}

const BBOX = { lon0: -180, lat0: -56, lon1: 180, lat1: 78 }
const CELL = 0.1
const WIDTH = Math.round((BBOX.lon1 - BBOX.lon0) / CELL)
const HEIGHT = Math.round((BBOX.lat1 - BBOX.lat0) / CELL)
const SIZE = WIDTH * HEIGHT

const T = {
  PLAIN: 0,
  WATER: 1,
  NEUTRAL: 2,
  RIVER: 3,
  URBAN: 4,
  FOREST: 5,
  HILLS: 6,
  MOUNTAINS: 7,
  MARSH: 8,
}
const TERRAIN_RAW = path.resolve('data/world-terrain-raw.bin.gz')
// Seuils pour des cellules de ~11 km (plus larges que celles du théâtre ukrainien).
const MOUNTAIN_RELIEF = 600
const MOUNTAIN_ELEVATION = 1500
const HILL_RELIEF = 200
const HILL_ELEVATION = 700
const MARSH_PCT = 25
const FOREST_PCT = 50
const MAX_RIVER_RANK = 5
const MIN_CITY_POP = 750_000

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

const owner = new Uint8Array(SIZE)
const terrain = new Uint8Array(SIZE).fill(T.WATER)
const idx = (x, y) => y * WIDTH + x
const toX = (lon) => Math.floor((lon - BBOX.lon0) / CELL)
const toY = (lat) => Math.floor((lat - BBOX.lat0) / CELL)

function fillPolygon(rings, apply) {
  let minLat = Infinity
  let maxLat = -Infinity
  for (const ring of rings) {
    for (const [, lat] of ring) {
      minLat = Math.min(minLat, lat)
      maxLat = Math.max(maxLat, lat)
    }
  }
  const y0 = Math.max(0, toY(minLat))
  const y1 = Math.min(HEIGHT - 1, toY(maxLat))
  for (let y = y0; y <= y1; y++) {
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

// 1. Pays : chaque entité Natural Earth devient un acteur (index de camp ≥ 1).
const countries = []
const sides = ['']
for (const f of read('ne_50m_admin_0_countries').features) {
  const p = f.properties
  const code = p.ADM0_A3
  if (sides.includes(code)) continue
  sides.push(code)
  const side = sides.length - 1
  if (side > 255) throw new Error('Plus de 255 pays : la grille utilise un octet par cellule')
  for (const poly of polygonsOf(f.geometry)) {
    fillPolygon(poly, (i) => {
      owner[i] = side
      terrain[i] = T.PLAIN
    })
  }
  countries.push({
    code,
    name: p.NAME_FR || p.NAME,
    pop: p.POP_EST,
    gdpB: Math.round(p.GDP_MD / 100) / 10,
    continent: p.CONTINENT,
    mapColor: p.MAPCOLOR9,
    label: [+(+p.LABEL_X).toFixed(2), +(+p.LABEL_Y).toFixed(2)],
  })
}

// 2. Relief, forêts et marais.
if (fs.existsSync(TERRAIN_RAW)) {
  const buf = zlib.gunzipSync(fs.readFileSync(TERRAIN_RAW))
  if (buf.length !== SIZE * 6) {
    console.error(`${TERRAIN_RAW} ne correspond pas à la grille (${buf.length} octets)`)
    process.exit(1)
  }
  const mean = new Int16Array(buf.buffer, buf.byteOffset, SIZE)
  const relief = new Int16Array(buf.buffer, buf.byteOffset + SIZE * 2, SIZE)
  const forest = new Uint8Array(buf.buffer, buf.byteOffset + SIZE * 4, SIZE)
  const wet = new Uint8Array(buf.buffer, buf.byteOffset + SIZE * 5, SIZE)
  for (let i = 0; i < SIZE; i++) {
    if (terrain[i] !== T.PLAIN) continue
    if (relief[i] >= MOUNTAIN_RELIEF || mean[i] >= MOUNTAIN_ELEVATION) terrain[i] = T.MOUNTAINS
    else if (wet[i] >= MARSH_PCT) terrain[i] = T.MARSH
    else if (forest[i] >= FOREST_PCT) terrain[i] = T.FOREST
    else if (relief[i] >= HILL_RELIEF || mean[i] >= HILL_ELEVATION) terrain[i] = T.HILLS
  }
} else {
  console.warn(`${TERRAIN_RAW} absent : pas de relief ni de forêts`)
}

// 3. Grands fleuves.
const isLand = (t) => t !== T.WATER && t !== T.NEUTRAL
function drawLine(a, b) {
  const steps = Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / (CELL / 2)) + 1
  for (let s = 0; s <= steps; s++) {
    const t = s / steps
    const x = toX(a[0] + (b[0] - a[0]) * t)
    const y = toY(a[1] + (b[1] - a[1]) * t)
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) continue
    const i = idx(x, y)
    if (isLand(terrain[i]) && terrain[i] !== T.URBAN) terrain[i] = T.RIVER
  }
}
for (const f of read('ne_10m_rivers_lake_centerlines').features) {
  if (f.properties.scalerank > MAX_RIVER_RANK) continue
  for (const line of linesOf(f.geometry)) {
    for (let k = 1; k < line.length; k++) drawLine(line[k - 1], line[k])
  }
}

// 4. Villes : grandes villes et capitales, propriétaire d'après la grille.
const cities = []
const capitalOf = new Map()
for (const f of read('ne_10m_populated_places_simple').features) {
  const p = f.properties
  const [lon, lat] = f.geometry.coordinates
  const capital = p.featurecla === 'Admin-0 capital'
  if (p.pop_max < MIN_CITY_POP && !capital) continue
  const x = toX(lon)
  const y = toY(lat)
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) continue
  const side = owner[idx(x, y)]
  if (!side) continue
  const country = sides[side]
  cities.push({
    name: p.name,
    country,
    lon: +lon.toFixed(3),
    lat: +lat.toFixed(3),
    pop: p.pop_max,
    capital: false,
  })
  if (capital) {
    const prev = capitalOf.get(country)
    if (!prev || p.pop_max > prev.pop) capitalOf.set(country, cities.at(-1))
  }
  const r = p.pop_max > 5_000_000 ? 2 : 1
  for (let dy = -r + 1; dy < r; dy++) {
    for (let dx = -r + 1; dx < r; dx++) {
      const xx = x + dx
      const yy = y + dy
      if (xx < 0 || yy < 0 || xx >= WIDTH || yy >= HEIGHT) continue
      const i = idx(xx, yy)
      if (isLand(terrain[i])) terrain[i] = T.URBAN
    }
  }
}
for (const c of capitalOf.values()) c.capital = true
cities.sort((a, b) => b.pop - a.pop)

// 5. Écriture.
const outDir = path.resolve('src/sim/data/world')
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(
  path.join(outDir, 'countries.json'),
  JSON.stringify({
    id: 'world',
    source:
      'Natural Earth (domaine public), frontières de facto ; AWS Terrain Tiles ; ESA WorldCover 2021 (CC BY 4.0)',
    bbox: BBOX,
    cell: CELL,
    width: WIDTH,
    height: HEIGHT,
    sides,
    countries,
    cities,
  }),
)
fs.mkdirSync(path.resolve('public/data'), { recursive: true })
const gridFile = path.resolve('public/data/world-grid.bin.gz')
fs.writeFileSync(gridFile, zlib.gzipSync(Buffer.concat([owner, terrain]), { level: 9 }))

const count = (code) => terrain.reduce((n, t) => n + (t === code ? 1 : 0), 0)
console.log(
  `${WIDTH}×${HEIGHT} cellules · ${countries.length} pays · ${cities.length} villes (${capitalOf.size} capitales)`,
)
console.log(
  `forêts ${count(T.FOREST)} · collines ${count(T.HILLS)} · montagnes ${count(T.MOUNTAINS)} · marais ${count(T.MARSH)} · fleuves ${count(T.RIVER)}`,
)
console.log(`grille : ${(fs.statSync(gridFile).size / 1024).toFixed(0)} Ko`)
