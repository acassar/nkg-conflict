import { runtimeOf, sideIndex, type SimContext } from '../context'
import {
  isOffensiveOrder,
  type CountryId,
  type LonLat,
  type ModifierKey,
  type UnitState,
} from '../core/types'
import { distanceKm, Terrain, terrainRule } from '../theater/grid'
import { fortFactor, useMunitions } from '../economy/economy'
import { NO_MUNITIONS_FACTOR } from '../economy/rules'
import { moraleFactor } from '../politics/politics'
import { WarIndex } from './spatial'
import { fatigueFactor, fatigueOf, fatigueRecoveryFactor, updateFatigue } from './fatigue'
import { postureOf } from '../units/postures'
import { assaultFireFactor, assaultLossFactor, obstaclesUnder } from './obstacles'
import { flankDefenseFactor, flankOrgLossFactor, flankText, updateFlanks } from './flanks'
import {
  kindTerrainAttack,
  kindTerrainDefense,
  matchup,
  MUNITIONS_PER_SHOT_BY_KIND,
} from '../units/kinds'

/** Distance à laquelle deux unités ennemies sont au contact et combattent. */
export const CONTACT_KM = 10
/** Seuil d'organisation sous lequel une unité décroche. */
export const ROUT_ORG = 0.15
/** Organisation à retrouver pour redevenir apte au combat. */
export const RALLY_ORG = 0.5

const STRENGTH_LOSS = 0.0025
const ORG_LOSS = 0.02
const ARTILLERY_FACTOR = 0.6
export const OUT_OF_SUPPLY_FACTOR = 0.6
/** Bonus de combat d'une unité commandée par un QG proche. */
export const COMMAND_FACTOR = 1.15
/** Récupération d'organisation hors combat, par heure (ravitaillée / commandée en plus). */
const ORG_RECOVERY = 0.01
const ORG_RECOVERY_COMMAND = 0.005

function commandFactor(ctx: SimContext, u: UnitState): number {
  return runtimeOf(ctx, u.id).commanded ? COMMAND_FACTOR : 1
}

/** Marque les unités à portée d'un QG de leur camp qui n'est pas en déroute. */
export function updateCommand(ctx: SimContext): void {
  const hqsByOwner = new Map<string, UnitState[]>()
  for (const u of ctx.units.values()) {
    if (ctx.catalog[u.kind].commandRadiusKm <= 0 || runtimeOf(ctx, u.id).routed) continue
    const list = hqsByOwner.get(u.owner)
    if (list) list.push(u)
    else hqsByOwner.set(u.owner, [u])
  }
  for (const u of ctx.units.values()) {
    const hqs = hqsByOwner.get(u.owner) ?? []
    runtimeOf(ctx, u.id).commanded = hqs.some(
      (h) =>
        h.id !== u.id &&
        distanceKm(h.lon, h.lat, u.lon, u.lat) <= ctx.catalog[h.kind].commandRadiusKm,
    )
  }
}

function supplyFactor(ctx: SimContext, u: UnitState): number {
  return runtimeOf(ctx, u.id).supplied ? 1 : OUT_OF_SUPPLY_FACTOR
}

function terrainDefense(ctx: SimContext, u: UnitState): number {
  const t = ctx.grid.terrain[ctx.grid.cellAt(u.lon, u.lat)]
  return terrainRule(t).defense * kindTerrainDefense(u.kind, t)
}

/** Terrain sous une unité. */
function terrainUnder(ctx: SimContext, u: UnitState): number | undefined {
  return ctx.grid.terrain[ctx.grid.cellAt(u.lon, u.lat)]
}

/** Effet du terrain sur la puissance de feu du type de l'unité (blindés en forêt…). */
function terrainAttack(ctx: SimContext, u: UnitState): number {
  return kindTerrainAttack(u.kind, terrainUnder(ctx, u))
}

/** Cible de l'artillerie pour l'écran de bataille : l'ennemi le plus proche à portée. */
function artilleryTarget(ctx: SimContext, u: UnitState): UnitState | undefined {
  const range = ctx.catalog[u.kind].supportRangeKm
  const side = sideIndex(ctx, u.owner)
  let best: UnitState | undefined
  let bestD = range
  for (const e of ctx.units.values()) {
    if (!ctx.matrix.hostile(side, sideIndex(ctx, e.owner))) continue
    const d = distanceKm(u.lon, u.lat, e.lon, e.lat)
    if (d <= bestD) {
      bestD = d
      best = e
    }
  }
  return best
}

