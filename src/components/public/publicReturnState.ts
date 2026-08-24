import type { PublicDestinationSlug } from '../../content/publicDestinations'

export interface PublicReturnState {
  sourceObjectId: PublicDestinationSlug
  objectPlayheads: Record<PublicDestinationSlug, number>
  homeScrollY: number
  theme: 'day' | 'night'
  sourceFocusId: string
}

export const PUBLIC_RETURN_SESSION_KEY = 'lifeops:public-return:v1'

export function persistPublicReturnState(state: PublicReturnState) {
  sessionStorage.setItem(PUBLIC_RETURN_SESSION_KEY, JSON.stringify(state))
}

export function readPublicReturnState(): PublicReturnState | undefined {
  try {
    const raw = sessionStorage.getItem(PUBLIC_RETURN_SESSION_KEY)
    if (!raw) return undefined
    const value = JSON.parse(raw) as Partial<PublicReturnState>
    if (!value.objectPlayheads || !['now', 'doing', 'learning', 'moments', 'archive'].includes(value.sourceObjectId ?? '') || (value.theme !== 'day' && value.theme !== 'night') || typeof value.homeScrollY !== 'number' || typeof value.sourceFocusId !== 'string') {
      sessionStorage.removeItem(PUBLIC_RETURN_SESSION_KEY)
      return undefined
    }
    const playheads = value.objectPlayheads as Partial<Record<PublicDestinationSlug, unknown>>
    if (!['now', 'doing', 'learning', 'moments', 'archive'].every((slug) => typeof playheads[slug as PublicDestinationSlug] === 'number')) {
      sessionStorage.removeItem(PUBLIC_RETURN_SESSION_KEY)
      return undefined
    }
    return value as PublicReturnState
  } catch {
    sessionStorage.removeItem(PUBLIC_RETURN_SESSION_KEY)
    return undefined
  }
}

export function clearPublicReturnState() {
  sessionStorage.removeItem(PUBLIC_RETURN_SESSION_KEY)
}
