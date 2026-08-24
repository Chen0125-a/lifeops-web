export type InventoryTransactionKind =
  | 'purchase'
  | 'consume'
  | 'return'
  | 'waste'
  | 'adjustment'
  | 'reversal'

export type InventoryWarning = 'negative_inventory'

export interface InventoryBatch {
  id: string
  itemId: string
  baseUnit: string
  originalQuantity: number
  remainingQuantity: number
  purchasedOn: string | null
  expiresOn: string | null
  locationId: string | null
  actualUnitCostMinor: number | null
  createdAt: string
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
  allocations: Array<InventoryBatchAllocation & { expiresOn: string | null }>
  createdAt: string
}

export interface CreateInventoryBatchInput {
  purchasedOn?: string | null
  expiresOn?: string | null
  locationId?: string | null
  actualUnitCostMinor?: number | null
}

export interface CreateInventoryTransactionInput {
  itemId: string
  kind: Exclude<InventoryTransactionKind, 'reversal'>
  quantity: number
  unit: string
  occurredAt: string
  batch?: CreateInventoryBatchInput
  note?: string
}

export interface ReverseInventoryTransactionInput {
  note?: string
}

export interface InventoryFilters {
  itemId?: string
}

export interface InventoryBalance {
  itemId: string
  baseUnit: string
  onHand: number
  warnings: InventoryWarning[]
}

export interface InventoryBatchAllocation {
  batchId: string
  quantity: number
}

export interface InventoryAllocationResult {
  allocations: InventoryBatchAllocation[]
  unallocated: number
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
  | {
      status: 'incomplete'
      itemId: string
      baseUnit: string
      onHand: number
      reason: 'missing_conversion'
    }

export interface InventoryForecastInput {
  itemId: string
  baseUnit: string
  onHand: number
  plannedDemand: number
  minimumStock: number
  outstandingShopping: number
  packageQuantity: number
  conversionComplete?: boolean
}

export function normalizeInventoryIdempotencyKey(value: string) {
  const result = value.trim()
  if (!result || result.length > 190) {
    throw new LifeInventoryDomainError('INVALID_IDEMPOTENCY_KEY', 'A valid inventory idempotency key is required.', 400)
  }
  return result
}

export class LifeInventoryDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'LifeInventoryDomainError'
  }
}

const round = (value: number) => Math.round((value + Number.EPSILON) * 1_000_000_000) / 1_000_000_000

const finite = (value: number, field: string) => {
  if (!Number.isFinite(value)) throw new LifeInventoryDomainError('INVALID_INPUT', `${field} must be finite.`, 400)
  return value
}

const nonNegative = (value: number, field: string) => {
  finite(value, field)
  if (value < 0) throw new LifeInventoryDomainError('INVALID_INPUT', `${field} cannot be negative.`, 400)
  return value
}

const positive = (value: number, field: string) => {
  finite(value, field)
  if (value <= 0) throw new LifeInventoryDomainError('INVALID_INPUT', `${field} must be greater than zero.`, 400)
  return value
}

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
  && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value

export function inventoryDelta(
  kind: Exclude<InventoryTransactionKind, 'reversal'>,
  baseQuantity: number,
): number {
  if (kind === 'adjustment') {
    finite(baseQuantity, 'adjustment quantity')
    if (baseQuantity === 0) throw new LifeInventoryDomainError('INVALID_INPUT', 'An adjustment must change the balance.', 400)
    return round(baseQuantity)
  }
  positive(baseQuantity, 'quantity')
  return kind === 'purchase' ? round(baseQuantity) : round(-baseQuantity)
}

