import { MotionConfig } from 'motion/react'
import type { PropsWithChildren } from 'react'

const appTransition = {
  duration: 0.28,
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
}

export function AppMotionProvider({ children }: PropsWithChildren) {
  return (
    <MotionConfig reducedMotion="user" transition={appTransition}>
      <div data-testid="motion-config" data-reduced-motion="user">
        {children}
      </div>
    </MotionConfig>
  )
}
