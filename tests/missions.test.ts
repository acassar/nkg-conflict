import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { parseSave, serializeSave } from '@/sim/core/save'
import { missionKind } from '@/sim/systems/missions'
import { distanceKm, type TheaterData } from '@/sim/theater/grid'
import type { AdvanceMission, ArmyState, LonLat } from '@/sim/core/types'
import { isLineUnit } from '@/sim/units/catalog'

const theater = theaterJson as unknown as TheaterData
const newGame = (): Simulation => Simulation.fromScenario(ukraine2026, theater, 7)

function playerArmy(sim: Simulation): ArmyState {
  const army = [...sim.ctx.armies.values()].find((a) => a.owner === 'UKR' && a.unitIds.length > 4)
  if (!army) throw new Error('pas d’armée ukrainienne')
  return army
}

/**
 * Sur le théâtre, le territoire national est la ligne de départ : on fait passer à la Russie les cellules
 * ukrainiennes qui touchent la frontière russe, pour avoir du terrain à reprendre.
 */
function loseBorder(sim: Simulation, max = 400): number[] {
  const { grid, homeOwner } = sim.ctx
  const ukr = sim.ctx.sideIndex.get('UKR') as number
  const rus = sim.ctx.sideIndex.get('RUS') as number
  const taken: number[] = []
  for (let i = grid.width; i < grid.size - grid.width && taken.length < max; i++) {
    if (homeOwner[i] !== ukr || !grid.passable(i)) continue
    if ([i - 1, i + 1, i - grid.width, i + grid.width].some((n) => homeOwner[n] === rus)) {
      grid.setOwner(i, rus)
      taken.push(i)
    }
  }
  return taken
}

