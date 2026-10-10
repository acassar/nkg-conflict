import { countryName, runtimeOf, sideIndex, type SimContext } from '../context'
import type {
  AdvanceGoal,
  AdvanceMission,
  ArmyState,
  BreachMission,
  LonLat,
  LineMissionKind,
  MissionKind,
  RetreatGoal,
  RetreatMission,
  UnitState,
} from '../core/types'
import { distanceKm } from '../theater/grid'
import { isLineUnit } from '../units/catalog'
import {
  assignFront,
  frontCells,
  LARGE_GRID_CELLS,
  snapToFront,
  traceFront,
  type FrontCell,
} from './armies'
import { planPath } from './movement'

/** Une unité est à son poste en deçà de cette distance. */
const REACH_KM = 10
/** Avance maximale d'une unité sur ses voisines du tracé (ligne continue, pas de pointe isolée). */
const LEAD_KM = 20
/** Longueur d'un bond en posture défensive. */
const BOND_KM = 25
/** Un bond dure au plus tant d'heures ; l'arrêt pour se retrancher, au plus tant. */
const BOND_MAX_TICKS = 72
const DIG_MAX_TICKS = 48
/** Retranchement moyen visé à chaque arrêt avant le bond suivant. */
const DIG_ENTRENCH = 0.35
/** Tout le tracé est tenu : la mission s'achève quand les unités sont à leur poste, ou après ce délai. */
const REACHED_GRACE_TICKS = 48
/** Les unités d'appui suivent la ligne : à plus de tant de la plus proche, elles la rejoignent. */
const REAR_FOLLOW_KM = 30
const REAR_GAP_KM = 12
/** Frontière visée : on garde les portions à moins de tant de km au-delà de la plus proche de l'armée. */
const BORDER_SPAN_KM = 300
/** Un objectif ponctuel devient une courte ligne face à l'armée : demi-largeur minimale, et par unité. */
const OBJECTIVE_HALF_KM = 10
const OBJECTIVE_KM_PER_UNIT = 4

/** Mission en cours d'une armée : l'encerclement prime, sinon « Tenir » par défaut. */
export function missionKind(army: ArmyState): MissionKind {
  if (army.encirclement) return 'encircle'
  return army.mission?.kind ?? 'hold'
}

/** Mission « Avancer » d'une armée, s'il y en a une. */
export function advanceOf(army: ArmyState): AdvanceMission | null {
  return army.mission?.kind === 'advance' ? army.mission : null
}

/** Unités d'une armée disponibles pour sa mission (ni en déroute, ni en riposte, ni sous ordre direct). */
function missionUnits(ctx: SimContext, army: ArmyState): UnitState[] {
  return army.unitIds
    .map((id) => ctx.units.get(id))
    .filter((u): u is UnitState => {
      if (!u) return false
      const rt = runtimeOf(ctx, u.id)
      if (rt.routed || rt.reaction) return false
      if (u.direct) {
        // Ordre direct du joueur : l'unité est laissée jusqu'à la fin de l'ordre (comme pour le front).
        if (u.direct.doneAt === undefined || u.direct.doneAt >= ctx.tick) return false
        delete u.direct
      }
      return true
    })
}

function centroid(units: UnitState[]): LonLat | null {
  if (units.length === 0) return null
  let lon = 0
  let lat = 0
  for (const u of units) {
    lon += u.lon
    lat += u.lat
  }
  return [lon / units.length, lat / units.length]
}

/**
 * Cellules praticables le long d'une ligne brisée, dans l'ordre, sans doublon. Les cellules d'un pays
 * tiers (frontière fermée) sont écartées.
 */
function rasterize(ctx: SimContext, side: number, points: LonLat[]): number[] {
  const { grid } = ctx
  const out: number[] = []
  const seen = new Set<number>()
  const cellKm = grid.cell * 111
  const push = (lon: number, lat: number): void => {
    const c = grid.cellAt(lon, lat)
    if (c < 0 || seen.has(c) || !grid.passable(c)) return
    const o = grid.owner[c] ?? 0
    if (o !== 0 && o !== side && !ctx.matrix.hostile(side, o)) return
    seen.add(c)
    out.push(c)
  }
  if (points.length === 1) {
    const p = points[0] as LonLat
    push(p[0], p[1])
  }
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1] as LonLat
    const b = points[k] as LonLat
    const steps = Math.max(1, Math.ceil(distanceKm(a[0], a[1], b[0], b[1]) / (cellKm / 2)))
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      push(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
    }
  }
  return out
}

/**
 * Frontière avec le pays `country`, cellules encore à prendre par le camp, par ordre de préférence :
 * 1. son propre territoire national qui touche ce pays (reprendre le terrain perdu) ;
 * 2. si ce pays est un ennemi, son territoire qui touche un pays tiers (le traverser jusqu'à sa frontière) ;
 * 3. le territoire d'un ennemi qui touche ce pays (traverser l'ennemi pour l'atteindre).
 * Seules les portions proches de l'armée sont gardées.
 */