export function calculateInventoryBalance(
  itemId: string,
  baseUnit: string,
  transactions: InventoryTransaction[],
): InventoryBalance {
  const cleanItemId = itemId.trim()
  const cleanBaseUnit = baseUnit.trim().toLocaleLowerCase()
  if (!cleanItemId || !cleanBaseUnit) throw new LifeInventoryDomainError('INVALID_INPUT', 'Item and base unit are required.', 400)
  const ids = new Set<string>()
  let onHand = 0
  for (const entry of transactions) {
    if (entry.itemId !== cleanItemId) continue
    if (ids.has(entry.id)) throw new LifeInventoryDomainError('DUPLICATE_TRANSACTION', 'The inventory ledger contains a duplicate event.', 409)
    ids.add(entry.id)
    onHand = round(onHand + finite(entry.deltaBaseQuantity, 'transaction delta'))
  }
  return {
    itemId: cleanItemId,
    baseUnit: cleanBaseUnit,
    onHand,
    warnings: onHand < 0 ? ['negative_inventory'] : [],
  }
}

export function allocateEarliestExpiry(
  batches: InventoryBatch[],
  quantity: number,
  asOf: string,
): InventoryAllocationResult {
  positive(quantity, 'quantity')
  if (!validDate(asOf)) throw new LifeInventoryDomainError('INVALID_DATE', 'asOf must be a valid date-only value.', 400)
  const candidates = batches
    .filter((batch) => nonNegative(batch.remainingQuantity, 'batch remaining quantity') > 0)
    .filter((batch) => {
      if (batch.expiresOn != null && !validDate(batch.expiresOn)) throw new LifeInventoryDomainError('INVALID_DATE', 'Batch expiry must be a valid date-only value.', 400)
      return batch.expiresOn == null || batch.expiresOn >= asOf
    })
    .sort((left, right) => {
      if (left.expiresOn == null && right.expiresOn != null) return 1
      if (left.expiresOn != null && right.expiresOn == null) return -1
      return (left.expiresOn ?? '').localeCompare(right.expiresOn ?? '')
        || (left.purchasedOn ?? '').localeCompare(right.purchasedOn ?? '')
        || left.id.localeCompare(right.id)
    })
  let remaining = quantity
  const allocations: InventoryBatchAllocation[] = []
  for (const batch of candidates) {
    if (remaining <= 0) break
    const allocated = round(Math.min(remaining, batch.remainingQuantity))
    if (allocated > 0) allocations.push({ batchId: batch.id, quantity: allocated })
    remaining = round(remaining - allocated)
  }
  return { allocations, unallocated: Math.max(0, remaining) }
}

export function buildInventoryForecast(input: InventoryForecastInput): InventoryForecast {
  const itemId = input.itemId.trim()
  const baseUnit = input.baseUnit.trim().toLocaleLowerCase()
  if (!itemId || !baseUnit) throw new LifeInventoryDomainError('INVALID_INPUT', 'Item and base unit are required.', 400)
  finite(input.onHand, 'onHand')
  if (input.conversionComplete === false) {
    return { status: 'incomplete', itemId, baseUnit, onHand: round(input.onHand), reason: 'missing_conversion' }
  }
  nonNegative(input.plannedDemand, 'plannedDemand')
  nonNegative(input.minimumStock, 'minimumStock')
  nonNegative(input.outstandingShopping, 'outstandingShopping')
  positive(input.packageQuantity, 'packageQuantity')
  const projectedBalance = round(input.onHand - input.plannedDemand)
  const shortage = round(Math.max(0, input.plannedDemand - input.onHand))
  const rawSuggestion = Math.max(0, input.plannedDemand + input.minimumStock - input.onHand - input.outstandingShopping)
  const suggestedPurchase = round(Math.ceil(rawSuggestion / input.packageQuantity) * input.packageQuantity)
  return {
    status: 'complete',
    itemId,
    baseUnit,
    onHand: round(input.onHand),
    plannedDemand: round(input.plannedDemand),
    projectedBalance,
    minimumStock: round(input.minimumStock),
    shortage,
    outstandingShopping: round(input.outstandingShopping),
    packageQuantity: round(input.packageQuantity),
    suggestedPurchase,
  }
}
