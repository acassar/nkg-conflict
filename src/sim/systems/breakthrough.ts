import { runtimeOf, sideIndex, type SimContext } from '../context'
import type { ArmyState, LonLat, UnitState } from '../core/types'
import { distanceKm } from '../theater/grid'
import { isLineUnit } from '../units/catalog'
import { nearestCity } from './ai'
import { planPath } from './movement'
import { snapToAxis } from './axes'
import { isHalted } from './restraint'

/** Rayon autour d'une unité ennemie pour juger si elle s'est enfoncée dans nos lignes. */
const SALIENT_RADIUS_KM = 25
/** Part de cellules de notre camp autour d'elle au-delà de laquelle c'est une percée. */
const SALIENT_SHARE = 0.55
/** Distance maximale entre une unité de l'armée et la percée pour qu'elle réagisse. */
export const REACT_KM = 60
/** Une unité retranchée au moins à ce niveau garde son poste. */
export const HOLD_ENTRENCH = 0.6
/** Unités envoyées au plus contre une même percée. */
const RESPONDERS_PER_BREACH = 2
/** Part des unités de ligne d'une armée qui peuvent réagir en même temps. */
const MAX_REACTING_SHARE = 1 / 5
/** Rapport de force pour une contre-attaque directe sur la pointe. */
const COUNTER_RATIO = 1.5
/** Rapport de force pour couper la base de la percée ; en dessous, on bloque. */
const CUT_RATIO = 1
/** Distance derrière la pointe où l'on coupe l'axe de la percée. */
const CUT_BEHIND_KM = 15
/** Distance devant la pointe où l'on se poste pour la bloquer. */
const BLOCK_AHEAD_KM = 12
/** Distance maximale entre le point de coupure et la route ou voie ferrée visée (axe de la percée). */
const CUT_AXIS_KM = 10

/** Armée en réserve : portée de son intervention, unités engagées par percée (toutes disponibles). */
const RESERVE_REACT_KM = 150
const RESERVE_RESPONDERS = 4

/** Durée maximale d'une réaction avant retour au poste. */
const REACTION_TICKS = 72

/** Réaction d'une unité à une percée : bloquer, couper la base ou contre-attaquer. */
export type ReactionKind = 'block' | 'cut' | 'counter'

export interface Reaction {
  kind: ReactionKind
  /** Unité ennemie qui a percé. */
  intruder: number
  /** Tour où la réaction prend fin au plus tard. */
  until: number
}

/** Réaction en cours d'une unité (absente si elle tient son poste). */
export function reactionOf(ctx: SimContext, id: number): Reaction | undefined {
  return ctx.runtime.get(id)?.reaction
}

/** Puissance offensive brute d'une unité. */
function punch(ctx: SimContext, u: UnitState): number {
  return ctx.catalog[u.kind].attack * u.strength * (0.25 + 0.75 * u.org)
}

/** Puissance défensive brute d'une unité. */
function guard(ctx: SimContext, u: UnitState): number {
  return ctx.catalog[u.kind].defense * u.strength * (0.25 + 0.75 * u.org)
}

/**
 * Une unité ennemie a-t-elle percé chez le camp `side` ? Oui si elle est sur une cellule de ce camp
 * (ou d'un allié), ou si ces cellules l'entourent en majorité (pointe d'un saillant).
 */
export function isBreach(ctx: SimContext, side: number, e: UnitState): boolean {
  const { grid, matrix } = ctx
  const here = grid.owner[grid.cellAt(e.lon, e.lat)] ?? 0
  if (here !== 0 && matrix.friendly(side, here)) return true
  let ours = 0
  let total = 0
  grid.cellsWithin(e.lon, e.lat, SALIENT_RADIUS_KM, (i) => {
    if (!grid.passable(i)) return
    total++
    const o = grid.owner[i] ?? 0
    if (o !== 0 && matrix.friendly(side, o)) ours++
  })
  return total > 0 && ours / total >= SALIENT_SHARE
}

/** Direction d'avance d'une unité (vers son objectif), normalisée en degrés ; null si elle n'avance pas. */
function heading(e: UnitState): LonLat | null {
  const t = e.order.target
  if (!t || (e.order.kind !== 'attack' && e.order.kind !== 'pursue' && e.order.kind !== 'move'))
    return null
  const dx = t[0] - e.lon
  const dy = t[1] - e.lat
  const len = Math.hypot(dx, dy)
  return len < 1e-6 ? null : [dx / len, dy / len]
}

/** Point à `km` de l'unité dans la direction `dir` (degrés approximatifs, longitude corrigée). */
function along(e: UnitState, dir: LonLat, km: number): LonLat {
  const deg = km / 111
  const cos = Math.max(0.2, Math.cos((e.lat * Math.PI) / 180))
  return [e.lon + (dir[0] * deg) / cos, e.lat + dir[1] * deg]
}

/** Fin des réactions dont la percée a disparu, qui ont expiré, ou dont l'attaque est terminée. */
function expire(ctx: SimContext): void {
  for (const [id, rt] of ctx.runtime) {
    const r = rt.reaction
    if (!r) continue
    const u = ctx.units.get(id)
    const e = ctx.units.get(r.intruder)
    const done =
      !u ||
      !e ||
      ctx.tick >= r.until ||
      runtimeOf(ctx, id).routed ||
      runtimeOf(ctx, e.id).routed ||
      (r.kind !== 'block' && u.order.kind !== 'attack') ||
      !isBreach(ctx, sideIndex(ctx, u.owner), e)
    if (!done) continue
    rt.reaction = undefined
    // Retour au poste à la prochaine répartition du front.
    if (u && !runtimeOf(ctx, id).routed && u.order.kind !== 'attack') u.order = { kind: 'hold' }
  }
}

