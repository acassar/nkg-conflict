import { countryName, isOffMap, runtimeOf, sideIndex, type SimContext } from '../context'
import { encodeRle } from '../core/save'
import type { CountryId, LonLat } from '../core/types'
import { decodeRle } from '../theater/grid'
import { mobilize } from './mobilization'
import type { CountryPolitics, PeaceKind, PoliticsSnapshot, War } from './types'

export const RELATION_MIN = -100
export const RELATION_MAX = 100
/** Délai entre deux « Améliorer les relations » du joueur envers un même pays. */
export const IMPROVE_COOLDOWN_TICKS = 24 * 30
export const IMPROVE_STEP = 10
const SANCTION_PRODUCTION = 0.9
const SANCTION_FLOOR = 0.6
/** Perte de production maximale si toute l'économie mondiale sanctionne un pays. */
const SANCTION_MAX_LOSS = 0.4

// ---------- Relations ----------

const relKey = (a: CountryId, b: CountryId): string => (a < b ? `${a}|${b}` : `${b}|${a}`)

export function relation(ctx: SimContext, a: CountryId, b: CountryId): number {
  if (a === b) return RELATION_MAX
  return ctx.politics.relations.get(relKey(a, b)) ?? 0
}

export function setRelation(ctx: SimContext, a: CountryId, b: CountryId, value: number): void {
  if (a === b) return
  const v = Math.max(RELATION_MIN, Math.min(RELATION_MAX, value))
  if (v === 0) ctx.politics.relations.delete(relKey(a, b))
  else ctx.politics.relations.set(relKey(a, b), v)
}

export function addRelation(ctx: SimContext, a: CountryId, b: CountryId, delta: number): void {
  setRelation(ctx, a, b, relation(ctx, a, b) + delta)
}

export function politicsOf(ctx: SimContext, code: CountryId): CountryPolitics | undefined {
  return ctx.politics.countries.get(code)
}

function shift(
  ctx: SimContext,
  code: CountryId,
  field: 'stability' | 'warSupport',
  d: number,
): void {
  const p = politicsOf(ctx, code)
  if (p) p[field] = Math.max(0, Math.min(1, p[field] + d))
}

// ---------- Effets sur l'économie et le combat ----------

/** Multiplicateur de production et de construction : stabilité et sanctions subies. */
export function productionFactor(ctx: SimContext, code: CountryId): number {
  const p = politicsOf(ctx, code)
  let f = 0.5 + 0.5 * (p?.stability ?? 1)
  f *= sanctionFactor(ctx, code)
  return f
}

/** PIB mondial (somme des pays de la partie), calculé une fois. */
const worldGdp = new WeakMap<SimContext, number>()

/**
 * Effet des sanctions subies. Avec des PIB connus (carte du monde), il dépend du poids économique
 * des pays qui sanctionnent ; sinon, chaque pays qui sanctionne retire 10 %.
 */
export function sanctionFactor(ctx: SimContext, code: CountryId): number {
  let total = worldGdp.get(ctx)
  if (total === undefined) {
    total = 0
    for (const c of ctx.countries.values()) total += Math.max(0, c.gdpB ?? 0)
    worldGdp.set(ctx, total)
  }
  let count = 0
  let gdp = 0
  for (const s of ctx.politics.sanctions) {
    if (!s.endsWith(`>${code}`)) continue
    count++
    gdp += Math.max(0, ctx.countries.get(s.slice(0, s.indexOf('>')))?.gdpB ?? 0)
  }
  if (count === 0) return 1
  if (total > 0) return 1 - SANCTION_MAX_LOSS * Math.min(1, gdp / total)
  return Math.max(SANCTION_FLOOR, SANCTION_PRODUCTION ** count)
}

/** Multiplicateur de main-d'œuvre : le soutien à la guerre facilite la conscription. */
export function manpowerFactor(ctx: SimContext, code: CountryId): number {
  return 0.5 + (politicsOf(ctx, code)?.warSupport ?? 0.5)
}

/** Multiplicateur de récupération d'organisation des unités. */
export function moraleFactor(ctx: SimContext, code: CountryId): number {
  return 0.6 + 0.4 * (politicsOf(ctx, code)?.warSupport ?? 0.5)
}

