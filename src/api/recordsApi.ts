import type { CreateRecordInput, LifeRecord, RecordFilters, UpdateRecordInput } from '../domain/records'
import { http } from './httpClient'

const segment = (value: string) => encodeURIComponent(value)

function filtersQuery(filters: RecordFilters) {
  const query = new URLSearchParams()
  if (filters.from) query.set('from', filters.from)
  if (filters.to) query.set('to', filters.to)
  if (filters.tag) query.set('tag', filters.tag)
  if (filters.linkType) query.set('linkType', filters.linkType)
  if (filters.linkId) query.set('linkId', filters.linkId)
  if (filters.q) query.set('q', filters.q)
  if (filters.includeArchived) query.set('includeArchived', 'true')
  const value = query.toString()
  return value ? `?${value}` : ''
}

export const recordsApi = {
  list: (filters: RecordFilters = {}, signal?: AbortSignal) =>
    http.request<LifeRecord[]>(`/records${filtersQuery(filters)}`, { signal }),
  get: (id: string, signal?: AbortSignal) =>
    http.request<LifeRecord>(`/records/${segment(id)}`, { signal }),
  create: (input: CreateRecordInput, idempotencyKey: string, csrf?: string) =>
    http.request<LifeRecord>('/records', { method: 'POST', body: input, csrf, idempotencyKey }),
  update: (id: string, input: UpdateRecordInput, csrf?: string) =>
    http.request<LifeRecord>(`/records/${segment(id)}`, { method: 'PATCH', body: input, csrf }),
  remove: (id: string, version: number, csrf?: string) =>
    http.request<void>(`/records/${segment(id)}`, { method: 'DELETE', body: { version }, csrf }),
  restore: (id: string, version: number, csrf?: string) =>
    http.request<LifeRecord>(`/records/${segment(id)}/restore`, { method: 'POST', body: { version }, csrf }),
}
