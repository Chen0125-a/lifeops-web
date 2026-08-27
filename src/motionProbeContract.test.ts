import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitForStableFrameCadence } from '../tests/helpers/motionProbe'

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
})