// ---------- Guerres ----------

/** Recalcule la matrice des hostilités et cobelligérances à partir des guerres en cours. */
export function rebuildMatrix(ctx: SimContext): void {
  const m = ctx.matrix
  m.clear()
  for (const w of ctx.politics.wars) {
    const a = w.attackers.map((c) => sideIndex(ctx, c))
    const d = w.defenders.map((c) => sideIndex(ctx, c))
    for (const x of a) for (const y of d) m.setWar(x, y)
    for (const x of a) for (const y of a) m.setFriends(x, y)
    for (const x of d) for (const y of d) m.setFriends(x, y)
  }
}

export function warsOf(ctx: SimContext, code: CountryId): War[] {
  return ctx.politics.wars.filter((w) => w.attackers.includes(code) || w.defenders.includes(code))
}

export function enemiesInWar(war: War, code: CountryId): CountryId[] {
  if (war.attackers.includes(code)) return war.defenders
  if (war.defenders.includes(code)) return war.attackers
  return []
}

export function isAtWarWith(ctx: SimContext, a: CountryId, b: CountryId): boolean {
  return ctx.matrix.hostile(sideIndex(ctx, a), sideIndex(ctx, b))
}

export interface PoliticsHooks {
  /** Nom de l'armée créée à la mobilisation d'un pays. */
  armyName(code: CountryId): string
}

function enter(ctx: SimContext, war: War, code: CountryId, hooks: PoliticsHooks): void {
  war.startOwned[code] = ctx.grid.countOwned(sideIndex(ctx, code))
  const def = ctx.countries.get(code)
  if (def) mobilize(ctx, def, hooks.armyName(code))
}

/** Les alliés d'un pays agressé le rejoignent s'ils n'apprécient pas l'agresseur. */
function callAllies(
  ctx: SimContext,
  war: War,
  caller: CountryId,
  hooks: PoliticsHooks,
  mustJoin = false,
): CountryId[] {
  const enemies = enemiesInWar(war, caller)
  const side = war.attackers.includes(caller) ? war.attackers : war.defenders
  const joined: CountryId[] = []
  for (const alliance of ctx.politics.alliances) {
    if (!alliance.members.includes(caller)) continue
    for (const m of alliance.members) {
      if (side.includes(m) || enemies.includes(m) || isOffMap(ctx, m)) continue
      if (enemies.some((e) => relation(ctx, m, e) >= 50)) continue
      if (!mustJoin && relation(ctx, m, caller) < 30) continue
      side.push(m)
      joined.push(m)
    }
  }
  for (const m of joined) {
    enter(ctx, war, m, hooks)
    ctx.log(`${countryName(ctx, m)} entre en guerre aux côtés de ${countryName(ctx, caller)}`, m)
  }
  return joined
}

/** Déclare la guerre. Renvoie un message d'erreur, ou null si la guerre est déclarée. */
export function declareWar(
  ctx: SimContext,
  attacker: CountryId,
  target: CountryId,
  hooks: PoliticsHooks,
): string | null {
  if (attacker === target) return 'Impossible de se déclarer la guerre'
  if (!ctx.countries.has(target)) return 'Pays inconnu'
  if (isOffMap(ctx, target) || isOffMap(ctx, attacker)) {
    return `${countryName(ctx, isOffMap(ctx, target) ? target : attacker)} est hors du théâtre : guerre impossible`
  }
  if (isAtWarWith(ctx, attacker, target)) return 'Déjà en guerre'
  if (
    ctx.politics.alliances.some((a) => a.members.includes(attacker) && a.members.includes(target))
  ) {
    return "Impossible d'attaquer un allié : quittez d'abord l'alliance"
  }
  const war: War = {
    id: ctx.politics.nextId++,
    name: `Guerre ${countryName(ctx, attacker)} – ${countryName(ctx, target)}`,
    attackers: [attacker],
    defenders: [target],
    startTick: ctx.tick,
    startOwned: {},
    ownerAtStart: encodeRle(ctx.grid.owner),
  }
  ctx.politics.wars.push(war)
  enter(ctx, war, attacker, hooks)
  enter(ctx, war, target, hooks)
  setRelation(ctx, attacker, target, RELATION_MIN)
  // Une agression coûte : stabilité de l'agresseur, image auprès des autres pays.
  shift(ctx, attacker, 'stability', -0.05)
  shift(ctx, target, 'warSupport', 0.25)
  for (const other of ctx.countries.keys()) {
    if (other !== attacker && other !== target) addRelation(ctx, other, attacker, -5)
  }
  ctx.log(`${countryName(ctx, attacker)} déclare la guerre à ${countryName(ctx, target)}`, attacker)
  callAllies(ctx, war, target, hooks, true)
  rebuildMatrix(ctx)
  return null
}

