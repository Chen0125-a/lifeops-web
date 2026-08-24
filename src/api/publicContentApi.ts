import type { PublicDestinationSlug } from '../content/publicDestinations'
import type { PublicRevisionView } from '../domain/publishing'
import { http } from './httpClient'

export type PublicCategory = PublicDestinationSlug

export interface PublicContentSummary {
  id: string
  slug: string
  category: PublicCategory
  title: string
  excerpt: string
  coverUrl: string | null
  publishedAt: string
  featured: boolean
  revision: number
}

export type PublicContentDetail = PublicRevisionView

export const publicContentApi = {
  list(category: PublicCategory, signal?: AbortSignal) {
    return http.request<PublicContentSummary[]>(
      `/public/content?category=${encodeURIComponent(category)}`,
      { signal },
    )
  },
  get(slug: string, signal?: AbortSignal) {
    return http.request<PublicContentDetail>(`/public/content/${encodeURIComponent(slug)}`, { signal })
  },
}
