import type { ModifierKey } from '@/sim/core/types'
import {
  EMBARK_HOURS,
  EMBARK_KM,
  LANDING_FACTOR,
  LANDING_HOURS,
  LANDING_ORG,
  MAX_LANDING_KM,
  OPPOSED_KM,
  OPPOSED_LOSS,
  PORT_BASE_CAPACITY,
  PORT_CAPACITY_MAX,
  SEA_KM_PER_HOUR,
} from '@/sim/systems/naval'
import {
  AIR_RANGE_KM,
  AIR_SUPPORT_BONUS,
  AIR_ZONE_KM,
  AIR_ZONES_MAX,
  BOMBING_MALUS,
  BOMBING_ORG_PER_HOUR,
  INTERDICTION_SLOW,
  SUPERIORITY_WEIGHT,
} from '@/sim/systems/air'
import {
  AIR_CAPACITY,
  AIR_KM_PER_HOUR,
  AIR_LOAD_HOURS,
  AIRFIELD_POP,
  DEST_PICK_KM,
  MAX_AIR_KM,
  RAIL_KM_PER_HOUR,
  RAIL_LOAD_HOURS,
  TRANSPORT_COST,
} from '@/sim/systems/transport'
import { BEACHHEAD_HOURS } from '@/sim/systems/territory'
import { AID_CAP, AID_MONEY_SHARE } from '@/sim/politics/aidLevels'
import { POSTURE_ORDER, POSTURES } from '@/sim/units/postures'
import { Terrain, TERRAIN_RULES } from '@/sim/theater/grid'
import {
  AUTO_RESEARCH_SHARE,
  BUDGET_LEVY,
  CAPTURED_CONDITION,
  MOBILIZATION_DRAG,
  MUNITIONS_CAP_DAYS,
  MUNITIONS_CAP_MIN,
  REPAIR_PER_DAY,
  START_INDUSTRY_BUDGET_SHARE,
  FACTORY_RESERVE_DAYS,
} from '@/sim/economy/budget'
import {
  BUILDINGS,
  CONSTRUCTION_PER_CIV,
  MUNITIONS_PER_MIL,
  PRODUCTION_PER_MIL,
  WAR_ECONOMY,
  FORT_BONUS_PER_LEVEL,
  FORT_RADIUS_KM,
  NO_MUNITIONS_FACTOR,
} from '@/sim/economy/rules'
import {
  CONTACT_KM,
  COMMAND_FACTOR,
  OUT_OF_SUPPLY_FACTOR,
  ROUT_ORG,
  RALLY_ORG,
} from '@/sim/systems/combat'
import {
  DEMINING_PER_DAY,
  OBSTACLE_FIRE_MALUS,
  OBSTACLE_LOSS_BONUS,
  OBSTACLES_PER_HOUR,
} from '@/sim/systems/obstacles'
import {
  FLANK_DEFENSE,
  FLANK_KM,
  FLANK_ORG_LOSS,
  SALIENT_SHARE,
  SURROUNDED_DEG,
  TWO_SIDES_DEG,
} from '@/sim/systems/flanks'
import { SOURCE_RADIUS_KM } from '@/sim/systems/supply'
import {
  FATIGUE_ATTACK_FACTOR,
  FATIGUE_COMBAT_MALUS,
  FATIGUE_COMBAT_PER_HOUR,
  FATIGUE_FRONT_PER_HOUR,
  FATIGUE_RECOVERY_MALUS,
  FATIGUE_REST_PER_HOUR,
  RELIEF_END,
  RELIEF_MAX_SHARE,
  RELIEF_START,
  REST_KM,
} from '@/sim/systems/fatigue'
import { MODERN_CATALOG } from '@/sim/units/catalog'
import { DESTROYED_BELOW, EQUIPMENT_WEIGHT } from '@/sim/units/equipment'
import { REINFORCE_PER_DAY } from '@/sim/economy/rules'
import {
  CORPS_DIVISIONS,
  DIVISION_MANEUVER,
  DIVISION_SUPPORT,
  JOIN_KM,
} from '@/sim/systems/formations'
import { OUT_OF_SECTOR_KM } from '@/sim/systems/armies'
import {
  ARMOR_OPEN_FACTOR,
  ARMOR_URBAN_FACTOR,
  ARTILLERY_STATIC_FACTOR,
  FUEL_HOURS,
  KIND_TERRAIN,
  MUNITIONS_PER_SHOT_BY_KIND,
  NO_FUEL_SPEED,
  STATIC_ENTRENCH_MAX,
  URBAN_ENTRENCH_MIN,
} from '@/sim/units/kinds'
import type { UnitKind } from '@/sim/core/types'
import {
  SUSTAIN_CRITICAL_DAYS,
  SUSTAIN_MAX_DAYS,
  SUSTAIN_WARNING_DAYS,
} from '@/sim/economy/sustainability'

