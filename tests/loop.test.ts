import { describe, expect, it } from 'vitest'
import { TickAccumulator } from '@/sim/core/loop'

describe('TickAccumulator', () => {
  it('ne produit aucun tick en pause', () => {
    const acc = new TickAccumulator()
    expect(acc.advance(10_000)).toBe(0)
  })

  it('produit 1 tick par seconde en vitesse 1', () => {
    const acc = new TickAccumulator()
    acc.setPaused(false)
    expect(acc.advance(999)).toBe(0)
    expect(acc.advance(1)).toBe(1)
    expect(acc.advance(2000)).toBe(2)
  })

  it('accélère selon la vitesse', () => {
    const acc = new TickAccumulator()
    acc.setPaused(false)
    acc.setSpeed(5)
    expect(acc.advance(1000)).toBe(72)
  })

  it('plafonne les rafales après une longue absence', () => {
    const acc = new TickAccumulator(100)
    acc.setPaused(false)
    acc.setSpeed(5)
    expect(acc.advance(60_000)).toBe(100)
    expect(acc.advance(0)).toBe(0)
  })
})