/** Le joueur appelle ses alliés dans ses guerres. Renvoie le nombre de pays qui le rejoignent. */
export function callAlliesToWars(ctx: SimContext, code: CountryId, hooks: PoliticsHooks): number {
  let n = 0
  for (const w of warsOf(ctx, code)) n += callAllies(ctx, w, code, hooks).length
  rebuildMatrix(ctx)
  return n
}

/** Bilan territorial d'un pays dans une guerre : cellules tenues / cellules au début (1 = statu quo). */
export function territoryScore(ctx: SimContext, war: War, code: CountryId): number {
  const start = war.startOwned[code] ?? 1
  return ctx.grid.countOwned(sideIndex(ctx, code)) / Math.max(1, start)
}

/**
 * Paix entre `a` et le camp adverse. Si `a` a des alliés encore en guerre, c'est une paix séparée :
 * seul `a` quitte la guerre. Paix blanche : chacun récupère ses cellules d'avant-guerre prises par l'autre.
 */
export function makePeace(ctx: SimContext, warId: number, a: CountryId, kind: PeaceKind): void {
  const war = ctx.politics.wars.find((w) => w.id === warId)
  if (!war) return
  const mySide = war.attackers.includes(a) ? war.attackers : war.defenders
  const other = enemiesInWar(war, a)
  const leaving = mySide.length > 1 ? [a] : [...mySide]
  if (kind === 'white') restoreBetween(ctx, war, leaving, other)
  if (mySide.length > 1) {
    mySide.splice(mySide.indexOf(a), 1)
  } else {
    ctx.politics.wars = ctx.politics.wars.filter((w) => w.id !== warId)
  }
  for (const x of leaving) {
    for (const y of other) addRelation(ctx, x, y, 25)
  }
  const label = kind === 'white' ? 'paix blanche' : 'paix sur la ligne de front'
  ctx.log(
    `${label} : ${leaving.map((c) => countryName(ctx, c)).join(', ')} et ${other.map((c) => countryName(ctx, c)).join(', ')}`,
    a,
  )
  rebuildMatrix(ctx)
  withdrawFromClosedTerritory(ctx)
}

function restoreBetween(ctx: SimContext, war: War, sideA: CountryId[], sideB: CountryId[]): void {
  const start = decodeRle(war.ownerAtStart, ctx.grid.size)
  const a = new Set(sideA.map((c) => sideIndex(ctx, c)))
  const b = new Set(sideB.map((c) => sideIndex(ctx, c)))
  const g = ctx.grid
  for (let i = 0; i < g.size; i++) {
    const now = g.owner[i] ?? 0
    const before = start[i] ?? 0
    if (now === before) continue
    if ((a.has(now) && b.has(before)) || (b.has(now) && a.has(before))) g.setOwner(i, before)
  }
}

/** Après une paix, les unités restées en territoire désormais fermé rentrent chez elles. */
function withdrawFromClosedTerritory(ctx: SimContext): void {
  const g = ctx.grid
  for (const u of ctx.units.values()) {
    const side = sideIndex(ctx, u.owner)
    const owner = g.owner[g.cellAt(u.lon, u.lat)] ?? 0
    if (ctx.matrix.canEnter(side, owner)) continue
    const home = nearestOwnCity(ctx, u.owner, u.lon, u.lat)
    if (home) [u.lon, u.lat] = home
    u.order = { kind: 'hold' }
    u.path = []
    runtimeOf(ctx, u.id).engagedWith = null
  }
}