/**
 * Aide en jeu : règles et modificateurs du combat, écrites à partir des constantes de la
 * simulation pour rester justes quand l'équilibrage change. Une section par thème, et une courte
 * explication par modificateur de l'écran de bataille (infobulle), qui renvoie à sa section.
 * À compléter au fil des phases suivantes.
 */

export type HelpSectionId =
  | 'combat'
  | 'terrain'
  | 'kinds'
  | 'entrench'
  | 'obstacles'
  | 'forts'
  | 'supply'
  | 'command'
  | 'borders'
  | 'postures'
  | 'flanks'
  | 'fatigue'
  | 'sustain'
  | 'budget'
  | 'naval'
  | 'transport'
  | 'air'

export interface HelpSection {
  id: HelpSectionId
  title: string
  paragraphs: string[]
  table?: { head: string[]; rows: string[][] }
}

/** Pourcentage signé d'un facteur multiplicatif : 1,15 → « +15 % », 0,6 → « −40 % ». */
export function signedPct(factor: number): string {
  const v = Math.round((factor - 1) * 100)
  if (v === 0) return '0 %'
  return `${v > 0 ? '+' : '−'}${Math.abs(v)} %`
}
const pct = (v: number): string => `${Math.round(v * 100)} %`
const days = (perHour: number): number => Math.round(1 / perHour / 24)

/** « infanterie 35 %, blindés 75 %… » : poids du matériel dans la force, par type de combat. */
function equipmentWeights(): string {
  const kinds: UnitKind[] = ['inf', 'tdf', 'mech', 'tank', 'art']
  return kinds
    .map((k) => `${MODERN_CATALOG[k].name.toLowerCase()} ${pct(EQUIPMENT_WEIGHT[k])}`)
    .join(', ')
}

/** « Infanterie 1, Blindés 1,5… » pour les types de combat. */
function kindList(values: Record<UnitKind, number>): string {
  const kinds: UnitKind[] = ['inf', 'tdf', 'mech', 'tank', 'art']
  return kinds
    .map((k) => `${MODERN_CATALOG[k].name.toLowerCase()} ${values[k].toLocaleString('fr-FR')}`)
    .join(', ')
}

