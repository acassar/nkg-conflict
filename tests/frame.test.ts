import { describe, expect, it } from 'vitest'
import { DOMAINS, inspectorView, mobileSheet } from '@/stores/frame'

const none = { units: 0, army: false, city: false, country: false }

describe('cadre : rail et inspecteur', () => {
  it('le rail a quatre domaines dans l’ordre des maquettes', () => {
    expect(DOMAINS.map((d) => d.id)).toEqual(['forces', 'production', 'country', 'log'])
  })

  it('l’inspecteur montre la dernière sélection tant qu’elle existe', () => {
    expect(inspectorView('units', { ...none, units: 3 })).toBe('units')
    expect(inspectorView('army', { ...none, units: 3, army: true })).toBe('army')
    expect(inspectorView('city', { ...none, city: true })).toBe('city')
    expect(inspectorView('country', { ...none, country: true })).toBe('country')
  })

  it('l’inspecteur se ferme quand la sélection a disparu', () => {
    expect(inspectorView('units', none)).toBeNull()
    expect(inspectorView('army', { ...none, units: 2 })).toBeNull()
    expect(inspectorView('city', { ...none, country: true })).toBeNull()
    expect(inspectorView(null, { units: 1, army: true, city: true, country: true })).toBeNull()
  })

  it('sur téléphone, le panneau montre l’inspecteur ou le tiroir du domaine', () => {
    expect(mobileSheet('inspector', 'units', 'production')).toEqual({
      kind: 'inspector',
      view: 'units',
    })
    expect(mobileSheet('domain', 'units', 'production')).toEqual({
      kind: 'domain',
      view: 'production',
    })
    // Inspecteur demandé mais vide : retour au domaine, Forces par défaut.
    expect(mobileSheet('inspector', null, null)).toEqual({ kind: 'domain', view: 'forces' })
  })
})
