import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { decodeRle, type TheaterData } from '@/sim/theater/grid'
import { SUPPLY_CUT, SUPPLY_OK, SUPPLY_POCKET } from '@/sim/systems/supplyView'

const theater = theaterJson as unknown as TheaterData

function setup(): { sim: Simulation; side: number; rus: number } {
  const sim = Simulation.fromScenario(ukraine2026, theater, 3, 'UKR')
  return { sim, side: sim.sideOf('UKR'), rus: sim.sideOf('RUS') }
}

/** Coupe du ravitaillement un carré de cellules ukrainiennes autour de `center`. */
function cutBlock(sim: Simulation, side: number, center: number, r: number): number[] {
  const { grid } = sim.ctx
  const reach = sim.ctx.supplyReach[side]
  if (!reach) throw new Error('ravitaillement non calculé')
  const cx = center % grid.width
  const cy = (center - cx) / grid.width
  const cut: number[] = []
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const i = y * grid.width + x
      if (grid.owner[i] === side && grid.passable(i)) {
        reach[i] = 0
        cut.push(i)
      }
    }
  }
  return cut
}

describe('vue logistique de la carte', () => {
  it('en guerre, le territoire relié aux sources est marqué ravitaillé', () => {
    const { sim, side } = setup()
    const view = sim.supplyView()
    expect(view.atWar).toBe(true)
    expect(view.sources.length).toBeGreaterThan(0)
    const state = decodeRle(view.cells, sim.ctx.grid.size)
    const reach = sim.ctx.supplyReach[side]
    let ok = 0
    for (let i = 0; i < state.length; i++) {
      if (state[i] === SUPPLY_OK) {
        ok++
        expect(reach?.[i]).toBe(1)
      }
    }
    expect(ok).toBeGreaterThan(1000)
  })

  it('un groupe coupé au contact de l’ennemi est une poche, avec ses défenseurs', () => {
    const { sim, side, rus } = setup()
    const { grid } = sim.ctx
    // Cellule ukrainienne au contact d'une cellule russe.
    let edge = -1
    for (let i = grid.width; i < grid.size - grid.width && edge < 0; i++) {
      if (grid.owner[i] !== side || !grid.passable(i)) continue
      if (grid.owner[i + 1] === rus || grid.owner[i - 1] === rus) edge = i
    }
    expect(edge).toBeGreaterThanOrEqual(0)
    const cut = cutBlock(sim, side, edge, 3)
    const unit = [...sim.ctx.units.values()].find((u) => u.owner === 'UKR')
    if (!unit) throw new Error('unité introuvable')
    ;[unit.lon, unit.lat] = [grid.lonOf(edge), grid.latOf(edge)]

    const view = sim.supplyView()
    const state = decodeRle(view.cells, grid.size)
    for (const i of cut) expect(state[i]).toBe(SUPPLY_POCKET)
    const pocket = view.pockets.find((p) => cut.includes(grid.cellAt(p.at[0], p.at[1])))
    expect(pocket?.cells).toBe(cut.length)
    expect(pocket?.units).toBeGreaterThanOrEqual(1)
  })

  it('un groupe coupé loin de l’ennemi est seulement coupé, sans poche', () => {
    const { sim, side } = setup()
    const { grid } = sim.ctx
    // Près de Lviv, loin du front.
    const center = grid.cellAt(24.0, 49.8)
    expect(grid.owner[center]).toBe(side)
    const cut = cutBlock(sim, side, center, 2)
    const view = sim.supplyView()
    const state = decodeRle(view.cells, grid.size)
    for (const i of cut) expect(state[i]).toBe(SUPPLY_CUT)
    expect(view.pockets.some((p) => cut.includes(grid.cellAt(p.at[0], p.at[1])))).toBe(false)
  })
})
