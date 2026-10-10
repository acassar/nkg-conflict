import { runtimeOf, sideIndex, type SimContext } from '../context'
import { isOffensiveOrder, type ArmyState, type LonLat, type UnitState } from '../core/types'
import { distanceKm, Terrain, terrainRule } from '../theater/grid'
import { fortFactorAt } from '../economy/economy'
import { isLineUnit } from '../units/catalog'
import { planPath } from './movement'
import { assaultFireFactor } from './obstacles'
import {
  cumulativeWeights,
  frontWeight,
  indexAtShare,
  keyPointKinds,
  keyPointWeight,
  type WeightFn,
} from './axes'

/** Largeur du couloir autour d'une portion de front assignée. */
const FRONT_CORRIDOR_KM = 60
/** Un ordre de front n'est recalculé que si l'emplacement a bougé de plus que ça. */
const SLOT_TOLERANCE_KM = 8
/** Part de l'écart entre deux postes en deçà de laquelle une unité garde son poste actuel. */
const SLOT_TOLERANCE_SHARE = 0.4
/** Écart moyen entre postes au-delà duquel cette tolérance élargie s'applique. */
const WIDE_SPACING_KM = 150
/** Au-delà de cette taille de grille (carte du monde), les chemins vers les postes sont étalés. */
export const LARGE_GRID_CELLS = 1_000_000

export interface FrontCell {
  cell: number
  /** Position le long de la portion de front, 0 à 1. */
  t: number
  /** Direction (en cellules) vers l'arrière, à l'opposé de l'ennemi. */
  back: [number, number]
}

/** Projection d'un point sur un segment : position t (0 à 1) et distance en km. */
function project(p: LonLat, a: LonLat, b: LonLat): { t: number; km: number } {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return { t, km: distanceKm(p[0], p[1], a[0] + dx * t, a[1] + dy * t) }
}

/** Cellules de front d'un camp, triées le long d'une portion (ou de tout le front si `segment` est null). */
export function frontCells(
  ctx: SimContext,
  side: number,
  segment: [LonLat, LonLat] | null,
): FrontCell[] {
  const { grid } = ctx
  const { width: W, height: H, owner } = grid
  const raw: Array<{ cell: number; back: [number, number] }> = []
  const hostile = (n: number): boolean => {
    const o = owner[n] ?? 0
    return o !== 0 && ctx.matrix.hostile(side, o) && grid.passable(n)
  }
  // Balayage limité aux zones de contact avec chaque ennemi (cellules vues une seule fois).
  if (ctx.matrix.atWar[side] !== 1) return []
  const seen = new Set<number>()
  for (const box of grid.contactBoxes(side, ctx.matrix.enemiesOf(side))) {
    for (let y = box.y0; y <= box.y1; y++) {
      for (let x = box.x0; x <= box.x1; x++) {
        const i = y * W + x
        if (owner[i] !== side || seen.has(i)) continue
        // Direction vers l'arrière : somme des vecteurs qui s'éloignent des voisins ennemis.
        let bx = 0
        let by = 0
        if (x > 0 && hostile(i - 1)) bx += 1
        if (x < W - 1 && hostile(i + 1)) bx -= 1
        if (y > 0 && hostile(i - W)) by += 1
        if (y < H - 1 && hostile(i + W)) by -= 1
        if ((bx !== 0 || by !== 0) && grid.passable(i)) {
          seen.add(i)
          raw.push({ cell: i, back: [Math.sign(bx), Math.sign(by)] })
        }
      }
    }
  }
  if (raw.length === 0) return []

  let a: LonLat
  let b: LonLat
  if (segment) {
    ;[a, b] = segment
  } else {
    // Tout le front : du point le plus au nord au point le plus au sud.
    const first = raw[0]?.cell ?? 0
    let north = first
    let south = first
    for (const r of raw) {
      if (grid.latOf(r.cell) > grid.latOf(north)) north = r.cell
      if (grid.latOf(r.cell) < grid.latOf(south)) south = r.cell
    }
    a = [grid.lonOf(north), grid.latOf(north)]
    b = [grid.lonOf(south), grid.latOf(south)]
  }

  const out: FrontCell[] = []
  for (const r of raw) {
    const p: LonLat = [grid.lonOf(r.cell), grid.latOf(r.cell)]
    const { t, km } = project(p, a, b)
    if (segment && km > FRONT_CORRIDOR_KM) continue
    out.push({ cell: r.cell, t, back: r.back })
  }
  out.sort((x, y) => x.t - y.t)
  return out
}

