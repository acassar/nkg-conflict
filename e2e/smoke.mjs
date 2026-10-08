/**
 * Test de fumée dans un vrai navigateur : charge le jeu buildé, joue quelques secondes,
 * prend des captures d'écran et relève les erreurs de la console.
 *
 * Usage : node e2e/smoke.mjs <url> <dossier de sortie>
 * Le jeu expose `window.__nkg` (store Pinia) pour piloter la partie depuis le test.
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:4173'
const out = process.argv[3] ?? 'ci-out/smoke'
fs.mkdirSync(out, { recursive: true })

const report = { url, ok: false, errors: [], console: [], steps: [] }
const step = (name, data = {}) => {
  report.steps.push({ name, ...data })
  console.log(`- ${name}`, JSON.stringify(data))
}

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => report.errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  const line = `${m.type()}: ${m.text()}`
  report.console.push(line)
  if (m.type() === 'error') report.errors.push(line)
})

const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) })
const state = () =>
  page.evaluate(() => {
    const g = window.__nkg
    const s = g?.snapshot
    if (!s) return null
    return {
      tick: s.tick,
      paused: s.paused,
      units: s.units.length,
      engaged: s.units.filter((u) => u.engaged).length,
      armies: s.armies.length,
      territoryHeld: s.territoryHeld,
      gridVersion: s.gridVersion,
      hasGrid: !!g.grid,
      events: s.events.slice(-5).map((e) => e.text),
    }
  })

try {
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__nkg?.snapshot && window.__nkg?.grid, null, {
    timeout: 30_000,
  })
  await page.waitForTimeout(4000) // tuiles du fond de carte
  step('chargement', await state())
  await shot('01-depart')

  // Sélection de l'armée du joueur et ouverture de l'onglet Armées.
  await page.evaluate(() => {
    const g = window.__nkg
    const first = g.armies[0]
    if (first) g.selectArmy(first.id)
  })
  await page.getByRole('button', { name: /Armées/ }).click()
  await page.waitForTimeout(500)
  step('armée sélectionnée', await state())
  await shot('02-armee-selectionnee')

  // Ordre de mouvement à une unité via la carte : clic droit au centre de l'écran.
  await page.evaluate(() => {
    const g = window.__nkg
    const u = g.snapshot.units.find((x) => x.owner === g.snapshot.playerCountry)
    if (u) g.selectUnit(u.id, false)
  })
  await page.mouse.click(720, 450, { button: 'right' })
  await page.waitForTimeout(300)
  step('ordre clic droit', await state())

  // Lecture à vitesse 5 pendant 8 s.
  await page.keyboard.press('5')
  await page.keyboard.press('Space')
  await page.waitForTimeout(8000)
  await page.keyboard.press('Space')
  await page.waitForTimeout(500)
  const after = await state()
  step('après 8 s en vitesse 5', after)
  await shot('03-apres-lecture')

  // Zoom sur le front.
  await page.mouse.move(900, 420)
  for (let k = 0; k < 4; k++) await page.mouse.wheel(0, -300)
  await page.waitForTimeout(2500)
  await shot('04-zoom-front')

  report.ok = !!after && after.tick > 0 && report.errors.length === 0
} catch (e) {
  report.errors.push(`test: ${e instanceof Error ? e.message : String(e)}`)
  await shot('99-echec').catch(() => {})
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(report.ok ? 'SMOKE OK' : `SMOKE KO : ${report.errors.length} erreur(s)`)
