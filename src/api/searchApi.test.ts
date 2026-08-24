import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from './httpClient'
import { searchApi } from './searchApi'

vi.mock('./httpClient', () => ({ http: { request: vi.fn() } }))

describe('searchApi', () => {
  beforeEach(() => vi.mocked(http.request).mockReset().mockResolvedValue({ items: [] }))

  it('serializes bounded personal-search filters and forwards cancellation', async () => {
    const signal = new AbortController().signal
    await searchApi.search({ query: '高可用 100%', types: ['goal', 'recipe'], limit: 500 }, signal)

    expect(http.request).toHaveBeenCalledWith(
      '/search?q=%E9%AB%98%E5%8F%AF%E7%94%A8+100%25&types=goal%2Crecipe&limit=50',
      { signal },
    )
  })
})