/**
 * Riposte des armées aux percées, toutes les quelques heures. Pour chaque unité ennemie enfoncée
 * dans le secteur d'une armée, les unités de ligne les moins retranchées à portée réagissent selon
 * le rapport de force : contre-attaque sur la pointe, attaque de la base pour couper l'axe (et le
 * ravitaillement de la pointe), ou poste de blocage devant elle. Les unités bien retranchées gardent
 * leur poste.
 */
export function reactToBreakthroughs(ctx: SimContext): void {
  expire(ctx)
  const enemiesBySide = new Map<number, UnitState[]>()
  for (const army of ctx.armies.values()) {
    if ((!army.front && !army.wholeFront) || army.offensive?.launched) continue
    const side = sideIndex(ctx, army.owner)
    if (ctx.matrix.atWar[side] !== 1) continue
    let intruders = enemiesBySide.get(side)
    if (!intruders) {
      intruders = [...ctx.units.values()].filter(
        (e) =>
          isLineUnit(e.kind) &&
          ctx.matrix.hostile(side, sideIndex(ctx, e.owner)) &&
          !runtimeOf(ctx, e.id).routed &&
          isBreach(ctx, side, e),
      )
      enemiesBySide.set(side, intruders)
    }
    if (intruders.length > 0) reactInArmy(ctx, army, intruders)
  }
}

function reactInArmy(ctx: SimContext, army: ArmyState, intruders: UnitState[]): void {
  const reacting = (u: UnitState): Reaction | undefined => runtimeOf(ctx, u.id).reaction
  // Armée en réserve : toutes ses unités peuvent intervenir, plus loin, même retranchées.
  const reserve = army.mission?.kind === 'reserve'
  const reactKm = reserve ? RESERVE_REACT_KM : REACT_KM
  const perBreach = reserve ? RESERVE_RESPONDERS : RESPONDERS_PER_BREACH
  // Une armée en retraite ordonnée ne riposte pas : elle se replie.
  if (army.mission?.kind === 'retreat') return
  // Le groupe de choc d'une percée ne riposte pas : il garde son axe.
  const shock = new Set(army.mission?.kind === 'breach' ? army.mission.shockIds : [])
  const line = army.unitIds
    .map((id) => ctx.units.get(id))
    .filter(
      (u): u is UnitState =>
        !!u && isLineUnit(u.kind) && !runtimeOf(ctx, u.id).routed && !shock.has(u.id),
    )
  let budget =
    Math.floor(line.length * (reserve ? 1 : MAX_REACTING_SHARE)) -
    line.filter((u) => reacting(u)).length
  for (const e of intruders) {
    if (budget <= 0) return
    const already = line.filter((u) => reacting(u)?.intruder === e.id)
    // Base de la percée : sur l'axe (route, voie ferrée) qui l'alimente, derrière la pointe. Les brigades
    // qui bordent la percée, proches de sa base, sont préférées : elles menacent ses flancs.
    const dir = heading(e)
    const base = dir ? snapToAxis(ctx, along(e, dir, -CUT_BEHIND_KM), CUT_AXIS_KM) : null
    const reach = (u: UnitState): number =>
      Math.min(
        distanceKm(u.lon, u.lat, e.lon, e.lat),
        base ? distanceKm(u.lon, u.lat, base[0], base[1]) : Infinity,
      )
    const free = line
      .filter(
        (u) =>
          !reacting(u) &&
          !isHalted(ctx, u) &&
          runtimeOf(ctx, u.id).stance?.decision !== 'withdraw' &&
          // Unités à leur poste ou à l'arrêt (l'armée les renverrait de toute façon au front).
          (u.order.kind === 'front' || u.order.kind === 'hold' || u.order.kind === 'idle') &&
          (reserve || u.entrench < HOLD_ENTRENCH) &&
          distanceKm(u.lon, u.lat, e.lon, e.lat) <= reactKm,
      )
      .sort((a, b) =>
        reserve ? reach(a) - reach(b) : a.entrench - b.entrench || reach(a) - reach(b),
      )
      .slice(0, Math.min(budget, perBreach - already.length))
    if (free.length === 0) continue
    const team = [...already, ...free]
    const ratio = team.reduce((s, u) => s + punch(ctx, u), 0) / Math.max(0.01, guard(ctx, e))
    const kind: ReactionKind =
      ratio >= COUNTER_RATIO ? 'counter' : ratio >= CUT_RATIO && base ? 'cut' : 'block'
    for (const u of free) {
      let target: LonLat
      if (kind === 'counter') target = [e.lon, e.lat]
      else if (kind === 'cut' && base) target = base
      else if (dir) target = along(e, dir, BLOCK_AHEAD_KM)
      else {
        // Sans direction connue : poste entre la pointe et l'unité, au contact de la pointe.
        const d = Math.max(1, distanceKm(u.lon, u.lat, e.lon, e.lat))
        const k = Math.min(1, BLOCK_AHEAD_KM / d)
        target = [e.lon + (u.lon - e.lon) * k, e.lat + (u.lat - e.lat) * k]
      }
      u.order = { kind: kind === 'block' ? 'move' : 'attack', target }
      planPath(ctx, u, target)
      runtimeOf(ctx, u.id).reaction = { kind, intruder: e.id, until: ctx.tick + REACTION_TICKS }
      budget--
    }
    if (already.length === 0) {
      const verb =
        kind === 'counter'
          ? 'contre-attaque'
          : kind === 'cut'
            ? 'coupe la base d’une percée'
            : 'bloque une percée'
      ctx.log(`${army.name} ${verb} près de ${nearestCity(ctx, e.lon, e.lat)}`, army.owner, true)
    }
  }
}
