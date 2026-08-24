import type {
  CreateKnowledgeCollectionInput,
  CreateKnowledgeInput,
  KnowledgeCollection,
  KnowledgeFilters,
  KnowledgeNote,
  UpdateKnowledgeCollectionInput,
  UpdateKnowledgeInput,
} from '../domain/knowledge'
import { http } from './httpClient'
import { queryClient } from './queryClient'
import { queryKeys } from './queryKeys'

const segment = (value: string) => encodeURIComponent(value)

function filtersQuery(filters: KnowledgeFilters) {
  const query = new URLSearchParams()
  if (filters.q) query.set('q', filters.q)
  if (filters.tag) query.set('tag', filters.tag)
  if (filters.source) query.set('source', filters.source)
  if (filters.collectionId) query.set('collectionId', filters.collectionId)
  if (filters.includeArchived) query.set('includeArchived', 'true')
  if (filters.includeDeleted) query.set('includeDeleted', 'true')
  const value = query.toString()
  return value ? `?${value}` : ''
}

async function mutate<T>(request: Promise<T>) {
  const result = await request
  await queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.all })
  return result
}

export const knowledgeApi = {
  list: (filters: KnowledgeFilters = {}, signal?: AbortSignal) =>
    http.request<{ items: KnowledgeNote[] }>(`/knowledge${filtersQuery(filters)}`, { signal }),
  get: (id: string, signal?: AbortSignal) =>
    http.request<KnowledgeNote>(`/knowledge/${segment(id)}`, { signal }),
  resurface: (signal?: AbortSignal) =>
    http.request<KnowledgeNote[]>('/knowledge/resurface', { signal }),
  create: (input: CreateKnowledgeInput, csrf?: string, idempotencyKey?: string) =>
    mutate(http.request<KnowledgeNote>('/knowledge', { method: 'POST', body: input, csrf, idempotencyKey })),
  update: (id: string, input: UpdateKnowledgeInput, csrf?: string) =>
    mutate(http.request<KnowledgeNote>(`/knowledge/${segment(id)}`, { method: 'PATCH', body: input, csrf })),
  archive: (id: string, version: number, csrf?: string) =>
    mutate(http.request<KnowledgeNote>(`/knowledge/${segment(id)}/archive`, { method: 'POST', body: { version }, csrf })),
  remove: (id: string, version: number, csrf?: string) =>
    mutate(http.request<void>(`/knowledge/${segment(id)}`, { method: 'DELETE', body: { version }, csrf })),
  restore: (id: string, version: number, csrf?: string) =>
    mutate(http.request<KnowledgeNote>(`/knowledge/${segment(id)}/restore`, { method: 'POST', body: { version }, csrf })),
  addRelation: (id: string, relatedId: string, version: number, csrf?: string) =>
    mutate(http.request<KnowledgeNote>(`/knowledge/${segment(id)}/relations`, { method: 'POST', body: { relatedId, version }, csrf })),
  removeRelation: (id: string, relatedId: string, version: number, csrf?: string) =>
    mutate(http.request<KnowledgeNote>(`/knowledge/${segment(id)}/relations`, { method: 'DELETE', body: { relatedId, version }, csrf })),
  listCollections: (signal?: AbortSignal) =>
    http.request<KnowledgeCollection[]>('/knowledge/collections', { signal }),
  createCollection: (input: CreateKnowledgeCollectionInput, csrf?: string) =>
    mutate(http.request<KnowledgeCollection>('/knowledge/collections', { method: 'POST', body: input, csrf })),
  updateCollection: (id: string, input: UpdateKnowledgeCollectionInput, csrf?: string) =>
    mutate(http.request<KnowledgeCollection>(`/knowledge/collections/${segment(id)}`, { method: 'PATCH', body: input, csrf })),
  removeCollection: (id: string, version: number, csrf?: string) =>
    mutate(http.request<void>(`/knowledge/collections/${segment(id)}`, { method: 'DELETE', body: { version }, csrf })),
}
