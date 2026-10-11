import type { SimContext } from '../context'
import type { ArmyState, FormationKind, FormationState, UnitKind, UnitState } from '../core/types'
import { distanceKm } from '../theater/grid'
import { isBrigade } from '../units/catalog'

/**
 * Couche de commandement (choix d'Adrien, 10 oct. : formations nommées et durables). Les brigades
 * d'une armée sont regroupées automatiquement en divisions, les divisions en corps. Une formation sert
 * à l'affichage selon le zoom, à la sélection, aux ordres (donnés à toutes ses brigades) et au secteur
 * commun de ses brigades dans la répartition du front ; la simulation reste à la brigade.
 *
 * Une brigade garde sa division tant qu'elle reste dans son armée (ou dans un groupe détaché de cette
 * armée : encerclement, avance) ; une recrue rejoint la division incomplète la plus proche, sinon une
 * nouvelle division est formée. Une division vide est dissoute, un corps sans division aussi.
 */

/** Brigades de manœuvre par division (infanterie, mécanisée, blindés, défense territoriale). */
export const DIVISION_MANEUVER = 3
/** Brigades d'appui par division (artillerie). */
export const DIVISION_SUPPORT = 1
/** Divisions par corps. */
export const CORPS_DIVISIONS = 3
/** Distance maximale entre une recrue (ou une brigade sans division) et la division qu'elle rejoint. */
export const JOIN_KM = 150
/** Distance maximale entre une division et le corps qu'elle rejoint. */
const CORPS_JOIN_KM = 300

type Role = 'maneuver' | 'support'

function roleOf(kind: UnitKind): Role {
  return kind === 'art' ? 'support' : 'maneuver'
}

function capacity(role: Role): number {
  return role === 'support' ? DIVISION_SUPPORT : DIVISION_MANEUVER
}

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
  }
  ctx.formations.set(f.id, f)
  return f
}

interface DivisionInfo {
  f: FormationState
  members: UnitState[]
  count: Record<Role, number>
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

/**
 * Met à jour divisions et corps de tous les pays : départs, dissolutions, puis regroupement des brigades
 * sans division. `only` limite le regroupement à une armée (mobilisation), le nettoyage restant global.
 */
export function updateFormations(ctx: SimContext, only?: ArmyState): void {
  // 1. Départs : une brigade quitte sa division si elle a changé d'armée (hors groupe détaché).
  const members = new Map<number, UnitState[]>()
  for (const u of ctx.units.values()) {
    if (u.divisionId === undefined) continue
    const d = ctx.formations.get(u.divisionId)
    if (!d || d.kind !== 'division' || !inDivisions(u.kind) || d.armyId !== homeArmyId(ctx, u)) {
      delete u.divisionId
      continue
    }
    const list = members.get(d.id)
    if (list) list.push(u)
    else members.set(d.id, [u])
  }
  // 2. Dissolutions : divisions sans brigade, corps sans division, formations d'une armée disparue.
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

  // 3. Regroupement, armée par armée (les groupes détachés sont rattachés à leur armée d'origine).
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
    // Centres et effectifs : seulement pour les armées qui ont des brigades à ranger.
    if (!f || !loose.has(f.armyId)) continue
    const [lon, lat] = centroid(list)
    const count: Record<Role, number> = { maneuver: 0, support: 0 }
    for (const u of list) count[roleOf(u.kind)]++
    const arr = divisionsOf.get(f.armyId)
    const info: DivisionInfo = { f, members: list, count, lon, lat }
    if (arr) arr.push(info)
    else divisionsOf.set(f.armyId, [info])
  }
  for (const [armyId, units] of loose) {
    const army = ctx.armies.get(armyId)
    if (!army || isDetachedGroup(army)) continue
    groupBrigades(ctx, army, units, divisionsOf.get(armyId) ?? [])
  }
  const byArmy = new Map<number, FormationState[]>()
  for (const f of ctx.formations.values()) {
    if (f.kind !== 'division') continue
    const list = byArmy.get(f.armyId)
    if (list) list.push(f)
    else byArmy.set(f.armyId, [f])
  }
  for (const army of ctx.armies.values()) {
    if (isDetachedGroup(army) || (only && army.id !== only.id)) continue
    groupDivisions(ctx, army, byArmy.get(army.id) ?? [])
  }
}

