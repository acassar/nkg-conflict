import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { parseSave, serializeSave } from '@/sim/core/save'
import { distanceKm, type TheaterData } from '@/sim/theater/grid'
import { formationName, formationUnits, updateFormations } from '@/sim/systems/formations'
import { divisionCohesion, divisionSectors } from '@/sim/systems/armies'
import {
  forcesCrumbs,
  forcesRows,
  openRow,
  orderOfBattle,
  selectionEchelon,
  selectionFormation,
} from '@/composables/composition'
import {
  brigadeSpots,
  formationMembers,
  formationPawns,
  isStack,
  selectedSectors,
} from '@/map/clusters'
import { isBrigade } from '@/sim/units/catalog'
import { isSupportTemplate } from '@/sim/scenarios/forces'
import { DIVISION_TEMPLATES, slotFit, templateOf } from '@/sim/units/templates'
import type { FormationState, UnitSnapshot, UnitState } from '@/sim/core/types'

const theater = theaterJson as unknown as TheaterData

const newGame = (): Simulation => Simulation.fromScenario(ukraine2026, theater, 3)

const divisionsOf = (sim: Simulation, owner: string): FormationState[] =>
  [...sim.ctx.formations.values()].filter((f) => f.owner === owner && f.kind === 'division')

/** Division dont chaque brigade occupe une place de son modèle (les divisions réelles peuvent déborder). */
const fitsTemplate = (sim: Simulation, d: FormationState): boolean => {
  const slots = [...(DIVISION_TEMPLATES[d.template ?? '']?.brigades ?? [])]
  for (const u of formationUnits(sim.ctx, d.id)) {
    const i = slots.findIndex((s) => slotFit(s, templateOf(u) ?? '') > 0)
    if (i < 0) return false
    slots.splice(i, 1)
  }
  return true
}

