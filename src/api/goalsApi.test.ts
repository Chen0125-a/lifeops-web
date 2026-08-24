import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from './httpClient'
import { goalsApi } from './goalsApi'

vi.mock('./httpClient', () => ({
  http: { request: vi.fn() },
}))

const request = vi.mocked(http.request)

describe('goalsApi', () => {
  beforeEach(() => request.mockReset())

  it('lists goals with a cancellable request', async () => {
    const signal = new AbortController().signal
    request.mockResolvedValueOnce([])

    await goalsApi.list(signal)

    expect(request).toHaveBeenCalledWith('/goals', { signal })
  })

  it('creates an idempotent goal with the active CSRF token', async () => {
    request.mockResolvedValueOnce({ id: 'goal-1' })
    const input = { title: '完成 LifeOps', priority: 1 as const }

    await goalsApi.create(input, 'goal-create-1', 'csrf-1')

    expect(request).toHaveBeenCalledWith('/goals', {
      method: 'POST',
      body: input,
      csrf: 'csrf-1',
      idempotencyKey: 'goal-create-1',
    })
  })

  it('uses versioned goal update and soft-delete requests', async () => {
    request.mockResolvedValue(undefined)

    await goalsApi.update('goal/with space', { status: 'paused', version: 2 }, 'csrf-2')
    await goalsApi.remove('goal/with space', 3, 'csrf-2')

    expect(request).toHaveBeenNthCalledWith(1, '/goals/goal%2Fwith%20space', {
      method: 'PATCH',
      body: { status: 'paused', version: 2 },
      csrf: 'csrf-2',
    })
    expect(request).toHaveBeenNthCalledWith(2, '/goals/goal%2Fwith%20space', {
      method: 'DELETE',
      body: { version: 3 },
      csrf: 'csrf-2',
    })
  })

  it('covers nested project and milestone routes without dropping concurrency data', async () => {
    request.mockResolvedValue(undefined)

    await goalsApi.createProject('goal-1', { title: 'LifeOps Web' }, 'project-create-1', 'csrf-3')
    await goalsApi.updateProject('project-1', { progress: 50, version: 4 }, 'csrf-3')
    await goalsApi.createMilestone('project-1', { title: 'API 完成', position: 10 }, 'milestone-create-1', 'csrf-3')
    await goalsApi.updateMilestone('milestone-1', { completedAt: '2026-08-11T09:30:00.000Z', version: 1 }, 'csrf-3')

    expect(request).toHaveBeenNthCalledWith(1, '/goals/goal-1/projects', {
      method: 'POST',
      body: { title: 'LifeOps Web' },
      csrf: 'csrf-3',
      idempotencyKey: 'project-create-1',
    })
    expect(request).toHaveBeenNthCalledWith(2, '/projects/project-1', {
      method: 'PATCH',
      body: { progress: 50, version: 4 },
      csrf: 'csrf-3',
    })
    expect(request).toHaveBeenNthCalledWith(3, '/projects/project-1/milestones', {
      method: 'POST',
      body: { title: 'API 完成', position: 10 },
      csrf: 'csrf-3',
      idempotencyKey: 'milestone-create-1',
    })
    expect(request).toHaveBeenNthCalledWith(4, '/milestones/milestone-1', {
      method: 'PATCH',
      body: { completedAt: '2026-08-11T09:30:00.000Z', version: 1 },
      csrf: 'csrf-3',
    })
  })

  it('uses explicit versioned restore endpoints for the complete goal hierarchy', async () => {
    request.mockResolvedValue(undefined)
    const recoveryApi = goalsApi as typeof goalsApi & {
      restore(id: string, version: number, csrf: string): Promise<unknown>
      restoreProject(id: string, version: number, csrf: string): Promise<unknown>
      restoreMilestone(id: string, version: number, csrf: string): Promise<unknown>
    }

    await recoveryApi.restore('goal/with space', 2, 'csrf-4')
    await recoveryApi.restoreProject('project/with space', 4, 'csrf-4')
    await recoveryApi.restoreMilestone('milestone/with space', 6, 'csrf-4')

    expect(request).toHaveBeenNthCalledWith(1, '/goals/goal%2Fwith%20space/restore', {
      method: 'POST',
      body: { version: 2 },
      csrf: 'csrf-4',
    })
    expect(request).toHaveBeenNthCalledWith(2, '/projects/project%2Fwith%20space/restore', {
      method: 'POST',
      body: { version: 4 },
      csrf: 'csrf-4',
    })
    expect(request).toHaveBeenNthCalledWith(3, '/milestones/milestone%2Fwith%20space/restore', {
      method: 'POST',
      body: { version: 6 },
      csrf: 'csrf-4',
    })
  })
})
