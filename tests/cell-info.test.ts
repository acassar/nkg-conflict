import { describe, expect, it } from 'vitest'
import type { CityState, GridSnapshot } from '@/sim/core/types'
import { MAJOR_ROAD_BIT, RAIL_BIT, ROAD_BIT, Terrain, TERRAIN_RULES } from '@/sim/theater/grid'
import { cellIndexAt, describePoint } from '@/map/cellInfo'
import { BASE_ROAD_COLORS, roadColor, roadOpacity } from '@/map/roadsImage'
import { signedPct } from '@/help/rules'

/** Grille de 4 × 1 cellules d'un degré : plaine + grand axe + rail, forêt, fleuve, mer. */
function grid(): GridSnapshot {
  return {
    version: 1,
    width: 4,
    height: 1,
    bbox: [0, 0, 4, 1],
    owner: new Uint8Array([1, 1, 1, 0]),
    terrain: new Uint8Array([Terrain.PLAIN, Terrain.FOREST, Terrain.RIVER, Terrain.WATER]),
    roads: new Uint8Array([ROAD_BIT | MAJOR_ROAD_BIT | RAIL_BIT, ROAD_BIT, 0, 0]),
    sides: ['', 'UKR'],
  }
}

const city: CityState = {
  name: 'Testville',
  lon: 1.5,
  lat: 0.5,
  capital: true,
  owner: 'UKR',
  pop: 1_400_000,
  buildings: { civ: 0, mil: 0, barracks: 0, depot: 0, fort: 0 } as CityState['buildings'],
}

describe('bandeau de description de la carte', () => {
  it('repère la cellule sous un point', () => {
    const g = grid()
    expect(cellIndexAt(g, 0.5, 0.5)).toBe(0)
    expect(cellIndexAt(g, 2.2, 0.9)).toBe(2)
    expect(cellIndexAt(g, -0.1, 0.5)).toBe(-1)
    expect(cellIndexAt(g, 1, 1.5)).toBe(-1)
  })

  it('décrit terrain, effets et réseau avec les valeurs de l’aide', () => {
    const g = grid()
    const plain = describePoint(g, [], 0.5, 0.5, 10)
    expect(plain[0]).toBe('Plaine : vitesse 0 %, défense 0 %')
    expect(plain).toContain('Grand axe (autoroute, voie rapide)')
    expect(plain).toContain('Voie ferrée')
    expect(plain).not.toContain('Route principale')
    const forest = describePoint(g, [], 1.2, 0.5, 10)
    const rule = TERRAIN_RULES[Terrain.FOREST]!
    expect(forest[0]).toBe(
      `Forêt : vitesse ${signedPct(rule.speed)}, défense ${signedPct(rule.defense)}`,
    )
    expect(forest).toContain('Route principale')
  })

  it('signale le fleuve et le bonus de franchissement, la mer et le hors-carte', () => {
    const g = grid()
    expect(describePoint(g, [], 2.5, 0.5, 10)[0]).toMatch(
      /^Fleuve : vitesse −70 %, défense \+20 % ; attaque à travers : \+40 %/,
    )
    expect(describePoint(g, [], 3.5, 0.5, 10)).toEqual(['Mer ou lac : infranchissable'])
    expect(describePoint(g, [], 5, 0.5, 10)).toEqual([])
  })

  it('nomme la ville proche, seulement dans le rayon demandé', () => {
    const g = grid()
    const near = describePoint(g, [city], 1.52, 0.5, 10)
    expect(near.at(-1)).toBe('Testville, capitale : 1,4 M hab.')
    expect(describePoint(g, [city], 1.9, 0.5, 10).some((l) => l.startsWith('Testville'))).toBe(
      false,
    )
  })
})

describe('réseau de la carte par défaut', () => {
  it('sépare grands axes et voies ferrées des routes', () => {
    const all = ROAD_BIT | MAJOR_ROAD_BIT
    expect(roadColor(all, BASE_ROAD_COLORS, 'main')).toBe(BASE_ROAD_COLORS.major)
    expect(roadColor(all, BASE_ROAD_COLORS, 'minor')).toBeNull()
    expect(roadColor(RAIL_BIT, BASE_ROAD_COLORS, 'main')).toBe(BASE_ROAD_COLORS.rail)
    expect(roadColor(ROAD_BIT, BASE_ROAD_COLORS, 'main')).toBeNull()
    expect(roadColor(ROAD_BIT, BASE_ROAD_COLORS, 'minor')).toBe(BASE_ROAD_COLORS.road)
  })

  it('apparaît avec le zoom, les routes après les grands axes', () => {
    // Carte du monde (cellules de 0,1°).
    expect(roadOpacity(2, 0.1, 'main')).toBe(0)
    expect(roadOpacity(4, 0.1, 'main')).toBe(1)
    expect(roadOpacity(4, 0.1, 'minor')).toBe(0)
    expect(roadOpacity(5, 0.1, 'minor')).toBeGreaterThan(0.4)
    expect(roadOpacity(6, 0.1, 'minor')).toBe(1)
    // Théâtre ukrainien (0,05°) : même rendu un cran de zoom plus tard.
    expect(roadOpacity(5, 0.05, 'main')).toBeCloseTo(roadOpacity(4, 0.1, 'main'))
  })
})
