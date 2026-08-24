import type {
  CreateInventoryTransactionInput,
  InventoryBalance,
  InventoryFilters,
  InventoryForecast,
  InventoryTransaction,
  ReverseInventoryTransactionInput,
} from '../domain/lifeInventory'
import { http } from './httpClient'
import { queryClient } from './queryClient'
import { queryKeys } from './queryKeys'

function filtersQuery(filters: InventoryFilters) {
  const query = new URLSearchParams()
  if (filters.itemId) query.set('itemId', filters.itemId)
  const value = query.toString()
  return value ? `?${value}` : ''
}

const segment = (value: string) => encodeURIComponent(value)

async function mutation<T>(request: Promise<T>) {
  const result = await request
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.lifeInventory.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.lifeCatalog.all }),
  ])
  return result
}

export const lifeInventoryApi = {
  listBalances: (filters: InventoryFilters = {}, signal?: AbortSignal): Promise<InventoryBalance[]> =>
    http.request(`/life/inventory/balances${filtersQuery(filters)}`, { signal }),
  listTransactions: (filters: InventoryFilters = {}, signal?: AbortSignal): Promise<InventoryTransaction[]> =>
    http.request(`/life/inventory/transactions${filtersQuery(filters)}`, { signal }),
  listForecasts: (filters: InventoryFilters = {}, signal?: AbortSignal): Promise<InventoryForecast[]> =>
    http.request(`/life/inventory/forecasts${filtersQuery(filters)}`, { signal }),
  createTransaction: (input: CreateInventoryTransactionInput, idempotencyKey: string, csrf?: string): Promise<InventoryTransaction> => mutation(
    http.request('/life/inventory/transactions', { method: 'POST', body: input, csrf, idempotencyKey }),
  ),
  reverseTransaction: (id: string, input: ReverseInventoryTransactionInput, idempotencyKey: string, csrf?: string): Promise<InventoryTransaction> => mutation(
    http.request(`/life/inventory/transactions/${segment(id)}/reverse`, { method: 'POST', body: input, csrf, idempotencyKey }),
  ),
}
