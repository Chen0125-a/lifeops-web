import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { publicDestinations } from '../../content/publicDestinations'
import { gsap } from '../../motion/publicGsap'
import { orbitDefinitions } from './orbitGeometry'
import { PublicOrbit } from './PublicOrbit'
import { PublicOrbitFallback } from './PublicOrbitFallback'

describe('PublicOrbit', () => {
  it('gives native Web Animations exclusive ownership of the four rings and five upright counters', () => {
    const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
    const calls: Array<{
      animation: Animation
      keyframes: Keyframe[] | PropertyIndexedKeyframes | null
      options: number | KeyframeAnimationOptions | undefined
      target: Element
    }> = []
    const animate = vi.fn(function animate(
      this: Element,
      keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      options?: number | KeyframeAnimationOptions,
    ) {
      const duration = typeof options === 'number' ? options : Number(options?.duration ?? 0)
      const animation = {
        cancel: vi.fn(),
        currentTime: 0,
        effect: { getTiming: () => ({ duration }) },
        pause: vi.fn(),
        play: vi.fn(),
        playbackRate: 1,
      } as unknown as Animation
      calls.push({ animation, keyframes, options, target: this })
      return animation
    })
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: animate,
      writable: true,
    })

    try {
      const playheads = { now: 0.11, doing: 0.22, learning: 0.22, moments: 0.44, archive: 0.55 }
      const view = render(
        <MemoryRouter>
          <PublicOrbit initialPlayheads={playheads} sceneState="rest" paused={false} />
        </MemoryRouter>,
      )

      expect(calls).toHaveLength(9)
      for (const orbit of orbitDefinitions) {
        const target = view.container.querySelector(`[data-orbit-ring="${orbit.id}"]`)
        const call = calls.find((candidate) => candidate.target === target)
        const direction = orbit.direction === 'cw' ? 360 : -360
        const firstDestination = publicDestinations.find((destination) => destination.orbitId === orbit.id)

        expect(target).toHaveAttribute('data-continuous-motion-owner', 'waapi')
        expect(call?.keyframes).toEqual([
          { transform: 'rotate(0deg)' },
          { transform: `rotate(${direction}deg)` },
        ])
        expect(call?.options).toMatchObject({
          duration: orbit.periodSeconds * 1000,
          easing: 'linear',
          iterations: Infinity,
        })
        expect(call?.animation.currentTime).toBe(
          orbit.periodSeconds * 1000 * playheads[firstDestination!.slug],
        )
        expect(call?.animation.playbackRate).toBe(1)
        expect(call?.animation.play).toHaveBeenCalled()
        expect(gsap.getTweensOf(target)).toHaveLength(0)
      }

      for (const destination of publicDestinations) {
        const target = view.container.querySelector(`[data-public-object="${destination.slug}"]`)
        const call = calls.find((candidate) => candidate.target === target)
        const orbit = orbitDefinitions.find((candidate) => candidate.id === destination.orbitId)!
        const direction = orbit.direction === 'cw' ? 360 : -360
        const initialRotation = -destination.angleDegrees

        expect(target).toHaveAttribute('data-continuous-motion-owner', 'waapi')
        expect(call?.keyframes).toEqual([
          { transform: `rotate(${initialRotation}deg)` },
          { transform: `rotate(${initialRotation - direction}deg)` },
        ])
        expect(call?.options).toMatchObject({
          duration: destination.periodSeconds * 1000,
          easing: 'linear',
          iterations: Infinity,
        })
        expect(call?.animation.currentTime).toBe(
          destination.periodSeconds * 1000 * playheads[destination.slug],
        )
        expect(call?.animation.playbackRate).toBe(1)
        expect(call?.animation.play).toHaveBeenCalled()
        expect(gsap.getTweensOf(target)).toHaveLength(0)
      }

      view.rerender(
        <MemoryRouter>
          <PublicOrbit initialPlayheads={playheads} sceneState="login" paused={false} />
        </MemoryRouter>,
      )
      expect(calls).toHaveLength(9)
      expect(calls.every(({ animation }) => animation.playbackRate === 1 / 3)).toBe(true)

      fireEvent.focus(screen.getByRole('link', { name: '探索正在做' }))
      const orbitBTargets = calls.filter(({ target }) => (
        target.matches('[data-orbit-ring="orbit-b"]')
        || target.matches('[data-orbit-id="orbit-b"]')
      ))
      expect(orbitBTargets).toHaveLength(3)
      expect(orbitBTargets.every(({ animation }) => vi.mocked(animation.pause).mock.calls.length > 0)).toBe(true)

      view.unmount()
      expect(calls.every(({ animation }) => vi.mocked(animation.cancel).mock.calls.length === 1)).toBe(true)
    } finally {
      if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate)
      else Reflect.deleteProperty(Element.prototype, 'animate')
    }
  })

  it('persists all five live playheads, scroll, theme and source focus in router and session state', async () => {
    const playheads = { now: 0.11, doing: 0.22, learning: 0.22, moments: 0.44, archive: 0.55 }

    function DetailStateProbe() {
      const location = useLocation()
      return <output data-testid="return-state">{JSON.stringify(location.state)}</output>
    }

    Object.defineProperty(window, 'scrollY', { configurable: true, value: 318 })
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<PublicOrbit initialPlayheads={playheads} sceneState="rest" paused={false} theme="night" />} />
          <Route path="/doing" element={<DetailStateProbe />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('link', { name: '探索正在做' }))
    const state = JSON.parse(screen.getByTestId('return-state').textContent ?? '{}') as { publicReturn: unknown }
    expect(state.publicReturn).toEqual({
      sourceObjectId: 'doing',
      objectPlayheads: playheads,
      homeScrollY: 318,
      theme: 'night',
      sourceFocusId: 'public-object-doing',
    })
    expect(JSON.parse(sessionStorage.getItem('lifeops:public-return:v1') ?? 'null')).toEqual(state.publicReturn)
  })

  it('renders the approved destinations as direct public routes', () => {
    const { container } = render(
      <MemoryRouter>
        <PublicOrbit sceneState="rest" paused={false} />
      </MemoryRouter>,
    )

    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/now',
      '/doing',
      '/learning',
      '/moments',
      '/archive',
    ])
    expect(container.querySelectorAll('[data-public-object]')).toHaveLength(5)
  })

  it('renders four compositor-safe tracks with moving markers on the normalized reference stage', () => {
    const { container } = render(
      <MemoryRouter>
        <PublicOrbit sceneState="rest" paused={false} />
      </MemoryRouter>,
    )

    expect(container.querySelector('[data-orbit-reference-stage]')).toHaveAttribute('data-reference-width', '1132')
    expect(container.querySelector('[data-orbit-reference-stage]')).toHaveAttribute('data-reference-height', '750')
    expect(container.querySelector('[data-orbit-scaler]')).toHaveAttribute('data-center-x', '792')
    expect(container.querySelector('[data-orbit-scaler]')).toHaveAttribute('data-center-y', '371')
    expect(container.querySelector('[data-orbit-scaler]')).toHaveAttribute('data-orbit-scale', '0.85')
    expect(container.querySelectorAll('[data-orbit-ring]')).toHaveLength(4)
    expect(container.querySelectorAll('[data-orbit-track-static]')).toHaveLength(4)
    expect(container.querySelectorAll('[data-orbit-track-motion]')).toHaveLength(4)
    for (const orbit of orbitDefinitions) {
      const ring = container.querySelector(`[data-orbit-ring="${orbit.id}"]`)
      const boundary = container.querySelector(`[data-orbit-track-static="${orbit.id}"]`)
      const marker = ring?.querySelector(`[data-orbit-track-motion="${orbit.id}"]`)
      expect(ring).toHaveAttribute('data-base-diameter', String(orbit.baseDiameter))
      expect(ring).toHaveAttribute('data-screen-diameter', String(orbit.screenDiameter))
      expect(ring).toHaveAttribute('data-direction', orbit.direction)
      expect(ring).toHaveAttribute('data-duration', String(orbit.periodSeconds))
      expect(ring).toHaveAttribute('data-track-width', '1')
      expect(boundary).toHaveAttribute('data-track-width', '1')
      expect(marker).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it('keeps every destination label present and exposes exact object periods', () => {
    const { container } = render(
      <MemoryRouter>
        <PublicOrbit sceneState="rest" paused={false} />
      </MemoryRouter>,
    )

    expect([...container.querySelectorAll('[data-orbit-label="always"]')].map((label) => label.textContent)).toEqual([
      '此刻',
      '正在做',
      '最近在学',
      '生活切片',
      '时间档案',
    ])
    expect([...container.querySelectorAll('[data-period-seconds]')].map((node) => Number(node.getAttribute('data-period-seconds')))).toEqual([
      30,
      40,
      40,
      50,
      60,
    ])
  })

  it('renders the approved layered arrival contract and center copy', () => {
    const { container } = render(
      <MemoryRouter>
        <PublicOrbit sceneState="rest" paused={false} />
      </MemoryRouter>,
    )

    expect(container.querySelector('[data-orbit-window]')).toHaveAttribute('data-launch-duration', '0.72')
    expect(container.querySelector('[data-orbit-window]')).toHaveAttribute('data-launch-radius-from', '0.3')
    expect(container.querySelector('[data-orbit-window]')).toHaveAttribute('data-launch-angle-from', '-180')
    expect(container.querySelector('[data-orbit-center]')).toHaveTextContent('05')
    expect(container.querySelector('[data-orbit-center]')).toHaveTextContent('此刻正在发生')
    expect([...container.querySelectorAll('[data-public-object]')].map((object) => ({
      delay: object.getAttribute('data-arrival-delay'),
      angle: object.getAttribute('data-object-angle'),
      pathCounter: Boolean(object.querySelector('[data-path-counter]')),
      upright: object.matches('[data-object-upright]'),
      material: Boolean(object.querySelector('[data-object-material]')),
    }))).toEqual([
      { delay: '0.6', angle: '314', pathCounter: true, upright: true, material: true },
      { delay: '0.8', angle: '236', pathCounter: true, upright: true, material: true },
      { delay: '1', angle: '161', pathCounter: true, upright: true, material: true },
      { delay: '1.2', angle: '96', pathCounter: true, upright: true, material: true },
      { delay: '1.4', angle: '88', pathCounter: true, upright: true, material: true },
    ])
  })

  it('exposes the five semantic glyphs in one track-attached object contract', () => {
    const { container } = render(
      <MemoryRouter>
        <PublicOrbit sceneState="rest" paused={false} />
      </MemoryRouter>,
    )

    expect([...container.querySelectorAll('[data-public-object]')].map((object) => ({
      glyph: object.getAttribute('data-orbit-glyph'),
      attached: object.getAttribute('data-track-attached'),
      upright: object.getAttribute('data-glyph-upright'),
    }))).toEqual([
      { glyph: 'sundial', attached: 'true', upright: 'true' },
      { glyph: 'navigation-flag', attached: 'true', upright: 'true' },
      { glyph: 'open-book', attached: 'true', upright: 'true' },
      { glyph: 'viewfinder', attached: 'true', upright: 'true' },
      { glyph: 'tree-ring', attached: 'true', upright: 'true' },
    ])
  })

  it('keeps enhanced and fallback orbit semantics and initial geometry identical', () => {
    const signature = (container: HTMLElement) => ({
      rings: [...container.querySelectorAll<HTMLElement>('[data-orbit-ring]')].map((ring) => ({
        id: ring.dataset.orbitRing,
        diameter: ring.dataset.baseDiameter,
        direction: ring.dataset.direction,
      })),
      objects: [...container.querySelectorAll<HTMLElement>('[data-public-object]')].map((object) => ({
        slug: object.dataset.publicObject,
        orbitId: object.dataset.orbitId,
        glyph: object.dataset.orbitGlyph,
        angle: object.dataset.objectAngle,
        delay: object.dataset.arrivalDelay,
        label: object.querySelector('[data-orbit-label="always"]')?.textContent,
      })),
    })
    const enhanced = render(
      <MemoryRouter>
        <PublicOrbit sceneState="rest" paused={false} />
      </MemoryRouter>,
    )
    const enhancedSignature = signature(enhanced.container)
    enhanced.unmount()
    const fallback = render(
      <MemoryRouter>
        <PublicOrbitFallback sceneState="rest" paused={false} />
      </MemoryRouter>,
    )

    expect(signature(fallback.container)).toEqual(enhancedSignature)
  })

  it('keeps fallback return playheads on the same authored default phases as its rendered objects', () => {
    function DetailStateProbe() {
      const location = useLocation()
      return <output data-testid="fallback-return-state">{JSON.stringify(location.state)}</output>
    }

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<PublicOrbitFallback sceneState="rest" paused={false} theme="night" />} />
          <Route path="/learning" element={<DetailStateProbe />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('link', { name: '探索最近在学' }))
    const state = JSON.parse(screen.getByTestId('fallback-return-state').textContent ?? '{}') as {
      publicReturn: { objectPlayheads: Record<string, number> }
    }
    expect(state.publicReturn.objectPlayheads).toEqual(Object.fromEntries(
      publicDestinations.map((destination) => [destination.slug, destination.phase]),
    ))
  })

  it('renders a quiet daylight aperture without private-system or technology marks', () => {
    const { container } = render(
      <MemoryRouter>
        <PublicOrbit sceneState="rest" paused={false} />
      </MemoryRouter>,
    )

    expect(container.querySelector('[data-daylight-aperture]')).toBeInTheDocument()
    expect(container).not.toHaveTextContent(/PRIVATE SYSTEM/i)
    expect(container).not.toHaveTextContent(/KUBERNETES|DOCKER|MYSQL|GITOPS|PROMETHEUS|GRAFANA|JENKINS|HARBOR/i)
    expect(container.querySelector('[data-source-tech]')).not.toBeInTheDocument()
  })

  it('honors the header-owned pause state without rendering a second local control', () => {
    const { container, rerender } = render(
      <MemoryRouter>
        <PublicOrbit sceneState="rest" paused={false} />
      </MemoryRouter>,
    )

    const orbit = container.querySelector('[data-public-orbit]')
    expect(orbit).toHaveAttribute('data-motion-suspended', 'false')
    expect(screen.queryByRole('button', { name: '暂停星盘动画' })).not.toBeInTheDocument()

    rerender(
      <MemoryRouter>
        <PublicOrbit sceneState="rest" paused />
      </MemoryRouter>,
    )
    expect(container.querySelector('[data-public-orbit]')).toHaveAttribute('data-motion-suspended', 'true')
  })

  it('pauses an individual object while it has focus or pointer attention', () => {
    render(
      <MemoryRouter>
        <PublicOrbit sceneState="rest" paused={false} />
      </MemoryRouter>,
    )

    const destination = screen.getByRole('link', { name: '探索此刻' })
    expect(destination).toHaveAttribute('data-object-paused', 'false')

    fireEvent.focus(destination)
    expect(destination).toHaveAttribute('data-object-paused', 'true')

    fireEvent.blur(destination)
    expect(destination).toHaveAttribute('data-object-paused', 'false')

    fireEvent.pointerEnter(destination)
    expect(destination).toHaveAttribute('data-object-paused', 'true')

    fireEvent.pointerLeave(destination)
    expect(destination).toHaveAttribute('data-object-paused', 'false')
  })

  it('suspends all timelines while the document is hidden', () => {
    let hidden = false
    const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)

    try {
      const { container } = render(
        <MemoryRouter>
          <PublicOrbit sceneState="rest" paused={false} />
        </MemoryRouter>,
      )
      const orbit = container.querySelector('[data-public-orbit]')

      expect(orbit).toHaveAttribute('data-motion-suspended', 'false')

      hidden = true
      fireEvent(document, new Event('visibilitychange'))
      expect(orbit).toHaveAttribute('data-motion-suspended', 'true')
    } finally {
      hiddenSpy.mockRestore()
    }
  })

  it('suspends all timelines while the orbit is outside the viewport', () => {
    let observerCallback: IntersectionObserverCallback | undefined

    class TestIntersectionObserver {
      readonly root = null
      readonly rootMargin = '0px'
      readonly thresholds = [0]
      disconnect = vi.fn()
      observe = vi.fn()
      takeRecords = vi.fn(() => [])
      unobserve = vi.fn()

      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback
      }
    }

    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver)

    try {
      const { container } = render(
        <MemoryRouter>
          <PublicOrbit sceneState="rest" paused={false} />
        </MemoryRouter>,
      )
      const orbit = container.querySelector('[data-public-orbit]')

      expect(orbit).toHaveAttribute('data-motion-suspended', 'false')

      act(() => {
        observerCallback?.(
          [{ isIntersecting: false } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        )
      })

      expect(orbit).toHaveAttribute('data-motion-suspended', 'true')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('uses a static composed state when reduced motion is requested', () => {
    const matchMediaSpy = vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) =>
        ({
          matches: query === '(prefers-reduced-motion: reduce)',
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as MediaQueryList,
    )

    try {
      const { container } = render(
        <MemoryRouter>
          <PublicOrbit sceneState="rest" paused={false} />
        </MemoryRouter>,
      )

      expect(container.querySelector('[data-public-orbit]')).toHaveAttribute(
        'data-reduced-motion',
        'true',
      )
      expect(container.querySelector('[data-public-orbit]')).toHaveAttribute(
        'data-motion-suspended',
        'true',
      )
    } finally {
      matchMediaSpy.mockRestore()
    }
  })

  it('slows the continuous scene for login without hijacking wheel input', () => {
    const { container } = render(
      <MemoryRouter>
        <PublicOrbit sceneState="login" paused={false} />
      </MemoryRouter>,
    )
    const orbit = container.querySelector('[data-public-orbit]')
    const wheelEvent = new WheelEvent('wheel', { cancelable: true })

    orbit?.dispatchEvent(wheelEvent)

    expect(Number(orbit?.getAttribute('data-motion-rate'))).toBeLessThan(1)
    expect(wheelEvent.defaultPrevented).toBe(false)
  })
})
