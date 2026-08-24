import { useEffect, useLayoutEffect, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { publicDestinations, type PublicDestinationSlug } from '../../content/publicDestinations'
import { DaylightAperture } from './DaylightAperture'
import { OrbitGlyph } from './OrbitGlyph'
import { orbitCirclePath, orbitDefinitions, PUBLIC_ORBIT_STAGE } from './orbitGeometry'
import { persistPublicReturnState, type PublicReturnState } from './publicReturnState'
import type { PublicOrbitProps } from './PublicOrbit'

/** Complete, accessible first-paint scene while the GSAP enhancement loads. */
export function PublicOrbitFallback({
  sceneState = 'rest',
  paused = false,
  onSceneRestored,
  initialPlayheads,
  restoreFocusId,
  theme = 'night',
}: PublicOrbitProps) {
  const navigate = useNavigate()
  const previousScene = useRef(sceneState)
  const motionRate = sceneState === 'login' ? 1 / 3 : sceneState === 'entering' ? 2 / 3 : 1

  useLayoutEffect(() => {
    if (!restoreFocusId) return
    document.getElementById(restoreFocusId)?.focus({ preventScroll: true })
  }, [restoreFocusId])

  useEffect(() => {
    const previous = previousScene.current
    previousScene.current = sceneState
    if (previous === 'rest' || sceneState !== 'rest') return
    const timer = window.setTimeout(() => onSceneRestored?.(), 700)
    return () => window.clearTimeout(timer)
  }, [onSceneRestored, sceneState])

  const navigateToDestination = (event: ReactMouseEvent<HTMLAnchorElement>, slug: PublicDestinationSlug) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    const objectPlayheads = Object.fromEntries(publicDestinations.map((destination) => [
      destination.slug,
      initialPlayheads?.[destination.slug] ?? destination.phase,
    ])) as Record<PublicDestinationSlug, number>
    const returnState: PublicReturnState = {
      sourceObjectId: slug,
      objectPlayheads,
      homeScrollY: window.scrollY,
      theme,
      sourceFocusId: `public-object-${slug}`,
    }
    persistPublicReturnState(returnState)
    navigate(`/${slug}`, { state: { publicReturn: returnState } })
  }

  return (
    <section
      aria-label="公开探索星盘"
      className="public-orbit"
      data-layout-revision="0"
      data-motion-enhanced="false"
      data-motion-paused={paused ? 'true' : 'false'}
      data-motion-rate={motionRate}
      data-motion-suspended="true"
      data-public-motion-owner="public-orbit"
      data-public-orbit
      data-reduced-motion="false"
      data-scene-state={sceneState}
    >
      <div
        className="public-orbit__reference-stage"
        data-orbit-reference-stage
        data-reference-height={PUBLIC_ORBIT_STAGE.height}
        data-reference-width={PUBLIC_ORBIT_STAGE.width}
      >
        <svg aria-hidden="true" className="public-orbit__geometry" focusable="false" viewBox={`0 0 ${PUBLIC_ORBIT_STAGE.width} ${PUBLIC_ORBIT_STAGE.height}`}>
          {orbitDefinitions.map((orbit) => (
            <path d={orbitCirclePath(orbit)} data-orbit-path={orbit.id} fill="none" key={orbit.id} stroke="transparent" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        <div className="public-orbit__window" data-launch-angle-from="-180" data-launch-duration="0.72" data-launch-radius-from="0.3" data-orbit-window>
          <div className="public-orbit__scaler" data-center-x={PUBLIC_ORBIT_STAGE.centerX} data-center-y={PUBLIC_ORBIT_STAGE.centerY} data-orbit-scale={PUBLIC_ORBIT_STAGE.scale} data-orbit-scaler>
            <div className="public-orbit__visual" data-orbit-visual>
              {orbitDefinitions.map((orbit) => (
                <span aria-hidden="true" className="public-orbit__boundary" data-orbit-boundary={orbit.id} key={`boundary-${orbit.id}`} style={{ '--ring-diameter': orbit.baseDiameter } as CSSProperties} />
              ))}
              {orbitDefinitions.map((orbit) => (
                <div
                  className="public-orbit__ring"
                  data-base-diameter={orbit.baseDiameter}
                  data-direction={orbit.direction}
                  data-duration={orbit.periodSeconds}
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
                        data-glyph-upright="true"
                        data-object-angle={destination.angleDegrees}
                        data-object-paused="true"
                        data-object-upright
                        data-orbit-glyph={destination.glyph}
                        data-orbit-id={destination.orbitId}
                        data-period-seconds={destination.periodSeconds}
                        data-public-object={destination.slug}
                        data-restored-playhead={initialPlayheads?.[destination.slug]}
                        data-testid="orbit-object"
                        data-track-attached="true"
                        id={`public-object-${destination.slug}`}
                        onClick={(event) => navigateToDestination(event, destination.slug)}
                        style={{ '--object-size': `${destination.objectSize}px`, color: destination.color } as CSSProperties}
                        to={`/${destination.slug}`}
                        viewTransition
                      >
                        <span className="public-object__path-counter" data-path-counter>
                          <span className="public-object__material" data-object-material>
                            <span aria-hidden="true" className="public-object__anchor" />
                            <span className="public-object__medallion"><OrbitGlyph glyph={destination.glyph} /></span>
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
              <div className="public-orbit__center" data-count-delay="1200" data-count-duration="2000" data-count-target="5" data-orbit-center>
                <strong className="public-orbit__count">05</strong>
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
