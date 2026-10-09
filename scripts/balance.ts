/**
 * Rapport d'équilibrage : parties IA contre IA sur plusieurs graines (théâtre ukrainien).
 * Usage : npx tsx scripts/balance.ts [jours] [graines] [dossier]
 *   jours    durée de chaque partie (défaut 120)
 *   graines  liste séparée par des virgules (défaut 1,2,3)
 *   dossier  où écrire report.json et report.md (défaut ci-out/balance)
 */
import fs from 'node:fs'
import path from 'node:path'
import { buildScenario } from '../src/sim/scenarios'
import { loadTheater } from '../src/sim/theater/load'
import { balanceMarkdown, playBalanceGame, summarizeBalance } from '../src/sim/balance'

const args = process.argv.slice(2)
const days = Number(args[0] ?? 120)
const seeds = (args[1] ?? '1,2,3').split(',').map(Number)
const outDir = args[2] ?? 'ci-out/balance'

const readPublic = async (p: string): Promise<ArrayBuffer> => {
  const buf = fs.readFileSync(new URL(`../public/${p}`, import.meta.url))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

const scenario = buildScenario('ukraine-2026')
const theater = await loadTheater('ukraine', readPublic)
const games = seeds.map((seed) => {
  const g = playBalanceGame(scenario, theater, seed, days, ['UKR', 'RUS'])
  console.log(`graine ${seed} : ${g.days} jours en ${g.ms} ms`)
  return g
})
const title = `Équilibrage Ukraine 2026, IA contre IA, ${days} jours`
const markdown = balanceMarkdown(title, games)
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(
  path.join(outDir, 'report.json'),
  JSON.stringify(
    {
      sha: process.env.GITHUB_SHA ?? null,
      days,
      seeds,
      summary: summarizeBalance(games),
      games,
    },
    null,
    2,
  ),
)
fs.writeFileSync(path.join(outDir, 'report.md'), markdown)
console.log(markdown)
