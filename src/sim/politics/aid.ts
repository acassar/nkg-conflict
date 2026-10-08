import { countryName, sideIndex, type SimContext } from '../context'
import type { CountryId, UnitKind, UnitState } from '../core/types'
import { citiesOf } from '../economy/economy'
import { RECRUIT_COSTS } from '../economy/rules'
import { unitName } from '../units/names'
import { addRelation, allianceOf, enemiesInWar, isAtWarWith, relation } from './politics'
import type { Aid, AidLevel } from './types'
import { AID_LEVEL_NAMES, AID_SHARE } from './aidLevels'

export { AID_LEVEL_NAMES, AID_SHARE }

/** Moitié de la production envoyée part en matériel, livré sous forme d'unités équipées. */
const EQUIPMENT_SHARE = 0.5
/** Ordre des unités livrées. */
const DELIVERED_KINDS: UnitKind[] = ['mech', 'art', 'tank']
/** Délai avant de redemander de l'aide au même pays après un refus. */
const REFUSAL_COOLDOWN_TICKS = 24 * 30
/** Une demande d'aide au joueur reste valable 15 jours. */
const REQUEST_TICKS = 24 * 15
/** Nombre maximal de donneurs qu'une IA sollicite. */
const MAX_DONORS = 6

export interface DailyIncome {
  construction: number
  production: number
  munitions: number
  manpower: number
}

const refusalKey = (from: CountryId, to: CountryId): string => `${from}>${to}`

function sameAlliance(ctx: SimContext, a: CountryId, b: CountryId): boolean {
  const al = allianceOf(ctx, a)
  return al !== null && al === allianceOf(ctx, b)
}

function atWar(ctx: SimContext, code: CountryId): boolean {
  return ctx.matrix.atWar[sideIndex(ctx, code)] === 1
}

/** Ennemis actuels d'un pays (toutes guerres confondues). */
function enemiesOf(ctx: SimContext, code: CountryId): CountryId[] {
  return [...new Set(ctx.politics.wars.flatMap((w) => enemiesInWar(w, code)))]
}

export function aidBetween(ctx: SimContext, from: CountryId, to: CountryId): Aid | undefined {
  return ctx.politics.aids.find((a) => a.from === from && a.to === to)
}

function createAid(ctx: SimContext, from: CountryId, to: CountryId, level: AidLevel): Aid {
  const aid: Aid = {
    id: ctx.politics.nextId++,
    from,
    to,
    level,
    startTick: ctx.tick,
    equipment: 0,
    unitsDelivered: 0,
    lastDay: { munitions: 0, production: 0, construction: 0, equipment: 0 },
  }
  ctx.politics.aids.push(aid)
  return aid
}

/**
 * Niveau d'aide qu'un donneur IA accorde (0 = refus). Comptent : les relations, une alliance commune,
 * un ennemi commun, la guerre que mène le demandeur, et les besoins du donneur s'il est lui-même en guerre.
 */
export function aiAidLevel(ctx: SimContext, donor: CountryId, recipient: CountryId): AidLevel | 0 {
  if (donor === recipient || isAtWarWith(ctx, donor, recipient)) return 0
  const enemies = enemiesOf(ctx, recipient)
  if (enemies.some((e) => sameAlliance(ctx, donor, e))) return 0
  let score = relation(ctx, donor, recipient)
  if (sameAlliance(ctx, donor, recipient)) score += 40
  if (enemies.some((e) => relation(ctx, donor, e) <= -40)) score += 30
  if (!atWar(ctx, recipient)) score -= 30
  if (atWar(ctx, donor)) score -= 20
  if (score < 40) return 0
  return score >= 110 ? 3 : score >= 75 ? 2 : 1
}

/** Le receveur accepte toute aide, sauf d'un ennemi ou d'un pays qu'il déteste. */
function recipientAccepts(ctx: SimContext, donor: CountryId, recipient: CountryId): boolean {
  return !isAtWarWith(ctx, donor, recipient) && relation(ctx, donor, recipient) >= -20
}

// ---------- Commandes ----------

/** Demande d'aide d'un pays (receveur) à un donneur IA, qui décide aussitôt. Renvoie une erreur ou null. */
export function requestAid(ctx: SimContext, recipient: CountryId, donor: CountryId): string | null {
  if (recipient === donor) return 'Demande impossible'
  if (aidBetween(ctx, donor, recipient)) return `${countryName(ctx, donor)} vous aide déjà`
  if (isAtWarWith(ctx, donor, recipient)) return 'Vous êtes en guerre avec ce pays'
  const refused = ctx.politics.aidRefusals.get(refusalKey(recipient, donor))
  if (refused !== undefined && ctx.tick - refused < REFUSAL_COOLDOWN_TICKS) {
    const days = Math.ceil((refused + REFUSAL_COOLDOWN_TICKS - ctx.tick) / 24)
    return `${countryName(ctx, donor)} a déjà refusé : nouvelle demande possible dans ${days} jours`
  }
  const level = aiAidLevel(ctx, donor, recipient)
  if (level === 0) {
    ctx.politics.aidRefusals.set(refusalKey(recipient, donor), ctx.tick)
    return `${countryName(ctx, donor)} refuse son aide`
  }
  createAid(ctx, donor, recipient, level)
  ctx.log(
    `${countryName(ctx, donor)} accorde une aide ${AID_LEVEL_NAMES[level]} à ${countryName(ctx, recipient)}`,
    donor,
  )
  return null
}

