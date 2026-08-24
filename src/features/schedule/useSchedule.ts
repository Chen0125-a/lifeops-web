import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { tasksApi } from '../../api/tasksApi'
import { HttpError } from '../../api/httpClient'
import { queryKeys } from '../../api/queryKeys'
import type { CreateTaskInput, ScheduleBlock, ScheduleConflict, Task, UpdateTaskInput } from '../../domain/tasks'
import { useAuth } from '../../state/AuthContext'

export type ScheduleStatus = 'loading' | 'ready' | 'empty' | 'network-error' | 'forbidden' | 'conflict' | 'disconnected'

export interface ScheduleUndoToken {
  token: string
  taskId: string
  previous: ScheduleBlock | null
  current: ScheduleBlock
  version: number
}

export interface UseScheduleResult {
  tasks: Task[]
  blocks: ScheduleBlock[]
  conflicts: ScheduleConflict[]
  status: ScheduleStatus
  error: HttpError | null
  isSaving: boolean
  scheduleTask(taskId: string, startsAt: string, endsAt: string, version: number): Promise<ScheduleUndoToken>
  undoSchedule(token: ScheduleUndoToken): Promise<void>
  createTask(input: CreateTaskInput, checklist?: string[]): Promise<Task>
  updateTask(id: string, input: UpdateTaskInput, checklist?: string[]): Promise<Task>
  retry(): void
}

interface ScheduleFilters {
  from?: string
  to?: string
}

function idempotencyKey(scope: string) {
  return `${scope}:${globalThis.crypto.randomUUID()}`
}

function typedError(error: unknown) {
  return error instanceof HttpError ? error : null
}

function errorStatus(error: HttpError | null): ScheduleStatus {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'disconnected'
  if (error?.status === 401 || error?.status === 403) return 'forbidden'
  if (error?.status === 409) return 'conflict'
  return 'network-error'
}

export function useSchedule(filters: ScheduleFilters = {}): UseScheduleResult {
  const { csrfToken } = useAuth()
  const queryClient = useQueryClient()
  const [mutationError, setMutationError] = useState<HttpError | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const scheduleKey = useMemo(() => queryKeys.schedule.list({ from: filters.from, to: filters.to }), [filters.from, filters.to])
  const taskQuery = useQuery({ queryKey: queryKeys.tasks.lists, queryFn: ({ signal }) => tasksApi.list(signal) })
  const blockQuery = useQuery({
    queryKey: scheduleKey,
    queryFn: ({ signal }) => tasksApi.listScheduleBlocks(filters, signal),
  })
  const conflictQuery = useQuery({
    queryKey: [...scheduleKey, 'conflicts'],
    queryFn: ({ signal }) => filters.from && filters.to ? tasksApi.conflicts(filters.from, filters.to, signal) : Promise.resolve([]),
  })
  const tasks = taskQuery.data ?? []
  const blocks = blockQuery.data ?? []
  const conflicts = conflictQuery.data ?? []

  const captureFailure = useCallback((error: unknown) => {
    const typed = typedError(error)
    setMutationError(typed ?? new HttpError('UNKNOWN_ERROR', '操作没有完成，请重试', 0))
  }, [])

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.schedule.all }),
    ])
  }, [queryClient])

  const scheduleTask = useCallback(async (taskId: string, startsAt: string, endsAt: string, version: number) => {
    setMutationError(null)
    setIsSaving(true)
    const previous = blocks.find((block) => block.taskId === taskId) ?? null
    try {
      const current = previous
        ? await tasksApi.updateScheduleBlock(previous.id, { startsAt, endsAt, version: previous.version }, csrfToken)
        : await tasksApi.createScheduleBlock({ taskId, startsAt, endsAt }, idempotencyKey('schedule'), csrfToken)
      queryClient.setQueryData<ScheduleBlock[]>(scheduleKey, (existing = []) => previous
        ? existing.map((block) => block.id === current.id ? current : block)
        : [...existing, current])
      await queryClient.invalidateQueries({ queryKey: [...scheduleKey, 'conflicts'] })
      return { token: globalThis.crypto.randomUUID(), taskId, previous, current, version }
    } catch (error) {
      captureFailure(error)
      throw error
    } finally {
      setIsSaving(false)
    }
  }, [blocks, captureFailure, csrfToken, queryClient, scheduleKey])

  const undoSchedule = useCallback(async (token: ScheduleUndoToken) => {
    setMutationError(null)
    setIsSaving(true)
    try {
      if (token.previous) {
        await tasksApi.updateScheduleBlock(token.current.id, {
          startsAt: token.previous.startsAt,
          endsAt: token.previous.endsAt,
          version: token.current.version,
        }, csrfToken)
      } else {
        await tasksApi.removeScheduleBlock(token.current.id, token.current.version, csrfToken)
      }
      await refresh()
    } catch (error) {
      captureFailure(error)
      throw error
    } finally {
      setIsSaving(false)
    }
  }, [captureFailure, csrfToken, refresh])

  const createTask = useCallback(async (input: CreateTaskInput, checklist: string[] = []) => {
    setMutationError(null)
    setIsSaving(true)
    try {
      const created = await tasksApi.create(input, idempotencyKey('task'), csrfToken)
      for (const [position, title] of checklist.entries()) {
        await tasksApi.addChecklistItem(created.id, { title, position: (position + 1) * 10 }, idempotencyKey('checklist'), csrfToken)
      }
      await refresh()
      return created
    } catch (error) {
      captureFailure(error)
      throw error
    } finally {
      setIsSaving(false)
    }
  }, [captureFailure, csrfToken, refresh])

  const updateTask = useCallback(async (id: string, input: UpdateTaskInput, checklist: string[] = []) => {
    setMutationError(null)
    setIsSaving(true)
    try {
      const current = tasks.find((task) => task.id === id)
      const updated = await tasksApi.update(id, input, csrfToken)
      if (current) {
        for (const [position, title] of checklist.entries()) {
          const item = current.checklist[position]
          if (item && item.title !== title) {
            await tasksApi.updateChecklistItem(id, item.id, { title, position: (position + 1) * 10, version: item.version }, csrfToken)
          } else if (!item) {
            await tasksApi.addChecklistItem(id, { title, position: (position + 1) * 10 }, idempotencyKey('checklist'), csrfToken)
          }
        }
        for (const item of current.checklist.slice(checklist.length)) {
          await tasksApi.removeChecklistItem(id, item.id, item.version, csrfToken)
        }
      }
      await refresh()
      return updated
    } catch (error) {
      captureFailure(error)
      throw error
    } finally {
      setIsSaving(false)
    }
  }, [captureFailure, csrfToken, refresh, tasks])

  const queryError = typedError(taskQuery.error ?? blockQuery.error ?? conflictQuery.error)
  const error = mutationError ?? queryError
  const pending = taskQuery.isPending || blockQuery.isPending || conflictQuery.isPending
  const status: ScheduleStatus = pending
    ? 'loading'
    : error
      ? errorStatus(error)
      : tasks.length === 0
        ? 'empty'
        : 'ready'

  return {
    tasks,
    blocks,
    conflicts,
    status,
    error,
    isSaving,
    scheduleTask,
    undoSchedule,
    createTask,
    updateTask,
    retry: () => {
      setMutationError(null)
      void Promise.all([taskQuery.refetch(), blockQuery.refetch(), conflictQuery.refetch()])
    },
  }
}