/** Recule de `depth` cellules depuis une cellule de front, tant qu'on reste chez soi. */
function behind(ctx: SimContext, side: number, f: FrontCell, depth: number): LonLat {
  const i = behindCell(ctx, side, f, depth)
  return [ctx.grid.lonOf(i), ctx.grid.latOf(i)]
}

/** Directions de recul tentées quand l'arrière est bloqué : de biais, puis de côté. */
const DETOURS: ReadonlyArray<number> = [0, 1, -1, 2, -2]
const COMPASS: ReadonlyArray<[number, number]> = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
]

/**
 * Recul profond (seconde ligne, réserve) : comme `behind`, mais en contournant les obstacles (fleuve
 * infranchissable, frontière d'un pays tiers) de biais ou de côté, sans jamais revenir vers l'ennemi.
 */
function deepBehind(ctx: SimContext, side: number, f: FrontCell, depth: number): LonLat {
  const { grid } = ctx
  let x = f.cell % grid.width
  let y = Math.floor(f.cell / grid.width)
  const base = COMPASS.findIndex(([dx, dy]) => dx === f.back[0] && dy === f.back[1])
  if (base < 0) return behind(ctx, side, f, depth)
  for (let k = 0; k < depth; k++) {
    let moved = false
    for (const turn of DETOURS) {
      const [dx, dy] = COMPASS[(base + turn + 8) % 8] as [number, number]
      if (!grid.inBounds(x + dx, y + dy)) continue
      const n = grid.index(x + dx, y + dy)
      if (grid.owner[n] !== side || !grid.passable(n)) continue
      x += dx
      y += dy
      moved = true
      break
    }
    if (!moved) break
  }
  return [grid.lonOf(grid.index(x, y)), grid.latOf(grid.index(x, y))]
}

/** Cellule atteinte en reculant de `depth` cellules depuis une cellule de front. */
function behindCell(ctx: SimContext, side: number, f: FrontCell, depth: number): number {
  const { grid } = ctx
  let x = f.cell % grid.width
  let y = Math.floor(f.cell / grid.width)
  for (let k = 0; k < depth; k++) {
    const nx = x + f.back[0]
    const ny = y + f.back[1]
    if (!grid.inBounds(nx, ny)) break
    const n = grid.index(nx, ny)
    if (grid.owner[n] !== side || !grid.passable(n)) break
    x = nx
    y = ny
  }
  return grid.index(x, y)
}

/**
 * Emplacements le long des cellules de front, répartis selon le poids des axes (front discontinu) :
 * les unités se concentrent sur les routes, voies ferrées et villes, et ne laissent que quelques postes
 * dans les secteurs calmes (terrain difficile sans route). Voir axes.ts.
 */
function slots(
  ctx: SimContext,
  cells: FrontCell[],
  count: number,
  weight: WeightFn = frontWeight,
): FrontCell[] {
  if (count <= 0 || cells.length === 0) return []
  const cum = cumulativeWeights(ctx, cells, weight)
  const out: FrontCell[] = []
  for (let k = 0; k < count; k++) {
    const c = cells[indexAtShare(cum, (k + 0.5) / count)]
    if (c) out.push(c)
  }
  return out
}

/** Profondeur des postes des unités de ligne (en cellules derrière le contact). */
const LINE_DEPTH = 2
/** Défense en profondeur : part des unités de ligne au contact ; distance de la seconde ligne (km). */
const DEPTH_FORWARD_SHARE = 0.6
const SECOND_LINE_KM = 25
/** Réserve : distance de ses postes derrière le front (km). */
const RESERVE_KM = 40
/** Écart au milieu de son secteur toléré par un poste favorable : −5 % de valeur au bord du secteur. */
const OFF_CENTER_PENALTY = 0.05
/** Fleuve devant le poste : même bonus que dans le combat (assaut à travers un fleuve). */
const RIVER_AHEAD_FACTOR = 1.4

