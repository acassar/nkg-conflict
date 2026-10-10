#!/usr/bin/env node
/**
 * Projette les routes principales et les voies ferrées de Natural Earth sur les grilles des théâtres.
 *
 * Usage : node scripts/build-roads.mjs <dossier natural-earth-vector/geojson>
 * Fichiers lus : ne_10m_roads.geojson et ne_10m_railroads.geojson. Pour les récupérer sans tout le dépôt :
 *   git clone --depth 1 --filter=blob:none --sparse https://github.com/nvkelso/natural-earth-vector.git
 *   cd natural-earth-vector && git sparse-checkout set --no-cone /geojson/ne_10m_roads.geojson /geojson/ne_10m_railroads.geojson
 * Sorties : public/data/roads-world.bin.gz et public/data/roads-ukraine.bin.gz, un octet par cellule
 * (ligne 0 = sud) : bit 1 = route, bit 2 = grand axe (autoroute, voie rapide), bit 4 = voie ferrée.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const [, , neDir] = process.argv
if (!neDir) {
  console.error('Usage : node scripts/build-roads.mjs <natural-earth-vector/geojson>')
  process.exit(1)
}

const ROAD = 1
const MAJOR = 2
const RAIL = 4

/** Grilles cibles : mêmes emprises et pas que build-world.mjs et build-theater.mjs. */
const GRIDS = [
  { id: 'world', bbox: { lon0: -180, lat0: -56, lon1: 180, lat1: 78 }, cell: 0.1 },
  { id: 'ukraine', bbox: { lon0: 20, lat0: 43, lon1: 46, lat1: 57.5 }, cell: 0.05 },
]

/** Types de route retenus ; les bacs et les pistes sont ignorés. */
const MAJOR_TYPES = new Set(['Major Highway', 'Beltway', 'Bypass'])
const ROAD_TYPES = new Set(['Secondary Highway', 'Road', 'Unknown', ...MAJOR_TYPES])
/**
 * Importance minimale (scalerank Natural Earth, 3 = la plus haute) : au-delà de 7, routes et lignes
 * secondaires, qui couvriraient près du double de cellules. Les grands axes sont toujours gardés.
 */
const MAX_SCALERANK = 7

const read = (name) => JSON.parse(fs.readFileSync(path.join(neDir, `${name}.geojson`), 'utf8'))
const linesOf = (geom) =>
  !geom
    ? []
    : geom.type === 'LineString'
      ? [geom.coordinates]
      : geom.type === 'MultiLineString'
        ? geom.coordinates
        : []

const roads = read('ne_10m_roads').features.flatMap((f) => {
  const p = f.properties
  if (!ROAD_TYPES.has(p.type)) return []
  const major = MAJOR_TYPES.has(p.type) || p.expressway === 1
  if (!major && p.scalerank > MAX_SCALERANK) return []
  const bits = major ? ROAD | MAJOR : ROAD
  return linesOf(f.geometry).map((line) => ({ bits, line }))
})
const rails = read('ne_10m_railroads').features.flatMap((f) =>
  f.properties.featurecla === 'Railroad' && f.properties.scalerank <= MAX_SCALERANK
    ? linesOf(f.geometry).map((line) => ({ bits: RAIL, line }))
    : [],
)
console.log(`${roads.length} tronçons routiers, ${rails.length} tronçons ferroviaires`)

fs.mkdirSync(path.resolve('public/data'), { recursive: true })
for (const g of GRIDS) {
  const { lon0, lat0, lon1, lat1 } = g.bbox
  const W = Math.round((lon1 - lon0) / g.cell)
  const H = Math.round((lat1 - lat0) / g.cell)
  const out = new Uint8Array(W * H)
  const mark = (lon, lat, bits) => {
    const x = Math.floor((lon - lon0) / g.cell)
    const y = Math.floor((lat - lat0) / g.cell)
    if (x >= 0 && y >= 0 && x < W && y < H) out[y * W + x] |= bits
  }
  // Échantillonnage au quart de cellule : chaque cellule traversée par le tracé est marquée.
  const step = g.cell / 4
  for (const { bits, line } of [...roads, ...rails]) {
    for (let k = 1; k < line.length; k++) {
      const [ax, ay] = line[k - 1]
      const [bx, by] = line[k]
      // Segments qui traversent l'antiméridien : ignorés (océan Pacifique, sans route).
      if (Math.abs(bx - ax) > 180) continue
      if (Math.max(ax, bx) < lon0 || Math.min(ax, bx) > lon1) continue
      if (Math.max(ay, by) < lat0 || Math.min(ay, by) > lat1) continue
      const n = Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay)) / step) + 1
      for (let s = 0; s <= n; s++) mark(ax + ((bx - ax) * s) / n, ay + ((by - ay) * s) / n, bits)
    }
  }
  const file = path.resolve(`public/data/roads-${g.id}.bin.gz`)
  fs.writeFileSync(file, zlib.gzipSync(out, { level: 9 }))
  let road = 0
  let major = 0
  let rail = 0
  for (const v of out) {
    if (v & ROAD) road++
    if (v & MAJOR) major++
    if (v & RAIL) rail++
  }
  console.log(
    `${g.id} : ${W}×${H} cellules · routes ${road} (grands axes ${major}) · voies ferrées ${rail} · ${(fs.statSync(file).size / 1024).toFixed(0)} Ko`,
  )
}
