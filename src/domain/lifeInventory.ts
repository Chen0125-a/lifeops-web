export type InventoryTransactionKind =
  | 'purchase'
  | 'consume'
  | 'return'
  | 'waste'
  | 'adjustment'
  | 'reversal'

export type InventoryWarning = 'negative_inventory'

export interface InventoryAllocation {
  batchId: string
  quantity: number
  expiresOn: string | null
}

export interface InventoryTransaction {
  id: string
  itemId: string
  kind: InventoryTransactionKind
  quantity: number
  unit: string
  baseQuantity: number
  deltaBaseQuantity: number
  batchId: string | null
  occurredAt: string
  reversesTransactionId: string | null
  reversedByTransactionId: string | null
  warning: InventoryWarning | null
  note: string
  allocations: InventoryAllocation[]
  createdAt: string
}

export interface InventoryBalance {
  itemId: string
  baseUnit: string
  onHand: number
  warnings: InventoryWarning[]
}

export type InventoryForecast =
  | {
      status: 'complete'
      itemId: string
      baseUnit: string
      onHand: number
      plannedDemand: number
      projectedBalance: number
      minimumStock: number
      shortage: number
      outstandingShopping: number
      packageQuantity: number
      suggestedPurchase: number
    }
  | { status: 'incomplete'; itemId: string; baseUnit: string; onHand: number; reason: 'missing_conversion' }

export interface InventoryFilters { itemId?: string }

export interface CreateInventoryTransactionInput {
  itemId: string
  kind: Exclude<InventoryTransactionKind, 'reversal'>
  quantity: number
  unit: string
  occurredAt: string
  batch?: {
    purchasedOn?: string | null
    expiresOn?: string | null
    locationId?: string | null
    actualUnitCostMinor?: number | null
  }
  note?: string
}

export interface ReverseInventoryTransactionInput { note?: string }
