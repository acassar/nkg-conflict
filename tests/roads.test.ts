import fs from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { Simulation } from '@/sim/simulation'
import { buildScenario } from '@/sim/scenarios'
import { loadTheater } from '@/sim/theater/load'
import { Grid, MAJOR_ROAD_BIT, RAIL_BIT, ROAD_BIT, type TheaterData } from '@/sim/theater/grid'
import { ROAD_COLORS, roadColor } from '@/map/roadsImage'

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
})
