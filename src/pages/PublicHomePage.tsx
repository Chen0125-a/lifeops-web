import { lazy, Suspense, useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { PublicOrbitFallback } from '../components/public/PublicOrbitFallback'
import {
  clearPublicReturnState,
  readPublicReturnState,
  type PublicReturnState,
} from '../components/public/publicReturnState'
import {
  initialLoginSceneState,
  loginSceneReducer,
  type LoginScenePhase,
} from '../motion/loginScene'
import { gsap, useGSAP } from '../motion/publicGsap'
import { preloadPrivateEntryModules } from '../privateEntryModules'
import { type LifeOpsTheme, useLifeOpsTheme } from '../theme/theme'

const LOGIN_HISTORY_STATE = 'lifeops-login-task'
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const PUBLIC_TITLE = '把日子，慢慢看清。'
const PUBLIC_TITLE_LINES = [['把', '日', '子', '，'], ['慢', '慢', '看', '清', '。']] as const
const PublicOrbit = lazy(() => import('../components/public/PublicOrbit').then((module) => ({ default: module.PublicOrbit })))
const LoginWindow = lazy(() => import('../components/auth/LoginWindow').then((module) => ({ default: module.LoginWindow })))
const EntryTransition = lazy(() => import('../components/auth/EntryTransition').then((module) => ({ default: module.EntryTransition })))

function readReducedMotionPreference() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

function useReducedMotionPreference() {
  const [reducedMotion, setReducedMotion] = useState(readReducedMotionPreference)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(REDUCED_MOTION_QUERY)
    const handleChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches)
    setReducedMotion(media.matches)
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  return reducedMotion
}

function PublicHeroCopy({ hidden = false, paintTheme }: { hidden?: boolean; paintTheme: LifeOpsTheme }) {
  const copyRef = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotionPreference()
  const playedRef = useRef(false)
  const [titleState, setTitleState] = useState<'typing' | 'complete'>(() => (
    readReducedMotionPreference() ? 'complete' : 'typing'
  ))
  const playCountRef = useRef(readReducedMotionPreference() ? 0 : 1)

  useGSAP(() => {
    const root = copyRef.current
    if (!root) return
    const characters = root.querySelectorAll<HTMLElement>('[data-testid="public-title-character"]')
    const supporting = root.querySelectorAll<HTMLElement>('[data-title-support]')
    const cursor = root.querySelector<HTMLElement>('[data-testid="public-title-cursor"]')

    if (reducedMotion || playedRef.current) {
      if (reducedMotion) playedRef.current = true
      gsap.set([...characters, ...supporting], { clearProps: 'all' })
      if (cursor) gsap.set(cursor, { autoAlpha: 0 })
      setTitleState('complete')
      return
    }

    gsap.set(characters, { autoAlpha: 0, filter: 'blur(3px)', y: '0.34em' })
    gsap.set(supporting, { autoAlpha: 0, filter: 'blur(2px)', y: 12 })
    if (cursor) gsap.set(cursor, { autoAlpha: 1, scaleY: 0.58, transformOrigin: '50% 100%' })

    let wallClockTimer: number | undefined
    const finishTitle = () => {
      if (wallClockTimer !== undefined) window.clearTimeout(wallClockTimer)
      playedRef.current = true
      setTitleState('complete')
    }
    const timeline = gsap.timeline({ onComplete: finishTitle })
    timeline.to(characters, {
      autoAlpha: 1,
      duration: 0.36,
      ease: 'power3.out',
      filter: 'blur(0px)',
      stagger: 0.085,
      y: 0,
    }, 0)
    if (cursor) timeline.to(cursor, { duration: 0.28, ease: 'power2.out', scaleY: 1 }, 0)
    timeline.to(supporting, {
      autoAlpha: 1,
      duration: 0.42,
      ease: 'power3.out',
      filter: 'blur(0px)',
      stagger: 0.11,
      y: 0,
    }, 0.92)
    if (cursor) timeline.to(cursor, { autoAlpha: 0, duration: 0.24, ease: 'power2.out' }, 1.24)

    wallClockTimer = window.setTimeout(() => {
      timeline.progress(1)
      finishTitle()
    }, 1_800)

    return () => {
      if (wallClockTimer !== undefined) window.clearTimeout(wallClockTimer)
      timeline.kill()
    }
  }, { dependencies: [reducedMotion], revertOnUpdate: true, scope: copyRef })

  return (
    <div
      aria-hidden={hidden || undefined}
      className="public-hero__copy"
      data-layout-share="36"
      data-public-surface-theme={paintTheme}
      data-testid="public-copy"
      ref={copyRef}
    >
      <p className="public-hero__signal" data-title-support><span aria-hidden="true" />生活正在继续</p>
      <h1
        aria-label={PUBLIC_TITLE}
        data-title-play-count={playCountRef.current}
        data-title-state={titleState}
        id="hero-title"
      >
        <span aria-hidden="true" className="public-title__visual">
          {PUBLIC_TITLE_LINES.map((line, lineIndex) => (
            <span className="public-title__line" key={`title-line-${lineIndex}`}>
              {line.map((character, characterIndex) => (
                <span
                  aria-hidden="true"
                  className="public-title__character"
                  data-testid="public-title-character"
                  key={`${lineIndex}-${characterIndex}`}
                >
                  {character}
                </span>
              ))}
              {lineIndex === PUBLIC_TITLE_LINES.length - 1 && !reducedMotion ? (
                <span aria-hidden="true" className="public-title__cursor" data-testid="public-title-cursor" />
              ) : null}
            </span>
          ))}
        </span>
      </h1>
      <p className="public-hero__lead" data-title-support>
        计划、行动、记录与回看，在同一条时间线上彼此照见。
        这里保存真实发生的生活，也只公开经过选择的部分。
      </p>
      <p className="public-hero__guide" data-title-support>
        选择右侧的五个生活对象，进入各自的公开切片。
      </p>
    </div>
  )
}

