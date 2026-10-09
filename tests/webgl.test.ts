import { describe, expect, it } from 'vitest'
import { glErrorText } from '@/map/webgl'

describe('erreur WebGL', () => {
  it('garde le message du navigateur transmis par MapLibre', () => {
    const e = new Error(
      JSON.stringify({
        requestedAttributes: {},
        statusMessage: 'WebGL creation failed: FEATURE_FAILURE_EGL_NO_CONFIG',
        message: 'Failed to initialize WebGL',
      }),
    )
    expect(glErrorText(e)).toBe('WebGL creation failed: FEATURE_FAILURE_EGL_NO_CONFIG')
  })

  it('sans détail du navigateur, garde le message de MapLibre', () => {
    expect(glErrorText(new Error(JSON.stringify({ message: 'Failed to initialize WebGL' })))).toBe(
      'Failed to initialize WebGL',
    )
    expect(glErrorText(new Error('Failed to initialize WebGL'))).toBe('Failed to initialize WebGL')
    expect(glErrorText('null')).toBe('null')
  })
})
