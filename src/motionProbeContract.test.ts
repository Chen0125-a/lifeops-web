import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitForStableFrameCadence } from '../tests/helpers/motionProbe'

const motionProbeSource = readFileSync(resolve(import.meta.dirname, '../tests/helpers/motionProbe.ts'), 'utf8')

describe('motion probe diagnostics', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports the required frame count when stable cadence times out', async () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(13_000)

    const page = {
      bringToFront: vi.fn(),
      evaluate: vi.fn(),
      waitForTimeout: vi.fn(),
    } as unknown as Parameters<typeof waitForStableFrameCadence>[0]

    await expect(waitForStableFrameCadence(page, 600, 10)).rejects.toThrow(
      'Foreground frame cadence did not hold 10 frames in 600ms for two consecutive windows; observed 0',
    )
  })

  it('samples the persistent shell color once without forcing layout inside every animation frame', () => {
    const recordSource = motionProbeSource.match(
      /export async function recordMotionFrames[\s\S]*?(?=export async function waitForStableFrameCadence)/,
    )?.[0] ?? ''
    const sampleSource = recordSource.slice(recordSource.indexOf('const sample ='))

    expect(recordSource.match(/getComputedStyle\(/g)).toHaveLength(1)
    expect(sampleSource).not.toContain('getComputedStyle(')
    expect(sampleSource).toContain('surface?.isConnected')
  })
})
