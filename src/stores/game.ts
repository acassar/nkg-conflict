import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'
import * as Comlink from 'comlink'
import { formatGameDate, isSpeed, tickToDate } from '@/sim/core/clock'
import type { SimSnapshot } from '@/sim/core/types'
import type { SimApi } from '@/sim/worker'

/** Pont entre l'interface et le Worker de simulation. L'interface ne fait que lire l'état publié. */
export const useGameStore = defineStore('game', () => {
  const worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' })
  const sim = Comlink.wrap<SimApi>(worker)

  // shallowRef : chaque snapshot remplace le précédent, inutile de rendre ses objets réactifs.
  const snapshot = shallowRef<SimSnapshot | null>(null)

  void sim.subscribe(
    Comlink.proxy((next: SimSnapshot) => {
      snapshot.value = next
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
    await sim.load(await file.text())
  }

  return {
    snapshot,
    paused,
    speed,
    dateLabel,
    playerCountry,
    togglePause,
    setSpeed,
    step,
    saveToFile,
    loadFromFile,
  }
})
