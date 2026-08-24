import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { HttpError } from '../../api/httpClient'
import { knowledgeApi } from '../../api/knowledgeApi'
import { lifeApi } from '../../api/lifeApi'
import { publishingApi } from '../../api/publishingApi'
import { queryKeys } from '../../api/queryKeys'
import { recordsApi } from '../../api/recordsApi'
import { reviewsApi } from '../../api/reviewsApi'
import type { PublicDraft, PublicRevisionView, UpdatePublicDraftInput } from '../../domain/publishing'
import { useAuth } from '../../state/AuthContext'
import type { PublishingController, PublishingSourceItem, PublishingWorkspaceStatus } from './PublishingPage'

function statusFor(error: unknown): PublishingWorkspaceStatus {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'disconnected'
  if (error instanceof HttpError && (error.status === 401 || error.status === 403)) return 'forbidden'
  if (error instanceof HttpError && error.status === 409) return 'conflict'
  return 'network-error'
}

function sourceSlug(source: Pick<PublishingSourceItem, 'type' | 'id'>) {
  const normalized = `${source.type}-${source.id}`.normalize('NFKC').toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 96)
  return normalized || `${source.type}-${globalThis.crypto.randomUUID().slice(0, 8)}`
}

function orderDrafts(drafts: PublicDraft[]) {
  return [...drafts].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
}

