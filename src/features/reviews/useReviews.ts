import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { HttpError } from '../../api/httpClient'
import { queryKeys } from '../../api/queryKeys'
import { reviewsApi } from '../../api/reviewsApi'
import type {
  ConvertReviewActionInput,
  CreateReviewInput,
  Review,
  ReviewActionConversion,
  ReviewPeriod,
  ReviewType,
  UpdateReviewInput,
} from '../../domain/reviews'
import { useAuth } from '../../state/AuthContext'

export type ReviewsStatus = 'loading' | 'ready' | 'empty' | 'network-error' | 'forbidden' | 'conflict' | 'disconnected'

function requestKey(scope: string) {
  return `${scope}:${globalThis.crypto.randomUUID()}`
}

function typedError(error: unknown) {
  return error instanceof HttpError ? error : null
}

function errorStatus(error: HttpError | null): ReviewsStatus {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'disconnected'
  if (error?.status === 401 || error?.status === 403) return 'forbidden'
  if (error?.status === 409) return 'conflict'
  return 'network-error'
}

function orderReviews(reviews: Review[]) {
  return [...reviews].sort((left, right) => (
    right.period.to.localeCompare(left.period.to)
      || right.updatedAt.localeCompare(left.updatedAt)
      || left.id.localeCompare(right.id)
  ))
}

export function useReviews() {
  const { csrfToken } = useAuth()
  const queryClient = useQueryClient()
  const [mutationError, setMutationError] = useState<HttpError | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [lastDeleted, setLastDeleted] = useState<Review | null>(null)
  const filters = useMemo(() => ({ includeArchived: true }), [])
  const queryKey = useMemo(() => queryKeys.reviews.list(filters), [filters])
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => reviewsApi.list(filters, signal),
  })
  const reviews = orderReviews(query.data ?? [])

  const setReviews = useCallback((update: (current: Review[]) => Review[]) => {
    queryClient.setQueryData<Review[]>(queryKey, (current) => orderReviews(update(current ?? [])))
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

  const createDraft = useCallback((type: ReviewType, period: ReviewPeriod) => mutate(async () => {
    const input: CreateReviewInput = { type, period }
    const created = await reviewsApi.create(input, requestKey('review'), csrfToken)
    setReviews((current) => [...current, created])
    return created
  }), [csrfToken, mutate, setReviews])

  const update = useCallback((id: string, input: UpdateReviewInput) => mutate(async () => {
    const updated = await reviewsApi.update(id, input, csrfToken)
    setReviews((current) => current.map((review) => review.id === id ? updated : review))
    return updated
  }), [csrfToken, mutate, setReviews])

  const refreshEvidence = useCallback((id: string, version: number) => mutate(async () => {
    const updated = await reviewsApi.refreshEvidence(id, version, csrfToken)
    setReviews((current) => current.map((review) => review.id === id ? updated : review))
    return updated
  }), [csrfToken, mutate, setReviews])

  const archive = useCallback((id: string, version: number) => update(id, { status: 'archived', version }), [update])

  const remove = useCallback((id: string, version: number) => mutate(async () => {
    const current = reviews.find((review) => review.id === id)
    await reviewsApi.remove(id, version, csrfToken)
    if (current) setLastDeleted({ ...current, version: version + 1, deletedAt: new Date().toISOString() })
    setReviews((items) => items.filter((review) => review.id !== id))
  }), [csrfToken, mutate, reviews, setReviews])

  const restoreLastDeleted = useCallback(() => {
    if (!lastDeleted) return Promise.resolve(undefined)
    return mutate(async () => {
      const restored = await reviewsApi.restore(lastDeleted.id, lastDeleted.version, csrfToken)
      setReviews((current) => [...current.filter((review) => review.id !== restored.id), restored])
      setLastDeleted(null)
      return restored
    })
  }, [csrfToken, lastDeleted, mutate, setReviews])

  const convertAction = useCallback((
    reviewId: string,
    actionId: string,
    input: ConvertReviewActionInput,
  ) => mutate(async (): Promise<ReviewActionConversion> => {
    const conversion = await reviewsApi.convertAction(
      reviewId,
      actionId,
      input,
      requestKey(`review-action:${reviewId}:${actionId}`),
      csrfToken,
    )
    setReviews((current) => current.map((review) => review.id === reviewId ? conversion.review : review))
    return conversion
  }), [csrfToken, mutate, setReviews])

  const queryError = typedError(query.error)
  const error = mutationError ?? queryError
  const status: ReviewsStatus = query.isPending
    ? 'loading'
    : error
      ? errorStatus(error)
      : reviews.length
        ? 'ready'
        : 'empty'

  return {
    archive,
    convertAction,
    createDraft,
    error,
    isSaving,
    lastDeleted,
    refreshEvidence,
    remove,
    restoreLastDeleted,
    reviews,
    status,
    update,
    reload: async () => {
      setMutationError(null)
      return query.refetch()
    },
    retry: () => {
      setMutationError(null)
      void query.refetch()
    },
  }
}
