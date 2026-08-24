import { type CSSProperties, useEffect, useRef } from 'react'
import type { LifeOpsTheme } from '../../theme/theme'

export interface EntryOrigin {
  x: number
  y: number
  size: number
}

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
    const timer = window.setTimeout(onComplete, reduced ? 32 : 680)
    return () => window.clearTimeout(timer)
  }, [active, onComplete, privateReady, reduced])
  if (!active) return null

  const style = origin
    ? {
        '--entry-origin-x': `${origin.x}px`,
        '--entry-origin-y': `${origin.y}px`,
        '--entry-origin-size': `${origin.size}px`,
      } as CSSProperties
    : undefined

  return (
    <div
      aria-label="正在进入 LifeOps"
      className="entry-transition"
      data-entry-motion={reduced ? 'reduced' : 'full'}
      data-entry-ready={privateReady ? 'true' : 'false'}
      data-entry-surface="daylight-prepaint"
      data-entry-theme={theme}
      role="status"
      style={style}
    >
      <div
        aria-hidden="true"
        className="entry-transition__private-canvas"
        data-testid="private-daylight-prepaint"
        data-workspace-theme="daylight"
      >
        <i className="entry-transition__prepaint-bar" />
        <i className="entry-transition__prepaint-timeline" />
        <i className="entry-transition__prepaint-focus" />
      </div>
      <div aria-hidden="true" className="entry-transition__aperture" />
      <span>正在展开今天</span>
    </div>
  )
}
