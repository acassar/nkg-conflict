import { describe, expect, it } from 'vitest'
import { mapCursor, TARGET_CURSOR, type CursorState } from '@/map/cursors'
import { transportProgress, transportRoutes } from '@/map/transports'
import type { TransportSnapshot } from '@/sim/core/types'

describe('curseur de la carte', () => {
  const base: CursorState = {
    mode: { kind: 'select' },
    hovering: false,
    dragging: false,
    placing: false,
  }

  it('main ouverte, doigt sur un objet, main fermée pendant le glissement', () => {
    expect(mapCursor(base)).toBe('grab')
    expect(mapCursor({ ...base, hovering: true })).toBe('pointer')
    expect(mapCursor({ ...base, dragging: true })).toBe('grabbing')
    expect(mapCursor({ ...base, mode: { kind: 'transport' }, dragging: true })).toBe('grabbing')
  })

  it("suit l'action en cours", () => {
    expect(mapCursor({ ...base, mode: { kind: 'order', order: 'move' } })).toBe('crosshair')
    expect(mapCursor({ ...base, mode: { kind: 'order', order: 'attack' } })).toBe(TARGET_CURSOR)
    expect(
      mapCursor({ ...base, mode: { kind: 'target', action: 'assault' }, hovering: true }),
    ).toBe(TARGET_CURSOR)
    expect(mapCursor({ ...base, mode: { kind: 'transport' } })).toBe('crosshair')
    expect(mapCursor({ ...base, mode: { kind: 'air', mission: 'support' } })).toBe('cell')
    expect(mapCursor({ ...base, placing: true })).toBe('cell')
    expect(mapCursor({ ...base, placing: true, hovering: true })).toBe('pointer')
  })
})

describe('trajets des transports', () => {
  const t = (
    id: number,
    from: [number, number],
    departTick = 0,
  ): TransportSnapshot['inTransit'][number] => ({
    id,
    name: `B${id}`,
    kind: 'inf',
    mode: 'rail',
    dest: 'Bordeaux',
    from,
    to: [-0.58, 44.84],
    departTick,
    arriveTick: departTick + 40,
  })

  it('avance au prorata du temps écoulé', () => {
    expect(transportProgress({ departTick: 10, arriveTick: 50 }, 30)).toBe(0.5)
    expect(transportProgress({ departTick: 10, arriveTick: 50 }, 80)).toBe(1)
    expect(transportProgress({ departTick: 10, arriveTick: 10 }, 5)).toBe(1)
  })

  it('regroupe les unités parties ensemble du même endroit', () => {
    const routes = transportRoutes([t(1, [2.35, 48.86]), t(2, [2.35, 48.86]), t(3, [5, 45])], 20)
    expect(routes.map((r) => r.count)).toEqual([2, 1])
    const [paris] = routes
    expect(paris?.progress).toBe(0.5)
    expect(paris?.at[0]).toBeCloseTo((2.35 - 0.58) / 2)
    expect(paris?.at[1]).toBeCloseTo((48.86 + 44.84) / 2)
  })
})