function withoutLoginHistoryState(state: unknown) {
  if (!state || typeof state !== 'object') return state
  const { [LOGIN_HISTORY_STATE]: _loginTask, ...rest } = state as Record<string, unknown>
  return rest
}

export function PublicHomePage() {
  const location = useLocation()
  const routeReturnState = (location.state as { publicReturn?: PublicReturnState } | null)?.publicReturn
  const [publicReturnState] = useState(() => routeReturnState ?? readPublicReturnState())
  const { theme, toggleTheme, setTheme } = useLifeOpsTheme()
  const navigate = useNavigate()
  const [loginScene, dispatchLoginScene] = useReducer(
    loginSceneReducer,
    initialLoginSceneState,
  )
  const [privateReady, setPrivateReady] = useState(false)
  const [orbitEnhancementReady, setOrbitEnhancementReady] = useState(false)
  const [motionPaused, setMotionPaused] = useState(false)
  const [themeAssetReady, setThemeAssetReady] = useState(false)
  const [entryOrigin, setEntryOrigin] = useState<{ x: number; y: number; size: number }>()
  const homeRef = useRef<HTMLElement>(null)
  const loginTriggerRef = useRef<HTMLButtonElement>(null)
  const starFieldRef = useRef<HTMLImageElement>(null)
  const loginHistoryArmedRef = useRef(false)
  const prepaintFramesRef = useRef<number[]>([])
  const loginVisible = loginScene.phase === 'opening'
    || loginScene.phase === 'open'
    || loginScene.phase === 'authenticating'
  const sceneState = loginScene.phase === 'entering'
    ? 'entering'
    : loginVisible
      ? 'login'
      : 'rest'

  useEffect(() => {
    if (!publicReturnState) return
    setTheme(publicReturnState.theme)
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: publicReturnState.homeScrollY, left: 0, behavior: 'auto' })
      document.getElementById(publicReturnState.sourceFocusId)?.focus({ preventScroll: true })
      clearPublicReturnState()
      navigate('/', { replace: true, state: null })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [navigate, publicReturnState, setTheme])

  const restoreLoginTriggerFocus = useCallback(() => {
    window.requestAnimationFrame(() => loginTriggerRef.current?.focus())
  }, [])

  const openLogin = useCallback(() => {
    void preloadPrivateEntryModules().catch(() => undefined)
    if (!loginHistoryArmedRef.current) {
      window.history.pushState(
        { ...(window.history.state ?? {}), [LOGIN_HISTORY_STATE]: true },
        '',
        window.location.href,
      )
      loginHistoryArmedRef.current = true
    }
    dispatchLoginScene({ type: 'OPEN' })
  }, [])
  const closeLogin = useCallback(() => {
    dispatchLoginScene({ type: 'CLOSE' })
    restoreLoginTriggerFocus()
    if (loginHistoryArmedRef.current && window.history.state?.[LOGIN_HISTORY_STATE]) {
      loginHistoryArmedRef.current = false
      window.history.back()
    }
  }, [restoreLoginTriggerFocus])

  const handleLoginSceneStateChange = useCallback((phase: Extract<LoginScenePhase, 'open' | 'authenticating' | 'entering'>) => {
    if (phase === 'open') {
      dispatchLoginScene({ type: 'OPENED' })
      dispatchLoginScene({ type: 'AUTH_FAILED' })
    } else if (phase === 'authenticating') {
      dispatchLoginScene({ type: 'SUBMIT' })
    } else {
      dispatchLoginScene({ type: 'AUTH_SUCCEEDED' })
    }
  }, [])

  const handleAuthenticated = useCallback(() => {
    const aperture = homeRef.current?.querySelector<HTMLElement>('[data-daylight-aperture]')
    if (aperture) {
      const bounds = aperture.getBoundingClientRect()
      setEntryOrigin({
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
        size: Math.max(bounds.width, bounds.height),
      })
    }

    const reducedMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const markPrivateReady = () => {
      if (reducedMotion) {
        setPrivateReady(true)
        return
      }
      const firstFrame = window.requestAnimationFrame(() => {
        const secondFrame = window.requestAnimationFrame(() => setPrivateReady(true))
        prepaintFramesRef.current.push(secondFrame)
      })
      prepaintFramesRef.current.push(firstFrame)
    }
    void preloadPrivateEntryModules().then(markPrivateReady, markPrivateReady)
  }, [])

  const handleSceneRestored = useCallback(() => {
    dispatchLoginScene({ type: 'CLOSED' })
  }, [])

  const completeEntry = useCallback(() => {
    if (loginHistoryArmedRef.current && window.history.state?.[LOGIN_HISTORY_STATE]) {
      window.history.replaceState(
        withoutLoginHistoryState(window.history.state),
        '',
        window.location.href,
      )
      loginHistoryArmedRef.current = false
    }
    navigate('/app/overview', {
      state: {
        portalEntry: true,
        publicTheme: theme,
        reducedEntryPrepaint: loginScene.reducedMotion,
      },
    })
  }, [loginScene.reducedMotion, navigate, theme])

  useEffect(() => {
    const handlePopState = () => {
      if (!loginHistoryArmedRef.current) return
      loginHistoryArmedRef.current = false
      dispatchLoginScene({ type: 'CLOSE' })
      restoreLoginTriggerFocus()
    }

    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      if (window.history.state?.[LOGIN_HISTORY_STATE]) {
        window.history.replaceState(
          withoutLoginHistoryState(window.history.state),
          '',
          window.location.href,
        )
      }
    }
  }, [restoreLoginTriggerFocus])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updatePreference = (matches: boolean) => {
      dispatchLoginScene({ type: 'SET_REDUCED_MOTION', reducedMotion: matches })
    }
    const handleChange = (event: MediaQueryListEvent) => updatePreference(event.matches)

    updatePreference(media.matches)
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => () => {
    for (const frame of prepaintFramesRef.current) window.cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    const starField = starFieldRef.current
    if (!starField) {
      setThemeAssetReady(true)
      return
    }

    let active = true
    const finish = () => {
      if (active) setThemeAssetReady(true)
    }

    if (typeof starField.decode === 'function') {
      void starField.decode().then(finish, finish)
    } else {
      finish()
    }

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
      cancelIdleCallback?: (handle: number) => void
    }
    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(() => setOrbitEnhancementReady(true), { timeout: 600 })
      return () => idleWindow.cancelIdleCallback?.(handle)
    }
    const timer = window.setTimeout(() => setOrbitEnhancementReady(true), 64)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <main
      className="public-home"
      data-login-phase={loginScene.phase}
      data-public-scene={sceneState}
      data-public-theme={theme}
      ref={homeRef}
    >
      <div aria-hidden="true" className="public-sky" data-public-surface-theme={theme}>
        <div className="public-sky__stars">
          <img alt="" aria-hidden="true" className="public-sky__field" data-star-field data-star-layers="far middle near" decoding="async" ref={starFieldRef} src="/public-stars-raster.png" />
        </div>
      </div>

      <header className="public-header" data-public-surface-theme={theme}>
        <Link aria-label="LifeOps 首页" className="wordmark" to="/">LifeOps</Link>
        <div className="public-header__actions">
          <button
            aria-label={motionPaused ? '继续星盘动画' : '暂停星盘动画'}
            aria-pressed={motionPaused}
            className="motion-switch"
            onClick={() => setMotionPaused((current) => !current)}
            type="button"
          >
            <span aria-hidden="true" className="motion-switch__mark">
              {motionPaused ? '▶' : 'Ⅱ'}
            </span>
          </button>
          <button
            aria-label={`切换为${theme === 'day' ? '夜间' : '日间'}主题`}
            className="theme-switch"
            disabled={!themeAssetReady}
            onClick={toggleTheme}
            type="button"
          >
            <span aria-hidden="true" className="theme-switch__mark" />
          </button>
          <button
            aria-controls="login-window"
            aria-expanded={loginVisible}
            aria-label="登录 LifeOps"
            className="login-trigger"
            onClick={openLogin}
            ref={loginTriggerRef}
            type="button"
          >
            <span>登录</span>
            <span aria-hidden="true">↗</span>
          </button>
        </div>
      </header>

      <section aria-labelledby="hero-title" className="public-hero">
        <PublicHeroCopy hidden={loginScene.phase !== 'closed'} paintTheme={theme} />

        <div
          className="public-hero__stage"
          data-layout-share="64"
          data-public-surface-theme={theme}
          data-testid="public-scene"
        >
          {orbitEnhancementReady ? (
            <Suspense fallback={(
              <PublicOrbitFallback
                initialPlayheads={publicReturnState?.objectPlayheads}
                onSceneRestored={handleSceneRestored}
                paused={motionPaused}
                restoreFocusId={publicReturnState?.sourceFocusId}
                sceneState={sceneState}
                theme={theme}
              />
            )}>
              <PublicOrbit
                initialPlayheads={publicReturnState?.objectPlayheads}
                onSceneRestored={handleSceneRestored}
                paused={motionPaused}
                restoreFocusId={publicReturnState?.sourceFocusId}
                sceneState={sceneState}
              />
            </Suspense>
          ) : (
            <PublicOrbitFallback
              initialPlayheads={publicReturnState?.objectPlayheads}
              onSceneRestored={handleSceneRestored}
              paused={motionPaused}
              restoreFocusId={publicReturnState?.sourceFocusId}
              sceneState={sceneState}
              theme={theme}
            />
          )}
        </div>
      </section>

      {loginScene.phase !== 'closed' ? (
        <Suspense fallback={null}>
          <LoginWindow
            onAuthenticated={handleAuthenticated}
            onClose={closeLogin}
            onSceneStateChange={handleLoginSceneStateChange}
            open={loginVisible}
          />
        </Suspense>
      ) : null}
      {loginScene.phase !== 'closed' ? (
        <Suspense fallback={null}>
          <EntryTransition
            active={loginScene.phase === 'entering'}
            onComplete={completeEntry}
            origin={entryOrigin}
            privateReady={privateReady}
            theme={theme}
          />
        </Suspense>
      ) : null}
    </main>
  )
}
