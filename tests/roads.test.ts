import fs from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { Simulation } from '@/sim/simulation'
import { buildScenario } from '@/sim/scenarios'
import { loadTheater } from '@/sim/theater/load'
import { Grid, MAJOR_ROAD_BIT, RAIL_BIT, ROAD_BIT, type TheaterData } from '@/sim/theater/grid'
import {
  BASE_ROAD_COLORS,
  BASE_ROAD_MAX_OPACITY,
  ROAD_COLORS,
  roadColor,
  roadLines,
  roadOpacity,
  visibleRoadLines,
} from '@/map/roadsImage'

const readPublic = async (p: string): Promise<ArrayBuffer> => {
  const buf = fs.readFileSync(new URL(`../public/${p}`, import.meta.url))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

let ukraine: TheaterData
let world: TheaterData

beforeAll(async () => {
  ukraine = await loadTheater('ukraine', readPublic)
  world = await loadTheater('world', readPublic)
})

/** Une cellule du réseau à moins de `r` cellules du point. */
function near(grid: Grid, lon: number, lat: number, r: number, test: (i: number) => boolean) {
  const c = grid.cellAt(lon, lat)
  const x0 = c % grid.width
  const y0 = Math.floor(c / grid.width)
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (grid.inBounds(x0 + dx, y0 + dy) && test(grid.index(x0 + dx, y0 + dy))) return true
    }
  }
  return false
}

/** Deux points reliés par des cellules du réseau voisines (8 directions), départ et arrivée à 2 cellules près. */
function connected(grid: Grid, from: [number, number], to: [number, number], bit: number) {
  const on = (i: number) => ((grid.roads[i] ?? 0) & bit) !== 0
  const seen = new Uint8Array(grid.size)
  const queue: number[] = []
  const c = grid.cellAt(from[0], from[1])
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const i = c + dy * grid.width + dx
      if (on(i) && !seen[i]) {
        seen[i] = 1
        queue.push(i)
      }
    }
  }
  const t = grid.cellAt(to[0], to[1])
  const tx = t % grid.width
  const ty = Math.floor(t / grid.width)
  while (queue.length) {
    const i = queue.pop() ?? 0
    const x = i % grid.width
    const y = Math.floor(i / grid.width)
    if (Math.abs(x - tx) <= 2 && Math.abs(y - ty) <= 2) return true
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!grid.inBounds(x + dx, y + dy)) continue
        const n = grid.index(x + dx, y + dy)
        if (!seen[n] && on(n)) {
          seen[n] = 1
          queue.push(n)
        }
      }
    }
  }
  return false
}

