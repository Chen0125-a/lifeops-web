import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { HttpError } from '../../api/httpClient'
import { queryKeys } from '../../api/queryKeys'
import { recordsApi } from '../../api/recordsApi'
import type { CreateRecordInput, LifeRecord, RecordFilters, UpdateRecordInput } from '../../domain/records'
import { useAuth } from '../../state/AuthContext'

export type RecordsStatus = 'loading' | 'ready' | 'empty' | 'network-error' | 'forbidden' | 'conflict' | 'disconnected'

function requestKey(scope: string) {
  return `${scope}:${globalThis.crypto.randomUUID()}`
}

function typedError(error: unknown) {
  return error instanceof HttpError ? error : null
}

function errorStatus(error: HttpError | null): RecordsStatus {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'disconnected'
  if (error?.status === 401 || error?.status === 403) return 'forbidden'
  if (error?.status === 409) return 'conflict'
  return 'network-error'
}

function orderRecords(records: LifeRecord[]) {
  return [...records].sort((left, right) => (
    Number(right.pinned) - Number(left.pinned)
      || right.occurredAt.localeCompare(left.occurredAt)
      || left.id.localeCompare(right.id)
  ))
}

export function useRecords(filters: RecordFilters, enabled = true) {
  const { csrfToken } = useAuth()
  const queryClient = useQueryClient()
  const [mutationError, setMutationError] = useState<HttpError | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const queryKey = queryKeys.records.list({ ...filters })
  const query = useQuery({
    enabled,
    queryKey,
    queryFn: ({ signal }) => recordsApi.list(filters, signal),
  })
  const records = orderRecords(query.data ?? [])

  const setRecords = useCallback((update: (current: LifeRecord[]) => LifeRecord[]) => {
    queryClient.setQueryData<LifeRecord[]>(queryKey, (current) => orderRecords(update(current ?? [])))
  }, [queryClient, queryKey])

  const mutate = useCallback(async <T,>(work: () => Promise<T>) => {
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

  const create = useCallback((input: CreateRecordInput) => mutate(async () => {
    const created = await recordsApi.create(input, requestKey('record'), csrfToken)
    setRecords((current) => [...current, created])
    return created
  }), [csrfToken, mutate, setRecords])

  const update = useCallback((id: string, input: UpdateRecordInput) => mutate(async () => {
    const updated = await recordsApi.update(id, input, csrfToken)
    setRecords((current) => current.map((record) => record.id === id ? updated : record))
    return updated
  }), [csrfToken, mutate, setRecords])

  const remove = useCallback((id: string, version: number) => mutate(async () => {
    await recordsApi.remove(id, version, csrfToken)
    setRecords((current) => current.filter((record) => record.id !== id))
  }), [csrfToken, mutate, setRecords])

  const restore = useCallback((id: string, version: number) => mutate(async () => {
    const restored = await recordsApi.restore(id, version, csrfToken)
    setRecords((current) => current.some((record) => record.id === id)
      ? current.map((record) => record.id === id ? restored : record)
      : [...current, restored])
    return restored
  }), [csrfToken, mutate, setRecords])

  const queryError = typedError(query.error)
  const error = mutationError ?? queryError
  const status: RecordsStatus = !enabled
    ? 'ready'
    : query.isPending
      ? 'loading'
      : error
        ? errorStatus(error)
        : records.length
          ? 'ready'
          : 'empty'

  return {
    create,
    error,
    isSaving,
    records,
    remove,
    restore,
    status,
    update,
    retry: () => {
      setMutationError(null)
      void query.refetch()
    },
  }
}
