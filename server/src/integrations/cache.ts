interface CacheEntry<T> {
  expiresAt: number
  value?: T
  error?: unknown
  inFlight?: Promise<T>
}

const FAILURE_TTL_MS = 3_000

export class TimedCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>()

  async get<T>(key: string, loader: () => Promise<T>, ttlMs = 15_000): Promise<T> {
    const now = Date.now()
    const current = this.entries.get(key) as CacheEntry<T> | undefined
    if (current && current.expiresAt > now) {
      if (current.inFlight) return current.inFlight
      if ('error' in current) throw current.error
      return current.value as T
    }

    const pending = loader()
    const loading: CacheEntry<T> = { expiresAt: Number.POSITIVE_INFINITY, inFlight: pending }
    this.entries.set(key, loading)
    try {
      const value = await pending
      this.entries.set(key, { value, expiresAt: Date.now() + ttlMs })
      return value
    } catch (error) {
      this.entries.set(key, { error, expiresAt: Date.now() + FAILURE_TTL_MS })
      throw error
    }
  }
}
