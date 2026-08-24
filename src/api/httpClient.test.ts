import { afterEach, describe, expect, it, vi } from 'vitest'
import { http } from './httpClient'

describe('http transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends JSON writes with CSRF and forwards the AbortSignal', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ id: 'goal-1', version: 2 }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)

    await expect(http.request('/goals/1', {
      method: 'PATCH',
      csrf: 'csrf-token',
      signal: controller.signal,
      body: { title: '升级 LifeOps', version: 1 },
    })).resolves.toEqual({ id: 'goal-1', version: 2 })

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/goals/1', {
      method: 'PATCH',
      credentials: 'same-origin',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: JSON.stringify({ title: '升级 LifeOps', version: 1 }),
    })
  })

  it('decodes a 409 response into a typed conflict with its request ID', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: 'VERSION_CONFLICT',
        message: '数据已经在另一处更新',
        requestId: 'req-7',
      },
    }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    })))

    await expect(http.request('/goals/1', {
      method: 'PATCH',
      csrf: 'token',
      body: { version: 1 },
    })).rejects.toMatchObject({
      name: 'HttpError',
      code: 'VERSION_CONFLICT',
      message: '数据已经在另一处更新',
      status: 409,
      requestId: 'req-7',
    })
  })

  it('returns undefined for a 204 response without parsing a body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))

    await expect(http.request<void>('/auth/logout', {
      method: 'POST',
      csrf: 'token',
    })).resolves.toBeUndefined()
  })
})
