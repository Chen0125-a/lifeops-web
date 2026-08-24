import { describe, expect, it } from 'vitest'
import { publicDestinations } from '../../content/publicDestinations'
import * as orbitGeometry from './orbitGeometry'

const { orbitDefinitions } = orbitGeometry

describe('ADR-029 orbit geometry', () => {
  it('locks the normalized reference stage, center, scale and safe inset', () => {
    expect('PUBLIC_ORBIT_STAGE' in orbitGeometry ? orbitGeometry.PUBLIC_ORBIT_STAGE : undefined).toEqual({
      width: 1132,
      height: 750,
      centerX: 792,
      centerY: 371,
      scale: 0.85,
      visualSize: 720,
      safeInset: 16,
    })
  })

  it('provides the exact four concentric masked rings without opacity or width compensation', () => {
    expect(orbitDefinitions.map((orbit) => orbit.id)).toEqual([
      'orbit-a',
      'orbit-b',
      'orbit-c',
      'orbit-d',
    ])
    expect(orbitDefinitions.map(({ baseDiameter, screenDiameter, direction, periodSeconds, trackWidth }) => ({
      baseDiameter,
      screenDiameter,
      direction,
      periodSeconds,
      trackWidth,
    }))).toEqual([
      { baseDiameter: 353, screenDiameter: 300.05, direction: 'ccw', periodSeconds: 30, trackWidth: 1 },
      { baseDiameter: 501, screenDiameter: 425.85, direction: 'cw', periodSeconds: 40, trackWidth: 1 },
      { baseDiameter: 649, screenDiameter: 551.65, direction: 'cw', periodSeconds: 50, trackWidth: 1 },
      { baseDiameter: 797, screenDiameter: 677.45, direction: 'ccw', periodSeconds: 60, trackWidth: 1 },
    ])
    expect(orbitDefinitions.every((orbit) => !('opacity' in orbit) && !('dash' in orbit))).toBe(true)
  })

  it('maps five semantic objects to four rings with the approved arrival wave', () => {
    expect(publicDestinations.map((destination) => ({
      slug: destination.slug,
      orbitId: destination.orbitId,
      angle: destination.angleDegrees,
      delay: destination.arrivalDelaySeconds,
      period: destination.periodSeconds,
    }))).toEqual([
      { slug: 'now', orbitId: 'orbit-a', angle: 314, delay: 0.6, period: 30 },
      { slug: 'doing', orbitId: 'orbit-b', angle: 236, delay: 0.8, period: 40 },
      { slug: 'learning', orbitId: 'orbit-b', angle: 161, delay: 1, period: 40 },
      { slug: 'moments', orbitId: 'orbit-c', angle: 96, delay: 1.2, period: 50 },
      { slug: 'archive', orbitId: 'orbit-d', angle: 88, delay: 1.4, period: 60 },
    ])
    expect(new Set(publicDestinations.map((destination) => destination.orbitId))).toEqual(
      new Set(orbitDefinitions.map((orbit) => orbit.id)),
    )
  })
})
