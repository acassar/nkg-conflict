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
  /** Propriétaire et terrain encodés par plages (théâtres légers, JSON)… */
  owner?: number[]
  terrain?: number[]
  /** … ou en octets bruts (grille mondiale, fichier binaire). */
  ownerBytes?: Uint8Array
  terrainBytes?: Uint8Array
  /** Réseau de transport par cellule (bits ROAD_BIT, MAJOR_ROAD_BIT, RAIL_BIT) ; absent = aucun. */
  roads?: Uint8Array
  cities: CityDef[]
}

/** Bits du réseau de transport d'une cellule (fichiers public/data/roads-*.bin.gz). */
export const ROAD_BIT = 1
/** Grand axe : autoroute ou voie rapide (toujours accompagné de ROAD_BIT). */
export const MAJOR_ROAD_BIT = 2
export const RAIL_BIT = 4

const KM_PER_DEG_LAT = 110.57
const KM_PER_DEG_LON_EQ = 111.32

/** Distance approchée en km (projection équirectangulaire locale), suffisante à l'échelle d'un théâtre. */
export function distanceKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const latMid = ((lat1 + lat2) / 2) * (Math.PI / 180)
  const dx = (lon2 - lon1) * KM_PER_DEG_LON_EQ * Math.cos(latMid)
  const dy = (lat2 - lat1) * KM_PER_DEG_LAT
  // Math.sqrt plutôt que Math.hypot : bien plus rapide, et cette fonction est la plus appelée.
  return Math.sqrt(dx * dx + dy * dy)
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

/** Emprise d'un camp sur la grille, en cellules (inclusive). Vide si x0 > x1. */
export interface CellBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

const MAX_SIDES = 256

