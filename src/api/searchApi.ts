import { http } from './httpClient'

export const SEARCH_TYPES = [
  'goal', 'project', 'task', 'record', 'review', 'knowledge', 'public-draft',
  'life-item', 'recipe', 'medicine', 'fitness', 'household-item', 'shopping-item',
  'day-plan', 'cooking-record',
] as const

export type SearchType = typeof SEARCH_TYPES[number]

export interface SearchResult {
  type: SearchType
  id: string
  title: string
  excerpt: string
  context: string
  updatedAt: string
  route: string
}

export interface SearchQuery {
  query: string
  types?: SearchType[]
  limit?: number
}

export const searchApi = {
  search: (input: SearchQuery, signal?: AbortSignal) => {
    const query = new URLSearchParams({ q: input.query })
    if (input.types?.length) query.set('types', input.types.join(','))
    if (input.limit !== undefined) query.set('limit', String(Math.min(50, Math.max(1, Math.trunc(input.limit)))))
    return http.request<{ items: SearchResult[] }>(`/search?${query}`, { signal })
  },
}