const logisticsKm = MODERN_CATALOG.log.supplyRadiusKm
const hqKm = MODERN_CATALOG.hq.commandRadiusKm

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'combat',
    title: 'Combat',
    paragraphs: [
      `Deux unités ennemies à moins de ${CONTACT_KM} km sont au contact : chaque heure, chacune frappe, parmi les ennemis au contact, celui qui a reçu le moins de tirs dans l'heure, puis le plus proche ; l'artillerie frappe aussi à distance. Les pertes dépendent du rapport entre la puissance de feu du tireur et la défense de la cible (plafonné à 4 contre 1).`,
      "Puissance de feu = valeur d'attaque du type (ou de défense s'il n'attaque pas) × force (effectifs et matériel) × organisation × ravitaillement × commandement × posture × munitions × terrain selon le type × rapport de force entre types × fatigue. Défense = valeur de défense × force × organisation × ravitaillement × commandement × terrain (commun et selon le type) × retranchement × fortifications × posture × flanc × fatigue.",
      `Organisation : elle compte pour 25 % à 100 % de la valeur (×${(0.25).toLocaleString('fr-FR')} à vide). Sous ${pct(ROUT_ORG)} (seuil selon la posture), l'unité décroche et recule jusqu'à retrouver ${pct(RALLY_ORG)}.`,
      `Munitions : chaque tir en consomme, selon le type (voir Types d'unités) ; stock vide, puissance de feu ${signedPct(NO_MUNITIONS_FACTOR)}.`,
      'Fleuve : une attaque à travers un fleuve donne +40 % de défense à la cible.',
      `Effectifs et matériel : chaque unité a deux jauges, les hommes et le matériel (chars, pièces, véhicules, armes). Sa force vaut effectifs^(1 − p) × matériel^p, où p est le poids du matériel : ${equipmentWeights()}. Les pertes touchent les deux jauges, davantage le matériel pour les blindés et l'artillerie, davantage les hommes pour l'infanterie. Hors combat et ravitaillée, une unité reprend chaque jour jusqu'à ${pct(REINFORCE_PER_DAY)} d'effectifs (payés en main-d'œuvre) et ${pct(REINFORCE_PER_DAY)} de matériel (payé en production, que l'aide étrangère alimente), chacun de son côté. Sous ${pct(DESTROYED_BELOW)} de force, l'unité est détruite.`,
    ],
  },
  {
    id: 'terrain',
    title: 'Terrain',
    paragraphs: [
      "Le terrain de la cellule où se trouve l'unité multiplie sa défense et freine ses déplacements.",
    ],
    table: {
      head: ['Terrain', 'Défense', 'Vitesse'],
      rows: [
        Terrain.PLAIN,
        Terrain.URBAN,
        Terrain.FOREST,
        Terrain.HILLS,
        Terrain.MOUNTAINS,
        Terrain.MARSH,
        Terrain.RIVER,
      ].map((t) => {
        const r = TERRAIN_RULES[t]!
        return [r.name, signedPct(r.defense), signedPct(r.speed)]
      }),
    },
  },
  {
    id: 'kinds',
    title: "Types d'unités",
    paragraphs: [
      "Chaque type réagit au terrain à sa façon, en plus des effets communs : le tableau donne les écarts de vitesse, de puissance de feu et de défense (terrain de la cellule où se trouve l'unité).",
      `Rapports de force : blindés contre infanterie ou défense territoriale en plaine ${signedPct(ARMOR_OPEN_FACTOR)} de feu ; contre la même infanterie en ville, retranchée à ${pct(URBAN_ENTRENCH_MIN)} ou plus, ${signedPct(ARMOR_URBAN_FACTOR)} ; artillerie contre une unité immobile retranchée à moins de ${pct(STATIC_ENTRENCH_MAX)} ${signedPct(ARTILLERY_STATIC_FACTOR)}.`,
      `Munitions par tir : ${kindList(MUNITIONS_PER_SHOT_BY_KIND)} (infanterie = 1). Carburant : blindés, mécanisée, artillerie, logistique et QG sont motorisés ; coupés du ravitaillement plus de ${FUEL_HOURS} heures, leurs réservoirs sont vides et leur vitesse tombe à ${pct(NO_FUEL_SPEED)}. L'infanterie à pied n'en dépend pas.`,
    ],
    table: {
      head: ['Type', 'Terrain', 'Vitesse', 'Feu', 'Défense'],
      rows: (Object.keys(KIND_TERRAIN) as UnitKind[]).flatMap((k) =>
        Object.entries(KIND_TERRAIN[k] ?? {}).map(([code, e]) => [
          MODERN_CATALOG[k].name,
          TERRAIN_RULES[Number(code)]?.name ?? '',
          signedPct(e?.speed ?? 1),
          signedPct(e?.attack ?? 1),
          signedPct(e?.defense ?? 1),
        ]),
      ),
    },
  },
  {
    id: 'entrench',
    title: 'Retranchement',
    paragraphs: [
      "Une unité à l'arrêt se retranche peu à peu (plus vite en posture défensive, moins vite en offensive) ; retranchée à 100 %, sa défense gagne +50 %. Tout déplacement fait perdre le retranchement.",
    ],
  },
  {
    id: 'obstacles',
    title: 'Obstacles',
    paragraphs: [
      `Mines, barbelés, positions préparées : une unité à l'arrêt et retranchée, dans un pays en guerre ou dans une armée qui tient une frontière (même en paix), en pose sur sa cellule. Un champ complet demande ${days(OBSTACLES_PER_HOUR)} jours en terrain découvert, ${days(OBSTACLES_PER_HOUR * 2)} en ville, ${days(OBSTACLES_PER_HOUR * 1.5)} en forêt (plus vite en posture défensive).`,
      `Face à un champ complet, l'assaut perd ${pct(OBSTACLE_FIRE_MALUS)} de puissance de feu et l'attaquant subit ${pct(OBSTACLE_LOSS_BONUS)} de pertes en plus (tir direct seulement, l'artillerie n'est pas concernée). Les obstacles ne protègent que le camp qui les a posés ; l'occupant d'une cellule lève ceux de l'adversaire en ${Math.round(1 / DEMINING_PER_DAY)} jours environ.`,
    ],
  },
  {
    id: 'forts',
    title: 'Fortifications',
    paragraphs: [
      `Bâtiment de ville (${BUILDINGS.fort.maxPerCity} niveaux au plus, ${BUILDINGS.fort.minDays} jours de chantier au minimum) : chaque niveau donne ${signedPct(1 + FORT_BONUS_PER_LEVEL)} de défense aux unités du propriétaire de la ville à moins de ${FORT_RADIUS_KM} km. Quand plusieurs villes fortifiées se recouvrent, le meilleur niveau compte, sans cumul. Une ville prise perd ses fortifications.`,
      'La portée s’affiche autour de la ville sélectionnée, des villes du joueur quand le tiroir Production est ouvert et de toutes les villes fortifiées en mode Logistique.',
    ],
  },
  {
    id: 'supply',
    title: 'Ravitaillement',
    paragraphs: [
      `Le ravitaillement part des sources (capitale, grandes villes, dépôts : ${SOURCE_RADIUS_KM} km autour) et suit le territoire tenu ; une unité logistique ravitaillée le prolonge à ${logisticsKm} km. Une unité coupée voit sa puissance de feu et sa défense réduites (${signedPct(OUT_OF_SUPPLY_FACTOR)}), ne reçoit plus de renforts et récupère moins bien son organisation ; une unité motorisée tombe aussi en panne de carburant après ${FUEL_HOURS} heures.`,
      'Le mode Logistique (touche L) montre les zones reliées, coupées et les poches.',
    ],
  },
  {
    id: 'command',
    title: 'Commandement',
    paragraphs: [
      `Une unité à moins de ${hqKm} km d'un quartier général de son pays (qui n'est pas en déroute) est commandée : feu et défense ${signedPct(COMMAND_FACTOR)}, et elle récupère plus vite son organisation hors combat.`,
      `Divisions et corps : les brigades de chaque armée sont regroupées automatiquement en divisions (${DIVISION_MANEUVER} brigades de manœuvre et ${DIVISION_SUPPORT} d'artillerie au plus), les divisions en corps (${CORPS_DIVISIONS} au plus). Une recrue rejoint la division incomplète la plus proche (${JOIN_KM} km au plus), sinon une nouvelle division est formée. Le combat reste à la brigade : une formation sert à l'affichage (un pion quand le zoom réunit ses brigades), à la sélection et aux ordres, et ses brigades préfèrent des postes voisins sur le front (un poste hors de leur secteur compte ${OUT_OF_SECTOR_KM} km de plus).`,
    ],
  },
  {
    id: 'borders',
    title: 'Frontières tenues',
    paragraphs: [
      "« Tenir une frontière » (fiche de l'armée) : glissez le long de votre frontière terrestre pour la peindre, ou cliquez sur un pays voisin pour toute la frontière avec lui. L'armée s'y déploie sans franchir, en posture défensive en paix, se retranche et pose des obstacles même en paix ; les missions de ligne s'y appliquent.",
      "Si la guerre éclate avec ce voisin, la frontière devient le front de l'armée, sans redéploiement ; à la paix, elle retrouve sa frontière.",
      "Plusieurs armées se partagent une frontière sans chevauchement : un clic sur un voisin ne prend que les portions libres, une portion peinte est prise à l'armée qui la tenait, « Prendre toute la frontière » la retire aux autres armées.",
      "Côtes en option : la peinture prend aussi la côte de votre pays (un clic sur un voisin ne prend que la frontière terrestre). L'armée s'y déploie face à la mer, contre les débarquements ; la guerre ne change rien à la côte tenue.",
      "« Défendre des points » (mission de l'armée, groupe Défendre) : cochez villes, ports, bases (caserne, dépôt, fortification) ou aérodromes, pour tout le pays ou une zone de 100 à 400 km choisie d'un clic. Chaque point reçoit au moins une brigade de ligne, dans l'ordre d'importance (capitale d'abord, puis villes selon la population, un port ou une base ajoutant du poids), le reste au prorata ; l'appui rejoint le point le plus proche. Pas de riposte aux percées pendant cette mission.",
    ],
  },
  {
    id: 'postures',
    title: 'Postures',
    paragraphs: [
      "La posture dit comment l'unité combat : prise de risque, poursuite, retranchement. Elle se choisit pour une unité ou pour toute une armée.",
    ],
    table: {
      head: ['Posture', 'Attaque', 'Défense', 'Décroche sous', 'Effet'],
      rows: POSTURE_ORDER.map((p) => {
        const r = POSTURES[p]
        return [r.name, signedPct(r.attack), signedPct(r.defense), pct(r.routOrg), r.description]
      }),
    },
  },
  {
    id: 'flanks',
    title: 'Flancs',
    paragraphs: [
      `Recalculés chaque heure pour les unités au contact : une unité dont les ennemis à moins de ${FLANK_KM} km l'entourent sur ${TWO_SIDES_DEG}° ou plus est attaquée de deux côtés, sur ${SURROUNDED_DEG}° ou plus presque encerclée ; une unité dont ${pct(SALIENT_SHARE)} des cellules proches sont ennemies est en saillant (même effet que deux côtés). Un front droit occupe environ 110°, sans malus.`,
      `Deux côtés ou saillant : défense ${signedPct(FLANK_DEFENSE[1])}, pertes d'organisation ${signedPct(FLANK_ORG_LOSS[1])} ; presque encerclée : ${signedPct(FLANK_DEFENSE[2])} et ${signedPct(FLANK_ORG_LOSS[2])}.`,
    ],
  },
  {
    id: 'fatigue',
    title: 'Fatigue et relève',
    paragraphs: [
      `Une unité s'use au front : sa fatigue monte de ${pct(FATIGUE_COMBAT_PER_HOUR * 24)} par jour au contact (${signedPct(FATIGUE_ATTACK_FACTOR)} en attaque), de ${pct(FATIGUE_FRONT_PER_HOUR * 24)} par jour avec un ennemi à moins de ${REST_KM} km, et baisse de ${pct(FATIGUE_REST_PER_HOUR * 24)} par jour au repos, plus loin.`,
      `Une unité épuisée perd jusqu'à ${pct(FATIGUE_COMBAT_MALUS)} de puissance de feu et de défense, et récupère son organisation jusqu'à ${pct(FATIGUE_RECOVERY_MALUS)} moins vite.`,
      `Relève : l'armée envoie au repos, en retrait, ses unités de ligne fatiguées à ${pct(RELIEF_START)} ou plus (au plus ${pct(RELIEF_MAX_SHARE)} de ses unités de ligne à la fois, les plus fatiguées d'abord) et répartit leurs postes entre les autres ; elles reprennent leur place sous ${pct(RELIEF_END)}. Une unité au contact ne part qu'une fois le contact rompu. L'IA fait de même avec ses armées.`,
    ],
  },
  {
    id: 'sustain',
    title: "Soutenabilité de l'armée",
    paragraphs: [
      "La jauge « Armée » (barre du haut, tiroir Production) dit si l'économie peut maintenir l'armée actuelle au rythme actuel des pertes. Chaque jour, elle compare en moyenne glissante sur une semaine les besoins (renforts pour combler les pertes des unités en vie, au prix des renforts ; unités détruites, au prix d'une unité neuve ; munitions tirées) aux revenus (production, munitions, main-d'œuvre, aide étrangère comprise). Le ravitaillement ne coûte rien dans les règles actuelles.",
      `Quand une ressource est en déficit, ses stocks donnent le nombre de jours tenables ; la plus courte est le facteur limitant. Au-delà de ${SUSTAIN_MAX_DAYS} jours, ou sans déficit, l'armée est durable (le multiplicateur indique la couverture de la ressource la plus tendue). En orange sous ${SUSTAIN_WARNING_DAYS} jours, en rouge sous ${SUSTAIN_CRITICAL_DAYS}. Les nouvelles formations n'entrent pas dans les besoins : elles agrandissent l'armée.`,
    ],
  },
  {
    id: 'budget',
    title: 'Budget national et usines',
    paragraphs: [
      `Le PIB fournit chaque jour un budget : ${pct(BUDGET_LEVY)} du PIB du territoire tenu (un territoire occupé rapporte une part du sien à l'occupant), ${signedPct(WAR_ECONOMY[1].levy)} en mobilisation partielle et ${signedPct(WAR_ECONOMY[2].levy)} en guerre totale, réduit par l'instabilité et les sanctions. Il se répartit entre défense, construction, recherche et réserve.`,
      `Les usines sont des sites sur la carte. Une journée d'usine militaire à plein régime donne ${PRODUCTION_PER_MIL} de production et ${MUNITIONS_PER_MIL} munitions, une journée d'usine civile ${CONSTRUCTION_PER_CIV} points de construction ; elles coûtent chacune le même prix, fixé au départ pour chaque pays (l'industrie de départ à plein régime absorbe ${pct(START_INDUSTRY_BUDGET_SHARE)} du budget de paix). L'argent sans usines reste inemployé, des usines sans argent s'arrêtent.`,
      `Répartition automatique : la défense fait tourner les usines militaires, la construction paie ce que les chantiers en cours absorbent, ${pct(AUTO_RESEARCH_SHARE)} vont à la recherche, le reste à la réserve. La réserve couvre les manques de la défense, puis de la construction.`,
      `Une usine dont la cellule passe à l'ennemi lui revient, endommagée (${pct(CAPTURED_CONDITION)} de son rendement), puis se répare en ${Math.round((1 - CAPTURED_CONDITION) / REPAIR_PER_DAY)} jours environ. Plafond du stock de munitions : ${MUNITIONS_CAP_DAYS} jours de production des usines militaires, ${MUNITIONS_CAP_MIN} au moins.`,
      `La mobilisation retire des hommes à l'économie : chaque point de population active sous les drapeaux coûte environ ${MOBILIZATION_DRAG} points de PIB, atteints en quelques mois.`,
      `Aide étrangère en argent : un donneur à budget verse chaque jour ${pct(AID_MONEY_SHARE[1])}, ${pct(AID_MONEY_SHARE[2])} ou ${pct(AID_MONEY_SHARE[3])} de son budget selon le niveau d'aide, sans dépasser ${pct(AID_CAP[1])}, ${pct(AID_CAP[2])} ou ${pct(AID_CAP[3])} du budget du receveur ; l'argent va à la réserve du receveur.`,
      `L'IA (et la gestion automatique des constructions) ne lance une usine que si ses usines militaires sont payées et que sa réserve dépasse ${FACTORY_RESERVE_DAYS} jours de budget ; elle mène alors autant de chantiers que ses usines civiles le permettent.`,
    ],
  },
  {
    id: 'naval',
    title: 'Marine (provisoire)',
    paragraphs: [
      `Pas encore de navires : chaque port tenu (ville au bord de la mer) offre une capacité de transport de ${PORT_BASE_CAPACITY} brigade, plus 1 par million d'habitants (${PORT_CAPACITY_MAX} au plus). La somme des ports tenus, pris compris, fixe le nombre de brigades qu'un pays peut avoir en mer à la fois.`,
      `Débarquement : une brigade à moins de ${EMBARK_KM} km d'un port tenu embarque, quitte la carte (${EMBARK_HOURS} heures d'embarquement, puis ${SEA_KM_PER_HOUR} km par heure, ${MAX_LANDING_KM} km au plus) et débarque sur la côte choisie : à soi, à un ennemi, à un allié ou à un pays qui accorde le passage. À l'arrivée, son organisation tombe à ${pct(LANDING_ORG)} au plus, elle n'est pas retranchée et perd ${pct(1 - LANDING_FACTOR)} de feu et de défense pendant ${LANDING_HOURS} heures ; si un ennemi est à moins de ${OPPOSED_KM} km, elle perd aussi ${pct(OPPOSED_LOSS)} de ses effectifs et de son matériel. Si la côte s'est fermée entre-temps, elle rentre à son port.`,
      `Une brigade débarquée prend, pendant ${BEACHHEAD_HOURS} heures, la cellule où elle se tient : la tête de pont s'étend ensuite comme un front. Plus généralement, une cellule ennemie se prend si elle touche votre territoire, celui d'un cobelligérant ou d'un pays qui vous accorde le passage.`,
      "Tête de pont : une unité débarquée n'est ravitaillée que si elle est reliée à son territoire, ou par un port pris : un pays en guerre qui tient au moins un de ses ports nationaux ravitaille par la mer depuis chaque port étranger qu'il tient.",
    ],
  },
  {
    id: 'transport',
    title: 'Transport stratégique (provisoire)',
    paragraphs: [
      `« Transporter » puis clic sur une ville à vous, à un cobelligérant ou à un pays qui vous accorde le passage (la plus proche du clic, à moins de ${DEST_PICK_KM} km) : chaque unité choisie quitte la carte et y réapparaît à l'arrivée. Une unité au contact de l'ennemi ne part pas ; pendant le trajet, elle quitte son armée et sa division et ne peut être interceptée.`,
      `Le mode est choisi pour chaque unité, dans cet ordre. Rail : départ et arrivée reliés par un territoire ami continu ; ${RAIL_LOAD_HOURS} heures de chargement, puis ${RAIL_KM_PER_HOUR} km par heure sur la ligne droite allongée de 30 %. Mer : unité à moins de ${EMBARK_KM} km d'un port tenu et arrivée dans un port, ${MAX_LANDING_KM} km au plus ; mêmes délais et même capacité que les débarquements. Air : infanterie, défense territoriale et QG seulement, entre deux villes d'au moins ${Math.round(AIRFIELD_POP / 1000)} 000 habitants (départ à moins de ${EMBARK_KM} km), ${AIR_LOAD_HOURS} heures de préparation puis ${AIR_KM_PER_HOUR} km par heure, ${MAX_AIR_KM} km au plus et ${AIR_CAPACITY} unités en vol à la fois.`,
      `Coût en production, par 1 000 km (500 km comptés au moins) : ${pct(TRANSPORT_COST.rail)} du prix d'une unité neuve par le rail, ${pct(TRANSPORT_COST.sea)} par la mer, ${pct(TRANSPORT_COST.air)} par l'air. Si la ville d'arrivée n'est plus amie à l'arrivée, l'unité revient à son point de départ, ou à défaut à la ville tenue la plus proche.`,
      "L'IA en guerre sans aucun front s'en sert aussi : elle appelle ses alliés, demande au besoin le passage à un voisin de son ennemi (jamais à vous), y transporte la moitié de ses unités de ligne puis attaque ; sans route terrestre, elle débarque depuis son port le plus proche de la côte ennemie.",
    ],
  },
  {
    id: 'air',
    title: 'Aviation (provisoire)',
    paragraphs: [
      `Pas encore d'avions sur la carte : chaque pays a une puissance aérienne, égale au nombre de ses usines militaires (selon leur état, usines hors carte comprises). Il la répartit à parts égales entre ses zones de mission, ${AIR_ZONES_MAX} au plus, des cercles de ${AIR_ZONE_KM} km de rayon posés depuis le bloc « Aviation » du tiroir Forces, à moins de ${AIR_RANGE_KM} km d'un aérodrome tenu (ville d'au moins 200 000 habitants). Une zone qui n'a plus d'aérodrome à portée disparaît.`,
      `Maîtrise du ciel en un point : puissance des zones amies qui le couvrent, divisée par celle des zones amies et ennemies ; une zone de supériorité aérienne compte ${SUPERIORITY_WEIGHT} fois. Effets au sol, proportionnels à cette maîtrise : appui au sol, jusqu'à +${pct(AIR_SUPPORT_BONUS)} de feu et de défense pour vos unités dans la zone (pleinement sans aviation ennemie) ; bombardement, jusqu'à −${pct(BOMBING_MALUS)} de feu et de défense et ${(BOMBING_ORG_PER_HOUR * 100).toFixed(1).replace('.', ',')} point d'organisation perdu par heure pour les unités ennemies ; interdiction, jusqu'à −${pct(INTERDICTION_SLOW)} de vitesse pour les unités ennemies. L'IA en guerre pose une zone de supériorité et une d'appui au sol au-dessus de ses unités au contact.`,
    ],
  },
]

