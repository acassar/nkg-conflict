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
  // Fiche de la ville : effet et portée des fortifications.
  const fortText = (await page.getByTestId('city-fort').textContent())?.trim() ?? ''
  step('fortifications de Kyiv', { texte: fortText.replace(/\s+/g, ' ').slice(0, 120) })
  if (!/défense/.test(fortText) || !/15 km/.test(fortText)) {
    report.errors.push('fiche de la ville : effet des fortifications absent')
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
  // Économie de guerre : mobilisation partielle choisie depuis le panneau.
  await page
    .getByTestId('war-economy')
    .getByRole('button', { name: 'Mobilisation partielle' })
    .click()
  await page.waitForTimeout(500)
  const warEconomy = await page.evaluate(() => window.__nkg.snapshot.economy.warEconomy)
  const tdfButton = await page
    .getByRole('button', { name: 'Défense territoriale', exact: true })
    .count()
  step('économie de guerre', { niveau: warEconomy, boutonDefenseTerritoriale: tdfButton })
  if (warEconomy !== 1) report.errors.push(`économie de guerre non appliquée (${warEconomy})`)
  if (tdfButton !== 1) report.errors.push('bouton de défense territoriale absent')
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

  // Annuler l'ordre : les unités poursuivantes s'arrêtent.
  await page.getByTestId('cancel-order').click()
  await page.waitForTimeout(500)
  const stillPursuing = await page.evaluate(
    () => window.__nkg.selectedUnits.filter((u) => u.order === 'pursue').length,
  )
  step('ordre annulé', { poursuivent: stillPursuing })
  if (stillPursuing !== 0) report.errors.push("l'ordre n'a pas été annulé")

  // Posture : « Dégâts max » pour la sélection.
  await page.getByTestId('posture').getByRole('button', { name: 'Dégâts max' }).click()
  await page.waitForTimeout(500)
  const postures = await page.evaluate(() => [
    ...new Set(window.__nkg.selectedUnits.map((u) => u.posture)),
  ])
  step('posture', { postures })
  if (postures.length !== 1 || postures[0] !== 'maxDamage') {
    report.errors.push(`posture non appliquée (${postures.join(', ')})`)
  }
  await shot('02g1-posture')

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

  // Mission « Avancer » d'une armée : trait libre en deux clics près de ses unités, puis « Tenir ».
  const missionArmy = await page.evaluate(() => {
    const g = window.__nkg
    const army = g.armies.find((a) => !a.encirclement && a.unitIds.length > 2)
    if (!army) return null
    g.selectArmy(army.id)
    return army.id
  })
  await page.getByRole('button', { name: /Armées/ }).click()
  await page.getByTestId('mission-advance').click()
  await page.getByTestId('advance-line').click()
  // Deux points à gauche du panneau, dans le territoire visible (la carte est zoomée sur l'armée).
  const linePoints = [
    [300, 300],
    [500, 380],
  ]
  for (const [x, y] of linePoints) await page.mouse.click(x, y)
  await page.getByTestId('advance-line-done').click()
  await page.waitForTimeout(600)
  const mission = await page.evaluate(
    (id) => window.__nkg.armies.find((a) => a.id === id)?.mission?.kind ?? null,
    missionArmy,
  )
  const missionText = await page.getByTestId('mission-status').textContent()
  step('mission avancer', { mission, statut: missionText })
  if (mission !== 'advance') report.errors.push(`mission « Avancer » non lancée (${mission})`)
  await shot('02g3-mission-avancer')
  await page.getByTestId('mission-hold').click()
  await page.waitForTimeout(500)
  const held = await page.evaluate(
    (id) => window.__nkg.armies.find((a) => a.id === id)?.mission?.kind ?? 'hold',
    missionArmy,
  )
  if (held !== 'hold') report.errors.push(`retour à « Tenir » non appliqué (${held})`)

  // Mission « Tenir les points clés » : appliquée d'un clic, repères sur la carte, puis retour à « Tenir ».
  await page.getByTestId('mission-keyPoints').click()
  await page.waitForTimeout(600)
  const keyPoints = await page.evaluate((id) => {
    const a = window.__nkg.armies.find((x) => x.id === id)
    return { mission: a?.mission?.kind ?? 'hold', points: a?.keyPoints?.length ?? 0 }
  }, missionArmy)
  const keyText = await page.getByTestId('mission-status').textContent()
  step('mission points clés', { ...keyPoints, statut: keyText })
  if (keyPoints.mission !== 'keyPoints') {
    report.errors.push(`mission « Tenir les points clés » non appliquée (${keyPoints.mission})`)
  }
  await shot('02g3b-points-cles')

  // Missions « Défense en profondeur » puis « Réserve » : appliquées d'un clic chacune.
  for (const [kind, name] of [
    ['depth', '02g3c-profondeur'],
    ['reserve', '02g3d-reserve'],
  ]) {
    await page.getByTestId(`mission-${kind}`).click()
    await page.waitForTimeout(600)
    const got = await page.evaluate(
      (id) => window.__nkg.armies.find((x) => x.id === id)?.mission?.kind ?? 'hold',
      missionArmy,
    )
    step(`mission ${kind}`, { mission: got })
    if (got !== kind) report.errors.push(`mission ${kind} non appliquée (${got})`)
    await shot(name)
  }

  // Mission « Percée sur un axe » : point visé sur l'unité ennemie la plus proche de l'armée.
  await page.getByTestId('mission-breach').click()
  await page.getByTestId('breach-target').click()
  const breachAt = await page.evaluate((id) => {
    const g = window.__nkg
    const army = g.armies.find((a) => a.id === id)
    const own = g.snapshot.units.filter((u) => army.unitIds.includes(u.id))
    const lon = own.reduce((s, u) => s + u.lon, 0) / own.length
    const lat = own.reduce((s, u) => s + u.lat, 0) / own.length
    const enemy = g.snapshot.units
      .filter((u) => u.owner !== army.owner)
      .sort(
        (a, b) => Math.hypot(a.lon - lon, a.lat - lat) - Math.hypot(b.lon - lon, b.lat - lat),
      )[0]
    const p = window.__nkgMap.project([enemy.lon, enemy.lat])
    return { x: p.x, y: p.y, lonLat: [enemy.lon, enemy.lat] }
  }, missionArmy)
  const view = page.viewportSize()
  if (
    breachAt.x > 0 &&
    breachAt.y > 60 &&
    breachAt.x < view.width - 380 &&
    breachAt.y < view.height
  ) {
    await page.mouse.click(breachAt.x, breachAt.y)
  } else {
    // Unité hors de la partie visible de la carte : même clic, transmis directement.
    await page.evaluate((p) => window.__nkg.mapClick(p), breachAt.lonLat)
  }
  await page.waitForTimeout(600)
  const breach = await page.evaluate((id) => {
    const m = window.__nkg.armies.find((x) => x.id === id)?.mission
    return { mission: m?.kind ?? 'hold', choc: m?.shockIds?.length ?? 0 }
  }, missionArmy)
  const breachText = await page.getByTestId('mission-status').textContent()
  step('mission percée', { ...breach, statut: breachText })
  if (breach.mission !== 'breach' || breach.choc === 0) {
    report.errors.push(`mission « Percée sur un axe » non lancée (${breach.mission})`)
  }
  await shot('02g3e-percee')

  // Mission « Retraite ordonnée » : ligne de repli tracée en deux clics derrière les unités de l'armée.
  await page.getByTestId('mission-retreat').click()
  await page.getByTestId('retreat-line').click()
  const rearPoints = await page.evaluate((id) => {
    const g = window.__nkg
    const army = g.armies.find((a) => a.id === id)
    const own = g.snapshot.units.filter((u) => army.unitIds.includes(u.id))
    const enemies = g.snapshot.units.filter((u) => u.owner !== army.owner)
    const lon = own.reduce((s, u) => s + u.lon, 0) / own.length
    const lat = own.reduce((s, u) => s + u.lat, 0) / own.length
    const e = enemies.sort(
      (a, b) => Math.hypot(a.lon - lon, a.lat - lat) - Math.hypot(b.lon - lon, b.lat - lat),
    )[0]
    // À l'opposé de l'ennemi le plus proche, une trentaine de km en arrière.
    const dx = lon - e.lon
    const dy = lat - e.lat
    const n = Math.hypot(dx, dy) || 1
    const c = [lon + (dx / n) * 0.3, lat + (dy / n) * 0.3]
    return [
      [c[0] - (dy / n) * 0.3, c[1] + (dx / n) * 0.3],
      [c[0] + (dy / n) * 0.3, c[1] - (dx / n) * 0.3],
    ]
  }, missionArmy)
  for (const p of rearPoints) await page.evaluate((q) => window.__nkg.mapClick(q), p)
  await page.getByTestId('advance-line-done').click()
  await page.waitForTimeout(600)
  const retreat = await page.evaluate(
    (id) => window.__nkg.armies.find((x) => x.id === id)?.mission?.kind ?? 'hold',
    missionArmy,
  )
  const retreatText = await page.getByTestId('mission-status').textContent()
  step('mission retraite', { mission: retreat, statut: retreatText })
  if (retreat !== 'retreat')
    report.errors.push(`mission « Retraite ordonnée » non lancée (${retreat})`)
  await shot('02g3f-retraite')
  await page.getByTestId('mission-hold').click()
  await page.waitForTimeout(500)

  // Recrutement par armée : sous-onglet « Recrutement », 3 infanteries au clic, 2 artilleries saisies.
  await page.getByTestId('army-view-recruit').click()
  for (let k = 0; k < 3; k++) await page.getByTestId('recruit-add-inf').click()
  await page.getByTestId('recruit-count-art').fill('2')
  await page.getByTestId('recruit-count-art').press('Enter')
  await page.getByTestId('recruit-preview').waitFor()
  const sites = await page.getByTestId('recruit-sites').locator('li').count()
  await shot('02g4-recrutement-armee')
  const queuedBefore = await page.evaluate(() => window.__nkg.economy?.recruitment.length ?? 0)
  await page.getByTestId('recruit-submit').click()
  await page.waitForTimeout(600)
  const forArmy = await page.evaluate(
    (id) => window.__nkg.economy?.recruitment.filter((q) => q.armyId === id).length ?? 0,
    missionArmy,
  )
  const queuedAfter = await page.evaluate(() => window.__nkg.economy?.recruitment.length ?? 0)
  const pendingRows = await page.getByTestId('recruit-pending').locator('li').count()
  step('recrutement par armée', {
    casernes: sites,
    avant: queuedBefore,
    apres: queuedAfter,
    forArmy,
  })
  if (sites < 1) report.errors.push('aperçu du recrutement sans caserne')
  if (queuedAfter - queuedBefore < 1 || forArmy < 1 || pendingRows !== forArmy) {
    report.errors.push(
      `recrutement par armée non lancé (${queuedBefore} → ${queuedAfter}, ${forArmy} pour l'armée, ${pendingRows} lignes)`,
    )
  }
  await shot('02g5-recrutement-commandes')
  await page.getByTestId('army-view-command').click()

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

  // Écran de bataille : un combat du joueur, ouvert comme par un clic sur son icône.
  const battleOpened = await page.evaluate(() => {
    const g = window.__nkg
    const u = g.snapshot.units.find((x) => x.owner === g.snapshot.playerCountry && x.engagedWith)
    if (!u) return false
    g.openBattle([u.id, u.engagedWith])
    window.__nkgMap.jumpTo({ center: [u.lon, u.lat], zoom: 8 })
    return true
  })
  if (battleOpened) {
    await page.getByTestId('battle-dialog').waitFor()
    await page.waitForTimeout(1200)
    const sides = await page.getByTestId('battle-dialog').locator('section.side').count()
    // Obstacles (mines, barbelés) des unités retranchées : affichés dans la ligne de l'unité.
    const obstacles = await page
      .getByTestId('battle-dialog')
      .locator('li .meta', { hasText: 'obstacles' })
      .count()
    step('écran de bataille', { camps: sides, obstacles })
    if (sides !== 2) report.errors.push(`écran de bataille incomplet (${sides} camps)`)
    await page.getByTestId('battle-dialog').locator('li').first().click()
    await page.waitForTimeout(300)
    await shot('03b-bataille')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    if (await page.getByTestId('battle-dialog').isVisible()) {
      report.errors.push("Échap ne ferme pas l'écran de bataille")
    }
  } else {
    step('écran de bataille', { camps: 0, note: 'aucun combat en cours' })
  }

  // Caméra au clavier : D (ou flèche droite) déplace la carte vers l'est.
  const lonBefore = await page.evaluate(() => window.__nkgMap.getCenter().lng)
  await page.keyboard.down('KeyD')
  await page.waitForTimeout(400)
  await page.keyboard.up('KeyD')
  const lonAfter = await page.evaluate(() => window.__nkgMap.getCenter().lng)
  step('caméra clavier', { avant: lonBefore, apres: lonAfter })
  if (!(lonAfter > lonBefore)) report.errors.push('la touche D ne déplace pas la carte')

  // Perte du contexte WebGL en cours de partie : message, puis carte reconstruite à la restauration.
  const canvasBefore = await page.evaluate(() => document.querySelectorAll('canvas').length)
  const lost = await page.evaluate(() => {
    const canvas = window.__nkgMap.getCanvas()
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    const ext = gl?.getExtension('WEBGL_lose_context')
    if (!ext) return false
    window.__nkgOldMap = window.__nkgMap
    window.__nkgLose = ext
    ext.loseContext()
    return true
  })
  if (lost) {
    await page.getByTestId('webgl-lost').waitFor({ timeout: 5000 })
    await shot('03c-webgl-perdu')
    await page.evaluate(() => window.__nkgLose.restoreContext())
    await page.getByTestId('webgl-lost').waitFor({ state: 'detached', timeout: 10_000 })
    await page.waitForTimeout(1500)
    const rebuilt = await page.evaluate(() => ({
      nouvelle: window.__nkgMap !== window.__nkgOldMap,
      erreur: !!document.querySelector('[data-testid="webgl-error"]'),
      canvas: document.querySelectorAll('canvas').length,
    }))
    step('perte du contexte WebGL', rebuilt)
    // Autant de canvas qu'avant : aucun contexte WebGL en double après la reconstruction.
    if (!rebuilt.nouvelle || rebuilt.erreur || rebuilt.canvas !== canvasBefore) {
      report.errors.push(`récupération du contexte WebGL : ${JSON.stringify(rebuilt)}`)
    }
  } else {
    step('perte du contexte WebGL', { note: 'extension WEBGL_lose_context absente' })
  }
  // Zoom sur le front, autour de Kharkiv.
  await page.evaluate(() => {
    window.__nkg.focus = { at: [36.2, 49.2], zoom: 6.5, nonce: Date.now() }
  })
  await page.waitForTimeout(3500)
  await shot('04-zoom-front')

  // Tracé du front de l'armée sélectionnée : quelques secteurs continus, pas une quinzaine de morceaux.
  const frontPieces = await page.evaluate(() => {
    const g = window.__nkg
    const army = g.armies.find((a) => !a.encirclement && a.frontLine?.length)
    if (!army) return null
    g.selectArmy(army.id)
    return army.frontLine.length
  })
  await page.waitForTimeout(800)
  step('tracé du front', { morceaux: frontPieces })
  if (frontPieces === null) report.errors.push('aucune armée avec un tracé de front')
  else if (frontPieces > 4) report.errors.push(`tracé du front en ${frontPieces} morceaux`)
  await shot('04b-front-armee')

  // Carte logistique : zones ravitaillées, portée des sources et des QG, poches.
  await page.evaluate(() => window.__nkg.selectArmy(null))
  await page.getByTestId('logistics-button').click()
  await page.getByTestId('logistics-legend').waitFor()
  await page.waitForFunction(() => window.__nkg.supply?.view, null, { timeout: 10_000 })
  const logistics = await page.evaluate(() => {
    const v = window.__nkg.supply.view
    const state = window.__nkg.supply.state
    let ok = 0
    for (let i = 0; i < (state?.length ?? 0); i++) if (state[i] === 1) ok++
    return { guerre: v.atWar, sources: v.sources.length, poches: v.pockets.length, relie: ok }
  })
  await page.waitForTimeout(800)
  step('carte logistique', logistics)
  if (!logistics.guerre || logistics.sources === 0 || logistics.relie === 0) {
    report.errors.push('carte logistique incomplète')
  }
  await shot('04c-logistique')
  // Routes et voies ferrées : affichées avec la logistique, masquables depuis la légende.
  const roads = await page.evaluate(() => {
    const r = window.__nkg.grid?.roads
    let road = 0
    let rail = 0
    for (let i = 0; i < (r?.length ?? 0); i++) {
      if (r[i] & 1) road++
      if (r[i] & 4) rail++
    }
    return { routes: road, rail, affichees: window.__nkg.showRoads }
  })
  step('routes et voies ferrées', roads)
  if (!roads.routes || !roads.rail || !roads.affichees) report.errors.push('réseau routier absent')
  if (!(await page.getByTestId('roads-legend').isVisible()))
    report.errors.push('légende des routes absente')
  await page.getByTestId('roads-toggle').click()
  await page.waitForTimeout(300)
  if (
    (await page.getByTestId('roads-legend').isVisible()) ||
    (await page.evaluate(() => window.__nkg.showRoads))
  ) {
    report.errors.push('la case ne masque pas les routes')
  }
  await shot('04d-logistique-sans-routes')
  await page.getByTestId('roads-toggle').click()
  await page.keyboard.press('l')
  await page.waitForTimeout(300)
  if (await page.getByTestId('logistics-legend').isVisible()) {
    report.errors.push('la touche L ne referme pas la carte logistique')
  }

  // Théâtre Ukraine – Russie : donneurs hors carte, avec leur fiche.
  page.once('dialog', (d) => d.accept())
  await page.getByTestId('menu-button').click()
  await page.getByRole('button', { name: 'Menu principal' }).click()
  await page.getByTestId('start-screen').waitFor({ timeout: 15_000 })
  await page.locator('[data-scenario="ukraine-2026"]').click()
  await page.locator('[data-country="UKR"]').click()
  await page.getByRole('button', { name: /^Jouer / }).click()
  await page.waitForFunction(
    () => window.__nkg?.snapshot?.scenarioId === 'ukraine-2026' && window.__nkg?.grid,
    null,
    { timeout: 60_000 },
  )
  await page.waitForTimeout(2000)
  await page.getByTestId('tab-country').click()
  await page.getByTestId('offmap-list').waitFor()
  const donors = await page.evaluate(() => window.__nkg.aids.filter((a) => a.to === 'UKR').length)
  await page.locator('[data-offmap="USA"]').click()
  await page.waitForTimeout(400)
  const sheet = await page.evaluate(() => window.__nkg.selectedCountryCode)
  step('donneurs hors carte', { aides: donors, fiche: sheet })
  if (donors < 5) report.errors.push(`aides du théâtre ukrainien manquantes (${donors})`)
  if (sheet !== 'USA') report.errors.push('fiche des États-Unis non ouverte')
  await shot('05-donneur-hors-carte')

  // Options de départ : « Monde 2026 » sans affiliations ni guerres.
  page.once('dialog', (d) => d.accept())
  await page.getByTestId('menu-button').click()
  await page.getByRole('button', { name: 'Menu principal' }).click()
  await page.getByTestId('start-screen').waitFor({ timeout: 15_000 })
  await page.locator('[data-scenario="ukraine-2026"]').click()
  const ukrOptions = await page.locator('[data-option]').count()
  await page.locator('[data-scenario="world-2026"]').click()
  await page.locator('[data-option="noAffiliations"]').check()
  await page.locator('[data-option="noWars"]').check()
  await shot('06-options-depart')
  await page.getByRole('searchbox', { name: 'Rechercher un pays' }).fill('france')
  await page.locator('[data-country="FRA"]').click()
  await page.getByRole('button', { name: /^Jouer / }).click()
  await page.waitForFunction(
    () => window.__nkg?.snapshot?.scenarioId === 'world-2026' && window.__nkg?.grid,
    null,
    { timeout: 60_000 },
  )
  await page.waitForTimeout(1500)
  const options = await page.evaluate(() => {
    const p = window.__nkg.snapshot.politics
    return {
      guerres: p.wars.length,
      alliances: p.alliances.length,
      organisations: p.organizations.length,
      sanctions: p.sanctions.length,
      aides: p.aids.length,
    }
  })
  step('options de départ', { ...options, optionsUkraine: ukrOptions })
  if (Object.values(options).some((n) => n !== 0)) {
    report.errors.push(`options de départ non appliquées (${JSON.stringify(options)})`)
  }
  if (ukrOptions !== 1)
    report.errors.push(`options du théâtre ukrainien : ${ukrOptions} au lieu de 1`)

  // Déclaration de guerre (France contre Belgique) : encart de l'onglet Armées, puis « Avancer ».
  await page.evaluate(() => window.__nkg.declareWar('BEL'))
  await page.getByTestId('war-brief').waitFor({ timeout: 15_000 })
  await page.waitForTimeout(800)
  const brief = await page.getByTestId('war-brief-status').textContent()
  await shot('07-encart-guerre')
  await page.getByTestId('war-brief-border').click()
  await page.waitForTimeout(800)
  const advance = await page.evaluate(() => {
    const g = window.__nkg
    const a = g.snapshot.armies.find((x) => x.id === g.selectedArmyId)
    return { mission: a?.mission?.kind ?? 'hold', encart: g.warBrief !== null }
  })
  step('encart de guerre', { statut: brief, ...advance })
  if (!brief?.startsWith('Tenir'))
    report.errors.push(`encart de guerre : statut inattendu (${brief})`)
  if (advance.mission !== 'advance' || advance.encart) {
    report.errors.push(`encart de guerre : « Avancer » non appliqué (${JSON.stringify(advance)})`)
  }

  // WebGL indisponible : la page affiche un message clair avec « Réessayer ».
  const noGl = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await noGl.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (/webgl/.test(String(type))) return null
      return original.call(this, type, ...rest)
    }
  })
  const noGlErrors = []
  noGl.on('pageerror', (e) => noGlErrors.push(e.message))
  await noGl.goto(url, { waitUntil: 'load' })
  await noGl.getByTestId('webgl-error').waitFor({ timeout: 15_000 })
  const retry = await noGl.getByTestId('webgl-retry').isVisible()
  await noGl.getByTestId('start-screen').waitFor({ timeout: 15_000 })
  await noGl.screenshot({ path: path.join(out, '08-webgl-indisponible.png') })
  await noGl.getByTestId('webgl-retry').click()
  await noGl.waitForTimeout(500)
  const still = await noGl.getByTestId('webgl-error').isVisible()
  step('WebGL indisponible', { bouton: retry, apresReessai: still, erreurs: noGlErrors })
  if (!retry || !still || noGlErrors.length) {
    report.errors.push(`WebGL indisponible : ${JSON.stringify({ retry, still, noGlErrors })}`)
  }
  await noGl.close()

  report.ok = !!after && after.tick > 0 && report.errors.length === 0
} catch (e) {
  report.errors.push(`test: ${e instanceof Error ? e.message : String(e)}`)
  await shot('99-echec').catch(() => {})
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(report.ok ? 'SMOKE OK' : `SMOKE KO : ${report.errors.length} erreur(s)`)
