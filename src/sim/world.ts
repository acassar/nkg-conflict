import { addComponent, addEntity, createWorld, defineComponent, defineQuery, Types } from 'bitecs'
import type { IWorld } from 'bitecs'
import { TickAccumulator } from './core/loop'
import { isSpeed, type Speed } from './core/clock'
import type { SaveFile } from './core/save'
import type { CountryDef, ScenarioDef, SimSnapshot, UnitKind, UnitSnapshot } from './core/types'

/** Composants ECS. Les chaînes (pays, type) sont stockées par index dans des tables de correspondance. */
export const Position = defineComponent({ lon: Types.f64, lat: Types.f64 })
export const Unit = defineComponent({ kind: Types.ui8, owner: Types.ui16, strength: Types.f32 })

const UNIT_KINDS: readonly UnitKind[] = ['inf', 'mech', 'tank', 'art', 'log', 'hq']
const unitQuery = defineQuery([Position, Unit])

/** État complet de la simulation. Vit dans le Web Worker. */
export class Simulation {
  readonly world: IWorld = createWorld()
  readonly clock = new TickAccumulator()
  tick = 0
  private countries: CountryDef[] = []

  constructor(
    readonly startDate: string,
    readonly playerCountry: string,
  ) {}

  static fromScenario(scenario: ScenarioDef): Simulation {
    const sim = new Simulation(scenario.startDate, scenario.playerCountry)
    sim.countries = scenario.countries.map((c) => ({ ...c }))
    for (const u of scenario.units) sim.spawnUnit(u)
    return sim
  }

  static fromSave(save: SaveFile): Simulation {
    const sim = new Simulation(save.startDate, save.playerCountry)
    sim.tick = save.tick
    if (isSpeed(save.speed)) sim.setSpeed(save.speed)
    sim.countries = save.countries.map((c) => ({ ...c }))
    for (const u of save.units) sim.spawnUnit(u)
    return sim
  }

  spawnUnit(u: Omit<UnitSnapshot, 'id'>): number {
    const ownerIndex = this.countries.findIndex((c) => c.id === u.owner)
    if (ownerIndex < 0) throw new Error(`Pays inconnu : ${u.owner}`)
    const eid = addEntity(this.world)
    addComponent(this.world, Position, eid)
    addComponent(this.world, Unit, eid)
    Position.lon[eid] = u.lon
    Position.lat[eid] = u.lat
    Unit.kind[eid] = UNIT_KINDS.indexOf(u.kind)
    Unit.owner[eid] = ownerIndex
    Unit.strength[eid] = u.strength
    return eid
  }

  /** Joue `count` ticks. Les systèmes (mouvement, combat, front) s'ajouteront ici. */
  step(count: number): void {
    for (let i = 0; i < count; i++) {
      this.tick++
    }
  }

  setSpeed(speed: Speed): void {
    this.clock.setSpeed(speed)
  }

  setPaused(paused: boolean): void {
    this.clock.setPaused(paused)
  }

  snapshot(): SimSnapshot {
    const units: UnitSnapshot[] = unitQuery(this.world).map((eid) => ({
      id: eid,
      owner: this.countries[Unit.owner[eid] ?? 0]?.id ?? '?',
      kind: UNIT_KINDS[Unit.kind[eid] ?? 0] ?? 'inf',
      lon: Position.lon[eid] ?? 0,
      lat: Position.lat[eid] ?? 0,
      strength: Unit.strength[eid] ?? 0,
    }))
    return {
      tick: this.tick,
      startDate: this.startDate,
      paused: this.clock.paused,
      speed: this.clock.speed,
      playerCountry: this.playerCountry,
      countries: this.countries.map((c) => ({ ...c })),
      units,
    }
  }
}
