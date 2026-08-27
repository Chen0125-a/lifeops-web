import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  publicDestinations,
  type PublicDestinationSlug,
} from '../../content/publicDestinations'
import { gsap, useGSAP } from '../../motion/publicGsap'
import { DaylightAperture } from './DaylightAperture'
import { OrbitGlyph } from './OrbitGlyph'
import {
  orbitCirclePath,
  orbitDefinitions,
  PUBLIC_ORBIT_STAGE,
} from './orbitGeometry'
import { persistPublicReturnState, type PublicReturnState } from './publicReturnState'

type PublicOrbitSceneState = 'rest' | 'login' | 'entering'

export interface PublicOrbitProps {
  sceneState?: PublicOrbitSceneState
  paused?: boolean
  onSceneRestored?: () => void
  initialPlayheads?: Partial<Record<PublicDestinationSlug, number>>
  restoreFocusId?: string
  theme?: 'day' | 'night'
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const ATTENTION_FOCUS = 1
const ATTENTION_POINTER = 2

function readReducedMotionPreference() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(REDUCED_MOTION_QUERY)?.matches ?? false
}

function readDocumentHidden() {
  return typeof document !== 'undefined' && document.hidden
}

function boundedPlayhead(value: number | undefined) {
  return Math.min(0.999999, Math.max(0, value ?? 0))
}

interface ContinuousAnimation {
  animation: Animation
  durationMs: number
}

function normalizedAnimationPlayhead({ animation, durationMs }: ContinuousAnimation) {
  const currentTime = Number(animation.currentTime ?? 0)
  if (!Number.isFinite(currentTime) || !Number.isFinite(durationMs) || durationMs <= 0) return 0
  const normalized = ((currentTime % durationMs) + durationMs) % durationMs / durationMs
  return Number(Math.min(0.999999, Math.max(0, normalized)).toFixed(6))
}

function suspendAnimation(animation: Animation) {
  const currentTime = animation.currentTime
  animation.pause()
  if (currentTime !== null) animation.currentTime = currentTime
}

function readCurrentTheme(root: HTMLElement | null, fallback: 'day' | 'night') {
  const publicHome = root?.closest<HTMLElement>('[data-public-theme]')
  return publicHome?.dataset.publicTheme === 'day' ? 'day' : publicHome ? 'night' : fallback
}

