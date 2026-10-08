import { TickAccumulator } from './core/loop'
import { isSpeed, type Speed } from './core/clock'
import { Random } from './core/random'
import { encodeRle, SAVE_VERSION, type SaveFile } from './core/save'
import type {
  ArmyState,
  CityState,
  CountryId,
  GameEvent,
  GameOutcome,
  LonLat,
  OrderKind,
  ScenarioDef,
  SimSnapshot,
  UnitState,
} from './core/types'
import { runtimeOf, sideIndex, type SimContext } from './context'
import { decodeRle, Grid, type TheaterData } from './theater/grid'
import { MODERN_CATALOG } from './units/catalog'
import { Pathfinder } from './systems/pathfinding'
import { updateSupply } from './systems/supply'
import { updateMovement, planPath } from './systems/movement'
import { updateCombat, updateCommand } from './systems/combat'
import { updateTerritory } from './systems/territory'
import { assignFront, launchOffensive, updateArmies } from './systems/armies'
import { updateAi, nearestCity, type AiState } from './systems/ai'

const MAX_EVENTS = 60
const SUPPLY_EVERY = 6
const ARMIES_EVERY = 24
const AI_EVERY = 12
const CITIES_EVERY = 6

export type PlayerOrder = Extract<OrderKind, 'move' | 'attack' | 'hold' | 'retreat'>

/** La partie : état complet, systèmes, et API d'ordres. Vit dans le Web Worker, testable sans navigateur. */
export class Simulation {
  readonly ctx: SimContext
  readonly clock = new TickAccumulator()
  outcome: GameOutcome | null = null
  private events: GameEvent[] = []
  private nextId = 1
  private ai: AiState = { lastOffensiveTick: 0 }
  private cityOwner = new Map<string, number>()
  private initialTerritory: number[] = []
  private publishedGridVersion = -1

  private constructor(
    readonly scenario: ScenarioDef,
    readonly theater: TheaterData,
    seed: number,
  ) {
    const grid = new Grid(theater)
    const sides = ['', ...scenario.countries.map((c) => c.id)]
    // Les camps de la grille sont dans l'ordre des données du théâtre ; on vérifie qu'ils correspondent.
    if (theater.sides.join(',') !== sides.join(',')) {
      throw new Error(`Camps du théâtre (${theater.sides}) différents du scénario (${sides})`)
    }
    this.ctx = {
      grid,
      rng: new Random(seed),
      tick: 0,
      units: new Map(),
      armies: new Map(),
      runtime: new Map(),
      catalog: MODERN_CATALOG,
      pathfinder: new Pathfinder(grid),
      sides,
      supplySources: scenario.supplySources,
      supplyReach: [],
      unsuppliedCells: [],
      cities: theater.cities,
      log: (text, owner) => this.log(text, owner),
    }
    for (let s = 1; s < sides.length; s++) this.initialTerritory[s] = grid.countOwned(s)
  }

  get tick(): number {
    return this.ctx.tick
  }

  get playerCountry(): CountryId {
    return this.scenario.playerCountry
  }

  get aiCountries(): CountryId[] {
    return this.scenario.countries.map((c) => c.id).filter((id) => id !== this.playerCountry)
  }

  static fromScenario(scenario: ScenarioDef, theater: TheaterData, seed = 1): Simulation {
    const sim = new Simulation(scenario, theater, seed)
    const ctx = sim.ctx
    for (const country of scenario.countries) {
      const units = scenario.units.filter((u) => u.owner === country.id)
      const army: ArmyState = {
        id: sim.nextId++,
        name:
          country.id === scenario.playerCountry ? '1re Armée' : `Groupe d'armées (${country.name})`,
        owner: country.id,
        unitIds: [],
        front: null,
        wholeFront: true,
        offensive: null,
      }
      for (const def of units) {
        const u: UnitState = {
          id: sim.nextId++,
          name: def.name,
          owner: def.owner,
          kind: def.kind,
          lon: def.lon ?? 0,
          lat: def.lat ?? 0,
          strength: def.strength ?? 1,
          org: 1,
          entrench: 0.5,
          order: { kind: 'hold' },
          path: [],
          armyId: army.id,
          hoursOutOfSupply: 0,
        }
        ctx.units.set(u.id, u)
        army.unitIds.push(u.id)
      }
      ctx.armies.set(army.id, army)
      // Déploiement initial le long du front (les unités sans position fixe).
      const fixed = new Set(units.flatMap((d, k) => (d.lon !== undefined ? [army.unitIds[k]] : [])))
      const auto = { ...army, unitIds: army.unitIds.filter((id) => !fixed.has(id)) }
      assignFront(ctx, auto, true)
      for (const id of army.unitIds) {
        const u = ctx.units.get(id)
        if (u) u.entrench = 0.5
      }
    }
    sim.afterLoad()
    return sim
  }

