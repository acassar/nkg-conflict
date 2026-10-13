import { describe, expect, it } from 'vitest'
import {
  brigadeCount,
  countryForces,
  gameDivisions,
  generateForces,
  generatedBrigadeCount,
  generatedMix,
  isSupportTemplate,
  pairRegiments,
  rawCountry,
} from '@/sim/scenarios/forces'
import table from '@/sim/data/forces.json'
import { BRIGADE_TEMPLATES, DIVISION_TEMPLATES } from '@/sim/units/templates'

describe('forces de départ', () => {
  it('deux régiments forment une brigade de jeu, un régiment seul en forme une', () => {
    const out = pairRegiments([
      ['1er régiment', 'motorisee', 'r'],
      ['2e régiment', 'motorisee', 'r'],
      ['3e régiment', 'blindee', 'r'],
      ['4e brigade', 'mecanisee', 'b'],
    ])
    expect(out.map((b) => b.name)).toEqual([
      '1er régiment et 2e régiment',
      '4e brigade',
      '3e régiment',
    ])
    expect(out.map((b) => b.template)).toEqual(['motorisee', 'mecanisee', 'blindee'])
  })

  it('divisions de jeu de 3 ou 4 brigades, nommées d’après leur corps, appuis répartis', () => {
    const brigades = [
      ...Array.from({ length: 7 }, (_, k) => ({ name: `${k + 1}e`, template: 'mecanisee' })),
      { name: 'artillerie', template: 'artillerie' },
      { name: 'sol-air', template: 'defense_sol_air' },
    ]
    const divisions = gameDivisions("9e corps d'armée", brigades)
    expect(divisions.map((d) => d.name)).toEqual([
      "1re division (9e corps d'armée)",
      "2e division (9e corps d'armée)",
    ])
    expect(divisions.every((d) => d.generated)).toBe(true)
    for (const d of divisions) {
      const maneuver = d.brigades.filter((b) => !isSupportTemplate(b.template)).length
      expect(maneuver).toBeGreaterThanOrEqual(3)
      expect(maneuver).toBeLessThanOrEqual(4)
      expect(d.brigades.some((b) => isSupportTemplate(b.template))).toBe(true)
    }
    expect(brigadeCount([{ name: 'a', corps: [], divisions }])).toBe(9)
  })

  it('génération : 60 % des forces armées, une brigade pour 4 500 hommes, selon la richesse', () => {
    expect(generatedBrigadeCount({ gdpB: 1, pop: 1, armedForces: 45_000 })).toBe(6)
    expect(generatedBrigadeCount({ gdpB: 1, pop: 1, armedForces: 100 })).toBe(1)
    const share = (mix: Array<[string, number]>, t: string): number =>
      mix.find(([k]) => k === t)?.[1] ?? 0
    expect(share(generatedMix(50_000), 'mecanisee')).toBeGreaterThan(
      share(generatedMix(2_000), 'mecanisee'),
    )
    expect(share(generatedMix(2_000), 'infanterie_legere')).toBeGreaterThan(
      share(generatedMix(50_000), 'infanterie_legere'),
    )
    // Petit pays : une armée, sans corps.
    const small = generateForces(5, 30_000)
    expect(small).toHaveLength(1)
    expect(small[0]?.corps).toHaveLength(0)
    expect(brigadeCount(small)).toBe(5)
    // Un corps dès 3 divisions de 3 brigades ; une seconde armée au-delà de 5 corps.
    const big = generateForces(60, 10_000)
    expect(brigadeCount(big)).toBe(60)
    expect(big.length).toBe(2)
    expect(big[0]?.corps.length).toBe(5)
    const divisions = big.flatMap((a) => a.corps.flatMap((c) => c.divisions))
    expect(divisions).toHaveLength(20)
    for (const d of divisions) expect(d.brigades.length).toBe(3)
    for (const a of big)
      for (const c of a.corps) expect(c.divisions.length).toBeGreaterThanOrEqual(3)
  })

  it('ordres de bataille réels : armées, corps et divisions nommés, modèles connus', () => {
    const ukr = countryForces('UKR')
    expect(ukr.source).toBe('oob')
    const ground = ukr.armies.find((a) => a.name === 'Forces terrestres ukrainiennes')
    expect(ground?.corps.map((c) => c.name)).toContain("3e corps d'armée")
    const rus = countryForces('RUS')
    const tank = rus.armies.find((a) => a.name.startsWith('1re armée blindée de la Garde'))
    expect(tank?.divisions.map((d) => d.name)).toContain(
      '4e division de chars (Garde, Kantemirovskaïa)',
    )
    expect(tank?.divisions.find((d) => d.name.startsWith('4e division'))?.template).toBe(
      'div_blindee',
    )
    for (const code of Object.keys(table)) {
      for (const a of countryForces(code).armies) {
        for (const d of [...a.divisions, ...a.corps.flatMap((c) => c.divisions)]) {
          expect(DIVISION_TEMPLATES[d.template]).toBeDefined()
          expect(d.brigades.length).toBeGreaterThan(0)
          for (const b of d.brigades) expect(BRIGADE_TEMPLATES[b.template]).toBeDefined()
        }
      }
    }
  })

  it('faible confiance : gardé près de l’estimation, complété s’il est trop maigre', () => {
    const pak = countryForces('PAK')
    expect(rawCountry('PAK')?.oob?.confidence).toBe('faible')
    expect(pak.source).toBe('oob')
    // Total mondial dans l'ordre de grandeur attendu (3 000 à 5 000 brigades).
    let total = 0
    for (const code of Object.keys(table)) total += brigadeCount(countryForces(code).armies)
    expect(total).toBeGreaterThan(3000)
    expect(total).toBeLessThan(5000)
  })
})
