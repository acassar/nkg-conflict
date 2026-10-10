/**
 * Règles géométriques de l'encerclement, sans dépendance : partagées par la simulation (encircle.ts) et
 * par l'aperçu de la mission sur la carte.
 */

/** Ennemis à moins de cette distance de la cible : ils font partie du groupe à encercler. */
export const GROUP_KM = 25
/** Marge au-delà du groupe ennemi pour l'anneau d'encerclement. */
export const RING_MARGIN_KM = 15
export const RING_MIN_KM = 20
