import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { habitsApi } from '../../api/habitsApi'
import { HttpError } from '../../api/httpClient'
import { queryKeys } from '../../api/queryKeys'
import type {
  CreateHabitEntryInput,
  CreateHabitInput,
  Habit,
  HabitEntry,
  HabitWindow,
  UpdateHabitInput,
} from '../../domain/habits'
import { useAuth } from '../../state/AuthContext'

export type HabitsStatus = 'loading' | 'ready' | 'empty' | 'network-error' | 'forbidden' | 'conflict' | 'disconnected'

export interface UseHabitsResult {
  habits: Habit[]
  entries: HabitEntry[]
  status: HabitsStatus
  error: HttpError | null
  isSaving: boolean
  createHabit(input: CreateHabitInput): Promise<Habit>
  updateHabit(id: string, input: UpdateHabitInput): Promise<Habit>
  pauseHabit(id: string, version: number): Promise<Habit>
  archiveHabit(id: string, version: number): Promise<Habit>
  upsertEntry(habitId: string, entryDate: string, input: CreateHabitEntryInput): Promise<HabitEntry>
  retry(): void
}

const emptyWindow: HabitWindow = { from: null, to: null, habits: [], entries: [] }

function idempotencyKey(scope: string) {
  return `${scope}:${globalThis.crypto.randomUUID()}`
}

function typedError(error: unknown) {
  return error instanceof HttpError ? error : null
}

function errorStatus(error: HttpError | null): HabitsStatus {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'disconnected'
  if (error?.status === 401 || error?.status === 403) return 'forbidden'
  if (error?.status === 409) return 'conflict'
  return 'network-error'
}

export function useHabits({ from, to }: { from: string; to: string }): UseHabitsResult {
  const { csrfToken } = useAuth()
  const queryClient = useQueryClient()
  const [mutationError, setMutationError] = useState<HttpError | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const queryKey = queryKeys.habits.list({ from, to })
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => habitsApi.list({ from, to }, signal),
  })
  const window = query.data ?? emptyWindow

  const setWindow = useCallback((update: (current: HabitWindow) => HabitWindow) => {
    queryClient.setQueryData<HabitWindow>(queryKey, (current) => update(current ?? emptyWindow))
  }, [queryClient, queryKey])

  const runMutation = useCallback(async <T,>(work: () => Promise<T>) => {
    setMutationError(null)
    setIsSaving(true)
    try {
      return await work()
    } catch (error) {
      setMutationError(typedError(error))
      throw error
    } finally {
      setIsSaving(false)
    }
  }, [])

  const createHabit = useCallback((input: CreateHabitInput) => runMutation(async () => {
    const created = await habitsApi.create(input, idempotencyKey('habit'), csrfToken)
    setWindow((current) => ({ ...current, habits: [...current.habits, created] }))
    return created
  }), [csrfToken, runMutation, setWindow])

  const updateHabit = useCallback((id: string, input: UpdateHabitInput) => runMutation(async () => {
    const updated = await habitsApi.update(id, input, csrfToken)
    setWindow((current) => ({
      ...current,
      habits: current.habits.map((habit) => habit.id === id ? updated : habit),
    }))
    return updated
  }), [csrfToken, runMutation, setWindow])

  const pauseHabit = useCallback((id: string, version: number) => (
    updateHabit(id, { status: 'paused', version })
  ), [updateHabit])

  const archiveHabit = useCallback((id: string, version: number) => (
    updateHabit(id, { status: 'archived', version })
  ), [updateHabit])

  const upsertEntry = useCallback((habitId: string, entryDate: string, input: CreateHabitEntryInput) => (
    runMutation(async () => {
      const currentWindow = queryClient.getQueryData<HabitWindow>(queryKey) ?? emptyWindow
      const existing = currentWindow.entries.find((entry) => entry.habitId === habitId && entry.entryDate === entryDate)
      const saved = existing
        ? await habitsApi.correctEntry(habitId, entryDate, { ...input, version: existing.version }, csrfToken)
        : await habitsApi.createEntry(habitId, entryDate, input, idempotencyKey('habit-entry'), csrfToken)
      setWindow((current) => ({
        ...current,
        entries: current.entries.some((entry) => entry.habitId === habitId && entry.entryDate === entryDate)
          ? current.entries.map((entry) => entry.habitId === habitId && entry.entryDate === entryDate ? saved : entry)
          : [...current.entries, saved],
      }))
      return saved
    })
  ), [csrfToken, queryClient, queryKey, runMutation, setWindow])

  const queryError = typedError(query.error)
  const error = mutationError ?? queryError
  const status: HabitsStatus = query.isPending
    ? 'loading'
    : queryError
      ? errorStatus(queryError)
      : window.habits.length === 0
        ? 'empty'
        : 'ready'

  return {
    habits: window.habits,
    entries: window.entries,
    status,
    error,
    isSaving,
    createHabit,
    updateHabit,
    pauseHabit,
    archiveHabit,
    upsertEntry,
    retry: () => {
      setMutationError(null)
      void query.refetch()
    },
  }
}
