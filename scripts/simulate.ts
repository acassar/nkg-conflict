/**
 * Partie sans affichage, pour vérifier l'équilibrage et les performances.
 * Usage : npx tsx scripts/simulate.ts [jours] [--monde] [--pays=FRA] [--ia-partout]
 *   --monde       scénario « Monde 2026 » (défaut : théâtre ukrainien)
 *   --pays=XXX    pays du joueur
 *   --ia-partout  l'IA joue aussi le pays du joueur (mesure de l'équilibre des règles)
 *   --unites=3    multiplie les unités de départ (mesure des performances à l'échelle brigade)
 *   --guerre=IND  le pays du joueur déclare la guerre à ce pays au départ
 *   --profil      temps par système, en ms par heure simulée
 * Graine aléatoire : variable d'environnement SEED.
 */
import fs from 'node:fs'
import { Simulation } from '../src/sim/simulation'
import { buildScenario } from '../src/sim/scenarios'
import { loadTheater } from '../src/sim/theater/load'
import { multiplyForces, profileReport } from '../src/sim/bench'

const args = process.argv.slice(2)
const world = args.includes('--monde')
const bothAi = args.includes('--ia-partout')
const country = args.find((a) => a.startsWith('--pays='))?.slice(7)
const days = Number(args.find((a) => !a.startsWith('--')) ?? 30)
const seed = Number(process.env.SEED ?? 42)
const factor = Number(args.find((a) => a.startsWith('--unites='))?.slice(9) ?? 1)
const target = args.find((a) => a.startsWith('--guerre='))?.slice(9)
const profiled = args.includes('--profil')

const readPublic = async (p: string): Promise<ArrayBuffer> => {
  const buf = fs.readFileSync(new URL(`../public/${p}`, import.meta.url))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

const loadStart = performance.now()
const scenario = buildScenario(world ? 'world-2026' : 'ukraine-2026', country)
const theater = await loadTheater(world ? 'world' : 'ukraine', readPublic)
const sim = Simulation.fromScenario(scenario, theater, seed, scenario.playerCountry)
sim.aiControlsPlayer = bothAi
multiplyForces(sim.ctx, factor)
if (target) {
  const refused = sim.declareWar(target)
  if (refused) throw new Error(`Déclaration de guerre refusée : ${refused}`)
}
if (profiled) sim.profile = new Map()
console.log(`Chargement : ${(performance.now() - loadStart).toFixed(0)} ms`)

const started = performance.now()
let worstDay = 0
let worstDayIndex = 0
const watch = ['UKR', 'RUS', scenario.playerCountry].filter((c, i, a) => a.indexOf(c) === i)
for (let d = 1; d <= days && !sim.outcome; d++) {
  const dayStart = performance.now()
  sim.step(24)
  const dayMs = performance.now() - dayStart
  if (dayMs > worstDay) {
    worstDay = dayMs
    worstDayIndex = d
  }
  if (d % Math.max(1, Math.floor(days / 10)) !== 0 && d !== days) continue
  const snap = sim.snapshot()
  const count = (c: string): number => snap.units.filter((u) => u.owner === c).length
  const held = watch.map((c) => `${c} ${count(c)}u ${(snap.territoryHeld[c]! * 100).toFixed(1)} %`)
  const wars = snap.politics.wars.map((w) => `${w.attackers.join('+')}→${w.defenders.join('+')}`)
  console.log(
    `J${d} · ${held.join(' · ')} · unités ${snap.units.length} · guerres ${wars.join(', ') || 'aucune'}`,
  )
}
const ms = performance.now() - started
console.log(
  `${sim.tick} ticks en ${ms.toFixed(0)} ms (${((ms / sim.tick) * 1000).toFixed(0)} µs/tick, ` +
    `pire journée J${worstDayIndex} ${(worstDay / 24).toFixed(1)} ms/h)`,
)
if (sim.profile) {
  console.log('Profil (ms par heure simulée) :')
  for (const p of profileReport(sim.profile, sim.tick)) {
    console.log(
      `  ${p.name.padEnd(22)} ${p.msPerHour.toFixed(2).padStart(7)}  ${(p.share * 100).toFixed(0)} %`,
    )
  }
}
const snap = sim.snapshot(true)
console.log('Derniers événements :')
for (const e of snap.events.slice(-15)) console.log(`  [h${e.tick}] ${e.text}`)
if (sim.outcome) console.log('Issue :', sim.outcome)
for (const u of snap.units) {
  if (Number.isNaN(u.lon) || Number.isNaN(u.strength) || Number.isNaN(u.org)) {
    throw new Error(`Valeur invalide sur ${u.name}`)
  }
}
