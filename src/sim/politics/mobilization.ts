import { createNamedFormation, updateFormations } from '../systems/formations'
import { type CountryForces, type ForceArmy, type ForceDivision } from '../scenarios/forces'
import { BRIGADE_TEMPLATES } from '../units/templates'
import { runtimeOf, sideIndex, type SimContext } from '../context'
import type { ArmyState, CountryDef, LonLat, UnitKind, UnitState } from '../core/types'
import { assignFront, frontCells, LARGE_GRID_CELLS } from '../systems/armies'
import { planPath } from '../systems/movement'
import { distanceKm } from '../theater/grid'
import { unitName } from '../units/names'

/** Unité à lever : position et effectifs facultatifs (déploiement automatique sinon). */
interface UnitSpec {
  kind: UnitKind
  name: string
  /** Modèle de brigade (absent : celui du rôle). */
  template?: string
  lon?: number
  lat?: number
  strength?: number
}

/** Répartition des unités levées à la mobilisation (parts, arrondies). */
const COMPOSITION: Array<[UnitKind, number]> = [
  ['inf', 0.45],
  ['mech', 0.22],
  ['tank', 0.14],
  ['art', 0.13],
  ['log', 0.03],
  ['hq', 0.03],
]

/**
 * Ordre de bataille d'un pays de `size` unités : au moins un QG, une logistique au-delà de
 * 6 unités.
 */
