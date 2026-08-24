export type PlanetTransitionPhase = 'orbit' | 'entering' | 'planet' | 'exiting'

export interface PlanetTransitionState {
  phase: PlanetTransitionPhase
  selectedSlug?: string
  originScrollY?: number
}

export type PlanetTransitionEvent =
  | { type: 'SELECT'; slug: string; originScrollY: number }
  | { type: 'ENTER_COMPLETE' }
  | { type: 'EXIT' }
  | { type: 'EXIT_COMPLETE' }

export function createPlanetTransitionState(options?: {
  deepLinkSlug?: string
}): PlanetTransitionState {
  return options?.deepLinkSlug
    ? { phase: 'planet', selectedSlug: options.deepLinkSlug, originScrollY: undefined }
    : { phase: 'orbit' }
}

export function reducePlanetTransition(
  state: PlanetTransitionState,
  event: PlanetTransitionEvent,
): PlanetTransitionState {
  switch (event.type) {
    case 'SELECT':
      return {
        phase: 'entering',
        selectedSlug: event.slug,
        originScrollY: event.originScrollY,
      }
    case 'ENTER_COMPLETE':
      return state.selectedSlug ? { ...state, phase: 'planet' } : state
    case 'EXIT':
      return state.selectedSlug ? { ...state, phase: 'exiting' } : state
    case 'EXIT_COMPLETE':
      return createPlanetTransitionState()
  }
}