/** Aide offerte par un donneur ; si elle existe déjà, son niveau change. Renvoie une erreur ou null. */
export function grantAid(
  ctx: SimContext,
  donor: CountryId,
  recipient: CountryId,
  level: AidLevel,
): string | null {
  if (donor === recipient) return 'Aide impossible'
  const existing = aidBetween(ctx, donor, recipient)
  if (existing) {
    setAidLevel(ctx, existing.id, donor, level)
    return null
  }
  if (!recipientAccepts(ctx, donor, recipient)) {
    return `${countryName(ctx, recipient)} refuse votre aide`
  }
  createAid(ctx, donor, recipient, level)
  ctx.log(
    `${countryName(ctx, donor)} accorde une aide ${AID_LEVEL_NAMES[level]} à ${countryName(ctx, recipient)}`,
    donor,
  )
  return null
}

/** Change le niveau d'une aide ; seul le donneur le peut. */
export function setAidLevel(ctx: SimContext, id: number, by: CountryId, level: AidLevel): void {
  const aid = ctx.politics.aids.find((a) => a.id === id)
  if (!aid || aid.from !== by || aid.level === level) return
  aid.level = level
  ctx.log(
    `${countryName(ctx, by)} passe son aide à ${countryName(ctx, aid.to)} au niveau « ${AID_LEVEL_NAMES[level]} »`,
    by,
  )
}

/** Met fin à une aide (donneur ou receveur). Le receveur prend mal l'arrêt décidé par le donneur. */
export function revokeAid(ctx: SimContext, id: number, by: CountryId, reason?: string): void {
  const aid = ctx.politics.aids.find((a) => a.id === id)
  if (!aid || (aid.from !== by && aid.to !== by)) return
  ctx.politics.aids = ctx.politics.aids.filter((a) => a.id !== id)
  if (by === aid.from) addRelation(ctx, aid.from, aid.to, -10)
  const text =
    by === aid.from
      ? `${countryName(ctx, aid.from)} met fin à son aide à ${countryName(ctx, aid.to)}`
      : `${countryName(ctx, aid.to)} renonce à l'aide de ${countryName(ctx, aid.from)}`
  ctx.log(reason ? `${text} (${reason})` : text, by)
}

/** Réponse du joueur à une demande d'aide d'une IA. */
export function answerAidRequest(
  ctx: SimContext,
  id: number,
  player: CountryId,
  accept: boolean,
  level: AidLevel,
): string | null {
  const pol = ctx.politics
  const req = pol.aidRequests.find((r) => r.id === id && r.to === player)
  if (!req) return 'Demande expirée'
  pol.aidRequests = pol.aidRequests.filter((r) => r.id !== id)
  if (!accept) {
    addRelation(ctx, player, req.from, -5)
    pol.aidRefusals.set(refusalKey(req.from, player), ctx.tick)
    ctx.log(`${countryName(ctx, player)} refuse son aide à ${countryName(ctx, req.from)}`, player)
    return null
  }
  return grantAid(ctx, player, req.from, level)
}

// ---------- Effets quotidiens ----------

/**
 * Détourne vers chaque receveur une part des revenus du jour de son donneur :
 * munitions, production (la moitié en matériel) et points de construction.
 * Les aides devenues impossibles (guerre entre les deux pays) prennent fin.
 */
export function applyAidFlows(ctx: SimContext, incomes: Map<CountryId, DailyIncome>): void {
  const pol = ctx.politics
  for (const aid of [...pol.aids]) {
    if (isAtWarWith(ctx, aid.from, aid.to)) {
      pol.aids = pol.aids.filter((a) => a.id !== aid.id)
      ctx.log(
        `Fin de l'aide de ${countryName(ctx, aid.from)} à ${countryName(ctx, aid.to)} : les deux pays sont en guerre`,
        aid.from,
      )
    }
  }
  for (const aid of pol.aids) {
    const give = incomes.get(aid.from)
    const get = incomes.get(aid.to)
    if (!give || !get) continue
    const s = AID_SHARE[aid.level]
    const munitions = Math.max(0, give.munitions * s)
    const production = Math.max(0, give.production * s)
    const construction = Math.max(0, give.construction * s)
    give.munitions -= munitions
    give.production -= production
    give.construction -= construction
    const equipment = production * EQUIPMENT_SHARE
    get.munitions += munitions
    get.production += production - equipment
    get.construction += construction
    aid.equipment += equipment
    aid.lastDay = { munitions, production: production - equipment, construction, equipment }
  }
}

