import { countryName, sideIndex, type SimContext } from '../context'
import type { ArmyState, CountryId, UnitState } from '../core/types'
import { TENSION_RELATION } from '../economy/ai'
import { returnToGarrison } from '../politics/mobilization'
import { relation } from '../politics/politics'
import { distanceKm } from '../theater/grid'
import { isLineUnit } from '../units/catalog'
import { assignFront } from './armies'
import { borderWith } from './frontiers'

/**
 * IA de paix (phase G2) : un pays IA en paix qui a un voisin hostile (relations au plus
 * TENSION_RELATION) détache une armée sur cette frontière tendue, en posture défensive, et son armée
 * principale défend ses villes, ports et bases ailleurs (mission « Défendre des points »). Sans tension,
 * tout rentre en garnison ; à la guerre, l'armée des frontières rejoint l'armée principale, qui reprend
 * tout le front.
 */

/** Réexamen des tensions, en jours. */
export const PEACE_AI_EVERY_DAYS = 7
/** Part des brigades de ligne envoyées sur les frontières tendues. */
export const BORDER_SHARE = 0.5
/** Brigades de ligne minimales pour détacher une armée des frontières. */
const MIN_LINE_UNITS = 2

/** Voisins terrestres avec lesquels les relations sont au plus TENSION_RELATION. */
export function tenseNeighbors(
  ctx: SimContext,
  country: CountryId,
  neighbors: ReadonlyMap<CountryId, ReadonlySet<CountryId>>,
): CountryId[] {
  return [...(neighbors.get(country) ?? [])]
    .filter((n) => relation(ctx, country, n) <= TENSION_RELATION)
    .sort()
}

function armiesOf(ctx: SimContext, country: CountryId): ArmyState[] {
  return [...ctx.armies.values()].filter((a) => a.owner === country)
}

/** L'armée des frontières rejoint l'armée principale ; celle-ci quitte « Défendre des points ». */
function mergeBack(ctx: SimContext, country: CountryId): ArmyState | null {
  const armies = armiesOf(ctx, country)
  const main = armies.find((a) => a.aiPeace === 'points') ?? armies.find((a) => a.wholeFront)
  for (const a of armies) {
    if (a.aiPeace !== 'border') continue
    if (main) {
      for (const id of a.unitIds) {
        const u = ctx.units.get(id)
        if (!u) continue
        u.armyId = main.id
        main.unitIds.push(id)
      }
    }
    ctx.armies.delete(a.id)
  }
  if (main?.aiPeace) {
    if (main.mission?.kind === 'defendPoints') delete main.mission
    delete main.aiPeace
  }
  return main ?? null
}

/** Une passe de l'IA de paix pour un pays IA (chaque jour ; le réexamen, tous les 7 jours). */
export function updatePeaceAi(
  ctx: SimContext,
  country: CountryId,
  neighbors: ReadonlyMap<CountryId, ReadonlySet<CountryId>>,
): void {
  const side = sideIndex(ctx, country)
  const managed = (): boolean => armiesOf(ctx, country).some((a) => a.aiPeace)
  if (ctx.matrix.atWar[side] === 1) {
    if (managed()) mergeBack(ctx, country)
    return
  }
  if (ctx.tick % (PEACE_AI_EVERY_DAYS * 24) !== 0) return
  const tense = tenseNeighbors(ctx, country, neighbors)
  if (tense.length === 0) {
    if (!managed()) return
    const main = mergeBack(ctx, country)
    if (main) returnToGarrison(ctx, main)
    ctx.log(`${countryName(ctx, country)} : tensions apaisées, armées en garnison`, country)
    return
  }
  const cells = [
    ...new Set(tense.flatMap((n) => borderWith(ctx.grid, side, sideIndex(ctx, n)))),
  ].sort((a, b) => a - b)
  if (cells.length === 0) return
  const armies = armiesOf(ctx, country)
  const main = armies.find((a) => a.aiPeace === 'points') ?? armies.find((a) => a.wholeFront)
  if (!main) return
  let guard = armies.find((a) => a.aiPeace === 'border')
  if (!guard) {
    guard = detach(ctx, main, cells)
    if (!guard) return
    const names = tense.map((n) => countryName(ctx, n)).join(', ')
    ctx.log(`${countryName(ctx, country)} couvre sa frontière avec ${names}`, country)
  }
  if (guard.border?.join() !== cells.join()) {
    guard.border = cells
    assignFront(ctx, guard)
  }
  if (main.mission?.kind !== 'defendPoints') {
    main.aiPeace = 'points'
    main.mission = {
      kind: 'defendPoints',
      zone: null,
      kinds: { cities: true, ports: true, bases: true, airfields: false },
      points: [],
    }
    assignFront(ctx, main)
  }
}

/** Détache de l'armée principale les brigades de ligne les plus proches de la frontière tendue. */
function detach(ctx: SimContext, main: ArmyState, cells: number[]): ArmyState | undefined {
  const g = ctx.grid
  const step = Math.max(1, Math.floor(cells.length / 100))
  const sample = cells.filter((_, k) => k % step === 0).map((c) => [g.lonOf(c), g.latOf(c)])
  const near = (u: UnitState): number =>
    Math.min(...sample.map(([lon, lat]) => distanceKm(u.lon, u.lat, lon ?? 0, lat ?? 0)))
  const line = main.unitIds
    .map((id) => ctx.units.get(id))
    .filter((u): u is UnitState => !!u && isLineUnit(u.kind) && !u.direct)
  if (line.length < MIN_LINE_UNITS) return undefined
  const count = Math.max(1, Math.round(line.length * BORDER_SHARE))
  const picked = line
    .map((u) => ({ u, km: near(u) }))
    .sort((a, b) => a.km - b.km || a.u.id - b.u.id)
    .slice(0, count)
    .map((x) => x.u)
  const army: ArmyState = {
    id: ctx.allocId(),
    name: 'Armée des frontières',
    owner: main.owner,
    unitIds: picked.map((u) => u.id),
    front: null,
    wholeFront: false,
    offensive: null,
    posture: 'defensive',
    aiPeace: 'border',
  }
  const moved = new Set(army.unitIds)
  main.unitIds = main.unitIds.filter((id) => !moved.has(id))
  for (const u of picked) {
    u.armyId = army.id
    u.posture = 'defensive'
  }
  ctx.armies.set(army.id, army)
  return army
}
