import { useReducedMotion } from 'motion/react'
import { type FocusEvent as ReactFocusEvent, type ReactNode, type UIEvent as ReactUIEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const ROUTE_TRANSITION_DURATION = 240
const ROUTE_TRANSITION_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

interface RouteFocusDescriptor {
  tagName: string
  id: string
  href: string
  ariaLabel: string
  name: string
  text: string
}

function describeFocus(element: HTMLElement): RouteFocusDescriptor {
  return {
    tagName: element.tagName.toLowerCase(),
    id: element.id,
    href: element.getAttribute('href') ?? '',
    ariaLabel: element.getAttribute('aria-label') ?? '',
    name: element.getAttribute('name') ?? '',
    text: element.textContent?.trim() ?? '',
  }
}

function findRememberedFocus(panel: HTMLElement, descriptor: RouteFocusDescriptor) {
  return Array.from(panel.querySelectorAll<HTMLElement>(descriptor.tagName)).find((element) => (
    (!descriptor.id || element.id === descriptor.id)
      && (!descriptor.href || element.getAttribute('href') === descriptor.href)
      && (!descriptor.ariaLabel || element.getAttribute('aria-label') === descriptor.ariaLabel)
      && (!descriptor.name || element.getAttribute('name') === descriptor.name)
      && (!descriptor.text || element.textContent?.trim() === descriptor.text)
  ))
}

function isVerticalScrollOwner(element: HTMLElement) {
  const overflowY = getComputedStyle(element).overflowY
  return ['auto', 'scroll', 'overlay'].includes(overflowY)
    && element.scrollHeight > element.clientHeight + 2
}

function describeScrollOwner(panel: HTMLElement, element: HTMLElement) {
  const identity = element.id
    ? `#${element.id}`
    : `${element.tagName.toLowerCase()}.${[...element.classList].join('.')}`
  const peers = [...panel.querySelectorAll<HTMLElement>('*')]
    .filter((candidate) => candidate.id
      ? `#${candidate.id}` === identity
      : `${candidate.tagName.toLowerCase()}.${[...candidate.classList].join('.')}` === identity)
  return `${identity}:${Math.max(0, peers.indexOf(element))}`
}

function scrollOwners(panel: HTMLElement) {
  return [...panel.querySelectorAll<HTMLElement>('*')].filter(isVerticalScrollOwner)
}

interface RoutePanelSnapshot {
  children: ReactNode
  enterDirection: 'forward' | 'back'
  id: number
  routeKey: string
}

type OutgoingRoutePanel = RoutePanelSnapshot

function NativeRoutePanel({
  children,
  enterDirection,
  id,
  onExited,
  phase,
  reducedMotion,
  routeKey,
}: {
  children: ReactNode
  enterDirection: 'forward' | 'back'
  id: number
  onExited: (id: number) => void
  phase: 'current' | 'outgoing'
  reducedMotion: boolean | null
  routeKey: string
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const enterAnimationRef = useRef<Animation | null>(null)
  const initialDirection = useRef(enterDirection).current
  const initialReducedMotion = useRef(Boolean(reducedMotion)).current
  const deferContent = id > 0
  const nativeAnimationAvailable = typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.animate === 'function'
  const [contentReady, setContentReady] = useState(() => !deferContent || initialReducedMotion || !nativeAnimationAvailable)

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    if (!deferContent || initialReducedMotion || typeof panel.animate !== 'function') {
      panel.style.opacity = '1'
      panel.style.transform = 'none'
      setContentReady(true)
      return
    }
    const animation = panel.animate([
      { opacity: 0.001, transform: `translateX(${initialDirection === 'back' ? -18 : 18}px)` },
      { opacity: 1, transform: 'translateX(0px)' },
    ], {
      duration: ROUTE_TRANSITION_DURATION,
      easing: ROUTE_TRANSITION_EASING,
      fill: 'both',
    })
    enterAnimationRef.current = animation
    let active = true
    void animation.finished.then(() => {
      if (!active || enterAnimationRef.current !== animation) return
      panel.style.opacity = '1'
      panel.style.transform = 'none'
      setContentReady(true)
      animation.cancel()
      enterAnimationRef.current = null
    }).catch(() => undefined)
    return () => {
      active = false
      animation.cancel()
      if (enterAnimationRef.current === animation) enterAnimationRef.current = null
    }
  }, [deferContent, initialDirection, initialReducedMotion])

  useLayoutEffect(() => {
    if (phase !== 'outgoing') return
    const panel = panelRef.current
    if (!panel) return
    const from = getComputedStyle(panel)
    const fromTransform = from.transform
    panel.style.opacity = from.opacity
    panel.style.transform = fromTransform
    enterAnimationRef.current?.cancel()
    enterAnimationRef.current = null
    const timer = window.setTimeout(() => onExited(id), reducedMotion ? 0 : ROUTE_TRANSITION_DURATION)
    return () => window.clearTimeout(timer)
  }, [id, onExited, phase, reducedMotion])

  const isCurrent = phase === 'current'
  return (
    <div
      ref={panelRef}
      className="route-stage__panel"
      data-route-key={routeKey}
      data-route-motion-owner="native-waapi"
      data-route-panel-current={isCurrent ? true : undefined}
      data-route-panel-phase={phase}
      aria-hidden={isCurrent ? undefined : true}
      inert={isCurrent ? undefined : true}
      style={isCurrent ? undefined : { inset: 0, pointerEvents: 'none', position: 'absolute', width: '100%' }}
    >
      {contentReady ? children : (
        <div aria-live="polite" className="route-gate" data-deferred-private-route={routeKey}>
          正在打开工作区…
        </div>
      )}
    </div>
  )
}