function nearestOwnCity(ctx: SimContext, code: CountryId, lon: number, lat: number): LonLat | null {
  const side = sideIndex(ctx, code)
  let best: LonLat | null = null
  let bestD = Infinity
  for (const c of ctx.cityStates.values()) {
    if (c.owner !== side) continue
    const d = (c.def.lon - lon) ** 2 + (c.def.lat - lat) ** 2
    if (d < bestD) {
      bestD = d
      best = [c.def.lon, c.def.lat]
    }
  }
  return best ?? ctx.countries.get(code)?.label ?? null
}

/**
 * Capitulation : le pays quitte toutes ses guerres sur la ligne de front, sa stabilité s'effondre.
 * Déclenchée par la prise de sa capitale ou la perte de toutes ses unités.
 */
export function capitulate(ctx: SimContext, code: CountryId, reason: string): void {
  const wars = warsOf(ctx, code)
  if (wars.length === 0) return
  ctx.log(`${countryName(ctx, code)} capitule (${reason})`, code)
  for (const w of wars) {
    for (const e of enemiesInWar(w, code)) shift(ctx, e, 'warSupport', 0.1)
    makePeace(ctx, w.id, code, 'lines')
  }
  shift(ctx, code, 'stability', -0.3)
}

// ---------- Acceptation de la paix par l'IA ----------

/** L'IA `to` accepte-t-elle la paix proposée par `from` ? */
export function aiAcceptsPeace(ctx: SimContext, war: War, to: CountryId, kind: PeaceKind): boolean {
  const p = politicsOf(ctx, to)
  if (!p) return false
  const score = territoryScore(ctx, war, to)
  const days = (ctx.tick - war.startTick) / 24
  if (p.warSupport < 0.15) return true
  if (kind === 'white') return score < 0.97 || p.warSupport < 0.35 || days > 365
  // Paix sur les lignes : acceptée si l'on garde au moins son territoire de départ.
  return score >= 1 && p.warSupport < 0.7
}

// ---------- Alliances et sanctions ----------

export function allianceOf(ctx: SimContext, code: CountryId): string | null {
  return ctx.politics.alliances.find((a) => a.members.includes(code))?.id ?? null
}

/** Les deux pays sont-ils membres d'une même alliance (un pays peut en avoir plusieurs) ? */
export function sameAlliance(ctx: SimContext, a: CountryId, b: CountryId): boolean {
  return ctx.politics.alliances.some((al) => al.members.includes(a) && al.members.includes(b))
}

/** Propose une alliance : acceptée si les relations sont excellentes. Renvoie une erreur ou null. */
export function proposeAlliance(ctx: SimContext, from: CountryId, to: CountryId): string | null {
  if (isAtWarWith(ctx, from, to)) return 'Vous êtes en guerre avec ce pays'
  const rel = relation(ctx, from, to)
  if (rel < 60)
    return `${countryName(ctx, to)} refuse : relations insuffisantes (${Math.round(rel)}/60)`
  if (sameAlliance(ctx, from, to)) return `Vous êtes déjà alliés`
  // Un pacte bilatéral : chacun garde ses autres alliances.
  ctx.politics.alliances.push({
    id: `alliance-${ctx.politics.nextId++}`,
    name: `Pacte ${countryName(ctx, from)} – ${countryName(ctx, to)}`,
    members: [from, to],
  })
  addRelation(ctx, from, to, 10)
  ctx.log(`Alliance conclue : ${countryName(ctx, from)} et ${countryName(ctx, to)}`, from)
  return null
}

/** Quitte une alliance (toutes si `id` est absent). */
export function leaveAlliance(ctx: SimContext, code: CountryId, id?: string): void {
  for (const a of ctx.politics.alliances) {
    if (!a.members.includes(code) || (id !== undefined && a.id !== id)) continue
    a.members = a.members.filter((m) => m !== code)
    for (const m of a.members) addRelation(ctx, code, m, -20)
    ctx.log(`${countryName(ctx, code)} quitte ${a.name}`, code)
  }
  ctx.politics.alliances = ctx.politics.alliances.filter((a) => a.members.length > 1)
}

