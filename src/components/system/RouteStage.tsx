import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react'
import { forwardRef, type FocusEvent as ReactFocusEvent, type ReactNode, type UIEvent as ReactUIEvent, useEffect, useRef } from 'react'

const routeVariants = {
  enter: (direction: 'forward' | 'back') => ({ opacity: 0.001, x: direction === 'back' ? -18 : 18 }),
  center: { opacity: 1, x: 0 },
  exit: (direction: 'forward' | 'back') => ({ opacity: 0.001, x: direction === 'back' ? 18 : -18 }),
}

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

const RoutePanel = forwardRef<HTMLDivElement, {
  children: ReactNode
  direction: 'forward' | 'back'
  reducedMotion: boolean | null
  routeKey: string
}>(function RoutePanel({ children, direction, reducedMotion, routeKey }, ref) {
  const isPresent = useIsPresent()
  return (
    <motion.div
      ref={ref}
      className="route-stage__panel"
      data-route-key={routeKey}
      data-route-panel-current={isPresent ? true : undefined}
      aria-hidden={isPresent ? undefined : true}
      inert={isPresent ? undefined : true}
      custom={direction}
      variants={routeVariants}
      initial={reducedMotion ? false : 'enter'}
      animate="center"
      exit={reducedMotion ? undefined : 'exit'}
      transition={{ duration: reducedMotion ? 0.001 : 0.24, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
})

export function RouteStage({ children, routeKey, navigationKey = routeKey, direction }: { routeKey: string; navigationKey?: string; direction: 'forward' | 'back'; children: ReactNode }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const focusByRoute = useRef(new Map<string, RouteFocusDescriptor>())
  const previousRouteKey = useRef<string | null>(null)
  const scrollByNavigation = useRef(new Map<string, Map<string, number>>())
  const reducedMotion = useReducedMotion()

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
      <AnimatePresence initial={false} mode="popLayout" custom={direction}>
        <RoutePanel
          key={routeKey}
          routeKey={routeKey}
          direction={direction}
          reducedMotion={reducedMotion}
        >
          {children}
        </RoutePanel>
      </AnimatePresence>
    </div>
  )
}
