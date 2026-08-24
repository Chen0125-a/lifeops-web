import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from './httpClient'
import { queryClient } from './queryClient'
import { queryKeys } from './queryKeys'
import { reviewsApi } from './reviewsApi'

vi.mock('./httpClient', () => ({ http: { request: vi.fn() } }))
vi.mock('./queryClient', () => ({ queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) } }))

const request = vi.mocked(http.request)
const invalidateQueries = vi.mocked(queryClient.invalidateQueries)

describe('reviewsApi', () => {
  beforeEach(() => {
    request.mockReset()
    invalidateQueries.mockClear()
  })

  it('lists cancellable review filters and gets encoded IDs', async () => {
    request.mockResolvedValue(undefined)
    const signal = new AbortController().signal
    await reviewsApi.list({ includeArchived: true }, signal)
    await reviewsApi.get('review/with space', signal)
    expect(request).toHaveBeenNthCalledWith(1, '/reviews?includeArchived=true', { signal })
    expect(request).toHaveBeenNthCalledWith(2, '/reviews/review%2Fwith%20space', { signal })
  })

  it('preserves idempotency, CSRF and optimistic versions across the review lifecycle', async () => {
    request.mockResolvedValue(undefined)
    const input = {
      type: 'weekly' as const,
      period: { from: '2026-08-04', to: '2026-08-10' },
      achievements: ['Shipped the slice'],
    }
    await reviewsApi.create(input, 'review-create-1', 'csrf-1')
    await reviewsApi.update('review/1', { status: 'archived', version: 2 }, 'csrf-1')
    await reviewsApi.refreshEvidence('review/1', 3, 'csrf-1')
    await reviewsApi.remove('review/1', 4, 'csrf-1')
    await reviewsApi.restore('review/1', 5, 'csrf-1')
    expect(request).toHaveBeenNthCalledWith(1, '/reviews', {
      method: 'POST', body: input, idempotencyKey: 'review-create-1', csrf: 'csrf-1',
    })
    expect(request).toHaveBeenNthCalledWith(2, '/reviews/review%2F1', {
      method: 'PATCH', body: { status: 'archived', version: 2 }, csrf: 'csrf-1',
    })
    expect(request).toHaveBeenNthCalledWith(3, '/reviews/review%2F1/refresh-evidence', {
      method: 'POST', body: { version: 3 }, csrf: 'csrf-1',
    })
    expect(request).toHaveBeenNthCalledWith(4, '/reviews/review%2F1', {
      method: 'DELETE', body: { version: 4 }, csrf: 'csrf-1',
    })
    expect(request).toHaveBeenNthCalledWith(5, '/reviews/review%2F1/restore', {
      method: 'POST', body: { version: 5 }, csrf: 'csrf-1',
    })
  })

  it('converts encoded actions idempotently and invalidates every affected domain', async () => {
    request.mockResolvedValue({ target: { type: 'task', id: 'task-1', title: 'Follow up' } })
    await reviewsApi.convertAction(
      'review/1', 'action/1', { target: 'task' }, 'convert-review-action-1', 'csrf-2',
    )
    expect(request).toHaveBeenCalledWith('/reviews/review%2F1/actions/action%2F1/convert', {
      method: 'POST', body: { target: 'task' }, idempotencyKey: 'convert-review-action-1', csrf: 'csrf-2',
    })
    expect(invalidateQueries.mock.calls.map(([options]) => options)).toEqual([
      { queryKey: queryKeys.reviews.all },
      { queryKey: queryKeys.tasks.all },
      { queryKey: queryKeys.goals.all },
      { queryKey: queryKeys.knowledge.all },
      { queryKey: queryKeys.snapshots.all },
    ])
  })
})
