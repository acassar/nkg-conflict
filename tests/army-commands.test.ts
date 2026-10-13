import { describe, expect, it } from 'vitest'
import { countryForces, GEN_ARMY_CORPS, type CountryForces } from '@/sim/scenarios/forces'
import { groupByCommand, sectorForces, splitLargeArmies } from '@/sim/scenarios/sectors'

const corpsNames = (f: CountryForces, army: string): string[] =>
  f.armies.find((a) => a.name === army)?.corps.map((c) => c.name) ?? []

describe('commandements réels et armées trop grandes (phase D3)', () => {
  it('regroupe les corps ukrainiens sous leurs commandements, dans l’ordre du front', () => {
    const f = groupByCommand('UKR', countryForces('UKR'))
    expect(corpsNames(f, 'Forces opérationnelles et tactiques Centre').sort()).toEqual(
      ["11e corps d'armée", "19e corps d'armée", "3e corps d'armée"].sort(),
    )
    // Chaque corps une seule fois ; dans les Forces terrestres, seul le 21e corps (sans source).
    const all = f.armies.flatMap((a) => a.corps.map((c) => c.name))
    expect(new Set(all).size).toBe(all.length)
    expect(corpsNames(f, 'Forces terrestres ukrainiennes')).toEqual(["21e corps d'armée"])
    // Corps sans commandement connu : reste dans son armée d'origine.
    expect(corpsNames(f, "Forces d'assaut aérien (DShV)")).toContain("8e corps d'assaut aérien")
  })

  it('les brigades des corps ukrainiens partent dans la direction de leur corps', () => {
    const f = sectorForces('UKR', countryForces('UKR'))
    const centre = f.armies.find((a) => a.name === 'Forces opérationnelles et tactiques Centre')
    expect(centre?.corps.every((c) => c.sector !== undefined)).toBe(true)
  })

  it('répartit une armée de plus de 5 corps sans échelon armée réel', () => {
    const raw = countryForces('PAK')
    const before = raw.armies.reduce((n, a) => n + a.corps.length, 0)
    const f = splitLargeArmies('PAK', raw)
    expect(f.armies.every((a) => a.corps.length <= GEN_ARMY_CORPS)).toBe(true)
    expect(f.armies.reduce((n, a) => n + a.corps.length, 0)).toBe(before)
    expect(f.armies.map((a) => a.name)).toContain('1re armée (Armée de terre pakistanaise)')
  })
})
