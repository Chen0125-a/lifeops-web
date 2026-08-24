export interface PublicMotionTimeline {
  play: () => unknown
  reverse: () => unknown
  progress: () => number
  timeScale: (value: number) => unknown
}

export interface PublicMotionControllerOptions {
  scene: PublicMotionTimeline
  objects: readonly PublicMotionTimeline[]
  enter?: () => void
}

export const PUBLIC_GSAP_BOUNDARY = Object.freeze({
  ownerAttribute: 'data-public-motion-owner',
  ownerValue: 'public-orbit',
  plugins: ['core', 'MotionPathPlugin', 'useGSAP'] as const,
})

export interface PublicMotionController {
  openLogin: () => void
  closeLogin: () => void
  enterPrivate: () => void
}

/** Loadable TDD seam. P2-T3 motion commands are intentionally absent until RED. */
export function createPublicMotionController(
  options: PublicMotionControllerOptions,
): PublicMotionController {
  return {
    openLogin: () => {
      for (const object of options.objects) object.timeScale(1 / 3)
      options.scene.play()
    },
    closeLogin: () => {
      options.scene.reverse()
      for (const object of options.objects) object.timeScale(1)
    },
    enterPrivate: () => {
      options.scene.timeScale(1)
      options.scene.play()
      for (const object of options.objects) object.timeScale(2 / 3)
      options.enter?.()
    },
  }
}
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { MotionPathPlugin } from 'gsap/MotionPathPlugin'

gsap.registerPlugin(MotionPathPlugin, useGSAP)

export { gsap, MotionPathPlugin, useGSAP }
