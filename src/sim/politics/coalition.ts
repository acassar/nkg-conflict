import { countryName, isOffMap, sideIndex, type SimContext } from '../context'
import type { CountryId, LonLat } from '../core/types'
import { distanceKm } from '../theater/grid'
import {
  addRelation,
  enemiesInWar,
  enter,
  isAtWarWith,
  politicsOf,
  rebuildMatrix,
  relation,
  sameAlliance,
  warsOf,
  withdrawFromClosedTerritory,
  type PoliticsHooks,
} from './politics'
import type { War } from './types'

/**
 * Coalition : le joueur demande à un allié de participer à sa guerre, ou à un pays tiers un droit de
 * passage. Chaque réponse se calcule à partir d'un score lisible (relations, ennemis communs, distance,
 * soutien à la guerre) ; un refus bloque une nouvelle demande au même pays pendant un mois.
 */

/** Score à atteindre pour qu'un allié entre en guerre. */
export const JOIN_THRESHOLD = 50
/** Score à atteindre pour qu'un pays accorde un droit de passage. */
export const PASSAGE_THRESHOLD = 40
/** Délai avant de redemander à un pays qui a refusé. */
export const ASK_COOLDOWN_TICKS = 24 * 30
/** Bonus d'une alliance commune. */
export const ALLIANCE_BONUS = 20
/** Un ennemi que le pays déteste déjà (relations à −30 ou moins). */
export const COMMON_ENEMY_BONUS = 20
/** Un ennemi avec lequel le pays est déjà en guerre. */
export const SHARED_WAR_BONUS = 40
/** Un ennemi avec lequel le pays a de bonnes relations (+20 ou plus). */
export const FRIENDLY_ENEMY_MALUS = 30
/** Au-delà de cette distance de la guerre, l'envie de s'engager baisse (−1 par 50 km, 40 au plus). */
export const DISTANCE_FREE_KM = 500
/** Soutien à la guerre : ±30 entre 0 % et 100 % (0 à 50 %). */
export const WAR_SUPPORT_WEIGHT = 60
/** Pays déjà en guerre ailleurs : moins disponible. */
export const BUSY_MALUS = 15
/** Relations des ennemis envers un pays qui accorde le passage. */
export const PASSAGE_ENEMY_RELATION = -10

/** Réponse d'un pays : score, facteurs lisibles et décision. */
export interface CoalitionAnswer {
  score: number
  threshold: number
  /** Facteurs du score, pour le message au joueur (« relations +40 », « distance −12 »…). */
  factors: Array<{ label: string; value: number }>
  /** Refus sans appel (pays hors carte, ami de l'ennemi…), sinon null. */
  veto: string | null
  accepted: boolean
}

/** Position d'un pays : sa capitale sur la carte, à défaut l'emplacement de son nom. */
function anchorOf(ctx: SimContext, code: CountryId): LonLat | null {
  const capital = ctx.cities.find((c) => c.country === code && c.capital)
  if (capital) return [capital.lon, capital.lat]
  return ctx.countries.get(code)?.label ?? null
}

/** Ennemis du demandeur dans toutes ses guerres. */
function enemiesOf(ctx: SimContext, code: CountryId): CountryId[] {
  return [...new Set(warsOf(ctx, code).flatMap((w) => enemiesInWar(w, code)))]
}

/** Distance (km) entre un pays et le plus proche des ennemis du demandeur. */
function distanceToWar(ctx: SimContext, code: CountryId, enemies: CountryId[]): number {
  const a = anchorOf(ctx, code)
  if (!a) return 0
  let best = Infinity
  for (const e of enemies) {
    const b = anchorOf(ctx, e)
    if (b) best = Math.min(best, distanceKm(a[0], a[1], b[0], b[1]))
  }
  return Number.isFinite(best) ? best : 0
}

function answer(
  factors: CoalitionAnswer['factors'],
  threshold: number,
  veto: string | null,
): CoalitionAnswer {
  const score = Math.round(factors.reduce((s, f) => s + f.value, 0))
  return { score, threshold, factors, veto, accepted: veto === null && score >= threshold }
}

/** Facteurs communs : relations avec le demandeur, alliance, attitude envers chaque ennemi. */
function baseFactors(
  ctx: SimContext,
  code: CountryId,
  requester: CountryId,
  enemies: CountryId[],
): CoalitionAnswer['factors'] {
  const factors = [{ label: 'relations', value: relation(ctx, code, requester) }]
  if (sameAlliance(ctx, code, requester)) factors.push({ label: 'alliance', value: ALLIANCE_BONUS })
  for (const e of enemies) {
    const r = relation(ctx, code, e)
    const name = countryName(ctx, e)
    if (isAtWarWith(ctx, code, e)) {
      factors.push({ label: `déjà en guerre contre ${name}`, value: SHARED_WAR_BONUS })
    } else if (r <= -30) {
      factors.push({ label: `ennemi commun : ${name}`, value: COMMON_ENEMY_BONUS })
    } else if (r >= 20) {
      factors.push({ label: `bonnes relations avec ${name}`, value: -FRIENDLY_ENEMY_MALUS })
    }
  }
  return factors
}