function borderCells(ctx: SimContext, side: number, country: number, from: LonLat): number[] {
  const { grid } = ctx
  const { width: W, height: H, owner } = grid
  const home = ctx.homeOwner
  const own: number[] = []
  const across: number[] = []
  const enemy: number[] = []
  const hostileTarget = ctx.matrix.hostile(side, country)
  for (let i = 0; i < grid.size; i++) {
    const h = home[i] ?? 0
    if (h === 0 || owner[i] === side) continue
    if (h !== side && !ctx.matrix.hostile(side, h)) continue
    const x = i % W
    const n0 = x > 0 ? (home[i - 1] ?? 0) : 0
    const n1 = x < W - 1 ? (home[i + 1] ?? 0) : 0
    const n2 = i >= W ? (home[i - W] ?? 0) : 0
    const n3 = i < (H - 1) * W ? (home[i + W] ?? 0) : 0
    if (h === country) {
      // Frontière extérieure du pays ennemi visé : voisin d'un pays tiers.
      if (!hostileTarget) continue
      const third = (n: number): boolean => n !== 0 && n !== country && n !== side
      if (!(third(n0) || third(n1) || third(n2) || third(n3))) continue
      if (grid.passable(i)) across.push(i)
      continue
    }
    if (n0 !== country && n1 !== country && n2 !== country && n3 !== country) continue
    if (!grid.passable(i)) continue
    ;(h === side ? own : enemy).push(i)
  }
  const cells = own.length > 0 ? own : across.length > 0 ? across : enemy
  return nearAndOrdered(ctx, cells, from)
}

/** Portions de ligne proches de `from` (à moins de BORDER_SPAN_KM au-delà de la plus proche), ordonnées. */
function nearAndOrdered(ctx: SimContext, cells: number[], from: LonLat): number[] {
  const { grid } = ctx
  if (cells.length === 0) return []
  const dist = (c: number): number => distanceKm(from[0], from[1], grid.lonOf(c), grid.latOf(c))
  const nearest = Math.min(...cells.map(dist))
  const kept = cells.filter((c) => dist(c) <= nearest + BORDER_SPAN_KM)
  // Ordre le long de la frontière : selon l'axe de plus grande étendue.
  let [lonMin, lonMax, latMin, latMax] = [Infinity, -Infinity, Infinity, -Infinity]
  for (const c of kept) {
    lonMin = Math.min(lonMin, grid.lonOf(c))
    lonMax = Math.max(lonMax, grid.lonOf(c))
    latMin = Math.min(latMin, grid.latOf(c))
    latMax = Math.max(latMax, grid.latOf(c))
  }
  const byLon =
    (lonMax - lonMin) * Math.cos((((latMin + latMax) / 2) * Math.PI) / 180) > latMax - latMin
  return kept.sort((a, b) =>
    byLon ? grid.lonOf(a) - grid.lonOf(b) : grid.latOf(b) - grid.latOf(a),
  )
}

/** Objectif ponctuel : courte ligne perpendiculaire à l'approche de l'armée, centrée sur le point. */
function objectiveLine(point: LonLat, from: LonLat | null, lineCount: number): LonLat[] {
  const half = Math.max(OBJECTIVE_HALF_KM, OBJECTIVE_KM_PER_UNIT * lineCount)
  const cos = Math.cos((point[1] * Math.PI) / 180) || 1
  // Direction d'approche en km, puis perpendiculaire.
  let dx = from ? (point[0] - from[0]) * cos : 1
  let dy = from ? point[1] - from[1] : 0
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) {
    dx = 1
    dy = 0
  } else {
    dx /= len
    dy /= len
  }
  const px = -dy
  const py = dx
  const kmDeg = half / 111
  return [
    [point[0] - (px * kmDeg) / cos, point[1] - py * kmDeg],
    [point[0] + (px * kmDeg) / cos, point[1] + py * kmDeg],
  ]
}

/** Tracé d'affichage d'une suite de cellules ordonnées. */
function traceCells(ctx: SimContext, cells: number[]): LonLat[][] {
  const fc: FrontCell[] = cells.map((cell, k) => ({
    cell,
    t: k / Math.max(1, cells.length - 1),
    back: [0, 0],
  }))
  return traceFront(ctx, fc)
}

/**
 * Lance la mission « Avancer » d'une armée. Renvoie un message d'erreur pour l'interface, ou null.
 * `parentArmyId` : groupe détaché d'une armée, qu'il rejoint à la fin.
 */
