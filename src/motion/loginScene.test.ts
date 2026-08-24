import { describe, expect, it } from 'vitest'
import {
  initialLoginSceneState,
  loginSceneReducer,
  type LoginSceneState,
} from './loginScene'

describe('loginSceneReducer', () => {
  it('opens through an explicit reversible phase instead of a boolean jump', () => {
    const opening = loginSceneReducer(initialLoginSceneState, { type: 'OPEN' })
    expect(opening.phase).toBe('opening')
    expect(loginSceneReducer(opening, { type: 'OPENED' }).phase).toBe('open')
  })

  it('reverses an interrupted opening and can reopen while closing', () => {
    const opening: LoginSceneState = { phase: 'opening', reducedMotion: false }
    const closing = loginSceneReducer(opening, { type: 'CLOSE' })
    expect(closing.phase).toBe('closing')
    expect(loginSceneReducer(closing, { type: 'OPEN' }).phase).toBe('opening')
  })

  it('rejects duplicate submits and returns failed authentication to the open task layer', () => {
    const authenticating = loginSceneReducer(
      { phase: 'open', reducedMotion: false },
      { type: 'SUBMIT' },
    )
    expect(authenticating.phase).toBe('authenticating')
    expect(loginSceneReducer(authenticating, { type: 'SUBMIT' })).toBe(authenticating)
    expect(loginSceneReducer(authenticating, { type: 'AUTH_FAILED' }).phase).toBe('open')
  })

  it('enters only from an authenticating success and closes only after entry completion', () => {
    const open: LoginSceneState = { phase: 'open', reducedMotion: false }
    expect(loginSceneReducer(open, { type: 'AUTH_SUCCEEDED' })).toBe(open)

    const entering = loginSceneReducer(
      { phase: 'authenticating', reducedMotion: false },
      { type: 'AUTH_SUCCEEDED' },
    )
    expect(entering.phase).toBe('entering')
    expect(loginSceneReducer(entering, { type: 'ENTRY_COMPLETED' }).phase).toBe('closed')
  })

  it('preserves the reduced-motion preference across every semantic transition', () => {
    const reduced = loginSceneReducer(initialLoginSceneState, {
      type: 'SET_REDUCED_MOTION',
      reducedMotion: true,
    })
    expect(reduced).toEqual({ phase: 'closed', reducedMotion: true })
    expect(loginSceneReducer(reduced, { type: 'OPEN' }).reducedMotion).toBe(true)
  })
})
