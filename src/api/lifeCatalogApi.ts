import type {
  CatalogBatchInput,
  CatalogDeleteImpact,
  CatalogFilters,
  CatalogItem,
  CreateCatalogItemInput,
  CreateTaxonomyInput,
  CreateUnitInput,
  LifeUnit,
  TaxonomyEntity,
  TaxonomyKind,
  UpdateCatalogItemInput,
  UpdateTaxonomyInput,
  UpdateUnitInput,
} from '../domain/lifeCatalog'
import { http } from './httpClient'
import { queryClient } from './queryClient'
import { queryKeys } from './queryKeys'

const segment = (value: string) => encodeURIComponent(value)
const taxonomyPath: Record<TaxonomyKind, 'categories' | 'tags' | 'locations'> = {
  category: 'categories',
  tag: 'tags',
  location: 'locations',
}

function filtersQuery(filters: CatalogFilters) {
  const query = new URLSearchParams()
  if (filters.kind) query.set('kind', filters.kind)
  if (filters.q?.trim()) query.set('q', filters.q.trim())
  const value = query.toString()
  return value ? `?${value}` : ''
}

async function invalidate(keys: ReadonlyArray<readonly unknown[]>) {
  await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
}

async function itemMutation<T>(request: Promise<T>, includeTrash = false) {
  const result = await request
  await invalidate([
    queryKeys.lifeCatalog.all,
    ...(includeTrash ? [queryKeys.lifeTrash.all] : []),
  ])
  return result
}

async function taxonomyMutation<T>(request: Promise<T>) {
  const result = await request
  await invalidate([queryKeys.lifeTaxonomy.all, queryKeys.lifeCatalog.all])
  return result
}

async function unitMutation<T>(request: Promise<T>) {
  const result = await request
  await invalidate([queryKeys.lifeUnits.all, queryKeys.lifeCatalog.all])
  return result
}

export const lifeCatalogApi = {
  list: (filters: CatalogFilters = {}, signal?: AbortSignal) =>
    http.request<CatalogItem[]>(`/life/catalog${filtersQuery(filters)}`, { signal }),
  get: (id: string, signal?: AbortSignal) =>
    http.request<CatalogItem>(`/life/catalog/${segment(id)}`, { signal }),
  create: (input: CreateCatalogItemInput, idempotencyKey: string, csrf?: string) => itemMutation(
    http.request<CatalogItem>('/life/catalog', { method: 'POST', body: input, csrf, idempotencyKey }),
  ),
  update: (id: string, input: UpdateCatalogItemInput, csrf?: string) => itemMutation(
    http.request<CatalogItem>(`/life/catalog/${segment(id)}`, { method: 'PATCH', body: input, csrf }),
  ),
  batchUpdate: (input: CatalogBatchInput, csrf?: string) => itemMutation(
    http.request<CatalogItem[]>('/life/catalog/batch', { method: 'POST', body: input, csrf }),
  ),
  deleteImpact: (id: string, signal?: AbortSignal) =>
    http.request<CatalogDeleteImpact>(`/life/catalog/${segment(id)}/delete-impact`, { signal }),
  remove: (id: string, version: number, csrf?: string) => itemMutation(
    http.request<void>(`/life/catalog/${segment(id)}`, { method: 'DELETE', body: { version }, csrf }), true,
  ),
  listTrash: (signal?: AbortSignal) =>
    http.request<CatalogItem[]>('/life/trash/catalog', { signal }),
  restore: (id: string, version: number, csrf?: string) => itemMutation(
    http.request<CatalogItem>(`/life/trash/catalog/${segment(id)}/restore`, { method: 'POST', body: { version }, csrf }), true,
  ),
  listTaxonomy: (kind: TaxonomyKind, signal?: AbortSignal) =>
    http.request<TaxonomyEntity[]>(`/life/taxonomy/${taxonomyPath[kind]}`, { signal }),
  createTaxonomy: (kind: TaxonomyKind, input: CreateTaxonomyInput, csrf?: string) => taxonomyMutation(
    http.request<TaxonomyEntity>(`/life/taxonomy/${taxonomyPath[kind]}`, { method: 'POST', body: input, csrf }),
  ),
  updateTaxonomy: (kind: TaxonomyKind, id: string, input: UpdateTaxonomyInput, csrf?: string) => taxonomyMutation(
    http.request<TaxonomyEntity>(`/life/taxonomy/${taxonomyPath[kind]}/${segment(id)}`, { method: 'PATCH', body: input, csrf }),
  ),
  removeTaxonomy: (kind: TaxonomyKind, id: string, version: number, csrf?: string) => taxonomyMutation(
    http.request<void>(`/life/taxonomy/${taxonomyPath[kind]}/${segment(id)}`, { method: 'DELETE', body: { version }, csrf }),
  ),
  restoreTaxonomy: (kind: TaxonomyKind, id: string, version: number, csrf?: string) => taxonomyMutation(
    http.request<TaxonomyEntity>(`/life/trash/${taxonomyPath[kind]}/${segment(id)}/restore`, { method: 'POST', body: { version }, csrf }),
  ),
  listUnits: (signal?: AbortSignal) => http.request<LifeUnit[]>('/life/units', { signal }),
  createUnit: (input: CreateUnitInput, csrf?: string) => unitMutation(
    http.request<LifeUnit>('/life/units', { method: 'POST', body: input, csrf }),
  ),
  updateUnit: (id: string, input: UpdateUnitInput, csrf?: string) => unitMutation(
    http.request<LifeUnit>(`/life/units/${segment(id)}`, { method: 'PATCH', body: input, csrf }),
  ),
  removeUnit: (id: string, version: number, csrf?: string) => unitMutation(
    http.request<void>(`/life/units/${segment(id)}`, { method: 'DELETE', body: { version }, csrf }),
  ),
  restoreUnit: (id: string, version: number, csrf?: string) => unitMutation(
    http.request<LifeUnit>(`/life/trash/units/${segment(id)}/restore`, { method: 'POST', body: { version }, csrf }),
  ),
}
