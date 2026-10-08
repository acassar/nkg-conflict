import { sideIndex, type SimContext } from '../context'
import type { ArmyState, CountryDef, LonLat, UnitKind, UnitState } from '../core/types'
import { assignFront, frontCells } from '../systems/armies'
import { unitName } from '../units/names'

/** Unité à lever : position et effectifs facultatifs (déploiement automatique sinon). */
interface UnitSpec {
  kind: UnitKind
  name: string
  lon?: number
  lat?: number
  strength?: number
}

/** Répartition des unités levées à la mobilisation (parts, arrondies). */
const COMPOSITION: Array<[UnitKind, number]> = [
  ['inf', 0.4],
  ['mech', 0.2],
  ['tank', 0.12],
  ['art', 0.12],
  ['log', 0.08],
  ['hq', 0.08],
]

/** Ordre de bataille d'un pays de `size` unités : au moins un QG, une logistique au-delà de 6 unités. */
export function forceComposition(size: number): Record<UnitKind, number> {
  const out: Record<UnitKind, number> = { inf: 0, mech: 0, tank: 0, art: 0, log: 0, hq: 0 }
  let left = size
  for (const [kind, share] of COMPOSITION) {
    const n = Math.min(left, Math.floor(size * share))
    out[kind] = n
    left -= n
  }
  out.inf += left
  if (out.hq === 0 && size > 1) {
    out.hq = 1
    out.inf = Math.max(0, out.inf - 1)
  }
  if (out.log === 0 && size > 6) {
    out.log = 1
    out.inf = Math.max(0, out.inf - 1)
  }
  return out
}

/** Point d'ancrage d'un pays : sa capitale tenue, sinon sa plus grande ville, sinon son centre. */
export function homeOf(ctx: SimContext, country: CountryDef): LonLat {
  const side = sideIndex(ctx, country.id)
  let best: { pop: number; at: LonLat; capital: boolean } | null = null
  for (const c of ctx.cityStates.values()) {
    if (c.owner !== side) continue
    const score = { pop: c.def.pop, at: [c.def.lon, c.def.lat] as LonLat, capital: c.def.capital }
    if (
      !best ||
      (score.capital && !best.capital) ||
      (score.capital === best.capital && score.pop > best.pop)
    ) {
      best = score
    }
  }
  return best?.at ?? country.label ?? [0, 0]
}

/**
 * Lève les forces d'un pays : unités créées, regroupées dans une armée qui tient tout le front,
 * déployées le long du front si le pays en a un, sinon autour de sa capitale.
 */
export function mobilize(
  ctx: SimContext,
  country: CountryDef,
  armyName: string,
  explicit?: UnitSpec[],
): void {
  const pol = ctx.politics.countries.get(country.id)
  if (!pol || pol.mobilized) return
  pol.mobilized = true
  const eco = ctx.economies.get(country.id)

  const army: ArmyState = {
    id: ctx.allocId(),
    name: armyName,
    owner: country.id,
    unitIds: [],
    front: null,
    wholeFront: true,
    offensive: null,
  }
  const defs: UnitSpec[] =
    explicit ??
    Object.entries(forceComposition(pol.forceSize)).flatMap(([kind, n]) =>
      Array.from({ length: n }, () => {
        const k = kind as UnitKind
        const number = eco ? eco.unitCounters[k]++ : 1
        return { kind: k, name: unitName(k, number) }
      }),
    )
  const home = homeOf(ctx, country)
  const fixed = new Set<number>()
  for (const [k, def] of defs.entries()) {
    const u: UnitState = {
      id: ctx.allocId(),
      name: def.name,
      owner: country.id,
      kind: def.kind,
      lon: def.lon ?? home[0] + ((k % 5) - 2) * 0.15,
      lat: def.lat ?? home[1] + (Math.floor(k / 5) % 5) * 0.1 - 0.2,
      strength: def.strength ?? 1,
      org: 1,
      entrench: 0.5,
      order: { kind: 'hold' },
      path: [],
      armyId: army.id,
      hoursOutOfSupply: 0,
    }
    if (def.lon !== undefined) fixed.add(u.id)
    ctx.units.set(u.id, u)
    army.unitIds.push(u.id)
  }
  ctx.armies.set(army.id, army)
  if (eco && explicit) {
    for (const def of explicit) eco.unitCounters[def.kind]++
  }
  // Déploiement immédiat sur le front (les unités sans position fixée).
  if (frontCells(ctx, sideIndex(ctx, country.id), null).length > 0) {
    assignFront(ctx, { ...army, unitIds: army.unitIds.filter((id) => !fixed.has(id)) }, true)
  }
}

/** Taille des forces d'un pays selon son PIB et sa population, corrigée par un facteur de militarisation. */
export function forceSizeOf(
  gdpBillions: number,
  popMillions: number,
  militarization = 1,
  cap = 45,
): number {
  const base =
    3 + 0.6 * Math.sqrt(Math.max(0, gdpBillions)) + 0.4 * Math.sqrt(Math.max(0, popMillions))
  return Math.max(3, Math.min(cap, Math.round(base * militarization)))
}