/** Un allié accepte-t-il de participer aux guerres du demandeur ? */
export function joinAnswer(
  ctx: SimContext,
  ally: CountryId,
  requester: CountryId,
): CoalitionAnswer {
  const enemies = enemiesOf(ctx, requester)
  let veto: string | null = null
  if (enemies.length === 0) veto = "vous n'êtes pas en guerre"
  else if (isOffMap(ctx, ally)) veto = 'hors du théâtre'
  else if (!sameAlliance(ctx, ally, requester)) veto = "ce pays n'est pas votre allié"
  else if (enemies.includes(ally)) veto = 'en guerre contre vous'
  else if (warsOf(ctx, requester).every((w) => joinedSide(w, ally, requester))) {
    veto = 'déjà à vos côtés'
  }
  const ally50 = enemies.find((e) => relation(ctx, ally, e) >= 50)
  if (!veto && ally50) veto = `trop proche de ${countryName(ctx, ally50)}`
  const factors = baseFactors(ctx, ally, requester, enemies)
  const d = distanceToWar(ctx, ally, enemies)
  const far = Math.min(40, Math.max(0, (d - DISTANCE_FREE_KM) / 50))
  if (far >= 1) factors.push({ label: `distance (${Math.round(d)} km)`, value: -far })
  const support = politicsOf(ctx, ally)?.warSupport ?? 0.5
  factors.push({ label: 'soutien à la guerre', value: (support - 0.5) * WAR_SUPPORT_WEIGHT })
  const elsewhere = (w: War): boolean =>
    !w.attackers.includes(requester) && !w.defenders.includes(requester)
  if (warsOf(ctx, ally).some(elsewhere)) {
    factors.push({ label: 'déjà en guerre ailleurs', value: -BUSY_MALUS })
  }
  return answer(factors, JOIN_THRESHOLD, veto)
}

/** `code` est-il dans le camp du demandeur dans cette guerre ? */
function joinedSide(w: War, code: CountryId, requester: CountryId): boolean {
  const side = w.attackers.includes(requester) ? w.attackers : w.defenders
  return side.includes(code)
}

/** Un pays tiers accorde-t-il un droit de passage au demandeur ? */
export function passageAnswer(
  ctx: SimContext,
  country: CountryId,
  requester: CountryId,
): CoalitionAnswer {
  const enemies = enemiesOf(ctx, requester)
  let veto: string | null = null
  if (enemies.length === 0) veto = "vous n'êtes pas en guerre"
  else if (isOffMap(ctx, country)) veto = 'hors du théâtre'
  else if (enemies.includes(country)) veto = 'en guerre contre vous'
  else if (ctx.matrix.friendly(sideIndex(ctx, country), sideIndex(ctx, requester))) {
    veto = 'déjà dans votre camp'
  } else if (hasPassage(ctx, requester, country)) veto = 'passage déjà accordé'
  const allyOfEnemy = enemies.find((e) => sameAlliance(ctx, country, e))
  if (!veto && allyOfEnemy) veto = `allié de ${countryName(ctx, allyOfEnemy)}`
  const close = enemies.find((e) => relation(ctx, country, e) >= 40)
  if (!veto && close) veto = `trop proche de ${countryName(ctx, close)}`
  return answer(baseFactors(ctx, country, requester, enemies), PASSAGE_THRESHOLD, veto)
}

export function hasPassage(ctx: SimContext, from: CountryId, to: CountryId): boolean {
  return ctx.politics.passages.some((p) => p.from === from && p.to === to)
}

/** Message au joueur : décision et principaux facteurs. */
function explain(country: CountryId, ctx: SimContext, a: CoalitionAnswer, yes: string): string {
  const name = countryName(ctx, country)
  if (a.veto) return `${name} refuse : ${a.veto}`
  const top = [...a.factors]
    .filter((f) => Math.abs(f.value) >= 1)
    .sort((x, y) => Math.abs(y.value) - Math.abs(x.value))
    .slice(0, 3)
    .map((f) => `${f.label} ${f.value > 0 ? '+' : '−'}${Math.round(Math.abs(f.value))}`)
    .join(', ')
  const verdict = a.accepted ? yes : `${name} refuse`
  return `${verdict} (score ${String(a.score).replace('-', '−')} pour ${a.threshold} : ${top})`
}

function cooldownLeft(ctx: SimContext, key: string): number {
  const at = ctx.politics.coalitionRefusals.get(key)
  return at === undefined ? 0 : Math.max(0, at + ASK_COOLDOWN_TICKS - ctx.tick)
}

/** Message si une demande au même pays a été refusée il y a moins d'un mois, sinon null. */
function cooldownMessage(ctx: SimContext, country: CountryId, key: string): string | null {
  const left = cooldownLeft(ctx, key)
  if (left <= 0) return null
  return `${countryName(ctx, country)} a déjà refusé : nouvelle demande dans ${Math.ceil(left / 24)} jours`
}

