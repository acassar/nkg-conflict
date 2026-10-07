/** Générateur pseudo-aléatoire déterministe (mulberry32) : une même sauvegarde rejoue la même partie. */
export class Random {
  constructor(public state: number) {}

  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Nombre uniforme dans [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next()
  }
}
