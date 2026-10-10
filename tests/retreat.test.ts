import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { frontCells } from '@/sim/systems/armies'
import { missionKind } from '@/sim/systems/missions'
import { distanceKm, type TheaterData } from '@/sim/theater/grid'
import type { ArmyState, LonLat, RetreatMission, UnitState } from '@/sim/core/types'
import { isLineUnit } from '@/sim/units/catalog'

const theater = theaterJson as unknown as TheaterData

function setup(): { sim: Simulation; army: ArmyState } {
  const sim = Simulation.fromScenario(ukraine2026, theater, 7)
  const army = [...sim.ctx.armies.values()].find((a) => a.owner === 'UKR' && a.wholeFront)
  if (!army) throw new Error('armée introuvable')
  return { sim, army }
}

/** Point à `km` d'une cellule de front, vers l'arrière (positif) ou vers l'ennemi (négatif). */
function shifted(sim: Simulation, share: number, km: number): LonLat {
  const ctx = sim.ctx
  const side = sim.sideOf('UKR')
  const cells = frontCells(ctx, side, null)
  const f = cells[Math.floor(cells.length * share)]
  if (!f) throw new Error('front introuvable')
  const len = Math.hypot(f.back[0], f.back[1]) || 1
  const at = (d: number): LonLat => {
    const lat = ctx.grid.latOf(f.cell) + (f.back[1] / len) * (d / 111)
    const lon =
      ctx.grid.lonOf(f.cell) + ((f.back[0] / len) * (d / 111)) / Math.cos((lat * Math.PI) / 180)
    return [lon, lat]
  }
  // Sens de l'arrière : celui où le terrain, 30 km plus loin, est tenu par le camp.
  const probe = at(30)
  const rear = ctx.grid.owner[ctx.grid.cellAt(probe[0], probe[1])] === side ? 1 : -1
  return at(rear * km)
}

function lineUnits(sim: Simulation, army: ArmyState): UnitState[] {
  return army.unitIds
    .map((id) => sim.ctx.units.get(id))
    .filter((u): u is UnitState => !!u && isLineUnit(u.kind))
}

describe('mission « Retraite ordonnée »', () => {
  it('repli par bonds alternés jusqu’à la ligne, puis l’armée la tient', () => {
    const { sim, army } = setup()
    // Ligne de repli à 60 km derrière la portion centrale du front.
    const points = [0.35, 0.45, 0.55, 0.65].map((s) => shifted(sim, s, 60))
    expect(sim.retreatArmy(army.id, { kind: 'line', points })).toBeNull()
    expect(missionKind(army)).toBe('retreat')
    const m = army.mission as RetreatMission
    expect(m.cells.length).toBeGreaterThan(5)
    // Au contact : un échelon recule, l'autre tient.
    const line = lineUnits(sim, army)
    const retreating = line.filter((u) => u.order.kind === 'retreat').length
    const holding = line.filter((u) => u.order.kind === 'hold').length
    expect(retreating).toBeGreaterThan(0)
    expect(holding).toBeGreaterThan(0)
    // Les deux échelons reculent tour à tour.
    const moved = new Set<number>()
    for (let h = 0; h < 24 * 25 && missionKind(army) === 'retreat'; h += 6) {
      sim.step(6)
      if (army.mission?.kind === 'retreat') moved.add(army.mission.moving)
    }
    expect(moved.size).toBe(2)
    expect(missionKind(army)).toBe('hold')
    // Les unités restantes se trouvent près de la ligne de repli.
    const near = lineUnits(sim, army).filter((u) =>
      m.cells.some(
        (c) => distanceKm(u.lon, u.lat, sim.ctx.grid.lonOf(c), sim.ctx.grid.latOf(c)) < 25,
      ),
    )
    expect(near.length).toBeGreaterThan(lineUnits(sim, army).length * 0.6)
  })

  it('ligne de repli hors du territoire tenu : refusée', () => {
    const { sim, army } = setup()
    const points = [shifted(sim, 0.5, -60), shifted(sim, 0.5, -90)]
    expect(sim.retreatArmy(army.id, { kind: 'line', points })).toMatch(/votre territoire/)
    expect(missionKind(army)).toBe('hold')
  })
})