/**
 * Valeur défensive d'un poste pour le camp `side` (multiplicateur, 1 = plaine nue) : terrain, fleuve
 * entre le poste et l'ennemi, fortifications, obstacles déjà posés et retranchement de l'unité qui
 * l'occupe (`entrenched`, par cellule). Mêmes facteurs que le combat.
 */
export function postValue(
  ctx: SimContext,
  side: number,
  f: FrontCell,
  depth: number,
  entrenched: Map<number, number>,
): { cell: number; value: number } {
  const { grid } = ctx
  const cell = behindCell(ctx, side, f, depth)
  let value = terrainRule(grid.terrain[cell]).defense
  // Fleuve entre le poste et l'ennemi : quelques cellules vers l'avant.
  let x = cell % grid.width
  let y = Math.floor(cell / grid.width)
  for (let k = 0; k <= depth + 1; k++) {
    x -= f.back[0]
    y -= f.back[1]
    if (!grid.inBounds(x, y)) break
    if (grid.terrain[grid.index(x, y)] === Terrain.RIVER) {
      value *= RIVER_AHEAD_FACTOR
      break
    }
  }
  value *= fortFactorAt(ctx, side, grid.lonOf(cell), grid.latOf(cell))
  const field = ctx.obstacles.get(cell)
  if (field && field.side === side) value /= assaultFireFactor(field.level)
  value *= 1 + 0.5 * (entrenched.get(cell) ?? 0)
  return { cell, value }
}

/**
 * Postes favorables : le front est découpé en autant de secteurs que d'unités (de même poids d'axes,
 * donc plus courts sur les axes), et chaque unité tient,
 * dans son secteur, le poste de plus grande valeur défensive (léger avantage au milieu du secteur, pour
 * garder des postes répartis).
 */
function favorableSlots(
  ctx: SimContext,
  side: number,
  cells: FrontCell[],
  count: number,
  depth: number,
  entrenched: Map<number, number>,
  weight: WeightFn = frontWeight,
): LonLat[] {
  if (count <= 0 || cells.length === 0) return []
  const { grid } = ctx
  const cum = cumulativeWeights(ctx, cells, weight)
  const out: LonLat[] = []
  for (let k = 0; k < count; k++) {
    const lo = indexAtShare(cum, k / count)
    const hi = k === count - 1 ? cells.length : Math.max(lo + 1, indexAtShare(cum, (k + 1) / count))
    const center = indexAtShare(cum, (k + 0.5) / count)
    const half = Math.max(1, (hi - lo) / 2)
    let best = -1
    let bestScore = -Infinity
    for (let q = lo; q < hi && q < cells.length; q++) {
      const c = cells[q]
      if (!c) continue
      const { cell, value } = postValue(ctx, side, c, depth, entrenched)
      const score = value * (1 - (OFF_CENTER_PENALTY * Math.abs(q - center)) / half)
      if (score > bestScore) {
        bestScore = score
        best = cell
      }
    }
    if (best >= 0) out.push([grid.lonOf(best), grid.latOf(best)])
  }
  return out
}

/** Deux points clés affichés sont distants d'au moins tant de km (un seul repère par ville ou nœud). */
const KEY_POINT_SPACING_KM = 15
/** Nombre maximal de points clés affichés pour une armée. */
const KEY_POINT_MAX = 80

/**
 * Points clés d'une portion de front, pour l'affichage : les plus importants d'abord (ville, passage et
 * nœud cumulés), un seul repère par endroit.
 */
export function frontKeyPoints(ctx: SimContext, cells: FrontCell[]): LonLat[] {
  const { grid } = ctx
  const ranked = cells
    .map((c) => {
      const k = keyPointKinds(ctx, c.cell)
      return { cell: c.cell, n: (k & 1) + ((k >> 1) & 1) + ((k >> 2) & 1) }
    })
    .filter((c) => c.n > 0)
    .sort((a, b) => b.n - a.n)
  const out: LonLat[] = []
  for (const { cell } of ranked) {
    const p: LonLat = [grid.lonOf(cell), grid.latOf(cell)]
    if (out.some((q) => distanceKm(p[0], p[1], q[0], q[1]) < KEY_POINT_SPACING_KM)) continue
    out.push(p)
    if (out.length >= KEY_POINT_MAX) break
  }
  return out
}

