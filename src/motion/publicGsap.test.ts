import { render } from '@testing-library/react'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import packageJson from '../../package.json'
import { PublicOrbit } from '../components/public/PublicOrbit'
import {
  createPublicMotionController,
  PUBLIC_GSAP_BOUNDARY,
  type PublicMotionTimeline,
} from './publicGsap'

function timeline(progress: number) {
  return {
    play: vi.fn<PublicMotionTimeline['play']>(),
    reverse: vi.fn<PublicMotionTimeline['reverse']>(),
    progress: vi.fn<PublicMotionTimeline['progress']>(() => progress),
    timeScale: vi.fn<PublicMotionTimeline['timeScale']>(),
  } satisfies PublicMotionTimeline
}

describe('public GSAP boundary', () => {
  it('locks only the approved exact public motion packages and plugins', () => {
    expect(packageJson.dependencies.gsap).toBe('3.15.0')
    expect(packageJson.dependencies['@gsap/react']).toBe('2.1.2')
    expect(PUBLIC_GSAP_BOUNDARY.plugins).toEqual(['core', 'MotionPathPlugin', 'useGSAP'])
  })

  it('exposes exactly one GSAP owner inside the public motion subtree', () => {
    const { container } = render(
      createElement(
        MemoryRouter,
        null,
        createElement(PublicOrbit, { sceneState: 'rest' }),
      ),
    )

    expect(
      container.querySelectorAll(
        `[${PUBLIC_GSAP_BOUNDARY.ownerAttribute}="${PUBLIC_GSAP_BOUNDARY.ownerValue}"]`,
      ),
    ).toHaveLength(1)
  })

  it('slows objects to one third while opening and reverses without resetting playheads', () => {
    const scene = timeline(0.42)
    const objects = [timeline(0.17), timeline(0.64)]
    const controller = createPublicMotionController({ scene, objects })

    controller.openLogin()
    expect(scene.play).toHaveBeenCalledOnce()
    for (const object of objects) expect(object.timeScale).toHaveBeenLastCalledWith(1 / 3)

    const playheads = objects.map((object) => object.progress())
    controller.closeLogin()
    expect(scene.reverse).toHaveBeenCalledOnce()
    expect(objects.map((object) => object.progress())).toEqual(playheads)
    for (const object of objects) {
      expect(object.progress).not.toHaveBeenCalledWith(expect.any(Number))
      expect(object.timeScale).toHaveBeenLastCalledWith(1)
    }
  })

  it('continues an interrupted scene from its live playhead', () => {
    const scene = timeline(0.38)
    const controller = createPublicMotionController({ scene, objects: [timeline(0.5)] })

    controller.openLogin()
    controller.closeLogin()
    controller.openLogin()

    expect(scene.play).toHaveBeenCalledTimes(2)
    expect(scene.reverse).toHaveBeenCalledOnce()
    expect(scene.progress).not.toHaveBeenCalledWith(expect.any(Number))
  })

  it('uses a separate semantic command for authenticated aperture entry', () => {
    const scene = timeline(0.75)
    const controller = createPublicMotionController({ scene, objects: [timeline(0.2)] })

    controller.enterPrivate()
    expect(scene.play).toHaveBeenCalledOnce()
    expect(scene.timeScale).toHaveBeenCalledWith(1)
  })
})