describe('réseau routier et ferroviaire', () => {
  it('charge le réseau du théâtre ukrainien sur sa grille', () => {
    const grid = new Grid(ukraine)
    expect(grid.roads.length).toBe(grid.size)
    expect(near(grid, 30.52, 50.45, 2, (i) => grid.hasRoad(i))).toBe(true)
    expect(near(grid, 30.52, 50.45, 2, (i) => grid.hasRail(i))).toBe(true)
    // Mer Noire : ni route ni voie ferrée.
    expect(near(grid, 33, 43.5, 3, (i) => grid.roads[i] !== 0)).toBe(false)
    // Kiev et Kharkiv reliées par la route et par le rail, cellule après cellule.
    expect(connected(grid, [30.52, 50.45], [36.23, 49.99], ROAD_BIT)).toBe(true)
    expect(connected(grid, [30.52, 50.45], [36.23, 49.99], RAIL_BIT)).toBe(true)
  })

  it('charge le réseau mondial avec ses grands axes', () => {
    const grid = new Grid(world)
    expect(grid.roads.length).toBe(grid.size)
    expect(near(grid, 2.35, 48.86, 1, (i) => grid.hasMajorRoad(i))).toBe(true)
    expect(near(grid, 2.35, 48.86, 1, (i) => grid.hasRail(i))).toBe(true)
    expect(near(grid, -30, 30, 5, (i) => grid.roads[i] !== 0)).toBe(false)
    expect(connected(grid, [2.35, 48.86], [4.84, 45.76], ROAD_BIT)).toBe(true)
    // Un grand axe implique toujours une route.
    for (let i = 0; i < grid.size; i++) {
      if (grid.hasMajorRoad(i) && !grid.hasRoad(i)) throw new Error(`cellule ${i}`)
    }
  })

  it('transmet le réseau à la carte avec la grille', () => {
    const sim = Simulation.fromScenario(buildScenario('ukraine-2026'), ukraine, 1)
    const snap = sim.snapshot(true)
    expect(snap.grid?.roads.length).toBe(ukraine.width * ukraine.height)
    expect(snap.grid?.roads.some((v) => v & RAIL_BIT)).toBe(true)
  })

  it('une grille sans réseau reste utilisable', () => {
    const { roads: _roads, ...bare } = ukraine
    const grid = new Grid(bare)
    expect(grid.roads.length).toBe(grid.size)
    expect(grid.hasRoad(grid.cellAt(30.52, 50.45))).toBe(false)
  })

  it('colore les cellules selon leur réseau', () => {
    expect(roadColor(0)).toBeNull()
    expect(roadColor(ROAD_BIT)).toBe(ROAD_COLORS.road)
    expect(roadColor(RAIL_BIT)).toBe(ROAD_COLORS.rail)
    // Plusieurs réseaux : grand axe, puis voie ferrée, puis route.
    expect(roadColor(ROAD_BIT | RAIL_BIT)).toBe(ROAD_COLORS.rail)
    expect(roadColor(ROAD_BIT | MAJOR_ROAD_BIT | RAIL_BIT)).toBe(ROAD_COLORS.major)
  })

  it('trace le réseau de la carte par défaut en segments, par blocs', () => {
    // Grille 6 × 3 : un grand axe en L (sans diagonale dans le virage), une route en diagonale.
    const roads = new Uint8Array(18)
    const set = (x: number, y: number, b: number) => (roads[y * 6 + x] = b)
    set(0, 0, MAJOR_ROAD_BIT)
    set(1, 0, MAJOR_ROAD_BIT)
    set(2, 0, MAJOR_ROAD_BIT)
    set(2, 1, MAJOR_ROAD_BIT)
    set(5, 0, ROAD_BIT)
    set(4, 1, ROAD_BIT)
    // Une route qui porte aussi une voie ferrée appartient au réseau principal.
    set(5, 2, ROAD_BIT | RAIL_BIT)
    const grid = {
      width: 6,
      height: 3,
      bbox: [0, 0, 6, 3] as [number, number, number, number],
      roads,
    }
    const segments = (blocks: ReturnType<typeof roadLines>) =>
      blocks.flatMap((b) =>
        Array.from({ length: b.length }, (_, i) => Array.from(b.positions.slice(i * 4, i * 4 + 4))),
      )
    // Les trois cellules alignées forment un seul segment.
    const main = roadLines(grid, 'main')
    expect(segments(main)).toEqual([
      [0.5, 0.5, 2.5, 0.5],
      [2.5, 0.5, 2.5, 1.5],
    ])
    expect(Array.from(main[0]?.colors.slice(0, 4) ?? [])).toEqual(BASE_ROAD_COLORS.major)
    expect(segments(roadLines(grid, 'minor'))).toEqual([[5.5, 0.5, 4.5, 1.5]])
    // Blocs de 2 cellules : chaque segment est rangé selon sa cellule de départ.
    const small = roadLines(grid, 'main', BASE_ROAD_COLORS, 2)
    expect(small.length).toBe(2)
    expect(small[1]?.bounds).toEqual([2.5, 0.5, 2.5, 1.5])
    // Seuls les blocs qui touchent la vue sont dessinés.
    expect(visibleRoadLines(small, [3, 0, 6, 3])).toEqual([])
    expect(visibleRoadLines(small, [2, 1, 3, 2])).toEqual([small[1]])
    expect(visibleRoadLines(small, null)).toBe(small)
  })

  it('montre le réseau de la carte par défaut seulement de près, et peu opaque', () => {
    const cellDeg = 0.1
    expect(roadOpacity(4, cellDeg, 'main')).toBe(0)
    expect(roadOpacity(5, cellDeg, 'minor')).toBe(0)
    expect(roadOpacity(12, cellDeg, 'main')).toBe(BASE_ROAD_MAX_OPACITY.main)
    expect(roadOpacity(12, cellDeg, 'minor')).toBe(BASE_ROAD_MAX_OPACITY.minor)
    expect(BASE_ROAD_MAX_OPACITY.main).toBeLessThan(1)
  })

  it('segmente le réseau mondial en un temps raisonnable', () => {
    const { lon0, lat0, lon1, lat1 } = world.bbox
    const grid = {
      width: world.width,
      height: world.height,
      bbox: [lon0, lat0, lon1, lat1] as [number, number, number, number],
      roads: world.roads ?? new Uint8Array(0),
    }
    const t0 = performance.now()
    const count = (blocks: ReturnType<typeof roadLines>) => blocks.reduce((n, b) => n + b.length, 0)
    const main = count(roadLines(grid, 'main'))
    const minor = count(roadLines(grid, 'minor'))
    const ms = performance.now() - t0
    expect(main).toBeGreaterThan(1000)
    expect(minor).toBeGreaterThan(1000)
    console.info(`réseau mondial : ${main} + ${minor} segments en ${ms.toFixed(0)} ms`)
    expect(ms).toBeLessThan(3000)
  })
})
