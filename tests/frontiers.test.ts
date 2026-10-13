import fs from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { Simulation } from '@/sim/simulation'
import { buildScenario } from '@/sim/scenarios'
import { loadTheater } from '@/sim/theater/load'
import type { TheaterData } from '@/sim/theater/grid'
import { sideIndex } from '@/sim/context'
import { makePeace, setRelation } from '@/sim/politics/politics'
import { borderWith, foreignNeighbors, isCoastCell } from '@/sim/systems/frontiers'
import { updateArmies } from '@/sim/systems/armies'
import { distanceKm } from '@/sim/theater/grid'
import type { ArmyState } from '@/sim/core/types'

let theater: TheaterData
const readPublic = async (p: string): Promise<ArrayBuffer> => {
  const buf = fs.readFileSync(new URL(`../public/${p}`, import.meta.url))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

beforeAll(async () => {
  theater = await loadTheater('world', readPublic)
})

/** La France en paix, et deux armées françaises de brigades de ligne prises dans l'est du pays. */
function france(): { sim: Simulation; a: number; b: number } {
  const sim = Simulation.fromScenario(buildScenario('world-2026', 'FRA'), theater, 5, 'FRA')
  const line = [...sim.ctx.units.values()]
    // En métropole : l'ordre de bataille réel garnit aussi l'outre-mer (Réunion, Nouvelle-Calédonie).
    .filter(
      (u) =>
        u.owner === 'FRA' &&
        u.kind === 'inf' &&
        u.lon > -5 &&
        u.lon < 10 &&
        u.lat > 41 &&
        u.lat < 52,
    )
    .sort((p, q) => q.lon - p.lon)
  // Première armée : une brigade par division (la cohésion des divisions ne réordonne pas ses postes).
  const first = line
    .filter((u, k) => line.findIndex((v) => v.divisionId === u.divisionId) === k)
    .slice(0, 4)
  const a = sim.createArmy(
    '1re armée',
    first.map((u) => u.id),
  )
  const b = sim.createArmy(
    '2e armée',
    line
      .filter((u) => !first.includes(u))
      .slice(0, 4)
      .map((u) => u.id),
  )
  return { sim, a, b }
}

const army = (sim: Simulation, id: number): ArmyState => sim.ctx.armies.get(id) as ArmyState

describe('frontières tenues par une armée', () => {
  it('clic sur un voisin : toute la frontière, déploiement défensif sans franchir', () => {
    const { sim, a } = france()
    const ctx = sim.ctx
    const fra = sideIndex(ctx, 'FRA')
    const deu = sideIndex(ctx, 'DEU')
    expect(ctx.matrix.atWar[fra]).not.toBe(1)
    expect(sim.setArmyBorder(a, { country: 'DEU' })).toBe(null)
    const held = army(sim, a)
    expect(held.border?.length).toBe(borderWith(ctx.grid, fra, deu).length)
    expect(held.border?.length).toBeGreaterThan(10)
    expect(held.front).toBe(null)
    expect(held.frontLine?.length).toBeGreaterThan(0)
    // Posture défensive, postes chez soi, près de la frontière.
    const units = held.unitIds.map((id) => ctx.units.get(id)!)
    for (const u of units) {
      expect(u.posture).toBe('defensive')
      expect(u.order.kind).toBe('front')
      const target = u.order.target
      if (!target) continue
      const [lon, lat] = target
      expect(ctx.grid.owner[ctx.grid.cellAt(lon, lat)]).toBe(fra)
      const near = held.border!.some(
        (c) => distanceKm(lon, lat, ctx.grid.lonOf(c), ctx.grid.latOf(c)) < 40,
      )
      expect(near).toBe(true)
    }
    // Quelques jours : arrivées, retranchées, et premiers obstacles posés en paix.
    sim.step(24 * 12)
    expect(units.some((u) => u.entrench > 0.5)).toBe(true)
    expect([...ctx.obstacles.values()].some((f) => f.side === fra)).toBe(true)
    // Aucune cellule allemande prise.
    expect(units.every((u) => ctx.grid.owner[ctx.grid.cellAt(u.lon, u.lat)] === fra)).toBe(true)
    // Pas de frontière avec un pays sans contact terrestre.
    expect(sim.setArmyBorder(a, { country: 'CHN' })).toContain('Pas de frontière terrestre')
  })

  it('partage : sans chevauchement, la peinture prend, « toute la frontière » retire aux autres', () => {
    const { sim, a, b } = france()
    const ctx = sim.ctx
    const fra = sideIndex(ctx, 'FRA')
    const deu = sideIndex(ctx, 'DEU')
    sim.setArmyBorder(a, { country: 'DEU' })
    const all = army(sim, a).border!.length
    // Clic sur l'Allemagne par la seconde armée : rien de libre.
    expect(sim.setArmyBorder(b, { country: 'DEU' })).toContain('déjà tenue')
    // Peinture d'une partie : prise à la première armée.
    const painted = army(sim, a).border!.slice(0, 6)
    expect(sim.setArmyBorder(b, { paint: painted })).toBe(null)
    expect(army(sim, b).border).toEqual(painted)
    expect(army(sim, a).border!.length).toBe(all - painted.length)
    expect(army(sim, a).border!.some((c) => painted.includes(c))).toBe(false)
    // Cellules hors frontière ignorées.
    const inland = ctx.grid.cellAt(2.35, 48.86)
    expect(foreignNeighbors(ctx.grid, fra, inland)).toEqual([])
    expect(sim.setArmyBorder(b, { paint: [inland] })).toContain('Aucune frontière ni côte')
    // « Prendre toute la frontière » : la première armée reprend tout.
    expect(sim.setArmyBorder(a, 'all')).toBe(null)
    expect(army(sim, a).border!.length).toBe(borderWith(ctx.grid, fra, deu).length)
    expect(army(sim, b).border).toBeUndefined()
    expect(army(sim, b).frontLine).toBeUndefined()
    // Un front (ou « Aucun ») remplace la frontière.
    sim.setArmyFront(a, null)
    expect(army(sim, a).border).toBeUndefined()
  })

  it('la guerre avec le voisin fait de la frontière le front, la paix la rend', () => {
    const { sim, a } = france()
    const ctx = sim.ctx
    sim.setArmyBorder(a, { country: 'CHE' })
    const held = army(sim, a)
    const posts = held.unitIds.map((id) => {
      const o = ctx.units.get(id)!.order
      return o.kind === 'front' ? (o.target ?? null) : null
    })
    setRelation(ctx, 'FRA', 'CHE', -100)
    expect(sim.declareWar('CHE')).toBe(null)
    updateArmies(ctx)
    expect(held.borderFront).toBe(true)
    expect(held.front).not.toBe(null)
    expect(held.border?.length).toBeGreaterThan(0)
    // Sans redéploiement : les postes restent à quelques dizaines de km au plus.
    held.unitIds.forEach((id, k) => {
      const o = ctx.units.get(id)!.order
      const before = posts[k]
      if (o.kind !== 'front' || !o.target || !before) return
      expect(distanceKm(o.target[0], o.target[1], before[0], before[1])).toBeLessThan(80)
    })
    expect(sim.snapshot().events.some((e) => e.text.includes('devient son front'))).toBe(true)
    const war = ctx.politics.wars.find((w) => w.attackers.includes('FRA'))!
    makePeace(ctx, war.id, 'FRA', 'white')
    updateArmies(ctx)
    expect(held.borderFront).toBeUndefined()
    expect(held.front).toBe(null)
    expect(held.border?.length).toBeGreaterThan(0)
  })

  it('missions de ligne valables sur une frontière en paix ; gardée dans la sauvegarde', async () => {
    const { sim, a } = france()
    sim.setArmyBorder(a, { country: 'DEU' })
    expect(sim.lineMissionArmy(a, 'keyPoints')).toBe(null)
    expect(army(sim, a).keyPoints?.length).toBeGreaterThan(0)
    expect(sim.missionPreview(a, 'reserve').posts.length).toBeGreaterThan(0)
    const { parseSave, serializeSave } = await import('@/sim/core/save')
    const loaded = Simulation.fromSave(
      parseSave(serializeSave(sim.toSave())),
      buildScenario('world-2026', 'FRA'),
      theater,
    )
    expect(loaded.ctx.armies.get(a)?.border).toEqual(army(sim, a).border)
  })

  it('côte en option : peinte comme une frontière, déploiement face à la mer, gardée à la guerre', () => {
    const { sim, a } = france()
    const ctx = sim.ctx
    const g = ctx.grid
    const fra = sideIndex(ctx, 'FRA')
    // Côte bretonne autour de Brest.
    const coast: number[] = []
    const c0 = g.cellAt(-4.3, 48.3)
    for (let dy = -6; dy <= 6; dy++)
      for (let dx = -6; dx <= 6; dx++) {
        const i = c0 + dy * g.width + dx
        if (isCoastCell(g, fra, i)) coast.push(i)
      }
    expect(coast.length).toBeGreaterThan(5)
    expect(sim.setArmyBorder(a, { paint: coast })).toBe(null)
    const held = army(sim, a)
    expect(held.border?.length).toBe(coast.length)
    for (const id of held.unitIds) {
      const o = ctx.units.get(id)!.order
      expect(o.kind).toBe('front')
      const t = o.target
      if (!t) continue
      expect(g.owner[g.cellAt(t[0], t[1])]).toBe(fra)
      expect(distanceKm(t[0], t[1], -4.3, 48.3)).toBeLessThan(120)
    }
    // Ajout de la frontière allemande d'un clic : la côte reste tenue.
    expect(sim.setArmyBorder(a, { country: 'DEU' })).toBe(null)
    expect(coast.every((c) => held.border!.includes(c))).toBe(true)
    // Guerre avec la Suisse : seule la frontière suisse devient le front, la côte reste tenue.
    expect(sim.setArmyBorder(a, { country: 'CHE' })).toBe(null)
    setRelation(ctx, 'FRA', 'CHE', -100)
    expect(sim.declareWar('CHE')).toBe(null)
    updateArmies(ctx)
    expect(held.borderFront).toBe(true)
    const [p0, p1] = held.front!
    for (const p of [p0, p1]) expect(distanceKm(p[0], p[1], 7, 46.6)).toBeLessThan(250)
    expect(coast.every((c) => held.border!.includes(c))).toBe(true)
  })
})
