import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { recordMotionFrames, waitForStableFrameCadence } from '../tests/helpers/motionProbe'

const motionProbeSource = readFileSync(resolve(import.meta.dirname, '../tests/helpers/motionProbe.ts'), 'utf8')

describe('motion probe diagnostics', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('keeps collecting continuity evidence when foreground WebKit drops animation frames', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
    vi.stubGlobal('HTMLElement', class {})
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('getComputedStyle', vi.fn(() => ({ backgroundColor: 'rgb(244, 239, 229)' })))
    vi.stubGlobal('location', { pathname: '/app/overview' })
    vi.stubGlobal('document', {
      activeElement: null,
      querySelector: (selector: string) => selector === 'main' || selector.includes('[data-private-shell]')
        ? { isConnected: true }
        : null,
      querySelectorAll: () => [{}],
    })

    const page = {
      evaluate: async (callback: (duration: number) => Promise<unknown>, duration: number) => callback(duration),
    } as unknown as Parameters<typeof recordMotionFrames>[0]
    const framesPromise = recordMotionFrames(page, 360)
    const outcomePromise = Promise.race([
      framesPromise,
      new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 500)),
    ])

    await vi.advanceTimersByTimeAsync(500)
    const outcome = await outcomePromise

    expect(Array.isArray(outcome)).toBe(true)
    if (!Array.isArray(outcome)) return
    expect(outcome.length).toBeGreaterThanOrEqual(10)
    expect(outcome.every((frame) => frame.shell && frame.main && frame.routePanels >= 1 && !frame.whiteFrame)).toBe(true)
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