export function startAdvance(
  ctx: SimContext,
  army: ArmyState,
  goal: AdvanceGoal,
  parentArmyId?: number | null,
): string | null {
  const side = sideIndex(ctx, army.owner)
  const units = army.unitIds.map((id) => ctx.units.get(id)).filter((u): u is UnitState => !!u)
  const from = centroid(units)
  const lineCount = units.filter((u) => isLineUnit(u.kind)).length
  let cells: number[]
  let line: LonLat[][]
  let label: string
  if (goal.kind === 'border') {
    const target = sideIndex(ctx, goal.country)
    if (target <= 0) return 'Pays introuvable'
    if (target === side) return 'Choisissez un pays voisin, pas le vôtre'
    cells = from ? borderCells(ctx, side, target, from) : []
    label = `frontière avec ${countryName(ctx, goal.country)}`
    if (cells.length === 0) return `Rien à prendre jusqu'à la ${label}`
    line = traceCells(ctx, cells)
  } else {
    const points =
      goal.kind === 'line' ? goal.points : objectiveLine(goal.point, from, Math.max(1, lineCount))
    if (points.length === 0) return 'Tracé vide'
    cells = rasterize(ctx, side, points)
    label = goal.kind === 'line' ? 'trait tracé' : 'objectif'
    if (cells.length === 0) return 'Tracé hors du terrain praticable'
    line = [points.map((p): LonLat => [p[0], p[1]])]
  }
  if (lineCount === 0) return `${army.name} n'a pas d'unité de ligne pour avancer`
  // L'avance remplace l'offensive planifiée ; les unités qui attaquaient reprennent la nouvelle mission.
  army.offensive = null
  delete army.keyPoints
  army.mission = {
    kind: 'advance',
    goal,
    label,
    cells,
    line,
    startTick: ctx.tick,
    progress: 0,
    phase: 'moving',
    phaseTick: ctx.tick,
    parentArmyId: parentArmyId ?? undefined,
  }
  for (const u of units) {
    if (u.order.kind === 'attack' || u.order.kind === 'front') {
      u.order = { kind: 'hold' }
      u.path = []
    }
  }
  updateAdvance(ctx, army, army.mission, true)
  ctx.log(`${army.name} avance jusqu'au ${label === 'objectif' ? 'point visé' : label}`, army.owner)
  return null
}

/** Message du journal au passage à une mission de ligne. */
const LINE_MISSION_LOG: Record<LineMissionKind, string> = {
  hold: 'tient sa ligne',
  keyPoints: 'tient les points clés du front',
  depth: 'organise une défense en profondeur',
  reserve: 'passe en réserve derrière le front',
}

/**
 * Retour à « Tenir », ou passage à une autre mission de ligne (`kind` : points clés, défense en
 * profondeur, réserve) : les unités en marche s'arrêtent et l'armée reprend son front, avec ses postes
 * répartis selon la mission.
 */
export function holdMission(
  ctx: SimContext,
  army: ArmyState,
  kind: LineMissionKind = 'hold',
): void {
  // Avance, percée ou retraite en cours : les unités en marche s'arrêtent avant de reprendre le front.
  const wasAdvance =
    !!advanceOf(army) || army.mission?.kind === 'breach' || army.mission?.kind === 'retreat'
  const changed = (army.mission?.kind ?? 'hold') !== kind
  army.mission = kind === 'hold' ? undefined : { kind }
  if (changed && kind !== 'hold') ctx.log(`${army.name} ${LINE_MISSION_LOG[kind]}`, army.owner)
  if (!wasAdvance) {
    // Nouvelle répartition des postes tout de suite (sinon à la répartition suivante).
    if (changed && (army.front || army.wholeFront)) assignFront(ctx, army)
    else if (kind !== 'keyPoints') delete army.keyPoints
    return
  }
  for (const id of army.unitIds) {
    const u = ctx.units.get(id)
    if (!u || u.direct || runtimeOf(ctx, u.id).reaction) continue
    if (u.order.kind === 'attack' || u.order.kind === 'move') {
      u.order = { kind: 'hold' }
      u.path = []
    }
  }
  if (army.front || army.wholeFront) assignFront(ctx, army)
}

/**
 * Fin d'une avance : un groupe détaché rejoint son armée ; une armée tient la ligne atteinte.
 */
function finishAdvance(ctx: SimContext, army: ArmyState, m: AdvanceMission): void {
  const { grid } = ctx
  ctx.log(`${army.name} a atteint son but (${m.label})`, army.owner)
  army.mission = undefined
  const parent =
    m.parentArmyId !== undefined && m.parentArmyId !== null
      ? ctx.armies.get(m.parentArmyId)
      : undefined
  if (parent && parent !== army) {
    for (const id of army.unitIds) {
      const u = ctx.units.get(id)
      if (!u) continue
      u.armyId = parent.id
      if (parent.posture) u.posture = parent.posture
      parent.unitIds.push(id)
    }
    ctx.armies.delete(army.id)
    ctx.log(`${army.name} rejoint ${parent.name}`, army.owner)
    if (parent.front || parent.wholeFront) assignFront(ctx, parent)
    return
  }
  // L'armée tient la ligne atteinte : portion de front accrochée aux extrémités du tracé si le front est
  // proche (150 km au plus), sinon elle reste sur place, sans front.
  army.wholeFront = false
  army.front = null
  if (m.cells.length > 1) {
    const a = m.cells[0] as number
    const b = m.cells[m.cells.length - 1] as number
    const ends: [LonLat, LonLat] = [
      [grid.lonOf(a), grid.latOf(a)],
      [grid.lonOf(b), grid.latOf(b)],
    ]
    const snapped = snapToFront(ctx, sideIndex(ctx, army.owner), ends)
    const moved = (k: 0 | 1): boolean =>
      snapped[k][0] !== ends[k][0] || snapped[k][1] !== ends[k][1]
    if (moved(0) && moved(1)) army.front = snapped
  }
  if (army.front || army.wholeFront) assignFront(ctx, army)
}

/** Point à `km` de `u` sur la droite qui mène à `to` (ou `to` lui-même s'il est plus près). */
function toward(u: UnitState, to: LonLat, km: number): LonLat {
  const d = distanceKm(u.lon, u.lat, to[0], to[1])
  if (d <= km) return to
  const t = km / d
  return [u.lon + (to[0] - u.lon) * t, u.lat + (to[1] - u.lat) * t]
}

