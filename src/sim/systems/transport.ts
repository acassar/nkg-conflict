import { countryName, sideIndex, type CityRuntime, type SimContext } from '../context'
import type {
  CountryId,
  LonLat,
  SeaTransit,
  TransportMode,
  UnitKind,
  UnitState,
} from '../core/types'
import { RECRUIT_COSTS } from '../economy/rules'
import { distanceKm } from '../theater/grid'
import {
  atSea,
  EMBARK_HOURS,
  EMBARK_KM,
  heldPorts,
  leaveMap,
  MAX_LANDING_KM,
  navalCapacity,
  nearestPlace,
  OPPOSED_KM,
  portNames,
  SEA_KM_PER_HOUR,
} from './naval'
import { WarIndex } from './spatial'

/**
 * Transport stratégique provisoire (phase G, choix d'Adrien : option C). Une unité quitte la carte et
 * réapparaît dans une ville amie choisie après un délai qui dépend de la distance et du mode, pour un
 * coût en production. Trois modes, essayés dans cet ordre :
 * - rail : départ et arrivée reliés par un territoire ami continu (à soi, cobelligérant ou passage) ;
 * - mer : départ près d'un port tenu, arrivée dans un port ami, dans la limite de la capacité navale ;
 * - air : brigades légères seulement, entre deux grandes villes, quelques places à la fois.
 * Aucune interception possible pendant le trajet. Le rail suivra plus tard les voies sur la carte.
 */

/** Rayon autour du clic où l'on cherche la ville d'arrivée. */
export const DEST_PICK_KM = 60
/** Rail : chargement, puis vitesse moyenne d'un convoi militaire ; détour des voies sur la ligne droite. */
export const RAIL_LOAD_HOURS = 12
export const RAIL_KM_PER_HOUR = 25
export const RAIL_DETOUR = 1.3
/** Air : préparation, vitesse de croisière, portée, places à la fois et taille des aérodromes. */
export const AIR_LOAD_HOURS = 6
export const AIR_KM_PER_HOUR = 500
export const MAX_AIR_KM = 3000
export const AIR_CAPACITY = 2
export const AIRFIELD_POP = 200_000
/** Unités transportables par air (légères). */
export const AIR_KINDS: readonly UnitKind[] = ['inf', 'tdf', 'hq']
/**
 * Coût en production, en part du prix d'une unité neuve par 1 000 km (500 km au moins comptés) :
 * le rail est le moins cher, l'avion le plus cher.
 */
export const TRANSPORT_COST: Record<TransportMode, number> = { rail: 0.05, sea: 0.08, air: 0.25 }
const MIN_COST_KM = 500

export const MODE_NAMES: Record<TransportMode, string> = {
  rail: 'rail',
  sea: 'mer',
  air: 'air',
}

/** Territoire où un pays circule librement : le sien, celui des cobelligérants et des passages. */
function friendlyOwner(ctx: SimContext, side: number, owner: number): boolean {
  return (
    owner > 0 &&
    (owner === side || ctx.matrix.friendly(side, owner) || ctx.matrix.passage(side, owner))
  )
}

/** Ville d'arrivée possible : à un ami, la plus proche du point visé, à moins de DEST_PICK_KM. */
export function pickDestination(
  ctx: SimContext,
  country: CountryId,
  at: LonLat,
): CityRuntime | null {
  const side = sideIndex(ctx, country)
  let best: CityRuntime | null = null
  let bestKm = DEST_PICK_KM
  for (const c of ctx.cityStates.values()) {
    if (!friendlyOwner(ctx, side, c.owner)) continue
    const km = distanceKm(at[0], at[1], c.def.lon, c.def.lat)
    if (km <= bestKm) {
      best = c
      bestKm = km
    }
  }
  return best
}

const buffers = new WeakMap<object, { seen: Uint8Array; queue: Int32Array }>()

/**
 * Cellules reliées à `start` par un territoire ami (voisinage à 4), marquées 1 dans le tableau
 * renvoyé (valable jusqu'à l'appel suivant). Un seul parcours par ordre, quel que soit le nombre
 * d'unités.
 */
