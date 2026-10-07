import { describe, expect, it } from 'vitest'
import { encodeRle, parseSave } from '@/sim/core/save'
import { decodeRle } from '@/sim/theater/grid'

describe('save', () => {
  it('encode et décode la grille par plages sans perte', () => {
    const data = Uint8Array.from([0, 0, 1, 1, 1, 2, 0, 0, 0, 0])
    expect(Array.from(decodeRle(encodeRle(data), data.length))).toEqual(Array.from(data))
  })

  it('rejette un JSON invalide ou une mauvaise version', () => {
    expect(() => parseSave('{')).toThrow(/JSON/)
    expect(() => parseSave(JSON.stringify({ version: 1 }))).toThrow(/Version/)
  })
})
