import { describe, expect, it } from 'vitest'
import { newPlayerWars } from '@/stores/warBrief'

describe('encart de guerre', () => {
  it("signale une seule fois chaque nouvelle guerre du joueur, avec l'adversaire principal", () => {
    const known = new Set([1])
    const wars = [
      { id: 1, attackers: ['RUS'], defenders: ['UKR'] },
      { id: 2, attackers: ['CHN'], defenders: ['MNG', 'RUS'] },
      { id: 3, attackers: ['IND'], defenders: ['PAK'] },
    ]
    expect(newPlayerWars(wars, known, 'CHN')).toEqual([{ warId: 2, enemy: 'MNG' }])
    // Déjà relevées : plus rien à signaler.
    expect(newPlayerWars(wars, known, 'CHN')).toEqual([])
    // Guerre déclarée contre le joueur : l'adversaire est l'attaquant.
    const later = [...wars, { id: 4, attackers: ['KOR'], defenders: ['CHN'] }]
    expect(newPlayerWars(later, known, 'CHN')).toEqual([{ warId: 4, enemy: 'KOR' }])
  })
})