/** Range les brigades sans division : division incomplète proche, sinon nouvelles divisions. */
function groupBrigades(
  ctx: SimContext,
  army: ArmyState,
  units: UnitState[],
  divisions: DivisionInfo[],
): void {
  units.sort((a, b) => a.id - b.id)
  const left: UnitState[] = []
  // Recrues et brigades isolées : la division incomplète la plus proche, à moins de JOIN_KM.
  for (const u of units) {
    const role = roleOf(u.kind)
    let best: DivisionInfo | null = null
    let bestKm = JOIN_KM
    for (const d of divisions) {
      if (d.count[role] >= capacity(role)) continue
      const km = distanceKm(u.lon, u.lat, d.lon, d.lat)
      if (km <= bestKm) {
        best = d
        bestKm = km
      }
    }
    if (!best) {
      left.push(u)
      continue
    }
    u.divisionId = best.f.id
    best.count[role]++
    best.members.push(u)
  }
  // Nouvelles divisions : une brigade de manœuvre (à défaut d'appui) et ses plus proches voisines.
  const free = new Set(left)
  while (free.size > 0) {
    let seed: UnitState | undefined
    for (const u of free) {
      if (roleOf(u.kind) === 'maneuver') {
        seed = u
        break
      }
    }
    seed ??= free.values().next().value
    if (!seed) break
    const s = seed
    const d = create(ctx, army.owner, 'division', army.id)
    const count: Record<Role, number> = { maneuver: 0, support: 0 }
    const take = (u: UnitState): void => {
      u.divisionId = d.id
      count[roleOf(u.kind)]++
      free.delete(u)
    }
    take(s)
    const near = [...free]
      .map((u) => ({ u, km: distanceKm(s.lon, s.lat, u.lon, u.lat) }))
      .filter((x) => x.km <= JOIN_KM)
      .sort((a, b) => a.km - b.km || a.u.id - b.u.id)
    for (const { u } of near) {
      const role = roleOf(u.kind)
      if (count[role] < capacity(role)) take(u)
      if (count.maneuver >= DIVISION_MANEUVER && count.support >= DIVISION_SUPPORT) break
    }
  }
}

/** Range les divisions sans corps d'une armée : corps incomplet proche, sinon nouveaux corps. */
function groupDivisions(ctx: SimContext, army: ArmyState, divisions: FormationState[]): void {
  // Une armée d'une seule division n'a pas de corps.
  if (divisions.length < 2) {
    for (const d of divisions) d.parentId = null
    return
  }
  const orphans = divisions.filter((d) => d.parentId === null)
  if (orphans.length === 0) return
  // Position de chaque division : centre de ses brigades.
  const pos = new Map<number, [number, number]>()
  const byDivision = new Map<number, UnitState[]>()
  for (const id of army.unitIds) {
    const u = ctx.units.get(id)
    if (u?.divisionId === undefined) continue
    const list = byDivision.get(u.divisionId)
    if (list) list.push(u)
    else byDivision.set(u.divisionId, [u])
  }
  // Brigades parties dans un groupe détaché : comptées aussi.
  for (const u of ctx.units.values()) {
    if (u.divisionId === undefined || u.armyId === army.id) continue
    const d = ctx.formations.get(u.divisionId)
    if (d?.armyId !== army.id) continue
    const list = byDivision.get(d.id)
    if (list) list.push(u)
    else byDivision.set(d.id, [u])
  }
  for (const d of divisions) pos.set(d.id, centroid(byDivision.get(d.id) ?? []))
  const corps = new Map<number, { f: FormationState; n: number; lon: number; lat: number }>()
  for (const d of divisions) {
    if (d.parentId === null) continue
    const c = ctx.formations.get(d.parentId)
    if (!c) continue
    const p = pos.get(d.id) ?? [0, 0]
    const e = corps.get(c.id) ?? { f: c, n: 0, lon: 0, lat: 0 }
    e.lon = (e.lon * e.n + p[0]) / (e.n + 1)
    e.lat = (e.lat * e.n + p[1]) / (e.n + 1)
    e.n++
    corps.set(c.id, e)
  }
  const free = new Set<FormationState>()
  orphans.sort((a, b) => a.id - b.id)
  for (const d of orphans) {
    const p = pos.get(d.id) ?? [0, 0]
    let best: { f: FormationState; n: number; lon: number; lat: number } | null = null
    let bestKm = CORPS_JOIN_KM
    for (const c of corps.values()) {
      if (c.n >= CORPS_DIVISIONS) continue
      const km = distanceKm(p[0], p[1], c.lon, c.lat)
      if (km <= bestKm) {
        best = c
        bestKm = km
      }
    }
    if (!best) {
      free.add(d)
      continue
    }
    d.parentId = best.f.id
    best.n++
  }
  while (free.size > 0) {
    const seed = free.values().next().value
    if (!seed) break
    const c = create(ctx, army.owner, 'corps', army.id)
    const sp = pos.get(seed.id) ?? [0, 0]
    const near = [...free]
      .map((d) => {
        const p = pos.get(d.id) ?? [0, 0]
        return { d, km: distanceKm(sp[0], sp[1], p[0], p[1]) }
      })
      .filter((x) => x.km <= CORPS_JOIN_KM)
      .sort((a, b) => a.km - b.km || a.d.id - b.d.id)
      .slice(0, CORPS_DIVISIONS)
    for (const { d } of near) {
      d.parentId = c.id
      free.delete(d)
    }
  }
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
