import { countryName, sideIndex, type SimContext } from '../context'
import type { CountryId } from '../core/types'
import {
  addRelation,
  aiAcceptsPeace,
  declareWar,
  enemiesInWar,
  isAtWarWith,
  makePeace,
  politicsOf,
  relation,
  territoryScore,
  type PoliticsHooks,
} from './politics'
import type { PeaceKind } from './types'

/** Une offre de paix au joueur reste valable 15 jours. */
const OFFER_TICKS = 24 * 15
/** Chance mensuelle qu'une IA belliqueuse passe à l'acte contre une cible éligible. */
const WAR_CHANCE = 0.01
/** Seuil de relations sous lequel une IA envisage la guerre. */
const WAR_RELATION = -60
/** L'agresseur doit aligner au moins autant de fois les forces de la cible et de ses alliés. */
const WAR_FORCE_RATIO = 2

/** Pays voisins (frontière terrestre commune), calculés une fois. */
export function computeNeighbors(ctx: SimContext): Map<CountryId, Set<CountryId>> {
  const g = ctx.grid
  const W = g.width
  const pairs = new Map<CountryId, Set<CountryId>>()
  const link = (a: number, b: number): void => {
    if (a === b || a === 0 || b === 0) return
    const ca = ctx.sides[a] ?? ''
    const cb = ctx.sides[b] ?? ''
    if (!pairs.has(ca)) pairs.set(ca, new Set())
    if (!pairs.has(cb)) pairs.set(cb, new Set())
    pairs.get(ca)?.add(cb)
    pairs.get(cb)?.add(ca)
  }
  for (let i = 0; i < g.size; i++) {
    const o = g.owner[i] ?? 0
    if (o === 0) continue
    if (i % W < W - 1) link(o, g.owner[i + 1] ?? 0)
    if (i + W < g.size) link(o, g.owner[i + W] ?? 0)
  }
  return pairs
}

function coalitionForce(ctx: SimContext, code: CountryId): number {
  let total = politicsOf(ctx, code)?.forceSize ?? 0
  for (const a of ctx.politics.alliances) {
    if (!a.members.includes(code)) continue
    for (const m of a.members) if (m !== code) total += politicsOf(ctx, m)?.forceSize ?? 0
  }
  return total
}

/**
 * Diplomatie des IA, une fois par mois :
 * - paix : proposée quand le soutien à la guerre s'effondre (au joueur), conclue directement entre IA ;
 * - guerre : rare, seulement contre un voisin détesté et nettement plus faible, sans allié commun ;
 * - relations : lente érosion des extrêmes, rapprochement entre alliés.
 */
export function updateDiplomacyAi(
  ctx: SimContext,
  aiCountries: CountryId[],
  player: CountryId,
  neighbors: Map<CountryId, Set<CountryId>>,
  hooks: PoliticsHooks,
): void {
  const pol = ctx.politics
  pol.offers = pol.offers.filter((o) => o.expiresTick > ctx.tick)

  for (const code of aiCountries) {
    const me = politicsOf(ctx, code)
    if (!me) continue

    // Paix.
    for (const war of [...pol.wars]) {
      const enemies = enemiesInWar(war, code)
      if (enemies.length === 0) continue
      const losing = territoryScore(ctx, war, code) < 0.97
      const tired = me.warSupport < 0.3
      if (!tired && !(losing && me.warSupport < 0.45)) continue
      const kind: PeaceKind = losing ? 'white' : 'lines'
      if (enemies.includes(player)) {
        if (!pol.offers.some((o) => o.from === code && o.warId === war.id)) {
          pol.offers.push({
            id: pol.nextId++,
            warId: war.id,
            from: code,
            to: player,
            kind,
            expiresTick: ctx.tick + OFFER_TICKS,
          })
          ctx.log(`${countryName(ctx, code)} propose la paix`, code)
        }
      } else {
        const leader = enemies[0]
        if (leader && aiAcceptsPeace(ctx, war, leader, kind)) makePeace(ctx, war.id, code, kind)
      }
    }

    // Guerre.
    if (me.warSupport < 0.5 || ctx.matrix.atWar[sideIndex(ctx, code)] === 1) continue
    for (const target of neighbors.get(code) ?? []) {
      if (target === player && relation(ctx, code, target) > -80) continue
      if (relation(ctx, code, target) > WAR_RELATION || isAtWarWith(ctx, code, target)) continue
      if (coalitionForce(ctx, code) < WAR_FORCE_RATIO * coalitionForce(ctx, target)) continue
      if (ctx.rng.next() >= WAR_CHANCE) continue
      declareWar(ctx, code, target, hooks)
      break
    }
  }

  // Relations : les extrêmes s'émoussent, les alliés se rapprochent.
  for (const [key, value] of pol.relations) {
    const [a, b] = key.split('|') as [CountryId, CountryId]
    if (isAtWarWith(ctx, a, b)) continue
    pol.relations.set(key, value * 0.98)
  }
  for (const al of pol.alliances) {
    for (const a of al.members) for (const b of al.members) if (a < b) addRelation(ctx, a, b, 1)
  }
}

interface EventDef {
  text: (name: string) => string
  chance: number
  stability: number
  warSupport: number
  when?: (atWar: boolean, warSupport: number) => boolean
}

const EVENTS: EventDef[] = [
  {
    text: (n) => `Élections en ${n} : le gouvernement sort renforcé`,
    chance: 0.006,
    stability: 0.06,
    warSupport: 0,
  },
  {
    text: (n) => `Crise gouvernementale en ${n}`,
    chance: 0.006,
    stability: -0.06,
    warSupport: 0,
  },
  {
    text: (n) => `Récession en ${n}`,
    chance: 0.005,
    stability: -0.04,
    warSupport: -0.02,
  },
  {
    text: (n) => `Manifestations contre la guerre en ${n}`,
    chance: 0.08,
    stability: -0.05,
    warSupport: -0.04,
    when: (atWar, ws) => atWar && ws < 0.25,
  },
  {
    text: (n) => `Élan patriotique en ${n}`,
    chance: 0.04,
    stability: 0.02,
    warSupport: 0.06,
    when: (atWar, ws) => atWar && ws > 0.4,
  },
]

/** Événements aléatoires mensuels. Seuls ceux qui concernent le joueur, un pays en guerre ou un grand pays sont publiés. */
export function monthlyEvents(ctx: SimContext, player: CountryId): void {
  for (const p of ctx.politics.countries.values()) {
    const atWar = ctx.matrix.atWar[sideIndex(ctx, p.code)] === 1
    for (const ev of EVENTS) {
      if (ev.when && !ev.when(atWar, p.warSupport)) continue
      if (ctx.rng.next() >= ev.chance) continue
      p.stability = Math.max(0, Math.min(1, p.stability + ev.stability))
      p.warSupport = Math.max(0, Math.min(1, p.warSupport + ev.warSupport))
      const big = (ctx.countries.get(p.code)?.pop ?? 0) > 50_000_000
      if (p.code === player || atWar || big) ctx.log(ev.text(countryName(ctx, p.code)), p.code)
    }
  }
}
