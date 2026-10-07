# NKG Conflict

Jeu de grande stratégie solo dans le navigateur : carte mondiale, front dynamique, temps réel pausable.

## Démarrer

```bash
pnpm install
pnpm dev
```

Raccourcis : `Espace` pour la pause, `1` à `5` pour la vitesse. Le bouton `+24 h` joue une journée d'un coup (mode tour par tour).

## Fond de carte

Sans configuration, la carte utilise le fond de démo de MapLibre. Pour le fond Protomaps, crée un `.env.local` :

```bash
VITE_PMTILES_URL=https://ton-domaine/tiles/monde.pmtiles
```

## Architecture

- `src/sim/` : simulation, exécutée dans un Web Worker (`worker.ts`), exposée via Comlink.
  - `core/` : logique pure sans dépendance (horloge, ticks, sauvegardes), testée par Vitest.
  - `world.ts` : entités bitECS (pays, unités).
  - `scenarios/` : scénarios de départ.
- `src/stores/game.ts` : store Pinia, pont entre l'interface et le Worker.
- `src/map/` : MapLibre GL pour le fond, deck.gl pour les unités.
- `src/components/` : interface Vue.

1 tick = 1 heure de jeu. Vitesses 1 à 5 : 1, 3, 8, 24 et 72 ticks par seconde.

## Scripts

| Script              | Rôle                           |
| ------------------- | ------------------------------ |
| `pnpm dev`          | serveur de développement       |
| `pnpm build`        | vérification des types + build |
| `pnpm test`         | tests unitaires                |
| `pnpm format:check` | vérification du formatage      |
