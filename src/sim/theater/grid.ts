/** Terrain d'une cellule. */
export const Terrain = {
  PLAIN: 0,
  WATER: 1,
  NEUTRAL: 2,
  RIVER: 3,
  URBAN: 4,
  FOREST: 5,
  HILLS: 6,
  MOUNTAINS: 7,
  MARSH: 8,
} as const
export type TerrainCode = (typeof Terrain)[keyof typeof Terrain]

export interface TerrainRule {
  name: string
  /** Multiplicateur de vitesse des unités. */
  speed: number
  /** Multiplicateur de défense de l'unité qui s'y trouve. */
  defense: number
  /** Coût de passage pour le calcul d'itinéraire (1 = plaine). */
  pathCost: number
}

/**
 * Effets de chaque terrain. Eau et pays neutres sont infranchissables (voir Grid.passable) ;
 * leur vitesse reste à 1 pour qu'une unité qui en frôle une cellule entre deux points ne reste pas bloquée.
 */
export const TERRAIN_RULES: Record<number, TerrainRule> = {
  [Terrain.PLAIN]: { name: 'Plaine', speed: 1, defense: 1, pathCost: 1 },
  [Terrain.WATER]: { name: 'Eau', speed: 1, defense: 1, pathCost: Infinity },
  [Terrain.NEUTRAL]: { name: 'Pays neutre', speed: 1, defense: 1, pathCost: Infinity },
  [Terrain.RIVER]: { name: 'Fleuve', speed: 0.3, defense: 1.2, pathCost: 4 },
  [Terrain.URBAN]: { name: 'Ville', speed: 0.7, defense: 1.5, pathCost: 1.5 },
  [Terrain.FOREST]: { name: 'Forêt', speed: 0.7, defense: 1.25, pathCost: 1.4 },
  [Terrain.HILLS]: { name: 'Collines', speed: 0.8, defense: 1.2, pathCost: 1.3 },
  [Terrain.MOUNTAINS]: { name: 'Montagnes', speed: 0.4, defense: 1.6, pathCost: 2.5 },
  [Terrain.MARSH]: { name: 'Marais', speed: 0.4, defense: 1.3, pathCost: 2.5 },
}

const PLAIN_RULE: TerrainRule = { name: 'Plaine', speed: 1, defense: 1, pathCost: 1 }

export function terrainRule(code: number | undefined): TerrainRule {
  return TERRAIN_RULES[code ?? 0] ?? PLAIN_RULE
}

export interface CityDef {
  name: string
  country: string
  lon: number
  lat: number
  pop: number
  capital: boolean
}

export interface TheaterData {
  id: string
  bbox: { lon0: number; lat0: number; lon1: number; lat1: number }
  cell: number
  width: number
  height: number
  sides: string[]
  owner: number[]
  terrain: number[]
  cities: CityDef[]
}

const KM_PER_DEG_LAT = 110.57
const KM_PER_DEG_LON_EQ = 111.32

/** Distance approchée en km (projection équirectangulaire locale), suffisante à l'échelle d'un théâtre. */
export function distanceKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const latMid = ((lat1 + lat2) / 2) * (Math.PI / 180)
  const dx = (lon2 - lon1) * KM_PER_DEG_LON_EQ * Math.cos(latMid)
  const dy = (lat2 - lat1) * KM_PER_DEG_LAT
  return Math.hypot(dx, dy)
}

/** Déplace un point de `km` kilomètres vers un autre point (sans le dépasser). */
export function moveToward(
  lon: number,
  lat: number,
  tLon: number,
  tLat: number,
  km: number,
): [number, number] {
  const d = distanceKm(lon, lat, tLon, tLat)
  if (d <= km || d === 0) return [tLon, tLat]
  const f = km / d
  return [lon + (tLon - lon) * f, lat + (tLat - lat) * f]
}

export function decodeRle(rle: number[], size: number): Uint8Array {
  const out = new Uint8Array(size)
  let p = 0
  for (let i = 0; i + 1 < rle.length; i += 2) {
    const v = rle[i] ?? 0
    const n = rle[i + 1] ?? 0
    out.fill(v, p, p + n)
    p += n
  }
  if (p !== size) throw new Error(`Grille corrompue : ${p} cellules au lieu de ${size}`)
  return out
}

