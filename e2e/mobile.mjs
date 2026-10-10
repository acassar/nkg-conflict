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
  // Options de départ : cochées puis décochées au doigt (la suite du test joue la guerre en cours).
  const option = page.locator('[data-option="noWars"]')
  await option.tap()
  const checked = await option.isChecked()
  await option.tap()
  step('option de départ au doigt', { cochee: checked, decochee: !(await option.isChecked()) })
  check(
    checked && !(await option.isChecked()),
    "l'option « Sans guerres de départ » ne se coche pas au doigt",
  )
  await page.getByRole('searchbox', { name: 'Rechercher un pays' }).fill('ukr')
  await page.locator('[data-country="UKR"]').tap()
  await page.getByRole('button', { name: /^Jouer / }).tap()
  await page.waitForFunction(() => window.__nkg?.snapshot && window.__nkg?.grid, null, {
    timeout: 60_000,
  })
  await page.waitForTimeout(3500)
  await shot('m01-partie')

  // Alertes : deux alertes posées sur une unité du joueur (partie en pause, pour qu'aucun nouvel état
  // ne les efface), puis « Centrer » (carte et sélection), fermeture et liste repliée.
  const alertSetup = await page.evaluate(async () => {
    const g = window.__nkg
    const wasPaused = g.snapshot.paused
    const camera = {
      center: window.__nkgMap.getCenter().toArray(),
      zoom: window.__nkgMap.getZoom(),
    }
    if (!wasPaused) await g.togglePause()
    await new Promise((r) => setTimeout(r, 300))
    const u = g.snapshot.units.find((x) => x.owner === g.snapshot.playerCountry)
    const alert = {
      kind: 'encircled',
      key: `encircled:${u.id}`,
      at: [u.lon, u.lat],
      unitIds: [u.id],
      place: 'Test',
      text: '1 unité coupée du ravitaillement près de Test',
    }
    const breach = { ...alert, kind: 'breach', key: 'breach:0', text: 'Front percé près de Test' }
    g.snapshot = { ...g.snapshot, alerts: [alert, breach] }
    return { id: u.id, at: alert.at, wasPaused, camera }
  })
  await page.getByTestId('player-alert').first().waitFor({ timeout: 5000 })
  await shot('m01b-alerte')
  await page.getByTestId('player-alert').first().getByRole('button', { name: 'Centrer' }).tap()
  await page.waitForTimeout(1800)
  const alertFocus = await page.evaluate(() => ({
    selection: window.__nkg.selection.slice(),
    center: window.__nkgMap.getCenter().toArray(),
  }))
  step('alerte centrée', alertFocus)
  check(
    alertFocus.selection.length === 1 && alertFocus.selection[0] === alertSetup.id,
    "« Centrer » ne sélectionne pas l'unité de l'alerte",
  )
  check(
    Math.abs(alertFocus.center[0] - alertSetup.at[0]) < 0.5 &&
      Math.abs(alertFocus.center[1] - alertSetup.at[1]) < 0.5,
    "« Centrer » ne centre pas la carte sur l'alerte",
  )
  await page.getByTestId('player-alert').first().getByRole('button', { name: 'Fermer' }).tap()
  await page.waitForTimeout(300)
  check((await page.getByTestId('player-alert').count()) === 1, 'alerte non fermée')
  // Liste repliée pour la suite du test : seul le compteur reste, il ne masque pas la carte.
  await page
    .getByTestId('player-alerts')
    .getByRole('button', { name: /^\d+ alertes?/ })
    .tap()
  const folded = await page.evaluate(() => window.__nkg.alertsFolded)
  step('alertes repliées', { folded })
  check(folded, 'liste des alertes non repliée')
  // Caméra et sélection rendues comme avant, pour la suite du test.
  await page.evaluate(async ({ wasPaused, camera }) => {
    window.__nkgMap.jumpTo(camera)
    window.__nkg.clearSelection()
    if (!wasPaused) await window.__nkg.togglePause()
  }, alertSetup)

  // La barre du haut tient sur une ligne et ne déborde pas.
  const bar = await page.locator('header.topbar').boundingBox()
  step('barre du haut', { hauteur: bar?.height })
  check(bar && bar.height < 70, `barre du haut trop haute (${bar?.height})`)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  check(!overflow, 'la page déborde horizontalement')

  // Menu : ressources et fichiers.
  await page.getByTestId('menu-button').tap()
  await page.getByRole('menu').waitFor()
  const sustainMobile = await page.getByTestId('sustain-mobile').innerText()
  step('soutenabilité (menu)', { valeur: sustainMobile })
  check(sustainMobile.trim().length > 0, 'soutenabilité absente du menu')
  await shot('m02-menu')
  // Aide en jeu depuis le menu : plein écran sur téléphone.
  await page.getByTestId('menu-help').tap()
  await page.getByTestId('rules-help').waitFor()
  const helpBox = await page.getByTestId('rules-help').boundingBox()
  step('aide (mobile)', { boite: helpBox })
  check(!!helpBox && helpBox.x >= 0 && helpBox.x + helpBox.width <= 390, "l'aide déborde")
  await shot('m02a-aide')
  await page.getByRole('button', { name: "Fermer l'aide" }).tap()
  // Jauge du menu : fenêtre de détail dans l'écran, fermée par « × ».
  await page.getByTestId('menu-button').tap()
  await page.getByTestId('gauge-industry-mobile').tap()
  await page.getByTestId('resource-dialog').waitFor()
  const gaugeBox = await page.getByTestId('resource-dialog').boundingBox()
  step('jauge (mobile)', { boite: gaugeBox })
  check(
    !!gaugeBox && gaugeBox.x >= 0 && gaugeBox.x + gaugeBox.width <= 390,
    'fenêtre de jauge hors écran',
  )
  await shot('m02a-jauge')
  await page.getByTestId('resource-dialog').getByRole('button', { name: 'Fermer' }).tap()
  await page.waitForTimeout(200)
  check(!(await page.getByTestId('rules-help').isVisible()), 'aide non fermée')

  // Carte logistique : bouton à côté de la sélection par zone, légende au-dessus.
  await page.getByTestId('logistics-button').tap()
  await page.getByTestId('logistics-legend').waitFor()
  await page.waitForFunction(() => window.__nkg.supply?.view, null, { timeout: 10_000 })
  const legend = await page.getByTestId('logistics-legend').boundingBox()
  step('carte logistique', { legende: legend })
  check(
    legend && legend.x >= 0 && legend.x + legend.width <= 390 && legend.y >= 0,
    'légende logistique hors écran',
  )
  await shot('m02b-logistique')
  await page.getByTestId('logistics-button').tap()

  // Appui prolongé sur la carte : bandeau de description, effacé au relâcher, sans ordre ni sélection.
  const cdp = await context.newCDPSession(page)
  const beforePress = await store(() => ({
    selection: window.__nkg.selection.length,
    mode: window.__nkg.mode.kind,
    tab: window.__nkg.panelTab,
  }))
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 200, y: 330 }],
  })
  await page.waitForTimeout(900)
  const pressVisible = await page.getByTestId('cell-info').isVisible()
  const pressText = pressVisible ? await page.getByTestId('cell-info').innerText() : ''
  const pressBox = pressVisible ? await page.getByTestId('cell-info').boundingBox() : null
  await shot('m02c-appui-prolonge')
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(400)
  const afterPress = await store(() => ({
    selection: window.__nkg.selection.length,
    mode: window.__nkg.mode.kind,
    tab: window.__nkg.panelTab,
  }))
  step('appui prolongé', { texte: pressText.replace(/\s+/g, ' '), boite: pressBox, afterPress })
  check(pressVisible && /vitesse/.test(pressText), "pas de bandeau après l'appui prolongé")
  check(!!pressBox && pressBox.x >= 0 && pressBox.x + pressBox.width <= 390, 'bandeau hors écran')
  check(!(await page.getByTestId('cell-info').isVisible()), 'bandeau resté affiché au relâcher')
  check(
    JSON.stringify(beforePress) === JSON.stringify(afterPress),
    "l'appui prolongé a changé la sélection, le mode ou l'onglet",
  )

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

  // Mission « Avancer » d'un groupe : trait dessiné d'un geste du doigt.
  await page.getByTestId('group-mission').getByRole('button', { name: 'Trait' }).tap()
  await page.getByTestId('draw-layer').waitFor()
  await page.mouse.move(120, 330)
  await page.mouse.down()
  await page.mouse.move(200, 340, { steps: 6 })
  await page.mouse.move(280, 360, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(600)
  const advancing = await store(() =>
    window.__nkg.armies.some((a) => a.mission?.kind === 'advance'),
  )
  step('mission au doigt', { avance: advancing })
  check(advancing, 'mission « Avancer » non lancée par un trait au doigt')
  await shot('m04a-mission-trait')

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

  // Recrutement par armée au doigt : sous-onglet de l'armée, deux infanteries, validation.
  await store(() => {
    const g = window.__nkg
    const army = g.armies.find((a) => !a.encirclement && a.unitIds.length > 2)
    if (army) g.selectArmy(army.id)
  })
  await page.getByTestId('army-sheet').waitFor()
  await page.getByTestId('army-view-recruit').tap()
  await page.getByTestId('recruit-add-inf').tap()
  await page.getByTestId('recruit-add-inf').tap()
  await page.getByTestId('recruit-preview').waitFor()
  await shot('m04c-recrutement-armee')
  const queuedBefore = await store(() => window.__nkg.economy?.recruitment.length ?? 0)
  await page.getByTestId('recruit-submit').tap()
  await page.waitForTimeout(500)
  const queuedAfter = await store(() => window.__nkg.economy?.recruitment.length ?? 0)
  step('recrutement par armée (mobile)', { avant: queuedBefore, apres: queuedAfter })
  check(
    queuedAfter > queuedBefore,
    `recrutement par armée non lancé (${queuedBefore} → ${queuedAfter})`,
  )
  await page.getByTestId('army-view-composition').tap()
  await page.getByTestId('army-composition').waitFor()
  const compo = await page.getByTestId('army-composition').boundingBox()
  check(!!compo && compo.x >= 0 && compo.x + compo.width <= 390, 'composition hors de l’écran')
  await shot('m04c2-composition')
  await page.getByTestId('army-view-command').tap()

  // Mission « Tenir les points clés » au doigt : carte visible dans le tiroir, aperçu, puis « Appliquer ».
  const keyButton = await page.getByTestId('mission-keyPoints').boundingBox()
  check(
    !!keyButton && keyButton.x >= 0 && keyButton.x + keyButton.width <= 390,
    'bouton « Points clés » hors de l’écran',
  )
  await page.getByTestId('mission-keyPoints').tap()
  await page.getByTestId('mission-apply').scrollIntoViewIfNeeded()
  const apply = await page.getByTestId('mission-apply').boundingBox()
  check(
    !!apply && apply.x >= 0 && apply.x + apply.width <= 390,
    'bouton « Appliquer » hors de l’écran',
  )
  await shot('m04d0-apercu-points-cles')
  await page.getByTestId('mission-apply').tap()
  await page.waitForTimeout(500)
  const keyMission = await store(
    () => window.__nkg.armies.find((a) => a.mission?.kind === 'keyPoints')?.mission?.kind ?? null,
  )
  step('points clés (mobile)', { mission: keyMission })
  check(
    keyMission === 'keyPoints',
    `mission « Tenir les points clés » non appliquée (${keyMission})`,
  )
  await shot('m04d-points-cles')

  // Barre du bas : entrée Diplomatie, retour à la sélection, puis tiroir glissé vers le haut.
  await page.getByTestId('rail-country').tap()
  await page.getByTestId('country-own').waitFor()
  const domainBar = await page.locator('nav.bar').boundingBox()
  const entries = await page.locator('nav.bar button').count()
  step('barre du bas', { boite: domainBar, entrees: entries })
  check(entries === 4, `la barre du bas devrait avoir quatre entrées (${entries})`)
  check(
    !!domainBar && domainBar.y + domainBar.height >= 844 - 40,
    'la barre des domaines devrait être en bas',
  )
  await shot('m05-diplomatie')
  await page.getByTestId('sheet-inspector').tap()
  await page.getByTestId('army-sheet').waitFor()
  await page.getByTestId('rail-country').tap()
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

  // WebGL indisponible, en portrait : le message tient dans l'écran.
  const noGl = await context.newPage()
  await noGl.setViewportSize({ width: 390, height: 844 })
  await noGl.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (/webgl/.test(String(type))) return null
      return original.call(this, type, ...rest)
    }
  })
  await noGl.goto(url, { waitUntil: 'load' })
  await noGl.getByTestId('webgl-error').waitFor({ timeout: 15_000 })
  const msg = await noGl.getByTestId('webgl-error').boundingBox()
  await noGl.screenshot({ path: path.join(out, 'm08-webgl-indisponible.png') })
  step('WebGL indisponible (mobile)', { message: msg })
  check(!!msg && msg.x >= 0 && msg.x + msg.width <= 390, 'message WebGL hors de l’écran')
  await noGl.close()

  report.ok = report.errors.length === 0
} catch (e) {
  report.errors.push(`test: ${e instanceof Error ? e.message : String(e)}`)
  await shot('m99-echec').catch(() => {})
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(report.ok ? 'MOBILE OK' : `MOBILE KO : ${report.errors.join(' | ')}`)
