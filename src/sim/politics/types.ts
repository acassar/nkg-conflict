import type { CountryId } from '../core/types'

/** État politique d'un pays. Jauges de 0 à 1. */
export interface CountryPolitics {
  code: CountryId
  /** Stabilité : multiplie la production et la construction (×0,5 à ×1). */
  stability: number
  /** Soutien à la guerre : main-d'œuvre, récupération des unités, envie de continuer une guerre. */
  warSupport: number
  /** Les forces armées ont été levées (les unités existent sur la carte). */
  mobilized: boolean
  /** Nombre d'unités levées à la mobilisation. */
  forceSize: number
  /** Dernier usage de « Améliorer les relations » par le joueur envers ce pays (tick). */
  lastImproveTick: number
}

export interface War {
  id: number
  name: string
  attackers: CountryId[]
  defenders: CountryId[]
  startTick: number
  /** Cellules tenues par chaque participant au début de sa participation (bilan territorial). */
  startOwned: Record<CountryId, number>
  /** Propriétaires de la grille au début de la guerre, par plages (pour une paix blanche). */
  ownerAtStart: number[]
}

export interface Alliance {
  id: string
  name: string
  members: CountryId[]
}

export type PeaceKind = 'white' | 'lines'

/** Proposition de paix d'une IA au joueur, en attente de réponse. */
export interface PeaceOffer {
  id: number
  warId: number
  from: CountryId
  to: CountryId
  kind: PeaceKind
  expiresTick: number
}

export interface PoliticsState {
  countries: Map<CountryId, CountryPolitics>
  /** Relations entre deux pays, de -100 à 100 (clé « A|B » triée). */
  relations: Map<string, number>
  wars: War[]
  alliances: Alliance[]
  /** Sanctions en cours, clé « auteur>cible ». */
  sanctions: Set<string>
  offers: PeaceOffer[]
  nextId: number
}

/** Données politiques publiées vers l'interface. */
export interface PoliticsSnapshot {
  countries: Array<{
    code: CountryId
    stability: number
    warSupport: number
    mobilized: boolean
    forceSize: number
  }>
  /** Relations du joueur avec chaque pays. */
  playerRelations: Record<CountryId, number>
  wars: Array<{ id: number; name: string; attackers: CountryId[]; defenders: CountryId[] }>
  alliances: Alliance[]
  sanctions: string[]
  offers: PeaceOffer[]
}
