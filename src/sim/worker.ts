/// <reference lib="webworker" />
import * as Comlink from 'comlink'
import { isSpeed } from './core/clock'
import { parseSave, serializeSave, toSave } from './core/save'
import type { SimSnapshot } from './core/types'
import { ukraine2026 } from './scenarios/ukraine-2026'
import { Simulation } from './world'

const FRAME_MS = 50

let sim: Simulation = Simulation.fromScenario(ukraine2026)
let listener: ((snapshot: SimSnapshot) => void) | null = null
let last = performance.now()

function publish(): void {
  listener?.(sim.snapshot())
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

const api = {
  subscribe(callback: (snapshot: SimSnapshot) => void): void {
    listener = callback
    publish()
  },
  setPaused(paused: boolean): void {
    sim.setPaused(paused)
    last = performance.now()
    publish()
  },
  setSpeed(speed: number): void {
    if (!isSpeed(speed)) throw new Error(`Vitesse invalide : ${speed}`)
    sim.setSpeed(speed)
    publish()
  },
  /** Mode tour par tour : joue un nombre fixe de ticks. */
  step(ticks: number): void {
    sim.step(Math.max(0, Math.floor(ticks)))
    publish()
  },
  save(): string {
    return serializeSave(toSave(sim.snapshot()))
  },
  load(text: string): void {
    sim = Simulation.fromSave(parseSave(text))
    publish()
  },
}

export type SimApi = typeof api

Comlink.expose(api)
