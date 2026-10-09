import { TickAccumulator } from './core/loop'
import { isSpeed, type Speed } from './core/clock'
import { Random } from './core/random'
import { encodeRle, SAVE_VERSION, type SaveFile } from './core/save'
import type {
  ArmyState,
  BattleReport,
  BuildingKind,
  CityState,
  CountryDef,
  CountryId,
  GameEvent,
  GameOutcome,
  LonLat,
  OrderKind,
  Posture,
  ScenarioDef,
  SimSnapshot,
  UnitKind,
  UnitState,
} from './core/types'
import { countryName, runtimeOf, sideIndex, type SimContext } from './context'
import { decodeRle, Grid, type TheaterData } from './theater/grid'
import { MODERN_CATALOG } from './units/catalog'
import { Pathfinder } from './systems/pathfinding'
import { updateSupply } from './systems/supply'
import { updateMovement, updatePursuits, planPath } from './systems/movement'
import { updatePostureReflexes } from './systems/postures'
import { battleReport } from './systems/battle'
import {
  autoDetachment,
  endEncirclement,
  stageEncirclement,
  targetGroup,
  updateEncirclements,
} from './systems/encircle'
import { updateCombat, updateCommand } from './systems/combat'
import { updateTerritory } from './systems/territory'
import { assignFront, launchOffensive, snapToFront, updateArmies } from './systems/armies'
import { updateAi, nearestCity, type AiState } from './systems/ai'
import {
  cancelConstruction,
  cancelRecruit,
  initCities,
  initEconomies,
  onCityCaptured,
  previewIncome,
  queueConstruction,
  queueRecruit,
  updateEconomy,
  updateSupplySources,
} from './economy/economy'
import { updateAiEconomy } from './economy/ai'
import { SideMatrix } from './politics/matrix'
import { mobilize } from './politics/mobilization'
import {
  aiAcceptsPeace,
  callAlliesToWars,
  capitulate,
  declareWar,
  enemiesInWar,
  improveRelations,
  isAtWarWith,
  leaveAlliance,
  makePeace,
  onCityLost,
  politicsSnapshot,
  proposeAlliance,
  rebuildMatrix,
  addRelation,
  setRelation,
  toggleSanction,
  updatePoliticsDaily,
  warsOf,
  type PoliticsHooks,
} from './politics/politics'
import { computeNeighbors, monthlyEvents, updateDiplomacyAi } from './politics/ai'
import {
  aidRelationsMonthly,
  answerAidRequest,
  applyAidFlows,
  deliverEquipment,
  grantAid,
  requestAid,
  revokeAid,
  setAidLevel,
  updateAidAi,
} from './politics/aid'
import type { AidLevel, Organization, PeaceKind, PoliticsState, War } from './politics/types'

/** Les poursuites recalculent leur chemin toutes les 6 heures. */
const PURSUIT_EVERY = 6
const MAX_EVENTS = 80
const ARMIES_EVERY = 24
const AI_EVERY = 12
const CITIES_EVERY = 6
const DAY = 24
const MONTH = 24 * 30
/** Sans unité pendant une guerre depuis plus de 7 jours : capitulation. */
const NO_ARMY_DAYS = 7
const DEFAULT_FORCE_SIZE = 8

export type PlayerOrder = Extract<OrderKind, 'move' | 'attack' | 'hold' | 'retreat'>

/** Organisations régionales du scénario, limitées aux pays présents. */
function organizationsOf(scenario: ScenarioDef, ctx: SimContext): Organization[] {
  return (scenario.politics?.organizations ?? []).map((o) => ({
    id: o.id,
    name: o.name,
    members: o.members.filter((m) => ctx.countries.has(m)),
  }))
}

function emptyPolitics(): PoliticsState {
  return {
    countries: new Map(),
    relations: new Map(),
    wars: [],
    alliances: [],
    organizations: [],
    sanctions: new Set(),
    offers: [],
    aids: [],
    aidRequests: [],
    aidRefusals: new Map(),
    nextId: 1,
  }
}

/** La partie : état complet, systèmes, et API d'ordres. Vit dans le Web Worker, testable sans navigateur. */
export class Simulation {
  readonly ctx: SimContext
  readonly clock = new TickAccumulator()
  outcome: GameOutcome | null = null
  readonly playerCountry: CountryId
  private events: GameEvent[] = []
  private nextId = 1
  /** État de l'IA militaire, par pays. */
  private ai = new Map<CountryId, AiState>()
  /** Vrai : l'IA commande aussi le pays du joueur (parties de test, mode spectateur). */
  aiControlsPlayer = false
  /** Vrai : l'IA gère l'économie du joueur (constructions et formations), le joueur garde ses armées. */
  autoEconomy = false
  private initialTerritory: number[] = []
  private publishedGridVersion = -1
  private neighbors: Map<CountryId, Set<CountryId>> | null = null
  /** Tick depuis lequel chaque pays en guerre n'a plus aucune unité. */
  private armylessSince = new Map<CountryId, number>()
  private readonly hooks: PoliticsHooks
  /** Cadence du ravitaillement : plus espacée sur les grandes grilles (coût du remplissage). */
  private readonly supplyEvery: number

