import { afterEach, describe, expect, it, vi } from 'vitest'
import { TimedCache } from './cache.js'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('TimedCache', () => {
  it('reuses a successful value for 15 seconds and reloads after expiry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-22T00:00:00.000Z')
    const cache = new TimedCache()
    const loader = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second')

    await expect(cache.get('overview', loader)).resolves.toBe('first')
    vi.setSystemTime('2026-08-22T00:00:14.999Z')
    await expect(cache.get('overview', loader)).resolves.toBe('first')
    vi.setSystemTime('2026-08-22T00:00:15.001Z')
    await expect(cache.get('overview', loader)).resolves.toBe('second')
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('does not tie server cache freshness to document visibility', async () => {
    vi.stubGlobal('document', { visibilityState: 'hidden' })
    const cache = new TimedCache()
    const loader = vi.fn().mockResolvedValue({ state: 'connected' })

    await cache.get('hidden-source', loader)
    await cache.get('hidden-source', loader)

    expect(loader).toHaveBeenCalledOnce()
  })

  it('coalesces concurrent loads for the same key', async () => {
    let resolve!: (value: string) => void
    const deferred = new Promise<string>((done) => { resolve = done })
    const cache = new TimedCache()
    const loader = vi.fn(() => deferred)

    const first = cache.get('alerts', loader)
    const second = cache.get('alerts', loader)
    resolve('ready')

    await expect(Promise.all([first, second])).resolves.toEqual(['ready', 'ready'])
    expect(loader).toHaveBeenCalledOnce()
  })

  it('caches a failure for three seconds without extending the failure window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-22T00:00:00.000Z')
    const cache = new TimedCache()
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error('source unavailable'))
      .mockResolvedValueOnce('recovered')

    await expect(cache.get('logs', loader)).rejects.toThrow('source unavailable')
    vi.setSystemTime('2026-08-22T00:00:02.999Z')
    await expect(cache.get('logs', loader)).rejects.toThrow('source unavailable')
    vi.setSystemTime('2026-08-22T00:00:03.001Z')
    await expect(cache.get('logs', loader)).resolves.toBe('recovered')
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('isolates cached values and in-flight work by key', async () => {
    const cache = new TimedCache()
    const overview = vi.fn().mockResolvedValue('overview-value')
    const alerts = vi.fn().mockResolvedValue('alerts-value')

    await expect(Promise.all([
      cache.get('overview', overview),
      cache.get('alerts', alerts),
    ])).resolves.toEqual(['overview-value', 'alerts-value'])
    await expect(cache.get('overview', overview)).resolves.toBe('overview-value')
    expect(overview).toHaveBeenCalledOnce()
    expect(alerts).toHaveBeenCalledOnce()
  })
})
