import { describe, expect, it } from 'vitest'
import theaterJson from '@/sim/data/theater-ukraine.json'
import { Simulation } from '@/sim/simulation'
import { ukraine2026 } from '@/sim/scenarios/ukraine-2026'
import { frontCells } from '@/sim/systems/armies'
import {
  AI_RATIO,
  assessArmy,
  breachTarget,
  chooseMission,
  choosePosture,
  updateAiArmies,
  type AiArmyMemory,
  type ArmySituation,
} from '@/sim/systems/aiArmies'
import { WarIndex } from '@/sim/systems/spatial'
import type { TheaterData } from '@/sim/theater/grid'

const theater = theaterJson as unknown as TheaterData

const situation = (over: Partial<ArmySituation>): ArmySituation => ({
  ratio: 1,
  org: 0.9,
  lineUnits: 18,
  density: 1,
  calmShare: 0.1,
  contact: true,
  ...over,
})

describe('IA des armées : posture et mission selon la situation', () => {
  it('posture selon le rapport de force, avec hystérésis', () => {
    expect(choosePosture(situation({ ratio: 2.5 }), 'balanced')).toBe('offensive')
    expect(choosePosture(situation({ ratio: 1 }), 'balanced')).toBe('balanced')
    expect(choosePosture(situation({ ratio: 0.4 }), 'balanced')).toBe('defensive')
    expect(choosePosture(situation({ ratio: 0.2 }), 'balanced')).toBe('maxDefense')
    // Troupes épuisées : jamais mieux que défensive ; sans contact : équilibrée.
    expect(choosePosture(situation({ ratio: 3, org: 0.3 }), 'balanced')).toBe('defensive')
    expect(choosePosture(situation({ ratio: 0.2, contact: false }), 'defensive')).toBe('balanced')
    // Juste au-dessus du seuil : la posture actuelle tient (pas d'aller-retour).
    const justAbove = AI_RATIO.offensive * 1.05
    expect(choosePosture(situation({ ratio: justAbove }), 'balanced')).toBe('balanced')
    expect(choosePosture(situation({ ratio: AI_RATIO.offensive * 0.95 }), 'offensive')).toBe(
      'offensive',
    )
  })

  it('mission selon la force, la densité et le terrain', () => {
    expect(chooseMission(situation({ ratio: 3 }), true)).toBe('breach')
    expect(chooseMission(situation({ ratio: 3 }), false)).toBe('hold')
    expect(chooseMission(situation({ ratio: 3, lineUnits: 4 }), true)).toBe('hold')
    expect(chooseMission(situation({ ratio: 0.4, density: 2 }), true)).toBe('depth')
    expect(chooseMission(situation({ density: 0.3 }), true)).toBe('keyPoints')
    expect(chooseMission(situation({ ratio: 0.6, calmShare: 0.5 }), true)).toBe('keyPoints')
    expect(chooseMission(situation({ ratio: 1 }), true)).toBe('hold')
  })

  it("juge la situation d'une armée au départ et trouve un but de percée chez l'ennemi", () => {
    const sim = Simulation.fromScenario(ukraine2026, theater, 3)
    const ctx = sim.ctx
    const army = [...ctx.armies.values()].find((a) => a.owner === 'RUS' && a.wholeFront)
    if (!army) throw new Error('armée introuvable')
    const side = sim.sideOf('RUS')
    const cells = frontCells(ctx, side, null)
    const index = new WarIndex(ctx)
    const s = assessArmy(ctx, army, index, cells)
    expect(s.contact).toBe(true)
    expect(s.ratio).toBeGreaterThan(0.5)
    expect(s.ratio).toBeLessThan(2)
    expect(s.lineUnits).toBeGreaterThan(10)
    const target = breachTarget(ctx, side, cells, index)
    expect(target).not.toBeNull()
    const t = ctx.grid.cellAt(target![0], target![1])
    expect(ctx.matrix.hostile(side, ctx.grid.owner[t] ?? 0)).toBe(true)
  })

  it("applique posture et mission à l'armée et à ses unités, puis attend avant d'en changer", () => {
    const sim = Simulation.fromScenario(ukraine2026, theater, 3)
    const ctx = sim.ctx
    const army = [...ctx.armies.values()].find((a) => a.owner === 'UKR' && a.wholeFront)
    if (!army) throw new Error('armée introuvable')
    // Armée affaiblie : la moitié de ses unités de ligne disparaît.
    for (const id of army.unitIds.filter((_, k) => k % 2 === 0)) ctx.units.delete(id)
    army.unitIds = army.unitIds.filter((id) => ctx.units.has(id))
    for (const u of ctx.units.values()) if (u.owner === 'UKR') u.org = 0.5
    const memory = new Map<number, AiArmyMemory>()
    updateAiArmies(ctx, 'UKR', memory, new WarIndex(ctx))
    const posture = army.posture
    expect(posture === 'defensive' || posture === 'maxDefense').toBe(true)
    for (const id of army.unitIds) expect(ctx.units.get(id)?.posture).toBe(posture)
    // Situation rétablie le lendemain : l'armée garde sa posture (3 jours au moins entre deux changements).
    for (const u of ctx.units.values()) if (u.owner === 'UKR') u.org = 1
    ctx.tick += 24
    updateAiArmies(ctx, 'UKR', memory, new WarIndex(ctx))
    expect(army.posture).toBe(posture)
  })
})