/** Percée sur un axe : les flancs sont couverts à moins de tant de km de l'axe déjà conquis. */
export const BREACH_CORRIDOR_KM = 30
/** Poids des cellules de front qui bordent la percée (flancs), par rapport au reste du front. */
export const BREACH_FLANK_FACTOR = 4

/**
 * Poids des cellules de front pour une armée en percée : celles qui bordent l'axe conquis (de `origin`
 * à la pointe `tip`) pèsent `BREACH_FLANK_FACTOR` fois plus, les postes s'y concentrent.
 */
export function breachWeight(origin: LonLat, tip: LonLat, base: WeightFn): WeightFn {
  return (ctx, cell) => {
    const p: LonLat = [ctx.grid.lonOf(cell), ctx.grid.latOf(cell)]
    const near = project(p, origin, tip).km <= BREACH_CORRIDOR_KM
    return base(ctx, cell) * (near ? BREACH_FLANK_FACTOR : 1)
  }
}

/** L'armée choisit ses postes selon le terrain quand sa posture est défensive. */
function picksFavorablePosts(army: ArmyState): boolean {
  return army.posture === 'defensive' || army.posture === 'maxDefense'
}

/**
 * L'unité exécute un ordre direct du joueur, ou vient de le terminer à cette heure-ci : la répartition
 * automatique la laisse. Au-delà, l'ordre est oublié et l'armée la reprend.
 */
function underDirectOrder(ctx: SimContext, u: UnitState): boolean {
  if (!u.direct) return false
  if (u.direct.doneAt === undefined || u.direct.doneAt >= ctx.tick) return true
  delete u.direct
  return false
}

/**
 * Répartit les unités d'une armée le long de sa portion de front : unités de ligne juste derrière
 * le contact, artillerie, logistique et QG plus en arrière. Les unités en attaque ou en déroute sont laissées.
 * En posture défensive ou défense max, les unités de ligne prennent les postes les plus favorables de
 * leur secteur (voir `favorableSlots`) au lieu de postes régulièrement espacés.
 * `teleport` sert au déploiement initial.
 */