/**
 * Demande à un allié d'entrer dans les guerres du demandeur. Renvoie le message à afficher ; l'allié
 * rejoint, s'il accepte, chaque guerre du demandeur où il n'est pas encore.
 */
export function askToJoin(
  ctx: SimContext,
  requester: CountryId,
  ally: CountryId,
  hooks: PoliticsHooks,
): { accepted: boolean; message: string } {
  const key = `${requester}>${ally}:join`
  const wait = cooldownMessage(ctx, ally, key)
  if (wait) return { accepted: false, message: wait }
  const a = joinAnswer(ctx, ally, requester)
  const name = countryName(ctx, ally)
  if (!a.accepted) {
    if (!a.veto) ctx.politics.coalitionRefusals.set(key, ctx.tick)
    return { accepted: false, message: explain(ally, ctx, a, '') }
  }
  for (const w of warsOf(ctx, requester)) {
    const side = w.attackers.includes(requester) ? w.attackers : w.defenders
    if (side.includes(ally) || enemiesInWar(w, requester).includes(ally)) continue
    side.push(ally)
    enter(ctx, w, ally, hooks)
  }
  ctx.politics.passages = ctx.politics.passages.filter(
    (p) => !(p.from === requester && p.to === ally),
  )
  ctx.log(`${name} entre en guerre aux côtés de ${countryName(ctx, requester)}`, ally)
  rebuildMatrix(ctx)
  return { accepted: true, message: explain(ally, ctx, a, `${name} entre en guerre à vos côtés`) }
}

/** Demande un droit de passage à un pays tiers. Renvoie le message à afficher. */
export function askPassage(ctx: SimContext, requester: CountryId, country: CountryId): string {
  const key = `${requester}>${country}:passage`
  const wait = cooldownMessage(ctx, country, key)
  if (wait) return wait
  const a = passageAnswer(ctx, country, requester)
  if (!a.accepted) {
    if (!a.veto) ctx.politics.coalitionRefusals.set(key, ctx.tick)
    return explain(country, ctx, a, '')
  }
  ctx.politics.passages.push({ from: requester, to: country, startTick: ctx.tick })
  // Les ennemis du demandeur voient d'un mauvais œil ce pays qui ouvre ses frontières.
  for (const e of enemiesOf(ctx, requester)) addRelation(ctx, e, country, PASSAGE_ENEMY_RELATION)
  ctx.log(
    `${countryName(ctx, country)} accorde un droit de passage à ${countryName(ctx, requester)}`,
    requester,
  )
  rebuildMatrix(ctx)
  return explain(country, ctx, a, `${countryName(ctx, country)} vous accorde le droit de passage`)
}

/** Le bénéficiaire renonce à un droit de passage : ses unités quittent ce territoire. */
export function renouncePassage(ctx: SimContext, from: CountryId, to: CountryId): string | null {
  if (!hasPassage(ctx, from, to)) return 'Aucun droit de passage'
  endPassages(ctx, (p) => p.from === from && p.to === to, 'fin du droit de passage')
  return null
}

/**
 * Chaque jour : un droit de passage prend fin quand le bénéficiaire n'est plus en guerre, quand le
 * pays hôte entre en guerre contre lui ou quand leurs relations deviennent négatives.
 */
export function updatePassages(ctx: SimContext): void {
  endPassages(
    ctx,
    (p) =>
      warsOf(ctx, p.from).length === 0 ||
      isAtWarWith(ctx, p.from, p.to) ||
      relation(ctx, p.from, p.to) < 0,
    'droit de passage retiré',
  )
}

function endPassages(
  ctx: SimContext,
  ends: (p: { from: CountryId; to: CountryId }) => boolean,
  reason: string,
): void {
  const ended = ctx.politics.passages.filter(ends)
  if (ended.length === 0) return
  ctx.politics.passages = ctx.politics.passages.filter((p) => !ends(p))
  for (const p of ended) {
    ctx.log(`${countryName(ctx, p.to)} : ${reason} (${countryName(ctx, p.from)})`, p.from)
  }
  rebuildMatrix(ctx)
  // Les unités restées sur le territoire désormais fermé rentrent chez elles.
  withdrawFromClosedTerritory(ctx)
}

/** « Appeler les alliés » : demande à chaque allié en même temps. Renvoie le nombre de pays qui rejoignent. */
export function callAlliesToWars(ctx: SimContext, code: CountryId, hooks: PoliticsHooks): number {
  const allies = new Set(
    ctx.politics.alliances.filter((a) => a.members.includes(code)).flatMap((a) => a.members),
  )
  allies.delete(code)
  let n = 0
  for (const ally of allies) {
    if (joinAnswer(ctx, ally, code).veto) continue
    if (askToJoin(ctx, code, ally, hooks).accepted) n++
  }
  return n
}