/**
 * Ordre d'attaque (ou de déplacement) vers `target`, recalculé seulement si la cible a bougé de plus de
 * `tolerance` km ou si l'unité est arrêtée.
 */
function orderTo(
  ctx: SimContext,
  u: UnitState,
  target: LonLat,
  kind: 'attack' | 'move' | 'retreat' = 'attack',
  tolerance = 5,
): void {
  const prev = u.order.kind === kind ? u.order.target : undefined
  const same = prev && distanceKm(prev[0], prev[1], target[0], target[1]) < tolerance
  const rt = runtimeOf(ctx, u.id)
  if (same && (u.path.length > 0 || rt.engagedWith !== null || rt.pathPending)) return
  u.order = { kind, target }
  if (ctx.grid.size > LARGE_GRID_CELLS) {
    // Carte du monde : chemins étalés sur plusieurs ticks (planQueuedPaths).
    u.path = []
    rt.pathPending = true
  } else {
    planPath(ctx, u, target)
  }
}

function halt(u: UnitState): void {
  if (u.order.kind === 'attack' || u.order.kind === 'move') {
    u.order = { kind: 'hold' }
    u.path = []
  }
}

/** Rayon (en cellules) dans lequel une cellule ennemie met l'unité « au contact » de l'ennemi. */
const CONTACT_CELLS = 3

/** L'unité est en territoire ennemi, ou à quelques cellules de lui. */
function nearEnemy(ctx: SimContext, side: number, u: UnitState): boolean {
  const { grid } = ctx
  const c = grid.cellAt(u.lon, u.lat)
  if (c < 0) return false
  const x0 = c % grid.width
  const y0 = Math.floor(c / grid.width)
  for (let dy = -CONTACT_CELLS; dy <= CONTACT_CELLS; dy++) {
    for (let dx = -CONTACT_CELLS; dx <= CONTACT_CELLS; dx++) {
      if (!grid.inBounds(x0 + dx, y0 + dy)) continue
      const o = grid.owner[grid.index(x0 + dx, y0 + dy)] ?? 0
      if (o !== 0 && o !== side && ctx.matrix.hostile(side, o)) return true
    }
  }
  return false
}

/** Postes répartis régulièrement le long du tracé, un par unité de ligne. */
function posts(ctx: SimContext, cells: number[], count: number): LonLat[] {
  const out: LonLat[] = []
  for (let k = 0; k < count && cells.length > 0; k++) {
    const q = Math.min(cells.length - 1, Math.floor(((k + 0.5) / count) * cells.length))
    const c = cells[q] as number
    out.push([ctx.grid.lonOf(c), ctx.grid.latOf(c)])
  }
  return out
}

