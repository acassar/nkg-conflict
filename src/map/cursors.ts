import type { MapMode } from '@/stores/game'

/**
 * Curseur de la carte selon l'action en cours. deck.gl (en surcouche de MapLibre) pose son curseur
 * sur un calque qui ne reçoit pas la souris : MapView l'applique donc lui-même au canvas de la carte.
 * - main ouverte (fermée pendant le glissement) : déplacer la carte ;
 * - doigt : objet cliquable sous la souris (pion, ville, bataille) ;
 * - réticule rouge : ordre qui vise une unité ennemie (attaque, poursuite, assaut, encerclement) ;
 * - croix fine : désigner un lieu (déplacement, repli, mission, front, débarquement, transport) ;
 * - croix épaisse : poser quelque chose (zone aérienne, usine).
 */

/** Réticule rouge, point chaud au centre. */
const TARGET_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>" +
  "<g fill='none' stroke-linecap='round'>" +
  "<circle cx='12' cy='12' r='7' stroke='#fff' stroke-width='4'/>" +
  "<path d='M12 1v6M12 17v6M1 12h6M17 12h6' stroke='#fff' stroke-width='4'/>" +
  "<circle cx='12' cy='12' r='7' stroke='#dc2626' stroke-width='2'/>" +
  "<path d='M12 1v6M12 17v6M1 12h6M17 12h6' stroke='#dc2626' stroke-width='2'/>" +
  "<circle cx='12' cy='12' r='1.2' fill='#dc2626' stroke='none'/></g></svg>"

export const TARGET_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(TARGET_SVG)}") 12 12, crosshair`

export interface CursorState {
  mode: MapMode
  /** Objet cliquable sous la souris. */
  hovering: boolean
  /** Carte en cours de glissement. */
  dragging: boolean
  /** Choix de l'emplacement d'une usine (tiroir Production). */
  placing: boolean
}

export function mapCursor(s: CursorState): string {
  if (s.dragging) return 'grabbing'
  const m = s.mode
  switch (m.kind) {
    case 'select':
      if (s.hovering) return 'pointer'
      return s.placing ? 'cell' : 'grab'
    case 'order':
      return m.order === 'attack' ? TARGET_CURSOR : 'crosshair'
    case 'target':
      return TARGET_CURSOR
    case 'air':
      return 'cell'
    default:
      return 'crosshair'
  }
}