describe('missions d’armée', () => {
  it('« Tenir » par défaut ; l’encerclement compte comme mission', () => {
    const sim = newGame()
    const army = playerArmy(sim)
    expect(missionKind(army)).toBe('hold')
    army.encirclement = {
      targetIds: [],
      targetName: 'x',
      parentArmyId: null,
      phase: 'staging',
      startTick: 0,
      closeTick: null,
      staging: {},
    }
    expect(missionKind(army)).toBe('encircle')
  })

  it('« Avancer » jusqu’à une frontière : tracé, lancement de la marche', () => {
    const sim = newGame()
    const army = playerArmy(sim)
    // Rien à prendre : la frontière russe est déjà tenue au départ du théâtre.
    expect(sim.advanceArmy(army.id, { kind: 'border', country: 'RUS' })).toContain('Rien à prendre')
    loseBorder(sim)
    expect(sim.advanceArmy(army.id, { kind: 'border', country: 'RUS' })).toBe(null)
    const m = army.mission as AdvanceMission
    expect(m.kind).toBe('advance')
    expect(m.label).toContain('Russie')
    expect(m.cells.length).toBeGreaterThan(5)
    expect(m.line.length).toBeGreaterThan(0)
    // Les unités de ligne partent à l’attaque.
    const line = army.unitIds
      .map((id) => sim.ctx.units.get(id))
      .filter((u) => u && isLineUnit(u.kind))
    expect(line.some((u) => u?.order.kind === 'attack')).toBe(true)
  })

  it('frontière avec un pays : reprendre d’abord son propre territoire perdu', () => {
    const sim = newGame()
    const army = playerArmy(sim)
    const { grid, homeOwner } = sim.ctx
    const ukr = sim.ctx.sideIndex.get('UKR') as number
    const rus = sim.ctx.sideIndex.get('RUS') as number
    // Quelques cellules ukrainiennes au contact du territoire russe passent à la Russie.
    const taken = loseBorder(sim, 30)
    expect(taken.length).toBeGreaterThan(0)
    expect(sim.advanceArmy(army.id, { kind: 'border', country: 'RUS' })).toBe(null)
    const m = army.mission as AdvanceMission
    for (const c of m.cells) {
      expect(homeOwner[c]).toBe(ukr)
      expect(grid.owner[c]).toBe(rus)
    }
  })

  it('chaque unité de ligne vise un poste sur le tracé', () => {
    const sim = newGame()
    const army = playerArmy(sim)
    loseBorder(sim)
    expect(sim.advanceArmy(army.id, { kind: 'border', country: 'RUS' })).toBe(null)
    const m = army.mission as AdvanceMission
    const posts = (): number[] => {
      // Distance de chaque unité de ligne à la frontière visée, dans l’ordre du tracé.
      const { grid } = sim.ctx
      return army.unitIds
        .map((id) => sim.ctx.units.get(id))
        .filter((u) => u && isLineUnit(u.kind) && u.order.kind === 'attack')
        .map((u) => u?.order.target as LonLat)
        .map((t) => {
          let best = Infinity
          for (const c of m.cells)
            best = Math.min(best, distanceKm(t[0], t[1], grid.lonOf(c), grid.latOf(c)))
          return best
        })
    }
    // Les unités en marche visent toutes un poste sur le tracé.
    for (const d of posts()) expect(d).toBeLessThan(15)
    sim.step(24 * 3)
    expect(m.progress).toBeGreaterThanOrEqual(0)
    expect(m.progress).toBeLessThanOrEqual(1)
  })

  it('trait libre déjà dans son territoire : les unités s’y placent puis la mission s’achève', () => {
    const sim = newGame()
    const army = playerArmy(sim)
    const units = army.unitIds.map((id) => sim.ctx.units.get(id)).filter((u) => !!u)
    // Trait de 80 km à 30 km derrière le barycentre de l’armée, vers l’ouest (territoire ukrainien).
    const lon = units.reduce((a, u) => a + (u?.lon ?? 0), 0) / units.length - 0.8
    const lat = units.reduce((a, u) => a + (u?.lat ?? 0), 0) / units.length
    const points: LonLat[] = [
      [lon, lat - 0.4],
      [lon, lat + 0.4],
    ]
    expect(sim.advanceArmy(army.id, { kind: 'line', points })).toBe(null)
    expect(army.mission?.kind).toBe('advance')
    for (let h = 0; h < 24 * 12 && army.mission; h += 6) sim.step(6)
    expect(army.mission).toBeUndefined()
    // Loin du front : l'armée reste sur la ligne atteinte, sans front à rejoindre.
    expect(army.wholeFront).toBe(false)
    const near = units.filter(
      (u) => u && isLineUnit(u.kind) && distanceKm(u.lon, u.lat, lon, u.lat) < 25,
    )
    expect(near.length).toBeGreaterThan(0)
  })

  it('défensive : avance par bonds, arrêt pour se retrancher', () => {
    const sim = newGame()
    const army = playerArmy(sim)
    sim.setArmyPosture(army.id, 'defensive')
    loseBorder(sim)
    expect(sim.advanceArmy(army.id, { kind: 'border', country: 'RUS' })).toBe(null)
    const m = army.mission as AdvanceMission
    const phases = new Set<string>()
    for (let h = 0; h < 24 * 8; h += 6) {
      sim.step(6)
      if (army.mission?.kind === 'advance') phases.add(army.mission.phase)
    }
    expect(m.kind).toBe('advance')
    expect(phases.has('digging')).toBe(true)
  })

  it('groupe de brigades : détaché de son armée, la rejoint à la fin', () => {
    const sim = newGame()
    const army = playerArmy(sim)
    const picked = army.unitIds
      .filter((id) => {
        const u = sim.ctx.units.get(id)
        return u && isLineUnit(u.kind)
      })
      .slice(0, 2)
    const u0 = sim.ctx.units.get(picked[0] as number)
    if (!u0) throw new Error('unité')
    const point: LonLat = [u0.lon - 0.3, u0.lat]
    expect(sim.advanceUnits(picked, { kind: 'objective', point })).toBe(null)
    const group = [...sim.ctx.armies.values()].find((a) => a.mission?.kind === 'advance')
    expect(group?.id).not.toBe(army.id)
    expect(group?.unitIds.sort()).toEqual([...picked].sort())
    expect(army.unitIds.some((id) => picked.includes(id))).toBe(false)
    sim.step(24 * 10)
    expect(sim.ctx.armies.has(group?.id ?? -1)).toBe(false)
    for (const id of picked) {
      if (sim.ctx.units.has(id)) expect(sim.ctx.units.get(id)?.armyId).toBe(army.id)
    }
  })

  it('but refusé : les unités restent dans leur armée', () => {
    const sim = newGame()
    const army = playerArmy(sim)
    const before = [...army.unitIds]
    expect(sim.advanceUnits(before.slice(0, 2), { kind: 'border', country: 'UKR' })).not.toBe(null)
    expect([...army.unitIds].sort()).toEqual([...before].sort())
  })

  it('« Tenir » arrête l’avance ; la mission survit à une sauvegarde', () => {
    const sim = newGame()
    const army = playerArmy(sim)
    loseBorder(sim)
    expect(sim.advanceArmy(army.id, { kind: 'border', country: 'RUS' })).toBe(null)
    const loaded = Simulation.fromSave(parseSave(serializeSave(sim.toSave())), ukraine2026, theater)
    const copy = loaded.ctx.armies.get(army.id)
    expect(copy?.mission?.kind).toBe('advance')
    sim.holdArmy(army.id)
    expect(army.mission).toBeUndefined()
    const attacking = army.unitIds.filter((id) => sim.ctx.units.get(id)?.order.kind === 'attack')
    expect(attacking.length).toBe(0)
  })
})
