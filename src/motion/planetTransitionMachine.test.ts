import { describe, expect, it } from 'vitest'
import {
  createPlanetTransitionState,
  reducePlanetTransition,
} from './planetTransitionMachine'

describe('planet route transition state', () => {
  it('enters a selected planet and preserves its origin', () => {
    const orbit = createPlanetTransitionState()
    const entering = reducePlanetTransition(orbit, {
      type: 'SELECT',
      slug: 'kubernetes',
      originScrollY: 320,
    })
    const planet = reducePlanetTransition(entering, { type: 'ENTER_COMPLETE' })

    expect(entering).toMatchObject({ phase: 'entering', selectedSlug: 'kubernetes', originScrollY: 320 })
    expect(planet.phase).toBe('planet')
  })

  it('can reverse an unfinished entry without waiting for it', () => {
    const entering = reducePlanetTransition(createPlanetTransitionState(), {
      type: 'SELECT', slug: 'git', originScrollY: 0,
    })
    const exiting = reducePlanetTransition(entering, { type: 'EXIT' })
    const orbit = reducePlanetTransition(exiting, { type: 'EXIT_COMPLETE' })

    expect(exiting.phase).toBe('exiting')
    expect(orbit).toEqual(createPlanetTransitionState())
  })

  it('settles a deep link directly on the planet', () => {
    expect(createPlanetTransitionState({ deepLinkSlug: 'mysql' })).toMatchObject({
      phase: 'planet',
      selectedSlug: 'mysql',
      originScrollY: undefined,
    })
  })
})
