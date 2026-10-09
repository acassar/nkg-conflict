import type { Posture } from '../core/types'

export interface PostureRule {
  name: string
  description: string
  /** Multiplicateur de la puissance de feu. */
  attack: number
  /** Multiplicateur de la valeur défensive. */
  defense: number
  /** Organisation sous laquelle l'unité décroche (se préserver ou tenir jusqu'au bout). */
  routOrg: number
  /** Multiplicateur de la vitesse de retranchement. */
  entrench: number
}

/** Postures d'unité, de la plus prudente à la plus agressive. Valeurs de jeu, à équilibrer. */
export const POSTURES: Record<Posture, PostureRule> = {
  maxDefense: {
    name: 'Défense max',
    description:
      'Défense +30 %, attaque −40 %, retranchement rapide ; décroche tôt pour se préserver ; jamais d’attaque automatique',
    attack: 0.6,
    defense: 1.3,
    routOrg: 0.3,
    entrench: 1.5,
  },
  defensive: {
    name: 'Défensive',
    description: 'Défense +15 %, attaque −15 % ; pas d’attaque automatique',
    attack: 0.85,
    defense: 1.15,
    routOrg: 0.2,
    entrench: 1.2,
  },
  balanced: {
    name: 'Équilibrée',
    description: 'Sans modificateur ; achève les unités ennemies en déroute à moins de 12 km',
    attack: 1,
    defense: 1,
    routOrg: 0.15,
    entrench: 1,
  },
  offensive: {
    name: 'Offensive',
    description:
      'Attaque +20 %, défense −10 % ; attaque d’elle-même les unités ennemies affaiblies à moins de 20 km',
    attack: 1.2,
    defense: 0.9,
    routOrg: 0.12,
    entrench: 0.8,
  },
  maxDamage: {
    name: 'Dégâts max',
    description:
      'Attaque +40 %, défense −20 %, tient jusqu’au bout ; poursuit les unités en déroute à moins de 40 km et attaque tout ennemi plus faible à moins de 15 km',
    attack: 1.4,
    defense: 0.8,
    routOrg: 0.05,
    entrench: 0.6,
  },
}

export const POSTURE_ORDER: Posture[] = [
  'maxDefense',
  'defensive',
  'balanced',
  'offensive',
  'maxDamage',
]

export function postureOf(p: Posture | undefined): PostureRule {
  return POSTURES[p ?? 'balanced']
}
