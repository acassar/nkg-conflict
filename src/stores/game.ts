import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import * as Comlink from 'comlink'
import { formatGameDate, isSpeed, tickToDate } from '@/sim/core/clock'
import type { GridSnapshot, LonLat, SimSnapshot, UnitSnapshot } from '@/sim/core/types'
import type { PlayerOrder } from '@/sim/simulation'
import type { SimApi } from '@/sim/worker'

/**
 * Mode d'interaction de la carte : un clic sur la carte sert soit à sélectionner,
 * soit à désigner un point pour un ordre en attente.
 */
export type MapMode =
  | { kind: 'select' }
  | { kind: 'order'; order: Exclude<PlayerOrder, 'hold'> }
  | { kind: 'front'; armyId: number; first: LonLat | null }
  | { kind: 'offensive'; armyId: number; first: LonLat | null }

const ORDER_LABELS: Record<Exclude<PlayerOrder, 'hold'>, string> = {
  move: 'Déplacer',
  attack: 'Attaquer',
  retreat: 'Se replier',
}

/** Pont entre l'interface et le Worker de simulation. L'interface ne fait que lire l'état publié. */
export const useGameStore = defineStore('game', () => {
  const worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' })
  const sim = Comlink.wrap<SimApi>(worker)

  // shallowRef : chaque snapshot remplace le précédent, inutile de rendre ses objets réactifs.
  const snapshot = shallowRef<SimSnapshot | null>(null)
  const grid = shallowRef<GridSnapshot | null>(null)
  const selection = ref<number[]>([])
  const selectedArmyId = ref<number | null>(null)
  const mode = ref<MapMode>({ kind: 'select' })

  void sim.subscribe(
    Comlink.proxy((next: SimSnapshot) => {
      snapshot.value = next
      if (next.grid) grid.value = next.grid
      // On retire de la sélection les unités disparues.
      const alive = new Set(next.units.map((u) => u.id))
      if (selection.value.some((id) => !alive.has(id))) {
        selection.value = selection.value.filter((id) => alive.has(id))
      }
      if (
        selectedArmyId.value !== null &&
        !next.armies.some((a) => a.id === selectedArmyId.value)
      ) {
        selectedArmyId.value = null
      }
    }),
  )

  const paused = computed(() => snapshot.value?.paused ?? true)
  const speed = computed(() => snapshot.value?.speed ?? 1)
  const dateLabel = computed(() => {
    const s = snapshot.value
    return s ? formatGameDate(tickToDate(s.startDate, s.tick)) : '—'
  })
  const playerCountry = computed(() => {
    const s = snapshot.value
    return s?.countries.find((c) => c.id === s.playerCountry) ?? null
  })
  const selectedUnits = computed<UnitSnapshot[]>(() => {
    const s = snapshot.value
    if (!s) return []
    const ids = new Set(selection.value)
    return s.units.filter((u) => ids.has(u.id))
  })
  const armies = computed(() => snapshot.value?.armies ?? [])
  const selectedArmy = computed(
    () => armies.value.find((a) => a.id === selectedArmyId.value) ?? null,
  )
  const modeHint = computed(() => {
    const m = mode.value
    if (m.kind === 'order')
      return `${ORDER_LABELS[m.order]} : cliquez sur la carte (Échap pour annuler)`
    if (m.kind === 'front') {
      return m.first
        ? 'Portion de front : cliquez sur la seconde extrémité'
        : 'Portion de front : cliquez sur la première extrémité'
    }
    if (m.kind === 'offensive') {
      return m.first
        ? "Offensive : cliquez sur l'objectif"
        : 'Offensive : cliquez sur le point de départ'
    }
    return null
  })

  // Les valeurs réactives de Vue sont des Proxy que postMessage ne sait pas copier :
  // tout ce qui part vers le Worker est d'abord recopié en tableaux simples.
  const ids = (): number[] => [...selection.value]
  const lonLat = (p: LonLat): LonLat => [p[0], p[1]]

  // ---------- Sélection ----------

  function selectUnit(id: number, additive: boolean): void {
    const u = snapshot.value?.units.find((x) => x.id === id)
    if (!u || u.owner !== snapshot.value?.playerCountry) return
    if (!additive) selection.value = [id]
    else if (selection.value.includes(id)) selection.value = selection.value.filter((x) => x !== id)
    else selection.value = [...selection.value, id]
  }

  /** Sélectionne plusieurs unités à la fois (pile de pions) ; seules celles du joueur sont retenues. */
  function selectUnits(ids: number[], additive: boolean): void {
    const s = snapshot.value
    if (!s) return
    const mine = s.units.filter((u) => ids.includes(u.id) && u.owner === s.playerCountry)
    const picked = mine.map((u) => u.id)
    selection.value = additive ? [...new Set([...selection.value, ...picked])] : picked
  }

  function clearSelection(): void {
    selection.value = []
  }

  function selectArmy(id: number | null): void {
    selectedArmyId.value = id
    const army = armies.value.find((a) => a.id === id)
    if (army) selection.value = [...army.unitIds]
  }

  // ---------- Clics sur la carte ----------

  function cancelMode(): void {
    mode.value = { kind: 'select' }
  }

  function startOrder(order: Exclude<PlayerOrder, 'hold'>): void {
    if (selection.value.length > 0) mode.value = { kind: 'order', order }
  }

  function startFront(armyId: number): void {
    mode.value = { kind: 'front', armyId, first: null }
  }

  function startOffensive(armyId: number): void {
    mode.value = { kind: 'offensive', armyId, first: null }
  }

  /** Clic sur la carte hors unité. Renvoie vrai si le clic a été consommé par un mode en cours. */
  function mapClick(point: LonLat): boolean {
    const m = mode.value
    if (m.kind === 'order') {
      void sim.orderUnits(ids(), m.order, point)
      cancelMode()
      return true
    }
    if (m.kind === 'front' || m.kind === 'offensive') {
      if (!m.first) {
        mode.value = { ...m, first: point }
        return true
      }
      if (m.kind === 'front') void sim.setArmyFront(m.armyId, [lonLat(m.first), point])
      else void sim.planOffensive(m.armyId, lonLat(m.first), point)
      cancelMode()
      return true
    }
    return false
  }

  /** Clic droit : déplacement direct de la sélection. */
  function quickMove(point: LonLat): void {
    if (selection.value.length > 0) void sim.orderUnits(ids(), 'move', point)
  }

  function hold(): void {
    if (selection.value.length > 0) void sim.orderUnits(ids(), 'hold')
  }

  // ---------- Armées ----------

  async function createArmyFromSelection(name: string): Promise<void> {
    if (selection.value.length === 0) return
    selectedArmyId.value = await sim.createArmy(name, ids())
  }

  const disbandArmy = (id: number): Promise<void> => sim.disbandArmy(id)
  const setWholeFront = (id: number): Promise<void> => sim.setArmyFront(id, 'whole')
  const clearFront = (id: number): Promise<void> => sim.setArmyFront(id, null)
  const launchOffensive = (id: number): Promise<void> => sim.launchOffensive(id)
  const cancelOffensive = (id: number): Promise<void> => sim.cancelOffensive(id)

  // ---------- Temps et fichiers ----------

  function togglePause(): Promise<void> {
    return sim.setPaused(!paused.value)
  }

  function setSpeed(value: number): Promise<void> {
    if (!isSpeed(value)) return Promise.resolve()
    return sim.setSpeed(value)
  }

  function step(ticks: number): Promise<void> {
    return sim.step(ticks)
  }

  function newGame(): Promise<void> {
    selection.value = []
    selectedArmyId.value = null
    cancelMode()
    return sim.newGame()
  }

  async function saveToFile(): Promise<void> {
    const text = await sim.save()
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `nkg-conflict-${snapshot.value?.tick ?? 0}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function loadFromFile(file: File): Promise<void> {
    selection.value = []
    selectedArmyId.value = null
    await sim.load(await file.text())
  }

  return {
    snapshot,
    grid,
    selection,
    selectedUnits,
    armies,
    selectedArmy,
    selectedArmyId,
    mode,
    modeHint,
    paused,
    speed,
    dateLabel,
    playerCountry,
    selectUnit,
    selectUnits,
    clearSelection,
    selectArmy,
    cancelMode,
    startOrder,
    startFront,
    startOffensive,
    mapClick,
    quickMove,
    hold,
    createArmyFromSelection,
    disbandArmy,
    setWholeFront,
    clearFront,
    launchOffensive,
    cancelOffensive,
    togglePause,
    setSpeed,
    step,
    newGame,
    saveToFile,
    loadFromFile,
  }
})
