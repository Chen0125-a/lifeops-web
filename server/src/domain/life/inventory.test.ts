import { describe, expect, it } from 'vitest'
import {
  allocateEarliestExpiry,
  buildInventoryForecast,
  calculateInventoryBalance,
  inventoryDelta,
  type InventoryBatch,
  type InventoryTransaction,
} from './inventory.js'

const transaction = (
  id: string,
  kind: InventoryTransaction['kind'],
  deltaBaseQuantity: number,
): InventoryTransaction => ({
  id,
  itemId: 'rice',
  kind,
  quantity: Math.abs(deltaBaseQuantity),
  unit: 'gram',
  baseQuantity: Math.abs(deltaBaseQuantity),
  deltaBaseQuantity,
  batchId: null,
  occurredAt: '2026-08-13T09:00:00.000Z',
  reversesTransactionId: null,
  reversedByTransactionId: null,
  warning: null,
  note: '',
  allocations: [],
  createdAt: '2026-08-13T09:00:00.000Z',
})

describe('inventory transaction deltas and balances', () => {
  it.each([
    { kind: 'purchase' as const, quantity: 10, expected: 10 },
    { kind: 'consume' as const, quantity: 3, expected: -3 },
    { kind: 'return' as const, quantity: 2, expected: -2 },
    { kind: 'waste' as const, quantity: 1, expected: -1 },
    { kind: 'adjustment' as const, quantity: -4, expected: -4 },
  ])('derives the append-only balance delta for $kind', ({ kind, quantity, expected }) => {
    expect(inventoryDelta(kind, quantity)).toBe(expected)
  })

  it('calculates from immutable ledger deltas and warns without hiding a negative balance', () => {
    expect(calculateInventoryBalance('rice', 'gram', [
      transaction('purchase-1', 'purchase', 5),
      transaction('consume-1', 'consume', -8),
    ])).toEqual({
      itemId: 'rice',
      baseUnit: 'gram',
      onHand: -3,
      warnings: ['negative_inventory'],
    })
  })
})

describe('inventory batch allocation', () => {
  it('uses non-expired batches by earliest expiry and leaves undated stock last', () => {
    const batch = (
      id: string,
      remainingQuantity: number,
      expiresOn: string | null,
      purchasedOn: string,
    ): InventoryBatch => ({
      id,
      itemId: 'milk',
      baseUnit: 'millilitre',
      originalQuantity: remainingQuantity,
      remainingQuantity,
      purchasedOn,
      expiresOn,
      locationId: null,
      actualUnitCostMinor: null,
      createdAt: `${purchasedOn}T00:00:00.000Z`,
    })

    expect(allocateEarliestExpiry([
      batch('undated', 9, null, '2026-08-01'),
      batch('later', 5, '2026-08-30', '2026-08-02'),
      batch('expired', 8, '2026-08-12', '2026-08-01'),
      batch('soon', 3, '2026-08-15', '2026-08-03'),
    ], 7, '2026-08-13')).toEqual({
      allocations: [
        { batchId: 'soon', quantity: 3 },
        { batchId: 'later', quantity: 4 },
      ],
      unallocated: 0,
    })
  })
})

describe('inventory forecasts', () => {
  it('keeps planned demand separate from actual stock while projecting the future balance', () => {
    const actual = calculateInventoryBalance('rice', 'each', [transaction('purchase-eggs', 'purchase', 12)])
    const forecast = buildInventoryForecast({
      itemId: 'rice',
      baseUnit: 'each',
      onHand: actual.onHand,
      plannedDemand: 5,
      minimumStock: 0,
      outstandingShopping: 0,
      packageQuantity: 1,
    })

    expect(actual.onHand).toBe(12)
    expect(forecast).toMatchObject({
      status: 'complete',
      onHand: 12,
      plannedDemand: 5,
      projectedBalance: 7,
    })
  })

  it('adds minimum-stock buffer, subtracts outstanding shopping and rounds up to a package', () => {
    expect(buildInventoryForecast({
      itemId: 'supplement',
      baseUnit: 'capsule',
      onHand: 3,
      plannedDemand: 6,
      minimumStock: 4,
      outstandingShopping: 1,
      packageQuantity: 5,
    })).toEqual({
      status: 'complete',
      itemId: 'supplement',
      baseUnit: 'capsule',
      onHand: 3,
      plannedDemand: 6,
      projectedBalance: -3,
      minimumStock: 4,
      shortage: 3,
      outstandingShopping: 1,
      packageQuantity: 5,
      suggestedPurchase: 10,
    })
  })

  it('keeps the forecast incomplete when a planned quantity has no valid conversion', () => {
    expect(buildInventoryForecast({
      itemId: 'milk',
      baseUnit: 'millilitre',
      onHand: 750,
      plannedDemand: 0,
      minimumStock: 0,
      outstandingShopping: 0,
      packageQuantity: 1,
      conversionComplete: false,
    })).toEqual({
      status: 'incomplete',
      itemId: 'milk',
      baseUnit: 'millilitre',
      onHand: 750,
      reason: 'missing_conversion',
    })
  })
})