/**
 * Grille de contrôle du théâtre. Ligne 0 = sud. Chaque cellule a un propriétaire (index de camp, 0 = aucun)
 * et un terrain. C'est la vérité de la ligne de front.
 */
export class Grid {
  readonly width: number
  readonly height: number
  readonly lon0: number
  readonly lat0: number
  readonly cell: number
  readonly owner: Uint8Array
  readonly terrain: Uint8Array
  /** Incrémenté à chaque changement de propriétaire, pour ne republier la grille que si elle a changé. */
  version = 0

  constructor(data: TheaterData) {
    this.width = data.width
    this.height = data.height
    this.lon0 = data.bbox.lon0
    this.lat0 = data.bbox.lat0
    this.cell = data.cell
    const size = data.width * data.height
    this.owner = decodeRle(data.owner, size)
    this.terrain = decodeRle(data.terrain, size)
  }

  get size(): number {
    return this.width * this.height
  }

  index(x: number, y: number): number {
    return y * this.width + x
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height
  }

  /** Cellule contenant un point, ou -1 hors de la grille. */
  cellAt(lon: number, lat: number): number {
    const x = Math.floor((lon - this.lon0) / this.cell)
    const y = Math.floor((lat - this.lat0) / this.cell)
    return this.inBounds(x, y) ? this.index(x, y) : -1
  }

  lonOf(i: number): number {
    return this.lon0 + ((i % this.width) + 0.5) * this.cell
  }

  latOf(i: number): number {
    return this.lat0 + (Math.floor(i / this.width) + 0.5) * this.cell
  }

  passable(i: number): boolean {
    const t = this.terrain[i]
    return i >= 0 && t !== Terrain.WATER && t !== Terrain.NEUTRAL
  }

  setOwner(i: number, side: number): void {
    if (this.owner[i] !== side) {
      this.owner[i] = side
      this.version++
    }
  }

  /** Les 4 voisins (haut, bas, gauche, droite) d'une cellule, dans la grille. */
  neighbors4(i: number, out: number[] = []): number[] {
    out.length = 0
    const x = i % this.width
    const y = Math.floor(i / this.width)
    if (x > 0) out.push(i - 1)
    if (x < this.width - 1) out.push(i + 1)
    if (y > 0) out.push(i - this.width)
    if (y < this.height - 1) out.push(i + this.width)
    return out
  }

  /** Cellules dont le centre est à moins de `km` d'un point. */
  cellsWithin(lon: number, lat: number, km: number, visit: (i: number) => void): void {
    const dLat = km / KM_PER_DEG_LAT
    const dLon = km / (KM_PER_DEG_LON_EQ * Math.cos((lat * Math.PI) / 180))
    const x0 = Math.max(0, Math.floor((lon - dLon - this.lon0) / this.cell))
    const x1 = Math.min(this.width - 1, Math.floor((lon + dLon - this.lon0) / this.cell))
    const y0 = Math.max(0, Math.floor((lat - dLat - this.lat0) / this.cell))
    const y1 = Math.min(this.height - 1, Math.floor((lat + dLat - this.lat0) / this.cell))
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = this.index(x, y)
        if (distanceKm(lon, lat, this.lonOf(i), this.latOf(i)) <= km) visit(i)
      }
    }
  }

  /** Vrai si la cellule touche une cellule d'un autre camp jouable (cellule de front). */
  isFrontCell(i: number, side: number, scratch: number[] = []): boolean {
    for (const n of this.neighbors4(i, scratch)) {
      const o = this.owner[n] ?? 0
      if (o !== 0 && o !== side && this.passable(n)) return true
    }
    return false
  }

  /** Nombre de cellules praticables détenues par un camp. */
  countOwned(side: number): number {
    let n = 0
    for (let i = 0; i < this.size; i++) if (this.owner[i] === side && this.passable(i)) n++
    return n
  }
}
