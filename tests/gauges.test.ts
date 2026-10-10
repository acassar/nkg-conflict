import { describe, expect, it } from 'vitest'
import {
  daysLeft,
  gaugeViews,
  pushSample,
  trendPerDay,
  TREND_DAYS,
  type ResourceSample,
} from '@/composables/gauges'
import { MUNITIONS_CAP } from '@/sim/economy/rules'
import type { EconomyState } from '@/sim/core/types'

const sample = (day: number, production: number, munitions = 1000, manpower = 50) => ({
  day,
  production,
  munitions,
  manpower,
})

function economy(over: Partial<EconomyState> = {}): EconomyState {
  return {
    country: 'UKR',
    production: 500,
    munitions: 1000,
    manpower: 40,
    construction: [],
    recruitment: [],
    unitCounters: {} as EconomyState['unitCounters'],
    warEconomy: 0,
    daily: {
      construction: 60,
      production: 40,
      munitions: 30,
      munitionsUsed: 0,
      manpower: 2,
      reinforcements: 0,
      productionUsed: 35,
      munitionsSpent: 20,
    },
    ...over,
  }
}

describe('jauges de la barre du haut', () => {
  it('garde un relevé par jour, sur la fenêtre de la tendance', () => {
    let list: ResourceSample[] = []
    for (let d = 0; d < 20; d++) {
      list = pushSample(list, sample(d, d * 10))
      list = pushSample(list, sample(d, d * 10 + 5)) // même jour : remplacé
    }
    expect(list).toHaveLength(TREND_DAYS + 1)
    expect(list.at(-1)?.production).toBe(195)
    // Retour en arrière (chargement d'une sauvegarde) : on repart de zéro.
    expect(pushSample(list, sample(3, 0))).toHaveLength(1)
  })

  it('tendance par jour et jours avant épuisement', () => {
    const list = [sample(10, 700), sample(14, 500)]
    expect(trendPerDay(list, 'production')).toBe(-50)
    expect(trendPerDay([sample(10, 700)], 'production')).toBeNull()
    expect(daysLeft(500, -50)).toBe(10)
    expect(daysLeft(500, 5)).toBeNull()
    expect(daysLeft(500, null)).toBeNull()
  })

  it('quatre jauges, couleur selon l’épuisement', () => {
    const history = [sample(0, 1500, 1000, 50), sample(5, 500, 1000, 50)]
    const views = gaugeViews({ eco: economy(), sustain: null, history, freeBarracks: 0 })
    expect(views.map((v) => v.id)).toEqual(['industry', 'munitions', 'manpower', 'army'])
    const industry = views[0]!
    expect(industry.trend).toBe('−200/j')
    expect(industry.level).toBe('critical') // 500 / 200 = 2,5 jours
    expect(industry.advice.some((a) => a.includes('2 jours') || a.includes('3 jours'))).toBe(true)
    expect(views[1]!.level).toBe('ok')
    expect(views[3]!.level).toBe('unknown')
  })

  it('conseils : casernes libres, stock qui dort, plafond de munitions proche', () => {
    const eco = economy({
      production: 2000,
      munitions: MUNITIONS_CAP,
      daily: { ...economy().daily, productionUsed: 5 },
    })
    const views = gaugeViews({ eco, sustain: null, history: [], freeBarracks: 2 })
    const industry = views.find((v) => v.id === 'industry')!
    expect(industry.advice[0]).toMatch(/^2 casernes libres/)
    expect(industry.advice.some((a) => a.includes('qui dort'))).toBe(true)
    const mun = views.find((v) => v.id === 'munitions')!
    expect(mun.level).toBe('warning')
    expect(mun.advice.some((a) => a.includes('Plafond'))).toBe(true)
  })

  it('stocks bas en rouge', () => {
    const views = gaugeViews({
      eco: economy({ munitions: 50, manpower: 2 }),
      sustain: null,
      history: [],
      freeBarracks: 0,
    })
    expect(views.find((v) => v.id === 'munitions')!.level).toBe('critical')
    expect(views.find((v) => v.id === 'manpower')!.level).toBe('critical')
  })
})
