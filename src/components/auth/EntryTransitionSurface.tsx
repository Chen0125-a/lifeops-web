import type { CSSProperties } from 'react'
import type { LifeOpsTheme } from '../../theme/theme'

export interface EntryOrigin {
  x: number
  y: number
  size: number
}

interface EntryTransitionSurfaceProps {
  privateReady: boolean
  reduced: boolean
  theme: LifeOpsTheme
  origin?: EntryOrigin
}

export function EntryTransitionSurface({
  privateReady,
  reduced,
  theme,
  origin,
}: EntryTransitionSurfaceProps) {
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