  static fromSave(save: SaveFile, scenario: ScenarioDef, theater: TheaterData): Simulation {
    if (save.scenarioId !== scenario.id) {
      throw new Error(`Sauvegarde d'un autre scénario : ${save.scenarioId}`)
    }
    const sim = new Simulation(scenario, theater, save.rngState)
    const ctx = sim.ctx
    ctx.tick = save.tick
    ctx.rng.state = save.rngState
    const owner = decodeRle(save.owner, ctx.grid.size)
    ctx.grid.owner.set(owner)
    ctx.grid.version++
    for (const u of save.units) ctx.units.set(u.id, structuredClone(u))
    for (const a of save.armies) ctx.armies.set(a.id, structuredClone(a))
    sim.nextId = save.nextId
    sim.events = save.events.slice(-MAX_EVENTS)
    sim.outcome = save.outcome
    sim.ai.lastOffensiveTick = save.aiLastOffensiveTick
    if (isSpeed(save.speed)) sim.clock.setSpeed(save.speed)
    for (const [id, engagedWith, supplied, routed, commanded] of save.runtime) {
      ctx.runtime.set(id, { engagedWith, supplied, routed, commanded: commanded ?? false })
    }
    save.supplyReach.forEach((rle, side) => {
      if (side === 0) return
      const reach = decodeRle(rle, ctx.grid.size)
      ctx.supplyReach[side] = reach
      const pockets: number[] = []
      for (let i = 0; i < reach.length; i++) {
        if (ctx.grid.owner[i] === side && !reach[i] && ctx.grid.passable(i)) pockets.push(i)
      }
      ctx.unsuppliedCells[side] = pockets
    })
    sim.cityOwner = new Map(save.cityOwner)
    return sim
  }

  private afterLoad(): void {
    updateSupply(this.ctx)
    updateCommand(this.ctx)
    this.indexCities()
  }

  private indexCities(): void {
    for (const c of this.ctx.cities) {
      this.cityOwner.set(c.name, this.ctx.grid.owner[this.ctx.grid.cellAt(c.lon, c.lat)] ?? 0)
    }
  }