describe('divisions et corps', () => {
  it("part de l'ordre de bataille réel : divisions, corps et divisions de jeu", () => {
    const sim = newGame()
    const ctx = sim.ctx
    for (const u of ctx.units.values()) {
      if (isBrigade(u.kind)) expect(u.divisionId).toBeDefined()
      else expect(u.divisionId).toBeUndefined()
    }
    const ukr = divisionsOf(sim, 'UKR')
    expect(ukr.length).toBeGreaterThan(0)
    for (const d of ukr) expect(formationUnits(ctx, d.id).length).toBeGreaterThan(0)
    // Brigades rattachées directement à un corps ou à une armée : divisions de jeu à son nom.
    const generated = ukr.filter((d) => d.generated)
    expect(generated.length).toBeGreaterThan(0)
    expect(generated.some((d) => d.parentId !== null)).toBe(true)
    for (const d of generated) {
      expect(d.name).toMatch(/division \(.+\)$/)
      // Trois ou quatre brigades de manœuvre, plus les appuis répartis.
      const maneuver = formationUnits(ctx, d.id).filter((u) => !isSupportTemplate(u.template ?? ''))
      expect(maneuver.length).toBeLessThanOrEqual(4)
    }
    const corps = [...ctx.formations.values()].filter((f) => f.kind === 'corps')
    expect(corps.length).toBeGreaterThan(0)
    for (const c of corps) {
      const n = [...ctx.formations.values()].filter((f) => f.parentId === c.id).length
      expect(n).toBeGreaterThan(0)
    }
    // Brigades voisines : une division part groupée sur le front.
    const spans = divisionsOf(sim, 'UKR').map((d) => {
      const m = formationUnits(ctx, d.id)
      let max = 0
      for (const a of m)
        for (const b of m) max = Math.max(max, distanceKm(a.lon, a.lat, b.lon, b.lat))
      return max
    })
    spans.sort((a, b) => a - b)
    // Divisions réelles de 4 à 7 brigades, une vingtaine de km entre deux postes.
    expect(spans[Math.floor(spans.length / 2)]).toBeLessThan(100)
  })

  it('nomme les formations à la française', () => {
    expect(formationName('division', 1)).toBe('1re division')
    expect(formationName('division', 12)).toBe('12e division')
    expect(formationName('corps', 1)).toBe('Ier corps')
    expect(formationName('corps', 4)).toBe('IVe corps')
  })

  it('une recrue rejoint la division incomplète la plus proche ; une division vide est dissoute', () => {
    const sim = newGame()
    const ctx = sim.ctx
    // Division conforme à son modèle, dont la première brigade y a une place exacte.
    const division = divisionsOf(sim, 'UKR').find(
      (d) =>
        fitsTemplate(sim, d) &&
        DIVISION_TEMPLATES[d.template ?? '']?.brigades.includes(
          templateOf(formationUnits(ctx, d.id)[0] ?? { kind: 'inf' }) ?? '',
        ),
    )
    if (!division) throw new Error('aucune division')
    const members = formationUnits(ctx, division.id)
    const [lost, ...others] = members
    if (!lost) throw new Error('division vide')
    // Une brigade détruite libère une place ; une recrue de son armée, à côté, la reprend.
    ctx.units.delete(lost.id)
    const recruit: UnitState = {
      ...structuredClone(lost),
      id: ctx.allocId(),
      name: 'recrue',
      // Au centre de la division.
      lon: others.reduce((a, u) => a + u.lon, 0) / others.length,
      lat: others.reduce((a, u) => a + u.lat, 0) / others.length,
    }
    delete recruit.divisionId
    ctx.units.set(recruit.id, recruit)
    ctx.armies.get(division.armyId)?.unitIds.push(recruit.id)
    updateFormations(ctx)
    expect(recruit.divisionId).toBe(division.id)
    // Toutes ses brigades détruites : la division disparaît.
    for (const u of formationUnits(ctx, division.id)) ctx.units.delete(u.id)
    updateFormations(ctx)
    expect(ctx.formations.has(division.id)).toBe(false)
  })

  it("division organique : une brigade qui change d'armée la garde, la division suit la plupart de ses brigades", () => {
    const sim = newGame()
    const ctx = sim.ctx
    const [division] = divisionsOf(sim, 'UKR')
    const [a, b] = division ? formationUnits(ctx, division.id) : []
    if (!division || !a || !b) throw new Error('division incomplète')
    const enemy = [...ctx.units.values()].find((u) => u.owner === 'RUS')
    if (!enemy) throw new Error('pas d’ennemi')
    // Encerclement : le groupe détaché garde les divisions de ses brigades.
    expect(sim.encircle([a.id, b.id], enemy.id)).toBeNull()
    expect(a.armyId).not.toBe(division.armyId)
    updateFormations(ctx)
    expect(a.divisionId).toBe(division.id)
    // Nouvelle armée ordinaire : la brigade garde sa division, qui reste à l'armée de la plupart de
    // ses brigades ; quand toutes y passent, la division suit.
    const home = division.armyId
    const other = sim.createArmy('Armée de test', [b.id])
    const army = ctx.armies.get(other)
    if (army) army.encirclement = undefined
    b.armyId = other
    updateFormations(ctx)
    expect(b.divisionId).toBe(division.id)
    expect(division.armyId).toBe(home)
    const all = formationUnits(ctx, division.id)
    expect(
      sim.createArmy(
        'Armée entière',
        all.map((u) => u.id),
      ),
    ).toBeGreaterThan(0)
    updateFormations(ctx)
    expect(all.every((u) => u.divisionId === division.id)).toBe(true)
    expect(division.armyId).not.toBe(home)
    expect(division.parentId).toBeNull()
  })

  it('garde divisions et corps dans les sauvegardes', () => {
    const sim = newGame()
    sim.step(24)
    const save = parseSave(serializeSave(sim.toSave()))
    const loaded = Simulation.fromSave(save, ukraine2026, theater)
    expect([...loaded.ctx.formations.values()]).toEqual([...sim.ctx.formations.values()])
    const u = [...sim.ctx.units.values()].find((x) => x.divisionId !== undefined)
    expect(loaded.ctx.units.get(u?.id ?? -1)?.divisionId).toBe(u?.divisionId)
    // Sauvegarde sans formations (antérieure) : reformées au chargement.
    delete save.formations
    for (const x of save.units) delete x.divisionId
    const old = Simulation.fromSave(save, ukraine2026, theater)
    expect(old.ctx.formations.size).toBeGreaterThan(0)
  })
})

