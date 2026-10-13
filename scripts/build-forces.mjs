#!/usr/bin/env node
/**
 * Compacte les données réelles par pays (src/sim/data/real/*.json, phase D3) en un seul fichier lu par
 * la simulation : PIB, population, effectifs des forces armées et ordre de bataille (sans les sources,
 * qui restent dans les fichiers par pays).
 *
 * Usage : node scripts/build-forces.mjs
 * Sortie : src/sim/data/forces.json
 */
import fs from 'node:fs'
import path from 'node:path'

const DIR = path.resolve('src/sim/data/real')
const OUT = path.resolve('src/sim/data/forces.json')

const brigade = (b) => [b.name, b.type, b.echelon === 'regiment' ? 'r' : 'b']
const brigades = (list) => (list ?? []).map(brigade)
const division = (d) => ({ name: d.name, type: d.type, brigades: brigades(d.brigades) })

const out = {}
for (const file of fs.readdirSync(DIR).sort()) {
  if (!file.endsWith('.json') || !/^[A-Z]{3}\.json$/.test(file)) continue
  const d = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'))
  const m = d.macro ?? {}
  const entry = {
    gdpB: m.gdpB?.value ?? null,
    pop: m.pop?.value ?? null,
    armedForces: m.armedForces?.value ?? null,
  }
  const o = d.oob
  if (o) {
    entry.oob = {
      asOf: o.asOf,
      confidence: o.confidence,
      armyPersonnel: o.armyPersonnel?.value ?? null,
      armies: o.armies.map((a) => ({
        name: a.name,
        generated: a.generated === true,
        brigades: brigades(a.brigades),
        corps: (a.corps ?? []).map((c) => ({
          name: c.name,
          brigades: brigades(c.brigades),
          divisions: (c.divisions ?? []).map(division),
        })),
        divisions: (a.divisions ?? []).map(division),
      })),
    }
  }
  out[d.code] = entry
}
fs.writeFileSync(OUT, JSON.stringify(out) + '\n')
console.log(`${Object.keys(out).length} pays, ${(fs.statSync(OUT).size / 1024).toFixed(0)} Ko`)