/**
 * Grille de contrôle. Ligne 0 = sud. Chaque cellule a un propriétaire (index de camp, 0 = aucun)
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
  /**
   * Routes principales et voies ferrées par cellule (Natural Earth), fixes pendant la partie.
   * Pas encore utilisées par la simulation : elles serviront aux axes, à la vitesse et au ravitaillement.
   */
  readonly roads: Uint8Array
  /** Incrémenté à chaque changement de propriétaire. */
  version = 0
  /** Cellules praticables détenues par chaque camp, tenu à jour à chaque changement. */
  readonly owned = new Int32Array(MAX_SIDES)
  /** Emprise de chaque camp (elle ne fait que s'agrandir : sert à borner les balayages). */
  readonly boxes: CellBox[] = []
  /** Cellules dont le propriétaire a changé depuis la dernière publication. */
  private dirty: number[] = []
  /** Propriétaires d'origine suivis (voir `trackHome`), et comptes détenteur × origine. */
  private home: Uint8Array | null = null
  private occupation: Uint32Array | null = null

  constructor(data: TheaterData) {
    this.width = data.width
    this.height = data.height
    this.lon0 = data.bbox.lon0
    this.lat0 = data.bbox.lat0
    this.cell = data.cell
    const size = data.width * data.height
    this.owner = data.ownerBytes ? data.ownerBytes.slice() : decodeRle(data.owner ?? [], size)
    this.terrain = data.terrainBytes
      ? data.terrainBytes.slice()
      : decodeRle(data.terrain ?? [], size)
    if (this.owner.length !== size || this.terrain.length !== size) {
      throw new Error(`Grille corrompue : ${this.owner.length} cellules au lieu de ${size}`)
    }
    this.roads = data.roads?.length === size ? data.roads : new Uint8Array(size)
    this.recount()
  }

  /** Recalcule comptes et emprises (au chargement, ou après une restauration en bloc). */
  recount(): void {
    this.owned.fill(0)
    this.boxes.length = 0
    for (let s = 0; s < MAX_SIDES; s++)
      this.boxes.push({ x0: Infinity, y0: Infinity, x1: -1, y1: -1 })
    const W = this.width
    for (let i = 0; i < this.size; i++) {
      const o = this.owner[i] ?? 0
      if (o === 0 || !this.passable(i)) continue
      this.owned[o] = (this.owned[o] ?? 0) + 1
      this.grow(o, i % W, (i - (i % W)) / W)
    }
    if (this.home) this.countOccupation()
    this.version++
  }

  private grow(side: number, x: number, y: number): void {
    const b = this.boxes[side]
    if (!b) return
    if (x < b.x0) b.x0 = x
    if (x > b.x1) b.x1 = x
    if (y < b.y0) b.y0 = y
    if (y > b.y1) b.y1 = y
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

  /** Route sur la cellule (grand axe compris). */
  hasRoad(i: number): boolean {
    return ((this.roads[i] ?? 0) & ROAD_BIT) !== 0
  }

  hasMajorRoad(i: number): boolean {
    return ((this.roads[i] ?? 0) & MAJOR_ROAD_BIT) !== 0
  }

  hasRail(i: number): boolean {
    return ((this.roads[i] ?? 0) & RAIL_BIT) !== 0
  }

  /**
   * Suit l'occupation par rapport à des propriétaires d'origine (frontières d'avant-guerre) :
   * comptes tenus à jour par `setOwner`, sans reparcourir la grille (après une écriture directe dans
   * `owner`, appeler `recount`).
   */
  trackHome(home: Uint8Array): void {
    this.home = home
    this.countOccupation()
  }

  /**
   * Nombre de cellules par (détenteur × 256 + propriétaire d'origine), cellules d'origine sans pays
   * exclues ; null si `home` n'est pas le tableau suivi.
   */
  occupationFor(home: Uint8Array): Uint32Array | null {
    return this.home === home ? this.occupation : null
  }

  private countOccupation(): void {
    const home = this.home
    if (!home) return
    const counts = (this.occupation ??= new Uint32Array(MAX_SIDES * MAX_SIDES))
    counts.fill(0)
    for (let i = 0; i < this.size; i++) {
      const h = home[i] ?? 0
      if (!h) continue
      const k = (this.owner[i] ?? 0) * MAX_SIDES + h
      counts[k] = (counts[k] ?? 0) + 1
    }
  }

  passable(i: number): boolean {
    const t = this.terrain[i]
    return i >= 0 && t !== Terrain.WATER && t !== Terrain.NEUTRAL
  }

  setOwner(i: number, side: number): void {
    const prev = this.owner[i] ?? 0
    if (prev === side) return
    this.owner[i] = side
    this.version++
    this.dirty.push(i)
    const h = this.home?.[i] ?? 0
    const occ = this.occupation
    if (h && occ) {
      const a = prev * MAX_SIDES + h
      const b = side * MAX_SIDES + h
      occ[a] = (occ[a] ?? 1) - 1
      occ[b] = (occ[b] ?? 0) + 1
    }
    if (this.passable(i)) {
      if (prev) this.owned[prev] = (this.owned[prev] ?? 0) - 1
      if (side) {
        this.owned[side] = (this.owned[side] ?? 0) + 1
        this.grow(side, i % this.width, Math.floor(i / this.width))
      }
    }
  }

  /**
   * Zones où `side` peut toucher un de ses `enemies` : intersections de son emprise avec celle de
   * chaque ennemi élargie d'une cellule. Évite de balayer tout le pays (la Russie couvre la largeur du globe).
   */
  contactBoxes(side: number, enemies: number[]): CellBox[] {
    const own = this.boxes[side]
    if (!own || own.x1 < own.x0) return []
    const out: CellBox[] = []
    for (const e of enemies) {
      const b = this.boxes[e]
      if (!b || b.x1 < b.x0) continue
      const box = {
        x0: Math.max(own.x0, b.x0 - 1),
        y0: Math.max(own.y0, b.y0 - 1),
        x1: Math.min(own.x1, b.x1 + 1),
        y1: Math.min(own.y1, b.y1 + 1),
      }
      if (box.x0 <= box.x1 && box.y0 <= box.y1) out.push(box)
    }
    return out
  }

  /** Cellules modifiées depuis le dernier appel (puis la liste est vidée). */
  takeDirty(): number[] {
    const out = this.dirty
    this.dirty = []
    return out
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
    const dLon = km / (KM_PER_DEG_LON_EQ * Math.max(0.05, Math.cos((lat * Math.PI) / 180)))
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

  /** Nombre de cellules praticables détenues par un camp. */
  countOwned(side: number): number {
    return this.owned[side] ?? 0
  }
}
