import type { ScenarioDef } from '../core/types'

/**
 * Scénario de la tranche jouable : Ukraine – Russie, époque moderne.
 * Scénario hypothétique de jeu, sans prétention de reconstitution historique.
 * Les positions sont des placeholders pour afficher la carte ; l'ordre de bataille viendra au Jalon 1.
 */
export const ukraine2026: ScenarioDef = {
  id: 'ukraine-2026',
  name: 'Ukraine – Russie',
  epoch: 'modern',
  startDate: '2026-01-01T00:00:00Z',
  playerCountry: 'UKR',
  countries: [
    { id: 'UKR', name: 'Ukraine', color: [37, 99, 235] },
    { id: 'RUS', name: 'Russie', color: [220, 38, 38] },
  ],
  units: [
    { owner: 'UKR', kind: 'hq', lon: 30.52, lat: 50.45, strength: 1 },
    { owner: 'UKR', kind: 'mech', lon: 36.23, lat: 49.99, strength: 0.9 },
    { owner: 'UKR', kind: 'inf', lon: 35.05, lat: 48.46, strength: 0.8 },
    { owner: 'UKR', kind: 'tank', lon: 35.14, lat: 47.84, strength: 0.85 },
    { owner: 'UKR', kind: 'art', lon: 30.73, lat: 46.48, strength: 0.7 },
    { owner: 'RUS', kind: 'hq', lon: 39.2, lat: 51.66, strength: 1 },
    { owner: 'RUS', kind: 'tank', lon: 36.59, lat: 50.6, strength: 0.9 },
    { owner: 'RUS', kind: 'mech', lon: 36.19, lat: 51.73, strength: 0.85 },
    { owner: 'RUS', kind: 'inf', lon: 39.72, lat: 47.23, strength: 0.8 },
    { owner: 'RUS', kind: 'log', lon: 34.36, lat: 53.24, strength: 1 },
  ],
}
