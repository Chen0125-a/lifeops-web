export const PUBLIC_ORBIT_STAGE = Object.freeze({
  width: 1132,
  height: 750,
  centerX: 792,
  centerY: 371,
  scale: 0.85,
  visualSize: 720,
  safeInset: 16,
})

export type OrbitDirection = 'cw' | 'ccw'

export interface OrbitDefinition {
  id: 'orbit-a' | 'orbit-b' | 'orbit-c' | 'orbit-d'
  baseDiameter: 353 | 501 | 649 | 797
  screenDiameter: 300.05 | 425.85 | 551.65 | 677.45
  direction: OrbitDirection
  periodSeconds: 30 | 40 | 50 | 60
  trackWidth: 1
}

export interface OrbitPoint {
  x: number
  y: number
}

export const orbitDefinitions: readonly OrbitDefinition[] = [
  { id: 'orbit-a', baseDiameter: 353, screenDiameter: 300.05, direction: 'ccw', periodSeconds: 30, trackWidth: 1 },
  { id: 'orbit-b', baseDiameter: 501, screenDiameter: 425.85, direction: 'cw', periodSeconds: 40, trackWidth: 1 },
  { id: 'orbit-c', baseDiameter: 649, screenDiameter: 551.65, direction: 'cw', periodSeconds: 50, trackWidth: 1 },
  { id: 'orbit-d', baseDiameter: 797, screenDiameter: 677.45, direction: 'ccw', periodSeconds: 60, trackWidth: 1 },
] as const

function normalizeDegrees(degrees: number) {
  return ((degrees % 360) + 360) % 360
}

export function pointOnOrbit(orbit: OrbitDefinition, angleDegrees: number): OrbitPoint {
  const angle = normalizeDegrees(angleDegrees) * Math.PI / 180
  const radius = orbit.screenDiameter / 2

  return {
    x: PUBLIC_ORBIT_STAGE.centerX + radius * Math.cos(angle),
    y: PUBLIC_ORBIT_STAGE.centerY + radius * Math.sin(angle),
  }
}

export function ringError(orbit: OrbitDefinition, point: OrbitPoint): number {
  const radius = orbit.screenDiameter / 2
  const distance = Math.hypot(
    point.x - PUBLIC_ORBIT_STAGE.centerX,
    point.y - PUBLIC_ORBIT_STAGE.centerY,
  )
  return Math.abs(distance / radius - 1)
}

/** SVG probe geometry retained for numerical motion and return-continuity tests. */
export function orbitCirclePath(orbit: OrbitDefinition): string {
  const radius = orbit.screenDiameter / 2
  const right = PUBLIC_ORBIT_STAGE.centerX + radius
  const left = PUBLIC_ORBIT_STAGE.centerX - radius
  const centerY = PUBLIC_ORBIT_STAGE.centerY
  return `M ${right} ${centerY} A ${radius} ${radius} 0 1 0 ${left} ${centerY} A ${radius} ${radius} 0 1 0 ${right} ${centerY}`
}