describe('secteur commun', () => {
  it('donne des postes contigus à chaque division, au plus proche dans son secteur', () => {
    // Quatre postes alignés tous les 10 km, deux divisions entremêlées : 1, 2, 1, 2.
    const units = [1, 2, 1, 2].map((d, k) => ({ id: k + 1, divisionId: d }) as UnitState)
    const P = 4
    const dist = new Float64Array(16)
    units.forEach((_, ui) => {
      for (let pi = 0; pi < P; pi++) dist[ui * P + pi] = Math.abs(ui - pi) * 10
    })
    divisionSectors(units, P, dist)
    // Hors secteur : plus cher que n'importe quel poste du secteur.
    const inSector = (ui: number, pi: number): boolean => (dist[ui * P + pi] ?? 0) < 100
    expect([0, 1].every((pi) => inSector(0, pi) && inSector(2, pi))).toBe(true)
    expect([2, 3].every((pi) => inSector(1, pi) && inSector(3, pi))).toBe(true)
  })

  it('une brigade loin de la ligne (recrue) rejoint le secteur de sa division', () => {
    // Postes tous les 10 km ; la brigade 4 (division 1) arrive de 300 km, plus près des postes de la
    // division 2 que de ceux de la sienne.
    const units = [1, 1, 2, 1].map((d, k) => ({ id: k + 1, divisionId: d }) as UnitState)
    const P = 4
    const dist = new Float64Array(16)
    units.forEach((_, ui) => {
      for (let pi = 0; pi < P; pi++)
        dist[ui * P + pi] = ui === 3 ? 300 + (P - pi) * 10 : Math.abs(ui - pi) * 10
    })
    divisionSectors(units, P, dist)
    // Secteur de la division 1 : postes 0 à 2 ; hors secteur, l'écart dépasse le trajet en plus.
    const best = [0, 1, 2, 3].sort((a, b) => (dist[3 * P + a] ?? 0) - (dist[3 * P + b] ?? 0))[0]
    expect(best).toBeLessThan(3)
  })

  it('déploiement instantané : chaque division prend son secteur entier', () => {
    const units = [1, 2, 1, 2].map((d, k) => ({ id: k + 1, divisionId: d }) as UnitState)
    const P = 4
    const dist = new Float64Array(16)
    // Brigades placées à l'envers de leur secteur, à 200 km l'une de l'autre.
    units.forEach((_, ui) => {
      for (let pi = 0; pi < P; pi++) dist[ui * P + pi] = Math.abs(ui - pi) * 200
    })
    divisionSectors(units, P, dist, () => null, true)
    for (const [ui, posts] of [
      [0, [0, 1]],
      [2, [0, 1]],
      [1, [2, 3]],
      [3, [2, 3]],
    ] as const) {
      const best = [0, 1, 2, 3].sort((a, b) => (dist[ui * P + a] ?? 0) - (dist[ui * P + b] ?? 0))
      expect(posts).toContain(best[0])
    }
  })

  it('divisions groupées au départ, appuis derrière leur division', () => {
    const sim = Simulation.fromScenario(ukraine2026, theater, 3)
    const ctx = sim.ctx
    let spread = 0
    for (const f of ctx.formations.values()) {
      const army = ctx.armies.get(f.armyId)
      if (f.kind !== 'division' || !army) continue
      const list = [...ctx.units.values()].filter((u) => u.divisionId === f.id)
      for (const a of list)
        for (const b of list) spread = Math.max(spread, distanceKm(a.lon, a.lat, b.lon, b.lat))
    }
    expect(spread).toBeLessThan(250)
    // Armées sans secteur connu : en réserve derrière tout le front.
    const reserve = [...ctx.armies.values()].filter((a) => a.mission?.kind === 'reserve')
    expect(reserve.map((a) => a.name)).toContain("Garde nationale d'Ukraine")
  })

  it('échange les postes de brigades voisines pour réunir une division, sans trajet excessif', () => {
    const units = [1, 2, 1, 2].map((d) => ({ divisionId: d }))
    const near = new Float64Array(16)
    for (let ui = 0; ui < 4; ui++)
      for (let pi = 0; pi < 4; pi++) near[ui * 4 + pi] = Math.abs(ui - pi) * 5
    const unitAt = Int32Array.from([0, 1, 2, 3])
    divisionCohesion(units, unitAt, near, new Uint8Array(4))
    const keys = [...unitAt].map((ui) => units[ui]?.divisionId)
    expect(keys[0]).toBe(keys[1])
    expect(keys[2]).toBe(keys[3])
    // Postes éloignés de 100 km : l'échange coûterait trop, rien ne bouge.
    const far = new Float64Array(16)
    for (let ui = 0; ui < 4; ui++)
      for (let pi = 0; pi < 4; pi++) far[ui * 4 + pi] = Math.abs(ui - pi) * 100
    const fixed = Int32Array.from([0, 1, 2, 3])
    divisionCohesion(units, fixed, far, new Uint8Array(4))
    expect([...fixed]).toEqual([0, 1, 2, 3])
  })
})

