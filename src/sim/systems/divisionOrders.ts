import { sideIndex, type SimContext } from '../context'
import type {
  ArmyState,
  DefendPointKinds,
  DefendPointsMission,
  DivisionBorder,
  FormationState,
  LonLat,
  UnitState,
} from '../core/types'
import { assignFront, frontCells, type FrontCell } from './armies'
import { assignDefendPoints } from './defendPoints'
import { borderFrontCells, foreignNeighbors } from './frontiers'

/**
 * Ordres de frontière et de défense donnés aux divisions (phase G2) : une division quitte la ligne de
 * son armée pour tenir seule un tronçon de la frontière de l'armée, ou pour défendre des points (villes,
 * ports, bases, aérodromes). Le reste de l'armée se répartit sur le reste de sa ligne ; les missions de
 * l'armée (avancer, percée, retraite, garnison) laissent la division à son ordre.
 */

/** Division de l'unité, si elle est sous ordre de défense propre dans l'armée de l'unité. */
export function detachedDivision(ctx: SimContext, u: UnitState): FormationState | null {
  if (u.divisionId === undefined) return null
  const f = ctx.formations.get(u.divisionId)
  return f?.defense && f.armyId === u.armyId ? f : null
}

/** Divisions d'une armée sous ordre de défense propre. */
export function detachedDivisions(ctx: SimContext, army: ArmyState): FormationState[] {
  const out: FormationState[] = []
  const seen = new Set<number>()
  for (const id of army.unitIds) {
    const d = ctx.units.get(id)?.divisionId
    if (d === undefined || seen.has(d)) continue
    seen.add(d)
    const f = ctx.formations.get(d)
    if (f?.defense && f.armyId === army.id) out.push(f)
  }
  return out
}

/**
 * Cellules de ligne d'un tronçon tenu par une division : la frontière elle-même en paix, la portion de
 * front qui en découle en guerre (sans les cellules au-delà de ses extrémités).
 */
export function divisionLineCells(
  ctx: SimContext,
  army: ArmyState,
  d: DivisionBorder,
): FrontCell[] {
  if (!d.front) return borderFrontCells(ctx, { ...army, border: d.cells })
  const all = frontCells(ctx, sideIndex(ctx, army.owner), d.front)
  const inner = all.filter((c) => c.t > 0 && c.t < 1)
  return inner.length > 0 ? inner : all
}

/** Cellules de la ligne de l'armée réservées aux divisions qui tiennent leur propre tronçon. */
export function reservedCells(ctx: SimContext, army: ArmyState): Set<number> {
  const out = new Set<number>()
  for (const f of detachedDivisions(ctx, army)) {
    if (f.defense?.kind !== 'border') continue
    for (const c of f.defense.cells) out.add(c)
    for (const c of divisionLineCells(ctx, army, f.defense)) out.add(c.cell)
  }
  return out
}

/**
 * Donne à une division des cellules de la frontière de son armée (ajoutées à celles qu'elle tient).
 * `paint` les prend aux autres divisions de l'armée, `free` ne prend que les cellules libres. Renvoie un
 * message d'erreur, ou null.
 */
export function giveDivisionBorder(
  ctx: SimContext,
  f: FormationState,
  cells: Iterable<number>,
  mode: 'paint' | 'free',
): string | null {
  const army = ctx.armies.get(f.armyId)
  if (!army?.border?.length)
    return "L'armée de la division ne tient pas de frontière : donnez-lui d'abord une frontière (Mission de l'armée)"
  const armyCells = new Set(army.border)
  const others = detachedDivisions(ctx, army).filter(
    (o): o is FormationState & { defense: DivisionBorder } =>
      o !== f && o.defense?.kind === 'border',
  )
  const heldByOthers = new Set<number>()
  for (const o of others) for (const c of o.defense.cells) heldByOthers.add(c)
  const mine = new Set(f.defense?.kind === 'border' ? f.defense.cells : [])
  const taken = new Set<number>()
  let inside = false
  let blocked = false
  for (const c of cells) {
    if (!armyCells.has(c)) continue
    inside = true
    if (mine.has(c)) continue
    if (mode === 'free' && heldByOthers.has(c)) blocked = true
    else taken.add(c)
  }
  if (taken.size === 0) {
    if (!inside) return `Peignez à l'intérieur de la frontière tenue par ${army.name}`
    return blocked
      ? "Ce tronçon est déjà tenu par d'autres divisions de l'armée : peignez-le pour le leur prendre"
      : 'La division tient déjà ce tronçon'
  }
  for (const o of others) {
    if (!o.defense.cells.some((c) => taken.has(c))) continue
    o.defense.cells = o.defense.cells.filter((c) => !taken.has(c))
    if (o.defense.cells.length === 0) {
      delete (o as FormationState).defense
      ctx.log(`${o.name} rejoint la ligne de ${army.name}`, army.owner)
    }
  }
  f.defense = { kind: 'border', cells: [...mine, ...taken].sort((p, q) => p - q) }
  return null
}

