import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { HttpError } from '../../api/httpClient'
import { knowledgeApi } from '../../api/knowledgeApi'
import { queryKeys } from '../../api/queryKeys'
import type {
  CreateKnowledgeInput,
  KnowledgeFilters,
  KnowledgeNote,
  UpdateKnowledgeInput,
} from '../../domain/knowledge'
import { useAuth } from '../../state/AuthContext'

export type KnowledgeStatus = 'loading' | 'ready' | 'empty' | 'network-error' | 'forbidden' | 'conflict' | 'disconnected'

function typedError(error: unknown) {
  return error instanceof HttpError ? error : null
}

function statusFor(error: HttpError | null): KnowledgeStatus {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'disconnected'
  if (error?.status === 401 || error?.status === 403) return 'forbidden'
  if (error?.status === 409) return 'conflict'
  return 'network-error'
}

function requestKey(scope: string) {
  return `${scope}:${globalThis.crypto.randomUUID()}`
}

function orderNotes(notes: KnowledgeNote[]) {
  return [...notes].sort((left, right) => (
    Number(right.pinned) - Number(left.pinned)
      || Number(right.favorite) - Number(left.favorite)
      || right.updatedAt.localeCompare(left.updatedAt)
      || left.id.localeCompare(right.id)
  ))
}

export function useKnowledge(filters: KnowledgeFilters) {
  const { csrfToken } = useAuth()
  const queryClient = useQueryClient()
  const [mutationError, setMutationError] = useState<HttpError | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const listKey = queryKeys.knowledge.list({ ...filters })
  const listQuery = useQuery({
    queryKey: listKey,
    queryFn: ({ signal }) => knowledgeApi.list(filters, signal),
  })
  const collectionsQuery = useQuery({
    queryKey: [...queryKeys.knowledge.all, 'collections'],
    queryFn: ({ signal }) => knowledgeApi.listCollections(signal),
  })
  const resurfacedQuery = useQuery({
    queryKey: [...queryKeys.knowledge.all, 'resurface'],
    queryFn: ({ signal }) => knowledgeApi.resurface(signal),
  })
  const notes = orderNotes(listQuery.data?.items ?? [])

  const setNotes = useCallback((update: (current: KnowledgeNote[]) => KnowledgeNote[]) => {
    queryClient.setQueryData<{ items: KnowledgeNote[] }>(listKey, (current) => ({
      items: orderNotes(update(current?.items ?? [])),
    }))
  }, [listKey, queryClient])

  const mutate = useCallback(async <T,>(work: () => Promise<T>, surfaceError = true) => {
    if (surfaceError) setMutationError(null)
    setIsSaving(true)
    try {
      return await work()
    } catch (error) {
      if (surfaceError) setMutationError(typedError(error))
      throw error
    } finally {
      setIsSaving(false)
    }
  }, [])

  const create = useCallback((input: CreateKnowledgeInput) => mutate(async () => {
    const created = await knowledgeApi.create(input, csrfToken)
    setNotes((current) => current.some((note) => note.id === created.id)
      ? current.map((note) => note.id === created.id ? created : note)
      : [...current, created])
    return created
  }), [csrfToken, mutate, setNotes])

  const update = useCallback((id: string, input: UpdateKnowledgeInput, surfaceError = true) => mutate(async () => {
    const updated = await knowledgeApi.update(id, input, csrfToken)
    setNotes((current) => current.map((note) => note.id === id ? updated : note))
    return updated
  }, surfaceError), [csrfToken, mutate, setNotes])

  const archive = useCallback((id: string, version: number) => mutate(async () => {
    const updated = await knowledgeApi.archive(id, version, csrfToken)
    setNotes((current) => current.map((note) => note.id === id ? updated : note))
    return updated
  }), [csrfToken, mutate, setNotes])

  const remove = useCallback((id: string, version: number) => mutate(async () => {
    await knowledgeApi.remove(id, version, csrfToken)
    setNotes((current) => current.filter((note) => note.id !== id))
  }), [csrfToken, mutate, setNotes])

  const restore = useCallback((id: string, version: number) => mutate(async () => {
    const restored = await knowledgeApi.restore(id, version, csrfToken)
    setNotes((current) => current.some((note) => note.id === id)
      ? current.map((note) => note.id === id ? restored : note)
      : [...current, restored])
    return restored
  }), [csrfToken, mutate, setNotes])

  const addRelation = useCallback((id: string, relatedId: string, version: number) => mutate(async () => {
    const updated = await knowledgeApi.addRelation(id, relatedId, version, csrfToken)
    setNotes((current) => current.map((note) => note.id === id ? updated : note))
    return updated
  }), [csrfToken, mutate, setNotes])

  const removeRelation = useCallback((id: string, relatedId: string, version: number) => mutate(async () => {
    const updated = await knowledgeApi.removeRelation(id, relatedId, version, csrfToken)
    setNotes((current) => current.map((note) => note.id === id ? updated : note))
    return updated
  }), [csrfToken, mutate, setNotes])

  const queryError = typedError(listQuery.error ?? collectionsQuery.error ?? resurfacedQuery.error)
  const error = mutationError ?? queryError
  const pending = listQuery.isPending || collectionsQuery.isPending || resurfacedQuery.isPending
  const status: KnowledgeStatus = pending
    ? 'loading'
    : error
      ? statusFor(error)
      : notes.length
        ? 'ready'
        : 'empty'

  return {
    addRelation,
    archive,
    collections: collectionsQuery.data ?? [],
    create,
    error,
    isSaving,
    notes,
    remove,
    removeRelation,
    resurfaced: resurfacedQuery.data ?? [],
    restore,
    status,
    update,
    retry: () => {
      setMutationError(null)
      void Promise.all([listQuery.refetch(), collectionsQuery.refetch(), resurfacedQuery.refetch()])
    },
  }
}
