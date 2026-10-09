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

  // Aide étrangère : demande à l'Espagne (membre de l'OTAN, ennemie de la Russie).
  await page.evaluate(() => window.__nkg.selectCountry('ESP'))
  await page.getByRole('button', { name: 'Demander une aide' }).click()
  await page.waitForTimeout(400)
  const aid = await page.evaluate(() =>
    window.__nkg.aids.find((a) => a.from === 'ESP' && a.to === 'UKR'),
  )
  step('aide demandée', { niveau: aid?.level ?? null })
  if (!aid) report.errors.push("l'Espagne n'a pas accordé d'aide")
  await shot('02e-aide-espagne')

  // Clic sur une ville étrangère (Varsovie) : la fiche de la Pologne s'ouvre.
  await page.evaluate(() => window.__nkg.selectCountry(null))
  const warsaw = await page.evaluate(() => {
    const p = window.__nkgMap.project([21.0, 52.25])
    return [p.x, p.y]
  })
  await page.mouse.click(warsaw[0], warsaw[1])
  await page.waitForTimeout(400)
  const clicked = await page.evaluate(() => window.__nkg.selectedCountryCode)
  step('clic sur Varsovie', { pays: clicked })
  if (clicked !== 'POL') report.errors.push(`clic sur Varsovie : fiche ${clicked} au lieu de POL`)

  // Production : jauges de capacité et casernes sur la carte.
  await page.getByRole('button', { name: 'Production' }).click()
  await page.getByTestId('production-capacity').waitFor()
  await shot('02f-production-capacites')

  // Poursuite : trois unités proches du front, clic sur l'unité russe la plus proche.
  const target = await page.evaluate(() => {
    const g = window.__nkg
    const s = g.snapshot
    const d = (a, b) => Math.hypot(a.lon - b.lon, a.lat - b.lat)
    const mine = s.units.filter(
      (u) => u.owner === 'UKR' && ['inf', 'mech', 'tank'].includes(u.kind),
    )
    const rus = s.units.filter((u) => u.owner === 'RUS')
    let best = null
    for (const r of rus)
      for (const u of mine) if (!best || d(u, r) < best.d) best = { r, d: d(u, r) }
    const picked = mine.sort((a, b) => d(a, best.r) - d(b, best.r)).slice(0, 3)
    g.selectUnits(
      picked.map((u) => u.id),
      false,
    )
    window.__nkgMap.jumpTo({ center: [best.r.lon, best.r.lat], zoom: 8 })
    return { id: best.r.id, lon: best.r.lon, lat: best.r.lat }
  })
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: /Unités/ }).click()
  await page.getByTestId('order-pursue').click()
  const at = await page.evaluate(
    ([lon, lat]) => {
      const p = window.__nkgMap.project([lon, lat])
      return [p.x, p.y]
    },
    [target.lon, target.lat],
  )
  await page.mouse.click(at[0], at[1])
  await page.waitForTimeout(600)
  const pursuing = await page.evaluate(
    (id) => window.__nkg.selectedUnits.filter((u) => u.order === 'pursue').length,
    target.id,
  )
  step('poursuite', { unites: pursuing })
  if (pursuing === 0) report.errors.push('ordre de poursuite non appliqué')
  await shot('02g-poursuite')

  // Encerclement par la même sélection, puis retour à l'armée sur ordre.
  await page.getByTestId('order-encircle').click()
  const at2 = await page.evaluate((id) => {
    const u = window.__nkg.snapshot.units.find((x) => x.id === id)
    const p = window.__nkgMap.project([u.lon, u.lat])
    return [p.x, p.y]
  }, target.id)
  await page.mouse.click(at2[0], at2[1])
  await page.waitForTimeout(600)
  const group = await page.evaluate(
    () => window.__nkg.armies.find((a) => a.encirclement)?.encirclement?.phase ?? null,
  )
  step('encerclement', { phase: group })
  if (group !== 'staging') report.errors.push(`encerclement non lancé (${group})`)
  await page.evaluate(() =>
    window.__nkg.selectArmy(window.__nkg.armies.find((a) => a.encirclement).id),
  )
  await page.getByRole('button', { name: /Armées/ }).click()
  await shot('02g2-encerclement')
  await page.getByTestId('end-encirclement').click()
  await page.waitForTimeout(500)
  const left = await page.evaluate(() => window.__nkg.armies.filter((a) => a.encirclement).length)
  if (left !== 0) report.errors.push('le groupe d’encerclement ne rejoint pas son armée')

  // Sauvegarde dans le navigateur, retour au menu, reprise.
  await page.evaluate(() => window.__nkg.step(24))
  await page.waitForTimeout(500)
  await page.getByTestId('menu-button').click()
  await page.getByRole('menu').getByRole('button', { name: 'Sauver' }).click()
  await page.waitForTimeout(1500)
  const savedTick = await page.evaluate(() => window.__nkg.snapshot.tick)
  page.once('dialog', (d) => d.accept())
  await page.getByTestId('menu-button').click()
  await page.getByRole('button', { name: 'Menu principal' }).click()
  await page.getByTestId('saves').waitFor({ timeout: 15_000 })
  await shot('02h-menu-reprendre')
  await page.locator('[data-slot="manual"]').click()
  await page.waitForFunction(() => window.__nkg?.snapshot, null, { timeout: 60_000 })
  await page.waitForTimeout(1500)
  const resumedTick = await page.evaluate(() => window.__nkg.snapshot.tick)
  step('sauvegarde et reprise', { sauvee: savedTick, reprise: resumedTick })
  if (resumedTick !== savedTick) report.errors.push('reprise de la sauvegarde incorrecte')
  await page.evaluate(() => window.__nkgMap.jumpTo({ center: [32, 49], zoom: 5 }))
  await page.waitForTimeout(800)

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