  private constructor(
    readonly scenario: ScenarioDef,
    readonly theater: TheaterData,
    seed: number,
    playerCountry: CountryId,
  ) {
    const grid = new Grid(theater)
    // Les pays hors carte reçoivent un index de camp au-delà de ceux du théâtre : aucune cellule ne
    // leur appartient, mais la matrice des camps et les index restent valides.
    const sides = theater.sides.slice()
    for (const c of scenario.countries) {
      if (sides.includes(c.id)) continue
      if (!c.offMap) throw new Error(`Pays absent du théâtre : ${c.id}`)
      sides.push(c.id)
    }
    if (!scenario.countries.some((c) => c.id === playerCountry)) {
      throw new Error(`Pays du joueur inconnu : ${playerCountry}`)
    }
    this.playerCountry = playerCountry
    const matrix = new SideMatrix()
    this.ctx = {
      grid,
      rng: new Random(seed),
      tick: 0,
      units: new Map(),
      armies: new Map(),
      runtime: new Map(),
      catalog: MODERN_CATALOG,
      pathfinder: new Pathfinder(grid, matrix),
      sides,
      sideIndex: new Map(sides.map((c, i) => [c, i])),
      countries: new Map(scenario.countries.map((c) => [c.id, c])),
      matrix,
      politics: emptyPolitics(),
      supplySources: {},
      supplyReach: [],
      unsuppliedCells: [],
      homeOwner: grid.owner.slice(),
      cities: theater.cities,
      cityStates: new Map(),
      economies: new Map(),
      losses: new Map(),
      allocId: () => this.nextId++,
      log: (text, owner, minor) => this.log(text, owner, minor),
    }
    this.hooks = {
      armyName: (code) =>
        code === this.playerCountry ? '1re Armée' : `Armée (${countryName(this.ctx, code)})`,
    }
    this.supplyEvery = grid.size > 1_000_000 ? 24 : 6
    for (let s = 1; s < sides.length; s++) this.initialTerritory[s] = grid.countOwned(s)
  }

  get tick(): number {
    return this.ctx.tick
  }

  get aiCountries(): CountryId[] {
    const all = this.scenario.countries.map((c) => c.id)
    return this.aiControlsPlayer ? all : all.filter((id) => id !== this.playerCountry)
  }

  private aiState(country: CountryId): AiState {
    let s = this.ai.get(country)
    if (!s) {
      s = { lastOffensiveTick: 0 }
      this.ai.set(country, s)
    }
    return s
  }

  private initPolitics(): void {
    const ctx = this.ctx
    const sp = this.scenario.politics
    for (const c of this.scenario.countries) {
      ctx.politics.countries.set(c.id, {
        code: c.id,
        stability: sp?.stability?.[c.id] ?? 0.65,
        warSupport: sp?.warSupport?.[c.id] ?? 0.3,
        mobilized: false,
        forceSize: sp?.forceSize?.[c.id] ?? DEFAULT_FORCE_SIZE,
        lastImproveTick: 0,
      })
    }
    for (const [a, b, v] of sp?.relations ?? []) {
      if (ctx.countries.has(a) && ctx.countries.has(b)) setRelation(ctx, a, b, v)
    }
    ctx.politics.alliances = (sp?.alliances ?? []).map((a) => ({
      ...a,
      members: a.members.filter((m) => ctx.countries.has(m)),
    }))
    ctx.politics.organizations = organizationsOf(this.scenario, ctx)
    // Voisins : léger rapprochement, sauf pour les paires déjà fixées par le scénario.
    if (sp?.neighborRelation) {
      const fixed = new Set(
        (sp.relations ?? []).map(([a, b]) => (a < b ? `${a}|${b}` : `${b}|${a}`)),
      )
      this.neighbors = computeNeighbors(ctx)
      for (const [a, list] of this.neighbors) {
        for (const b of list) {
          if (a < b && !fixed.has(`${a}|${b}`)) addRelation(ctx, a, b, sp.neighborRelation)
        }
      }
    }
    for (const [from, to] of sp?.sanctions ?? []) {
      if (ctx.countries.has(from) && ctx.countries.has(to))
        ctx.politics.sanctions.add(`${from}>${to}`)
    }
    const ownerAtStart = encodeRle(ctx.grid.owner)
    for (const w of sp?.wars ?? []) {
      const war: War = {
        id: ctx.politics.nextId++,
        name: w.name,
        attackers: [...w.attackers],
        defenders: [...w.defenders],
        startTick: 0,
        startOwned: {},
        ownerAtStart,
      }
      for (const c of [...w.attackers, ...w.defenders]) {
        war.startOwned[c] = ctx.grid.countOwned(sideIndex(ctx, c))
      }
      for (const a of w.attackers) for (const d of w.defenders) setRelation(ctx, a, d, -100)
      ctx.politics.wars.push(war)
    }
    rebuildMatrix(ctx)
    for (const a of sp?.aids ?? []) {
      if (!ctx.countries.has(a.from) || !ctx.countries.has(a.to)) continue
      ctx.politics.aids.push({
        id: ctx.politics.nextId++,
        from: a.from,
        to: a.to,
        level: a.level,
        startTick: 0,
        equipment: 0,
        unitsDelivered: 0,
        lastDay: { munitions: 0, production: 0, construction: 0, equipment: 0 },
      })
    }
  }

