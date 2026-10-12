import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import world from '@/sim/data/world/countries.json'

/** Données réelles (phase D3, étape 1) : un fichier par pays, encore inutilisé par la simulation. */
const dir = new URL('../src/sim/data/real/', import.meta.url)

const TYPES = new Set([
  'infanterie_legere',
  'motorisee',
  'mecanisee',
  'blindee',
  'aeroportee',
  'aeromobile',
  'montagne',
  'infanterie_marine',
  'artillerie',
  'defense_sol_air',
  'genie',
  'reconnaissance',
  'defense_territoriale',
  'soutien',
  'aviation_legere',
  'forces_speciales',
  'garde_nationale',
])

interface Sourced {
  value: number
  year: number | null
  source: string
}
interface Brigade {
  name: string
  type: string
  echelon?: 'brigade' | 'regiment'
  strengthPct?: number
}
interface Division {
  name: string
  type: string
  brigades: Brigade[]
}
interface Formation {
  name: string
  brigades?: Brigade[]
  divisions?: Division[]
  corps?: Formation[]
}
interface CountryData {
  code: string
  name: string
  macro: Record<'gdpB' | 'pop' | 'defensePctGdp' | 'armedForces', Sourced | null>
  oob: null | {
    asOf: string
    armyPersonnel: Sourced
    armies: Formation[]
    sources: Array<{ title: string; url: string }>
    confidence: string
  }
}

const read = (code: string): CountryData =>
  JSON.parse(fs.readFileSync(new URL(`${code}.json`, dir), 'utf8')) as CountryData

function brigadesOf(f: Formation): Brigade[] {
  return [
    ...(f.brigades ?? []),
    ...(f.divisions ?? []).flatMap((d) => d.brigades),
    ...(f.corps ?? []).flatMap(brigadesOf),
  ]
}

const codes = (world as { countries: Array<{ code: string }> }).countries.map((c) => c.code)

describe('données réelles par pays', () => {
  it('un fichier par pays de la carte, chiffres sourcés et plausibles', () => {
    for (const code of codes) {
      const d = read(code)
      expect(d.code).toBe(code)
      for (const v of Object.values(d.macro)) {
        if (!v) continue
        expect(v.value).toBeGreaterThanOrEqual(0)
        expect(v.source.length).toBeGreaterThan(0)
      }
    }
    expect(read('FRA').macro.pop?.value).toBeGreaterThan(60e6)
    expect(read('USA').macro.gdpB?.value).toBeGreaterThan(20_000)
  })

  it('ordres de bataille détaillés : une trentaine de pays, types connus, sources citées', () => {
    const detailed = codes.map(read).filter((d) => d.oob)
    expect(detailed.length).toBeGreaterThanOrEqual(30)
    for (const d of detailed) {
      const oob = d.oob!
      expect(oob.armies.length, d.code).toBeGreaterThan(0)
      expect(oob.sources.length, d.code).toBeGreaterThan(0)
      expect(oob.armyPersonnel.value, d.code).toBeGreaterThan(0)
      const brigades = oob.armies.flatMap(brigadesOf)
      expect(brigades.length, d.code).toBeGreaterThan(0)
      for (const b of brigades)
        expect(TYPES.has(b.type), `${d.code} ${b.name} ${b.type}`).toBe(true)
    }
  })
})
