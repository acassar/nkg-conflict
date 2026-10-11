import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadTheater } from '@/sim/theater/load'
import { Simulation } from '@/sim/simulation'
import { buildScenario } from '@/sim/scenarios'
import { BorderLines, COUNTRY_PALETTE, countryColors, neighbours } from '@/map/borders'

const readPublic = async (p: string): Promise<ArrayBuffer> => {
  const buf = fs.readFileSync(new URL(`../public/${p}`, import.meta.url))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

/** Grille 4 × 2 d'un degré : camps 1 | 2 | 3, une cellule de mer en haut à droite. */
function grid() {
  // Ligne du sud d'abord.
  const owner = Uint8Array.from([1, 2, 2, 3, 1, 2, 3, 3])
  const terrain = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 1])
  return {
    width: 4,
    height: 2,
    bbox: [0, 0, 4, 2] as [number, number, number, number],
    owner,
    terrain,
    sides: ['', 'AAA', 'BBB', 'CCC'],
  }
}

const segments = (blocks: { length: number; positions: Float32Array }[]) =>
  blocks
    .flatMap((b) =>
      Array.from({ length: b.length }, (_, i) => Array.from(b.positions.slice(i * 4, i * 4 + 4))),
    )
    .sort((a, b) => a.join().localeCompare(b.join()))

describe('frontières nationales', () => {
  it('trace les frontières le long des bords de cellules, plus marquées en guerre', () => {
    const g = grid()
    // Camps 2 et 3 en guerre.
    const lines = new BorderLines(g, new Set([2 * 256 + 3, 3 * 256 + 2])).lines()
    // 1 | 2 : bord vertical sur toute la hauteur, en un seul segment.
    expect(segments(lines.peace)).toEqual([[1, 0, 1, 2]])
    // 2 | 3 : bord vertical en bas à x = 3, en haut à x = 2, et le bord horizontal entre eux.
    expect(segments(lines.war)).toEqual([
      [2, 1, 2, 2],
      [2, 1, 3, 1],
      [3, 0, 3, 1],
    ])
  })

  it('ne recalcule que les blocs touchés par une conquête', () => {
    const g = grid()
    const borders = new BorderLines(g, new Set(), 2)
    const before = borders.lines()
    // Le camp 1 prend la cellule (1, 0) : seul le bloc de gauche change (sans guerre, les bords
    // 1 | 2 et 2 | 3 à x = 2 forment un seul segment).
    g.owner[1] = 1
    borders.applyCells([1])
    const after = borders.lines()
    expect(after).not.toBe(before)
    const right = (l: typeof after) => l.peace.find((b) => b.id === 'border-peace-1')
    expect(right(after)).toBe(right(before))
    expect(segments(after.peace)).toContainEqual([2, 0, 2, 2])
    expect(borders.lines()).toBe(after)
  })

  it('donne des teintes différentes à deux pays voisins', () => {
    const g = grid()
    const adj = neighbours(g)
    expect([...(adj[2] ?? [])].sort()).toEqual([1, 3])
    // Couleurs habituelles identiques : la palette les sépare quand même.
    const colors = countryColors(adj, () => [200, 30, 30])
    expect(colors[1]).not.toEqual(colors[2])
    expect(colors[2]).not.toEqual(colors[3])
    // Chaque pays garde la teinte de la palette la plus proche de sa couleur quand elle est libre.
    expect(countryColors(adj, () => [50, 120, 190])[2]).toEqual(COUNTRY_PALETTE[1])
  })

  it('sépare les voisins sur la carte du monde, en un temps raisonnable', async () => {
    const world = await loadTheater('world', readPublic)
    const g = Simulation.fromScenario(buildScenario('world-2026'), world, 1).snapshot(true).grid
    if (!g) throw new Error('grille absente')
    const t0 = performance.now()
    const adj = neighbours(g)
    const colors = countryColors(adj, () => [150, 150, 150])
    const t1 = performance.now()
    const lines = new BorderLines(g, new Set()).lines()
    const t2 = performance.now()
    let clashes = 0
    adj.forEach((set, a) => set.forEach((b) => colors[a] === colors[b] && clashes++))
    expect(clashes).toBe(0)
    const count = lines.peace.reduce((n, b) => n + b.length, 0)
    console.info(
      `monde : couleurs en ${(t1 - t0).toFixed(0)} ms, ${count} segments de frontière en ${(t2 - t1).toFixed(0)} ms`,
    )
    expect(count).toBeGreaterThan(1000)
    expect(t2 - t0).toBeLessThan(3000)
  })
})