export function RouteStage({ children, routeKey, navigationKey = routeKey, direction }: { routeKey: string; navigationKey?: string; direction: 'forward' | 'back'; children: ReactNode }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const focusByRoute = useRef(new Map<string, RouteFocusDescriptor>())
  const previousRouteKey = useRef<string | null>(null)
  const scrollByNavigation = useRef(new Map<string, Map<string, number>>())
  const reducedMotion = useReducedMotion()
  const nextPanelId = useRef(1)
  const currentPanel = useRef<RoutePanelSnapshot>({ children, enterDirection: direction, id: 0, routeKey })
  const [panelState, setPanelState] = useState<{ currentId: number; outgoing: OutgoingRoutePanel[]; routeKey: string }>(() => ({
    currentId: 0,
    outgoing: [],
    routeKey,
  }))

  if (panelState.routeKey !== routeKey) {
    const nextId = nextPanelId.current
    nextPanelId.current += 1
    const outgoing = currentPanel.current
    currentPanel.current = { children, enterDirection: direction, id: nextId, routeKey }
    setPanelState({
      currentId: nextId,
      outgoing: [...panelState.outgoing, outgoing],
      routeKey,
    })
  } else {
    currentPanel.current = { ...currentPanel.current, children }
  }

  const removeOutgoingPanel = useCallback((id: number) => {
    setPanelState((current) => ({
      ...current,
      outgoing: current.outgoing.filter((panel) => panel.id !== id),
    }))
  }, [])

  useEffect(() => {
    if (direction !== 'back') return
    const saved = scrollByNavigation.current.get(navigationKey)
    if (!saved?.size) return
    const deadline = performance.now() + 2_000
    let frame = 0
    let stableFrames = 0
    const restore = () => {
      const panels = stageRef.current?.querySelectorAll<HTMLElement>('[data-route-panel-current]')
      const panel = panels?.item((panels.length ?? 1) - 1)
      if (!panel) return
      const available = new Map(scrollOwners(panel).map((element) => [describeScrollOwner(panel, element), element]))
      let allRestored = true
      saved.forEach((offset, signature) => {
        const element = available.get(signature)
        if (!element) {
          allRestored = false
          return
        }
        element.scrollTop = offset
        if (Math.abs(element.scrollTop - offset) > 2) allRestored = false
      })
      stableFrames = allRestored ? stableFrames + 1 : 0
      if (stableFrames < 4 && performance.now() < deadline) frame = requestAnimationFrame(restore)
    }
    frame = requestAnimationFrame(restore)
    return () => cancelAnimationFrame(frame)
  }, [direction, navigationKey, routeKey])

  useEffect(() => {
    let observer: MutationObserver | undefined
    const routeChanged = previousRouteKey.current !== null && previousRouteKey.current !== routeKey
    previousRouteKey.current = routeKey
    const focusCurrentPanel = () => {
      const activeNow = document.activeElement as HTMLElement | null
      const stage = stageRef.current
      if (
        activeNow
        && activeNow !== document.body
        && (activeNow.closest('[data-route-panel-current]') || (!routeChanged && !stage?.contains(activeNow)))
      ) return true
      const panels = stageRef.current?.querySelectorAll<HTMLElement>('[data-route-panel-current]')
      const panel = panels?.item((panels.length ?? 1) - 1)
      const remembered = direction === 'back' ? focusByRoute.current.get(routeKey) : undefined
      const target = panel && remembered ? findRememberedFocus(panel, remembered) : undefined
      const focusTarget = target ?? panel?.querySelector<HTMLElement>('h1[tabindex="-1"]')
      if (!focusTarget) return false
      focusTarget.focus({ preventScroll: true })
      return true
    }
    const frame = requestAnimationFrame(() => {
      if (focusCurrentPanel() || !stageRef.current) return
      observer = new MutationObserver(() => {
        if (focusCurrentPanel()) observer?.disconnect()
      })
      observer.observe(stageRef.current, { childList: true, subtree: true })
    })
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
    }
  }, [direction, routeKey])

  const rememberFocus = (event: ReactFocusEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement) || !event.target.closest('[data-route-panel-current]')) return
    focusByRoute.current.set(routeKey, describeFocus(event.target))
  }

  const rememberScroll = (event: ReactUIEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement)) return
    const panel = event.target.closest<HTMLElement>('[data-route-panel-current]')
    if (!panel || !stageRef.current?.contains(panel) || !isVerticalScrollOwner(event.target)) return
    const saved = scrollByNavigation.current.get(navigationKey) ?? new Map<string, number>()
    const signature = describeScrollOwner(panel, event.target)
    saved.set(signature, event.target.scrollTop)
    scrollByNavigation.current.set(navigationKey, saved)
  }

  return (
    <div ref={stageRef} className="route-stage" data-route-stage data-route-direction={direction} onFocusCapture={rememberFocus} onScrollCapture={rememberScroll}>
      {panelState.outgoing.map((panel) => (
        <NativeRoutePanel
          key={panel.id}
          {...panel}
          onExited={removeOutgoingPanel}
          phase="outgoing"
          reducedMotion={reducedMotion}
        />
      ))}
      <NativeRoutePanel
        key={panelState.currentId}
        {...currentPanel.current}
        onExited={removeOutgoingPanel}
        phase="current"
        reducedMotion={reducedMotion}
      />
    </div>
  )
}
