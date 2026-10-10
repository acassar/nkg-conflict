const N = 256

/**
 * Relations militaires entre camps (index de la grille), recalculées quand les guerres changent :
 * - `hostile(a, b)` : a et b sont en guerre l'un contre l'autre ;
 * - `friendly(a, b)` : même camp, ou cobelligérants dans une même guerre (passage et ravitaillement) ;
 * - `passage(a, b)` : droit de passage accordé par b à a (passage et ravitaillement, un seul sens).
 */
export class SideMatrix {
  private readonly war = new Uint8Array(N * N)
  private readonly friend = new Uint8Array(N * N)
  /** Droits de passage : `pass[a * N + b]` = les unités de a peuvent traverser le territoire de b. */
  private readonly pass = new Uint8Array(N * N)
  /** Camps engagés dans au moins une guerre. */
  readonly atWar = new Uint8Array(N)

  clear(): void {
    this.war.fill(0)
    this.friend.fill(0)
    this.pass.fill(0)
    this.atWar.fill(0)
  }

  setWar(a: number, b: number): void {
    if (a === b || a <= 0 || b <= 0) return
    this.war[a * N + b] = 1
    this.war[b * N + a] = 1
    this.atWar[a] = 1
    this.atWar[b] = 1
  }

  setFriends(a: number, b: number): void {
    if (a === b || a <= 0 || b <= 0) return
    this.friend[a * N + b] = 1
    this.friend[b * N + a] = 1
  }

  /** Droit de passage de `a` sur le territoire de `b` (un seul sens). */
  setPassage(a: number, b: number): void {
    if (a === b || a <= 0 || b <= 0) return
    this.pass[a * N + b] = 1
  }

  /** Les unités de `side` traversent-elles le territoire de `owner` par droit de passage ? */
  passage(side: number, owner: number): boolean {
    return this.pass[side * N + owner] === 1
  }

  /** Camps en guerre contre `side`. */
  enemiesOf(side: number): number[] {
    const out: number[] = []
    if (this.atWar[side] !== 1) return out
    for (let o = 1; o < N; o++) if (this.war[side * N + o] === 1) out.push(o)
    return out
  }

  hostile(a: number, b: number): boolean {
    return this.war[a * N + b] === 1
  }

  friendly(a: number, b: number): boolean {
    return a === b || this.friend[a * N + b] === 1
  }

  /** Une unité de `side` peut-elle entrer sur une cellule de `owner` ? (frontières fermées en paix) */
  canEnter(side: number, owner: number): boolean {
    return (
      owner === 0 ||
      owner === side ||
      this.hostile(side, owner) ||
      this.friendly(side, owner) ||
      this.passage(side, owner)
    )
  }
}