/** Une étape de la mission « Avancer » (toutes les 6 heures). `fresh` : lancement de la mission. */
export function updateAdvance(
  ctx: SimContext,
  army: ArmyState,
  m: AdvanceMission,
  fresh = false,
): void {
  const side = sideIndex(ctx, army.owner)
  const owner = ctx.grid.owner
  let held = 0
  for (const c of m.cells) if (owner[c] === side) held++
  m.progress = m.cells.length ? held / m.cells.length : 1

  const units = missionUnits(ctx, army)
  const line = units.filter((u) => isLineUnit(u.kind))
  const rear = units.filter((u) => !isLineUnit(u.kind))
  if (army.unitIds.every((id) => !ctx.units.has(id))) return

  // Chaque poste revient à l'unité la plus proche encore libre ; l'ordre des postes suit le tracé.
  const ps = posts(ctx, m.cells, line.length)
  const pairs: Array<{ u: number; p: number; d: number }> = []
  line.forEach((u, ui) =>
    ps.forEach((p, pi) => pairs.push({ u: ui, p: pi, d: distanceKm(u.lon, u.lat, p[0], p[1]) })),
  )
  pairs.sort((x, y) => x.d - y.d)
  const slot: Array<{ unit: UnitState; post: LonLat; d: number } | undefined> = []
  const unitDone = new Set<number>()
  for (const { u: ui, p: pi, d } of pairs) {
    if (unitDone.has(ui) || slot[pi]) continue
    unitDone.add(ui)
    slot[pi] = { unit: line[ui] as UnitState, post: ps[pi] as LonLat, d }
  }
  const assigned = slot.filter((s): s is { unit: UnitState; post: LonLat; d: number } => !!s)

  const allAtPost = assigned.every((s) => s.d <= REACH_KM)
  if (held === m.cells.length) {
    m.reachedTick ??= ctx.tick
    if (allAtPost || ctx.tick - m.reachedTick >= REACHED_GRACE_TICKS) {
      finishAdvance(ctx, army, m)
      return
    }
  } else m.reachedTick = undefined

  // Ligne continue : une unité qui a plus de LEAD_KM d'avance sur une voisine du tracé l'attend.
  // La règle ne vaut qu'au contact : une unité encore en marche d'approche, loin de l'ennemi, avance librement.
  const ahead = (k: number): boolean => {
    const s = assigned[k]
    if (!s) return false
    const prev = assigned[k - 1]?.d ?? -Infinity
    const next = assigned[k + 1]?.d ?? -Infinity
    return s.d < Math.max(prev, next) - LEAD_KM && nearEnemy(ctx, side, s.unit)
  }

  const byBonds = army.posture === 'defensive' || army.posture === 'maxDefense'
  if (byBonds) {
    if (m.phase === 'moving' && !fresh) {
      const moving = assigned.some(
        (s) =>
          s.unit.order.kind === 'attack' &&
          (s.unit.path.length > 0 || runtimeOf(ctx, s.unit.id).pathPending),
      )
      if (!moving || ctx.tick - m.phaseTick >= BOND_MAX_TICKS) {
        // Fin du bond : tout le monde s'arrête et se retranche.
        m.phase = 'digging'
        m.phaseTick = ctx.tick
        for (const s of assigned) halt(s.unit)
      }
    } else if (m.phase === 'digging') {
      const avg = assigned.reduce((a, s) => a + s.unit.entrench, 0) / Math.max(1, assigned.length)
      if (avg >= DIG_ENTRENCH || ctx.tick - m.phaseTick >= DIG_MAX_TICKS) {
        m.phase = 'moving'
        m.phaseTick = ctx.tick
        fresh = true
      }
    }
    if (m.phase === 'moving' && fresh) {
      // Nouveau bond : chacun avance d'au plus BOND_KM vers son poste, les unités en avance attendent.
      assigned.forEach((s, k) => {
        if (s.d <= REACH_KM || ahead(k)) halt(s.unit)
        else orderTo(ctx, s.unit, toward(s.unit, s.post, BOND_KM))
      })
    }
  } else {
    m.phase = 'moving'
    assigned.forEach((s, k) => {
      if (s.d <= REACH_KM) {
        if (s.unit.order.kind === 'attack' && s.unit.path.length === 0) halt(s.unit)
      } else if (ahead(k)) halt(s.unit)
      else orderTo(ctx, s.unit, s.post)
    })
  }

  // Appui (artillerie, logistique, QG) : suit la ligne à une douzaine de km en arrière.
  for (const u of rear) {
    let near: UnitState | null = null
    let best = Infinity
    for (const s of assigned) {
      const d = distanceKm(u.lon, u.lat, s.unit.lon, s.unit.lat)
      if (d < best) {
        best = d
        near = s.unit
      }
    }
    if (!near || best <= REAR_FOLLOW_KM) continue
    const t = best - REAR_GAP_KM
    const target: LonLat = [
      u.lon + ((near.lon - u.lon) * t) / best,
      u.lat + ((near.lat - u.lat) * t) / best,
    ]
    orderTo(ctx, u, target, 'move', 15)
  }
}

/** Suivi des missions « Avancer », « Percée sur un axe » et « Retraite ordonnée » (toutes les 6 heures). */
export function updateMissions(ctx: SimContext): void {
  for (const army of [...ctx.armies.values()]) {
    if (army.unitIds.every((id) => !ctx.units.has(id))) continue
    const m = advanceOf(army)
    if (m) updateAdvance(ctx, army, m)
    else if (army.mission?.kind === 'breach') updateBreach(ctx, army, army.mission)
    else if (army.mission?.kind === 'retreat') updateRetreat(ctx, army, army.mission)
  }
}

// ---------- Percée sur un axe ----------

/** Part des unités de ligne de l'armée engagées dans le groupe de choc. */
export const BREACH_SHOCK_SHARE = 0.5
/** Écart latéral entre les unités du groupe de choc (colonne serrée). */
export const BREACH_SPACING_KM = 4
/** Une unité du groupe qui devance de plus de tant la médiane du groupe, au contact, l'attend. */
const BREACH_LEAD_KM = 15
/** Point visé au-delà de tant de km du front : refusé. */
const BREACH_MAX_KM = 400

/** Repère local (km) autour de l'axe : abscisse le long de l'axe, ordonnée à gauche. */
function axisFrame(origin: LonLat, target: LonLat) {
  const cos = Math.cos((origin[1] * Math.PI) / 180) || 1
  const ex = (target[0] - origin[0]) * 111 * cos
  const ey = (target[1] - origin[1]) * 111
  const len = Math.hypot(ex, ey) || 1
  const ux = ex / len
  const uy = ey / len
  return {
    length: len,
    /** Coordonnées (le long de l'axe, à gauche de l'axe) d'un point, en km. */
    local(p: LonLat): [number, number] {
      const x = (p[0] - origin[0]) * 111 * cos
      const y = (p[1] - origin[1]) * 111
      return [x * ux + y * uy, -x * uy + y * ux]
    },
    /** Point de coordonnées locales (`s` le long de l'axe, `n` à gauche). */
    point(s: number, n: number): LonLat {
      const x = s * ux - n * uy
      const y = s * uy + n * ux
      return [origin[0] + x / (111 * cos), origin[1] + y / 111]
    },
  }
}

/**
 * Pointe de la percée : on suit l'axe depuis le départ tant que le terrain est tenu par le camp
 * (cellules impraticables ignorées). Renvoie le point atteint et la part de l'axe tenue.
 */
