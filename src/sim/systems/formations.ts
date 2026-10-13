import type { SimContext } from '../context'
import type { ArmyState, FormationKind, FormationState, UnitKind, UnitState } from '../core/types'
import { distanceKm } from '../theater/grid'
import { isBrigade } from '../units/catalog'
import { DIVISION_TEMPLATES, divisionTemplateFor, slotFit, templateOf } from '../units/templates'

/**
 * Couche de commandement : divisions et corps nommés et durables. Une division suit un modèle (2 à 4
 * brigades, units/templates.ts) ; elle est organique (phase D3) : une brigade garde sa division, même
 * détachée dans une autre armée, et la division suit l'armée qui tient la plupart de ses brigades. Une
 * formation sert à l'affichage selon le zoom, à la sélection, aux ordres (donnés à toutes ses brigades)
 * et au secteur commun de ses brigades dans la répartition du front ; la simulation reste à la brigade.
 *
 * Une brigade nouvelle (recrue, aide, levée) est affectée à une division de son armée qui a une place
 * pour son modèle (la plus proche, à moins de JOIN_KM), sinon à une nouvelle division formée autour
 * d'elle. Les corps viennent de l'ordre de bataille du scénario (scenarios/forces.ts) : plus de
 * regroupement automatique des divisions. Une brigade détruite réduit sa division ; une division vide
 * est dissoute, de même qu'une division dont aucune brigade n'a plus d'armée, et un corps sans division.
 */

/** Distance maximale entre une brigade nouvelle et la division qu'elle rejoint. */
export const JOIN_KM = 150

/** Unités regroupées en divisions : toutes les brigades (pas la logistique ni les QG). */
export function inDivisions(kind: UnitKind): boolean {
  return isBrigade(kind)
}

/** Chiffres romains, pour les corps. */
function roman(n: number): string {
  const table: Array<[number, string]> = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ]
  let out = ''
  let left = n
  for (const [v, s] of table) {
    while (left >= v) {
      out += s
      left -= v
    }
  }
  return out
}

/** Nom d'une formation : « 1re division », « 12e division », « Ier corps », « IIe corps ». */
export function formationName(kind: FormationKind, number: number): string {
  if (kind === 'division') return `${number === 1 ? '1re' : `${number}e`} division`
  return `${roman(number)}${number === 1 ? 'er' : 'e'} corps`
}

/**
 * Armée de rattachement d'une unité : son armée, ou l'armée d'origine d'un groupe détaché (encerclement,
 * avance de brigades choisies), qu'elle rejoindra.
 */
export function homeArmyId(ctx: SimContext, u: UnitState): number | null {
  const army = u.armyId === null ? undefined : ctx.armies.get(u.armyId)
  return army ? homeOfArmy(army) : null
}

function homeOfArmy(army: ArmyState): number {
  return (
    army.encirclement?.parentArmyId ??
    (army.mission?.kind === 'advance' ? army.mission.parentArmyId : undefined) ??
    army.id
  )
}

/** Groupe temporaire détaché d'une armée : ses brigades gardent leur division. */
function isDetachedGroup(army: ArmyState): boolean {
  return homeOfArmy(army) !== army.id
}

/** Plus petit numéro libre d'un échelon pour un pays (les numéros des formations dissoutes resservent). */
function freeNumber(ctx: SimContext, owner: string, kind: FormationKind): number {
  const used = new Set<number>()
  for (const f of ctx.formations.values())
    if (f.owner === owner && f.kind === kind) used.add(f.number)
  let n = 1
  while (used.has(n)) n++
  return n
}

function create(
  ctx: SimContext,
  owner: string,
  kind: FormationKind,
  armyId: number,
  template?: string,
): FormationState {
  const number = freeNumber(ctx, owner, kind)
  const f: FormationState = {
    id: ctx.nextFormationId++,
    owner,
    kind,
    number,
    name: formationName(kind, number),
    armyId,
    parentId: null,
    ...(template ? { template } : {}),
  }
  ctx.formations.set(f.id, f)
  return f
}

interface DivisionInfo {
  f: FormationState
  members: UnitState[]
  /** Places libres : modèles de brigade attendus par le modèle de la division. */
  free: string[]
  lon: number
  lat: number
}

function centroid(units: UnitState[]): [number, number] {
  let lon = 0
  let lat = 0
  for (const u of units) {
    lon += u.lon
    lat += u.lat
  }
  return [lon / Math.max(1, units.length), lat / Math.max(1, units.length)]
}

