import type {
  CreatePublicDraftInput,
  PublicationResult,
  PublicDraft,
  PublicRevision,
  PublicRevisionDiff,
  PublicRevisionView,
  UpdatePublicDraftInput,
} from '../domain/publishing'
import { http } from './httpClient'
import { queryClient } from './queryClient'
import { queryKeys } from './queryKeys'

const segment = (value: string) => encodeURIComponent(value)
const path = (id: string) => `/publishing/drafts/${segment(id)}`

async function mutate<T>(request: Promise<T>) {
  const result = await request
  await queryClient.invalidateQueries({ queryKey: queryKeys.publishing.all })
  return result
}

export const publishingApi = {
  list: (signal?: AbortSignal) => http.request<PublicDraft[]>('/publishing/drafts', { signal }),
  get: (id: string, signal?: AbortSignal) => http.request<PublicDraft>(path(id), { signal }),
  create: (input: CreatePublicDraftInput, csrf?: string) =>
    mutate(http.request<PublicDraft>('/publishing/drafts', { method: 'POST', body: input, csrf })),
  update: (id: string, input: UpdatePublicDraftInput, csrf?: string) =>
    mutate(http.request<PublicDraft>(path(id), { method: 'PATCH', body: input, csrf })),
  remove: (id: string, version: number, csrf?: string) =>
    mutate(http.request<void>(path(id), { method: 'DELETE', body: { version }, csrf })),
  preview: (id: string, csrf?: string) =>
    http.request<PublicRevisionView>(`${path(id)}/preview`, { method: 'POST', csrf }),
  publish: (id: string, version: number, csrf?: string) =>
    mutate(http.request<PublicationResult>(`${path(id)}/publish`, { method: 'POST', body: { version }, csrf })),
  schedule: (id: string, version: number, scheduledAt: string, csrf?: string) =>
    mutate(http.request<PublicDraft>(`${path(id)}/schedule`, { method: 'POST', body: { version, scheduledAt }, csrf })),
  revoke: (id: string, version: number, csrf?: string) =>
    mutate(http.request<PublicDraft>(`${path(id)}/revoke`, { method: 'POST', body: { version }, csrf })),
  revisions: (id: string, signal?: AbortSignal) => http.request<PublicRevision[]>(`${path(id)}/revisions`, { signal }),
  diff: (id: string, from: number, to: number, signal?: AbortSignal) =>
    http.request<PublicRevisionDiff>(`${path(id)}/revisions/diff?from=${from}&to=${to}`, { signal }),
}
