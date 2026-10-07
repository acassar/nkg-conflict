/**
 * Partie sans affichage, pour vérifier l'équilibrage et les performances.
 * Usage : npx tsx scripts/simulate.ts [jours] [fichier de sortie .json de la grille finale]
 */
import fs from 'node:fs'
import { Simulation } from '../src/sim/simulation'
import { ukraine2026 } from '../src/sim/scenarios/ukraine-2026'
import type { TheaterData } from '../src/sim/theater/grid'

const days = Number(process.argv[2] ?? 30)
const out = process.argv[3]
const theater = JSON.parse(
  fs.readFileSync(new URL('../src/sim/data/theater-ukraine.json', import.meta.url), 'utf8'),
) as TheaterData

const sim = Simulation.fromScenario(ukraine2026, theater, 42)
const started = performance.now()
for (let d = 1; d <= days && !sim.outcome; d++) {
  sim.step(24)
  const snap = sim.snapshot()
  const count = (c: string): number => snap.units.filter((u) => u.owner === c).length
  const held = Object.entries(snap.territoryHeld)
    .map(([c, v]) => `${c} ${(v * 100).toFixed(1)} %`)
    .join(' · ')
  const engaged = snap.units.filter((u) => u.engaged).length
  console.log(
    `J${d} · unités UKR ${count('UKR')} RUS ${count('RUS')} · au contact ${engaged} · ${held}`,
  )
}
const ms = performance.now() - started
console.log(
  `${sim.tick} ticks en ${ms.toFixed(0)} ms (${((ms / sim.tick) * 1000).toFixed(0)} µs/tick)`,
)
const snap = sim.snapshot(true)
console.log('Derniers événements :')
for (const e of snap.events.slice(-15)) console.log(`  [h${e.tick}] ${e.text}`)
if (sim.outcome) console.log('Issue :', sim.outcome)
for (const u of snap.units) {
  if (Number.isNaN(u.lon) || Number.isNaN(u.strength) || Number.isNaN(u.org)) {
    throw new Error(`Valeur invalide sur ${u.name}`)
  }
}
if (out && snap.grid) {
  fs.writeFileSync(
    out,
    JSON.stringify({
      width: snap.grid.width,
      height: snap.grid.height,
      owner: Array.from(snap.grid.owner),
      terrain: Array.from(snap.grid.terrain),
      bbox: snap.grid.bbox,
      units: snap.units.map((u) => [u.lon, u.lat, u.owner, u.kind]),
    }),
  )
}