/** Modèle d'une division (une division d'avant les modèles prend celui de sa première brigade). */
function divisionTemplate(d: FormationState, members: UnitState[]): string {
  if (d.template && DIVISION_TEMPLATES[d.template]) return d.template
  const first = members[0]
  return divisionTemplateFor((first && templateOf(first)) ?? '')
}

/** Meilleure place libre pour une brigade (indice dans `free`, ou −1), et son score. */
function bestSlot(free: string[], u: UnitState): { index: number; fit: number } {
  const t = templateOf(u) ?? ''
  let index = -1
  let fit = 0
  for (const [i, slot] of free.entries()) {
    const f = slotFit(slot, t)
    if (f > fit) {
      fit = f
      index = i
    }
  }
  return { index, fit }
}

/** Places libres d'une division : son modèle moins ses brigades. */
function freeSlots(template: string, members: UnitState[]): string[] {
  const free = [...(DIVISION_TEMPLATES[template]?.brigades ?? [])]
  for (const u of members) {
    const { index } = bestSlot(free, u)
    if (index >= 0) free.splice(index, 1)
  }
  return free
}

/** Armée qui tient la plupart des brigades d'une division (null : aucune). */
function majorityArmy(ctx: SimContext, members: UnitState[]): number | null {
  const count = new Map<number, number>()
  for (const u of members) {
    const home = homeArmyId(ctx, u)
    if (home !== null) count.set(home, (count.get(home) ?? 0) + 1)
  }
  let best: number | null = null
  let n = 0
  for (const [id, c] of count) {
    if (c > n || (c === n && best !== null && id < best)) {
      best = id
      n = c
    }
  }
  return best
}

/**
 * Met à jour divisions et corps de tous les pays : armée de chaque division, dissolutions, puis
 * affectation des brigades sans division. `only` limite l'affectation à une armée (mobilisation), le
 * nettoyage restant global.
 */
export function updateFormations(ctx: SimContext, only?: ArmyState): void {
  // 1. Membres : une brigade garde sa division (formation organique), sauf changement de pays.
  const members = new Map<number, UnitState[]>()
  for (const u of ctx.units.values()) {
    if (u.divisionId === undefined) continue
    const d = ctx.formations.get(u.divisionId)
    if (!d || d.kind !== 'division' || !inDivisions(u.kind) || d.owner !== u.owner) {
      delete u.divisionId
      continue
    }
    const list = members.get(d.id)
    if (list) list.push(u)
    else members.set(d.id, [u])
  }
  // La division suit l'armée de la plupart de ses brigades ; sans armée, elle est dissoute.
  for (const [id, list] of members) {
    const d = ctx.formations.get(id)
    if (!d) continue
    const army = majorityArmy(ctx, list)
    if (army === null) {
      for (const u of list) delete u.divisionId
      members.delete(id)
      continue
    }
    if (army !== d.armyId) {
      d.armyId = army
      d.parentId = null
    }
  }
  // 2. Dissolutions : divisions sans brigade, corps sans division.
  for (const f of [...ctx.formations.values()]) {
    if (f.kind === 'division' && (!members.has(f.id) || !ctx.armies.has(f.armyId))) {
      ctx.formations.delete(f.id)
    }
  }
  const corpsUsed = new Set<number>()
  for (const f of ctx.formations.values()) {
    if (f.kind !== 'division' || f.parentId === null) continue
    const c = ctx.formations.get(f.parentId)
    if (!c || c.armyId !== f.armyId) f.parentId = null
    else corpsUsed.add(c.id)
  }
  for (const f of [...ctx.formations.values()]) {
    if (f.kind === 'corps' && !corpsUsed.has(f.id)) ctx.formations.delete(f.id)
  }

  // 3. Brigades sans division, armée par armée (les groupes détachés sont rattachés à leur armée
  // d'origine).
  const loose = new Map<number, UnitState[]>()
  for (const u of ctx.units.values()) {
    if (u.divisionId !== undefined || !inDivisions(u.kind)) continue
    const home = homeArmyId(ctx, u)
    if (home === null || (only && home !== only.id)) continue
    const list = loose.get(home)
    if (list) list.push(u)
    else loose.set(home, [u])
  }
  const divisionsOf = new Map<number, DivisionInfo[]>()
  for (const [id, list] of members) {
    const f = ctx.formations.get(id)
    // Centres et places : seulement pour les armées qui ont des brigades à ranger.
    if (!f || !loose.has(f.armyId)) continue
    const template = divisionTemplate(f, list)
    f.template ??= template
    const [lon, lat] = centroid(list)
    const arr = divisionsOf.get(f.armyId)
    const info: DivisionInfo = { f, members: list, free: freeSlots(template, list), lon, lat }
    if (arr) arr.push(info)
    else divisionsOf.set(f.armyId, [info])
  }
  for (const [armyId, units] of loose) {
    const army = ctx.armies.get(armyId)
    if (!army || isDetachedGroup(army)) continue
    groupBrigades(ctx, army, units, divisionsOf.get(armyId) ?? [])
  }
}

