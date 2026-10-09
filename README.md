# NKG Conflict

Jeu de grande stratégie solo dans le navigateur : carte mondiale, front dynamique, diplomatie, temps réel pausable.

Version jouable : https://acassar.github.io/nkg-conflict/

Scénarios hypothétiques, sans prétention de reconstitution historique :

- **Monde 2026** (par défaut) : tous les pays de la carte, au choix du joueur ; la guerre russo-ukrainienne est en cours au départ. Chaque pays a déjà son armée (en garnison dans ses villes s'il est en paix), son économie et ses liens politiques : alliances (OTAN, OTSC, pactes de défense comme États-Unis–Japon ou Chine–Corée du Nord), organisations régionales (UE, ASEAN, Ligue arabe, Union africaine, OCS, Mercosur, CCG), affinités de langue et de voisinage, tensions, sanctions occidentales contre la Russie, la Biélorussie, l'Iran et la Corée du Nord.
- **Ukraine – Russie (théâtre)** : le seul théâtre ukrainien, à grande échelle (cellules de 5 km), en Ukraine ou en Russie.

## Démarrer

```bash
pnpm install
pnpm dev
```

## Jouer

L'écran de départ propose le scénario, l'époque (moderne pour l'instant ; guerre froide, 1939, 1914 et époque napoléonienne sont prévues) et votre pays. Un pays capitule quand sa capitale tombe ou quand il n'a plus d'unités pendant 7 jours. Votre capitulation met fin à la partie ; dans le théâtre ukrainien, celle de l'adversaire vous donne la victoire.

| Action                                | Commande                                                             |
| ------------------------------------- | -------------------------------------------------------------------- |
| Pause / vitesse                       | `Espace` / `1` à `5`, ou la barre du haut                            |
| Avancer d'un jour (tour par tour)     | bouton `+24 h`                                                       |
| Sélectionner / ajouter à la sélection | clic / `Maj` + clic sur une unité                                    |
| Déplacer                              | clic droit sur la carte, ou `M` puis clic                            |
| Attaquer une zone / se replier        | `T` / `R` puis clic sur la carte                                     |
| Annuler l'ordre des unités choisies   | bouton « Annuler l'ordre »                                           |
| Déplacer la carte                     | `ZQSD` (`WASD` en QWERTY) ou les flèches, `Maj` pour aller plus vite |
| Assaut, poursuite, encerclement       | bouton du panneau Unités, puis clic sur une unité ennemie            |
| Tenir la position                     | `H`                                                                  |
| Annuler un ordre en cours de saisie   | `Échap` (ferme aussi l'écran de bataille)                            |
| Posture des unités choisies           | boutons « Posture » du panneau Unités (ou de l'armée, onglet Armées) |
| Écran de bataille                     | clic sur l'icône d'épées croisées d'un combat                        |
| Armées                                | onglet « Armées » du panneau de droite                               |
| Fiche d'un pays, diplomatie           | clic sur un pays, une de ses villes ou un de ses pions               |
| Sauvegarder, exporter, importer       | `Sauver` ou menu ☰                                                  |

Sur téléphone, en portrait comme en paysage : la barre du haut garde la pause, la date et la vitesse (un toucher fait défiler les vitesses), le reste passe dans le menu ☰. En portrait, le panneau devient un tiroir en bas, à tirer par sa poignée (replié, mi-hauteur, plein écran) ; en paysage, il reste sur le côté. Pour donner un ordre : bouton « Déplacer », « Attaquer » ou « Se replier », puis toucher la destination (le tiroir se replie le temps de viser). Le bouton ▢ active la sélection par zone : glisser un rectangle sur la carte sélectionne vos unités qu'il contient ; il marche aussi à la souris.

Ordres visant une unité ennemie : **assaut** (attaque de sa position du moment, puis tenue du terrain), **poursuite** (les unités la suivent jusqu'à sa destruction ou sa fuite à plus de 250 km), **encerclement** (au moins deux unités choisies, ou, depuis l'onglet Armées, un détachement automatique du tiers des unités de ligne de l'armée : elles forment un groupe « Encerclement de… », pendant que l'armée garde son front avec les autres). L'encerclement se fait en deux temps : les unités gagnent d'abord des points d'attente sur les flancs de la cible, puis, toutes prêtes (ou au bout de 3 jours), ferment ensemble l'anneau qui passe derrière elle. Le groupe rejoint son armée d'origine quand le groupe ennemi est détruit, 7 jours après la fermeture de l'anneau, ou plus tôt avec « Rejoindre l'armée » (onglet Armées).

Sauvegardes : `Sauver` enregistre la partie dans le navigateur (compressée). Une sauvegarde automatique est faite tous les 30 jours de jeu et au retour au menu. L'écran de départ propose de reprendre l'une ou l'autre. `Exporter` télécharge la partie dans un fichier, `Importer` la recharge (autre navigateur, autre appareil).

Onglet Production : jauges des chantiers en cours (5 au plus en parallèle), des casernes occupées et de la production engagée face à la production gagnée ; tant que l'onglet est ouvert, la carte montre les casernes (occupées/total, cercle vert s'il en reste une libre) et les fortifications de vos villes.

Une armée peut tenir tout le front ou une portion (deux clics sur la carte) : les extrémités tracées s'accrochent au front réel le plus proche (jusqu'à 150 km), la carte montre la ligne tenue, et chaque unité prend le poste libre le plus proche d'elle, sans traverser la carte. Les unités suivent le front quand il bouge. Une offensive se trace en deux clics (départ, objectif), puis se lance avec toute l'armée ou avec les seules unités sélectionnées (bouton « Avec la sélection ») : les autres continuent de tenir le front. Si toutes les unités d'une armée partent encercler, l'armée encercle elle-même, sans nouveau groupe, puis reprend son front.

Postures (unité ou armée entière ; une recrue reçoit celle de son armée) : elles modifient le combat et le comportement automatique.

| Posture     | Attaque | Défense | Décroche sous | Retranchement | Réflexe                                                       |
| ----------- | ------- | ------- | ------------- | ------------- | ------------------------------------------------------------- |
| Défense max | ×0,6    | ×1,3    | 30 % d'org.   | ×1,5          | jamais d'attaque d'elle-même                                  |
| Défensive   | ×0,85   | ×1,15   | 20 %          | ×1,2          | jamais d'attaque d'elle-même                                  |
| Équilibrée  | ×1      | ×1      | 15 %          | ×1            | achève un ennemi en déroute à moins de 12 km                  |
| Offensive   | ×1,2    | ×0,9    | 12 %          | ×0,8          | attaque un ennemi en déroute ou affaibli à moins de 20 km     |
| Dégâts max  | ×1,4    | ×0,8    | 5 %           | ×0,6          | poursuit les fuyards, attaque tout ennemi plus faible à 40 km |

Les réflexes ne concernent que les unités dont la posture a été choisie, et seulement quand elles n'exécutent pas un ordre du joueur. « Annuler l'ordre » arrête les unités ; celles d'une armée reprennent leur poste.

Écran de bataille : chaque combat qui vous concerne (vous, un allié ou un ennemi) a son icône sur la carte. Elle ouvre une fenêtre qui se met à jour en direct : lieu, terrain, franchissement de fleuve, rapport de force, puissance de feu, défense et pertes de chaque camp, et, pour chaque unité, le détail de ses modificateurs (effectifs, organisation, ravitaillement, commandement, posture, munitions, terrain, retranchement, fortifications).

Lecture des pions : cadre aux couleurs du camp, symbole OTAN simplifié, jauge verte = effectifs, jauge bleue = organisation, point orange = au contact, bordure rouge pointillée = hors ravitaillement, pion pâle = en déroute.

Les couleurs de la carte se lisent depuis votre point de vue : bleu pour vous, vert pour vos alliés, rouge pour vos ennemis, orange pour les pays en guerre entre eux ; les autres pays gardent une teinte discrète.

## Diplomatie

Onglet « Diplomatie » : stabilité, soutien à la guerre, relations, alliances et guerres de chaque pays.

- **Déclarer la guerre** : les alliés de la cible entrent en guerre contre vous. Impossible contre un membre de votre alliance.
- **Paix** : paix blanche (retour aux frontières d'avant-guerre) ou paix sur les lignes (chacun garde ce qu'il tient). L'adversaire accepte selon le terrain gagné ou perdu et son soutien à la guerre. L'IA peut aussi vous proposer la paix ; l'offre expire au bout de 15 jours.
- **Améliorer les relations** (+10, une fois par mois et par pays), **sanctionner** (sur la carte du monde, la production du pays visé baisse selon le poids économique des sanctionneurs, jusqu'à −40 % si le monde entier sanctionne ; sur le théâtre ukrainien, −10 % par pays), **proposer une alliance** (relations d'au moins +60), **appeler les alliés**, **quitter une alliance** (un pays peut en avoir plusieurs ; une alliance proposée devient un pacte bilatéral). Les organisations régionales rapprochent leurs membres, sans obligation militaire.
- **Mobiliser** (théâtre ukrainien et pays sans armée) : lève les forces ; en paix, coûte un peu de stabilité.
- **Aide étrangère** : un donneur verse chaque jour au receveur une part de ses revenus (6 %, 12 % ou 20 % selon le niveau : limitée, soutenue, massive) en munitions, production et points de construction ; la moitié de la production envoyée devient du matériel, livré sous forme d'unités équipées (le receveur fournit les hommes). Vous pouvez demander une aide (le pays décide selon vos relations, vos alliances et vos ennemis communs), en accorder une, changer son niveau ou y mettre fin ; les IA en guerre vous en demandent aussi. Aider un pays améliore vos relations avec lui et les dégrade avec ses ennemis. Au début de « Monde 2026 », l'Ukraine reçoit l'aide de 12 pays occidentaux, la Russie celle de la Corée du Nord et de l'Iran. Dans le théâtre ukrainien, les donneurs sont des pays hors carte (États-Unis, Allemagne, Royaume-Uni, Pologne, France pour l'Ukraine ; Corée du Nord et Iran pour la Russie) : sans territoire ni armée, ils ont une économie et une diplomatie, aident, peuvent être sollicités et ne peuvent pas entrer en guerre. Leurs fiches s'ouvrent depuis la liste « Pays hors carte » de l'onglet Diplomatie.

## Règles en bref

- **Politique** : la stabilité multiplie la production et la construction ; le soutien à la guerre agit sur la main-d'œuvre, la récupération des unités et la volonté de poursuivre une guerre. Il s'use avec la durée de la guerre et les pertes. Seuls les pays en guerre combattent ; les frontières des pays en paix restent fermées.

- **Front** : grille de 0,1° (~10 km) sur la carte du monde, 0,05° (~5 km) sur le théâtre ukrainien. Une cellule change de camp quand elle est dans la zone de contrôle d'une unité, hors de celle de toute unité ennemie, et touche déjà le territoire de ce camp.
- **Terrain** : forêts, collines, montagnes, marais, fleuves et villes modifient vitesse, défense et itinéraires (table `TERRAIN_RULES` dans `src/sim/theater/grid.ts`).
- **Combat** : au contact (10 km), chaque unité frappe l'ennemi le plus proche. L'artillerie frappe à 30 km. Défense renforcée par le terrain, le retranchement et les fortifications ; la posture module attaque et défense. Sous 15 % d'organisation (seuil selon la posture), une unité décroche et continue de reculer jusqu'à se rallier. Chaque tir consomme des munitions : à court, la puissance de feu est divisée par deux.
- **Commandement** : une unité à moins de 120 km d'un QG de son camp gagne 15 % au combat et récupère plus vite.
- **Ravitaillement** : relié aux sources de chaque camp (capitale et grandes villes nationales sur la carte du monde) et à ses dépôts, à travers son propre territoire. Les unités logistiques le prolongent de 60 km. Hors ravitaillement : combat à 60 %, attrition après 3 jours. Les poches sans défenseur s'effondrent.
- **Économie** : sur la carte du monde, les revenus viennent du pays entier : industrie d'après le PIB (plus ou moins tournée vers l'armée selon le pays), main-d'œuvre d'après la population, au prorata du territoire national tenu ; un territoire occupé rapporte 30 % de son rendement à l'occupant. Les bâtiments construits en cours de partie s'y ajoutent. Sur le théâtre ukrainien, les usines de départ dépendent de la population des villes. Dans les deux cas, les villes portent les bâtiments (usines civiles et militaires, casernes, dépôts, fortifications). Chaque jour : points de construction, production militaire, munitions et main-d'œuvre. Une caserne forme une unité à la fois ; les unités ravitaillées hors combat reçoivent des renforts. Une ville prise perd la moitié de ses usines, ses fortifications et son dépôt. Option « Gestion automatique » dans l'onglet Production. En paix, l'IA entretient son armée à son effectif de départ, relevé d'un quart face à un pays hostile.

## Fond de carte

Sans configuration, la carte utilise le fond de démo de MapLibre. Pour le fond Protomaps, crée un `.env.local` :

```bash
VITE_PMTILES_URL=https://ton-domaine/tiles/monde.pmtiles
```

## Données

### Carte du monde

`src/sim/data/world/countries.json` et `public/data/world-grid.bin.gz` sont générés depuis [Natural Earth](https://www.naturalearthdata.com/) (domaine public) : pays (population, PIB), fleuves, villes de plus de 750 000 habitants et capitales, plus la ville principale des territoires séparés (îles, enclaves). Le relief et l'occupation du sol viennent de `data/world-terrain-raw.bin.gz`, produit par le workflow « Données mondiales » (`scripts/fetch-terrain-world.py`) et publié sur la branche `data-world`. Les forces de chaque pays sont estimées à partir de son PIB et de sa population.

```bash
node scripts/build-world.mjs chemin/vers/natural-earth-vector/geojson
```

### Théâtre ukrainien

`src/sim/data/theater-ukraine.json` est généré depuis [Natural Earth](https://www.naturalearthdata.com/) (domaine public) : frontières de facto, fleuves majeurs, villes de plus de 250 000 habitants. Le relief (AWS Terrain Tiles) et l'occupation du sol ([ESA WorldCover 2021](https://esa-worldcover.org/), CC BY 4.0) viennent de `data/terrain-raw.json.gz`, produit par le workflow « Données du théâtre » (`scripts/fetch-terrain.py`) et publié sur la branche `data-results`.

```bash
pnpm theater chemin/vers/natural-earth-vector/geojson
```

## Architecture

- `src/sim/` : simulation en TypeScript pur, exécutée dans un Web Worker (`worker.ts`, via Comlink).
  - `simulation.ts` : état de la partie, boucle des systèmes, ordres du joueur, sauvegarde.
  - `politics/` : jauges, relations, guerres, paix, alliances, sanctions, mobilisation, IA diplomatique.
  - `systems/` : ravitaillement, mouvement, combat, territoire, armées, IA, pathfinding (A\*).
  - `economy/` : bâtiments, revenus, constructions, formations, renforts, IA économique.
  - `theater/grid.ts` : grille de contrôle (propriétaire et terrain par cellule).
  - `units/catalog.ts` : types d'unités de l'époque moderne.
  - `scenarios/` : scénarios de départ.
- `src/stores/game.ts` : store Pinia, pont entre l'interface et le Worker.
- `src/map/` : MapLibre GL pour le fond, deck.gl pour le territoire, les pions, les fronts et les flèches.
- `src/components/` : interface Vue.

1 tick = 1 heure de jeu. Vitesses 1 à 5 : 1, 3, 8, 24 et 72 ticks par seconde. Une heure simulée coûte environ 1 ms sur le théâtre ukrainien, 2 ms sur la carte du monde.

## Intégration et déploiement

- **CI** (`.github/workflows/ci.yml`) : formatage, types, tests, build, partie simulée, puis test de fumée dans Chromium (`e2e/smoke.mjs`) avec captures d'écran publiées sur la branche `ci-results`.
- **Déploiement** (`.github/workflows/pages.yml`) : chaque push sur `main` publie le jeu sur GitHub Pages (Settings → Pages → Source : GitHub Actions).

## Scripts

| Script              | Rôle                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------ |
| `pnpm dev`          | serveur de développement                                                             |
| `pnpm build`        | vérification des types + build                                                       |
| `pnpm test`         | tests unitaires                                                                      |
| `pnpm simulate 60`  | partie sans affichage sur 60 jours (équilibrage) ; `--monde --pays=FRA --ia-partout` |
| `pnpm theater …`    | régénère les données du théâtre                                                      |
| `pnpm format:check` | vérification du formatage                                                            |
