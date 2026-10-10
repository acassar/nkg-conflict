import { runtimeOf, type SimContext } from '../context'
import type { UnitState } from '../core/types'
import { isLineUnit } from '../units/catalog'
import { planPath } from './movement'
import { WarIndex } from './spatial'
import { isHalted } from './restraint'

/** Puissance d'une unité pour juger si un ennemi est plus faible. */
const power = (u: UnitState): number => u.strength * (0.25 + 0.75 * u.org)

/** Ordres que les réflexes peuvent remplacer : une unité qui exécute un ordre du joueur n'est pas dérangée. */
const idle = (u: UnitState): boolean =>
  u.order.kind === 'hold' || u.order.kind === 'front' || u.order.kind === 'idle'

/**
 * Réflexes des postures (unités dont la posture a été choisie), toutes les quelques heures :
 * - équilibrée : achève les ennemis en déroute tout proches ;
 * - offensive : attaque les ennemis affaiblis à portée ;
 * - dégâts max : poursuit les ennemis en déroute et attaque tout ennemi plus faible à portée ;
 * - défensive et défense max : jamais d'attaque automatique.
 */
export function updatePostureReflexes(ctx: SimContext): void {
  let index: WarIndex | null = null
  for (const u of ctx.units.values()) {
    const p = u.posture
    if (!p || p === 'defensive' || p === 'maxDefense') continue
    if (!isLineUnit(u.kind) || !idle(u) || runtimeOf(ctx, u.id).routed) continue
    // Unité qui consolide après une attaque trop poussée : pas de nouvel élan tout de suite.
    if (isHalted(ctx, u)) continue
    index ??= new WarIndex(ctx)
    if (!index.has(u)) continue
    const range = p === 'maxDamage' ? 40 : p === 'offensive' ? 20 : 12
    const enemy = index.nearestEnemy(u, range)
    if (!enemy) continue
    const routed = runtimeOf(ctx, enemy.id).routed
    let attack = false
    if (p === 'balanced') attack = routed
    else if (p === 'offensive') attack = routed || enemy.org < 0.5 || enemy.strength < 0.6
    else attack = routed || power(enemy) < power(u)
    if (!attack) continue
    if (p === 'maxDamage' && routed) {
      u.order = { kind: 'pursue', unitId: enemy.id, target: [enemy.lon, enemy.lat] }
    } else {
      u.order = { kind: 'attack', target: [enemy.lon, enemy.lat] }
    }
    planPath(ctx, u, [enemy.lon, enemy.lat])
  }
}
