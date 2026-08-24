import type {
  CreateInventoryTransactionInput,
  InventoryBalance,
  InventoryFilters,
  InventoryForecast,
  InventoryTransaction,
  ReverseInventoryTransactionInput,
} from '../domain/life/inventory.js'

export interface LifeInventoryStore {
  listInventoryBalances(userId: string, filters?: InventoryFilters): Promise<InventoryBalance[]>
  listUsableInventoryBalances(userId: string, asOf: string, filters?: InventoryFilters): Promise<InventoryBalance[]>
  listInventoryTransactions(userId: string, filters?: InventoryFilters): Promise<InventoryTransaction[]>
  createInventoryTransaction(
    userId: string,
    input: CreateInventoryTransactionInput,
    idempotencyKey: string,
  ): Promise<InventoryTransaction>
  reverseInventoryTransaction(
    userId: string,
    id: string,
    input: ReverseInventoryTransactionInput,
    idempotencyKey: string,
  ): Promise<InventoryTransaction | undefined>
  listInventoryForecasts(userId: string, filters?: InventoryFilters): Promise<InventoryForecast[]>
}
