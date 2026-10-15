# Charte de l'interface

Référence de style pour toute modification de l'interface sur grand écran. Les maquettes validées par Adrien (octobre 2026) sont sur le canvas « Refonte des écrans nkg-conflict » ; elles ne sont plus maintenues une fois l'écran codé, et cette charte fait foi. Le téléphone garde son style actuel pour l'instant.

## Principes

- **Peu d'informations à la fois.** Une fiche montre l'entité et l'essentiel ; le reste passe dans une infobulle, un volet ou un détail replié.
- **Infos communes regroupées.** Les mêmes blocs partout : en-tête (symbole, nom, sous-titre), jauges, puces d'état, tuiles d'action, liste de l'échelon en dessous.
- **Un choix ouvre un volet accolé.** Les tuiles Ordre, Posture, Mission, Renforts ou Aide ouvrent un volet collé à gauche de la fiche ; la fiche reste visible.
- **Le texte d'explication va dans les infobulles**, jamais en paragraphe dans un panneau.

## Couleurs

Toutes les couleurs sont des variables de `src/styles/theme.css` (`--nkg-…`). Un nouveau composant n'écrit pas de couleur en dur.

| Rôle                                   | Variable                                | Valeur                |
| -------------------------------------- | --------------------------------------- | --------------------- |
| Fond de panneau (dégradé)              | `--nkg-panel-bg`                        | `#1b222c` → `#141920` |
| Filet doré, anneau                     | `--nkg-brass-dark`, `--nkg-brass-deep`  | `#8a7146`, `#5a4a2e`  |
| Accent (icônes, élément actif)         | `--nkg-brass`, `--nkg-brass-light`      | `#c9a65f`, `#e0c27a`  |
| Texte, texte secondaire                | `--nkg-text`, `--nkg-text-muted`        | `#e9e4d8`, `#aeb6c0`  |
| Libellé de section (capitales)         | `--nkg-label`                           | `#b9a67f`             |
| Tuile, tuile active                    | `--nkg-tile-bg`, `--nkg-tile-on-bg`     | gris bleu, laiton     |
| Bon, attention, grave                  | `--nkg-good`, `--nkg-warn`, `--nkg-bad` | vert, ambre, rouge    |
| Action dangereuse (déclarer la guerre) | `--nkg-danger-line` et texte `#f0b0a5`  |                       |
| Joueur                                 | `--nkg-player`                          | `#3b6fd8`             |

## Typographie

- Titres de panneau, noms d'entités, date : **Spectral** (`--nkg-serif`), 600, 20 à 26 px.
- Texte courant et boutons : **IBM Plex Sans** (`--nkg-sans`), 13 px ; détails 11,5 à 12,5 px.
- Libellés de section : 11 px, capitales, espacement 0,12 em, couleur `--nkg-label`.
- Chiffres alignés : `font-variant-numeric: tabular-nums`.
- La carte garde Barlow pour ses étiquettes.

## Composants

- **Panneau** : `background: var(--nkg-panel-bg)`, bordure 1 px `--nkg-brass-dark`, rayon 4 px, ombre `--nkg-panel-shadow` (double anneau et ombre portée). En-tête : titre serif à gauche, bouton fermer carré de 30 px à droite, filet `--nkg-brass-line` dessous.
- **Tuile d'action** : dégradé `--nkg-tile-bg`, bordure `--nkg-line-strong`, rayon 6 px, icône laiton + libellé en capitales + valeur en cours. Survol : bordure `--nkg-brass`. Active ou volet ouvert : `--nkg-tile-on-bg`, bordure `--nkg-brass-light`.
- **Bouton principal** : dégradé doré `--nkg-gold-bg`, texte `#1a140a`.
- **Jauge** : barre de 5 à 6 px, fond `#2b333e`, vert au-dessus de 70 %, ambre au-dessus de 40 %, rouge en dessous.
- **Puce d'état** : pastille arrondie, fond `#1a212a`, bordure `#3a4452`, 12 px.
- **Séparateur** : `--nkg-divider` (filet doré qui s'estompe aux bords).
- **Onglets** : libellés en ligne, filet laiton sous l'onglet actif (tiroir Production).
- **Fenêtre modale** (menu « En pause », bataille) : panneau centré sur un voile `rgba(8, 10, 14, 0.6)`, titre serif.
- **Alertes** : cloche dans la barre du haut avec pastille ambre du nombre ; elle déplie ou replie la liste.

Les tiroirs reçoivent du cadre (`GameFrame.vue`) un style de bouton par défaut à sélecteur fort ; un composant qui veut un autre bouton (onglet, tuile) le préfixe d'au moins quatre classes, par exemple `.production.desk .tabs .tab`.

## Icônes

Icônes au trait (`src/components/NkgIcon.vue`) : grille 24 × 24, trait 1,7, extrémités arrondies, couleur du texte (`currentColor`), laiton par défaut dans les panneaux. Pas d'emoji ni de symbole Unicode sur grand écran. Les symboles d'unités suivent l'OTAN (`EchelonSymbol.vue`).

## Tailles et placement (1440 × 900)

- Barre du haut : 52 px. Rail : 14 px du bord gauche, boutons 64 × 60.
- Tiroir de gauche : 104 px du bord, 360 px de large. Fiche de droite : 18 px du bord, 340 px. Volet accolé : 300 à 330 px, collé à gauche de la fiche.
- Panneaux sous la barre : 70 px du haut. Contrôles de carte : en bas à droite, 44 px.