export function forceComposition(size: number): Record<UnitKind, number> {
  const out: Record<UnitKind, number> = { inf: 0, mech: 0, tank: 0, art: 0, log: 0, hq: 0, tdf: 0 }
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

/** Ramène un point sur la terre ferme du camp (pion tombé en mer, ville côtière). */
export function onOwnLand(ctx: SimContext, side: number, lon: number, lat: number): LonLat | null {
  const g = ctx.grid
  const ok = (i: number): boolean => i >= 0 && g.passable(i) && g.owner[i] === side
  if (ok(g.cellAt(lon, lat))) return [lon, lat]
  for (const km of [15, 40, 100, 250]) {
    let best = -1
    let bestD = Infinity
    g.cellsWithin(lon, lat, km, (i) => {
      if (!ok(i)) return
      const d = (g.lonOf(i) - lon) ** 2 + (g.latOf(i) - lat) ** 2
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    if (best >= 0) return [g.lonOf(best), g.latOf(best)]
  }
  return null
}

/** Rayon autour d'une ville dans lequel un pion compte comme déjà en garnison (ou recrue) là. */
const CITY_SPOT_KM = 25

/**
 * `n`-ième place autour d'une ville, sur une petite spirale (~8 km entre pions). Le premier pion se
 * pose à côté de la ville, pas dessus : le nom de la ville reste visible.
 */
export function spotNear(
  ctx: SimContext,
  side: number,
  lon: number,
  lat: number,
  n: number,
): LonLat | null {
  const angle = n * 2.4
  const r = 0.12 + 0.035 * Math.sqrt(n)
  return onOwnLand(ctx, side, lon + r * Math.cos(angle), lat + r * Math.sin(angle) * 0.7)
}

/** Pions du pays à moins de CITY_SPOT_KM d'un point, sauf ceux de `skip`. */
export function unitsNear(
  ctx: SimContext,
  country: string,
  lon: number,
  lat: number,
  skip?: ReadonlySet<number>,
): number {
  let n = 0
  for (const u of ctx.units.values()) {
    if (u.owner !== country || skip?.has(u.id)) continue
    if (distanceKm(u.lon, u.lat, lon, lat) < CITY_SPOT_KM) n++
  }
  return n
}

/**
 * Emplacements de garnison de `count` unités : réparties entre les villes du pays au prorata de leur
 * population (la capitale en premier), avec un léger décalage pour que les pions ne se superposent pas.
 * `skip` : unités à placer, déjà sur la carte ; les autres pions du pays près d'une ville y comptent
 * comme déjà en garnison (retour d'une armée à la paix).
 */
function garrisons(
  ctx: SimContext,
  country: CountryDef,
  count: number,
  skip?: ReadonlySet<number>,
): Array<LonLat | null> {
  const side = sideIndex(ctx, country.id)
  const cities = [...ctx.cityStates.values()]
    .filter((c) => c.owner === side)
    .sort((a, b) => Number(b.def.capital) - Number(a.def.capital) || b.def.pop - a.def.pop)
  if (cities.length === 0) {
    const home = homeOf(ctx, country)
    return Array.from({ length: count }, (_, k): LonLat | null =>
      onOwnLand(
        ctx,
        side,
        home[0] + ((k % 5) - 2) * 0.15,
        home[1] + (Math.floor(k / 5) % 5) * 0.1 - 0.2,
      ),
    )
  }
  // Part de chaque ville (racine de la population : les petites villes ont aussi leur garnison).
  const weights = cities.map((c) => Math.sqrt(c.def.pop) * (c.def.capital ? 2 : 1))
  const total = weights.reduce((a, b) => a + b, 0)
  const placed = cities.map((c) =>
    skip ? unitsNear(ctx, country.id, c.def.lon, c.def.lat, skip) : 0,
  )
  const all = count + placed.reduce((a, b) => a + b, 0)
  const quota = weights.map((w) => (w / total) * all)
  const out: Array<LonLat | null> = []
  for (let k = 0; k < count; k++) {
    // Ville la plus en retard sur son quota.
    let best = 0
    for (let i = 1; i < cities.length; i++) {
      if ((quota[i] ?? 0) - (placed[i] ?? 0) > (quota[best] ?? 0) - (placed[best] ?? 0)) best = i
    }
    const n = placed[best] ?? 0
    placed[best] = n + 1
    const c = cities[best]
    if (!c) continue
    out.push(spotNear(ctx, side, c.def.lon, c.def.lat, n))
  }
  return out
}

/**
 * Retour en garnison (fin d'une guerre) : les unités de l'armée rejoignent les villes de leur pays,
 * réparties comme au départ, et s'y retranchent. Les unités sous ordre direct du joueur ou en déroute
 * restent où elles sont. Renvoie le nombre d'unités envoyées.
 */
export function returnToGarrison(ctx: SimContext, army: ArmyState): number {
  const country = ctx.countries.get(army.owner)
  if (!country) return 0
  const units = army.unitIds
    .map((id) => ctx.units.get(id))
    .filter(
      (u): u is UnitState =>
        !!u && (!u.direct || u.direct.doneAt !== undefined) && !runtimeOf(ctx, u.id).routed,
    )
  if (units.length === 0) return 0
  const spots = garrisons(ctx, country, units.length, new Set(units.map((u) => u.id)))
  // Les plus proches d'abord : chaque unité prend la place libre la plus proche d'elle.
  const free = spots.map((s, k) => ({ s, k })).filter((x): x is { s: LonLat; k: number } => !!x.s)
  let sent = 0
  for (const u of units) {
    let best = -1
    let bestKm = Infinity
    free.forEach((f, i) => {
      const km = distanceKm(u.lon, u.lat, f.s[0], f.s[1])
      if (km < bestKm) {
        bestKm = km
        best = i
      }
    })
    const spot = free[best]
    if (!spot) break
    free.splice(best, 1)
    delete u.direct
    u.order = { kind: 'move', target: spot.s }
    if (ctx.grid.size > LARGE_GRID_CELLS) {
      u.path = []
      runtimeOf(ctx, u.id).pathPending = true
    } else planPath(ctx, u, spot.s)
    sent++
  }
  return sent
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
  const spots = garrisons(ctx, country, defs.length)
  const fixed = new Set<number>()
  for (const [k, def] of defs.entries()) {
    const spot = spots[k]
    // Pas de terre ferme pour cette garnison (territoire minuscule ou impraticable).
    if (def.lon === undefined && !spot) continue
    const u: UnitState = {
      id: ctx.allocId(),
      name: def.name,
      owner: country.id,
      kind: def.kind,
      lon: def.lon ?? spot?.[0] ?? 0,
      lat: def.lat ?? spot?.[1] ?? 0,
      strength: def.strength ?? 1,
      org: 1,
      entrench: 0.5,
      order: { kind: 'hold' },
      path: [],
      armyId: army.id,
      hoursOutOfSupply: 0,
      ...(def.template ? { template: def.template } : {}),
    }
    if (def.lon !== undefined) fixed.add(u.id)
    ctx.units.set(u.id, u)
    army.unitIds.push(u.id)
  }
  ctx.armies.set(army.id, army)
  if (eco && explicit) {
    for (const def of explicit) eco.unitCounters[def.kind]++
  }
  // Déploiement immédiat sur le front (les unités sans position fixée), puis divisions et corps formés
  // de brigades voisines sur le front (ou dans leurs garnisons). Second déploiement : chaque division
  // prend son secteur dès le départ, sans remaniement au premier jour.
  const front = frontCells(ctx, sideIndex(ctx, country.id), null).length > 0
  const deployed = { ...army, unitIds: army.unitIds.filter((id) => !fixed.has(id)) }
  if (front) assignFront(ctx, deployed, true)
  updateFormations(ctx, army)
  if (front) assignFront(ctx, deployed, true)
}

/**
 * Taille des forces d'un pays, en unités (brigades pour l'essentiel), selon son PIB et sa population,
 * corrigée par un facteur de militarisation (3 à 45 unités). Remplacée par les ordres de bataille réels
 * à l'étape « Scénarios » de la phase D3.
 */
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

/**
 * Front d'une armée au départ : tout le front, une portion, aucun (garnison), ou la réserve derrière
 * tout le front (armée sans secteur connu : elle intervient sur les percées).
 */
export type ForceFront = 'whole' | 'reserve' | [LonLat, LonLat] | null

/**
 * Lève les forces d'un ordre de bataille (scenarios/forces.ts) : une armée par armée de l'ordre de
 * bataille, ses corps et ses divisions nommés, ses brigades avec leur modèle, un QG et sa logistique.
 * Les unités partent en garnison ; une armée qui a un front (`frontOf`, tout le front par défaut, comme
 * `mobilize`) s'y déploie si le pays est en guerre. Renvoie le nombre
 * d'unités levées.
 */
export function mobilizeForces(
  ctx: SimContext,
  country: CountryDef,
  forces: CountryForces,
  frontOf: (army: ForceArmy) => ForceFront = () => 'whole',
): number {
  const pol = ctx.politics.countries.get(country.id)
  if (pol?.mobilized) return 0
  if (pol) pol.mobilized = true
  const eco = ctx.economies.get(country.id)
  const specs: Array<{
    army: ArmyState
    division: number | null
    def: UnitSpec
    /** Direction connue du corps : ses brigades y partent (ordre des corps le long du front). */
    sector?: LonLat
  }> = []
  const armies: Array<{ army: ArmyState; front: ForceFront }> = []
  for (const fa of forces.armies) {
    const front = frontOf(fa)
    const army: ArmyState = {
      id: ctx.allocId(),
      name: fa.name,
      owner: country.id,
      unitIds: [],
      front: Array.isArray(front) ? front : null,
      wholeFront: front === 'whole' || front === 'reserve',
      offensive: null,
      ...(front === 'reserve' ? { mission: { kind: 'reserve' as const } } : {}),
    }
    ctx.armies.set(army.id, army)
    armies.push({ army, front })
    const addDivision = (d: ForceDivision, parentId: number | null, sector?: LonLat): void => {
      const f = createNamedFormation(ctx, country.id, 'division', army.id, d.name, {
        template: d.template,
        parentId,
        generated: d.generated,
      })
      for (const b of d.brigades) {
        const kind = BRIGADE_TEMPLATES[b.template]?.kind ?? 'inf'
        specs.push({
          army,
          division: f.id,
          def: { kind, name: b.name, template: b.template },
          ...(sector ? { sector } : {}),
        })
        if (eco) eco.unitCounters[kind]++
      }
    }
    for (const c of fa.corps) {
      const corps = createNamedFormation(ctx, country.id, 'corps', army.id, c.name)
      for (const d of c.divisions) addDivision(d, corps.id, c.sector)
    }
    for (const d of fa.divisions) addDivision(d, null)
    // QG et logistique intégrés aux corps et aux armées (systems/command.ts) : pas de pion.
  }
  const spots = garrisons(ctx, country, specs.length)
  // Une division qui part au front part groupée : ses brigades partagent la garnison de la première,
  // pour prendre des postes voisins en se déployant. En garnison, elles restent réparties.
  const atWar = ctx.matrix.atWar[sideIndex(ctx, country.id)] === 1
  const deployed = new Set(armies.filter((a) => atWar && a.front !== null).map((a) => a.army.id))
  const divisionSpot = new Map<number, LonLat>()
  for (const [k, { army, division, def, sector }] of specs.entries()) {
    let spot = spots[k]
    if (!spot) continue
    if (division !== null && deployed.has(army.id)) {
      const first = sector ?? divisionSpot.get(division)
      if (first) spot = first
      else divisionSpot.set(division, spot)
    }
    const fill = def.template ? (forces.fill ?? 1) : 1
    const u: UnitState = {
      id: ctx.allocId(),
      name: def.name,
      owner: country.id,
      kind: def.kind,
      lon: spot[0],
      lat: spot[1],
      // Brigades en sous-effectif quand l'armée réelle l'est (QG et logistique au complet) : il leur
      // manque des hommes, pas du matériel, et les renforts ne comblent que les pertes.
      strength: fill,
      equipment: 1,
      ...(fill < 1 ? { establishment: fill } : {}),
      org: 1,
      entrench: 0.5,
      order: { kind: 'hold' },
      path: [],
      armyId: army.id,
      hoursOutOfSupply: 0,
      ...(def.template ? { template: def.template } : {}),
      ...(division !== null ? { divisionId: division } : {}),
    }
    ctx.units.set(u.id, u)
    army.unitIds.push(u.id)
  }
  // Armées sans unité (territoire minuscule) : retirées, avec leurs formations.
  for (const { army } of armies) if (army.unitIds.length === 0) ctx.armies.delete(army.id)
  updateFormations(ctx)
  // Déploiement immédiat sur le front des armées qui en ont un ; deux fois, comme `mobilize`, pour que
  // chaque division prenne son secteur dès le départ.
  for (const { army, front } of armies) {
    if (front === null || !ctx.armies.has(army.id)) continue
    assignFront(ctx, army, true)
    assignFront(ctx, army, true)
  }
  return specs.length
}

/** Demi-largeur minimale d'un secteur de départ, en km de part et d'autre de ses ancres. */
export const SECTOR_HALF_KM = 40

/**
 * Portion de front d'un secteur de départ : du point du front le plus proche de la première ancre à
 * celui de la dernière (dans l'ordre du front), élargie de SECTOR_HALF_KM de chaque côté. Null : pas
 * de front.
 */
export function sectorFront(
  ctx: SimContext,
  side: number,
  anchors: LonLat[],
): [LonLat, LonLat] | null {
  const cells = frontCells(ctx, side, null)
  if (cells.length === 0 || anchors.length === 0) return null
  const g = ctx.grid
  const at = (k: number): LonLat => {
    const c = cells[k]?.cell ?? 0
    return [g.lonOf(c), g.latOf(c)]
  }
  let lo = cells.length
  let hi = -1
  for (const [lon, lat] of anchors) {
    let best = 0
    let bestKm = Infinity
    for (let k = 0; k < cells.length; k++) {
      const p = at(k)
      const km = distanceKm(lon, lat, p[0], p[1])
      if (km < bestKm) {
        best = k
        bestKm = km
      }
    }
    lo = Math.min(lo, best)
    hi = Math.max(hi, best)
  }
  const [loLon, loLat] = at(lo)
  const [hiLon, hiLat] = at(hi)
  while (lo > 0 && distanceKm(...at(lo - 1), loLon, loLat) < SECTOR_HALF_KM) lo--
  while (hi < cells.length - 1 && distanceKm(...at(hi + 1), hiLon, hiLat) < SECTOR_HALF_KM) hi++
  return [at(lo), at(hi)]
}
