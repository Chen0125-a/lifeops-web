export type LoginScenePhase =
  | 'closed'
  | 'opening'
  | 'open'
  | 'authenticating'
  | 'entering'
  | 'closing'

export interface LoginSceneState {
  phase: LoginScenePhase
  reducedMotion: boolean
}

export type LoginSceneEvent =
  | { type: 'OPEN' }
  | { type: 'OPENED' }
  | { type: 'CLOSE' }
  | { type: 'CLOSED' }
  | { type: 'SUBMIT' }
  | { type: 'AUTH_FAILED' }
  | { type: 'AUTH_SUCCEEDED' }
  | { type: 'ENTRY_COMPLETED' }
  | { type: 'SET_REDUCED_MOTION'; reducedMotion: boolean }

export const initialLoginSceneState: LoginSceneState = {
  phase: 'closed',
  reducedMotion: false,
}

/** Loadable TDD seam. P2-T3 behavior is intentionally absent until the RED is observed. */
export function loginSceneReducer(
  state: LoginSceneState,
  event: LoginSceneEvent,
): LoginSceneState {
  if (event.type === 'SET_REDUCED_MOTION') {
    if (event.reducedMotion === state.reducedMotion) return state
    return { ...state, reducedMotion: event.reducedMotion }
  }

  switch (state.phase) {
    case 'closed':
      return event.type === 'OPEN' ? { ...state, phase: 'opening' } : state
    case 'opening':
      if (event.type === 'OPENED') return { ...state, phase: 'open' }
      if (event.type === 'CLOSE') return { ...state, phase: 'closing' }
      return state
    case 'open':
      if (event.type === 'SUBMIT') return { ...state, phase: 'authenticating' }
      if (event.type === 'CLOSE') return { ...state, phase: 'closing' }
      return state
    case 'authenticating':
      if (event.type === 'AUTH_FAILED') return { ...state, phase: 'open' }
      if (event.type === 'AUTH_SUCCEEDED') return { ...state, phase: 'entering' }
      if (event.type === 'CLOSE') return { ...state, phase: 'closing' }
      return state
    case 'entering':
      return event.type === 'ENTRY_COMPLETED' ? { ...state, phase: 'closed' } : state
    case 'closing':
      if (event.type === 'OPEN') return { ...state, phase: 'opening' }
      if (event.type === 'CLOSED') return { ...state, phase: 'closed' }
      return state
  }
}