export function friendlyComponent(ctx: SimContext, side: number, start: number): Uint8Array {
  const g = ctx.grid
  // Tableaux réutilisés d'un ordre à l'autre (près de 5 millions de cellules sur la carte du monde).
  let buf = buffers.get(g)
  if (!buf) {
    buf = { seen: new Uint8Array(g.size), queue: new Int32Array(g.size) }
    buffers.set(g, buf)
  }
  const { seen, queue } = buf
  seen.fill(0)
  if (start < 0 || !g.passable(start) || !friendlyOwner(ctx, side, g.owner[start] ?? 0)) return seen
  let head = 0
  let tail = 0
  queue[tail++] = start
  seen[start] = 1
  const w = g.width
  // Propriétaires amis, calculés une fois (256 camps au plus).
  const ok = new Uint8Array(256)
  for (let o = 1; o < 256; o++) ok[o] = friendlyOwner(ctx, side, o) ? 1 : 0
  const visit = (k: number): void => {
    if (seen[k] || !ok[g.owner[k] ?? 0] || !g.passable(k)) return
    seen[k] = 1
    queue[tail++] = k
  }
  while (head < tail) {
    const i = queue[head++] ?? 0
    const x = i % w
    if (x > 0) visit(i - 1)
    if (x < w - 1) visit(i + 1)
    if (i >= w) visit(i - w)
    if (i + w < g.size) visit(i + w)
  }
  return seen
}

/** Durée du trajet (heures) selon le mode et la distance à vol d'oiseau (mer : comme un débarquement). */
export function transportHours(mode: TransportMode, km: number): number {
  if (mode === 'rail') return RAIL_LOAD_HOURS + Math.ceil((km * RAIL_DETOUR) / RAIL_KM_PER_HOUR)
  if (mode === 'sea') return EMBARK_HOURS + Math.ceil(km / SEA_KM_PER_HOUR)
  return AIR_LOAD_HOURS + Math.ceil(km / AIR_KM_PER_HOUR)
}

/** Coût en production du trajet d'une unité. */
export function transportCost(kind: UnitKind, mode: TransportMode, km: number): number {
  return (RECRUIT_COSTS[kind].production * TRANSPORT_COST[mode] * Math.max(km, MIN_COST_KM)) / 1000
}

export function inTransit(ctx: SimContext, country: CountryId): SeaTransit[] {
  return ctx.sea.filter((t) => t.unit.owner === country && !!t.mode)
}

function airborne(ctx: SimContext, country: CountryId): number {
  return ctx.sea.filter((t) => t.unit.owner === country && t.mode === 'air').length
}

/** Ville tenue la plus proche d'une unité, dans un rayon, parmi celles qui passent le filtre. */
function nearestHeld(
  cities: CityRuntime[],
  u: UnitState,
  maxKm: number,
  ok: (c: CityRuntime) => boolean = () => true,
): CityRuntime | null {
  let best: CityRuntime | null = null
  let bestKm = maxKm
  for (const c of cities) {
    if (!ok(c)) continue
    const km = distanceKm(u.lon, u.lat, c.def.lon, c.def.lat)
    if (km <= bestKm) {
      best = c
      bestKm = km
    }
  }
  return best
}

/**
 * Transport stratégique des unités vers la ville amie la plus proche du point visé. Chaque unité
 * prend le premier mode possible (rail, mer, air) ; une unité au contact de l'ennemi (moins de
 * OPPOSED_KM) ne part pas. Le coût est prélevé sur la production ; faute de production, les unités
 * suivantes restent sur place. Renvoie un message (erreur ou départ partiel) ou null.
 */