export function assignFront(ctx: SimContext, army: ArmyState, teleport = false): void {
  const side = sideIndex(ctx, army.owner)
  if (!army.front && !army.wholeFront) {
    army.frontLine = undefined
    delete army.keyPoints
    return
  }
  const cells = frontCells(ctx, side, army.wholeFront ? null : army.front)
  army.frontLine = traceFront(ctx, cells)
  // Mission « Tenir les points clés » : postes concentrés sur les villes, passages de fleuve et nœuds
  // routiers, simple écran ailleurs.
  const keyPoints = army.mission?.kind === 'keyPoints'
  let weight: WeightFn = keyPoints ? keyPointWeight : frontWeight
  // Mission « Percée sur un axe » : le groupe de choc attaque (missions.ts) ; le reste de l'armée tient
  // le front, renforcé de part et d'autre de la percée pour couvrir ses flancs.
  const breach = army.mission?.kind === 'breach' ? army.mission : null
  const shock = new Set(breach?.shockIds ?? [])
  if (breach) weight = breachWeight(breach.origin, breach.tip, frontWeight)
  if (keyPoints) army.keyPoints = frontKeyPoints(ctx, cells)
  else delete army.keyPoints
  if (cells.length === 0) return
  const members = army.unitIds
    .map((id) => ctx.units.get(id))
    .filter(
      (u): u is UnitState =>
        !!u &&
        !shock.has(u.id) &&
        !isOffensiveOrder(u.order.kind) &&
        !runtimeOf(ctx, u.id).routed &&
        // Unités parties riposter à une percée : elles reprennent leur poste ensuite.
        !runtimeOf(ctx, u.id).reaction &&
        // Unités sous ordre direct du joueur : reprises seulement après la fin de l'ordre.
        !underDirectOrder(ctx, u),
    )
  // Unités qui décrochent vers la ligne suivante : elles gardent leur poste réservé (sans ordre),
  // pour que leur départ ne décale pas les postes de toute l'armée.
  const withdrawing = (u: UnitState): boolean =>
    runtimeOf(ctx, u.id).stance?.decision === 'withdraw'
  const line = members.filter((u) => isLineUnit(u.kind))
  const rear = members.filter((u) => !isLineUnit(u.kind))

  /** Postes d'une ligne de `count` unités, à `depth` cellules derrière le contact. */
  const linePosts = (units: UnitState[], count: number, depth: number, favorable: boolean) => {
    if (!favorable) {
      // Seconde ligne et réserve : le recul contourne les obstacles.
      const back = deep ? deepBehind : behind
      return slots(ctx, cells, count, weight).map((slot) => back(ctx, side, slot, depth))
    }
    // Retranchement acquis : une unité installée garde la valeur de sa position.
    const entrenched = new Map<number, number>()
    for (const u of units) {
      const c = ctx.grid.cellAt(u.lon, u.lat)
      entrenched.set(c, Math.max(entrenched.get(c) ?? 0, u.entrench))
    }
    return favorableSlots(ctx, side, cells, count, depth, entrenched, weight)
  }

  /**
   * Place les unités sur une ou plusieurs lignes de postes (`layers` : nombre d'unités et profondeur de
   * chaque ligne ; une seule ligne pour toutes les unités par défaut).
   */
  const place = (
    units: UnitState[],
    depth: number,
    favorable = false,
    layers: Array<{ count: number; depth: number }> = [{ count: units.length, depth }],
  ): void => {
    const posts: LonLat[] = layers.flatMap((l) => linePosts(units, l.count, l.depth, favorable))
    // Chaque poste revient à l'unité la plus proche encore libre (paires triées par distance) :
    // une unité n'est jamais envoyée à l'autre bout du front quand un poste l'attend à côté.
    const pairs: Array<{ u: number; p: number; d: number }> = []
    units.forEach((u, ui) => {
      posts.forEach((p, pi) =>
        pairs.push({ u: ui, p: pi, d: distanceKm(u.lon, u.lat, p[0], p[1]) }),
      )
    })
    pairs.sort((x, y) => x.d - y.d)
    // Tolérance proportionnelle à l'écart entre postes : quand le front bouge un peu, les postes
    // glissent de quelques km ; les unités gardent alors le leur au lieu de tout recalculer.
    let spacing = 0
    for (let k = 1; k < posts.length; k++) {
      const a = posts[k - 1] as LonLat
      const b = posts[k] as LonLat
      spacing += distanceKm(a[0], a[1], b[0], b[1])
    }
    spacing /= Math.max(1, posts.length - 1)
    // Seulement sur les très grands fronts (carte du monde) ; les postes favorables, eux, sont choisis
    // un par un et doivent être suivis tels quels.
    const tolerance =
      !favorable && ctx.grid.size > LARGE_GRID_CELLS && spacing > WIDE_SPACING_KM
        ? Math.max(SLOT_TOLERANCE_KM, SLOT_TOLERANCE_SHARE * spacing)
        : SLOT_TOLERANCE_KM
    const unitDone = new Set<number>()
    const postDone = new Set<number>()
    for (const { u: ui, p: pi } of pairs) {
      if (unitDone.has(ui) || postDone.has(pi)) continue
      unitDone.add(ui)
      postDone.add(pi)
      const u = units[ui]
      const target = posts[pi]
      if (!u || !target || withdrawing(u)) continue
      if (teleport) {
        ;[u.lon, u.lat] = target
        u.order = { kind: 'front', target }
        u.path = []
        continue
      }
      const prev = u.order.kind === 'front' ? u.order.target : undefined
      const sameSlot = prev && distanceKm(prev[0], prev[1], target[0], target[1]) < tolerance
      // Même poste : on ne recalcule rien, sauf si l'unité est arrêtée loin de ce poste.
      const stuck =
        u.path.length === 0 && distanceKm(u.lon, u.lat, target[0], target[1]) > tolerance
      if (sameSlot && !stuck && !ctx.runtime.get(u.id)?.pathPending) continue
      u.order = { kind: 'front', target }
      if (ctx.grid.size > LARGE_GRID_CELLS) {
        // Carte du monde : chemin calculé plus tard, quelques-uns par tick (planQueuedPaths),
        // pour éviter un à-coup de plusieurs centaines de ms sur les grands fronts.
        u.path = []
        runtimeOf(ctx, u.id).pathPending = true
      } else {
        planPath(ctx, u, target)
      }
    }
  }
  const deep = army.mission?.kind === 'depth' || army.mission?.kind === 'reserve'
  const cellsFor = (km: number): number => Math.max(1, Math.round(km / (ctx.grid.cell * 111)))
  const mission = army.mission?.kind
  if (mission === 'reserve') {
    // Réserve : en retrait du front, prête à intervenir sur les percées (breakthrough.ts).
    const depth = Math.max(LINE_DEPTH + 1, cellsFor(RESERVE_KM))
    place(line, depth)
    place(rear, depth + 2)
    return
  }
  if (mission === 'depth' && line.length >= 2) {
    // Défense en profondeur : première ligne au contact, seconde ligne en arrière.
    const forward = Math.ceil(line.length * DEPTH_FORWARD_SHARE)
    place(line, LINE_DEPTH, picksFavorablePosts(army), [
      { count: forward, depth: LINE_DEPTH },
      { count: line.length - forward, depth: Math.max(LINE_DEPTH + 1, cellsFor(SECOND_LINE_KM)) },
    ])
    place(rear, Math.max(7, cellsFor(SECOND_LINE_KM) + 2))
    return
  }
  place(line, LINE_DEPTH, picksFavorablePosts(army))
  place(rear, 7)
}