export function toggleSanction(ctx: SimContext, from: CountryId, to: CountryId): boolean {
  const key = `${from}>${to}`
  if (ctx.politics.sanctions.has(key)) {
    ctx.politics.sanctions.delete(key)
    addRelation(ctx, from, to, 10)
    ctx.log(`${countryName(ctx, from)} lève ses sanctions contre ${countryName(ctx, to)}`, from)
    return false
  }
  ctx.politics.sanctions.add(key)
  addRelation(ctx, from, to, -30)
  ctx.log(`${countryName(ctx, from)} sanctionne ${countryName(ctx, to)}`, from)
  return true
}

export function improveRelations(ctx: SimContext, from: CountryId, to: CountryId): string | null {
  const p = politicsOf(ctx, to)
  if (!p) return 'Pays inconnu'
  if (isAtWarWith(ctx, from, to)) return 'Impossible pendant une guerre'
  const wait = p.lastImproveTick + IMPROVE_COOLDOWN_TICKS - ctx.tick
  if (p.lastImproveTick > 0 && wait > 0)
    return `Encore ${Math.ceil(wait / 24)} jours avant un nouvel effort`
  p.lastImproveTick = ctx.tick
  addRelation(ctx, from, to, IMPROVE_STEP)
  return null
}

// ---------- Évolution quotidienne ----------

/** Jauges politiques, chaque jour : usure de la guerre, retour au calme en paix, sanctions. */
export function updatePoliticsDaily(ctx: SimContext, dailyLosses: Map<CountryId, number>): void {
  for (const p of ctx.politics.countries.values()) {
    const atWar = ctx.matrix.atWar[sideIndex(ctx, p.code)] === 1
    if (atWar) {
      // Usure : un peu chaque jour, davantage avec les pertes (en fractions d'unité).
      const losses = dailyLosses.get(p.code) ?? 0
      p.warSupport = Math.max(0, p.warSupport - 0.0008 - 0.01 * losses)
      p.stability = Math.max(0, p.stability - 0.0005 - 0.003 * losses)
    } else {
      p.warSupport += (0.3 - p.warSupport) * 0.01
      p.stability += (0.65 - p.stability) * 0.005
    }
    for (const s of ctx.politics.sanctions) {
      if (s.endsWith(`>${p.code}`)) p.stability = Math.max(0, p.stability - 0.0005)
    }
  }
}

/** Une ville perdue pèse sur la stabilité du perdant et galvanise le vainqueur. */
export function onCityLost(
  ctx: SimContext,
  loser: CountryId,
  winner: CountryId | null,
  big: boolean,
): void {
  shift(ctx, loser, 'stability', big ? -0.04 : -0.015)
  if (winner) shift(ctx, winner, 'warSupport', big ? 0.03 : 0.01)
}

// ---------- Publication ----------

export function politicsSnapshot(ctx: SimContext, player: CountryId): PoliticsSnapshot {
  const playerRelations: Record<CountryId, number> = {}
  for (const code of ctx.countries.keys()) {
    if (code !== player) playerRelations[code] = relation(ctx, player, code)
  }
  return {
    countries: [...ctx.politics.countries.values()].map((p) => ({
      code: p.code,
      stability: p.stability,
      warSupport: p.warSupport,
      mobilized: p.mobilized,
      forceSize: p.forceSize,
    })),
    playerRelations,
    wars: ctx.politics.wars.map((w) => ({
      id: w.id,
      name: w.name,
      attackers: [...w.attackers],
      defenders: [...w.defenders],
    })),
    alliances: ctx.politics.alliances.map((a) => ({ ...a, members: [...a.members] })),
    organizations: ctx.politics.organizations,
    sanctions: [...ctx.politics.sanctions],
    offers: ctx.politics.offers.filter((o) => o.to === player).map((o) => ({ ...o })),
    aids: ctx.politics.aids.map((a) => structuredClone(a)),
    aidRequests: ctx.politics.aidRequests.filter((r) => r.to === player).map((r) => ({ ...r })),
  }
}
