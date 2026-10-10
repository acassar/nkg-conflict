import type { LineMissionKind, MissionKind } from '@/sim/core/types'

/**
 * Missions d'armée telles que les présente l'onglet « Ordre » de la fiche d'armée : cartes groupées
 * (Défendre, Attaquer, Reculer), ligne d'effet, texte détaillé et action proposée.
 */

export const MISSION_NAMES: Record<MissionKind, string> = {
  hold: 'Tenir',
  keyPoints: 'Points clés',
  depth: 'Profondeur',
  reserve: 'Réserve',
  advance: 'Avancer',
  breach: 'Percée',
  retreat: 'Retraite',
  encircle: 'Encercler',
}

export const MISSION_GROUPS: ReadonlyArray<{ label: string; kinds: MissionKind[] }> = [
  { label: 'Défendre', kinds: ['hold', 'keyPoints', 'depth', 'reserve'] },
  { label: 'Attaquer', kinds: ['advance', 'breach', 'encircle'] },
  { label: 'Reculer', kinds: ['retreat'] },
]

/** Ligne d'effet de chaque carte. */
export const MISSION_SHORT: Record<MissionKind, string> = {
  hold: 'Garde la ligne actuelle',
  keyPoints: 'Villes, ponts, nœuds routiers',
  depth: 'Seconde ligne à 25 km',
  reserve: 'En retrait, contre-attaque',
  advance: "Jusqu'à un trait ou une frontière",
  breach: 'Colonne vers un point',
  encircle: 'Détache un tiers autour d’une cible',
  retreat: 'Repli par échelons',
}

/** Texte détaillé de la mission choisie. */
export const MISSION_TEXT: Record<MissionKind, string> = {
  hold: 'Les unités se répartissent sur le front selon le poids des axes (grands axes, voies ferrées, villes) ; les secteurs calmes ne gardent que quelques postes. Une offensive ponctuelle reste possible.',
  keyPoints:
    'Même ligne, mais les unités se concentrent sur les villes, passages de fleuve et nœuds routiers à moins de 8 km du front (repères orange) ; simple écran ailleurs.',
  depth:
    "Trois cinquièmes des unités de ligne tiennent le contact, les autres une seconde ligne 25 km en arrière ; la première ligne décroche plus tôt et cède du terrain pour user l'attaquant.",
  reserve:
    "L'armée se place 40 km derrière son front ; toutes ses unités de ligne, même retranchées, contre-attaquent une percée à moins de 150 km, puis reviennent.",
  advance:
    "La ligne progresse ensemble jusqu'au but, sans pointe isolée : une unité qui a 20 km d'avance attend sa voisine. Rythme continu en équilibrée ou offensive ; en défensive, bonds de 25 km avec retranchement à chaque arrêt.",
  breach:
    "La moitié des unités de ligne, les plus proches du point de départ, attaque en colonne serrée vers le point visé ; le reste de l'armée tient son front et se concentre de part et d'autre de la percée pour couvrir ses flancs. Au point visé, l'armée reprend son front.",
  encircle:
    "Un tiers des unités de ligne forme un groupe qui gagne les flancs de la cible puis ferme l'anneau ; il rejoint l'armée après le siège. L'armée garde son front avec le reste.",
  retreat:
    "Repli jusqu'à un trait ou une frontière : au contact, bonds de 20 km en deux échelons alternés, l'un tenant pendant que l'autre recule ; loin de l'ennemi, repli d'une traite. Arrivée : l'armée tient la ligne atteinte.",
}

/** Missions qui gardent le front de l'armée : appliquées d'un bouton, avec aperçu sur la carte. */
export const LINE_MISSIONS: ReadonlyArray<LineMissionKind> = [
  'hold',
  'keyPoints',
  'depth',
  'reserve',
]

export function isLineMission(kind: MissionKind): kind is LineMissionKind {
  return (LINE_MISSIONS as ReadonlyArray<MissionKind>).includes(kind)
}

/**
 * Action proposée pour la carte choisie : déjà en cours, à appliquer (missions de ligne) ou à viser sur
 * la carte (point, trait, frontière ou cible).
 */
export function missionAction(
  view: MissionKind,
  current: MissionKind,
): { kind: 'current' | 'apply' | 'aim'; label: string } {
  if (view === current) return { kind: 'current', label: 'Déjà en cours' }
  if (isLineMission(view)) return { kind: 'apply', label: 'Appliquer' }
  return { kind: 'aim', label: 'Viser sur la carte' }
}
