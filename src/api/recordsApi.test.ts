import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from './httpClient'
import { recordsApi } from './recordsApi'

vi.mock('./httpClient', () => ({ http: { request: vi.fn() } }))
const request = vi.mocked(http.request)

describe('recordsApi', () => {
  beforeEach(() => request.mockReset())

  it('loads cancellable records with deterministic filters', async () => {
    request.mockResolvedValueOnce([])
    const signal = new AbortController().signal
    await recordsApi.list({
      from: '2026-08-01', to: '2026-08-13', tag: 'lifeops', linkType: 'habit', linkId: 'habit/1',
      q: '数据 闭环', includeArchived: true,
    }, signal)
    expect(request).toHaveBeenCalledWith(
      '/records?from=2026-08-01&to=2026-08-13&tag=lifeops&linkType=habit&linkId=habit%2F1&q=%E6%95%B0%E6%8D%AE+%E9%97%AD%E7%8E%AF&includeArchived=true',
      { signal },
    )
  })

  it('gets encoded IDs and creates with CSRF plus idempotency', async () => {
    request.mockResolvedValue(undefined)
    const signal = new AbortController().signal
    const input = { title: '记录', body: '正文', links: [{ type: 'goal' as const, id: 'goal-1' }] }
    await recordsApi.get('record/with space', signal)
    await recordsApi.create(input, 'record-create-1', 'csrf-1')
    expect(request).toHaveBeenNthCalledWith(1, '/records/record%2Fwith%20space', { signal })
    expect(request).toHaveBeenNthCalledWith(2, '/records', {
      method: 'POST', body: input, csrf: 'csrf-1', idempotencyKey: 'record-create-1',
    })
  })

  it('preserves optimistic versions for autosave, delete and restore', async () => {
    request.mockResolvedValue(undefined)
    await recordsApi.update('record/1', { body: '自动保存', archived: true, version: 4 }, 'csrf-2')
    await recordsApi.remove('record/1', 5, 'csrf-2')
    await recordsApi.restore('record/1', 6, 'csrf-2')
    expect(request).toHaveBeenNthCalledWith(1, '/records/record%2F1', {
      method: 'PATCH', body: { body: '自动保存', archived: true, version: 4 }, csrf: 'csrf-2',
    })
    expect(request).toHaveBeenNthCalledWith(2, '/records/record%2F1', {
      method: 'DELETE', body: { version: 5 }, csrf: 'csrf-2',
    })
    expect(request).toHaveBeenNthCalledWith(3, '/records/record%2F1/restore', {
      method: 'POST', body: { version: 6 }, csrf: 'csrf-2',
    })
  })

  it('transports explicit nullable cover identity without deriving it from media order', async () => {
    request.mockResolvedValue(undefined)
    const createInput = {
      title: '封面记录', body: '正文', mediaIds: ['media-detail', 'media-cover'], coverMediaId: 'media-cover',
    } as Parameters<typeof recordsApi.create>[0] & { coverMediaId: string | null }
    const clearInput = {
      mediaIds: ['media-detail'], coverMediaId: null, version: 2,
    } as Parameters<typeof recordsApi.update>[1] & { coverMediaId: string | null }

    await recordsApi.create(createInput, 'record-cover-create', 'csrf-cover')
    await recordsApi.update('record-cover', clearInput, 'csrf-cover')

    expect(request).toHaveBeenNthCalledWith(1, '/records', {
      method: 'POST', body: createInput, csrf: 'csrf-cover', idempotencyKey: 'record-cover-create',
    })
    expect(request).toHaveBeenNthCalledWith(2, '/records/record-cover', {
      method: 'PATCH', body: clearInput, csrf: 'csrf-cover',
    })
  })
})
