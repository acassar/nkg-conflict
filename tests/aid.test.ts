import fs from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { Simulation } from '@/sim/simulation'
import { buildScenario } from '@/sim/scenarios'
import { loadTheater } from '@/sim/theater/load'
import type { TheaterData } from '@/sim/theater/grid'
import { relation } from '@/sim/politics/politics'
import { aidBetween, revokeAid } from '@/sim/politics/aid'
import { parseSave, serializeSave } from '@/sim/core/save'

let theater: TheaterData
const readPublic = async (p: string): Promise<ArrayBuffer> => {
  const buf = fs.readFileSync(new URL(`../public/${p}`, import.meta.url))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

beforeAll(async () => {
  theater = await loadTheater('world', readPublic)
})

const newWorld = (player = 'FRA', seed = 5): Simulation =>
  Simulation.fromScenario(buildScenario('world-2026', player), theater, seed, player)

describe('aide étrangère', () => {
  it('les aides de 2026 sont en place au départ, dans les deux camps', () => {
    const sim = newWorld()
    expect(aidBetween(sim.ctx, 'USA', 'UKR')?.level).toBe(2)
    expect(aidBetween(sim.ctx, 'PRK', 'RUS')).toBeDefined()
  })

  it("l'aide est prélevée sur le donneur et versée au receveur", () => {
    const withAid = newWorld('FRA', 3)
    const without = newWorld('FRA', 3)
    const aid = aidBetween(without.ctx, 'USA', 'UKR')
    if (aid) revokeAid(without.ctx, aid.id, 'USA')
    withAid.step(24)
    without.step(24)
    const usa = (s: Simulation): number => s.ctx.economies.get('USA')?.production ?? 0
    expect(usa(withAid)).toBeLessThan(usa(without))
    const sent = aidBetween(withAid.ctx, 'USA', 'UKR')?.lastDay
    expect(sent?.munitions).toBeGreaterThan(0)
    expect(sent?.equipment).toBeGreaterThan(0)
    // Ce que perd le donneur correspond à ce qu'il envoie (production et matériel).
    const lost = usa(without) - usa(withAid)
    expect(lost).toBeCloseTo((sent?.production ?? 0) + (sent?.equipment ?? 0), 0)
  })

  it('le joueur accorde, ajuste puis révoque une aide', () => {
    const sim = newWorld('ESP')
    expect(sim.grantAid('UKR', 3)).toBe(null)
    const aid = aidBetween(sim.ctx, 'ESP', 'UKR')
    expect(aid?.level).toBe(3)
    sim.setAidLevel(aid?.id ?? -1, 1)
    expect(aidBetween(sim.ctx, 'ESP', 'UKR')?.level).toBe(1)
    const before = relation(sim.ctx, 'ESP', 'UKR')
    sim.revokeAid(aid?.id ?? -1)
    expect(aidBetween(sim.ctx, 'ESP', 'UKR')).toBeUndefined()
    expect(relation(sim.ctx, 'ESP', 'UKR')).toBe(before - 10)
  })

  it('une IA accepte ou refuse une demande selon ses relations, puis impose un délai', () => {
    const sim = newWorld('UKR')
    expect(sim.requestAid('ESP')).toBe(null)
    expect(aidBetween(sim.ctx, 'ESP', 'UKR')).toBeDefined()
    expect(sim.requestAid('CHN')).toMatch(/refuse/)
    expect(sim.requestAid('CHN')).toMatch(/jours/)
  })

  it('le matériel accumulé est livré sous forme d’unité', () => {
    const sim = newWorld('FRA')
    const aid = aidBetween(sim.ctx, 'USA', 'UKR')
    if (!aid) throw new Error('aide manquante')
    aid.equipment = 10_000
    const eco = sim.ctx.economies.get('UKR')
    if (eco) eco.manpower = 100
    sim.step(24)
    expect(aid.unitsDelivered).toBe(1)
    expect(sim.snapshot().events.some((e) => e.text.startsWith('Matériel livré par'))).toBe(true)
  })

  it('une guerre entre donneur et receveur met fin à l’aide', () => {
    const sim = newWorld('FRA')
    expect(sim.grantAid('CHE', 1)).toBe(null)
    expect(sim.declareWar('CHE')).toBe(null)
    sim.step(24)
    expect(aidBetween(sim.ctx, 'FRA', 'CHE')).toBeUndefined()
  })

  it('le joueur répond à une demande d’aide', () => {
    const sim = newWorld('ESP')
    const pol = sim.ctx.politics
    pol.aidRequests.push({ id: 9001, from: 'UKR', to: 'ESP', expiresTick: 1000 })
    pol.aidRequests.push({ id: 9002, from: 'MAR', to: 'ESP', expiresTick: 1000 })
    expect(sim.answerAidRequest(9001, true, 2)).toBe(null)
    expect(aidBetween(sim.ctx, 'ESP', 'UKR')?.level).toBe(2)
    const before = relation(sim.ctx, 'ESP', 'MAR')
    sim.answerAidRequest(9002, false)
    expect(aidBetween(sim.ctx, 'ESP', 'MAR')).toBeUndefined()
    expect(relation(sim.ctx, 'ESP', 'MAR')).toBe(before - 5)
    expect(pol.aidRequests).toHaveLength(0)
  })

  it('les aides survivent à une sauvegarde', () => {
    const sim = newWorld('ESP')
    sim.grantAid('UKR', 2)
    sim.step(48)
    const save = parseSave(serializeSave(sim.toSave()))
    const loaded = Simulation.fromSave(save, buildScenario('world-2026', 'ESP'), theater)
    expect(aidBetween(loaded.ctx, 'ESP', 'UKR')?.level).toBe(2)
    expect(loaded.ctx.politics.aids.length).toBe(sim.ctx.politics.aids.length)
  })
})
