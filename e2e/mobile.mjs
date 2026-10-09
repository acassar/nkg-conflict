/**
 * Test de fumée sur téléphone : écran tactile 390 × 844 (portrait) puis 844 × 390 (paysage).
 * Vérifie la barre compacte, le menu, la sélection par zone, le tiroir et un ordre au doigt.
 *
 * Usage : node e2e/mobile.mjs <url> <dossier de sortie>
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:4173'
const out = process.argv[3] ?? 'ci-out/mobile'
fs.mkdirSync(out, { recursive: true })

const report = { url, ok: false, errors: [], console: [], steps: [] }
const step = (name, data = {}) => {
  report.steps.push({ name, ...data })
  console.log(`- ${name}`, JSON.stringify(data))
}
const check = (cond, message) => {
  if (!cond) report.errors.push(message)
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 1,
})
const page = await context.newPage()
page.on('pageerror', (e) => report.errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  const line = `${m.type()}: ${m.text()}`
  report.console.push(line)
  if (m.type() === 'error' && !/Failed to load resource|Failed to fetch/.test(m.text())) {
    report.errors.push(line)
  }
})

const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) })
const store = (fn) => page.evaluate(fn)

try {
  await page.goto(url, { waitUntil: 'load' })
  await page.getByTestId('start-screen').waitFor({ timeout: 30_000 })
  await page.locator('[data-country]').first().waitFor({ timeout: 30_000 })
  await shot('m00-ecran-depart')
  await page.getByRole('searchbox', { name: 'Rechercher un pays' }).fill('ukr')
  await page.locator('[data-country="UKR"]').tap()
  await page.getByRole('button', { name: /^Jouer / }).tap()
  await page.waitForFunction(() => window.__nkg?.snapshot && window.__nkg?.grid, null, {
    timeout: 60_000,
  })
  await page.waitForTimeout(3500)
  await shot('m01-partie')

  // La barre du haut tient sur une ligne et ne déborde pas.
  const bar = await page.locator('header.topbar').boundingBox()
  step('barre du haut', { hauteur: bar?.height })
  check(bar && bar.height < 70, `barre du haut trop haute (${bar?.height})`)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  check(!overflow, 'la page déborde horizontalement')

  // Menu : ressources et fichiers.
  await page.getByTestId('menu-button').tap()
  await page.getByRole('menu').waitFor()
  await shot('m02-menu')
  await page.getByTestId('menu-button').tap()

  // Carte logistique : bouton à côté de la sélection par zone, légende au-dessus.
  await page.getByTestId('logistics-button').tap()
  await page.getByTestId('logistics-legend').waitFor()
  await page.waitForFunction(() => window.__nkg.supply?.view, null, { timeout: 10_000 })
  const legend = await page.getByTestId('logistics-legend').boundingBox()
  step('carte logistique', { legende: legend })
  check(legend && legend.x >= 0 && legend.x + legend.width <= 390, 'légende logistique hors écran')
  await shot('m02b-logistique')
  await page.getByTestId('logistics-button').tap()

  // Sélection par zone : un rectangle sur toute la carte visible.
  await page.getByTestId('lasso-button').tap()
  await page.getByTestId('lasso-layer').waitFor()
  await page.mouse.move(10, 110)
  await page.mouse.down()
  await page.mouse.move(200, 400, { steps: 5 })
  await page.mouse.move(385, 700, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  const selected = await store(() => window.__nkg.selection.length)
  const drawer = await store(() => window.__nkg.drawer)
  step('sélection par zone', { unites: selected, tiroir: drawer })
  check(selected > 0, 'la sélection par zone ne sélectionne rien')
  check(drawer === 'half', `le tiroir devrait s'ouvrir à mi-hauteur (${drawer})`)
  await shot('m03-selection')

  // Ordre au doigt : bouton « Déplacer », le tiroir se replie, puis toucher la destination.
  await page.getByRole('button', { name: 'Déplacer', exact: true }).tap()
  await page.waitForTimeout(400)
  const during = await store(() => window.__nkg.drawer)
  check(during === 'collapsed', `le tiroir devrait se replier pendant l'ordre (${during})`)
  await shot('m04-ordre')
  await page.touchscreen.tap(150, 300)
  await page.waitForTimeout(500)
  const order = await store(() => {
    const g = window.__nkg
    const id = g.selection[0]
    return g.snapshot.units.find((u) => u.id === id)?.order ?? null
  })
  const after = await store(() => window.__nkg.drawer)
  step('ordre au doigt', { ordre: order, tiroir: after })
  check(order === 'move', `ordre de déplacement non donné (${order})`)
  check(after === 'half', `le tiroir devrait revenir à mi-hauteur (${after})`)

  // Écran de bataille : pleine largeur en haut de l'écran, fermé par ✕.
  let battle = false
  for (let k = 0; k < 20 && !battle; k++) {
    await page.evaluate(() => window.__nkg.step(24))
    await page.waitForTimeout(300)
    battle = await store(() => {
      const g = window.__nkg
      const u = g.snapshot.units.find((x) => x.owner === g.snapshot.playerCountry && x.engagedWith)
      if (!u) return false
      g.openBattle([u.id, u.engagedWith])
      return true
    })
  }
  if (battle) {
    await page.getByTestId('battle-dialog').waitFor()
    await page.waitForTimeout(800)
    const box = await page.getByTestId('battle-dialog').boundingBox()
    step('bataille (mobile)', { boite: box })
    check(!!box && box.x >= 0 && box.x + box.width <= 390, "l'écran de bataille déborde")
    await shot('m04b-bataille')
    await page.getByTestId('battle-dialog').getByRole('button', { name: 'Fermer' }).tap()
    await page.waitForTimeout(300)
    check(!(await page.getByTestId('battle-dialog').isVisible()), 'bataille non fermée')
  } else {
    step('bataille (mobile)', { note: 'aucun combat en cours' })
  }

  // Tiroir : onglet Diplomatie, puis glissé vers le haut (plein écran).
  await page.getByTestId('tab-country').tap()
  await page.waitForTimeout(300)
  await shot('m05-diplomatie')
  const handle = await page.getByTestId('drawer-handle').boundingBox()
  if (handle) {
    const x = handle.x + handle.width / 2
    const y = handle.y + handle.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, 120, { steps: 8 })
    await page.mouse.up()
  }
  await page.waitForTimeout(500)
  const full = await store(() => window.__nkg.drawer)
  step('tiroir glissé', { etat: full })
  check(full === 'full', `le tiroir devrait être plein écran (${full})`)
  await shot('m06-tiroir-plein')

  // Retour au menu par le menu ☰, puis écran de départ.
  await page.getByTestId('menu-button').tap()
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Menu principal' }).tap()
  await page.getByTestId('start-screen').waitFor({ timeout: 15_000 })
  step('retour au menu', { ok: true })
  await shot('m06b-menu')
  await page.locator('[data-slot="auto"]').tap()
  await page.waitForFunction(() => window.__nkg?.snapshot, null, { timeout: 60_000 })
  await page.waitForTimeout(1500)

  // Paysage : panneau sur le côté.
  await page.setViewportSize({ width: 844, height: 390 })
  await page.waitForTimeout(1200)
  const panel = await page.getByTestId('command-panel').boundingBox()
  step('paysage', { panneau: panel })
  check(!!panel && panel.x > 400, 'en paysage, le panneau devrait être sur le côté droit')
  await shot('m07-paysage')

  report.ok = report.errors.length === 0
} catch (e) {
  report.errors.push(`test: ${e instanceof Error ? e.message : String(e)}`)
  await shot('m99-echec').catch(() => {})
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(report.ok ? 'MOBILE OK' : `MOBILE KO : ${report.errors.join(' | ')}`)