function breachTip(
  ctx: SimContext,
  side: number,
  m: BreachMission,
): { tip: LonLat; share: number } {
  const { grid } = ctx
  const frame = axisFrame(m.origin, m.target)
  const step = Math.max(1, (grid.cell * 111) / 2)
  let reached = 0
  for (let s = 0; s <= frame.length; s += step) {
    const p = frame.point(s, 0)
    const c = grid.cellAt(p[0], p[1])
    if (c < 0) break
    if (!grid.passable(c)) continue
    if (grid.owner[c] !== side) break
    reached = s
  }
  const c = grid.cellAt(m.target[0], m.target[1])
  if (c >= 0 && grid.owner[c] === side && reached >= frame.length - step * 2) reached = frame.length
  return { tip: frame.point(reached, 0), share: Math.min(1, reached / frame.length) }
}

/**
 * Lance la mission « Percée sur un axe » vers `target` : la moitié des unités de ligne, les plus proches
 * du point de départ sur le front, forment le groupe de choc ; le reste tient le front et couvre ses
 * flancs. Renvoie un message d'erreur pour l'interface, ou null.
 */
export function startBreach(ctx: SimContext, army: ArmyState, target: LonLat): string | null {
  const { grid } = ctx
  const side = sideIndex(ctx, army.owner)
  const c = grid.cellAt(target[0], target[1])
  if (c < 0 || !grid.passable(c)) return 'Point visé hors du terrain praticable'
  if (grid.owner[c] === side) return "Le point visé est déjà tenu : choisissez-le chez l'ennemi"
  const line = army.unitIds
    .map((id) => ctx.units.get(id))
    .filter((u): u is UnitState => !!u && isLineUnit(u.kind) && !runtimeOf(ctx, u.id).routed)
  if (line.length === 0) return `${army.name} n'a pas d'unité de ligne pour percer`
  // Départ : la cellule du front de l'armée la plus proche du point visé (à défaut, son centre).
  let origin = centroid(line) as LonLat
  const cells =
    army.front || army.wholeFront ? frontCells(ctx, side, army.wholeFront ? null : army.front) : []
  let best = Infinity
  for (const f of cells) {
    const d = distanceKm(grid.lonOf(f.cell), grid.latOf(f.cell), target[0], target[1])
    if (d < best) {
      best = d
      origin = [grid.lonOf(f.cell), grid.latOf(f.cell)]
    }
  }
  if (distanceKm(origin[0], origin[1], target[0], target[1]) > BREACH_MAX_KM) {
    return `Point visé trop loin du front (${BREACH_MAX_KM} km au plus)`
  }
  const count = line.length === 1 ? 1 : Math.ceil(line.length * BREACH_SHOCK_SHARE)
  const shock = [...line]
    .sort(
      (a, b) =>
        distanceKm(a.lon, a.lat, origin[0], origin[1]) -
        distanceKm(b.lon, b.lat, origin[0], origin[1]),
    )
    .slice(0, count)
  army.offensive = null
  delete army.keyPoints
  const m: BreachMission = {
    kind: 'breach',
    target: [target[0], target[1]],
    origin,
    shockIds: shock.map((u) => u.id),
    startTick: ctx.tick,
    tip: origin,
    progress: 0,
  }
  army.mission = m
  for (const u of shock) {
    if (u.direct) delete u.direct
    halt(u)
    if (u.order.kind === 'front') u.order = { kind: 'hold' }
  }
  ctx.log(`${army.name} lance une percée (${shock.length} unités de choc)`, army.owner)
  updateBreach(ctx, army, m)
  if (army.front || army.wholeFront) assignFront(ctx, army)
  return null
}

/** Fin d'une percée : le groupe de choc s'arrête et l'armée le reprend sur son front. */
function finishBreach(ctx: SimContext, army: ArmyState, m: BreachMission, text: string): void {
  ctx.log(`${army.name} ${text}`, army.owner)
  army.mission = undefined
  for (const id of m.shockIds) {
    const u = ctx.units.get(id)
    if (u && !u.direct) halt(u)
  }
  if (army.front || army.wholeFront) assignFront(ctx, army)
}

/** Une étape de la percée (toutes les 6 heures) : pointe, fin, ordres du groupe de choc. */
export function updateBreach(ctx: SimContext, army: ArmyState, m: BreachMission): void {
  const side = sideIndex(ctx, army.owner)
  m.shockIds = m.shockIds.filter((id) => ctx.units.has(id))
  const { tip, share } = breachTip(ctx, side, m)
  m.tip = tip
  m.progress = share
  const units = missionUnits(ctx, army).filter((u) => m.shockIds.includes(u.id))
  if (m.shockIds.length === 0) {
    finishBreach(ctx, army, m, 'arrête sa percée : groupe de choc détruit')
    return
  }
  const frame = axisFrame(m.origin, m.target)
  if (share >= 1) {
    m.reachedTick ??= ctx.tick
    const near = units.filter(
      (u) => distanceKm(u.lon, u.lat, m.target[0], m.target[1]) <= REACH_KM * 2,
    )
    if (near.length * 2 >= units.length || ctx.tick - m.reachedTick >= REACHED_GRACE_TICKS) {
      finishBreach(ctx, army, m, "a percé jusqu'au point visé")
      return
    }
  } else m.reachedTick = undefined
  if (units.length === 0) return
  // Colonne serrée sur l'axe : chaque unité garde son rang latéral (de gauche à droite).
  const placed = units
    .map((u) => ({ u, at: frame.local([u.lon, u.lat]) }))
    .sort((a, b) => b.at[1] - a.at[1])
  const along = placed.map((p) => p.at[0]).sort((a, b) => a - b)
  const median = along[Math.floor(along.length / 2)] ?? 0
  placed.forEach((p, k) => {
    const offset = ((placed.length - 1) / 2 - k) * BREACH_SPACING_KM
    // Une unité trop en avance du groupe, déjà chez l'ennemi, l'attend : le choc reste concentré.
    const c = ctx.grid.cellAt(p.u.lon, p.u.lat)
    const inside = c >= 0 && ctx.grid.owner[c] !== side
    if (inside && p.at[0] > median + BREACH_LEAD_KM && nearEnemy(ctx, side, p.u)) {
      halt(p.u)
      return
    }
    orderTo(ctx, p.u, frame.point(frame.length, offset))
  })
}

