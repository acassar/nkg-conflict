import type { ModifierKey } from '@/sim/core/types'
import { POSTURE_ORDER, POSTURES } from '@/sim/units/postures'
import { Terrain, TERRAIN_RULES } from '@/sim/theater/grid'
import {
  BUILDINGS,
  FORT_BONUS_PER_LEVEL,
  FORT_RADIUS_KM,
  NO_MUNITIONS_FACTOR,
} from '@/sim/economy/rules'
import {
  CONTACT_KM,
  COMMAND_FACTOR,
  OUT_OF_SUPPLY_FACTOR,
  ROUT_ORG,
  RALLY_ORG,
} from '@/sim/systems/combat'
import {
  DEMINING_PER_DAY,
  OBSTACLE_FIRE_MALUS,
  OBSTACLE_LOSS_BONUS,
  OBSTACLES_PER_HOUR,
} from '@/sim/systems/obstacles'
import {
  FLANK_DEFENSE,
  FLANK_KM,
  FLANK_ORG_LOSS,
  SALIENT_SHARE,
  SURROUNDED_DEG,
  TWO_SIDES_DEG,
} from '@/sim/systems/flanks'
import { SOURCE_RADIUS_KM } from '@/sim/systems/supply'
import { MODERN_CATALOG } from '@/sim/units/catalog'
import {
  SUSTAIN_CRITICAL_DAYS,
  SUSTAIN_MAX_DAYS,
  SUSTAIN_WARNING_DAYS,
} from '@/sim/economy/sustainability'

/**
 * Aide en jeu : règles et modificateurs du combat, écrites à partir des constantes de la
 * simulation pour rester justes quand l'équilibrage change. Une section par thème, et une courte
 * explication par modificateur de l'écran de bataille (infobulle), qui renvoie à sa section.
 * À compléter au fil des phases suivantes.
 */

export type HelpSectionId =
  | 'combat'
  | 'terrain'
  | 'entrench'
  | 'obstacles'
  | 'forts'
  | 'supply'
  | 'command'
  | 'postures'
  | 'flanks'
  | 'sustain'

export interface HelpSection {
  id: HelpSectionId
  title: string
  paragraphs: string[]
  table?: { head: string[]; rows: string[][] }
}

/** Pourcentage signé d'un facteur multiplicatif : 1,15 → « +15 % », 0,6 → « −40 % ». */
export function signedPct(factor: number): string {
  const v = Math.round((factor - 1) * 100)
  if (v === 0) return '0 %'
  return `${v > 0 ? '+' : '−'}${Math.abs(v)} %`
}
const pct = (v: number): string => `${Math.round(v * 100)} %`
const days = (perHour: number): number => Math.round(1 / perHour / 24)

