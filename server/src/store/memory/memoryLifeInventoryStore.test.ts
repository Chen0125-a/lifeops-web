import { describe, expect, it } from 'vitest'
import { BUILT_IN_UNITS, type CatalogItem } from '../../domain/life/catalog.js'
import { MemoryLifeInventoryStore } from './memoryLifeInventoryStore.js'

const ingredient = (id: string): CatalogItem => ({
  id,
  kind: 'ingredient',
  name: id,
  aliases: [],
  status: 'active',
  categoryId: null,
  tagIds: [],
  locationId: null,
  baseUnit: 'gram',
  availableUnits: ['gram'],
  itemConversions: [],
  pricePoints: [],
  nutrition: undefined,
  attachments: [],
  notes: '',
  customOrder: 0,
  version: 1,
  createdAt: '2026-08-13T09:00:00.000Z',
  updatedAt: '2026-08-13T09:00:00.000Z',
  deletedAt: null,
})

describe('MemoryLifeInventoryStore recipe consumption', () => {
  it('rolls back every ingredient when a later ingredient cannot be consumed', async () => {
    let sequence = 0
    const items = new Map([['rice', ingredient('rice')]])
    const store = new MemoryLifeInventoryStore({
      createId: () => `atomic-inventory-${++sequence}`,
      now: () => '2026-08-13T09:00:00.000Z',
      getCatalogItem: async (_userId, itemId) => items.get(itemId),
      listUnits: async () => BUILT_IN_UNITS,
      listLocations: async () => [],
    })
    await store.createInventoryTransaction('owner', {
      itemId: 'rice', kind: 'purchase', quantity: 10, unit: 'gram', occurredAt: '2026-08-13T08:00:00.000Z',
    }, 'stock-rice')

    await expect(store.consumeRecipeIngredients('owner', [
      { itemId: 'rice', quantity: 4, unit: 'gram' },
      { itemId: 'missing', quantity: 1, unit: 'gram' },
    ], '2026-08-13T10:00:00.000Z', 'session-one')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })

    expect(await store.listInventoryBalances('owner')).toEqual([
      expect.objectContaining({ itemId: 'rice', onHand: 10 }),
    ])
    expect(await store.listInventoryTransactions('owner')).toHaveLength(1)
  })
})