/** Explication courte de chaque modificateur de l'écran de bataille, et sa section d'aide. */
export const MODIFIER_HELP: Record<ModifierKey, { text: string; section: HelpSectionId }> = {
  strength: {
    text: "Effectifs restants (hommes) ; leur poids dans la force dépend du type d'unité.",
    section: 'combat',
  },
  equipment: {
    text: 'Matériel restant (chars, pièces, véhicules) ; pèse surtout pour les blindés et l’artillerie.',
    section: 'combat',
  },
  org: {
    text: `Organisation : compte de 25 % à 100 % de la valeur ; sous le seuil de la posture, l'unité décroche.`,
    section: 'combat',
  },
  supply: {
    text: `Coupée du ravitaillement : ${signedPct(OUT_OF_SUPPLY_FACTOR)} en feu et en défense.`,
    section: 'supply',
  },
  command: {
    text: `À moins de ${hqKm} km d'un QG de son pays : ${signedPct(COMMAND_FACTOR)}.`,
    section: 'command',
  },
  posture: {
    text: 'Posture choisie pour l’unité ou son armée : plus d’attaque se paie en défense, et inversement.',
    section: 'postures',
  },
  ammo: {
    text: `Stock de munitions du pays vide : ${signedPct(NO_MUNITIONS_FACTOR)} de puissance de feu.`,
    section: 'combat',
  },
  enemyObstacles: {
    text: `Champ d'obstacles adverse sous la cible : jusqu'à −${pct(OBSTACLE_FIRE_MALUS)} pour un assaut direct.`,
    section: 'obstacles',
  },
  terrain: {
    text: 'Terrain de la cellule : ville, forêt, collines, montagnes, marais et fleuve aident le défenseur.',
    section: 'terrain',
  },
  entrench: {
    text: "Retranchement gagné à l'arrêt : jusqu'à +50 % de défense, perdu en se déplaçant.",
    section: 'entrench',
  },
  fort: {
    text: `Ville fortifiée de son pays à moins de ${FORT_RADIUS_KM} km : ${signedPct(1 + FORT_BONUS_PER_LEVEL)} par niveau, le meilleur niveau compte.`,
    section: 'forts',
  },
  ownObstacles: {
    text: `Obstacles posés par son camp : l'assaut adverse perd jusqu'à ${pct(OBSTACLE_FIRE_MALUS)} de feu.`,
    section: 'obstacles',
  },
  obstacleLosses: {
    text: `En attaquant à travers des obstacles, l'unité subit jusqu'à ${pct(OBSTACLE_LOSS_BONUS)} de pertes en plus.`,
    section: 'obstacles',
  },
  flank: {
    text: `Prise de flanc : ${signedPct(FLANK_DEFENSE[1])} (deux côtés, saillant) ou ${signedPct(FLANK_DEFENSE[2])} (presque encerclée).`,
    section: 'flanks',
  },
  air: {
    text: `Aviation : jusqu'à +${pct(AIR_SUPPORT_BONUS)} sous un appui au sol ami, jusqu'à −${pct(BOMBING_MALUS)} sous un bombardement ennemi, selon la maîtrise du ciel.`,
    section: 'air',
  },
  landing: {
    text: `Débarquement récent : −${pct(1 - LANDING_FACTOR)} de feu et de défense pendant ${LANDING_HOURS} heures.`,
    section: 'naval',
  },
  fatigue: {
    text: `Fatigue de l'unité : jusqu'à −${pct(FATIGUE_COMBAT_MALUS)} de feu et de défense quand elle est épuisée.`,
    section: 'fatigue',
  },
  kindTerrain: {
    text: "Effet du terrain propre au type de l'unité : blindés gênés en forêt, en ville et dans les marais, infanterie avantagée en ville et en forêt, artillerie gênée en montagne.",
    section: 'kinds',
  },
  matchup: {
    text: `Rapport de force entre types : blindés contre infanterie à découvert ${signedPct(ARMOR_OPEN_FACTOR)}, contre infanterie retranchée en ville ${signedPct(ARMOR_URBAN_FACTOR)}, artillerie contre cible immobile à découvert ${signedPct(ARTILLERY_STATIC_FACTOR)}.`,
    section: 'kinds',
  },
  flankMorale: {
    text: `Prise de flanc : l'organisation fond plus vite (${signedPct(FLANK_ORG_LOSS[1])} ou ${signedPct(FLANK_ORG_LOSS[2])} de pertes).`,
    section: 'flanks',
  },
}