  private log(text: string, owner: CountryId | null): void {
    this.events.push({ tick: this.ctx.tick, text, owner })
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS)
  }

  /** Joue `count` heures de jeu. */
  step(count: number): void {
    const ctx = this.ctx
    for (let i = 0; i < count && !this.outcome; i++) {
      ctx.tick++
      if (ctx.tick % SUPPLY_EVERY === 0) {
        updateSupply(ctx)
        updateCommand(ctx)
      }
      updateMovement(ctx)
      updateCombat(ctx)
      updateTerritory(ctx)
      if (ctx.tick % AI_EVERY === 0) {
        for (const c of this.aiCountries) updateAi(ctx, c, this.ai)
      }
      if (ctx.tick % ARMIES_EVERY === 0) updateArmies(ctx)
      if (ctx.tick % CITIES_EVERY === 0) this.updateCitiesAndVictory()
    }
  }

  private updateCitiesAndVictory(): void {
    const { grid } = this.ctx
    for (const c of this.ctx.cities) {
      const now = grid.owner[grid.cellAt(c.lon, c.lat)] ?? 0
      const before = this.cityOwner.get(c.name) ?? 0
      if (now !== before) {
        this.cityOwner.set(c.name, now)
        const by = this.ctx.sides[now] ?? null
        this.log(`Ville prise (${this.countryName(by)}) : ${c.name}`, by)
        if (c.capital && c.country === this.ctx.sides[before]) {
          this.endGame(by ?? '', `Prise de ${c.name}, capitale`)
          return
        }
      }
    }
    for (const country of this.scenario.countries) {
      const alive = [...this.ctx.units.values()].some((u) => u.owner === country.id)
      if (!alive) {
        const winner = this.scenario.countries.find((c) => c.id !== country.id)
        this.endGame(winner?.id ?? '', `Armées de ${country.name} anéanties`)
        return
      }
    }
  }

  private endGame(winner: CountryId, reason: string): void {
    this.outcome = { winner, reason }
    this.clock.setPaused(true)
    this.log(`Fin de partie : ${reason}`, winner)
  }

  private countryName(id: CountryId | null): string {
    return this.scenario.countries.find((c) => c.id === id)?.name ?? 'personne'
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
    army.front = front === 'whole' ? null : front
    assignFront(this.ctx, army)
  }

  planOffensive(id: number, from: LonLat, to: LonLat): void {
    this.playerArmy(id).offensive = { from, to, launched: false }
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

  private removeEmptyArmies(): void {
    for (const [id, a] of this.ctx.armies) {
      if (a.owner === this.playerCountry && a.unitIds.length === 0) this.ctx.armies.delete(id)
    }
  }

  // ---------- Publication et sauvegarde ----------

  setSpeed(speed: Speed): void {
    this.clock.setSpeed(speed)
  }

  setPaused(paused: boolean): void {
    if (this.outcome) return
    this.clock.setPaused(paused)
  }

  /** État publié vers l'interface. La grille n'est jointe que si elle a changé (ou si `forceGrid`). */
  snapshot(forceGrid = false, allowGrid = true): SimSnapshot {
    const ctx = this.ctx
    const grid = ctx.grid
    const includeGrid = forceGrid || (allowGrid && grid.version !== this.publishedGridVersion)
    if (includeGrid) this.publishedGridVersion = grid.version

    const territoryHeld: Record<CountryId, number> = {}
    for (let s = 1; s < ctx.sides.length; s++) {
      const initial = this.initialTerritory[s] ?? 1
      territoryHeld[ctx.sides[s] ?? ''] = grid.countOwned(s) / Math.max(1, initial)
    }
    const cities: CityState[] = ctx.cities.map((c) => ({
      name: c.name,
      lon: c.lon,
      lat: c.lat,
      capital: c.capital,
      owner: ctx.sides[grid.owner[grid.cellAt(c.lon, c.lat)] ?? 0] || null,
    }))

    return {
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
        }
      }),
      armies: [...ctx.armies.values()]
        .filter((a) => a.owner === this.playerCountry)
        .map((a) => structuredClone(a)),
      cities,
      events: this.events.slice(),
      territoryHeld,
      outcome: this.outcome,
      grid: includeGrid
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
      gridVersion: grid.version,
    }
  }

  toSave(now = new Date()): SaveFile {
    const ctx = this.ctx
    return {
      version: SAVE_VERSION,
      savedAt: now.toISOString(),
      scenarioId: this.scenario.id,
      tick: ctx.tick,
      speed: this.clock.speed,
      rngState: ctx.rng.state,
      nextId: this.nextId,
      units: [...ctx.units.values()].map((u) => structuredClone(u)),
      armies: [...ctx.armies.values()].map((a) => structuredClone(a)),
      events: this.events.slice(),
      outcome: this.outcome,
      aiLastOffensiveTick: this.ai.lastOffensiveTick,
      owner: encodeRle(ctx.grid.owner),
      supplyReach: ctx.supplyReach.map((r) => (r ? encodeRle(r) : [])),
      runtime: [...ctx.runtime.entries()].map(([id, r]) => [
        id,
        r.engagedWith,
        r.supplied,
        r.routed,
        r.commanded,
      ]),
      cityOwner: [...this.cityOwner.entries()],
    }
  }

  /** Utilisé par les tests et le journal. */
  describeLocation(lon: number, lat: number): string {
    return nearestCity(this.ctx, lon, lat)
  }

  sideOf(country: CountryId): number {
    return sideIndex(this.ctx, country)
  }
}