/** Vrai si un fleuve sépare les deux unités (échantillonnage du segment). */
export function riverBetween(ctx: SimContext, a: UnitState, b: UnitState): boolean {
  for (let k = 1; k < 6; k++) {
    const t = k / 6
    const c = ctx.grid.cellAt(a.lon + (b.lon - a.lon) * t, a.lat + (b.lat - a.lat) * t)
    if (ctx.grid.terrain[c] === Terrain.RIVER) return true
  }
  return false
}

/** Modificateur, pour l'écran de bataille : clé (aide en jeu), libellé et facteur multiplicatif. */
export interface Modifier {
  key: ModifierKey
  label: string
  value: number
}

/**
 * Détail des modificateurs d'une unité (mêmes règles que le combat) : ce qui multiplie sa puissance
 * de feu et sa défense.
 */
export function combatModifiers(
  ctx: SimContext,
  u: UnitState,
): { attack: Modifier[]; defense: Modifier[] } {
  const posture = postureOf(u.posture)
  const shared: Modifier[] = [
    { key: 'strength', label: 'Effectifs', value: u.strength },
    { key: 'org', label: 'Organisation', value: 0.25 + 0.75 * u.org },
    { key: 'supply', label: 'Ravitaillement', value: supplyFactor(ctx, u) },
    { key: 'command', label: 'Commandement', value: commandFactor(ctx, u) },
  ]
  if (fatigueOf(u) >= 0.01) {
    shared.push({
      key: 'fatigue',
      label: `Fatigue (${Math.round(fatigueOf(u) * 100)} %)`,
      value: fatigueFactor(u),
    })
  }
  const eco = ctx.economies.get(u.owner)
  const ammo = eco && eco.munitions <= 0 ? NO_MUNITIONS_FACTOR : 1
  const cell = ctx.grid.cellAt(u.lon, u.lat)
  // Obstacles : les siens freinent les assauts adverses, ceux de l'adversaire freinent ses assauts.
  const own = obstaclesUnder(ctx, u)
  const engaged = runtimeOf(ctx, u.id).engagedWith
  const foe = engaged !== null ? ctx.units.get(engaged) : undefined
  const theirs = foe && isOffensive(u) ? obstaclesUnder(ctx, foe) : 0
  const pctOf = (v: number): string => `${Math.round(v * 100)} %`
  const flank = runtimeOf(ctx, u.id).flank
  const type = ctx.catalog[u.kind].name
  const tName = terrainRule(ctx.grid.terrain[cell]).name.toLowerCase()
  const tAttack = terrainAttack(ctx, u)
  const tDefense = kindTerrainDefense(u.kind, ctx.grid.terrain[cell])
  const shotAt = ctx.catalog[u.kind].supportRangeKm > 0 ? artilleryTarget(ctx, u) : foe
  const vs = shotAt ? matchup(u, shotAt, terrainUnder(ctx, shotAt)) : null
  return {
    attack: [
      ...shared,
      { key: 'posture', label: `Posture (${posture.name})`, value: posture.attack },
      { key: 'ammo', label: 'Munitions', value: ammo },
      ...(tAttack !== 1
        ? ([{ key: 'kindTerrain', label: `${type} (${tName})`, value: tAttack }] as Modifier[])
        : []),
      ...(vs ? ([{ key: 'matchup', label: vs.label, value: vs.factor }] as Modifier[]) : []),
      ...(theirs > 0
        ? ([
            {
              key: 'enemyObstacles',
              label: `Obstacles adverses (${pctOf(theirs)})`,
              value: assaultFireFactor(theirs),
            },
          ] as Modifier[])
        : []),
    ],
    defense: [
      ...shared,
      {
        key: 'terrain',
        label: `Terrain (${terrainRule(ctx.grid.terrain[cell]).name})`,
        value: terrainRule(ctx.grid.terrain[cell]).defense,
      },
      ...(tDefense !== 1
        ? ([{ key: 'kindTerrain', label: `${type} (${tName})`, value: tDefense }] as Modifier[])
        : []),
      { key: 'entrench', label: 'Retranchement', value: 1 + 0.5 * u.entrench },
      { key: 'fort', label: 'Fortifications', value: fortFactor(ctx, u) },
      { key: 'posture', label: `Posture (${posture.name})`, value: posture.defense },
      ...(own > 0
        ? ([
            {
              key: 'ownObstacles',
              label: `Obstacles contre l'assaut (${pctOf(own)})`,
              value: 1 / assaultFireFactor(own),
            },
          ] as Modifier[])
        : []),
      ...(theirs > 0
        ? ([
            {
              key: 'obstacleLosses',
              label: 'Pertes sous les obstacles',
              value: 1 / assaultLossFactor(theirs),
            },
          ] as Modifier[])
        : []),
      ...(flank
        ? ([
            {
              key: 'flank',
              label: `Flanc (${flankText(flank)})`,
              value: flankDefenseFactor(ctx, u),
            },
            { key: 'flankMorale', label: 'Moral (flanc)', value: 1 / flankOrgLossFactor(ctx, u) },
          ] as Modifier[])
        : []),
    ],
  }
}