// ---------- Retraite ordonnée ----------

/** Longueur d'un bond de repli. */
export const RETREAT_BOND_KM = 20
/** Part des unités de ligne sur la ligne à partir de laquelle la retraite s'achève 48 h plus tard au plus. */
const RETREAT_DONE_SHARE = 0.85
/** Un bond dure au plus tant d'heures avant que l'autre échelon prenne le relais. */
const RETREAT_BOND_MAX_TICKS = 36

/** Frontière avec `country` pour une retraite : cellules tenues par le camp, voisines de ce pays. */
function retreatBorderCells(
  ctx: SimContext,
  side: number,
  country: number,
  from: LonLat,
): number[] {
  const { grid } = ctx
  const { width: W, height: H, owner } = grid
  const home = ctx.homeOwner
  const out: number[] = []
  for (let i = 0; i < grid.size; i++) {
    if (owner[i] !== side || !grid.passable(i)) continue
    const x = i % W
    const n0 = x > 0 ? (home[i - 1] ?? 0) : 0
    const n1 = x < W - 1 ? (home[i + 1] ?? 0) : 0
    const n2 = i >= W ? (home[i - W] ?? 0) : 0
    const n3 = i < (H - 1) * W ? (home[i + W] ?? 0) : 0
    if ((home[i] ?? 0) === country) continue
    if (n0 === country || n1 === country || n2 === country || n3 === country) out.push(i)
  }
  return nearAndOrdered(ctx, out, from)
}

/** Postes de la ligne attribués aux unités de ligne : chacune prend le plus proche encore libre. */
function retreatSlots(
  ctx: SimContext,
  cells: number[],
  line: UnitState[],
): Array<{ unit: UnitState; post: LonLat; d: number; rank: number }> {
  const ps = posts(ctx, cells, line.length)
  const pairs: Array<{ u: number; p: number; d: number }> = []
  line.forEach((u, ui) =>
    ps.forEach((p, pi) => pairs.push({ u: ui, p: pi, d: distanceKm(u.lon, u.lat, p[0], p[1]) })),
  )
  pairs.sort((x, y) => x.d - y.d)
  const out: Array<{ unit: UnitState; post: LonLat; d: number; rank: number }> = []
  const unitDone = new Set<number>()
  const postDone = new Set<number>()
  for (const { u: ui, p: pi, d } of pairs) {
    if (unitDone.has(ui) || postDone.has(pi)) continue
    unitDone.add(ui)
    postDone.add(pi)
    out.push({ unit: line[ui] as UnitState, post: ps[pi] as LonLat, d, rank: pi })
  }
  return out
}

/**
 * Lance la mission « Retraite ordonnée » vers un trait ou une frontière. Renvoie un message d'erreur pour
 * l'interface, ou null.
 */
export function startRetreat(ctx: SimContext, army: ArmyState, goal: RetreatGoal): string | null {
  const side = sideIndex(ctx, army.owner)
  const units = army.unitIds.map((id) => ctx.units.get(id)).filter((u): u is UnitState => !!u)
  const from = centroid(units)
  const lineCount = units.filter((u) => isLineUnit(u.kind)).length
  if (lineCount === 0 || !from) return `${army.name} n'a pas d'unité de ligne`
  let cells: number[]
  let line: LonLat[][]
  let label: string
  if (goal.kind === 'border') {
    const target = sideIndex(ctx, goal.country)
    if (target <= 0) return 'Pays introuvable'
    if (target === side) return 'Choisissez un pays voisin, pas le vôtre'
    label = `frontière avec ${countryName(ctx, goal.country)}`
    cells = retreatBorderCells(ctx, side, target, from)
    if (cells.length === 0) return `Aucune portion tenue le long de la ${label}`
    line = traceCells(ctx, cells)
  } else {
    if (goal.points.length < 2) return 'Tracé vide'
    // Ligne de repli : seulement le terrain tenu par le camp.
    cells = rasterize(ctx, side, goal.points).filter((c) => ctx.grid.owner[c] === side)
    label = 'trait tracé'
    if (cells.length === 0) return 'La ligne de repli doit passer par votre territoire'
    line = [goal.points.map((p): LonLat => [p[0], p[1]])]
  }
  army.offensive = null
  delete army.keyPoints
  const m: RetreatMission = {
    kind: 'retreat',
    goal,
    label,
    cells,
    line,
    startTick: ctx.tick,
    progress: 0,
    moving: 0,
    phaseTick: ctx.tick,
  }
  army.mission = m
  for (const u of units) {
    if (u.order.kind === 'attack' || u.order.kind === 'front' || u.order.kind === 'pursue') {
      u.order = { kind: 'hold' }
      u.path = []
    }
  }
  const to = goal.kind === 'border' ? `à la ${label}` : `au ${label}`
  ctx.log(`${army.name} se replie en ordre jusqu'${to}`, army.owner)
  updateRetreat(ctx, army, m, true)
  return null
}