const logisticsKm = MODERN_CATALOG.log.supplyRadiusKm
const hqKm = MODERN_CATALOG.hq.commandRadiusKm

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'combat',
    title: 'Combat',
    paragraphs: [
      `Deux unités ennemies à moins de ${CONTACT_KM} km sont au contact : chaque heure, chacune frappe l'ennemi le plus proche ; l'artillerie frappe aussi à distance. Les pertes dépendent du rapport entre la puissance de feu du tireur et la défense de la cible (plafonné à 4 contre 1).`,
      "Puissance de feu = valeur d'attaque du type (ou de défense s'il n'attaque pas) × effectifs × organisation × ravitaillement × commandement × posture × munitions. Défense = valeur de défense × effectifs × organisation × ravitaillement × commandement × terrain × retranchement × fortifications × posture × flanc.",
      `Organisation : elle compte pour 25 % à 100 % de la valeur (×${(0.25).toLocaleString('fr-FR')} à vide). Sous ${pct(ROUT_ORG)} (seuil selon la posture), l'unité décroche et recule jusqu'à retrouver ${pct(RALLY_ORG)}.`,
      `Munitions : chaque tir en consomme (l'artillerie le double) ; stock vide, puissance de feu ${signedPct(NO_MUNITIONS_FACTOR)}.`,
      'Fleuve : une attaque à travers un fleuve donne +40 % de défense à la cible.',
    ],
  },
  {
    id: 'terrain',
    title: 'Terrain',
    paragraphs: [
      "Le terrain de la cellule où se trouve l'unité multiplie sa défense et freine ses déplacements.",
    ],
    table: {
      head: ['Terrain', 'Défense', 'Vitesse'],
      rows: [
        Terrain.PLAIN,
        Terrain.URBAN,
        Terrain.FOREST,
        Terrain.HILLS,
        Terrain.MOUNTAINS,
        Terrain.MARSH,
        Terrain.RIVER,
      ].map((t) => {
        const r = TERRAIN_RULES[t]!
        return [r.name, signedPct(r.defense), signedPct(r.speed)]
      }),
    },
  },
  {
    id: 'entrench',
    title: 'Retranchement',
    paragraphs: [
      "Une unité à l'arrêt se retranche peu à peu (plus vite en posture défensive, moins vite en offensive) ; retranchée à 100 %, sa défense gagne +50 %. Tout déplacement fait perdre le retranchement.",
    ],
  },
  {
    id: 'obstacles',
    title: 'Obstacles',
    paragraphs: [
      `Mines, barbelés, positions préparées : une unité à l'arrêt et retranchée, dans un pays en guerre, en pose sur sa cellule. Un champ complet demande ${days(OBSTACLES_PER_HOUR)} jours en terrain découvert, ${days(OBSTACLES_PER_HOUR * 2)} en ville, ${days(OBSTACLES_PER_HOUR * 1.5)} en forêt (plus vite en posture défensive).`,
      `Face à un champ complet, l'assaut perd ${pct(OBSTACLE_FIRE_MALUS)} de puissance de feu et l'attaquant subit ${pct(OBSTACLE_LOSS_BONUS)} de pertes en plus (tir direct seulement, l'artillerie n'est pas concernée). Les obstacles ne protègent que le camp qui les a posés ; l'occupant d'une cellule lève ceux de l'adversaire en ${Math.round(1 / DEMINING_PER_DAY)} jours environ.`,
    ],
  },
  {
    id: 'forts',
    title: 'Fortifications',
    paragraphs: [
      `Bâtiment de ville (${BUILDINGS.fort.maxPerCity} niveaux au plus, ${BUILDINGS.fort.minDays} jours de chantier au minimum) : chaque niveau donne ${signedPct(1 + FORT_BONUS_PER_LEVEL)} de défense aux unités du propriétaire de la ville à moins de ${FORT_RADIUS_KM} km. Quand plusieurs villes fortifiées se recouvrent, le meilleur niveau compte, sans cumul. Une ville prise perd ses fortifications.`,
      'La portée s’affiche autour de la ville sélectionnée, des villes du joueur dans l’onglet Production et de toutes les villes fortifiées en mode Logistique.',
    ],
  },
  {
    id: 'supply',
    title: 'Ravitaillement',
    paragraphs: [
      `Le ravitaillement part des sources (capitale, grandes villes, dépôts : ${SOURCE_RADIUS_KM} km autour) et suit le territoire tenu ; une unité logistique ravitaillée le prolonge à ${logisticsKm} km. Une unité coupée voit sa puissance de feu et sa défense réduites (${signedPct(OUT_OF_SUPPLY_FACTOR)}), ne reçoit plus de renforts et récupère moins bien son organisation.`,
      'Le mode Logistique (touche L) montre les zones reliées, coupées et les poches.',
    ],
  },
  {
    id: 'command',
    title: 'Commandement',
    paragraphs: [
      `Une unité à moins de ${hqKm} km d'un quartier général de son pays (qui n'est pas en déroute) est commandée : feu et défense ${signedPct(COMMAND_FACTOR)}, et elle récupère plus vite son organisation hors combat.`,
    ],
  },
  {
    id: 'postures',
    title: 'Postures',
    paragraphs: [
      "La posture dit comment l'unité combat : prise de risque, poursuite, retranchement. Elle se choisit pour une unité ou pour toute une armée.",
    ],
    table: {
      head: ['Posture', 'Attaque', 'Défense', 'Décroche sous', 'Effet'],
      rows: POSTURE_ORDER.map((p) => {
        const r = POSTURES[p]
        return [r.name, signedPct(r.attack), signedPct(r.defense), pct(r.routOrg), r.description]
      }),
    },
  },
  {
    id: 'flanks',
    title: 'Flancs',
    paragraphs: [
      `Recalculés chaque heure pour les unités au contact : une unité dont les ennemis à moins de ${FLANK_KM} km l'entourent sur ${TWO_SIDES_DEG}° ou plus est attaquée de deux côtés, sur ${SURROUNDED_DEG}° ou plus presque encerclée ; une unité dont ${pct(SALIENT_SHARE)} des cellules proches sont ennemies est en saillant (même effet que deux côtés). Un front droit occupe environ 110°, sans malus.`,
      `Deux côtés ou saillant : défense ${signedPct(FLANK_DEFENSE[1])}, pertes d'organisation ${signedPct(FLANK_ORG_LOSS[1])} ; presque encerclée : ${signedPct(FLANK_DEFENSE[2])} et ${signedPct(FLANK_ORG_LOSS[2])}.`,
    ],
  },
  {
    id: 'sustain',
    title: "Soutenabilité de l'armée",
    paragraphs: [
      "L'indicateur « Armée » (barre du haut, onglet Production) dit si l'économie peut maintenir l'armée actuelle au rythme actuel des pertes. Chaque jour, il compare en moyenne glissante sur une semaine les besoins (renforts pour combler les pertes des unités en vie, au prix des renforts ; unités détruites, au prix d'une unité neuve ; munitions tirées) aux revenus (production, munitions, main-d'œuvre, aide étrangère comprise). Le ravitaillement ne coûte rien dans les règles actuelles.",
      `Quand une ressource est en déficit, ses stocks donnent le nombre de jours tenables ; la plus courte est le facteur limitant. Au-delà de ${SUSTAIN_MAX_DAYS} jours, ou sans déficit, l'armée est durable (le multiplicateur indique la couverture de la ressource la plus tendue). En orange sous ${SUSTAIN_WARNING_DAYS} jours, en rouge sous ${SUSTAIN_CRITICAL_DAYS}. Les nouvelles formations n'entrent pas dans les besoins : elles agrandissent l'armée.`,
    ],
  },
]