  static fromScenario(
    scenario: ScenarioDef,
    theater: TheaterData,
    seed = 1,
    playerCountry = scenario.playerCountry,
  ): Simulation {
    const sim = new Simulation(scenario, theater, seed, playerCountry)
    const ctx = sim.ctx
    initCities(ctx, scenario)
    initEconomies(ctx, scenario)
    sim.initPolitics()
    // Mobilisation des pays en guerre au départ : unités explicites du scénario, ou levée générique.
    for (const country of scenario.countries) {
      if (ctx.matrix.atWar[sideIndex(ctx, country.id)] !== 1) continue
      const explicit = scenario.units.filter((u) => u.owner === country.id)
      mobilize(ctx, country, sim.hooks.armyName(country.id), explicit.length ? explicit : undefined)
    }
    // Armées du temps de paix : chaque pays a déjà ses forces, en garnison dans ses villes.
    if (scenario.politics?.armiesAtStart) {
      for (const country of scenario.countries) {
        // Micro-États absents de la grille (Vatican, Monaco…) : pas d'armée.
        if (ctx.grid.countOwned(sideIndex(ctx, country.id)) === 0) continue
        mobilize(ctx, country, sim.hooks.armyName(country.id))
      }
    }
    previewIncome(ctx, scenario)
    sim.afterLoad()
    return sim
  }

  static fromSave(save: SaveFile, scenario: ScenarioDef, theater: TheaterData): Simulation {
    if (save.scenarioId !== scenario.id) {
      throw new Error(`Sauvegarde d'un autre scénario : ${save.scenarioId}`)
    }
    const sim = new Simulation(scenario, theater, save.rngState, save.playerCountry)
    const ctx = sim.ctx
    ctx.tick = save.tick
    ctx.rng.state = save.rngState
    ctx.grid.owner.set(decodeRle(save.owner, ctx.grid.size))
    ctx.grid.recount()
    ctx.grid.takeDirty()
    for (const u of save.units) ctx.units.set(u.id, structuredClone(u))
    for (const a of save.armies) ctx.armies.set(a.id, structuredClone(a))
    sim.nextId = save.nextId
    sim.events = save.events.slice(-MAX_EVENTS)
    sim.outcome = save.outcome
    sim.autoEconomy = save.autoEconomy ?? false
    for (const [c, tick] of Object.entries(save.aiLastOffensiveTick)) {
      sim.ai.set(c, { lastOffensiveTick: tick })
    }
    if (isSpeed(save.speed)) sim.clock.setSpeed(save.speed)
    for (const [id, engagedWith, supplied, routed, commanded] of save.runtime) {
      ctx.runtime.set(id, { engagedWith, supplied, routed, commanded: commanded ?? false })
    }
    initCities(ctx, scenario)
    for (const c of save.cities) {
      const city = ctx.cityStates.get(c.name)
      if (city) {
        city.owner = c.owner
        city.buildings = { ...c.buildings }
      }
    }
    ctx.economies.clear()
    for (const e of save.economies) ctx.economies.set(e.country, structuredClone(e))
    const p = save.politics
    ctx.politics = {
      countries: new Map(p.countries.map((c) => [c.code, { ...c }])),
      relations: new Map(p.relations),
      wars: p.wars.map((w) => structuredClone(w)),
      alliances: p.alliances.map((a) => ({ ...a, members: [...a.members] })),
      organizations: organizationsOf(scenario, ctx),
      sanctions: new Set(p.sanctions),
      offers: p.offers.map((o) => ({ ...o })),
      aids: (p.aids ?? []).map((a) => structuredClone(a)),
      aidRequests: (p.aidRequests ?? []).map((r) => ({ ...r })),
      aidRefusals: new Map(p.aidRefusals ?? []),
      nextId: p.nextId,
    }
    for (const [c, since] of save.armylessSince) sim.armylessSince.set(c, since)
    for (const [c, lost] of save.losses) ctx.losses.set(c, lost)
    rebuildMatrix(ctx)
    updateSupplySources(ctx, scenario)
    save.supplyReach.forEach((rle, side) => {
      if (side === 0 || !rle || rle.length === 0) return
      const reach = decodeRle(rle, ctx.grid.size)
      ctx.supplyReach[side] = reach
      const pockets: number[] = []
      for (let i = 0; i < reach.length; i++) {
        if (ctx.grid.owner[i] === side && !reach[i] && ctx.grid.passable(i)) pockets.push(i)
      }
      ctx.unsuppliedCells[side] = pockets
    })
    return sim
  }

  private afterLoad(): void {
    updateSupplySources(this.ctx, this.scenario)
    updateSupply(this.ctx)
    updateCommand(this.ctx)
  }

