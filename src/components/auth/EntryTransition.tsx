import { useEffect, useRef } from 'react'
import type { LifeOpsTheme } from '../../theme/theme'
import { EntryTransitionSurface, type EntryOrigin } from './EntryTransitionSurface'

export type { EntryOrigin } from './EntryTransitionSurface'

interface EntryTransitionProps {
  active: boolean
  privateReady?: boolean
  theme: LifeOpsTheme
  origin?: EntryOrigin
  onComplete: () => void
}

export function EntryTransition({
  active,
  privateReady = true,
  theme,
  origin,
  onComplete,
}: EntryTransitionProps) {
  const fired = useRef(false)
  const reduced = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    if (!active) { fired.current = false; return }
    if (!privateReady) return
    if (fired.current) return
    fired.current = true
    if (reduced) {
      let cancelled = false
      queueMicrotask(() => {
        if (!cancelled) onComplete()
      })
      return () => { cancelled = true }
    }
    const timer = window.setTimeout(onComplete, 680)
    return () => window.clearTimeout(timer)
  }, [active, onComplete, privateReady, reduced])
  if (!active) return null

  return (
    <EntryTransitionSurface
      origin={origin}
      privateReady={privateReady}
      reduced={reduced}
      theme={theme}
    />
  )
}
