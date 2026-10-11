import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadTheater } from '@/sim/theater/load'
import { Simulation } from '@/sim/simulation'
import { buildScenario } from '@/sim/scenarios'
import { cityNameSize, cityTier, declutterCities, zoomScale } from '@/map/cityLabels'
import type { CityState } from '@/sim/core/types'

function readPublic(p: string): Promise<ArrayBuffer> {
  const buf = fs.readFileSync(new URL(`../public/${p}`, import.meta.url))
  return Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
}

const city = (name: string, lon: number, lat: number, pop: number, capital = false): CityState =>
  ({ name, lon, lat, pop, capital, owner: 'UKR', buildings: {} }) as unknown as CityState

describe('villes sur la carte', () => {
  it('classe les villes en trois tailles selon la population', () => {
    expect(cityTier(80_000)).toBe(0)
    expect(cityTier(400_000)).toBe(1)
    expect(cityTier(2_900_000)).toBe(2)
  })

  it('grossit les noms avec le zoom, capitales plus grandes', () => {
    const kyiv = city('Kyiv', 30.5, 50.45, 2_900_000, true)
    const lviv = city('Lviv', 24, 49.84, 720_000)
    expect(cityNameSize(kyiv, 4)).toBeGreaterThan(cityNameSize(lviv, 4))
    expect(cityNameSize(lviv, 7)).toBeGreaterThan(cityNameSize(lviv, 4))
    expect(zoomScale(0)).toBe(0.8)
    expect(zoomScale(12)).toBe(1.25)
  })

  it('masque la petite ville dont le nom chevauche celui d’une plus grande', () => {
    const big = city('Dnipro', 35.0, 48.45, 980_000)
    const small = city('Novomoskovsk', 35.05, 48.47, 70_000)
    const far = city('Odesa', 30.7, 46.48, 1_000_000)
    expect(declutterCities([small, big, far], 5).map((c) => c.name)).toEqual(['Dnipro', 'Odesa'])
    // De près, les deux noms tiennent.
    expect(declutterCities([small, big, far], 11)).toHaveLength(3)
  })

  it('garde toujours la ville sélectionnée et les capitales', () => {
    const big = city('Dnipro', 35.0, 48.45, 980_000)
    const small = city('Novomoskovsk', 35.05, 48.47, 70_000)
    expect(declutterCities([big, small], 5, 'Novomoskovsk').map((c) => c.name)).toEqual([
      'Novomoskovsk',
    ])
    const capital = city('Capitale', 35.04, 48.46, 50_000, true)
    expect(declutterCities([big, capital], 5).map((c) => c.name)).toEqual(['Capitale'])
  })

  it('trie les villes de la carte du monde en quelques millisecondes', async () => {
    const world = await loadTheater('world', readPublic)
    const cities = Simulation.fromScenario(buildScenario('world-2026'), world, 1).snapshot(
      true,
    ).cities
    const t0 = performance.now()
    const kept = declutterCities(cities, 6)
    const ms = performance.now() - t0
    expect(kept.length).toBeLessThan(cities.length)
    expect(kept.filter((c) => c.capital)).toHaveLength(cities.filter((c) => c.capital).length)
    expect(ms).toBeLessThan(100)
  })
})
