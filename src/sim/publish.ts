import type { CityState, CountryDef, FormationState, SimSnapshot, UnitSnapshot } from './core/types'

/**
 * Publication de l'état vers l'interface, par différences.
 *
 * Sur la carte du monde, l'état complet pèse environ 3 Mo (7 000 brigades) : le recopier vingt fois
 * par seconde dans le thread de l'interface bloquait l'affichage (pions qui sautent, caméra saccadée).
 * Le Worker n'envoie donc que les unités qui ont changé depuis la publication précédente, et les
 * listes peu changeantes (pays, formations, villes) seulement quand elles changent. L'interface
 * reconstruit l'état complet avec `applyPublished` : le reste du code voit toujours un `SimSnapshot`.
 */

/** Listes envoyées seulement quand elles changent. */
const STABLE_KEYS = ['countries', 'formations', 'cities'] as const
type StableKey = (typeof STABLE_KEYS)[number]

export interface UnitsDelta {
  /** Vrai : `changed` contient toutes les unités, dans l'ordre (premier envoi, nouvelle partie). */
  full: boolean
  /** Unités nouvelles ou modifiées. */
  changed: UnitSnapshot[]
  /** Unités disparues depuis la publication précédente. */
  removed: number[]
}

/** État publié : `units` remplacé par `unitsDelta` ; pays, formations et villes à null s'ils n'ont pas changé. */
export type PublishedSnapshot = Omit<SimSnapshot, 'units' | StableKey> & {
  unitsDelta: UnitsDelta
  countries: CountryDef[] | null
  formations: FormationState[] | null
  cities: CityState[] | null
}

/** Égalité de données simples (nombres, textes, booléens, null, tableaux, objets). */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    // NaN est égal à lui-même ici : une valeur qui ne bouge pas n'est pas renvoyée.
    return typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!sameData(a[i], b[i])) return false
    return true
  }
  if (Array.isArray(b)) return false
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (const k of ka) {
    if (!sameData((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
      return false
    }
  }
  return true
}

/** Côté Worker : mémorise ce qui a été publié pour n'envoyer que les différences. */
export class SnapshotPublisher {
  private units = new Map<number, UnitSnapshot>()
  private stable: Partial<Record<StableKey, unknown>> = {}
  private primed = false

  /** Prochaine publication complète (nouvel abonné, nouvelle partie, chargement). */
  reset(): void {
    this.units.clear()
    this.stable = {}
    this.primed = false
  }

  encode(snapshot: SimSnapshot): PublishedSnapshot {
    const full = !this.primed
    const changed: UnitSnapshot[] = []
    const seen = new Set<number>()
    for (const u of snapshot.units) {
      seen.add(u.id)
      const before = this.units.get(u.id)
      if (full || !before || !sameData(before, u)) {
        changed.push(u)
        this.units.set(u.id, u)
      }
    }
    const removed: number[] = []
    for (const id of this.units.keys()) {
      if (!seen.has(id)) removed.push(id)
    }
    for (const id of removed) this.units.delete(id)

    const { units: _units, countries, formations, cities, ...rest } = snapshot
    const pick = <T>(key: StableKey, value: T): T | null => {
      if (!full && sameData(this.stable[key], value)) return null
      this.stable[key] = value
      return value
    }
    this.primed = true
    return {
      ...rest,
      unitsDelta: { full, changed, removed },
      countries: pick('countries', countries),
      formations: pick('formations', formations),
      cities: pick('cities', cities),
    }
  }
}

/** Côté interface : état reconstruit à partir des publications successives. */
export class SnapshotReceiver {
  private units = new Map<number, UnitSnapshot>()
  private stable: { countries: CountryDef[]; formations: FormationState[]; cities: CityState[] } = {
    countries: [],
    formations: [],
    cities: [],
  }

  apply(published: PublishedSnapshot): SimSnapshot {
    const { unitsDelta, countries, formations, cities, ...rest } = published
    if (unitsDelta.full) this.units.clear()
    for (const id of unitsDelta.removed) this.units.delete(id)
    for (const u of unitsDelta.changed) this.units.set(u.id, u)
    if (countries) this.stable.countries = countries
    if (formations) this.stable.formations = formations
    if (cities) this.stable.cities = cities
    return {
      ...rest,
      units: [...this.units.values()],
      countries: this.stable.countries,
      formations: this.stable.formations,
      cities: this.stable.cities,
    }
  }
}