function isOffensive(u: UnitState): boolean {
  return isOffensiveOrder(u.order.kind)
}

/** Valeur de combat effective, sans unité. */
export function firePower(ctx: SimContext, u: UnitState): number {
  const type = ctx.catalog[u.kind]
  const base = isOffensive(u) ? type.attack : type.defense
  return (
    base *
    u.strength *
    (0.25 + 0.75 * u.org) *
    supplyFactor(ctx, u) *
    commandFactor(ctx, u) *
    postureOf(u.posture).attack *
    terrainAttack(ctx, u) *
    fatigueFactor(u)
  )
}

export function defenseValue(ctx: SimContext, u: UnitState): number {
  const type = ctx.catalog[u.kind]
  return (
    type.defense *
    u.strength *
    (0.25 + 0.75 * u.org) *
    supplyFactor(ctx, u) *
    commandFactor(ctx, u) *
    terrainDefense(ctx, u) *
    fortFactor(ctx, u) *
    (1 + 0.5 * u.entrench) *
    postureOf(u.posture).defense *
    flankDefenseFactor(ctx, u) *
    fatigueFactor(u)
  )
}

function hit(
  ctx: SimContext,
  from: UnitState,
  target: UnitState,
  factor: number,
  direct: boolean,
): void {
  let defense = defenseValue(ctx, target)
  if (isOffensive(from) && riverBetween(ctx, from, target)) defense *= 1.4
  // Chaque tir consomme des munitions, selon le type (l'artillerie bien plus que l'infanterie).
  const ammo = useMunitions(ctx, from.owner, MUNITIONS_PER_SHOT_BY_KIND[from.kind])
  let fire = firePower(ctx, from) * ammo
  // Rapport de force entre types (blindés à découvert, infanterie retranchée en ville, artillerie).
  const vs = matchup(from, target, terrainUnder(ctx, target))
  if (vs) fire *= vs.factor
  // Obstacles (tir direct seulement) : l'assaut perd de sa force, l'attaquant saigne davantage.
  let losses = 1
  if (direct && isOffensive(from)) fire *= assaultFireFactor(obstaclesUnder(ctx, target))
  if (direct && isOffensive(target) && !isOffensive(from)) {
    losses = assaultLossFactor(obstaclesUnder(ctx, from))
  }
  const ratio = Math.min(4, fire / Math.max(0.05, defense))
  const roll = ctx.rng.range(0.8, 1.2)
  const lost = Math.min(target.strength, STRENGTH_LOSS * ratio * roll * factor * losses)
  target.strength -= lost
  ctx.losses.set(target.owner, (ctx.losses.get(target.owner) ?? 0) + lost)
  // Prise de flanc : le moral cède plus vite.
  const orgLoss = ORG_LOSS * ratio * roll * factor * flankOrgLossFactor(ctx, target)
  target.org = Math.max(0, target.org - orgLoss)
}

