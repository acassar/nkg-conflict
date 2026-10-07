import { SPEED_TICKS_PER_SECOND, type Speed } from './clock'

/**
 * Accumulateur de temps réel → ticks de simulation.
 * Indépendant de tout timer : on lui donne le temps réel écoulé, il dit combien de ticks jouer.
 * Le tour par tour revient à appeler `step(n)` directement sans passer par `advance`.
 */
export class TickAccumulator {
  private carryMs = 0
  paused = true
  speed: Speed = 1

  /** Plafond de ticks par appel, pour éviter une rafale après un onglet resté en arrière-plan. */
  constructor(private readonly maxTicksPerAdvance = 240) {}

  /** Renvoie le nombre de ticks à simuler pour `elapsedMs` millisecondes réelles. */
  advance(elapsedMs: number): number {
    if (this.paused || elapsedMs <= 0) return 0
    const msPerTick = 1000 / SPEED_TICKS_PER_SECOND[this.speed]
    this.carryMs += elapsedMs
    let ticks = Math.floor(this.carryMs / msPerTick)
    this.carryMs -= ticks * msPerTick
    if (ticks > this.maxTicksPerAdvance) {
      ticks = this.maxTicksPerAdvance
      this.carryMs = 0
    }
    return ticks
  }

  setSpeed(speed: Speed): void {
    this.speed = speed
    this.carryMs = 0
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    this.carryMs = 0
  }
}
