import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from './httpClient'
import { habitsApi } from './habitsApi'

vi.mock('./httpClient', () => ({
  http: { request: vi.fn() },
}))

const request = vi.mocked(http.request)

describe('habitsApi', () => {
  beforeEach(() => request.mockReset())

  it('loads a cancellable matrix window with deterministic date filters', async () => {
    const signal = new AbortController().signal
    request.mockResolvedValueOnce({ from: '2026-08-01', to: '2026-08-28', habits: [], entries: [] })

    await habitsApi.list({ from: '2026-08-01', to: '2026-08-28' }, signal)

    expect(request).toHaveBeenCalledWith('/habits?from=2026-08-01&to=2026-08-28', { signal })
  })

  it('gets an encoded habit and creates one with CSRF and an idempotency key', async () => {
    request.mockResolvedValue(undefined)
    const signal = new AbortController().signal
    const input = {
      title: '稳定训练',
      measure: 'count' as const,
      targetValue: 3,
      timezone: 'Asia/Shanghai',
      schedule: { scheduleType: 'weekdays' as const, weekdays: [1, 3, 5], startsOn: '2026-08-01' },
    }

    await habitsApi.get('habit/with space', signal)
    await habitsApi.create(input, 'habit-create-1', 'csrf-1')

    expect(request).toHaveBeenNthCalledWith(1, '/habits/habit%2Fwith%20space', { signal })
    expect(request).toHaveBeenNthCalledWith(2, '/habits', {
      method: 'POST', body: input, csrf: 'csrf-1', idempotencyKey: 'habit-create-1',
    })
  })

  it('preserves nullable links and optimistic version data on edits', async () => {
    request.mockResolvedValue(undefined)

    await habitsApi.update('habit-1', { goalId: null, projectId: null, status: 'paused', version: 2 }, 'csrf-2')

    expect(request).toHaveBeenCalledWith('/habits/habit-1', {
      method: 'PATCH',
      body: { goalId: null, projectId: null, status: 'paused', version: 2 },
      csrf: 'csrf-2',
    })
  })

  it('uses idempotency only for first entry creation and versioning for correction', async () => {
    request.mockResolvedValue(undefined)

    await habitsApi.createEntry('habit/1', '2026-08-13', {
      status: 'done', value: 3, note: '完成',
    }, 'habit-entry-1', 'csrf-3')
    await habitsApi.correctEntry('habit/1', '2026-08-13', {
      status: 'partial', value: 2, note: '复核', version: 1,
    }, 'csrf-3')

    expect(request).toHaveBeenNthCalledWith(1, '/habits/habit%2F1/entries/2026-08-13', {
      method: 'PUT',
      body: { status: 'done', value: 3, note: '完成' },
      csrf: 'csrf-3',
      idempotencyKey: 'habit-entry-1',
    })
    expect(request).toHaveBeenNthCalledWith(2, '/habits/habit%2F1/entries/2026-08-13', {
      method: 'PUT',
      body: { status: 'partial', value: 2, note: '复核', version: 1 },
      csrf: 'csrf-3',
    })
  })
})
