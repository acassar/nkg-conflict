/**
 * Cadre de l'interface : rail de gauche (domaines) et inspecteur de droite (sélection).
 * Règles pures, partagées par le magasin et les composants, testées sans navigateur.
 */

/** Domaines du rail : chacun ouvre son tiroir. */
export type Domain = 'forces' | 'production' | 'country' | 'log'

export const DOMAINS: ReadonlyArray<{ id: Domain; name: string; short: string; icon: string }> = [
  { id: 'forces', name: 'Forces', short: 'Forces', icon: '⚔' },
  { id: 'production', name: 'Production', short: 'Prod.', icon: '⚙' },
  { id: 'country', name: 'Diplomatie', short: 'Diplo.', icon: '⚑' },
  { id: 'log', name: 'Journal', short: 'Journal', icon: '☰' },
]

/** Ce que montre l'inspecteur : la dernière chose sélectionnée sur la carte ou dans un tiroir. */
export type InspectKind = 'units' | 'army' | 'city' | 'country'

/** Ce qui existe encore pour chaque type de sélection (la simulation peut l'avoir fait disparaître). */
export interface SelectionPresence {
  units: number
  army: boolean
  city: boolean
  country: boolean
}

/** Inspecteur réellement affiché : le dernier choix, s'il désigne encore quelque chose. */
export function inspectorView(
  inspect: InspectKind | null,
  has: SelectionPresence,
): InspectKind | null {
  if (inspect === 'units') return has.units > 0 ? 'units' : null
  if (inspect === 'army') return has.army ? 'army' : null
  if (inspect === 'city') return has.city ? 'city' : null
  if (inspect === 'country') return has.country ? 'country' : null
  return null
}

/**
 * Sur téléphone, un seul panneau : il montre l'inspecteur ou le tiroir du domaine,
 * selon ce que le joueur a ouvert en dernier.
 */
export function mobileSheet(
  sheet: 'domain' | 'inspector',
  inspector: InspectKind | null,
  domain: Domain | null,
): { kind: 'inspector'; view: InspectKind } | { kind: 'domain'; view: Domain } {
  if (sheet === 'inspector' && inspector) return { kind: 'inspector', view: inspector }
  return { kind: 'domain', view: domain ?? 'forces' }
}
