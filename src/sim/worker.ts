/// <reference lib="webworker" />
import * as Comlink from 'comlink'
import { isSpeed } from './core/clock'
import { parseSave, serializeSave } from './core/save'
import type {
  AdvanceGoal,
  LineMissionKind,
  BattleReport,
  BuildingKind,
  CountryId,
  LonLat,
  Posture,
  ScenarioOptions,
  SimSnapshot,
  UnitKind,
  WarEconomyLevel,
} from './core/types'
import { buildScenario, SCENARIOS } from './scenarios'
import { Simulation, type PlayerOrder } from './simulation'
import type { SupplyView } from './systems/supplyView'
import type { MissionPreview } from './systems/armies'
import { loadTheater } from './theater/load'
import type { TheaterData } from './theater/grid'
import type { AidLevel, PeaceKind } from './politics/types'
import type { RecruitOrder } from './economy/armyRecruit'
import type { ArmyRecruitResult } from './economy/economy'

/** Temps de calcul maximal par image, en ms (le reste des ticks dus est abandonné). */
const STEP_BUDGET_MS = 60
const FRAME_MS = 50
/** Les cellules modifiées ne sont publiées qu'au plus 4 fois par seconde. */
const GRID_MIN_INTERVAL_MS = 250

let sim: Simulation | null = null
let listener: ((snapshot: SimSnapshot) => void) | null = null
let last = performance.now()
let lastGridAt = 0
const theaters = new Map<string, Promise<TheaterData>>()

/** Fichiers binaires servis à côté du jeu (grille mondiale). */
async function fetchBinary(path: string): Promise<ArrayBuffer> {
  const res = await fetch(`${import.meta.env.BASE_URL}${path}`)
  if (!res.ok) throw new Error(`Chargement impossible : ${path} (${res.status})`)
  return res.arrayBuffer()
}

function theater(id: 'ukraine' | 'world'): Promise<TheaterData> {
  let t = theaters.get(id)
  if (!t) {
    t = loadTheater(id, fetchBinary)
    theaters.set(id, t)
  }
  return t
}

function publish(forceGrid = false): void {
  if (!listener || !sim) return
  const now = performance.now()
  const allowGrid = forceGrid || now - lastGridAt >= GRID_MIN_INTERVAL_MS
  const snapshot = sim.snapshot(forceGrid, allowGrid)
  if (snapshot.grid || snapshot.gridPatch) lastGridAt = now
  // La grille complète (≈ 10 Mo) est transférée sans copie.
  const transfer = snapshot.grid
    ? [snapshot.grid.owner.buffer, snapshot.grid.terrain.buffer, snapshot.grid.roads.buffer]
    : []
  listener(Comlink.transfer(snapshot, transfer))
}

// Boucle temps réel : le Worker convertit le temps écoulé en ticks, puis publie l'état.
setInterval(() => {
  const now = performance.now()
  if (!sim) {
    last = now
    return
  }
  const ticks = sim.clock.advance(now - last)
  last = now
  if (ticks > 0) {
    // Budget de calcul par image : si la partie est trop lourde pour la vitesse demandée (grande
    // guerre sur la carte du monde en vitesse 5), on joue moins de ticks au lieu de bloquer le Worker
    // plusieurs secondes ; les ordres du joueur restent traités sans attente.
    const started = performance.now()
    for (let done = 0; done < ticks && !sim.outcome; done++) {
      sim.step(1)
      if (performance.now() - started > STEP_BUDGET_MS) break
    }
    publish()
  }
}, FRAME_MS)

/** Applique une action du joueur puis republie l'état. */
function act<T>(fn: (s: Simulation) => T): T | undefined {
  if (!sim) return undefined
  const result = fn(sim)
  publish()
  return result
}