/** Livre le matériel accumulé : une unité équipée apparaît chez le receveur, qui fournit les hommes. */
export function deliverEquipment(ctx: SimContext): void {
  for (const aid of ctx.politics.aids) {
    const eco = ctx.economies.get(aid.to)
    const pol = ctx.politics.countries.get(aid.to)
    if (!eco || !pol) continue
    const kind = DELIVERED_KINDS[aid.unitsDelivered % DELIVERED_KINDS.length] ?? 'mech'
    const cost = RECRUIT_COSTS[kind]
    // Pays non mobilisé : le matériel rejoint ses stocks de production.
    if (!pol.mobilized) {
      eco.production += aid.equipment
      aid.equipment = 0
      continue
    }
    if (aid.equipment < cost.production || eco.manpower < cost.manpower) continue
    const cities = citiesOf(ctx, aid.to)
    const city =
      cities.find((c) => c.def.capital && c.def.country === aid.to) ??
      [...cities].sort((a, b) => b.def.pop - a.def.pop)[0]
    if (!city) continue
    aid.equipment -= cost.production
    eco.manpower -= cost.manpower
    aid.unitsDelivered++
    const u: UnitState = {
      id: ctx.allocId(),
      name: unitName(kind, eco.unitCounters[kind]++),
      owner: aid.to,
      kind,
      lon: city.def.lon,
      lat: city.def.lat,
      strength: 1,
      org: 0.7,
      entrench: 0,
      order: { kind: 'hold' },
      path: [],
      armyId: null,
      hoursOutOfSupply: 0,
    }
    ctx.units.set(u.id, u)
    ctx.log(
      `Matériel livré par ${countryName(ctx, aid.from)} à ${city.def.name} : ${u.name}`,
      aid.to,
    )
  }
}

/** Effets diplomatiques mensuels : le receveur est reconnaissant, les ennemis du receveur s'irritent. */
export function aidRelationsMonthly(ctx: SimContext): void {
  for (const aid of ctx.politics.aids) {
    addRelation(ctx, aid.from, aid.to, aid.level)
    for (const e of enemiesOf(ctx, aid.to)) addRelation(ctx, aid.from, e, -aid.level)
  }
}

// ---------- IA ----------

/**
 * Diplomatie de l'aide, une fois par mois :
 * - un pays IA en guerre sollicite les pays les mieux disposés et les plus riches (le joueur reçoit une demande) ;
 * - un donneur IA met fin à une aide quand ses relations se dégradent, quand la guerre du receveur est finie,
 *   ou quand ses propres munitions manquent alors qu'il est lui-même en guerre.
 */
export function updateAidAi(ctx: SimContext, aiCountries: CountryId[], player: CountryId): void {
  const pol = ctx.politics
  pol.aidRequests = pol.aidRequests.filter((r) => r.expiresTick > ctx.tick)
  const ai = new Set(aiCountries)

  // Arrêts décidés par les donneurs IA.
  for (const aid of [...pol.aids]) {
    if (!ai.has(aid.from)) continue
    if (relation(ctx, aid.from, aid.to) < 0) {
      revokeAid(ctx, aid.id, aid.from, 'relations dégradées')
    } else if (!atWar(ctx, aid.to) && !sameAlliance(ctx, aid.from, aid.to)) {
      if (ctx.rng.next() < 0.3) revokeAid(ctx, aid.id, aid.from, 'la guerre est finie')
    } else if (atWar(ctx, aid.from) && (ctx.economies.get(aid.from)?.munitions ?? 0) < 300) {
      if (aid.level > 1) setAidLevel(ctx, aid.id, aid.from, (aid.level - 1) as AidLevel)
      else revokeAid(ctx, aid.id, aid.from, 'ses propres besoins passent avant')
    }
  }

  // Demandes des IA en guerre.
  const byWealth = [...ctx.countries.values()].sort((a, b) => (b.gdpB ?? 0) - (a.gdpB ?? 0))
  for (const code of aiCountries) {
    if (!atWar(ctx, code) || !pol.countries.get(code)?.mobilized) continue
    const donors = pol.aids.filter((a) => a.to === code).length
    if (donors >= MAX_DONORS) continue
    const candidates = byWealth
      .filter((c) => {
        if (c.id === code || aidBetween(ctx, c.id, code) || isAtWarWith(ctx, c.id, code))
          return false
        const refused = pol.aidRefusals.get(refusalKey(code, c.id))
        if (refused !== undefined && ctx.tick - refused < REFUSAL_COOLDOWN_TICKS) return false
        return relation(ctx, c.id, code) >= 20 || sameAlliance(ctx, c.id, code)
      })
      .slice(0, 3)
    const target = candidates[Math.floor(ctx.rng.next() * candidates.length)]
    if (!target) continue
    if (target.id === player) {
      if (pol.aidRequests.some((r) => r.from === code)) continue
      pol.aidRequests.push({
        id: pol.nextId++,
        from: code,
        to: player,
        expiresTick: ctx.tick + REQUEST_TICKS,
      })
      ctx.log(`${countryName(ctx, code)} demande votre aide`, code)
    } else {
      requestAid(ctx, code, target.id)
    }
  }
}
