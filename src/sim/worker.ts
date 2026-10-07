/// <reference lib="webworker" />
import * as Comlink from 'comlink'
import { isSpeed } from './core/clock'
import { parseSave, serializeSave } from './core/save'
import type { LonLat, SimSnapshot } from './core/types'
import theaterJson from './data/theater-ukraine.json'
import { ukraine2026 } from './scenarios/ukraine-2026'
import { Simulation, type PlayerOrder } from './simulation'
import type { TheaterData } from './theater/grid'

const FRAME_MS = 50
/** La grille (≈ 220 Ko) n'est republiée qu'au plus 4 fois par seconde. */
const GRID_MIN_INTERVAL_MS = 250

const theater = theaterJson as unknown as TheaterData

let sim = Simulation.fromScenario(ukraine2026, theater, Date.now() & 0x7fffffff)
let listener: ((snapshot: SimSnapshot) => void) | null = null
let last = performance.now()
let lastGridAt = 0

function publish(forceGrid = false): void {
  if (!listener) return
  const now = performance.now()
  const allowGrid = forceGrid || now - lastGridAt >= GRID_MIN_INTERVAL_MS
  const snapshot = sim.snapshot(forceGrid, allowGrid)
  if (snapshot.grid) lastGridAt = now
  listener(snapshot)
}

// Boucle temps réel : le Worker convertit le temps écoulé en ticks, puis publie l'état.
setInterval(() => {
  const now = performance.now()
  const ticks = sim.clock.advance(now - last)
  last = now
  if (ticks > 0) {
    sim.step(ticks)
    publish()
  }
}, FRAME_MS)

/** Applique une action du joueur puis republie l'état. */
function act(fn: () => void): void {
  fn()
  publish()
}

const api = {
  subscribe(callback: (snapshot: SimSnapshot) => void): void {
    listener = callback
    publish(true)
  },
  setPaused(paused: boolean): void {
    sim.setPaused(paused)
    last = performance.now()
    // À la pause, on force la grille pour ne pas garder un front en retard sur l'écran.
    publish(paused)
  },
  setSpeed(speed: number): void {
    if (!isSpeed(speed)) throw new Error(`Vitesse invalide : ${speed}`)
    act(() => sim.setSpeed(speed))
  },
  /** Mode tour par tour : joue un nombre fixe d'heures. */
  step(ticks: number): void {
    act(() => sim.step(Math.max(0, Math.floor(ticks))))
  },
  orderUnits(ids: number[], kind: PlayerOrder, target?: LonLat): void {
    act(() => sim.orderUnits(ids, kind, target))
  },
  createArmy(name: string, ids: number[]): number {
    const id = sim.createArmy(name, ids)
    publish()
    return id
  },
  disbandArmy(id: number): void {
    act(() => sim.disbandArmy(id))
  },
  setArmyFront(id: number, front: [LonLat, LonLat] | 'whole' | null): void {
    act(() => sim.setArmyFront(id, front))
  },
  planOffensive(id: number, from: LonLat, to: LonLat): void {
    act(() => sim.planOffensive(id, from, to))
  },
  launchOffensive(id: number): void {
    act(() => sim.launchOffensive(id))
  },
  cancelOffensive(id: number): void {
    act(() => sim.cancelOffensive(id))
  },
  newGame(): void {
    sim = Simulation.fromScenario(ukraine2026, theater, Date.now() & 0x7fffffff)
    publish(true)
  },
  save(): string {
    return serializeSave(sim.toSave())
  },
  load(text: string): void {
    sim = Simulation.fromSave(parseSave(text), ukraine2026, theater)
    publish(true)
  },
}

export type SimApi = typeof api

Comlink.expose(api)
