import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { CatalogItem, CreateCatalogItemInput } from '../domain/lifeCatalog'
import { http } from './httpClient'
import { lifeCatalogApi } from './lifeCatalogApi'
import { queryClient } from './queryClient'
import { queryKeys } from './queryKeys'

vi.mock('./httpClient', () => ({ http: { request: vi.fn() } }))
vi.mock('./queryClient', () => ({ queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) } }))

const request = vi.mocked(http.request)
const invalidateQueries = vi.mocked(queryClient.invalidateQueries)

describe('lifeCatalogApi', () => {
  beforeEach(() => {
    request.mockReset()
    request.mockResolvedValue(undefined)
    invalidateQueries.mockClear()
  })

  it('reads cancellable catalog filters, encoded details, impact, taxonomy, units and trash', async () => {
    const signal = new AbortController().signal
    await lifeCatalogApi.list({ kind: 'ingredient', q: 'egg & milk' }, signal)
    await lifeCatalogApi.get('item/with space', signal)
    await lifeCatalogApi.deleteImpact('item/with space', signal)
    await lifeCatalogApi.listTaxonomy('category', signal)
    await lifeCatalogApi.listUnits(signal)
    await lifeCatalogApi.listTrash(signal)
    expect(request.mock.calls.map(([path, options]) => [path, options])).toEqual([
      ['/life/catalog?kind=ingredient&q=egg+%26+milk', { signal }],
      ['/life/catalog/item%2Fwith%20space', { signal }],
      ['/life/catalog/item%2Fwith%20space/delete-impact', { signal }],
      ['/life/taxonomy/categories', { signal }],
      ['/life/units', { signal }],
      ['/life/trash/catalog', { signal }],
    ])
  })

  it('preserves idempotency, CSRF, optimistic versions and encoded item paths', async () => {
    const create = { kind: 'ingredient' as const, name: 'Egg', baseUnit: 'gram' }
    const batch = {
      items: [{ id: 'item/1', version: 2 }],
      patch: { categoryId: 'category/2', addTagIds: ['tag/3'] },
    }
    await lifeCatalogApi.create(create, 'catalog-create-1', 'csrf-1')
    await lifeCatalogApi.update('item/1', { name: 'Egg large', version: 1 }, 'csrf-1')
    await lifeCatalogApi.batchUpdate(batch, 'csrf-1')
    await lifeCatalogApi.remove('item/1', 3, 'csrf-1')
    await lifeCatalogApi.restore('item/1', 4, 'csrf-1')
    expect(request).toHaveBeenNthCalledWith(1, '/life/catalog', {
      method: 'POST', body: create, csrf: 'csrf-1', idempotencyKey: 'catalog-create-1',
    })
    expect(request).toHaveBeenNthCalledWith(2, '/life/catalog/item%2F1', {
      method: 'PATCH', body: { name: 'Egg large', version: 1 }, csrf: 'csrf-1',
    })
    expect(request).toHaveBeenNthCalledWith(3, '/life/catalog/batch', { method: 'POST', body: batch, csrf: 'csrf-1' })
    expect(request).toHaveBeenNthCalledWith(4, '/life/catalog/item%2F1', { method: 'DELETE', body: { version: 3 }, csrf: 'csrf-1' })
    expect(request).toHaveBeenNthCalledWith(5, '/life/trash/catalog/item%2F1/restore', { method: 'POST', body: { version: 4 }, csrf: 'csrf-1' })
  })

  it('preserves the discriminated supplement and household profile contract in client transport', async () => {
    const create: CreateCatalogItemInput = {
      kind: 'household_durable', name: 'Vacuum cleaner', baseUnit: 'each',
      profile: {
        kind: 'household_durable', valueMinor: 129_900, currency: 'CNY', valueAsOfDate: '2026-08-21',
        lifecycleStatus: 'maintenance', acquiredOn: '2025-03-01', warrantyExpiresOn: '2027-03-01',
        maintenanceRecords: [{ id: 'maintenance-1', performedOn: '2026-08-20', summary: 'Filter replaced', costMinor: 4_500, currency: 'CNY' }],
        retiredOn: null, retirementReason: null, setItemIds: ['attachment-1'],
      },
    }
    const response: CatalogItem = {
      id: 'durable-1', ...create, aliases: [], status: 'active', categoryId: null, tagIds: [], locationId: null,
      availableUnits: ['each'], itemConversions: [], pricePoints: [], isCookingOil: false, attachments: [], notes: '',
      customOrder: 0, version: 1, createdAt: '2026-08-21T08:00:00.000Z', updatedAt: '2026-08-21T08:00:00.000Z', deletedAt: null,
    }
    request.mockResolvedValue(response)

    const result = await lifeCatalogApi.create(create, 'catalog-profile-1', 'csrf-profile')

    expect(request).toHaveBeenCalledWith('/life/catalog', {
      method: 'POST', body: create, csrf: 'csrf-profile', idempotencyKey: 'catalog-profile-1',
    })
    expect(result.profile).toEqual(create.profile)
    expectTypeOf(result.profile).toEqualTypeOf<CatalogItem['profile']>()
  })

  it('routes category, tag, location and unit lifecycle writes with versions', async () => {
    await lifeCatalogApi.createTaxonomy('category', { name: 'Fresh', parentId: null }, 'csrf-2')
    await lifeCatalogApi.updateTaxonomy('tag', 'tag/1', { name: 'Protein', version: 1 }, 'csrf-2')
    await lifeCatalogApi.removeTaxonomy('location', 'location/1', 2, 'csrf-2')
    await lifeCatalogApi.restoreTaxonomy('category', 'category/1', 3, 'csrf-2')
    const unit = { code: 'box', name: 'Box', symbol: 'box', dimension: 'package' as const, baseCode: 'each', toBaseFactor: null }
    await lifeCatalogApi.createUnit(unit, 'csrf-2')
    await lifeCatalogApi.updateUnit('unit/1', { name: 'Carton', version: 1 }, 'csrf-2')
    await lifeCatalogApi.removeUnit('unit/1', 2, 'csrf-2')
    await lifeCatalogApi.restoreUnit('unit/1', 3, 'csrf-2')
    expect(request.mock.calls.map(([path, options]) => [path, options])).toEqual([
      ['/life/taxonomy/categories', { method: 'POST', body: { name: 'Fresh', parentId: null }, csrf: 'csrf-2' }],
      ['/life/taxonomy/tags/tag%2F1', { method: 'PATCH', body: { name: 'Protein', version: 1 }, csrf: 'csrf-2' }],
      ['/life/taxonomy/locations/location%2F1', { method: 'DELETE', body: { version: 2 }, csrf: 'csrf-2' }],
      ['/life/trash/categories/category%2F1/restore', { method: 'POST', body: { version: 3 }, csrf: 'csrf-2' }],
      ['/life/units', { method: 'POST', body: unit, csrf: 'csrf-2' }],
      ['/life/units/unit%2F1', { method: 'PATCH', body: { name: 'Carton', version: 1 }, csrf: 'csrf-2' }],
      ['/life/units/unit%2F1', { method: 'DELETE', body: { version: 2 }, csrf: 'csrf-2' }],
      ['/life/trash/units/unit%2F1/restore', { method: 'POST', body: { version: 3 }, csrf: 'csrf-2' }],
    ])
  })

  it('awaits focused catalog, taxonomy, unit and trash invalidation after writes', async () => {
    await lifeCatalogApi.create({ kind: 'ingredient', name: 'Egg', baseUnit: 'gram' }, 'catalog-create-2', 'csrf-3')
    await lifeCatalogApi.remove('item-1', 1, 'csrf-3')
    await lifeCatalogApi.createTaxonomy('category', { name: 'Fresh' }, 'csrf-3')
    await lifeCatalogApi.createUnit({ code: 'box', name: 'Box', symbol: 'box', dimension: 'package', baseCode: 'each' }, 'csrf-3')
    expect(invalidateQueries.mock.calls.map(([options]) => options)).toEqual([
      { queryKey: queryKeys.lifeCatalog.all },
      { queryKey: queryKeys.lifeCatalog.all },
      { queryKey: queryKeys.lifeTrash.all },
      { queryKey: queryKeys.lifeTaxonomy.all },
      { queryKey: queryKeys.lifeCatalog.all },
      { queryKey: queryKeys.lifeUnits.all },
      { queryKey: queryKeys.lifeCatalog.all },
    ])
  })
})