/** Une heure de combat : contacts, tirs, appui d'artillerie, décrochages, unités détruites. */
export function updateCombat(ctx: SimContext): void {
  const units = [...ctx.units.values()]
  const index = new WarIndex(ctx)

  // 1. Contacts (seules les unités des camps en guerre peuvent en avoir).
  // Les unités au repos (en paix, intactes, ravitaillées) n'ont rien à mettre à jour à l'étape 4 :
  // sur la carte du monde, cela écarte les milliers de garnisons des pays en paix.
  const active: UnitState[] = []
  for (const u of units) {
    const rt = runtimeOf(ctx, u.id)
    const atWar = index.has(u)
    const e = atWar ? index.nearestEnemy(u, CONTACT_KM) : null
    rt.engagedWith = e ? e.id : null
    if (
      atWar ||
      u.org < 1 ||
      !rt.supplied ||
      rt.routed ||
      u.hoursOutOfSupply > 0 ||
      u.strength < 0.05 ||
      fatigueOf(u) > 0
    ) {
      active.push(u)
    }
  }
  // Flancs : directions d'où viennent les ennemis des unités au contact, saillants.
  updateFlanks(ctx, index)

  // 2. Tirs directs (chaque unité au contact frappe son adversaire le plus proche).
  for (const u of index.units) {
    const rt = runtimeOf(ctx, u.id)
    if (rt.engagedWith === null || rt.routed) continue
    const target = ctx.units.get(rt.engagedWith)
    if (target) hit(ctx, u, target, 1, true)
  }

  // 3. Artillerie : frappe l'ennemi le plus proche à portée, même sans contact direct.
  for (const u of index.units) {
    const range = ctx.catalog[u.kind].supportRangeKm
    if (range <= 0 || runtimeOf(ctx, u.id).routed) continue
    const target = index.nearestEnemy(u, range)
    if (target) hit(ctx, u, target, ARTILLERY_FACTOR, false)
  }

  // 4. Organisation, décrochage, ralliement, pertes.
  const morale = new Map<CountryId, number>()
  for (const u of active) {
    const rt = runtimeOf(ctx, u.id)
    if (rt.engagedWith === null) {
      const recovery = rt.supplied
        ? ORG_RECOVERY + (rt.commanded ? ORG_RECOVERY_COMMAND : 0)
        : 0.002
      let m = morale.get(u.owner)
      if (m === undefined) {
        m = moraleFactor(ctx, u.owner)
        morale.set(u.owner, m)
      }
      u.org = Math.min(1, u.org + recovery * m * fatigueRecoveryFactor(u))
    }
    updateFatigue(u, rt, isOffensive(u), index)
    if (!rt.supplied) {
      u.hoursOutOfSupply++
      if (u.hoursOutOfSupply > 72) u.strength = Math.max(0, u.strength - 0.002)
    } else {
      u.hoursOutOfSupply = 0
    }
    if (!rt.routed && u.org < postureOf(u.posture).routOrg) {
      rt.routed = true
      u.entrench = 0
      ctx.log(`Décrochage : ${u.name}`, u.owner)
      retreatFromEnemy(ctx, u, index)
    } else if (rt.routed && u.org >= RALLY_ORG) {
      rt.routed = false
      u.order = { kind: 'hold' }
      u.path = []
    }
    if (u.strength < 0.05) {
      ctx.units.delete(u.id)
      ctx.runtime.delete(u.id)
      for (const a of ctx.armies.values()) a.unitIds = a.unitIds.filter((id) => id !== u.id)
      ctx.log(`Unité détruite : ${u.name}`, u.owner)
    }
  }
}

/** Fait reculer une unité de ~25 km à l'opposé de l'ennemi le plus proche, vers son territoire. */
export function retreatFromEnemy(ctx: SimContext, u: UnitState, index?: WarIndex): void {
  const e = (index ?? new WarIndex(ctx)).nearestEnemy(u, 60)
  const side = sideIndex(ctx, u.owner)
  const found: { best: LonLat | null } = { best: null }
  let bestScore = -Infinity
  ctx.grid.cellsWithin(u.lon, u.lat, 35, (i) => {
    if (ctx.grid.owner[i] !== side || !ctx.grid.passable(i)) return
    const lon = ctx.grid.lonOf(i)
    const lat = ctx.grid.latOf(i)
    const away = e ? distanceKm(lon, lat, e.lon, e.lat) : 0
    const reach = ctx.supplyReach[side]?.[i] === 1 ? 20 : 0
    const score = away + reach - 0.3 * distanceKm(lon, lat, u.lon, u.lat)
    if (score > bestScore) {
      bestScore = score
      found.best = [lon, lat]
    }
  })
  const target: LonLat = found.best ?? [u.lon, u.lat]
  u.order = { kind: 'retreat', target }
  u.path = ctx.pathfinder.find([u.lon, u.lat], target, { side, enemyCost: 8 }) ?? [target]
}
