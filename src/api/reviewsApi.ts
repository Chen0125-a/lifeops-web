import type {
  ConvertReviewActionInput,
  CreateReviewInput,
  Review,
  ReviewActionConversion,
  ReviewFilters,
  UpdateReviewInput,
} from '../domain/reviews'
import { http } from './httpClient'
import { queryClient } from './queryClient'
import { queryKeys } from './queryKeys'

const segment = (value: string) => encodeURIComponent(value)

function filtersQuery(filters: ReviewFilters) {
  const query = new URLSearchParams()
  if (filters.includeArchived) query.set('includeArchived', 'true')
  const value = query.toString()
  return value ? `?${value}` : ''
}

export const reviewsApi = {
  list: (filters: ReviewFilters = {}, signal?: AbortSignal) =>
    http.request<Review[]>(`/reviews${filtersQuery(filters)}`, { signal }),
  get: (id: string, signal?: AbortSignal) =>
    http.request<Review>(`/reviews/${segment(id)}`, { signal }),
  create: (input: CreateReviewInput, idempotencyKey: string, csrf?: string) =>
    http.request<Review>('/reviews', { method: 'POST', body: input, csrf, idempotencyKey }),
  update: (id: string, input: UpdateReviewInput, csrf?: string) =>
    http.request<Review>(`/reviews/${segment(id)}`, { method: 'PATCH', body: input, csrf }),
  remove: (id: string, version: number, csrf?: string) =>
    http.request<void>(`/reviews/${segment(id)}`, { method: 'DELETE', body: { version }, csrf }),
  restore: (id: string, version: number, csrf?: string) =>
    http.request<Review>(`/reviews/${segment(id)}/restore`, { method: 'POST', body: { version }, csrf }),
  refreshEvidence: (id: string, version: number, csrf?: string) =>
    http.request<Review>(`/reviews/${segment(id)}/refresh-evidence`, { method: 'POST', body: { version }, csrf }),
  convertAction: async (
    reviewId: string,
    actionId: string,
    input: ConvertReviewActionInput,
    idempotencyKey: string,
    csrf?: string,
  ) => {
    const result = await http.request<ReviewActionConversion>(
      `/reviews/${segment(reviewId)}/actions/${segment(actionId)}/convert`,
      { method: 'POST', body: input, csrf, idempotencyKey },
    )
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.reviews.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.goals.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.snapshots.all }),
    ])
    return result
  },
}
