import { describe, expect, it } from 'vitest'
import { parseSave, serializeSave, toSave } from '@/sim/core/save'
import type { SimSnapshot } from '@/sim/core/types'

const snapshot: SimSnapshot = {
  tick: 42,
  startDate: '2026-01-01T00:00:00Z',
  paused: true,
  speed: 3,
  playerCountry: 'UKR',
  countries: [{ id: 'UKR', name: 'Ukraine', color: [37, 99, 235] }],
  units: [{ id: 0, owner: 'UKR', kind: 'inf', lon: 30.5, lat: 50.4, strength: 0.8 }],
}

describe('save', () => {
  it('fait un aller-retour sans perte', () => {
    const save = toSave(snapshot, new Date('2026-10-07T12:00:00Z'))
    const back = parseSave(serializeSave(save))
    expect(back).toEqual(save)
    expect(back.units[0]?.lon).toBe(30.5)
  })

  it('rejette un JSON invalide ou une mauvaise version', () => {
    expect(() => parseSave('{')).toThrow(/JSON/)
    expect(() => parseSave(JSON.stringify({ version: 99 }))).toThrow(/Version/)
  })
})