  /**
   * Ajoute un événement au journal. Les événements mineurs (chantier achevé, nouvelle unité) ne sont
   * gardés que pour le joueur et les pays en guerre : sinon 240 pays rempliraient le journal.
   */
  private log(text: string, owner: CountryId | null, minor = false): void {
    if (minor && owner !== this.playerCountry) {
      const side = owner ? sideIndex(this.ctx, owner) : -1
      if (this.ctx.matrix.atWar[side] !== 1) return
    }
    this.events.push({ tick: this.ctx.tick, text, owner })
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS)
  }

  /** Pays IA dont les forces sont levées : seuls ceux-là ont une IA militaire et économique active. */
  private mobilizedAi(): CountryId[] {
    return this.aiCountries.filter((c) => this.ctx.politics.countries.get(c)?.mobilized)
  }

  /** Joue `count` heures de jeu. */
  step(count: number): void {
    const ctx = this.ctx
    for (let i = 0; i < count && !this.outcome; i++) {
      ctx.tick++
      if (ctx.tick % this.supplyEvery === 0) {
        updateSupply(ctx)
        updateCommand(ctx)
      }
      if (ctx.tick % PURSUIT_EVERY === 0) {
        updatePursuits(ctx)
        updateEncirclements(ctx)
        updatePostureReflexes(ctx)
      }
      updateMovement(ctx)
      updateCombat(ctx)
      updateTerritory(ctx)
      if (ctx.tick % AI_EVERY === 0) {
        for (const c of this.mobilizedAi()) {
          if (ctx.matrix.atWar[sideIndex(ctx, c)] === 1) updateAi(ctx, c, this.aiState(c))
        }
      }
      if (ctx.tick % DAY === 0) this.daily()
      if (ctx.tick % MONTH === 0) this.monthly()
      if (ctx.tick % ARMIES_EVERY === 0) updateArmies(ctx)
      if (ctx.tick % CITIES_EVERY === 0) this.updateCitiesAndVictory()
    }
  }

  private daily(): void {
    const ctx = this.ctx
    updateEconomy(ctx, this.scenario, (incomes) => applyAidFlows(ctx, incomes))
    deliverEquipment(ctx)
    const managed = this.mobilizedAi()
    if (this.autoEconomy && !managed.includes(this.playerCountry)) managed.push(this.playerCountry)
    for (const c of managed) updateAiEconomy(ctx, c)
    updateSupplySources(ctx, this.scenario)
    updatePoliticsDaily(ctx, ctx.losses)
    ctx.losses.clear()
  }

  private monthly(): void {
    const ctx = this.ctx
    this.neighbors ??= computeNeighbors(ctx)
    updateDiplomacyAi(ctx, this.aiCountries, this.playerCountry, this.neighbors, this.hooks)
    updateAidAi(ctx, this.aiCountries, this.playerCountry)
    aidRelationsMonthly(ctx)
    monthlyEvents(ctx, this.playerCountry)
  }

  private updateCitiesAndVictory(): void {
    const ctx = this.ctx
    const { grid } = ctx
    for (const city of ctx.cityStates.values()) {
      const c = city.def
      const now = grid.owner[grid.cellAt(c.lon, c.lat)] ?? 0
      const before = city.owner
      if (now === before) continue
      city.owner = now
      onCityCaptured(ctx, city, before)
      const by = ctx.sides[now] ?? null
      const loser = ctx.sides[before] ?? ''
      onCityLost(ctx, loser, by, c.pop > 1_000_000 || c.capital)
      ctx.log(`Ville prise (${countryName(ctx, by)}) : ${c.name}`, by)
      // Capitale perdue face à un ennemi : capitulation.
      if (c.capital && c.country === loser && by && isAtWarWith(ctx, by, loser)) {
        this.onCapitulation(loser, `prise de ${c.name}`)
        if (this.outcome) return
      }
    }
    // Plus aucune unité pendant une guerre : capitulation au bout d'une semaine.
    const alive = new Set([...ctx.units.values()].map((u) => u.owner))
    for (const [code, p] of ctx.politics.countries) {
      if (!p.mobilized || ctx.matrix.atWar[sideIndex(ctx, code)] !== 1 || alive.has(code)) {
        this.armylessSince.delete(code)
        continue
      }
      const since = this.armylessSince.get(code) ?? ctx.tick
      this.armylessSince.set(code, since)
      if (ctx.tick - since >= NO_ARMY_DAYS * DAY) {
        this.onCapitulation(code, 'armées anéanties')
        if (this.outcome) return
      }
    }
  }

  private onCapitulation(code: CountryId, reason: string): void {
    const ctx = this.ctx
    // Ennemis au moment de la capitulation (pour décider d'une victoire du joueur).
    const enemies = new Set(warsOf(ctx, code).flatMap((w) => enemiesInWar(w, code)))
    capitulate(ctx, code, reason)
    this.armylessSince.delete(code)
    if (code === this.playerCountry) {
      const winner = [...enemies][0] ?? ''
      this.endGame(winner, `${countryName(ctx, code)} capitule : ${reason}`)
    } else if (
      enemies.has(this.playerCountry) &&
      this.scenario.countries.filter((c) => !c.offMap).length === 2
    ) {
      // Théâtre à deux pays : la capitulation de l'adversaire termine la partie.
      this.endGame(this.playerCountry, `${countryName(ctx, code)} capitule : ${reason}`)
    }
  }

  private endGame(winner: CountryId, reason: string): void {
    this.outcome = { winner, reason }
    this.clock.setPaused(true)
    this.log(`Fin de partie : ${reason}`, winner)
  }

  // ---------- Ordres du joueur ----------

  private playerUnits(ids: number[]): UnitState[] {
    return ids
      .map((id) => this.ctx.units.get(id))
      .filter((u): u is UnitState => !!u && u.owner === this.playerCountry)
  }

  private playerArmy(id: number): ArmyState {
    const army = this.ctx.armies.get(id)
    if (!army || army.owner !== this.playerCountry) throw new Error(`Armée inconnue : ${id}`)
    return army
  }

  /** Donne un ordre à des unités. Plusieurs unités vers un même point se répartissent autour. */
  orderUnits(ids: number[], kind: PlayerOrder, target?: LonLat): void {
    const units = this.playerUnits(ids)
    units.forEach((u, k) => {
      if (runtimeOf(this.ctx, u.id).routed) return
      if (kind === 'hold') {
        u.order = { kind: 'hold' }
        u.path = []
        return
      }
      if (!target) return
      // Écartement de ~6 km entre unités pour éviter un empilement sur un seul point.
      const spread = (k - (units.length - 1) / 2) * 0.08
      const t: LonLat = [target[0] + spread, target[1]]
      u.order = { kind, target: t }
      planPath(this.ctx, u, t)
    })
  }

  /** Rapport détaillé d'une bataille (unités au contact, modificateurs). */
  battleReport(ids: number[]): BattleReport | null {
    return battleReport(this.ctx, ids, this.playerCountry)
  }

  /** Posture des unités choisies. */
  setPosture(ids: number[], posture: Posture): void {
    for (const u of this.playerUnits(ids)) u.posture = posture
  }

  /** Posture de toute une armée ; les recrues qui la rejoignent la reçoivent aussi. */
  setArmyPosture(armyId: number, posture: Posture): void {
    const army = this.playerArmy(armyId)
    army.posture = posture
    for (const id of army.unitIds) {
      const u = this.ctx.units.get(id)
      if (u) u.posture = posture
    }
  }

  /** Annule les ordres des unités : elles s'arrêtent ; celles d'une armée reprennent leur poste. */
  cancelOrders(ids: number[]): void {
    for (const u of this.playerUnits(ids)) {
      if (runtimeOf(this.ctx, u.id).routed) continue
      u.order = { kind: 'hold' }
      u.path = []
    }
  }

  /** Unité ennemie visée par un ordre du joueur, ou un message d'erreur. */
  private enemyTarget(targetId: number): UnitState | string {
    const target = this.ctx.units.get(targetId)
    if (!target) return 'Cible introuvable'
    if (!isAtWarWith(this.ctx, this.playerCountry, target.owner)) {
      return `Vous n'êtes pas en guerre contre ${countryName(this.ctx, target.owner)}`
    }
    return target
  }

  /** Poursuite : les unités suivent la cible jusqu'à sa destruction ou sa fuite hors de portée. */
  pursueUnit(ids: number[], targetId: number): string | null {
    const target = this.enemyTarget(targetId)
    if (typeof target === 'string') return target
    const units = this.playerUnits(ids).filter((u) => !runtimeOf(this.ctx, u.id).routed)
    if (units.length === 0) return 'Aucune unité disponible'
    for (const u of units) {
      u.order = { kind: 'pursue', unitId: target.id, target: [target.lon, target.lat] }
      planPath(this.ctx, u, [target.lon, target.lat])
    }
    this.log(`${units.length} unité(s) prennent en chasse ${target.name}`, this.playerCountry)
    return null
  }

  /** Assaut ponctuel : attaque de la position actuelle de la cible, puis tenue du terrain. */
  assaultUnit(ids: number[], targetId: number): string | null {
    const target = this.enemyTarget(targetId)
    if (typeof target === 'string') return target
    this.orderUnits(ids, 'attack', [target.lon, target.lat])
    return null
  }

  /**
   * Encerclement par les unités choisies par le joueur : elles quittent leur armée (qui garde son front
   * avec les autres) et forment un groupe d'encerclement.
   */
  encircle(ids: number[], targetId: number): string | null {
    const target = this.enemyTarget(targetId)
    if (typeof target === 'string') return target
    const units = this.playerUnits(ids).filter((u) => !runtimeOf(this.ctx, u.id).routed)
    if (units.length < 2) return 'Il faut au moins deux unités pour encercler'
    this.launchEncirclement(units, target)
    return null
  }

  /** Encerclement avec détachement automatique d'une partie de l'armée ; le reste tient le front. */
  encircleWithArmy(armyId: number, targetId: number): string | null {
    const target = this.enemyTarget(targetId)
    if (typeof target === 'string') return target
    const army = this.playerArmy(armyId)
    const members = army.unitIds
      .map((id) => this.ctx.units.get(id))
      .filter((u): u is UnitState => !!u)
    const units = autoDetachment(this.ctx, members, target)
    if (units.length < 2) return `${army.name} n'a pas assez d'unités de ligne à détacher`
    this.launchEncirclement(units, target)
    return null
  }

  private launchEncirclement(units: UnitState[], target: UnitState): void {
    // Armée d'origine : celle de la majorité des unités envoyées.
    const counts = new Map<number, number>()
    for (const u of units) {
      if (u.armyId !== null) counts.set(u.armyId, (counts.get(u.armyId) ?? 0) + 1)
    }
    const parentArmyId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    const parent = parentArmyId !== null ? this.ctx.armies.get(parentArmyId) : undefined
    // Toute l'armée part : pas de nouveau groupe, l'armée elle-même encercle, puis reprend son front.
    const wholeArmy =
      !!parent &&
      !parent.encirclement &&
      parent.unitIds.length === units.length &&
      units.every((u) => u.armyId === parent.id)
    const group = wholeArmy
      ? parent
      : this.ctx.armies.get(
          this.createArmy(
            `Encerclement de ${target.name}`,
            units.map((u) => u.id),
          ),
        )
    const staging = stageEncirclement(this.ctx, units, target)
    if (group) {
      const previousFront = wholeArmy
        ? { front: group.front, wholeFront: group.wholeFront }
        : undefined
      group.front = null
      group.wholeFront = false
      group.offensive = null
      group.encirclement = {
        targetIds: targetGroup(this.ctx, target).map((u) => u.id),
        targetName: target.name,
        parentArmyId: wholeArmy ? group.id : parentArmyId,
        phase: 'staging',
        startTick: this.ctx.tick,
        closeTick: null,
        staging,
        previousFront,
      }
    }
    this.log(
      `Encerclement lancé autour de ${target.name} (${units.length} unités)`,
      this.playerCountry,
    )
  }

  /** Le joueur met fin à un encerclement : le groupe rejoint son armée. */
  endEncirclement(armyId: number): void {
    const group = this.playerArmy(armyId)
    if (group.encirclement) endEncirclement(this.ctx, group, 'sur ordre')
  }

  createArmy(name: string, unitIds: number[]): number {
    const units = this.playerUnits(unitIds)
    const id = this.nextId++
    for (const u of units) {
      const prev = u.armyId !== null ? this.ctx.armies.get(u.armyId) : undefined
      if (prev) prev.unitIds = prev.unitIds.filter((x) => x !== u.id)
      u.armyId = id
    }
    this.ctx.armies.set(id, {
      id,
      name: name.trim() || `Armée ${id}`,
      owner: this.playerCountry,
      unitIds: units.map((u) => u.id),
      front: null,
      wholeFront: false,
      offensive: null,
    })
    this.removeEmptyArmies()
    return id
  }

  disbandArmy(id: number): void {
    const army = this.playerArmy(id)
    for (const uid of army.unitIds) {
      const u = this.ctx.units.get(uid)
      if (u) u.armyId = null
    }
    this.ctx.armies.delete(id)
  }

  setArmyFront(id: number, front: [LonLat, LonLat] | 'whole' | null): void {
    const army = this.playerArmy(id)
    army.wholeFront = front === 'whole'
    // Une portion tracée s'accroche au front réel.
    army.front =
      front === 'whole' || front === null
        ? null
        : snapToFront(this.ctx, sideIndex(this.ctx, army.owner), front)
    assignFront(this.ctx, army)
  }

  /** Planifie une offensive ; `unitIds` limite les unités engagées (le reste de l'armée tient le front). */
  planOffensive(id: number, from: LonLat, to: LonLat, unitIds?: number[]): void {
    const army = this.playerArmy(id)
    const chosen = unitIds?.filter((u) => army.unitIds.includes(u))
    army.offensive = {
      from,
      to,
      launched: false,
      unitIds: chosen && chosen.length > 0 ? chosen : undefined,
    }
  }

  launchOffensive(id: number): void {
    launchOffensive(this.ctx, this.playerArmy(id))
  }

  cancelOffensive(id: number): void {
    const army = this.playerArmy(id)
    if (army.offensive?.launched) {
      for (const uid of army.unitIds) {
        const u = this.ctx.units.get(uid)
        if (u && u.order.kind === 'attack') {
          u.order = { kind: 'hold' }
          u.path = []
        }
      }
    }
    army.offensive = null
  }

  /** Ajoute des unités du joueur à une armée existante (elles quittent leur armée précédente). */
  addUnitsToArmy(armyId: number, unitIds: number[]): void {
    const army = this.playerArmy(armyId)
    for (const u of this.playerUnits(unitIds)) {
      if (u.armyId === armyId) continue
      const prev = u.armyId !== null ? this.ctx.armies.get(u.armyId) : undefined
      if (prev) prev.unitIds = prev.unitIds.filter((x) => x !== u.id)
      u.armyId = armyId
      if (army.posture) u.posture = army.posture
      army.unitIds.push(u.id)
    }
    this.removeEmptyArmies()
    if (army.front || army.wholeFront) assignFront(this.ctx, army)
  }

  private removeEmptyArmies(): void {
    for (const [id, a] of this.ctx.armies) {
      if (a.owner === this.playerCountry && a.unitIds.length === 0) this.ctx.armies.delete(id)
    }
  }

  // ---------- Économie du joueur ----------

  /** Les commandes économiques renvoient un message d'erreur pour l'interface, ou null. */
  queueConstruction(city: string, kind: BuildingKind): string | null {
    return queueConstruction(this.ctx, this.playerCountry, city, kind)
  }

  cancelConstruction(id: number): void {
    cancelConstruction(this.ctx, this.playerCountry, id)
  }

  queueRecruit(kind: UnitKind, city: string, armyId: number | null): string | null {
    if (armyId !== null) this.playerArmy(armyId)
    return queueRecruit(this.ctx, this.playerCountry, kind, city, armyId)
  }

  cancelRecruit(id: number): void {
    cancelRecruit(this.ctx, this.playerCountry, id)
  }

  setAutoEconomy(on: boolean): void {
    this.autoEconomy = on
  }

  /** Lève les forces du joueur sans attendre une guerre (unités, armée qui tient le front). */
  mobilizePlayer(): string | null {
    const def = this.ctx.countries.get(this.playerCountry)
    const pol = this.ctx.politics.countries.get(this.playerCountry)
    if (!def || !pol) return 'Pays inconnu'
    if (pol.mobilized) return 'Forces déjà mobilisées'
    mobilize(this.ctx, def, this.hooks.armyName(this.playerCountry))
    // Une mobilisation en temps de paix pèse sur la stabilité.
    pol.stability = Math.max(0, pol.stability - 0.03)
    this.log(`${countryName(this.ctx, this.playerCountry)} mobilise ses forces`, this.playerCountry)
    return null
  }

  // ---------- Diplomatie du joueur ----------

  declareWar(target: CountryId): string | null {
    return declareWar(this.ctx, this.playerCountry, target, this.hooks)
  }

  /** Propose la paix dans une guerre : l'IA adverse principale décide aussitôt. */
  proposePeace(warId: number, kind: PeaceKind): string | null {
    const war = this.ctx.politics.wars.find((w) => w.id === warId)
    if (!war) return 'Guerre inconnue'
    const enemy = enemiesInWar(war, this.playerCountry)[0]
    if (!enemy) return "Vous n'êtes pas dans cette guerre"
    if (!aiAcceptsPeace(this.ctx, war, enemy, kind)) {
      return `${countryName(this.ctx, enemy)} refuse la paix`
    }
    makePeace(this.ctx, warId, this.playerCountry, kind)
    return null
  }

  answerPeaceOffer(id: number, accept: boolean): void {
    const pol = this.ctx.politics
    const offer = pol.offers.find((o) => o.id === id && o.to === this.playerCountry)
    pol.offers = pol.offers.filter((o) => o.id !== id)
    if (!offer) return
    if (accept) makePeace(this.ctx, offer.warId, offer.from, offer.kind)
    else {
      this.log(
        `Vous refusez la paix proposée par ${countryName(this.ctx, offer.from)}`,
        this.playerCountry,
      )
    }
  }

  improveRelations(target: CountryId): string | null {
    return improveRelations(this.ctx, this.playerCountry, target)
  }

  toggleSanction(target: CountryId): void {
    toggleSanction(this.ctx, this.playerCountry, target)
  }

  proposeAlliance(target: CountryId): string | null {
    return proposeAlliance(this.ctx, this.playerCountry, target)
  }

  leaveAlliance(id?: string): void {
    leaveAlliance(this.ctx, this.playerCountry, id)
  }

  callAllies(): string {
    const n = callAlliesToWars(this.ctx, this.playerCountry, this.hooks)
    return n > 0 ? `${n} allié(s) vous rejoignent` : 'Aucun allié ne vous rejoint'
  }

  // ---------- Aide étrangère ----------

  /** Demande d'aide du joueur à un pays IA, qui décide aussitôt. */
  requestAid(donor: CountryId): string | null {
    return requestAid(this.ctx, this.playerCountry, donor)
  }

  /** Aide accordée par le joueur (ou changement de niveau d'une aide existante). */
  grantAid(recipient: CountryId, level: AidLevel): string | null {
    return grantAid(this.ctx, this.playerCountry, recipient, level)
  }

  setAidLevel(id: number, level: AidLevel): void {
    setAidLevel(this.ctx, id, this.playerCountry, level)
  }

  /** Met fin à une aide donnée ou reçue par le joueur. */
  revokeAid(id: number): void {
    revokeAid(this.ctx, id, this.playerCountry)
  }

  answerAidRequest(id: number, accept: boolean, level: AidLevel = 1): string | null {
    return answerAidRequest(this.ctx, id, this.playerCountry, accept, level)
  }

  // ---------- Publication et sauvegarde ----------

  setSpeed(speed: Speed): void {
    this.clock.setSpeed(speed)
  }

  setPaused(paused: boolean): void {
    if (this.outcome) return
    this.clock.setPaused(paused)
  }

  /**
   * État publié vers l'interface. La grille complète n'est jointe qu'à la demande (chargement) ;
   * sinon, seules les cellules modifiées depuis la dernière publication (si `allowGrid`).
   */
  snapshot(forceGrid = false, allowGrid = true): SimSnapshot {
    const ctx = this.ctx
    const grid = ctx.grid
    let gridPatch: number[] | null = null
    if (forceGrid) {
      grid.takeDirty()
      this.publishedGridVersion = grid.version
    } else if (allowGrid && grid.version !== this.publishedGridVersion) {
      const cells = [...new Set(grid.takeDirty())]
      const patch = new Array<number>(cells.length * 2)
      cells.forEach((c, k) => {
        patch[2 * k] = c
        patch[2 * k + 1] = grid.owner[c] ?? 0
      })
      gridPatch = patch
      this.publishedGridVersion = grid.version
    }

    const territoryHeld: Record<CountryId, number> = {}
    for (let s = 1; s < ctx.sides.length; s++) {
      const initial = this.initialTerritory[s] ?? 1
      territoryHeld[ctx.sides[s] ?? ''] = grid.countOwned(s) / Math.max(1, initial)
    }
    const cities: CityState[] = [...ctx.cityStates.values()].map((c) => ({
      name: c.def.name,
      lon: c.def.lon,
      lat: c.def.lat,
      capital: c.def.capital,
      owner: ctx.sides[c.owner] || null,
      pop: c.def.pop,
      buildings: { ...c.buildings },
    }))
    const economy = ctx.economies.get(this.playerCountry)

    return {
      scenarioId: this.scenario.id,
      tick: ctx.tick,
      startDate: this.scenario.startDate,
      paused: this.clock.paused,
      speed: this.clock.speed,
      playerCountry: this.playerCountry,
      countries: this.scenario.countries.map((c) => ({ ...c, color: [...c.color] })),
      units: [...ctx.units.values()].map((u) => {
        const rt = runtimeOf(ctx, u.id)
        return {
          id: u.id,
          name: u.name,
          owner: u.owner,
          kind: u.kind,
          lon: u.lon,
          lat: u.lat,
          strength: u.strength,
          org: u.org,
          order: u.order.kind,
          target: u.order.target ?? null,
          // Le chemin n'est utile qu'à l'affichage des unités du joueur.
          path: u.owner === this.playerCountry ? u.path.map((p): LonLat => [p[0], p[1]]) : [],
          armyId: u.armyId,
          engaged: rt.engagedWith !== null,
          supplied: rt.supplied,
          routed: rt.routed,
          commanded: rt.commanded,
          posture: u.posture ?? 'balanced',
          engagedWith: rt.engagedWith,
        }
      }),
      armies: [...ctx.armies.values()]
        .filter((a) => a.owner === this.playerCountry)
        .map((a) => structuredClone(a)),
      cities,
      economy: economy ? structuredClone(economy) : null,
      autoEconomy: this.autoEconomy,
      politics: politicsSnapshot(ctx, this.playerCountry),
      events: this.events.slice(),
      territoryHeld,
      outcome: this.outcome,
      grid: forceGrid
        ? {
            version: grid.version,
            width: grid.width,
            height: grid.height,
            bbox: [
              grid.lon0,
              grid.lat0,
              grid.lon0 + grid.width * grid.cell,
              grid.lat0 + grid.height * grid.cell,
            ],
            owner: grid.owner.slice(),
            terrain: grid.terrain.slice(),
            sides: ctx.sides.slice(),
          }
        : null,
      gridPatch,
      gridVersion: grid.version,
    }
  }

  toSave(now = new Date()): SaveFile {
    const ctx = this.ctx
    const p = ctx.politics
    return {
      version: SAVE_VERSION,
      savedAt: now.toISOString(),
      scenarioId: this.scenario.id,
      playerCountry: this.playerCountry,
      tick: ctx.tick,
      speed: this.clock.speed,
      rngState: ctx.rng.state,
      nextId: this.nextId,
      units: [...ctx.units.values()].map((u) => structuredClone(u)),
      armies: [...ctx.armies.values()].map((a) => structuredClone(a)),
      events: this.events.slice(),
      outcome: this.outcome,
      aiLastOffensiveTick: Object.fromEntries(
        [...this.ai.entries()].map(([c, s]) => [c, s.lastOffensiveTick]),
      ),
      owner: encodeRle(ctx.grid.owner),
      // Tableau creux (seuls les camps en guerre ont une couverture) : on remplit les trous.
      supplyReach: Array.from(ctx.supplyReach, (r) => (r ? encodeRle(r) : [])),
      runtime: [...ctx.runtime.entries()].map(([id, r]) => [
        id,
        r.engagedWith,
        r.supplied,
        r.routed,
        r.commanded,
      ]),
      cities: [...ctx.cityStates.values()].map((c) => ({
        name: c.def.name,
        owner: c.owner,
        buildings: { ...c.buildings },
      })),
      economies: [...ctx.economies.values()].map((e) => structuredClone(e)),
      autoEconomy: this.autoEconomy,
      politics: {
        countries: [...p.countries.values()].map((c) => ({ ...c })),
        relations: [...p.relations.entries()],
        wars: p.wars.map((w) => structuredClone(w)),
        alliances: p.alliances.map((a) => ({ ...a, members: [...a.members] })),
        sanctions: [...p.sanctions],
        offers: p.offers.map((o) => ({ ...o })),
        aids: p.aids.map((a) => structuredClone(a)),
        aidRequests: p.aidRequests.map((r) => ({ ...r })),
        aidRefusals: [...p.aidRefusals.entries()],
        nextId: p.nextId,
      },
      armylessSince: [...this.armylessSince.entries()],
      losses: [...ctx.losses.entries()],
    }
  }

  /** Utilisé par les tests et le journal. */
  describeLocation(lon: number, lat: number): string {
    return nearestCity(this.ctx, lon, lat)
  }

  sideOf(country: CountryId): number {
    return sideIndex(this.ctx, country)
  }

  countryDef(code: CountryId): CountryDef | undefined {
    return this.ctx.countries.get(code)
  }
}