/** Ordre « Défendre des points » d'une division : tout le pays (`zone` nulle) ou un cercle. */
export function giveDivisionPoints(
  f: FormationState,
  zone: DefendPointsMission['zone'],
  kinds: DefendPointKinds,
): DefendPointsMission {
  const m: DefendPointsMission = { kind: 'defendPoints', zone, kinds: { ...kinds }, points: [] }
  f.defense = m
  return m
}

/**
 * Tronçons des divisions, avant la répartition des armées : cellules sorties de la frontière de l'armée
 * retirées (le tronçon vide rend la division à son armée) ; guerre avec un voisin du tronçon, il devient
 * la portion de front de la division ; paix revenue, elle retrouve son tronçon.
 */
export function updateDivisionBorders(ctx: SimContext): void {
  for (const f of ctx.formations.values()) {
    const d = f.defense
    if (d?.kind !== 'border') continue
    const army = ctx.armies.get(f.armyId)
    const side = army ? sideIndex(ctx, army.owner) : -1
    if (d.front && (!army || ctx.matrix.atWar[side] !== 1)) delete d.front
    if (!d.front) {
      const held = new Set(army?.border ?? [])
      d.cells = d.cells.filter((c) => held.has(c))
    }
    if (!army || d.cells.length === 0) {
      delete f.defense
      if (army) ctx.log(`${f.name} rejoint la ligne de ${army.name}`, army.owner)
      continue
    }
    if (d.front || !army.borderFront) continue
    const contact = borderFrontCells(ctx, { ...army, border: d.cells }).filter((c) =>
      foreignNeighbors(ctx.grid, side, c.cell).some((o) => ctx.matrix.hostile(side, o)),
    )
    const first = contact[0]
    const last = contact[contact.length - 1]
    if (!first || !last) continue
    const at = (c: FrontCell): LonLat => [ctx.grid.lonOf(c.cell), ctx.grid.latOf(c.cell)]
    d.front = [at(first), at(last)]
  }
}

/** Place les brigades d'une division sous ordre de défense : sur son tronçon, ou sur ses points. */
export function assignDivisionDefense(ctx: SimContext, f: FormationState, teleport = false): void {
  const d = f.defense
  const army = ctx.armies.get(f.armyId)
  if (!d || !army) return
  const unitIds = army.unitIds.filter((id) => ctx.units.get(id)?.divisionId === f.id)
  if (unitIds.length === 0) return
  if (d.kind === 'defendPoints') {
    assignDefendPoints(ctx, { ...army, unitIds }, d, teleport, f.id)
    return
  }
  // Tronçon : la division le tient comme une armée tient sa frontière, avec la mission de ligne de son
  // armée quand elle en a une qui s'y prête (points clés, défense en profondeur).
  const kind = army.mission?.kind
  const own: ArmyState = {
    ...army,
    unitIds,
    front: d.front ?? null,
    wholeFront: false,
    border: d.cells,
    borderFront: !!d.front,
    offensive: null,
    encirclement: undefined,
    mission: kind === 'keyPoints' || kind === 'depth' ? { kind } : undefined,
  }
  assignFront(ctx, own, teleport, f.id)
}

/** Divisions sous ordre de défense, après la répartition des armées. */
export function assignDivisionOrders(ctx: SimContext): void {
  for (const f of ctx.formations.values()) if (f.defense) assignDivisionDefense(ctx, f)
}