const api = {
  scenarios() {
    return SCENARIOS
  },
  /** Pays jouables d'un scénario, du plus peuplé au moins peuplé. */
  playableCountries(scenarioId: string): Array<{ code: CountryId; name: string; pop: number }> {
    const info = SCENARIOS.find((s) => s.id === scenarioId)
    if (!info) return []
    const all = buildScenario(scenarioId).countries
    return all
      .filter((c) => !c.offMap && (!info.playable || info.playable.includes(c.id)))
      .map((c) => ({ code: c.id, name: c.name, pop: c.pop ?? 0 }))
      .sort((a, b) => b.pop - a.pop)
  },
  subscribe(callback: (snapshot: SimSnapshot) => void): void {
    listener = callback
    publish(true)
  },
  async newGame(scenarioId: string, country: CountryId, options?: ScenarioOptions): Promise<void> {
    const info = SCENARIOS.find((s) => s.id === scenarioId)
    if (!info) throw new Error(`Scénario inconnu : ${scenarioId}`)
    const data = await theater(info.theater)
    sim = Simulation.fromScenario(
      buildScenario(scenarioId, country, options),
      data,
      Date.now() & 0x7fffffff,
      country,
    )
    last = performance.now()
    publish(true)
  },
  /** Abandonne la partie en cours (retour au menu) : plus rien n'est publié. */
  quit(): void {
    sim = null
  },
  setPaused(paused: boolean): void {
    if (!sim) return
    sim.setPaused(paused)
    last = performance.now()
    publish()
  },
  setSpeed(speed: number): void {
    if (!isSpeed(speed)) throw new Error(`Vitesse invalide : ${speed}`)
    act((s) => s.setSpeed(speed))
  },
  /** Mode tour par tour : joue un nombre fixe d'heures. */
  step(ticks: number): void {
    act((s) => s.step(Math.max(0, Math.floor(ticks))))
  },
  orderUnits(ids: number[], kind: PlayerOrder, target?: LonLat): void {
    act((s) => s.orderUnits(ids, kind, target))
  },
  battleReport(ids: number[]): BattleReport | null {
    return sim?.battleReport(ids) ?? null
  },
  supplyView(): SupplyView | null {
    return sim?.supplyView() ?? null
  },
  setPosture(ids: number[], posture: Posture): void {
    act((s) => s.setPosture(ids, posture))
  },
  setArmyPosture(armyId: number, posture: Posture): void {
    act((s) => s.setArmyPosture(armyId, posture))
  },
  cancelOrders(ids: number[]): void {
    act((s) => s.cancelOrders(ids))
  },
  pursueUnit(ids: number[], targetId: number): string | null {
    return act((s) => s.pursueUnit(ids, targetId)) ?? null
  },
  assaultUnit(ids: number[], targetId: number): string | null {
    return act((s) => s.assaultUnit(ids, targetId)) ?? null
  },
  encircle(ids: number[], targetId: number): string | null {
    return act((s) => s.encircle(ids, targetId)) ?? null
  },
  encircleWithArmy(armyId: number, targetId: number): string | null {
    return act((s) => s.encircleWithArmy(armyId, targetId)) ?? null
  },
  endEncirclement(armyId: number): void {
    act((s) => s.endEncirclement(armyId))
  },
  holdArmy(armyId: number): void {
    act((s) => s.holdArmy(armyId))
  },
  lineMissionArmy(armyId: number, kind: LineMissionKind): string | null {
    return act((s) => s.lineMissionArmy(armyId, kind)) ?? null
  },
  missionPreview(armyId: number, kind: LineMissionKind): MissionPreview | null {
    return sim?.missionPreview(armyId, kind) ?? null
  },
  advanceArmy(armyId: number, goal: AdvanceGoal): string | null {
    return act((s) => s.advanceArmy(armyId, goal)) ?? null
  },
  retreatArmy(armyId: number, goal: AdvanceGoal): string | null {
    return act((s) => s.retreatArmy(armyId, goal)) ?? null
  },
  breachArmy(armyId: number, target: LonLat): string | null {
    return act((s) => s.breachArmy(armyId, target)) ?? null
  },
  advanceUnits(ids: number[], goal: AdvanceGoal): string | null {
    return act((s) => s.advanceUnits(ids, goal)) ?? null
  },
  createArmy(name: string, ids: number[]): number | undefined {
    return act((s) => s.createArmy(name, ids))
  },
  disbandArmy(id: number): void {
    act((s) => s.disbandArmy(id))
  },
  setArmyFront(id: number, front: [LonLat, LonLat] | 'whole' | null): void {
    act((s) => s.setArmyFront(id, front))
  },
  planOffensive(id: number, from: LonLat, to: LonLat, unitIds?: number[]): void {
    act((s) => s.planOffensive(id, from, to, unitIds))
  },
  launchOffensive(id: number): void {
    act((s) => s.launchOffensive(id))
  },
  cancelOffensive(id: number): void {
    act((s) => s.cancelOffensive(id))
  },
  addUnitsToArmy(armyId: number, ids: number[]): void {
    act((s) => s.addUnitsToArmy(armyId, ids))
  },
  queueConstruction(city: string, kind: BuildingKind): string | null {
    return act((s) => s.queueConstruction(city, kind)) ?? null
  },
  cancelConstruction(id: number): void {
    act((s) => s.cancelConstruction(id))
  },
  queueRecruit(kind: UnitKind, city: string, armyId: number | null): string | null {
    return act((s) => s.queueRecruit(kind, city, armyId)) ?? null
  },
  queueArmyRecruit(armyId: number, order: RecruitOrder): ArmyRecruitResult {
    return act((s) => s.queueArmyRecruit(armyId, order)) ?? { launched: 0, error: 'Aucune partie' }
  },
  cancelRecruit(id: number): void {
    act((s) => s.cancelRecruit(id))
  },
  setAutoEconomy(on: boolean): void {
    act((s) => s.setAutoEconomy(on))
  },
  setWarEconomy(level: WarEconomyLevel): void {
    act((s) => s.setWarEconomy(level))
  },
  // Diplomatie : chaque commande renvoie un message d'erreur, ou null.
  declareWar(target: CountryId): string | null {
    return act((s) => s.declareWar(target)) ?? null
  },
  proposePeace(warId: number, kind: PeaceKind): string | null {
    return act((s) => s.proposePeace(warId, kind)) ?? null
  },
  answerPeaceOffer(id: number, accept: boolean): void {
    act((s) => s.answerPeaceOffer(id, accept))
  },
  improveRelations(target: CountryId): string | null {
    return act((s) => s.improveRelations(target)) ?? null
  },
  toggleSanction(target: CountryId): void {
    act((s) => s.toggleSanction(target))
  },
  proposeAlliance(target: CountryId): string | null {
    return act((s) => s.proposeAlliance(target)) ?? null
  },
  leaveAlliance(id?: string): void {
    act((s) => s.leaveAlliance(id))
  },
  callAllies(): string {
    return act((s) => s.callAllies()) ?? ''
  },
  askToJoin(ally: CountryId): string {
    return act((s) => s.askToJoin(ally)) ?? ''
  },
  askPassage(country: CountryId): string {
    return act((s) => s.askPassage(country)) ?? ''
  },
  renouncePassage(country: CountryId): string | null {
    return act((s) => s.renouncePassage(country)) ?? null
  },
  requestAid(donor: CountryId): string | null {
    return act((s) => s.requestAid(donor)) ?? null
  },
  grantAid(recipient: CountryId, level: AidLevel): string | null {
    return act((s) => s.grantAid(recipient, level)) ?? null
  },
  setAidLevel(id: number, level: AidLevel): void {
    act((s) => s.setAidLevel(id, level))
  },
  revokeAid(id: number): void {
    act((s) => s.revokeAid(id))
  },
  answerAidRequest(id: number, accept: boolean, level: AidLevel): string | null {
    return act((s) => s.answerAidRequest(id, accept, level)) ?? null
  },
  mobilize(): string | null {
    return act((s) => s.mobilizePlayer()) ?? null
  },
  save(): string {
    if (!sim) throw new Error('Aucune partie en cours')
    return serializeSave(sim.toSave())
  },
  async load(text: string): Promise<void> {
    const save = parseSave(text)
    const info = SCENARIOS.find((s) => s.id === save.scenarioId)
    if (!info) throw new Error(`Scénario inconnu : ${save.scenarioId}`)
    const data = await theater(info.theater)
    sim = Simulation.fromSave(
      save,
      buildScenario(save.scenarioId, save.playerCountry, save.options),
      data,
    )
    last = performance.now()
    publish(true)
  },
}

export type SimApi = typeof api

Comlink.expose(api)
