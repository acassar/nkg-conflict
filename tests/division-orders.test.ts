import fs from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { Simulation } from '@/sim/simulation'
import { buildScenario } from '@/sim/scenarios'
import { loadTheater } from '@/sim/theater/load'
import type { TheaterData } from '@/sim/theater/grid'
import { distanceKm } from '@/sim/theater/grid'
import { sideIndex } from '@/sim/context'
import { makePeace, setRelation } from '@/sim/politics/politics'
import { updateArmies } from '@/sim/systems/armies'
import { isLineUnit } from '@/sim/units/catalog'
import type { ArmyState, FormationState, UnitState } from '@/sim/core/types'

let theater: TheaterData
const readPublic = async (p: string): Promise<ArrayBuffer> => {
  const buf = fs.readFileSync(new URL(`../public/${p}`, import.meta.url))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

beforeAll(async () => {
  theater = await loadTheater('world', readPublic)
})

/** La France en paix, une armée de trois divisions entières de métropole, qui tient la frontière allemande. */
function france(): { sim: Simulation; army: ArmyState; divisions: FormationState[] } {
  const sim = Simulation.fromScenario(buildScenario('world-2026', 'FRA'), theater, 5, 'FRA')
  const ctx = sim.ctx
  const home = (u: UnitState): boolean =>
    u.owner === 'FRA' && u.lon > -5 && u.lon < 10 && u.lat > 41 && u.lat < 52
  const ids = [
    ...new Set(
      [...ctx.units.values()]
        .filter((u) => home(u) && u.kind === 'inf' && u.divisionId !== undefined)
        .map((u) => u.divisionId as number),
    ),
  ].slice(0, 3)
  const units = [...ctx.units.values()].filter(
    (u) => u.divisionId !== undefined && ids.includes(u.divisionId),
  )
  const id = sim.createArmy(
    'Armée du Rhin',
    units.map((u) => u.id),
  )
  updateArmies(ctx)
  expect(sim.setArmyBorder(id, { country: 'DEU' })).toBe(null)
  const army = ctx.armies.get(id) as ArmyState
  const divisions = ids.map((d) => ctx.formations.get(d) as FormationState)
  for (const d of divisions) expect(d.armyId).toBe(id)
  return { sim, army, divisions }
}

const brigades = (sim: Simulation, f: FormationState): UnitState[] =>
  [...sim.ctx.units.values()].filter((u) => u.divisionId === f.id)

const target = (u: UnitState): [number, number] | null =>
  u.order.kind === 'front' ? (u.order.target ?? null) : null

const nearCells = (sim: Simulation, p: [number, number], cells: number[], km: number): boolean =>
  cells.some((c) => distanceKm(p[0], p[1], sim.ctx.grid.lonOf(c), sim.ctx.grid.latOf(c)) < km)

describe('ordres de frontière et de défense des divisions', () => {
  it('tronçon peint : la division le tient seule, le reste de l’armée tient le reste', () => {
    const { sim, army, divisions } = france()
    const [d, other] = divisions as [FormationState, FormationState]
    const border = army.border as number[]
    const piece = border.slice(0, Math.floor(border.length / 4))
    expect(sim.setDivisionDefense(d.id, { paint: piece })).toBe(null)
    expect(d.defense?.kind).toBe('border')
    expect(d.defense?.kind === 'border' && d.defense.cells).toEqual(piece)
    // L'armée garde toute sa frontière.
    expect(army.border).toEqual(border)
    const rest = border.filter((c) => !piece.includes(c))
    for (const u of brigades(sim, d)) {
      const t = target(u)
      expect(t).not.toBe(null)
      expect(nearCells(sim, t!, piece, 40)).toBe(true)
    }
    // Les autres divisions se placent hors du tronçon (plus près du reste de la frontière).
    for (const u of brigades(sim, other)) {
      const t = target(u)
      if (!t) continue
      expect(nearCells(sim, t, rest, 40)).toBe(true)
    }
    // Une seconde division prend une partie du tronçon en la peignant.
    expect(sim.setDivisionDefense(other.id, { paint: piece.slice(0, 3) })).toBe(null)
    expect(d.defense?.kind === 'border' && d.defense.cells.length).toBe(piece.length - 3)
    // Hors de la frontière de l'armée : refusé.
    const inland = sim.ctx.grid.cellAt(2.35, 48.86)
    expect(sim.setDivisionDefense(d.id, { paint: [inland] })).toContain('Aucune frontière ni côte')
    // Retour dans la ligne de l'armée.
    expect(sim.setDivisionDefense(d.id, null)).toBe(null)
    expect(d.defense).toBeUndefined()
    // La division garde son ordre après une répartition des armées.
    updateArmies(sim.ctx)
    expect(other.defense?.kind).toBe('border')
  })

  it('frontière libre sans frontière d’armée ; portion de front seulement en guerre ; changement d’armée : l’ordre tombe', () => {
    const { sim, army, divisions } = france()
    const d = divisions[0] as FormationState
    sim.setArmyFront(army.id, null)
    expect(sim.setDivisionDefense(d.id, { country: 'ESP' })).toBe(null)
    expect(d.defense?.kind === 'border' && d.defense.cells.length).toBeGreaterThan(5)
    expect(
      sim.setDivisionDefense(d.id, {
        front: [
          [6, 46],
          [7, 47],
        ],
      }),
    ).toContain("n'est en guerre")
    expect(
      sim.setDivisionDefense(d.id, {
        points: {
          zone: null,
          kinds: { cities: true, ports: false, bases: false, airfields: false },
        },
      }),
    ).toBe(null)
    const other = sim.createArmy(
      'Autre armée',
      brigades(sim, d).map((u) => u.id),
    )
    updateArmies(sim.ctx)
    expect(d.armyId).toBe(other)
    expect(d.defense).toBeUndefined()
  })

  it('défendre des points : la division seule, l’armée garde sa frontière et sa mission', () => {
    const { sim, army, divisions } = france()
    const d = divisions[1] as FormationState
    const kinds = { cities: true, ports: false, bases: false, airfields: false }
    expect(sim.setDivisionDefense(d.id, { points: { zone: null, kinds } })).toBe(null)
    expect(d.defense?.kind).toBe('defendPoints')
    const m = d.defense?.kind === 'defendPoints' ? d.defense : null
    expect(m?.points.length).toBeGreaterThan(0)
    // Capitale d'abord : une brigade au moins à Paris.
    const paris = m!.points[0]!
    expect(paris.name).toBe('Paris')
    const own = brigades(sim, d).filter((u) => isLineUnit(u.kind))
    expect(
      own.some((u) => {
        const t = target(u)
        return !!t && distanceKm(t[0], t[1], paris.at[0], paris.at[1]) < 10
      }),
    ).toBe(true)
    // Les autres brigades de l'armée restent sur la frontière.
    for (const f of divisions.filter((x) => x !== d)) {
      for (const u of brigades(sim, f).filter((x) => isLineUnit(x.kind))) {
        const t = target(u)
        if (t) expect(nearCells(sim, t, army.border!, 40)).toBe(true)
      }
    }
    // Répartition suivante des armées : la division reste à ses points.
    const before = brigades(sim, d).map((u) => target(u))
    updateArmies(sim.ctx)
    expect(brigades(sim, d).map((u) => target(u))).toEqual(before)
    // Rien de coché : refusé.
    expect(
      sim.setDivisionDefense(d.id, {
        points: {
          zone: null,
          kinds: { cities: false, ports: false, bases: false, airfields: false },
        },
      }),
    ).toContain('Cochez')
  })

  it('guerre avec le voisin : le tronçon devient le front de la division, la paix le rend', () => {
    const { sim, army, divisions } = france()
    const ctx = sim.ctx
    sim.setArmyBorder(army.id, 'all')
    expect(sim.setArmyBorder(army.id, { country: 'CHE' })).toBe(null)
    const che = sideIndex(ctx, 'CHE')
    const fra = sideIndex(ctx, 'FRA')
    const swiss = (army.border ?? []).filter((c) =>
      [c - 1, c + 1, c - ctx.grid.width, c + ctx.grid.width].some((n) => ctx.grid.owner[n] === che),
    )
    expect(swiss.length).toBeGreaterThan(4)
    const d = divisions[0] as FormationState
    expect(
      sim.setDivisionDefense(d.id, { paint: swiss.slice(0, Math.ceil(swiss.length / 2)) }),
    ).toBe(null)
    setRelation(ctx, 'FRA', 'CHE', -100)
    expect(sim.declareWar('CHE')).toBe(null)
    updateArmies(ctx)
    expect(ctx.matrix.atWar[fra]).toBe(1)
    expect(army.borderFront).toBe(true)
    expect(d.defense?.kind === 'border' && d.defense.front).toBeTruthy()
    // Portion du front tracée par une autre division : deux points accrochés au front.
    const g = ctx.grid
    const ends = swiss.slice(Math.ceil(swiss.length / 2))
    const p = (c: number): [number, number] => [g.lonOf(c), g.latOf(c)]
    const e = divisions[1] as FormationState
    expect(sim.setDivisionDefense(e.id, { front: [p(ends[0]!), p(ends[ends.length - 1]!)] })).toBe(
      null,
    )
    expect(e.defense?.kind).toBe('front')
    for (const u of brigades(sim, e).filter((x) => isLineUnit(x.kind))) {
      const t = target(u)
      expect(t && nearCells(sim, t, ends, 60)).toBe(true)
    }
    const war = ctx.politics.wars.find((w) => w.attackers.includes('FRA'))!
    makePeace(ctx, war.id, 'FRA', 'white')
    updateArmies(ctx)
    expect(d.defense?.kind === 'border' && d.defense.front).toBeFalsy()
    expect(d.defense?.kind).toBe('border')
    // Paix : la portion de front prend fin, la division rejoint son armée.
    expect(e.defense).toBeUndefined()
  })

  it('gardé dans la sauvegarde', async () => {
    const { sim, army, divisions } = france()
    const d = divisions[0] as FormationState
    sim.setDivisionDefense(d.id, { paint: army.border!.slice(0, 5) })
    const { parseSave, serializeSave } = await import('@/sim/core/save')
    const loaded = Simulation.fromSave(
      parseSave(serializeSave(sim.toSave())),
      buildScenario('world-2026', 'FRA'),
      theater,
    )
    expect(loaded.ctx.formations.get(d.id)?.defense).toEqual(d.defense)
  })
})

describe('étiquette « Ordre propre »', () => {
  it('absente sans ordre, décrit le tronçon ou les points', async () => {
    const { defenseTag } = await import('@/composables/composition')
    expect(defenseTag({})).toBe(null)
    expect(defenseTag({ defense: { kind: 'border', cells: [1, 2] } })?.title).toContain('tronçon')
    const tag = defenseTag({
      defense: {
        kind: 'defendPoints',
        zone: null,
        kinds: { cities: true, ports: false, bases: false, airfields: false },
        points: [
          { name: 'Paris', at: [2.35, 48.86], weight: 5, units: 1 },
          { name: 'Lyon', at: [4.83, 45.77], weight: 2, units: 1 },
        ],
      },
    })
    expect(tag?.label).toBe('Ordre propre')
    expect(tag?.title).toContain('défend 2 points')
  })
})
