import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { goalsApi } from '../../api/goalsApi'
import { HttpError } from '../../api/httpClient'
import { queryKeys } from '../../api/queryKeys'
import type { Goal, Milestone, Project } from '../../domain/goals'
import { useGoals } from './useGoals'

vi.mock('../../api/goalsApi', () => ({
  goalsApi: {
    list: vi.fn(),
    listProjects: vi.fn(),
    listMilestones: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    restore: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    removeProject: vi.fn(),
    restoreProject: vi.fn(),
    createMilestone: vi.fn(),
    updateMilestone: vi.fn(),
    removeMilestone: vi.fn(),
    restoreMilestone: vi.fn(),
  },
}))
vi.mock('../../state/AuthContext', () => ({
  useAuth: () => ({ csrfToken: 'csrf-goals' }),
}))

const goal: Goal = {
  id: 'goal-1',
  title: '完成 LifeOps',
  description: '交付一个能持续使用的私人系统。',
  status: 'active',
  priority: 1,
  startsOn: '2026-07-01',
  targetOn: '2026-09-30',
  progressMode: 'manual',
  manualProgress: 42,
  version: 1,
  createdAt: '2026-07-01T08:00:00.000Z',
  updatedAt: '2026-08-14T08:00:00.000Z',
  deletedAt: null,
}

const project: Project = {
  id: 'project-1',
  goalId: goal.id,
  title: 'LifeOps Web',
  description: '完成私人复杂操作黄金切片。',
  riskNote: '发布摘要仍需新鲜验证。',
  status: 'active',
  startsOn: '2026-08-01',
  targetOn: '2026-08-31',
  progress: 55,
  nextTaskId: 'task-1',
  version: 1,
  createdAt: '2026-08-01T08:00:00.000Z',
  updatedAt: '2026-08-14T08:00:00.000Z',
  deletedAt: null,
}