/** Deux tronçons du front dont les extrémités sont plus proches que ça sont raccordés (fleuve, lac). */
const TRACE_JOIN_KM = 25
/** Tronçon plus court que ça (poche isolée à l'arrière) : non tracé, sauf s'il est le seul. */
const TRACE_MIN_CELLS = 6
/** Nombre de points visé pour l'ensemble du tracé. */
const TRACE_POINTS = 160

/** Plus court chemin (8-voisinage) entre `from` et la cellule du groupe la plus éloignée. */
function farthestPath(grid: SimContext['grid'], group: Set<number>, from: number): number[] {
  const W = grid.width
  const parent = new Map<number, number>([[from, -1]])
  const queue = [from]
  let last = from
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q] as number
    last = i
    const x = i % W
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        if (x + dx < 0 || x + dx >= W) continue
        const n = i + dy * W + dx
        if (!group.has(n) || parent.has(n)) continue
        parent.set(n, i)
        queue.push(n)
      }
    }
  }
  const path: number[] = []
  for (let i = last; i !== -1; i = parent.get(i) ?? -1) path.push(i)
  return path
}

/** Retire les pointes : un point où le tracé repart presque sur ses pas (dent de scie d'une cellule). */
function withoutSpikes(line: LonLat[]): LonLat[] {
  const out = [...line]
  for (let i = 1; i + 1 < out.length;) {
    const [p0, p1, p2] = [out[i - 1] as LonLat, out[i] as LonLat, out[i + 1] as LonLat]
    const ax = p1[0] - p0[0]
    const ay = p1[1] - p0[1]
    const bx = p2[0] - p1[0]
    const by = p2[1] - p1[1]
    const cos = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1)
    if (cos < -0.5) {
      out.splice(i, 1)
      if (i > 1) i--
    } else i++
  }
  return out
}

/**
 * Tracé du front (pour l'affichage) : les cellules de front sont regroupées par contiguïté ; chaque
 * groupe donne la chaîne la plus longue qui le traverse (sans les éperons des zones épaisses), placée
 * sur la ligne de contact (demi-cellule vers l'ennemi) puis lissée. Les tronçons proches sont raccordés,
 * les petites poches isolées ignorées.
 */