function PublicOrbitComponent({
  sceneState = 'rest',
  paused = false,
  onSceneRestored,
  initialPlayheads,
  restoreFocusId,
  theme: initialTheme = 'night',
}: PublicOrbitProps) {
  const navigate = useNavigate()
  const orbitRef = useRef<HTMLElement>(null)
  const ringAnimationsRef = useRef(new Map<string, ContinuousAnimation>())
  const objectAnimationsRef = useRef(new Map<PublicDestinationSlug, ContinuousAnimation>())
  const progressRef = useRef(new Map<PublicDestinationSlug, number>(
    publicDestinations.map((destination) => [
      destination.slug,
      boundedPlayhead(initialPlayheads?.[destination.slug] ?? destination.phase),
    ]),
  ))
  const arrivalTimelineRef = useRef<gsap.core.Timeline | null>(null)
  const previousSceneRef = useRef(sceneState)
  const [documentHidden, setDocumentHidden] = useState(readDocumentHidden)
  const [inViewport, setInViewport] = useState(true)
  const [reducedMotion, setReducedMotion] = useState(readReducedMotionPreference)
  const [layoutRevision, setLayoutRevision] = useState(0)
  const [centerCount, setCenterCount] = useState(
    reducedMotion || Boolean(initialPlayheads) ? 5 : 0,
  )
  const [attentionBySlug, setAttentionBySlug] = useState<
    Partial<Record<PublicDestinationSlug, number>>
  >({})

  const motionRate = sceneState === 'login' ? 1 / 3 : sceneState === 'entering' ? 2 / 3 : 1
  const motionSuspended = paused || documentHidden || !inViewport || reducedMotion

  useLayoutEffect(() => {
    if (!restoreFocusId) return
    document.getElementById(restoreFocusId)?.focus({ preventScroll: true })
  }, [restoreFocusId])

  const updateAttention = useCallback(
    (slug: PublicDestinationSlug, flag: number, active: boolean) => {
      setAttentionBySlug((current) => {
        const currentFlags = current[slug] ?? 0
        const nextFlags = active ? currentFlags | flag : currentFlags & ~flag
        return nextFlags === currentFlags ? current : { ...current, [slug]: nextFlags }
      })
    },
    [],
  )

  useEffect(() => {
    const handleVisibilityChange = () => setDocumentHidden(document.hidden)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(REDUCED_MOTION_QUERY)
    if (!media) return
    const handleChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches)
    setReducedMotion(media.matches)
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => {
    const orbit = orbitRef.current
    if (!orbit || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => setInViewport(entry?.isIntersecting ?? true),
      { rootMargin: '160px' },
    )
    observer.observe(orbit)
    return () => observer.disconnect()
  }, [])

  const snapshotProgress = useCallback(() => {
    objectAnimationsRef.current.forEach((animation, slug) => {
      progressRef.current.set(slug, normalizedAnimationPlayhead(animation))
    })
  }, [])

  const navigateToDestination = useCallback((event: ReactMouseEvent<HTMLAnchorElement>, slug: PublicDestinationSlug) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    snapshotProgress()
    const objectPlayheads = Object.fromEntries(publicDestinations.map((destination) => [
      destination.slug,
      progressRef.current.get(destination.slug) ?? 0,
    ])) as Record<PublicDestinationSlug, number>
    const returnState: PublicReturnState = {
      sourceObjectId: slug,
      objectPlayheads,
      homeScrollY: window.scrollY,
      theme: readCurrentTheme(orbitRef.current, initialTheme),
      sourceFocusId: `public-object-${slug}`,
    }
    persistPublicReturnState(returnState)
    navigate(`/${slug}`, { state: { publicReturn: returnState } })
  }, [initialTheme, navigate, snapshotProgress])

  useEffect(() => {
    const orbit = orbitRef.current
    if (!orbit) return
    let firstFrame = 0
    let secondFrame = 0
    const handleResize = () => {
      const stage = orbit.querySelector<HTMLElement>('[data-orbit-reference-stage]')
      stage?.setAttribute('data-layout-resizing', 'true')
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          stage?.removeAttribute('data-layout-resizing')
        })
      })
      snapshotProgress()
      setLayoutRevision((revision) => revision + 1)
    }
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(handleResize)
      observer.observe(orbit)
      return () => {
        observer.disconnect()
        window.cancelAnimationFrame(firstFrame)
        window.cancelAnimationFrame(secondFrame)
      }
    }
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
    }
  }, [snapshotProgress])

  useLayoutEffect(() => {
    const root = orbitRef.current
    ringAnimationsRef.current.clear()
    objectAnimationsRef.current.clear()
    if (!root || reducedMotion) return

    for (const orbit of orbitDefinitions) {
      const ring = root.querySelector<HTMLElement>(`[data-orbit-ring="${orbit.id}"]`)
      if (!ring || typeof ring.animate !== 'function') continue
      const ringDestinations = publicDestinations.filter((destination) => destination.orbitId === orbit.id)
      const direction = orbit.direction === 'cw' ? 360 : -360
      const durationMs = orbit.periodSeconds * 1000
      const ringAnimation = ring.animate([
        { transform: 'rotate(0deg)' },
        { transform: `rotate(${direction}deg)` },
      ], {
        duration: durationMs,
        easing: 'linear',
        iterations: Infinity,
      })
      const ringPlayhead = boundedPlayhead(
        progressRef.current.get(ringDestinations[0]?.slug) ?? ringDestinations[0]?.phase,
      )
      ringAnimation.currentTime = ringPlayhead * durationMs
      suspendAnimation(ringAnimation)
      ringAnimationsRef.current.set(orbit.id, { animation: ringAnimation, durationMs })

      for (const destination of ringDestinations) {
        const upright = root.querySelector<HTMLElement>(`[data-public-object="${destination.slug}"]`)
        if (!upright || typeof upright.animate !== 'function') continue
        const initialRotation = -destination.angleDegrees
        const uprightAnimation = upright.animate([
          { transform: `rotate(${initialRotation}deg)` },
          { transform: `rotate(${initialRotation - direction}deg)` },
        ], {
          duration: durationMs,
          easing: 'linear',
          iterations: Infinity,
        })
        const objectPlayhead = boundedPlayhead(
          progressRef.current.get(destination.slug) ?? destination.phase,
        )
        uprightAnimation.currentTime = objectPlayhead * durationMs
        suspendAnimation(uprightAnimation)
        objectAnimationsRef.current.set(destination.slug, {
          animation: uprightAnimation,
          durationMs,
        })
      }
    }

    return () => {
      snapshotProgress()
      for (const { animation } of ringAnimationsRef.current.values()) animation.cancel()
      for (const { animation } of objectAnimationsRef.current.values()) animation.cancel()
      ringAnimationsRef.current.clear()
      objectAnimationsRef.current.clear()
    }
  }, [reducedMotion, snapshotProgress])

  useGSAP(() => {
    const root = orbitRef.current
    if (!root) return
    const visual = root.querySelector<HTMLElement>('[data-orbit-visual]')
    const center = root.querySelector<HTMLElement>('[data-orbit-center]')
    if (!visual || !center) return

    if (reducedMotion || initialPlayheads) {
      gsap.set([visual, center], { clearProps: 'all', opacity: 1 })
      for (const destination of publicDestinations) {
        const orbit = orbitDefinitions.find((candidate) => candidate.id === destination.orbitId)
        const track = root.querySelector<HTMLElement>(`[data-object-track="${destination.slug}"]`)
        const pathCounter = root.querySelector<HTMLElement>(`[data-public-object="${destination.slug}"] [data-path-counter]`)
        const material = root.querySelector<HTMLElement>(`[data-public-object="${destination.slug}"] [data-object-material]`)
        const label = root.querySelector<HTMLElement>(`[data-public-object="${destination.slug}"] .public-object__label`)
        if (!orbit || !track || !pathCounter || !material || !label) continue
        track.style.setProperty('--arrival-angle', String(destination.angleDegrees))
        track.style.setProperty('--arrival-radius', String(orbit.baseDiameter * 0.5))
        gsap.set(track, { opacity: 1 })
        gsap.set(pathCounter, { clearProps: 'transform,opacity,visibility', opacity: 1 })
        gsap.set(material, {
          clearProps: 'transform,opacity,visibility,filter',
          filter: 'blur(0px)',
          opacity: 1,
        })
        gsap.set(label, { clearProps: 'opacity,visibility', opacity: 1 })
      }
      setCenterCount(5)
      return
    }

    setCenterCount(0)
    let wallClockTimer: number | undefined
    const count = { value: 0 }
    const finishArrival = () => {
      if (wallClockTimer !== undefined) window.clearTimeout(wallClockTimer)
      setCenterCount(5)
    }
    const timeline = gsap.timeline({ onComplete: finishArrival })
    timeline.fromTo(visual, { opacity: 0, scale: 0.85 }, {
      opacity: 1,
      duration: 1.2,
      ease: 'power3.out',
      scale: 1,
      transformOrigin: '50% 50%',
    }, 0.3)
    timeline.fromTo(center, { opacity: 0, yPercent: 6 }, {
      opacity: 1,
      duration: 0.9,
      ease: 'power3.out',
      yPercent: 0,
    }, 0.45)

    for (const destination of publicDestinations) {
      const orbit = orbitDefinitions.find((candidate) => candidate.id === destination.orbitId)
      const track = root.querySelector<HTMLElement>(`[data-object-track="${destination.slug}"]`)
      const pathCounter = root.querySelector<HTMLElement>(`[data-public-object="${destination.slug}"] [data-path-counter]`)
      const material = root.querySelector<HTMLElement>(`[data-public-object="${destination.slug}"] [data-object-material]`)
      const label = root.querySelector<HTMLElement>(`[data-public-object="${destination.slug}"] .public-object__label`)
      if (!orbit || !track || !pathCounter || !material || !label) continue
      const delay = destination.arrivalDelaySeconds
      timeline.fromTo(track, {
        '--arrival-angle': destination.angleDegrees - 180,
        '--arrival-radius': orbit.baseDiameter * 0.15,
      } as gsap.TweenVars, {
        '--arrival-angle': destination.angleDegrees,
        '--arrival-radius': orbit.baseDiameter * 0.5,
        duration: 0.72,
        ease: 'power3.out',
      } as gsap.TweenVars, delay)
      timeline.fromTo(pathCounter, { rotation: 180 }, {
        duration: 0.72,
        ease: 'power3.out',
        rotation: 0,
      }, delay)
      timeline.fromTo(material, { opacity: 0, filter: 'blur(10px)', rotation: -180, scale: 0.3 }, {
        opacity: 1,
        duration: 0.72,
        ease: 'power3.out',
        filter: 'blur(0px)',
        rotation: 0,
        scale: 1,
      }, delay)
      timeline.fromTo(label, { opacity: 0 }, {
        duration: 0.12,
        ease: 'power2.out',
        opacity: 1,
      }, delay + 0.6)
    }

    timeline.to(count, {
      duration: 2,
      ease: 'power3.out',
      onUpdate: () => setCenterCount(Math.min(5, Math.round(count.value))),
      value: 5,
    }, 1.2)
    wallClockTimer = window.setTimeout(() => {
      if (root.getAttribute('data-motion-suspended') === 'true') return
      timeline.progress(1)
      finishArrival()
    }, 3_400)
    arrivalTimelineRef.current = timeline
    return () => {
      if (wallClockTimer !== undefined) window.clearTimeout(wallClockTimer)
      if (arrivalTimelineRef.current === timeline) arrivalTimelineRef.current = null
      timeline.kill()
    }
  }, { dependencies: [reducedMotion], revertOnUpdate: true, scope: orbitRef })

  useEffect(() => {
    const hasAnyAttention = Object.values(attentionBySlug).some((flags) => (flags ?? 0) !== 0)
    for (const [orbitId, ring] of ringAnimationsRef.current) {
      const hasAttention = publicDestinations.some((destination) => (
        destination.orbitId === orbitId && (attentionBySlug[destination.slug] ?? 0) !== 0
      ))
      const animations = [
        ring,
        ...publicDestinations
          .filter((destination) => destination.orbitId === orbitId)
          .map((destination) => objectAnimationsRef.current.get(destination.slug))
          .filter((animation): animation is ContinuousAnimation => Boolean(animation)),
      ]
      for (const { animation } of animations) {
        animation.playbackRate = motionRate
        if (motionSuspended || hasAttention) suspendAnimation(animation)
        else animation.play()
      }
    }
    if (motionSuspended || hasAnyAttention) arrivalTimelineRef.current?.pause()
    else arrivalTimelineRef.current?.resume()
  }, [attentionBySlug, layoutRevision, motionRate, motionSuspended])

  useEffect(() => {
    if (!paused && sceneState === 'rest') return
    arrivalTimelineRef.current?.progress(1)
    setCenterCount(5)
  }, [paused, sceneState])

  useEffect(() => {
    const previous = previousSceneRef.current
    previousSceneRef.current = sceneState
    if (previous === 'rest' || sceneState !== 'rest') return
    const timer = window.setTimeout(() => onSceneRestored?.(), reducedMotion ? 0 : 700)
    return () => window.clearTimeout(timer)
  }, [onSceneRestored, reducedMotion, sceneState])

  useEffect(() => {
    const root = orbitRef.current
    if (!root) return
    if (sceneState === 'entering') {
      gsap.to(root, { autoAlpha: 0, duration: reducedMotion ? 0 : 0.68, ease: 'power3.in', scale: 0.96 })
    } else {
      gsap.to(root, { autoAlpha: 1, duration: reducedMotion ? 0 : 0.24, scale: 1 })
    }
  }, [reducedMotion, sceneState])

  return (
    <section
      aria-label="公开探索星盘"
      className="public-orbit"
      data-layout-revision={layoutRevision}
      data-motion-enhanced="true"
      data-motion-paused={paused ? 'true' : 'false'}
      data-motion-rate={motionRate}
      data-motion-suspended={motionSuspended ? 'true' : 'false'}
      data-public-motion-owner="public-orbit"
      data-public-orbit
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      data-scene-state={sceneState}
      ref={orbitRef}
    >
      <div
        className="public-orbit__reference-stage"
        data-orbit-reference-stage
        data-reference-height={PUBLIC_ORBIT_STAGE.height}
        data-reference-width={PUBLIC_ORBIT_STAGE.width}
      >
        <svg
          aria-hidden="true"
          className="public-orbit__geometry"
          focusable="false"
          viewBox={`0 0 ${PUBLIC_ORBIT_STAGE.width} ${PUBLIC_ORBIT_STAGE.height}`}
        >
          {orbitDefinitions.map((orbit) => (
            <path
              d={orbitCirclePath(orbit)}
              data-orbit-path={orbit.id}
              fill="none"
              key={orbit.id}
              stroke="transparent"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        <div
          className="public-orbit__window"
          data-launch-angle-from="-180"
          data-launch-duration="0.72"
          data-launch-radius-from="0.3"
          data-orbit-window
        >
          <div
            className="public-orbit__scaler"
            data-center-x={PUBLIC_ORBIT_STAGE.centerX}
            data-center-y={PUBLIC_ORBIT_STAGE.centerY}
            data-orbit-scale={PUBLIC_ORBIT_STAGE.scale}
            data-orbit-scaler
          >
            <div className="public-orbit__visual" data-orbit-visual>
              {orbitDefinitions.map((orbit) => (
                <span
                  aria-hidden="true"
                  className="public-orbit__boundary"
                  data-orbit-boundary={orbit.id}
                  key={`boundary-${orbit.id}`}
                  style={{ '--ring-diameter': orbit.baseDiameter } as CSSProperties}
                />
              ))}
              {orbitDefinitions.map((orbit) => (
                <div
                  className="public-orbit__ring"
                  data-base-diameter={orbit.baseDiameter}
                  data-direction={orbit.direction}
                  data-duration={orbit.periodSeconds}
                  data-continuous-motion-owner="waapi"
                  data-orbit-ring={orbit.id}
                  data-screen-diameter={orbit.screenDiameter}
                  data-track-width={orbit.trackWidth}
                  key={orbit.id}
                  style={{
                    '--ring-diameter': orbit.baseDiameter,
                    '--ring-duration': orbit.periodSeconds,
                    '--ring-track-width': `${orbit.trackWidth}px`,
                  } as CSSProperties}
                >
                  {publicDestinations.filter((destination) => destination.orbitId === orbit.id).map((destination) => (
                    <div
                      className="public-object__track"
                      data-object-track={destination.slug}
                      key={destination.slug}
                      style={{
                        '--arrival-angle': destination.angleDegrees,
                        '--arrival-radius': orbit.baseDiameter * 0.5,
                      } as CSSProperties}
                    >
                      <Link
                        aria-label={`探索${destination.label}`}
                        className="public-object"
                        data-arrival-delay={destination.arrivalDelaySeconds}
                        data-continuous-motion-owner="waapi"
                        data-glyph-upright="true"
                        data-object-angle={destination.angleDegrees}
                        data-object-paused={(attentionBySlug[destination.slug] ?? 0) !== 0 ? 'true' : 'false'}
                        data-object-upright
                        data-orbit-glyph={destination.glyph}
                        data-orbit-id={destination.orbitId}
                        data-period-seconds={destination.periodSeconds}
                        data-public-object={destination.slug}
                        data-restored-playhead={initialPlayheads?.[destination.slug]}
                        data-testid="orbit-object"
                        data-track-attached="true"
                        id={`public-object-${destination.slug}`}
                        onBlur={() => updateAttention(destination.slug, ATTENTION_FOCUS, false)}
                        onClick={(event) => navigateToDestination(event, destination.slug)}
                        onFocus={() => updateAttention(destination.slug, ATTENTION_FOCUS, true)}
                        onPointerEnter={() => updateAttention(destination.slug, ATTENTION_POINTER, true)}
                        onPointerLeave={() => updateAttention(destination.slug, ATTENTION_POINTER, false)}
                        style={{
                          '--object-size': `${destination.objectSize}px`,
                          color: destination.color,
                        } as CSSProperties}
                        to={`/${destination.slug}`}
                        viewTransition
                      >
                        <span className="public-object__path-counter" data-path-counter>
                          <span className="public-object__material" data-object-material>
                            <span aria-hidden="true" className="public-object__anchor" />
                            <span className="public-object__medallion">
                              <OrbitGlyph glyph={destination.glyph} />
                            </span>
                            <span className="public-object__label">
                              <strong data-orbit-label="always" data-short-label={destination.shortLabel}>{destination.label}</strong>
                              <small>{destination.description}</small>
                            </span>
                          </span>
                        </span>
                      </Link>
                    </div>
                  ))}
                </div>
              ))}
              <DaylightAperture />
              <div
                className="public-orbit__center"
                data-count-delay="1200"
                data-count-duration="2000"
                data-count-target="5"
                data-orbit-center
              >
                <strong className="public-orbit__count">{String(centerCount).padStart(2, '0')}</strong>
                <span className="public-orbit__count-label">此刻正在发生</span>
                <span className="sr-only">05 此刻正在发生</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export const PublicOrbit = memo(PublicOrbitComponent)
