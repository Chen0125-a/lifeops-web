import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from './httpClient'
import { lifeInventoryApi } from './lifeInventoryApi'
import { queryClient } from './queryClient'
import { queryKeys } from './queryKeys'

vi.mock('./httpClient', () => ({ http: { request: vi.fn() } }))
vi.mock('./queryClient', () => ({ queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) } }))

const request = vi.mocked(http.request)
const invalidateQueries = vi.mocked(queryClient.invalidateQueries)

describe('lifeInventoryApi', () => {
  beforeEach(() => {
    request.mockReset()
    request.mockResolvedValue(undefined)
    invalidateQueries.mockClear()
  })

  it('reads cancellable balance, ledger and forecast filters with encoded item IDs', async () => {
    const signal = new AbortController().signal
    await lifeInventoryApi.listBalances({ itemId: 'item/with space' }, signal)
    await lifeInventoryApi.listTransactions({ itemId: 'item/with space' }, signal)
    await lifeInventoryApi.listForecasts({ itemId: 'item/with space' }, signal)
    expect(request.mock.calls.map(([path, options]) => [path, options])).toEqual([
      ['/life/inventory/balances?itemId=item%2Fwith+space', { signal }],
      ['/life/inventory/transactions?itemId=item%2Fwith+space', { signal }],
      ['/life/inventory/forecasts?itemId=item%2Fwith+space', { signal }],
    ])
  })

  it('preserves CSRF and idempotency for inventory events and encoded reversal paths', async () => {
    const input = { itemId: 'item/1', kind: 'consume' as const, quantity: 2, unit: 'each', occurredAt: '2026-08-13T09:00:00.000Z' }
    await lifeInventoryApi.createTransaction(input, 'inventory-create-1', 'csrf-1')
    await lifeInventoryApi.reverseTransaction('transaction/1', { note: 'Undo' }, 'inventory-reverse-1', 'csrf-1')
    expect(request).toHaveBeenNthCalledWith(1, '/life/inventory/transactions', {
      method: 'POST', body: input, csrf: 'csrf-1', idempotencyKey: 'inventory-create-1',
    })
    expect(request).toHaveBeenNthCalledWith(2, '/life/inventory/transactions/transaction%2F1/reverse', {
      method: 'POST', body: { note: 'Undo' }, csrf: 'csrf-1', idempotencyKey: 'inventory-reverse-1',
    })
  })

  it('awaits focused inventory and catalog invalidation after confirmed writes', async () => {
    await lifeInventoryApi.createTransaction({
      itemId: 'item-1', kind: 'purchase', quantity: 1, unit: 'package', occurredAt: '2026-08-13T09:00:00.000Z',
    }, 'inventory-create-2', 'csrf-2')
    await lifeInventoryApi.reverseTransaction('transaction-1', {}, 'inventory-reverse-2', 'csrf-2')
    expect(invalidateQueries.mock.calls.map(([options]) => options)).toEqual([
      { queryKey: queryKeys.lifeInventory.all },
      { queryKey: queryKeys.lifeCatalog.all },
      { queryKey: queryKeys.lifeInventory.all },
      { queryKey: queryKeys.lifeCatalog.all },
    ])
  })
})