/** Fin de la retraite : l'armée tient la ligne atteinte (accrochée au front s'il est proche). */
function finishRetreat(ctx: SimContext, army: ArmyState, m: RetreatMission): void {
  const { grid } = ctx
  ctx.log(`${army.name} a achevé sa retraite (${m.label})`, army.owner)
  army.mission = undefined
  army.wholeFront = false
  army.front = null
  if (m.cells.length > 1) {
    const a = m.cells[0] as number
    const b = m.cells[m.cells.length - 1] as number
    const ends: [LonLat, LonLat] = [
      [grid.lonOf(a), grid.latOf(a)],
      [grid.lonOf(b), grid.latOf(b)],
    ]
    const snapped = snapToFront(ctx, sideIndex(ctx, army.owner), ends)
    const moved = (k: 0 | 1): boolean =>
      snapped[k][0] !== ends[k][0] || snapped[k][1] !== ends[k][1]
    if (moved(0) && moved(1)) army.front = snapped
  }
  if (army.front) assignFront(ctx, army)
}

/**
 * Une étape de la retraite (toutes les 6 heures). Au contact de l'ennemi, les unités de ligne reculent
 * par bonds alternés : un échelon (rangs pairs ou impairs le long de la ligne) recule d'au plus
 * RETREAT_BOND_KM pendant que l'autre tient, puis les rôles s'inversent. Loin de l'ennemi, tout le monde
 * se replie d'une traite. L'appui rejoint la ligne tout de suite.
 */
export function updateRetreat(
  ctx: SimContext,
  army: ArmyState,
  m: RetreatMission,
  fresh = false,
): void {
  const side = sideIndex(ctx, army.owner)
  const units = missionUnits(ctx, army)
  const line = units.filter((u) => isLineUnit(u.kind))
  const rear = units.filter((u) => !isLineUnit(u.kind))
  const slots = retreatSlots(ctx, m.cells, line)
  const arrived = slots.filter((s) => s.d <= REACH_KM).length
  m.progress = slots.length ? arrived / slots.length : 1
  if (m.progress >= RETREAT_DONE_SHARE) m.closingTick ??= ctx.tick
  else m.closingTick = undefined
  const late = m.closingTick !== undefined && ctx.tick - m.closingTick >= REACHED_GRACE_TICKS
  if (slots.length > 0 && (arrived === slots.length || late)) {
    finishRetreat(ctx, army, m)
    return
  }
  // Seules les unités au contact reculent par bonds alternés ; les autres se replient d'une traite.
  const engaged = new Set(
    slots.filter((s) => s.d > REACH_KM && nearEnemy(ctx, side, s.unit)).map((s) => s.unit.id),
  )
  const contact = engaged.size > 0
  const echelon = (k: 0 | 1) =>
    slots.filter((s) => s.rank % 2 === k && s.d > REACH_KM && engaged.has(s.unit.id))
  if (contact && !fresh) {
    const movers = echelon(m.moving)
    const stopped = movers.every(
      (s) => s.unit.path.length === 0 && !runtimeOf(ctx, s.unit.id).pathPending,
    )
    if (stopped || ctx.tick - m.phaseTick >= RETREAT_BOND_MAX_TICKS) {
      // Bond achevé : l'autre échelon recule à son tour (s'il lui reste du chemin).
      const next = (1 - m.moving) as 0 | 1
      if (echelon(next).length > 0) {
        m.moving = next
        m.phaseTick = ctx.tick
        fresh = true
      }
    }
  }
  /** Arrêt d'une unité de la retraite (pas d'une unité en déroute, qui fuit le combat). */
  const stop = (u: UnitState): void => {
    halt(u)
    if (u.order.kind === 'retreat' && !runtimeOf(ctx, u.id).routed) {
      u.order = { kind: 'hold' }
      u.path = []
    }
  }
  for (const s of slots) {
    const u = s.unit
    if (s.d <= REACH_KM) {
      stop(u)
      continue
    }
    const inContact = engaged.has(u.id)
    if (inContact && s.rank % 2 !== m.moving) {
      // Échelon qui couvre : il tient sur place.
      stop(u)
      continue
    }
    const goal = inContact ? toward(u, s.post, RETREAT_BOND_KM) : s.post
    if (fresh || u.order.kind !== 'retreat') orderTo(ctx, u, goal, 'retreat', 8)
  }
  // Appui : rejoint directement le poste le plus proche sur la ligne.
  for (const u of rear) {
    let best: LonLat | null = null
    let bestD = Infinity
    for (const s of slots) {
      const d = distanceKm(u.lon, u.lat, s.post[0], s.post[1])
      if (d < bestD) {
        bestD = d
        best = s.post
      }
    }
    if (best && bestD > REACH_KM) orderTo(ctx, u, best, 'retreat', 15)
    else if (best) stop(u)
  }
}
