import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useNavigationType, useOutlet } from 'react-router-dom'
import { RouteStage } from '../system/RouteStage'
import { useAuth } from '../../state/AuthContext'
import { useLifeDataStatus, useLifeState } from '../../state/LifeDataContext'
import { queryClient } from '../../api/queryClient'
import { queryKeys } from '../../api/queryKeys'
import { CommandCenter } from './CommandCenter'
import { QuickCreate } from './QuickCreate'
import { deriveQuickCreateContext, type QuickCreateContextValue, type QuickCreateSelection } from './quickCreateContext'
import { WorkspaceHeader, workspaceRoutes } from './WorkspaceHeader'
import { AppMotionProvider } from '../system/AppMotionProvider'
import '../../styles/private.css'

function routeName(pathname: string) {
  return workspaceRoutes.find((route) => pathname === route.to || pathname.startsWith(`${route.to}/`))?.label ?? '私人空间'
}

function AccountMenu({ open, onClose, onLogout, displayName }: { open: boolean; onClose: () => void; onLogout: () => void; displayName: string }) {
  const settingsRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    if (!open) return
    settingsRef.current?.focus()
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose, open])

  if (!open) return null
  return (
    <div className="account-menu" role="dialog" aria-modal="true" aria-label="账户与设置">
      <button className="overlay-backdrop" type="button" onClick={onClose} tabIndex={-1} aria-label="关闭账户与设置" />
      <section>
        <header><strong>{displayName}</strong><span>私人日光工作台</span></header>
        <Link ref={settingsRef} to="/app/settings" onClick={onClose}>账户与设置</Link>
        <button type="button" onClick={onLogout}>退出 LifeOps</button>
      </section>
    </div>
  )
}

export function PrivateAppLayout() {
  const lifeState = useLifeState()
  const dataStatus = useLifeDataStatus()
  const auth = useAuth()
  const location = useLocation()
  const navigationType = useNavigationType()
  const navigate = useNavigate()
  const outlet = useOutlet()
  const [searchOpen, setSearchOpen] = useState(false)
  const [captureOpen, setCaptureOpen] = useState(false)
  const [captureContext, setCaptureContext] = useState<QuickCreateContextValue>({})
  const [accountOpen, setAccountOpen] = useState(false)
  const routeScrollPositionsRef = useRef(new Map<string, number>())
  const activeLocationKeyRef = useRef(location.key)
  const currentRouteName = routeName(location.pathname)

  useEffect(() => {
    const previousRestoration = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    const readScrollPosition = () => document.scrollingElement?.scrollTop ?? window.scrollY
    const rememberScrollPosition = () => {
      routeScrollPositionsRef.current.set(activeLocationKeyRef.current, readScrollPosition())
    }
    rememberScrollPosition()
    window.addEventListener('scroll', rememberScrollPosition, { passive: true })
    return () => {
      window.removeEventListener('scroll', rememberScrollPosition)
      window.history.scrollRestoration = previousRestoration
    }
  }, [])

  useLayoutEffect(() => {
    routeScrollPositionsRef.current.set(
      activeLocationKeyRef.current,
      document.scrollingElement?.scrollTop ?? window.scrollY,
    )
    activeLocationKeyRef.current = location.key
    if (navigationType !== 'POP') return
    const savedPosition = routeScrollPositionsRef.current.get(location.key)
    if (savedPosition === undefined) return

    const deadline = performance.now() + 2_000
    let frame = 0
    let stableFrames = 0
    const restoreScrollPosition = () => {
      const scrollingElement = document.scrollingElement
      if (!scrollingElement) return
      scrollingElement.scrollTop = savedPosition
      if (Math.abs(scrollingElement.scrollTop - savedPosition) <= 2) stableFrames += 1
      else stableFrames = 0
      if (stableFrames < 4 && performance.now() < deadline) {
        frame = requestAnimationFrame(restoreScrollPosition)
      }
    }
    restoreScrollPosition()
    return () => cancelAnimationFrame(frame)
  }, [location.key, navigationType])

  const openQuickCreate = useCallback(() => {
    const collectIds = (value: unknown): string[] => {
      if (Array.isArray(value)) return value.flatMap(collectIds)
      if (!value || typeof value !== 'object') return []
      const row = value as Record<string, unknown>
      return [typeof row.id === 'string' ? row.id : '', ...Object.values(row).flatMap(collectIds)].filter(Boolean)
    }
    const queryIds = (queryKey: readonly unknown[]) => [...new Set(queryClient.getQueriesData({ queryKey }).flatMap(([, data]) => collectIds(data)))]
    const selection: QuickCreateSelection = {
      goalIds: queryIds(queryKeys.goals.all),
      projectIds: queryIds(queryKeys.projects.all),
      habitIds: queryIds(queryKeys.habits.all),
      recordIds: [...new Set([...lifeState.records.map((item) => item.id), ...queryIds(queryKeys.records.all)])],
      knowledgeIds: [...new Set([...lifeState.knowledge.map((item) => item.id), ...queryIds(queryKeys.knowledge.all)])],
      recipeIds: queryIds(queryKeys.lifeRecipes.all),
      itemIds: queryIds(queryKeys.lifeCatalog.all),
      shoppingItemIds: queryIds(queryKeys.lifeCommerce.all),
      dayPlanItemIds: queryIds(queryKeys.lifePlanning.all),
    }
    setCaptureContext(deriveQuickCreateContext({ pathname: location.pathname, search: location.search }, selection))
    setCaptureOpen(true)
  }, [lifeState.knowledge, lifeState.records, location.pathname, location.search])

  const leave = async () => {
    await auth.logout()
    navigate('/', { replace: true })
  }
  const displayName = auth.user?.displayName || 'LifeOps'
  const direction = navigationType === 'POP' ? 'back' : 'forward'

  return (
    <AppMotionProvider><div
      className="private-workspace private-app-layout"
      data-private-shell
      data-workspace-theme="daylight"
      data-portal-entry={Boolean((location.state as { portalEntry?: boolean } | null)?.portalEntry)}
    >
      <WorkspaceHeader
        onSearch={() => setSearchOpen(true)}
        onCapture={openQuickCreate}
        onAccount={() => setAccountOpen(true)}
        initial={displayName.slice(0, 1).toUpperCase()}
      />
      <span className="sr-only" role="status" aria-label="页面位置" aria-live="polite">已进入 {currentRouteName}</span>
      {dataStatus.status === 'loading' ? <div className="workspace-data-state" role="status">正在同步你的 LifeOps</div> : null}
      {dataStatus.status === 'error' ? <div className="workspace-data-state is-error" role="alert">{dataStatus.error}</div> : null}
      <main className="workspace-route" data-workspace-route={location.pathname}>
        <RouteStage routeKey={location.pathname} navigationKey={location.key} direction={direction}>{outlet}</RouteStage>
      </main>
      <CommandCenter open={searchOpen} onOpen={() => setSearchOpen(true)} onClose={() => setSearchOpen(false)} />
      <QuickCreate open={captureOpen} context={captureContext} onOpen={openQuickCreate} onClose={() => setCaptureOpen(false)} onOpenResult={(route) => navigate(route)} />
      <AccountMenu open={accountOpen} displayName={displayName} onClose={() => setAccountOpen(false)} onLogout={() => void leave()} />
    </div></AppMotionProvider>
  )
}
