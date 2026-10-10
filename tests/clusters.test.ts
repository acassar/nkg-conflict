import { describe, expect, it } from 'vitest'
import { isStack, stackUnits } from '@/map/clusters'
import type { UnitSnapshot } from '@/sim/core/types'

const unit = (id: number, owner: string, lon: number, lat: number): UnitSnapshot => ({
  id,
  name: `u${id}`,
  owner,
  kind: 'inf',
  lon,
  lat,
  strength: 1,
  org: 1,
  order: 'hold',
  target: null,
  path: [],
  armyId: null,
  engaged: false,
  supplied: true,
  routed: false,
  commanded: false,
  posture: 'balanced',
  engagedWith: null,
  stance: null,
  fatigue: 0,
  relief: false,
})

describe('piles de pions', () => {
  const units = [
    unit(1, 'UKR', 36.0, 49.0),
    unit(2, 'UKR', 36.05, 49.0),
    unit(3, 'RUS', 36.02, 49.0),
    unit(4, 'UKR', 30.5, 50.4),
  ]

  it('regroupe les unités proches d’un même camp quand on dézoome', () => {
    const items = stackUnits(units, 4)
    const stacks = items.filter(isStack)
    expect(stacks.length).toBe(1)
    expect(stacks[0]?.units.map((u) => u.id)).toEqual([1, 2])
    expect(items.length).toBe(3)
  })

  it('ne regroupe jamais deux camps différents', () => {
    for (const item of stackUnits(units, 2)) {
      if (isStack(item)) expect(new Set(item.units.map((u) => u.owner)).size).toBe(1)
    }
  })

  it('sépare les pions quand on zoome', () => {
    expect(stackUnits(units, 10).filter(isStack).length).toBe(0)
  })
})