export function transportUnits(
  ctx: SimContext,
  country: CountryId,
  units: UnitState[],
  target: LonLat,
): string | null {
  const side = sideIndex(ctx, country)
  const eco = ctx.economies.get(country)
  if (!eco) return 'Pays sans économie'
  if (units.length === 0) return 'Aucune unité choisie'
  const dest = pickDestination(ctx, country, target)
  if (!dest) return `Choisissez une ville amie (à moins de ${DEST_PICK_KM} km du point visé)`
  const g = ctx.grid
  const destAt: LonLat = [dest.def.lon, dest.def.lat]
  const linked = friendlyComponent(ctx, side, g.cellAt(destAt[0], destAt[1]))
  const destIsPort = portNames(ctx).has(dest.def.name)
  const destAirfield = dest.def.pop >= AIRFIELD_POP
  const ports = heldPorts(ctx, country)
  const cities = [...ctx.cityStates.values()].filter((c) => c.owner === side)
  let seaFree = navalCapacity(ctx, country) - atSea(ctx, country).length
  let airFree = AIR_CAPACITY - airborne(ctx, country)
  const index = new WarIndex(ctx)
  const sent: Record<TransportMode, number> = { rail: 0, sea: 0, air: 0 }
  let engaged = 0
  let noRoute = 0
  let poor = 0
  let spent = 0
  for (const u of units) {
    const km = distanceKm(u.lon, u.lat, destAt[0], destAt[1])
    if (km < DEST_PICK_KM / 2) continue
    if (index.nearestEnemy(u, OPPOSED_KM)) {
      engaged++
      continue
    }
    let mode: TransportMode | null = null
    let from = ''
    if (linked[g.cellAt(u.lon, u.lat)] === 1) {
      mode = 'rail'
      from = nearestPlace(ctx, [u.lon, u.lat])
    } else {
      const port = destIsPort && seaFree > 0 ? nearestHeld(ports, u, EMBARK_KM) : null
      if (port && km <= MAX_LANDING_KM) {
        mode = 'sea'
        from = port.def.name
      } else if (destAirfield && airFree > 0 && AIR_KINDS.includes(u.kind) && km <= MAX_AIR_KM) {
        const field = nearestHeld(cities, u, EMBARK_KM, (c) => c.def.pop >= AIRFIELD_POP)
        if (field) {
          mode = 'air'
          from = field.def.name
        }
      }
    }
    if (!mode) {
      noRoute++
      continue
    }
    const cost = transportCost(u.kind, mode, km)
    if (eco.production < cost) {
      poor++
      continue
    }
    eco.production -= cost
    spent += cost
    const fromAt: LonLat = [u.lon, u.lat]
    leaveMap(ctx, u)
    ctx.sea.push({
      unit: u,
      port: from,
      to: destAt,
      from: fromAt,
      dest: dest.def.name,
      mode,
      departTick: ctx.tick,
      arriveTick: ctx.tick + transportHours(mode, km),
    })
    if (mode === 'sea') seaFree--
    if (mode === 'air') airFree--
    sent[mode]++
  }
  const total = sent.rail + sent.sea + sent.air
  if (total === 0) {
    if (engaged > 0 && noRoute === 0 && poor === 0)
      return "Unités au contact de l'ennemi : elles ne peuvent pas partir"
    if (poor > 0) return 'Production insuffisante pour le transport'
    if (noRoute > 0) return `Aucun trajet possible vers ${dest.def.name} (rail, mer ou air)`
    return `Unités déjà à ${dest.def.name}`
  }
  const modes = (Object.keys(sent) as TransportMode[])
    .filter((m) => sent[m] > 0)
    .map((m) => `${sent[m]} par ${MODE_NAMES[m]}`)
    .join(', ')
  ctx.log(
    `Transport vers ${dest.def.name} : ${modes} (${Math.round(spent)} de production)`,
    country,
  )
  const left = units.length - total
  return left > 0 ? `${total} unité(s) en route (${modes}) ; ${left} restent sur place` : null
}

/**
 * Arrivées du tick : l'unité apparaît dans sa ville d'arrivée, sans retranchement. Si la ville n'est
 * plus amie (prise, passage retiré), elle revient à son point de départ s'il l'est encore, sinon à la
 * ville tenue la plus proche ; sans ville tenue, elle est perdue.
 */
export function updateTransport(ctx: SimContext): void {
  if (ctx.sea.length === 0) return
  const due = ctx.sea.filter((t) => t.mode && t.arriveTick <= ctx.tick)
  if (due.length === 0) return
  ctx.sea = ctx.sea.filter((t) => !t.mode || t.arriveTick > ctx.tick)
  for (const t of due) {
    const u = t.unit
    const side = sideIndex(ctx, u.owner)
    const dest = t.dest ? ctx.cityStates.get(t.dest) : undefined
    let at: LonLat | null = null
    if (dest && friendlyOwner(ctx, side, dest.owner)) {
      at = [dest.def.lon, dest.def.lat]
      ctx.log(`${u.name} arrive à ${dest.def.name}`, u.owner, true)
    } else {
      const from = t.from
      const back =
        from && friendlyOwner(ctx, side, ctx.grid.owner[ctx.grid.cellAt(from[0], from[1])] ?? 0)
      if (from && back) at = from
      else {
        const held = [...ctx.cityStates.values()].filter((c) => c.owner === side)
        const near = nearestHeld(held, u, Infinity)
        if (near) at = [near.def.lon, near.def.lat]
      }
      if (!at) {
        ctx.log(`${u.name} perdue en route : plus aucune ville tenue`, u.owner)
        continue
      }
      ctx.log(
        `${u.name} ne peut rejoindre ${t.dest ?? 'sa destination'} (${countryName(ctx, ctx.sides[dest?.owner ?? 0] ?? null)}) : retour près de ${nearestPlace(ctx, at)}`,
        u.owner,
      )
    }
    u.lon = at[0]
    u.lat = at[1]
    u.order = { kind: 'hold' }
    u.path = []
    u.entrench = 0
    ctx.units.set(u.id, u)
  }
}
