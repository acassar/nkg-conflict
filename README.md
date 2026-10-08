# NKG Conflict

Jeu de grande stratégie solo dans le navigateur : carte mondiale, front dynamique, temps réel pausable.

Scénario actuel : Ukraine – Russie, époque moderne. Scénario hypothétique de jeu, pas une reconstitution historique.

## Démarrer

```bash
pnpm install
pnpm dev
```

## Jouer

Vous commandez l'Ukraine ; l'IA commande la Russie. La partie est perdue si votre capitale tombe ou si toutes vos unités sont détruites, gagnée dans le cas inverse.

| Action                                | Commande                                  |
| ------------------------------------- | ----------------------------------------- |
| Pause / vitesse                       | `Espace` / `1` à `5`, ou la barre du haut |
| Avancer d'un jour (tour par tour)     | bouton `+24 h`                            |
| Sélectionner / ajouter à la sélection | clic / `Maj` + clic sur une unité         |
| Déplacer                              | clic droit sur la carte, ou `M` puis clic |
| Attaquer / se replier                 | `A` / `R` puis clic sur la carte          |
| Tenir la position                     | `H`                                       |
| Annuler un ordre en cours de saisie   | `Échap`                                   |
| Armées                                | onglet « Armées » du panneau de droite    |

Une armée peut tenir tout le front ou une portion (deux clics sur la carte) : ses unités s'y répartissent seules et suivent le front quand il bouge. Une offensive se trace en deux clics (départ, objectif), puis se lance.

Lecture des pions : cadre aux couleurs du camp, symbole OTAN simplifié, jauge verte = effectifs, jauge bleue = organisation, point orange = au contact, bordure rouge pointillée = hors ravitaillement, pion pâle = en déroute.

## Règles en bref

- **Front** : grille de 0,05° (~5 km). Une cellule change de camp quand elle est dans la zone de contrôle d'une unité, hors de celle de toute unité ennemie, et touche déjà le territoire de ce camp.
- **Terrain** : forêts, collines, montagnes, marais, fleuves et villes modifient vitesse, défense et itinéraires (table `TERRAIN_RULES` dans `src/sim/theater/grid.ts`).
- **Combat** : au contact (10 km), chaque unité frappe l'ennemi le plus proche. L'artillerie frappe à 30 km. Défense renforcée par le terrain, le retranchement et les fortifications. Sous 15 % d'organisation, une unité décroche et continue de reculer jusqu'à se rallier. Chaque tir consomme des munitions : à court, la puissance de feu est divisée par deux.
- **Commandement** : une unité à moins de 120 km d'un QG de son camp gagne 15 % au combat et récupère plus vite.
- **Ravitaillement** : relié aux sources de chaque camp et à ses dépôts, à travers son propre territoire. Les unités logistiques le prolongent de 60 km. Hors ravitaillement : combat à 60 %, attrition après 3 jours. Les poches sans défenseur s'effondrent.
- **Économie** : les villes portent les bâtiments (usines civiles et militaires, casernes, dépôts, fortifications). Chaque jour : points de construction, production militaire, munitions et main-d'œuvre. Une caserne forme une unité à la fois ; les unités ravitaillées hors combat reçoivent des renforts. Une ville prise perd la moitié de ses usines, ses fortifications et son dépôt. Option « Gestion automatique » dans l'onglet Production.

## Fond de carte

Sans configuration, la carte utilise le fond de démo de MapLibre. Pour le fond Protomaps, crée un `.env.local` :

```bash
VITE_PMTILES_URL=https://ton-domaine/tiles/monde.pmtiles
```

## Données du théâtre

`src/sim/data/theater-ukraine.json` est généré depuis [Natural Earth](https://www.naturalearthdata.com/) (domaine public) : frontières de facto, fleuves majeurs, villes de plus de 250 000 habitants. Le relief (AWS Terrain Tiles) et l'occupation du sol ([ESA WorldCover 2021](https://esa-worldcover.org/), CC BY 4.0) viennent de `data/terrain-raw.json.gz`, produit par le workflow « Données du théâtre » (`scripts/fetch-terrain.py`) et publié sur la branche `data-results`.

```bash
pnpm theater chemin/vers/natural-earth-vector/geojson
```

## Architecture

- `src/sim/` : simulation en TypeScript pur, exécutée dans un Web Worker (`worker.ts`, via Comlink).
  - `simulation.ts` : état de la partie, boucle des systèmes, ordres du joueur, sauvegarde.
  - `systems/` : ravitaillement, mouvement, combat, territoire, armées, IA, pathfinding (A\*).
  - `economy/` : bâtiments, revenus, constructions, formations, renforts, IA économique.
  - `theater/grid.ts` : grille de contrôle (propriétaire et terrain par cellule).
  - `units/catalog.ts` : types d'unités de l'époque moderne.
  - `scenarios/` : scénarios de départ.
- `src/stores/game.ts` : store Pinia, pont entre l'interface et le Worker.
- `src/map/` : MapLibre GL pour le fond, deck.gl pour le territoire, les pions, les fronts et les flèches.
- `src/components/` : interface Vue.

1 tick = 1 heure de jeu. Vitesses 1 à 5 : 1, 3, 8, 24 et 72 ticks par seconde. Une heure simulée coûte environ 1 ms.

## Scripts

| Script              | Rôle                                             |
| ------------------- | ------------------------------------------------ |
| `pnpm dev`          | serveur de développement                         |
| `pnpm build`        | vérification des types + build                   |
| `pnpm test`         | tests unitaires                                  |
| `pnpm simulate 60`  | partie sans affichage sur 60 jours (équilibrage) |
| `pnpm theater …`    | régénère les données du théâtre                  |
| `pnpm format:check` | vérification du formatage                        |