export function traceFront(ctx: SimContext, cells: FrontCell[]): LonLat[][] {
  if (cells.length === 0) return []
  const { grid } = ctx
  const W = grid.width
  const byCell = new Map(cells.map((c) => [c.cell, c]))
  const left = new Set(byCell.keys())

  // Chaînes : une par groupe de cellules contiguës.
  const chains: number[][] = []
  while (left.size > 0) {
    const seed = left.values().next().value as number
    const group = new Set<number>([seed])
    const queue = [seed]
    left.delete(seed)
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q] as number
      const x = i % W
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (x + dx < 0 || x + dx >= W) continue
          const n = i + dy * W + dx
          if (!left.has(n)) continue
          left.delete(n)
          group.add(n)
          queue.push(n)
        }
      }
    }
    const end = farthestPath(grid, group, seed)[0] as number
    chains.push(farthestPath(grid, group, end))
  }

  // Points sur la ligne de contact, orientés comme la portion (t croissant).
  const point = (i: number): LonLat => {
    const back = byCell.get(i)?.back ?? [0, 0]
    return [grid.lonOf(i) - (back[0] * grid.cell) / 2, grid.latOf(i) - (back[1] * grid.cell) / 2]
  }
  let lines = chains.map((chain) => {
    const first = byCell.get(chain[0] as number)?.t ?? 0
    const last = byCell.get(chain[chain.length - 1] as number)?.t ?? 0
    return (first <= last ? chain : [...chain].reverse()).map(point)
  })

  // Raccord des tronçons dont les extrémités se touchent presque, le plus proche d'abord.
  const ends = (l: LonLat[]): [LonLat, LonLat] => [l[0] as LonLat, l[l.length - 1] as LonLat]
  for (;;) {
    let best: { a: number; b: number; flipA: boolean; flipB: boolean; d: number } | null = null
    for (let a = 0; a < lines.length; a++) {
      for (let b = a + 1; b < lines.length; b++) {
        const [a0, a1] = ends(lines[a] as LonLat[])
        const [b0, b1] = ends(lines[b] as LonLat[])
        const options: Array<[boolean, boolean, LonLat, LonLat]> = [
          [false, false, a1, b0],
          [false, true, a1, b1],
          [true, false, a0, b0],
          [true, true, a0, b1],
        ]
        for (const [flipA, flipB, p, q] of options) {
          const d = distanceKm(p[0], p[1], q[0], q[1])
          if (d < TRACE_JOIN_KM && (!best || d < best.d)) best = { a, b, flipA, flipB, d }
        }
      }
    }
    if (!best) break
    const la = lines[best.a] as LonLat[]
    const lb = lines[best.b] as LonLat[]
    const joined = [
      ...(best.flipA ? [...la].reverse() : la),
      ...(best.flipB ? [...lb].reverse() : lb),
    ]
    lines = lines.filter((_, k) => k !== best.a && k !== best.b)
    lines.push(joined)
  }

  // Poches isolées : ignorées face aux vrais secteurs.
  const longest = Math.max(...lines.map((l) => l.length))
  lines = lines.filter((l) => l.length > 1 && (l.length >= TRACE_MIN_CELLS || l.length === longest))

  // Lissage (moyenne glissante sur 5 points, extrémités conservées) puis échantillonnage.
  const total = lines.reduce((s, l) => s + l.length, 0)
  const step = Math.max(1, Math.round(total / TRACE_POINTS))
  return lines
    .map((l) => {
      const smooth = l.map((p, k): LonLat => {
        const r = Math.min(2, k, l.length - 1 - k)
        let lon = 0
        let lat = 0
        for (let j = k - r; j <= k + r; j++) {
          lon += (l[j] as LonLat)[0]
          lat += (l[j] as LonLat)[1]
        }
        return [lon / (2 * r + 1), lat / (2 * r + 1)]
      })
      const out = smooth.filter((_, k) => k % step === 0)
      const tail = smooth[smooth.length - 1] as LonLat
      if (out[out.length - 1] !== tail) out.push(tail)
      return withoutSpikes(out)
    })
    .sort((x, y) => y.length - x.length)
}

