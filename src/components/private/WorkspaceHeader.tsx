import { useLayoutEffect, useRef } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

export const workspaceRoutes = [
  { label: '总览', to: '/app/overview' },
  { label: '目标与项目', to: '/app/goals' },
  { label: '日程', to: '/app/schedule' },
  { label: '习惯', to: '/app/habits' },
  { label: '记录', to: '/app/records' },
  { label: '回顾', to: '/app/reviews' },
  { label: '知识', to: '/app/knowledge' },
  { label: '生活', to: '/app/life' },
  { label: '发布', to: '/app/publish' },
  { label: '平台', to: '/app/platform' },
] as const

interface WorkspaceHeaderProps {
  pathname?: string
  onSearch: () => void
  onCapture: () => void
  onAccount?: () => void
  onLogout?: () => void
  initial: string
}

export function WorkspaceHeader({ onSearch, onCapture, onAccount, onLogout, initial }: WorkspaceHeaderProps) {
  const location = useLocation()
  const navigationRef = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    const navigation = navigationRef.current
    const active = navigation?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!navigation || !active) return

    const revealActiveRoute = () => {
      navigation.scrollTo?.({
        behavior: 'auto',
        left: Math.max(0, active.offsetLeft - ((navigation.clientWidth - active.offsetWidth) / 2)),
      })
    }

    revealActiveRoute()
    window.addEventListener('resize', revealActiveRoute)
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(revealActiveRoute)
    resizeObserver?.observe(navigation)
    return () => {
      window.removeEventListener('resize', revealActiveRoute)
      resizeObserver?.disconnect()
    }
  }, [location.pathname])

  return (
    <header className="workspace-header">
      <NavLink className="workspace-wordmark" to="/app/overview">LifeOps</NavLink>
      <nav ref={navigationRef} aria-label="私人空间导航">
        {workspaceRoutes.map((route) => <NavLink key={route.to} to={route.to} end={route.to === '/app/overview'}>{route.label}</NavLink>)}
      </nav>
      <div className="workspace-actions">
        <button type="button" onClick={onSearch} aria-label="打开全局搜索">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
          <span>搜索</span><kbd>⌘ K</kbd>
        </button>
        <button className="workspace-capture-button" type="button" onClick={onCapture} aria-label="快速记录">
          <span>快速记录</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <button className="workspace-avatar" type="button" onClick={onAccount ?? onLogout} aria-label="打开账户与设置" title="账户与设置">{initial}</button>
      </div>
    </header>
  )
}