describe('affichage et ordre de bataille', () => {
  const formations: FormationState[] = [
    { id: 1, owner: 'UKR', kind: 'corps', number: 1, name: 'Ier corps', armyId: 9, parentId: null },
    {
      id: 2,
      owner: 'UKR',
      kind: 'division',
      number: 1,
      name: '1re division',
      armyId: 9,
      parentId: 1,
    },
    {
      id: 3,
      owner: 'UKR',
      kind: 'division',
      number: 2,
      name: '2e division',
      armyId: 9,
      parentId: 1,
    },
  ]
  const unit = (id: number, divisionId: number, lon: number): UnitSnapshot =>
    ({
      id,
      owner: 'UKR',
      kind: 'inf',
      lon,
      lat: 49,
      strength: 0.8,
      org: 0.6,
      divisionId,
      supplied: true,
      engaged: false,
    }) as UnitSnapshot
  // Deux divisions de trois brigades, à 0,2° d'écart, séparées de 1°.
  const units = [
    unit(1, 2, 30),
    unit(2, 2, 30.2),
    unit(3, 2, 30.4),
    unit(4, 3, 31.4),
    unit(5, 3, 31.6),
    unit(6, 3, 31.8),
  ]
  const byId = new Map(formations.map((f) => [f.id, f]))

  it('un pion par corps de loin, par division de près, les brigades à la sélection', () => {
    const far = formationPawns(units, byId, 4)
    expect(far).toHaveLength(1)
    expect(isStack(far[0]!) && far[0].formation?.kind).toBe('corps')
    const names = (list: ReturnType<typeof formationPawns>): unknown[] =>
      list.map((m) => (isStack(m) ? m.formation?.name : 'brigade'))
    expect(names(formationPawns(units, byId, 6))).toEqual(['1re division', '2e division'])
    // De près aussi : un pion par division ; une brigade partie au loin a le sien.
    expect(names(formationPawns(units, byId, 9))).toEqual(['1re division', '2e division'])
    const away = units.map((u) => (u.id === 1 ? { ...u, lon: 28 } : u))
    expect(names(formationPawns(away, byId, 9))).toEqual(['brigade', '1re division', '2e division'])
    // Rien de choisi : pas de brigades affichées ; une brigade choisie : toute sa division, reliée au pion.
    const pawns = formationPawns(units, byId, 6)
    expect(brigadeSpots(pawns, 6, new Set())).toEqual([])
    const spots = brigadeSpots(pawns, 6, new Set([2]))
    expect(spots.map((x) => x.unit.id)).toEqual([1, 2, 3])
    for (const x of spots) expect(x.from[0]).toBeCloseTo(30.2)
    // De loin, les brigades cachées sous le pion sont placées en couronne autour de lui.
    const ring = brigadeSpots(formationPawns(units, byId, 4), 4, new Set([1]))
    expect(ring).toHaveLength(6)
    expect(new Set(ring.map((x) => x.at.join())).size).toBe(6)
    expect(formationMembers(units, formations, 1).map((u) => u.id)).toEqual([1, 2, 3, 4, 5, 6])
    expect(formationMembers(units, formations, 3).map((u) => u.id)).toEqual([4, 5, 6])
  })

  it("un pion d'armée de très loin, et le secteur des formations choisies", () => {
    const solo: FormationState = {
      id: 4,
      owner: 'UKR',
      kind: 'division',
      number: 3,
      name: '3e division',
      armyId: 9,
      parentId: null,
    }
    const all = new Map([...byId, [4, solo]])
    const more = [...units, unit(7, 4, 32.4), unit(8, 4, 32.6)]
    const armies = new Map([[9, { name: '1re armée' }]])
    const far = formationPawns(more, all, 3, undefined, armies)
    expect(far).toHaveLength(1)
    expect(isStack(far[0]!) && far[0].formation).toMatchObject({ kind: 'army', id: 9 })
    expect(isStack(far[0]!) && far[0].units).toHaveLength(8)
    // Sans armée connue, ou de plus près : corps et division.
    expect(formationPawns(more, all, 3)).toHaveLength(2)
    expect(formationPawns(more, all, 6, undefined, armies)).toHaveLength(3)

    const withSectors = formations.map((f) => ({
      ...f,
      sector: [
        [f.id, 49],
        [f.id + 1, 49],
      ] as Array<[number, number]>,
    }))
    expect(selectedSectors(units, withSectors, new Set([1])).map((x) => x.id)).toEqual([2])
    expect(selectedSectors(units, withSectors, new Set([1, 4])).map((x) => x.id)).toEqual([1])
    expect(selectedSectors(units, withSectors, new Set())).toEqual([])
  })

  it('vue Forces : armées, corps, divisions, brigades, fil d’Ariane et échelon choisi', () => {
    const inArmy = units.map((u) => ({ ...u, armyId: 9, equipment: 1 }))
    const armies = [{ id: 9, name: '1re armée', unitIds: inArmy.map((u) => u.id) }]
    const top = forcesRows({}, inArmy, formations, armies)
    expect(top.map((r) => [r.echelon, r.name, r.unitIds.length])).toEqual([
      ['army', '1re armée', 6],
    ])
    const army = openRow({}, top[0]!, formations)
    const corps = forcesRows(army, inArmy, formations, armies)
    expect(corps.map((r) => [r.echelon, r.name])).toEqual([['corps', 'Ier corps']])
    const inCorps = openRow(army, corps[0]!, formations)
    const divisions = forcesRows(inCorps, inArmy, formations, armies)
    expect(divisions.map((r) => r.name)).toEqual(['1re division', '2e division'])
    const inDivision = openRow(inCorps, divisions[1]!, formations)
    expect(inDivision).toEqual({ army: 9, corps: 1, division: 3 })
    const brigades = forcesRows(inDivision, inArmy, formations, armies)
    expect(brigades.map((r) => [r.echelon, r.id, r.open])).toEqual([
      ['brigade', 4, false],
      ['brigade', 5, false],
      ['brigade', 6, false],
    ])
    expect(forcesCrumbs(inDivision, formations, armies).map((c) => c.label)).toEqual([
      'Forces',
      '1re armée',
      'Ier corps',
      '2e division',
    ])
    const echelon = (ids: number[]) =>
      selectionEchelon(
        inArmy.filter((u) => ids.includes(u.id)),
        inArmy,
        formations,
        armies,
      )?.echelon
    expect(echelon([4])).toBe('brigade')
    expect(echelon([4, 5, 6])).toBe('division')
    expect(echelon([1, 2, 3, 4, 5, 6])).toBe('army')
    expect(echelon([4, 5])).toBeNull()
    const solo = selectionEchelon(inArmy.slice(3, 4), inArmy, formations, armies)
    expect([solo?.division?.name, solo?.corps?.name, solo?.army?.name]).toEqual([
      '2e division',
      'Ier corps',
      '1re armée',
    ])
  })

  it("ordre de bataille d'une armée et formation d'une sélection", () => {
    const oob = orderOfBattle(units, formations)
    expect(oob).toHaveLength(1)
    expect(oob[0]?.name).toBe('Ier corps')
    expect(oob[0]?.divisions.map((d) => [d.name, d.unitIds.length])).toEqual([
      ['1re division', 3],
      ['2e division', 3],
    ])
    expect(oob[0]?.divisions[0]?.strength).toBeCloseTo(0.8)
    expect(selectionFormation(units.slice(0, 1), formations)?.division?.name).toBe('1re division')
    const both = selectionFormation(units, formations)
    expect(both?.division).toBeNull()
    expect(both?.corps?.name).toBe('Ier corps')
    expect(selectionFormation([{ divisionId: null }], formations)).toBeNull()
  })
})