/** Explication courte de chaque modificateur de l'écran de bataille, et sa section d'aide. */
export const MODIFIER_HELP: Record<ModifierKey, { text: string; section: HelpSectionId }> = {
  strength: { text: "Effectifs restants de l'unité (100 % = au complet).", section: 'combat' },
  org: {
    text: `Organisation : compte de 25 % à 100 % de la valeur ; sous le seuil de la posture, l'unité décroche.`,
    section: 'combat',
  },
  supply: {
    text: `Coupée du ravitaillement : ${signedPct(OUT_OF_SUPPLY_FACTOR)} en feu et en défense.`,
    section: 'supply',
  },
  command: {
    text: `À moins de ${hqKm} km d'un QG de son pays : ${signedPct(COMMAND_FACTOR)}.`,
    section: 'command',
  },
  posture: {
    text: 'Posture choisie pour l’unité ou son armée : plus d’attaque se paie en défense, et inversement.',
    section: 'postures',
  },
  ammo: {
    text: `Stock de munitions du pays vide : ${signedPct(NO_MUNITIONS_FACTOR)} de puissance de feu.`,
    section: 'combat',
  },
  enemyObstacles: {
    text: `Champ d'obstacles adverse sous la cible : jusqu'à −${pct(OBSTACLE_FIRE_MALUS)} pour un assaut direct.`,
    section: 'obstacles',
  },
  terrain: {
    text: 'Terrain de la cellule : ville, forêt, collines, montagnes, marais et fleuve aident le défenseur.',
    section: 'terrain',
  },
  entrench: {
    text: "Retranchement gagné à l'arrêt : jusqu'à +50 % de défense, perdu en se déplaçant.",
    section: 'entrench',
  },
  fort: {
    text: `Ville fortifiée de son pays à moins de ${FORT_RADIUS_KM} km : ${signedPct(1 + FORT_BONUS_PER_LEVEL)} par niveau, le meilleur niveau compte.`,
    section: 'forts',
  },
  ownObstacles: {
    text: `Obstacles posés par son camp : l'assaut adverse perd jusqu'à ${pct(OBSTACLE_FIRE_MALUS)} de feu.`,
    section: 'obstacles',
  },
  obstacleLosses: {
    text: `En attaquant à travers des obstacles, l'unité subit jusqu'à ${pct(OBSTACLE_LOSS_BONUS)} de pertes en plus.`,
    section: 'obstacles',
  },
  flank: {
    text: `Prise de flanc : ${signedPct(FLANK_DEFENSE[1])} (deux côtés, saillant) ou ${signedPct(FLANK_DEFENSE[2])} (presque encerclée).`,
    section: 'flanks',
  },
  flankMorale: {
    text: `Prise de flanc : l'organisation fond plus vite (${signedPct(FLANK_ORG_LOSS[1])} ou ${signedPct(FLANK_ORG_LOSS[2])} de pertes).`,
    section: 'flanks',
  },
}
