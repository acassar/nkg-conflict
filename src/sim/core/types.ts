/** Types partagés entre le Worker de simulation et l'interface. Données sérialisables uniquement. */

export type CountryId = string

export interface CountryDef {
  id: CountryId
  name: string
  /** Couleur d'affichage [r, g, b]. */
  color: [number, number, number]
}

export type UnitKind = 'inf' | 'mech' | 'tank' | 'art' | 'log' | 'hq'

export interface UnitSnapshot {
  id: number
  owner: CountryId
  kind: UnitKind
  lon: number
  lat: number
  /** Effectifs relatifs, 0 à 1. */
  strength: number
}

export interface SimSnapshot {
  tick: number
  startDate: string
  paused: boolean
  speed: number
  playerCountry: CountryId
  countries: CountryDef[]
  units: UnitSnapshot[]
}

export interface ScenarioDef {
  id: string
  name: string
  epoch: string
  startDate: string
  playerCountry: CountryId
  countries: CountryDef[]
  units: Omit<UnitSnapshot, 'id'>[]
}
