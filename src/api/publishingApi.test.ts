import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from './httpClient'
import { publishingApi } from './publishingApi'
import { queryClient } from './queryClient'
import { queryKeys } from './queryKeys'

vi.mock('./httpClient', () => ({ http: { request: vi.fn() } }))
vi.mock('./queryClient', () => ({ queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) } }))

const request = vi.mocked(http.request)
const invalidateQueries = vi.mocked(queryClient.invalidateQueries)

describe('publishingApi', () => {
  beforeEach(() => {
    request.mockReset()
    request.mockResolvedValue(undefined)
    invalidateQueries.mockClear()
  })

  it('forwards cancellable owner reads and encoded revision diff queries', async () => {
    const signal = new AbortController().signal
    await publishingApi.list(signal)
    await publishingApi.get('draft/with space', signal)
    await publishingApi.revisions('draft/with space', signal)
    await publishingApi.diff('draft/with space', 1, 3, signal)
    expect(request).toHaveBeenNthCalledWith(1, '/publishing/drafts', { signal })
    expect(request).toHaveBeenNthCalledWith(2, '/publishing/drafts/draft%2Fwith%20space', { signal })
    expect(request).toHaveBeenNthCalledWith(3, '/publishing/drafts/draft%2Fwith%20space/revisions', { signal })
    expect(request).toHaveBeenNthCalledWith(4, '/publishing/drafts/draft%2Fwith%20space/revisions/diff?from=1&to=3', { signal })
  })

  it('preserves standalone/source-derived public fields, CSRF and optimistic versions', async () => {
    const create = {
      category: 'learning' as const, source: { type: 'knowledge' as const, id: 'note/1' }, slug: 'release-gate',
      title: '发布门禁', excerpt: '仅公开明确字段', body: '# 发布门禁', coverUrl: null,
      tags: ['public'], featured: true, seo: { title: 'SEO', description: 'SEO summary' },
    }
    await publishingApi.create(create, 'csrf-publish')
    await publishingApi.update('draft/1', { title: '发布门禁 v2', version: 2 }, 'csrf-publish')
    await publishingApi.remove('draft/1', 3, 'csrf-publish')
    expect(request).toHaveBeenNthCalledWith(1, '/publishing/drafts', { method: 'POST', body: create, csrf: 'csrf-publish' })
    expect(request).toHaveBeenNthCalledWith(2, '/publishing/drafts/draft%2F1', { method: 'PATCH', body: { title: '发布门禁 v2', version: 2 }, csrf: 'csrf-publish' })
    expect(request).toHaveBeenNthCalledWith(3, '/publishing/drafts/draft%2F1', { method: 'DELETE', body: { version: 3 }, csrf: 'csrf-publish' })
    expect(invalidateQueries).toHaveBeenCalledTimes(3)
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.publishing.all })
  })

  it('supports preview, immediate publish, scheduling and revoke actions without leaking transport fields', async () => {
    await publishingApi.preview('draft/2', 'csrf-actions')
    await publishingApi.publish('draft/2', 4, 'csrf-actions')
    await publishingApi.schedule('draft/2', 4, '2026-08-23T10:00:00.000Z', 'csrf-actions')
    await publishingApi.revoke('draft/2', 5, 'csrf-actions')
    expect(request).toHaveBeenNthCalledWith(1, '/publishing/drafts/draft%2F2/preview', { method: 'POST', csrf: 'csrf-actions' })
    expect(request).toHaveBeenNthCalledWith(2, '/publishing/drafts/draft%2F2/publish', { method: 'POST', body: { version: 4 }, csrf: 'csrf-actions' })
    expect(request).toHaveBeenNthCalledWith(3, '/publishing/drafts/draft%2F2/schedule', { method: 'POST', body: { version: 4, scheduledAt: '2026-08-23T10:00:00.000Z' }, csrf: 'csrf-actions' })
    expect(request).toHaveBeenNthCalledWith(4, '/publishing/drafts/draft%2F2/revoke', { method: 'POST', body: { version: 5 }, csrf: 'csrf-actions' })
    expect(invalidateQueries).toHaveBeenCalledTimes(3)
  })
})