const milestone: Milestone = {
  id: 'milestone-1',
  projectId: project.id,
  title: '私人黄金切片',
  dueOn: '2026-08-20',
  completedAt: null,
  position: 10,
  version: 1,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function setupClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

function primeHierarchy() {
  vi.mocked(goalsApi.list).mockResolvedValue([goal])
  vi.mocked(goalsApi.listProjects).mockResolvedValue([project])
  vi.mocked(goalsApi.listMilestones).mockResolvedValue([milestone])
}

describe('useGoals', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads goals, then their projects and milestones without hiding the loading state', async () => {
    const goalsRequest = deferred<Goal[]>()
    vi.mocked(goalsApi.list).mockReturnValue(goalsRequest.promise)
    vi.mocked(goalsApi.listProjects).mockResolvedValue([project])
    vi.mocked(goalsApi.listMilestones).mockResolvedValue([milestone])
    const { wrapper } = setupClient()

    const { result } = renderHook(() => useGoals(), { wrapper })

    expect(result.current.status).toBe('loading')
    expect(goalsApi.list).toHaveBeenCalledOnce()
    goalsRequest.resolve([goal])

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.goals).toEqual([goal])
    expect(result.current.projects).toEqual([project])
    expect(result.current.milestones).toEqual([milestone])
    expect(goalsApi.listProjects).toHaveBeenCalledWith(goal.id, expect.any(AbortSignal))
    expect(goalsApi.listMilestones).toHaveBeenCalledWith(project.id, expect.any(AbortSignal))
  })

  it('optimistically applies a versioned goal update before the server resolves', async () => {
    primeHierarchy()
    const updateRequest = deferred<Goal>()
    vi.mocked(goalsApi.update).mockReturnValue(updateRequest.promise)
    const { wrapper } = setupClient()
    const { result } = renderHook(() => useGoals(), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('ready'))

    let updatePromise!: Promise<Goal>
    act(() => {
      updatePromise = result.current.updateGoal(goal.id, { title: '完成可交付 LifeOps', version: goal.version })
    })

    await waitFor(() => expect(result.current.goals[0].title).toBe('完成可交付 LifeOps'))
    expect(goalsApi.update).toHaveBeenCalledWith(goal.id, { title: '完成可交付 LifeOps', version: 1 }, 'csrf-goals')

    updateRequest.resolve({ ...goal, title: '完成可交付 LifeOps', version: 2 })
    await act(async () => { await updatePromise })
    await waitFor(() => expect(result.current.goals[0]).toMatchObject({ title: '完成可交付 LifeOps', version: 2 }))
  })

  it('rolls an optimistic update back and exposes a typed 409 conflict', async () => {
    primeHierarchy()
    vi.mocked(goalsApi.update).mockRejectedValue(new HttpError('VERSION_CONFLICT', '目标已经更新', 409, 'request-409'))
    const { wrapper } = setupClient()
    const { result } = renderHook(() => useGoals(), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => {
      await expect(result.current.updateGoal(goal.id, { title: '陈旧修改', version: goal.version }))
        .rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 })
    })

    expect(result.current.goals[0]).toEqual(goal)
    expect(result.current.status).toBe('conflict')
    expect(result.current.error).toMatchObject({ code: 'VERSION_CONFLICT', requestId: 'request-409' })
  })

  it('saves ordinary versioned milestone edits without disguising them as completion', async () => {
    primeHierarchy()
    const edited = { ...milestone, title: '可交付黄金切片', position: 20, version: 2 }
    vi.mocked(goalsApi.updateMilestone).mockResolvedValue(edited)
    const { wrapper } = setupClient()
    const { result } = renderHook(() => useGoals(), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    await act(async () => {
      await result.current.updateMilestone(milestone.id, { title: '可交付黄金切片', position: 20, version: 1 })
    })

    expect(goalsApi.updateMilestone).toHaveBeenCalledWith(milestone.id, {
      title: '可交付黄金切片',
      position: 20,
      version: 1,
    }, 'csrf-goals')
    await waitFor(() => expect(result.current.milestones[0]).toMatchObject({
      title: '可交付黄金切片',
      position: 20,
      version: 2,
    }))
  })

  it('archives and restores every hierarchy level through versioned recovery endpoints', async () => {
    primeHierarchy()
    vi.mocked(goalsApi.remove).mockResolvedValue(undefined)
    vi.mocked(goalsApi.removeProject).mockResolvedValue(undefined)
    vi.mocked(goalsApi.removeMilestone).mockResolvedValue(undefined)
    const goalsApiWithRestore = goalsApi as typeof goalsApi & {
      restore(id: string, version: number): Promise<Goal>
      restoreProject(id: string, version: number): Promise<Project>
      restoreMilestone(id: string, version: number): Promise<Milestone>
    }
    vi.mocked(goalsApiWithRestore.restore).mockResolvedValue({ ...goal, version: 3 })
    vi.mocked(goalsApiWithRestore.restoreProject).mockResolvedValue({ ...project, version: 3 })
    vi.mocked(goalsApiWithRestore.restoreMilestone).mockResolvedValue({ ...milestone, version: 3 })
    const { client, wrapper } = setupClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useGoals(), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => { await result.current.archiveGoal(goal.id, 1) })
    expect(goalsApi.remove).toHaveBeenCalledWith(goal.id, 1, 'csrf-goals')

    await act(async () => { await result.current.restoreGoal(goal.id, 2) })
    expect(goalsApiWithRestore.restore).toHaveBeenCalledWith(goal.id, 2, 'csrf-goals')
    expect(result.current.goals[0]).toMatchObject({ status: 'active', version: 3 })

    await act(async () => { await result.current.archiveProject(project.id, 1) })
    expect(goalsApi.removeProject).toHaveBeenCalledWith(project.id, 1, 'csrf-goals')
    await act(async () => { await result.current.restoreProject(project.id, 2) })
    expect(goalsApiWithRestore.restoreProject).toHaveBeenCalledWith(project.id, 2, 'csrf-goals')
    expect(result.current.projects[0]).toMatchObject({ id: project.id, version: 3 })

    await act(async () => { await result.current.archiveMilestone(milestone.id, 1) })
    expect(goalsApi.removeMilestone).toHaveBeenCalledWith(milestone.id, 1, 'csrf-goals')
    await act(async () => { await result.current.restoreMilestone(milestone.id, 2) })
    expect(goalsApiWithRestore.restoreMilestone).toHaveBeenCalledWith(milestone.id, 2, 'csrf-goals')
    expect(result.current.milestones[0]).toMatchObject({ id: milestone.id, version: 3 })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.goals.all })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.projects.all })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.milestones.all })
  })
})
