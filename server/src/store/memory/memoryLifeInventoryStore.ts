import { createHash, randomUUID } from 'node:crypto'
import { convertUnit, type CatalogItem, type LifeUnit, type TaxonomyEntity } from '../../domain/life/catalog.js'
import {
  LifeInventoryDomainError,
  allocateEarliestExpiry,
  buildInventoryForecast,
  calculateInventoryBalance,
  inventoryDelta,
  normalizeInventoryIdempotencyKey,
  type CreateInventoryTransactionInput,
  type InventoryBatch,
  type InventoryBalance,
  type InventoryFilters,
  type InventoryTransaction,
  type ReverseInventoryTransactionInput,
} from '../../domain/life/inventory.js'
import type { LifeInventoryStore } from '../lifeInventoryStore.js'
import type { MemoryOwnerTransactionParticipant } from './memoryOwnerTransactionCoordinator.js'

interface Owned<T> { userId: string; value: T }

interface InventoryOwnerTransactionState {
  batches: Array<Owned<InventoryBatch>>
  transactions: Array<Owned<InventoryTransaction>>
  idempotency: Array<[string, { hash: string; promise: Promise<InventoryTransaction> }]>
}

const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, item]) => `${JSON.stringify(name)}:${stable(item)}`).join(',')}}`
    : JSON.stringify(value)

const requestHash = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex').toUpperCase()
const round = (value: number) => Math.round((value + Number.EPSILON) * 1_000_000_000) / 1_000_000_000

export class MemoryLifeInventoryStore implements LifeInventoryStore, MemoryOwnerTransactionParticipant<InventoryOwnerTransactionState> {
  private readonly createId: () => string
  private readonly now: () => string
  private batches: Array<Owned<InventoryBatch>> = []
  private transactions: Array<Owned<InventoryTransaction>> = []
  private readonly idempotency = new Map<string, { hash: string; promise: Promise<InventoryTransaction> }>()

  constructor(private readonly options: {
    createId?: () => string
    now?: () => string
    getCatalogItem: (userId: string, itemId: string) => Promise<CatalogItem | undefined>
    listUnits: (userId: string) => Promise<LifeUnit[]>
    listLocations: (userId: string) => Promise<TaxonomyEntity[]>
  }) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date().toISOString())
  }

  async listInventoryBalances(userId: string, filters: InventoryFilters = {}) {
    const transactions = this.ownedTransactions(userId, filters.itemId)
    const itemIds = [...new Set(transactions.map((entry) => entry.itemId))]
    return Promise.all(itemIds.map(async (itemId) => {
      const item = await this.options.getCatalogItem(userId, itemId)
      if (!item) return undefined
      return calculateInventoryBalance(itemId, item.baseUnit, transactions)
    })).then((values) => values.filter((value): value is NonNullable<typeof value> => value != null)
      .sort((left, right) => left.itemId.localeCompare(right.itemId)))
  }

  async listUsableInventoryBalances(userId: string, asOf: string, filters: InventoryFilters = {}) {
    this.validDate(asOf, 'asOf')
    const grouped = new Map<string, { baseUnit: string; onHand: number }>()
    for (const entry of this.batches) {
      const batch = entry.value
      if (entry.userId !== userId || (filters.itemId && batch.itemId !== filters.itemId)) continue
      if (batch.expiresOn != null && batch.expiresOn < asOf) continue
      const current = grouped.get(batch.itemId) ?? { baseUnit: batch.baseUnit, onHand: 0 }
      current.onHand = round(current.onHand + batch.remainingQuantity)
      grouped.set(batch.itemId, current)
    }
    return [...grouped.entries()].map(([itemId, value]) => ({
      itemId, baseUnit: value.baseUnit, onHand: value.onHand, warnings: [] as InventoryBalance['warnings'],
    })).sort((left, right) => left.itemId.localeCompare(right.itemId))
  }

  async listInventoryTransactions(userId: string, filters: InventoryFilters = {}) {
    const values = this.ownedTransactions(userId, filters.itemId)
      .map((entry) => ({
        ...entry,
        reversedByTransactionId: this.transactions.find((candidate) =>
          candidate.userId === userId && candidate.value.reversesTransactionId === entry.id)?.value.id ?? null,
      }))
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id))
    return structuredClone(values)
  }

  async createInventoryTransaction(userId: string, input: CreateInventoryTransactionInput, rawKey: string) {
    return this.idempotently(userId, 'create', rawKey, input, async () => {
      const item = await this.requireItem(userId, input.itemId)
      const units = await this.options.listUnits(userId)
      const quantity = this.baseQuantity(item, units, input)
      const delta = inventoryDelta(input.kind, input.kind === 'adjustment' && input.quantity < 0 ? -quantity : quantity)
      await this.validateLocation(userId, input.batch?.locationId ?? item.locationId)
      return this.append(userId, item, input, delta)
    })
  }

  async reverseInventoryTransaction(userId: string, id: string, input: ReverseInventoryTransactionInput, rawKey: string) {
    const original = this.transactions.find((entry) => entry.userId === userId && entry.value.id === id)?.value
    if (!original) return undefined
    return this.idempotently(userId, `reverse:${id}`, rawKey, input, async () => {
      const current = this.transactions.find((entry) => entry.userId === userId && entry.value.id === id)?.value
      if (!current) throw new LifeInventoryDomainError('NOT_FOUND', 'The inventory transaction does not exist.', 404)
      if (current.kind === 'reversal') throw new LifeInventoryDomainError('TRANSACTION_NOT_REVERSIBLE', 'A reversal cannot be reversed directly.', 409)
      if (this.transactions.some((entry) => entry.userId === userId && entry.value.reversesTransactionId === current.id)) {
        throw new LifeInventoryDomainError('TRANSACTION_ALREADY_REVERSED', 'The inventory transaction already has a reversal.', 409)
      }
      const item = await this.requireItem(userId, current.itemId)
      const timestamp = this.now()
      const batchCopies = this.batches.map((entry) => ({ userId: entry.userId, value: structuredClone(entry.value) }))
      const allocations = current.deltaBaseQuantity < 0
        ? this.restoreAllocations(batchCopies, userId, current.allocations)
        : this.consumeFromBatches(batchCopies, userId, current.itemId, -current.deltaBaseQuantity, timestamp.slice(0, 10))
      const reversal: InventoryTransaction = {
        id: this.createId(),
        itemId: current.itemId,
        kind: 'reversal',
        quantity: current.baseQuantity,
        unit: item.baseUnit,
        baseQuantity: current.baseQuantity,
        deltaBaseQuantity: round(-current.deltaBaseQuantity),
        batchId: null,
        occurredAt: timestamp,
        reversesTransactionId: current.id,
        reversedByTransactionId: null,
        warning: null,
        note: input.note?.trim() ?? '',
        allocations,
        createdAt: timestamp,
      }
      const all = [...this.ownedTransactions(userId), reversal]
      const balance = calculateInventoryBalance(item.id, item.baseUnit, all)
      reversal.warning = balance.warnings[0] ?? null
      this.batches = batchCopies
      this.transactions.push({ userId, value: reversal })
      return structuredClone(reversal)
    })
  }

  async listInventoryForecasts(userId: string, filters: InventoryFilters = {}) {
    const balances = await this.listInventoryBalances(userId, filters)
    return balances.map((balance) => buildInventoryForecast({
      itemId: balance.itemId,
      baseUnit: balance.baseUnit,
      onHand: balance.onHand,
      plannedDemand: 0,
      minimumStock: 0,
      outstandingShopping: 0,
      packageQuantity: 1,
    }))
  }

  getTransactionActualCost(userId: string, transactionId: string) {
    const transaction = this.transactions.find((entry) => entry.userId === userId && entry.value.id === transactionId)?.value
    if (!transaction || transaction.deltaBaseQuantity >= 0) return null
    const allocated = round(transaction.allocations.reduce((total, entry) => total + entry.quantity, 0))
    if (allocated !== round(transaction.baseQuantity)) return null
    let total = 0
    for (const allocation of transaction.allocations) {
      const batch = this.batches.find((entry) => entry.userId === userId && entry.value.id === allocation.batchId)?.value
      if (batch?.actualUnitCostMinor == null) return null
      total = round(total + allocation.quantity * batch.actualUnitCostMinor)
    }
    return total
  }

  captureOwnerTransactionState(userId: string): InventoryOwnerTransactionState {
    const prefix = `${userId}\0`
    return {
      batches: structuredClone(this.batches.filter((entry) => entry.userId === userId)),
      transactions: structuredClone(this.transactions.filter((entry) => entry.userId === userId)),
      idempotency: [...this.idempotency.entries()].filter(([key]) => key.startsWith(prefix)),
    }
  }

  restoreOwnerTransactionState(userId: string, state: InventoryOwnerTransactionState) {
    const prefix = `${userId}\0`
    this.batches = [
      ...this.batches.filter((entry) => entry.userId !== userId),
      ...structuredClone(state.batches),
    ]
    this.transactions = [
      ...this.transactions.filter((entry) => entry.userId !== userId),
      ...structuredClone(state.transactions),
    ]
    for (const key of [...this.idempotency.keys()]) {
      if (key.startsWith(prefix)) this.idempotency.delete(key)
    }
    for (const [key, value] of state.idempotency) this.idempotency.set(key, value)
  }

  async exportOwnerPortableData(userId: string) {
    return {
      inventoryBatches: structuredClone(this.batches.filter((entry) => entry.userId === userId).map((entry) => entry.value)),
      inventoryTransactions: await this.listInventoryTransactions(userId),
    }
  }

  replaceOwnerPortableData(userId: string, payload: Record<string, unknown>) {
    const batches = structuredClone((Array.isArray(payload.inventoryBatches) ? payload.inventoryBatches : []) as InventoryBatch[])
    const transactions = structuredClone((Array.isArray(payload.inventoryTransactions) ? payload.inventoryTransactions : []) as InventoryTransaction[])
    this.batches = [
      ...this.batches.filter((entry) => entry.userId !== userId),
      ...batches.map((value) => ({ userId, value })),
    ]
    this.transactions = [
      ...this.transactions.filter((entry) => entry.userId !== userId),
      ...transactions.map((value) => ({ userId, value })),
    ]
  }

  async consumeRecipeIngredients(
    userId: string,
    inputs: Array<{ itemId: string; quantity: number; unit: string }>,
    occurredAtRaw: string,
    cookingSessionId: string,
  ): Promise<InventoryTransaction[]> {
    const occurredAt = this.validTimestamp(occurredAtRaw)
    const units = await this.options.listUnits(userId)
    const batchCopies = this.batches.map((entry) => ({ userId: entry.userId, value: structuredClone(entry.value) }))
    const pending: Array<Owned<InventoryTransaction>> = []
    for (const input of inputs) {
      const item = await this.requireItem(userId, input.itemId)
      const baseQuantity = this.baseQuantity(item, units, { ...input, kind: 'consume', occurredAt })
      const allocations = this.consumeFromBatches(batchCopies, userId, item.id, baseQuantity, occurredAt.slice(0, 10))
      const timestamp = this.now()
      const entry: InventoryTransaction = {
        id: this.createId(), itemId: item.id, kind: 'consume', quantity: input.quantity,
        unit: input.unit.trim().toLocaleLowerCase(), baseQuantity, deltaBaseQuantity: -baseQuantity,
        batchId: null, occurredAt, reversesTransactionId: null, reversedByTransactionId: null,
        warning: null, note: `Cooking session ${cookingSessionId}`, allocations, createdAt: timestamp,
      }
      const balance = calculateInventoryBalance(item.id, item.baseUnit, [
        ...this.ownedTransactions(userId),
        ...pending.map((value) => value.value),
        entry,
      ])
      entry.warning = balance.warnings[0] ?? null
      pending.push({ userId, value: entry })
    }
    this.batches = batchCopies
    this.transactions.push(...pending)
    return structuredClone(pending.map((entry) => entry.value))
  }

  private async append(userId: string, item: CatalogItem, input: CreateInventoryTransactionInput, delta: number) {
    const timestamp = this.now()
    const occurredAt = this.validTimestamp(input.occurredAt)
    const batchCopies = this.batches.map((entry) => ({ userId: entry.userId, value: structuredClone(entry.value) }))
    let batchId: string | null = null
    let allocations: InventoryTransaction['allocations'] = []
    if (delta > 0) {
      const batch = this.createBatch(item, input, delta, timestamp)
      batchCopies.push({ userId, value: batch })
      batchId = batch.id
    } else {
      allocations = this.consumeFromBatches(batchCopies, userId, item.id, -delta, occurredAt.slice(0, 10))
    }
    const entry: InventoryTransaction = {
      id: this.createId(),
      itemId: item.id,
      kind: input.kind,
      quantity: input.quantity,
      unit: input.unit.trim().toLocaleLowerCase(),
      baseQuantity: Math.abs(delta),
      deltaBaseQuantity: delta,
      batchId,
      occurredAt,
      reversesTransactionId: null,
      reversedByTransactionId: null,
      warning: null,
      note: input.note?.trim() ?? '',
      allocations,
      createdAt: timestamp,
    }
    const balance = calculateInventoryBalance(item.id, item.baseUnit, [...this.ownedTransactions(userId), entry])
    entry.warning = balance.warnings[0] ?? null
    this.batches = batchCopies
    this.transactions.push({ userId, value: entry })
    return structuredClone(entry)
  }

  private createBatch(item: CatalogItem, input: CreateInventoryTransactionInput, quantity: number, timestamp: string): InventoryBatch {
    const batch = input.batch ?? {}
    const purchasedOn = batch.purchasedOn ?? input.occurredAt.slice(0, 10)
    this.validDate(purchasedOn, 'purchasedOn')
    if (batch.expiresOn != null) this.validDate(batch.expiresOn, 'expiresOn')
    if (batch.actualUnitCostMinor != null && (
      !Number.isFinite(batch.actualUnitCostMinor)
      || batch.actualUnitCostMinor < 0
      || round(batch.actualUnitCostMinor) !== batch.actualUnitCostMinor
    )) {
      throw new LifeInventoryDomainError('INVALID_INPUT', 'actualUnitCostMinor must be non-negative with at most 9 decimal places.', 400)
    }
    return {
      id: this.createId(), itemId: item.id, baseUnit: item.baseUnit, originalQuantity: quantity, remainingQuantity: quantity,
      purchasedOn, expiresOn: batch.expiresOn ?? null, locationId: batch.locationId ?? item.locationId,
      actualUnitCostMinor: batch.actualUnitCostMinor ?? null, createdAt: timestamp,
    }
  }

  private consumeFromBatches(
    copies: Array<Owned<InventoryBatch>>,
    userId: string,
    itemId: string,
    quantity: number,
    asOf: string,
  ) {
    const candidates = copies.filter((entry) => entry.userId === userId && entry.value.itemId === itemId).map((entry) => entry.value)
    const result = allocateEarliestExpiry(candidates, quantity, asOf)
    return result.allocations.map((allocation) => {
      const batch = candidates.find((value) => value.id === allocation.batchId)!
      batch.remainingQuantity = round(batch.remainingQuantity - allocation.quantity)
      return { ...allocation, expiresOn: batch.expiresOn }
    })
  }

  private restoreAllocations(
    copies: Array<Owned<InventoryBatch>>,
    userId: string,
    allocations: InventoryTransaction['allocations'],
  ) {
    for (const allocation of allocations) {
      const batch = copies.find((entry) => entry.userId === userId && entry.value.id === allocation.batchId)?.value
      if (!batch) throw new LifeInventoryDomainError('BATCH_NOT_FOUND', 'The original inventory batch no longer exists.', 409)
      batch.remainingQuantity = round(batch.remainingQuantity + allocation.quantity)
    }
    return structuredClone(allocations)
  }

  private baseQuantity(item: CatalogItem, units: LifeUnit[], input: CreateInventoryTransactionInput) {
    if (!Number.isFinite(input.quantity) || input.quantity === 0 || (input.kind !== 'adjustment' && input.quantity < 0)) {
      throw new LifeInventoryDomainError('INVALID_INPUT', 'Inventory quantity must be positive except for signed adjustments.', 400)
    }
    const converted = convertUnit({
      itemId: item.id,
      quantity: Math.abs(input.quantity),
      fromUnit: input.unit,
      toBaseUnit: item.baseUnit,
      itemConversions: item.itemConversions,
      units: units.map((unit) => ({ code: unit.code, dimension: unit.dimension, baseCode: unit.baseCode, toBaseFactor: unit.toBaseFactor })),
    })
    if (converted.status === 'incomplete') {
      throw new LifeInventoryDomainError('INCOMPLETE_CONVERSION', `Inventory quantity is incomplete: ${converted.reason}.`, 409)
    }
    return converted.baseQuantity
  }

  private async requireItem(userId: string, itemId: string) {
    const item = await this.options.getCatalogItem(userId, itemId)
    if (!item) throw new LifeInventoryDomainError('NOT_FOUND', 'The catalog item does not exist.', 404)
    return item
  }

  private async validateLocation(userId: string, locationId: string | null | undefined) {
    if (locationId == null) return
    const locations = await this.options.listLocations(userId)
    if (!locations.some((location) => location.id === locationId && location.deletedAt == null && location.status === 'active')) {
      throw new LifeInventoryDomainError('NOT_FOUND', 'The inventory batch location does not exist.', 404)
    }
  }

  private ownedTransactions(userId: string, itemId?: string) {
    return this.transactions.filter((entry) => entry.userId === userId && (!itemId || entry.value.itemId === itemId)).map((entry) => entry.value)
  }

  private validTimestamp(value: string) {
    const timestamp = new Date(value)
    if (!value || Number.isNaN(timestamp.getTime())) throw new LifeInventoryDomainError('INVALID_DATE', 'occurredAt must be a valid timestamp.', 400)
    return timestamp.toISOString()
  }

  private validDate(value: string, field: string) {
    const parsed = new Date(`${value}T00:00:00.000Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new LifeInventoryDomainError('INVALID_DATE', `${field} must be a valid date-only value.`, 400)
    }
  }

  private async idempotently(
    userId: string,
    operation: string,
    rawKey: string,
    input: unknown,
    create: () => Promise<InventoryTransaction>,
  ) {
    const key = normalizeInventoryIdempotencyKey(rawKey)
    const mapKey = `${userId}\u0000${operation}\u0000${key}`
    const hash = requestHash(input)
    const existing = this.idempotency.get(mapKey)
    if (existing) {
      if (existing.hash !== hash) throw new LifeInventoryDomainError('IDEMPOTENCY_CONFLICT', 'The idempotency key belongs to a different inventory request.', 409)
      return structuredClone(await existing.promise)
    }
    const promise = Promise.resolve().then(create)
    this.idempotency.set(mapKey, { hash, promise })
    try { return structuredClone(await promise) } catch (error) { this.idempotency.delete(mapKey); throw error }
  }
}
