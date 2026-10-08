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
  // CHROMIUM_PATH : navigateur déjà installé (sinon celui téléchargé par Playwright).
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => report.errors.push(`pageerror: ${e.message}`))
// Les ressources externes (fond de carte) peuvent être injoignables selon l'environnement :
// elles sont notées à part et ne font pas échouer le test.
const external = (u) => !u.startsWith(new URL(url).origin)
report.network = []
page.on('requestfailed', (r) => report.network.push(`échec ${r.url()}`))
page.on('response', (r) => {
  if (r.status() >= 400) {
    const line = `${r.status()} ${r.url()}`
    report.network.push(line)
    if (!external(r.url())) report.errors.push(`http: ${line}`)
  }
})
page.on('console', (m) => {
  const line = `${m.type()}: ${m.text()}`
  report.console.push(line)
  const networkNoise = /Failed to load resource|Failed to fetch/.test(m.text())
  if (m.type() === 'error' && !networkNoise) report.errors.push(line)
})

const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) })
const state = () =>
  page.evaluate(() => {
    const g = window.__nkg
    const s = g?.snapshot
    if (!s) return null
    return {
      tick: s.tick,
      player: s.playerCountry,
      wars: s.politics.wars.map((w) => `${w.attackers.join('+')}→${w.defenders.join('+')}`),
      paused: s.paused,
      units: s.units.length,
      engaged: s.units.filter((u) => u.engaged).length,
      armies: s.armies.length,
      territoryHeld: Object.fromEntries(
        [s.playerCountry, 'RUS'].map((c) => [c, Math.round((s.territoryHeld[c] ?? 0) * 1000) / 10]),
      ),
      gridVersion: s.gridVersion,
      hasGrid: !!g.grid,
      events: s.events.slice(-5).map((e) => e.text),
    }
  })

try {
  await page.goto(url, { waitUntil: 'load' })

  // Écran de départ : scénario « Monde 2026 », recherche de l'Ukraine, lancement.
  await page.getByTestId('start-screen').waitFor({ timeout: 30_000 })
  await page.locator('[data-country]').first().waitFor({ timeout: 30_000 })
  await page.waitForTimeout(2000) // tuiles du fond de carte
  await shot('00-ecran-depart')
  await page.getByRole('searchbox', { name: 'Rechercher un pays' }).fill('ukr')
  await page.locator('[data-country="UKR"]').click()
  await page.getByRole('button', { name: /^Jouer / }).click()
  await page.waitForFunction(() => window.__nkg?.snapshot && window.__nkg?.grid, null, {
    timeout: 60_000,
  })
  await page.waitForTimeout(4000)
  const start = await state()
  step('chargement', start)
  if (start?.player !== 'UKR') report.errors.push(`pays du joueur inattendu (${start?.player})`)
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
  await page.waitForTimeout(500)
  const ordered = await page.evaluate(() => {
    const g = window.__nkg
    const id = g.selection[0]
    return g.snapshot.units.find((u) => u.id === id)?.order ?? null
  })
  step('ordre clic droit', { ordre: ordered })
  if (ordered !== 'move') report.errors.push(`ordre clic droit non appliqué (${ordered})`)

  // Production : ville sélectionnée, chantier et formation lancés par les boutons du panneau.
  await page.evaluate(() => window.__nkg.selectCity('Kyiv'))
  await page.waitForTimeout(300)
  const queues = () =>
    page.evaluate(() => {
      const e = window.__nkg.snapshot.economy
      return { construction: e.construction.length, recruitment: e.recruitment.length }
    })
  const before = await queues()
  await page.getByRole('button', { name: 'Construire' }).first().click()
  await page.getByRole('button', { name: 'Infanterie', exact: true }).click()
  await page.waitForTimeout(500)
  const afterQueue = await queues()
  step('production', { avant: before, apres: afterQueue })
  if (afterQueue.construction !== before.construction + 1) {
    report.errors.push('construction non lancée depuis le panneau')
  }
  if (afterQueue.recruitment !== before.recruitment + 1) {
    report.errors.push('formation non lancée depuis le panneau')
  }
  await shot('02b-production')

  // Diplomatie : fiche de son pays, puis d'un pays voisin via un clic sur la carte.
  await page.evaluate(() => window.__nkg.clearSelection())
  await page.getByTestId('tab-country').click()
  await page.getByTestId('country-tab').waitFor()
  await shot('02c-diplomatie')
  await page.evaluate(() => window.__nkg.selectCountry('POL'))
  const relationBefore = await page.evaluate(
    () => window.__nkg.snapshot.politics.playerRelations.POL ?? 0,
  )
  await page.getByRole('button', { name: 'Améliorer les relations' }).click()
  await page.waitForTimeout(400)
  const relationAfter = await page.evaluate(
    () => window.__nkg.snapshot.politics.playerRelations.POL ?? 0,
  )
  step('diplomatie', { avant: relationBefore, apres: relationAfter })
  if (!(relationAfter > relationBefore)) report.errors.push('relations non améliorées')
  await shot('02d-fiche-pologne')

  // Lecture à vitesse 5 pendant 8 s.
  await page.keyboard.press('5')
  await page.keyboard.press('Space')
  await page.waitForTimeout(8000)
  await page.keyboard.press('Space')
  await page.waitForTimeout(500)
  const after = await state()
  step('après 8 s en vitesse 5', after)
  await shot('03-apres-lecture')

  // Zoom sur le front, autour de Kharkiv.
  await page.evaluate(() => {
    window.__nkg.focus = { at: [36.2, 49.2], zoom: 6.5, nonce: Date.now() }
  })
  await page.waitForTimeout(3500)
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