/**
 * Affecte les brigades sans division : place libre pour leur modèle dans une division proche (modèle
 * exact d'abord, puis même rôle), sinon nouvelle division formée autour d'une brigade de manœuvre et
 * complétée par ses voisines sans division.
 */
function groupBrigades(
  ctx: SimContext,
  army: ArmyState,
  units: UnitState[],
  divisions: DivisionInfo[],
): void {
  units.sort((a, b) => a.id - b.id)
  const left: UnitState[] = []
  for (const u of units) {
    let best: DivisionInfo | null = null
    let bestIndex = -1
    let bestFit = 0
    let bestKm = JOIN_KM
    for (const d of divisions) {
      const { index, fit } = bestSlot(d.free, u)
      if (fit === 0) continue
      const km = distanceKm(u.lon, u.lat, d.lon, d.lat)
      if (km > JOIN_KM) continue
      if (fit > bestFit || (fit === bestFit && km <= bestKm)) {
        best = d
        bestIndex = index
        bestFit = fit
        bestKm = km
      }
    }
    if (!best) {
      left.push(u)
      continue
    }
    u.divisionId = best.f.id
    best.free.splice(bestIndex, 1)
    best.members.push(u)
  }
  // Nouvelles divisions : une brigade de manœuvre (à défaut d'appui) et ses plus proches voisines.
  const free = new Set(left)
  while (free.size > 0) {
    let seed: UnitState | undefined
    for (const u of free) {
      if (u.kind !== 'art') {
        seed = u
        break
      }
    }
    seed ??= free.values().next().value
    if (!seed) break
    const s = seed
    const template = divisionTemplateFor(templateOf(s) ?? '')
    const d = create(ctx, army.owner, 'division', army.id, template)
    const slots = [...(DIVISION_TEMPLATES[template]?.brigades ?? [])]
    const take = (u: UnitState, index: number): void => {
      u.divisionId = d.id
      if (index >= 0) slots.splice(index, 1)
      free.delete(u)
    }
    take(s, bestSlot(slots, s).index)
    const near = [...free]
      .map((u) => ({ u, km: distanceKm(s.lon, s.lat, u.lon, u.lat) }))
      .filter((x) => x.km <= JOIN_KM)
      .sort((a, b) => a.km - b.km || a.u.id - b.u.id)
    for (const { u } of near) {
      if (slots.length === 0) break
      const { index, fit } = bestSlot(slots, u)
      if (fit > 0) take(u, index)
    }
  }
}

/** Formation nommée d'un ordre de bataille (scénarios) : numéro libre de son échelon, nom réel. */
export function createNamedFormation(
  ctx: SimContext,
  owner: string,
  kind: FormationKind,
  armyId: number,
  name: string,
  opts: { template?: string; parentId?: number | null; generated?: boolean } = {},
): FormationState {
  const f = create(ctx, owner, kind, armyId, opts.template)
  f.name = name
  f.parentId = opts.parentId ?? null
  if (opts.generated) f.generated = true
  return f
}

/** Brigades d'une formation (division : les siennes ; corps : celles de ses divisions). */
export function formationUnits(ctx: SimContext, id: number): UnitState[] {
  const f = ctx.formations.get(id)
  if (!f) return []
  const out: UnitState[] = []
  for (const u of ctx.units.values()) {
    if (u.divisionId === undefined) continue
    if (u.divisionId === id) out.push(u)
    else if (f.kind === 'corps' && ctx.formations.get(u.divisionId)?.parentId === id) out.push(u)
  }
  return out
}