export function usePublishing(): PublishingController {
  const { csrfToken } = useAuth()
  const [params, setParams] = useSearchParams()
  const queryClient = useQueryClient()
  const [mutationError, setMutationError] = useState<unknown>()
  const [isSaving, setIsSaving] = useState(false)
  const [preview, setPreview] = useState<PublicRevisionView>()
  const [diff, setDiff] = useState<PublishingController['diff']>()
  const draftListKey = queryKeys.publishing.list()

  const draftsQuery = useQuery({
    queryKey: draftListKey,
    queryFn: ({ signal }) => publishingApi.list(signal),
  })
  const sourcesQuery = useQuery({
    queryKey: [...queryKeys.publishing.all, 'sources'],
    queryFn: async ({ signal }) => {
      const [legacy, records, reviews, knowledge] = await Promise.all([
        lifeApi.state(),
        recordsApi.list({}, signal),
        reviewsApi.list({}, signal),
        knowledgeApi.list({}, signal),
      ])
      const sources: PublishingSourceItem[] = [
        ...legacy.plans.map((item) => ({ type: 'plan' as const, id: item.id, title: item.title, updatedAt: item.updatedAt })),
        ...records.filter((item) => item.deletedAt == null).map((item) => ({ type: 'record' as const, id: item.id, title: item.title, updatedAt: item.updatedAt })),
        ...reviews.filter((item) => item.deletedAt == null).map((item) => ({
          type: 'review' as const,
          id: item.id,
          title: `${item.period.from} 至 ${item.period.to} 回顾`,
          updatedAt: item.updatedAt,
        })),
        ...knowledge.items.filter((item) => item.deletedAt == null).map((item) => ({ type: 'knowledge' as const, id: item.id, title: item.title, updatedAt: item.updatedAt })),
      ]
      return sources.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
    },
  })

  const drafts = useMemo(() => orderDrafts(draftsQuery.data ?? []), [draftsQuery.data])
  const requestedId = params.get('draft') ?? undefined
  const selected = drafts.find((draft) => draft.id === requestedId) ?? drafts[0]
  const revisionsQuery = useQuery({
    enabled: Boolean(selected?.id),
    queryKey: [...queryKeys.publishing.detail(selected?.id ?? 'none'), 'revisions'],
    queryFn: ({ signal }) => selected ? publishingApi.revisions(selected.id, signal) : Promise.resolve([]),
  })

  useEffect(() => {
    setPreview(undefined)
    setDiff(undefined)
  }, [selected?.id, selected?.version])

  const select = useCallback((id?: string) => {
    const next = new URLSearchParams(params)
    if (id) next.set('draft', id)
    else next.delete('draft')
    setParams(next, { replace: false })
  }, [params, setParams])

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.publishing.all }),
      draftsQuery.refetch(),
    ])
  }, [draftsQuery, queryClient])

  const mutate = useCallback(async <T,>(work: () => Promise<T>) => {
    setMutationError(undefined)
    setIsSaving(true)
    try {
      return await work()
    } catch (error) {
      setMutationError(error)
      throw error
    } finally {
      setIsSaving(false)
    }
  }, [])

  const createStandalone = useCallback(() => mutate(async () => {
    const created = await publishingApi.create({
      category: 'now',
      title: '未命名公开草稿',
      excerpt: '请在发布前完成公开摘要。',
      body: '请在发布前完成公开正文。',
      coverUrl: null,
      tags: [],
      slug: `draft-${globalThis.crypto.randomUUID().slice(0, 8)}`,
      featured: false,
      seo: { title: '未命名公开草稿', description: '请在发布前完成公开摘要。' },
      source: null,
    }, csrfToken)
    queryClient.setQueryData<PublicDraft[]>(draftListKey, (current = []) => orderDrafts(
      current.some((draft) => draft.id === created.id)
        ? current.map((draft) => draft.id === created.id ? created : draft)
        : [...current, created],
    ))
    select(created.id)
    return created
  }), [csrfToken, draftListKey, mutate, queryClient, select])

  const createFromSource = useCallback((source: Pick<PublishingSourceItem, 'type' | 'id'>) => mutate(async () => {
    const created = await publishingApi.create({ category: 'now', slug: sourceSlug(source), source }, csrfToken)
    queryClient.setQueryData<PublicDraft[]>(draftListKey, (current = []) => orderDrafts(
      current.some((draft) => draft.id === created.id)
        ? current.map((draft) => draft.id === created.id ? created : draft)
        : [...current, created],
    ))
    select(created.id)
    return created
  }), [csrfToken, draftListKey, mutate, queryClient, select])

  const update = useCallback((id: string, input: UpdatePublicDraftInput) => mutate(async () => {
    const updated = await publishingApi.update(id, input, csrfToken)
    queryClient.setQueryData<PublicDraft[]>(draftListKey, (current = []) => orderDrafts(current.map((draft) => draft.id === id ? updated : draft)))
    return updated
  }), [csrfToken, draftListKey, mutate, queryClient])

  const previewDraft = useCallback((id: string) => mutate(async () => {
    const value = await publishingApi.preview(id, csrfToken)
    setPreview(value)
    return value
  }), [csrfToken, mutate])

  const publish = useCallback((id: string, version: number) => mutate(async () => {
    await publishingApi.publish(id, version, csrfToken)
    await refresh()
  }), [csrfToken, mutate, refresh])

  const schedule = useCallback((id: string, version: number, scheduledAt: string) => mutate(async () => {
    await publishingApi.schedule(id, version, scheduledAt, csrfToken)
    await refresh()
  }), [csrfToken, mutate, refresh])

  const revoke = useCallback((id: string, version: number) => mutate(async () => {
    await publishingApi.revoke(id, version, csrfToken)
    await refresh()
  }), [csrfToken, mutate, refresh])

  const loadDiff = useCallback((id: string, from: number, to: number) => mutate(async () => {
    setDiff(await publishingApi.diff(id, from, to))
  }), [mutate])

  const pending = draftsQuery.isPending || sourcesQuery.isPending
  const error = mutationError ?? draftsQuery.error ?? sourcesQuery.error ?? revisionsQuery.error
  const status: PublishingWorkspaceStatus = pending
    ? 'loading'
    : error
      ? statusFor(error)
      : drafts.length || sourcesQuery.data?.length
        ? 'ready'
        : 'empty'

  return {
    status,
    drafts,
    sources: sourcesQuery.data ?? [],
    selected,
    preview,
    revisions: revisionsQuery.data ?? [],
    diff,
    isSaving,
    createStandalone,
    createFromSource,
    select,
    update,
    previewDraft,
    publish,
    schedule,
    revoke,
    loadDiff,
    retry: () => {
      setMutationError(undefined)
      void Promise.all([draftsQuery.refetch(), sourcesQuery.refetch(), revisionsQuery.refetch()])
    },
  }
}