/**
 * Accroche les extrémités d'une portion tracée par le joueur aux cellules de front les plus proches,
 * pour que la portion suive le front réel.
 */
export function snapToFront(
  ctx: SimContext,
  side: number,
  segment: [LonLat, LonLat],
): [LonLat, LonLat] {
  const cells = frontCells(ctx, side, null)
  const snap = (p: LonLat): LonLat => {
    let best: LonLat = p
    let bestD = 150
    for (const c of cells) {
      const q: LonLat = [ctx.grid.lonOf(c.cell), ctx.grid.latOf(c.cell)]
      const d = distanceKm(p[0], p[1], q[0], q[1])
      if (d < bestD) {
        bestD = d
        best = q
      }
    }
    return best
  }
  return [snap(segment[0]), snap(segment[1])]
}

function nearestT(ctx: SimContext, cells: FrontCell[], u: UnitState): number {
  let best = 0
  let bestD = Infinity
  const step = Math.max(1, Math.floor(cells.length / 200))
  for (let k = 0; k < cells.length; k += step) {
    const c = cells[k]
    if (!c) continue
    const d = distanceKm(u.lon, u.lat, ctx.grid.lonOf(c.cell), ctx.grid.latOf(c.cell))
    if (d < bestD) {
      bestD = d
      best = c.t
    }
  }
  return best
}

/**
 * Lance l'offensive planifiée d'une armée : les unités de ligne attaquent vers la pointe de la flèche,
 * réparties sur sa largeur ; l'artillerie avance jusqu'au tiers de la flèche pour rester à portée.
 */
export function launchOffensive(ctx: SimContext, army: ArmyState): void {
  const off = army.offensive
  if (!off || off.launched) return
  const chosen = off.unitIds ? new Set(off.unitIds) : null
  const members = army.unitIds
    .filter((id) => !chosen || chosen.has(id))
    .map((id) => ctx.units.get(id))
    .filter((u): u is UnitState => !!u && !runtimeOf(ctx, u.id).routed)
  // Unités choisies : toutes participent (y compris hors ligne) ; sinon les unités de ligne.
  const line = chosen
    ? members.filter((u) => u.kind !== 'art')
    : members.filter((u) => isLineUnit(u.kind))
  const [fx, fy] = off.from
  const [tx, ty] = off.to
  // Perpendiculaire à la flèche, normalisée en degrés approximatifs.
  const len = Math.hypot(tx - fx, ty - fy) || 1
  const px = -(ty - fy) / len
  const py = (tx - fx) / len
  const spread = 0.12
  line.forEach((u, k) => {
    const offset = (k - (line.length - 1) / 2) * spread
    const target: LonLat = [tx + px * offset, ty + py * offset]
    u.order = { kind: 'attack', target }
    planPath(ctx, u, target)
  })
  for (const u of members.filter((m) => m.kind === 'art')) {
    const target: LonLat = [fx + (tx - fx) * 0.33, fy + (ty - fy) * 0.33]
    u.order = { kind: 'move', target }
    planPath(ctx, u, target)
  }
  off.launched = true
  ctx.log(`${army.name} lance son offensive`, army.owner)
}

/** Une fois que plus aucune unité n'attaque, l'offensive est terminée et l'armée revient à son front. */
export function updateArmies(ctx: SimContext): void {
  for (const army of ctx.armies.values()) {
    army.unitIds = army.unitIds.filter((id) => ctx.units.has(id))
    // Missions « Avancer » et « Retraite ordonnée » : les unités suivent leur ligne (voir missions.ts),
    // pas le front. En percée, seul le groupe de choc attaque : le reste de l'armée garde son front.
    if (army.mission?.kind === 'advance' || army.mission?.kind === 'retreat') continue
    if (army.offensive?.launched) {
      const attacking = army.unitIds.some((id) => ctx.units.get(id)?.order.kind === 'attack')
      if (!attacking) {
        army.offensive = null
        ctx.log(`${army.name} termine son offensive`, army.owner)
      } else continue
    }
    if (army.front || army.wholeFront) assignFront(ctx, army)
  }
}
