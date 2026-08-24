import { createHash, randomUUID } from 'node:crypto'
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'
import { convertUnit, type CatalogItem, type LifeUnit } from '../../domain/life/catalog.js'
import {
  LifeInventoryDomainError,
  allocateEarliestExpiry,
  buildInventoryForecast,
  calculateInventoryBalance,
  inventoryDelta,
  normalizeInventoryIdempotencyKey,
  type CreateInventoryTransactionInput,
  type InventoryBatch,
  type InventoryFilters,
  type InventoryTransaction,
  type ReverseInventoryTransactionInput,
} from '../../domain/life/inventory.js'
import type { LifeInventoryStore } from '../lifeInventoryStore.js'

type Executor = Pool | PoolConnection
type SqlRow = RowDataPacket & Record<string, unknown>

const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, item]) => `${JSON.stringify(name)}:${stable(item)}`).join(',')}}`
    : JSON.stringify(value)
const requestHash = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex').toUpperCase()
const toSqlDateTime = (value: string) => new Date(value).toISOString().slice(0, 23).replace('T', ' ')
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : `${String(value).replace(' ', 'T')}Z`
const dateOnly = (value: unknown) => value == null ? null : String(value).slice(0, 10)
const round = (value: number) => Math.round((value + Number.EPSILON) * 1_000_000_000) / 1_000_000_000

async function rows<T>(executor: Executor, sql: string, values: unknown[] = []): Promise<T[]> {
  const [result] = await executor.execute(sql, values as never[])
  return result as unknown as T[]
}

export class MySqlLifeInventoryStore implements LifeInventoryStore {
  constructor(
    private readonly pool: Pool,
    private readonly options: {
      createId?: () => string
      now?: () => string
      getCatalogItem: (userId: string, itemId: string) => Promise<CatalogItem | undefined>
      getCatalogItemFrom: (executor: Executor, userId: string, itemId: string) => Promise<CatalogItem | undefined>
      listUnits: (userId: string) => Promise<LifeUnit[]>
      listUnitsFrom: (executor: Executor, userId: string) => Promise<LifeUnit[]>
    },
  ) {}

  private createId = () => this.options.createId?.() ?? randomUUID()
  private now = () => this.options.now?.() ?? new Date().toISOString()

  async listInventoryBalances(userId: string, filters: InventoryFilters = {}) {
    return this.listInventoryBalancesFrom(this.pool, userId, filters)
  }

  async listInventoryBalancesFrom(executor: Executor, userId: string, filters: InventoryFilters = {}) {
    const transactions = await this.listInventoryTransactionsFrom(executor, userId, filters)
    const itemIds = [...new Set(transactions.map((entry) => entry.itemId))]
    const itemRows = itemIds.length ? await rows<SqlRow>(executor, `SELECT id,base_unit FROM life_items
      WHERE user_id=? AND id IN (${itemIds.map(() => '?').join(',')})`, [userId, ...itemIds]) : []
    const baseUnits = new Map(itemRows.map((row) => [String(row.id), String(row.base_unit)]))
    const values = itemIds.map((itemId) => {
      const baseUnit = baseUnits.get(itemId)
      return baseUnit ? calculateInventoryBalance(itemId, baseUnit, transactions) : undefined
    })
    return values.filter((value): value is NonNullable<typeof value> => value != null)
      .sort((left, right) => left.itemId.localeCompare(right.itemId))
  }

  async listUsableInventoryBalances(userId: string, asOf: string, filters: InventoryFilters = {}) {
    return this.listUsableInventoryBalancesFrom(this.pool, userId, asOf, filters)
  }

  async listUsableInventoryBalancesFrom(executor: Executor, userId: string, asOf: string, filters: InventoryFilters = {}) {
    this.validDate(asOf, 'asOf')
    const values: unknown[] = [userId, asOf]
    const itemFilter = filters.itemId ? ' AND item_id = ?' : ''
    if (filters.itemId) values.push(filters.itemId)
    const found = await rows<SqlRow>(executor, `SELECT item_id,base_unit,SUM(remaining_quantity) on_hand
      FROM life_inventory_batches WHERE user_id=? AND remaining_quantity>0 AND (expires_on IS NULL OR expires_on>=?)${itemFilter}
      GROUP BY item_id,base_unit ORDER BY item_id`, values)
    return found.map((row) => ({
      itemId: String(row.item_id), baseUnit: String(row.base_unit), onHand: Number(row.on_hand), warnings: [],
    }))
  }

  async listInventoryTransactions(userId: string, filters: InventoryFilters = {}) {
    return this.listInventoryTransactionsFrom(this.pool, userId, filters)
  }

  async listInventoryTransactionsFrom(executor: Executor, userId: string, filters: InventoryFilters = {}) {
    const transactionRows = await rows<SqlRow>(executor, `SELECT transaction_row.*,
        (SELECT reversal.id FROM life_inventory_transactions reversal
         WHERE reversal.user_id = transaction_row.user_id AND reversal.reverses_transaction_id = transaction_row.id LIMIT 1) derived_reversed_by_transaction_id
      FROM life_inventory_transactions transaction_row
      WHERE transaction_row.user_id = ? ${filters.itemId ? 'AND transaction_row.item_id = ?' : ''}
      ORDER BY transaction_row.occurred_at DESC, transaction_row.created_at DESC, transaction_row.id`, filters.itemId ? [userId, filters.itemId] : [userId])
    return this.hydrateTransactions(executor, userId, transactionRows)
  }

  async exportOwnerPortableDataFrom(executor: Executor, userId: string) {
    const batchRows = await rows<SqlRow>(executor,
      'SELECT * FROM life_inventory_batches WHERE user_id = ? ORDER BY created_at, id', [userId])
    return {
      inventoryBatches: batchRows.map((row) => this.mapBatch(row)),
      inventoryTransactions: await this.listInventoryTransactionsFrom(executor, userId),
    }
  }

  async createInventoryTransaction(userId: string, input: CreateInventoryTransactionInput, rawKey: string) {
    return this.idempotently(userId, 'life-inventory:create', rawKey, input, (connection) =>
      this.createInventoryTransactionFrom(connection, userId, input))
  }

  async createInventoryTransactionFrom(connection: PoolConnection, userId: string, input: CreateInventoryTransactionInput) {
    const item = await this.options.getCatalogItemFrom(connection, userId, input.itemId)
    if (!item) throw new LifeInventoryDomainError('NOT_FOUND', 'The catalog item does not exist.', 404)
    const units = await this.options.listUnitsFrom(connection, userId)
    const baseQuantity = this.baseQuantity(item, units, input)
    const delta = inventoryDelta(input.kind, input.kind === 'adjustment' && input.quantity < 0 ? -baseQuantity : baseQuantity)
    const timestamp = this.now()
    const occurredAt = this.validTimestamp(input.occurredAt)
    await this.validateLocation(connection, userId, input.batch?.locationId ?? item.locationId)
    let batchId: string | null = null
    let allocations: InventoryTransaction['allocations'] = []
    if (delta > 0) {
      const batch = this.createBatch(item, input, delta, timestamp)
      await this.insertBatch(connection, userId, batch)
      batchId = batch.id
    } else {
      allocations = await this.consumeFromBatches(connection, userId, item.id, -delta, occurredAt.slice(0, 10))
    }
    const entry: InventoryTransaction = {
      id: this.createId(), itemId: item.id, kind: input.kind, quantity: input.quantity,
      unit: input.unit.trim().toLocaleLowerCase(), baseQuantity: Math.abs(delta), deltaBaseQuantity: delta,
      batchId, occurredAt, reversesTransactionId: null, reversedByTransactionId: null, warning: null,
      note: input.note?.trim() ?? '', allocations, createdAt: timestamp,
    }
    entry.warning = await this.balanceWarning(connection, userId, item.id, entry.deltaBaseQuantity)
    await this.insertTransaction(connection, userId, entry)
    await this.insertAllocations(connection, userId, entry)
    return entry
  }

  async reverseInventoryTransaction(userId: string, id: string, input: ReverseInventoryTransactionInput, rawKey: string) {
    const exists = await rows<SqlRow>(this.pool, 'SELECT id FROM life_inventory_transactions WHERE user_id = ? AND id = ? LIMIT 1', [userId, id])
    if (!exists[0]) return undefined
    return this.idempotently(userId, `life-inventory:reverse:${id}`, rawKey, input, async (connection) => {
      const originals = await rows<SqlRow>(connection, 'SELECT * FROM life_inventory_transactions WHERE user_id = ? AND id = ? LIMIT 1 FOR UPDATE', [userId, id])
      const original = originals[0]
      if (!original) throw new LifeInventoryDomainError('NOT_FOUND', 'The inventory transaction does not exist.', 404)
      if (original.transaction_kind === 'reversal') throw new LifeInventoryDomainError('TRANSACTION_NOT_REVERSIBLE', 'A reversal cannot be reversed directly.', 409)
      const existingReversal = await rows<SqlRow>(connection, 'SELECT id FROM life_inventory_transactions WHERE user_id = ? AND reverses_transaction_id = ? LIMIT 1 FOR UPDATE', [userId, id])
      if (existingReversal[0]) throw new LifeInventoryDomainError('TRANSACTION_ALREADY_REVERSED', 'The inventory transaction already has a reversal.', 409)
      const item = await this.requireItem(userId, String(original.item_id))
      const timestamp = this.now()
      const originalDelta = Number(original.delta_base_quantity)
      const allocations = originalDelta < 0
        ? await this.restoreOriginalAllocations(connection, userId, id)
        : await this.consumeFromBatches(connection, userId, item.id, originalDelta, timestamp.slice(0, 10))
      const reversal: InventoryTransaction = {
        id: this.createId(), itemId: item.id, kind: 'reversal', quantity: Number(original.base_quantity),
        unit: item.baseUnit, baseQuantity: Number(original.base_quantity), deltaBaseQuantity: round(-originalDelta),
        batchId: null, occurredAt: timestamp, reversesTransactionId: id, reversedByTransactionId: null,
        warning: null, note: input.note?.trim() ?? '', allocations, createdAt: timestamp,
      }
      reversal.warning = await this.balanceWarning(connection, userId, item.id, reversal.deltaBaseQuantity)
      await this.insertTransaction(connection, userId, reversal)
      await this.insertAllocations(connection, userId, reversal)
      return reversal
    })
  }

  async listInventoryForecasts(userId: string, filters: InventoryFilters = {}) {
    const balances = await this.listInventoryBalances(userId, filters)
    return balances.map((balance) => buildInventoryForecast({
      itemId: balance.itemId, baseUnit: balance.baseUnit, onHand: balance.onHand,
      plannedDemand: 0, minimumStock: 0, outstandingShopping: 0, packageQuantity: 1,
    }))
  }

  async consumeRecipeIngredients(
    connection: PoolConnection,
    userId: string,
    inputs: Array<{ itemId: string; quantity: number; unit: string }>,
    occurredAt: string,
    cookingSessionId: string,
  ) {
    const units = await this.options.listUnits(userId)
    const created: InventoryTransaction[] = []
    for (const input of inputs) {
      const item = await this.requireItem(userId, input.itemId)
      const baseQuantity = this.baseQuantity(item, units, { ...input, kind: 'consume', occurredAt })
      const allocations = await this.consumeFromBatches(connection, userId, item.id, baseQuantity, occurredAt.slice(0, 10))
      const timestamp = this.now()
      const entry: InventoryTransaction = {
        id: this.createId(), itemId: item.id, kind: 'consume', quantity: input.quantity, unit: input.unit,
        baseQuantity, deltaBaseQuantity: -baseQuantity, batchId: null, occurredAt, reversesTransactionId: null,
        reversedByTransactionId: null, warning: null, note: `Cooking session ${cookingSessionId}`, allocations, createdAt: timestamp,
      }
      entry.warning = await this.balanceWarning(connection, userId, item.id, entry.deltaBaseQuantity)
      await this.insertTransaction(connection, userId, entry)
      await this.insertAllocations(connection, userId, entry)
      created.push(entry)
    }
    return created
  }

  private async hydrateTransactions(executor: Executor, userId: string, transactionRows: SqlRow[]) {
    const ids = transactionRows.map((row) => String(row.id))
    const allocationRows = ids.length ? await rows<SqlRow>(executor, `SELECT a.transaction_id, a.batch_id, a.quantity, b.expires_on
      FROM life_inventory_allocations a JOIN life_inventory_batches b ON b.user_id = a.user_id AND b.id = a.batch_id
      WHERE a.user_id = ? AND a.transaction_id IN (${ids.map(() => '?').join(',')}) ORDER BY a.transaction_id, a.position`, [userId, ...ids]) : []
    return transactionRows.map((row) => ({
      id: String(row.id), itemId: String(row.item_id), kind: row.transaction_kind as InventoryTransaction['kind'],
      quantity: Number(row.quantity), unit: String(row.unit), baseQuantity: Number(row.base_quantity), deltaBaseQuantity: Number(row.delta_base_quantity),
      batchId: row.batch_id == null ? null : String(row.batch_id), occurredAt: iso(row.occurred_at),
      reversesTransactionId: row.reverses_transaction_id == null ? null : String(row.reverses_transaction_id),
      reversedByTransactionId: row.derived_reversed_by_transaction_id == null ? null : String(row.derived_reversed_by_transaction_id),
      warning: row.warning == null ? null : row.warning as InventoryTransaction['warning'], note: String(row.note),
      allocations: allocationRows.filter((allocation) => allocation.transaction_id === row.id).map((allocation) => ({
        batchId: String(allocation.batch_id), quantity: Number(allocation.quantity), expiresOn: dateOnly(allocation.expires_on),
      })), createdAt: iso(row.created_at),
    }))
  }

  private async consumeFromBatches(connection: PoolConnection, userId: string, itemId: string, quantity: number, asOf: string) {
    const batchRows = await rows<SqlRow>(connection, `SELECT * FROM life_inventory_batches
      WHERE user_id = ? AND item_id = ? AND remaining_quantity > 0 AND (expires_on IS NULL OR expires_on >= ?)
      ORDER BY expires_on IS NULL, expires_on, purchased_on, id FOR UPDATE`, [userId, itemId, asOf])
    const batches = batchRows.map((row) => this.mapBatch(row))
    const allocation = allocateEarliestExpiry(batches, quantity, asOf)
    const results: InventoryTransaction['allocations'] = []
    for (const item of allocation.allocations) {
      const batch = batches.find((candidate) => candidate.id === item.batchId)!
      await connection.execute('UPDATE life_inventory_batches SET remaining_quantity = remaining_quantity - ?, version = version + 1 WHERE user_id = ? AND id = ?', [item.quantity, userId, item.batchId])
      results.push({ ...item, expiresOn: batch.expiresOn })
    }
    return results
  }

  private async restoreOriginalAllocations(connection: PoolConnection, userId: string, transactionId: string) {
    const allocationRows = await rows<SqlRow>(connection, `SELECT a.batch_id, a.quantity, b.expires_on FROM life_inventory_allocations a
      JOIN life_inventory_batches b ON b.user_id = a.user_id AND b.id = a.batch_id
      WHERE a.user_id = ? AND a.transaction_id = ? ORDER BY a.position FOR UPDATE`, [userId, transactionId])
    for (const allocation of allocationRows) {
      await connection.execute('UPDATE life_inventory_batches SET remaining_quantity = remaining_quantity + ?, version = version + 1 WHERE user_id = ? AND id = ?', [allocation.quantity, userId, allocation.batch_id])
    }
    return allocationRows.map((allocation) => ({
      batchId: String(allocation.batch_id), quantity: Number(allocation.quantity), expiresOn: dateOnly(allocation.expires_on),
    }))
  }

  private async insertBatch(connection: PoolConnection, userId: string, batch: InventoryBatch) {
    await connection.execute(`INSERT INTO life_inventory_batches
      (id, user_id, item_id, base_unit, original_quantity, remaining_quantity, purchased_on, expires_on, location_id, actual_unit_cost_minor, version, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`, [batch.id, userId, batch.itemId, batch.baseUnit, batch.originalQuantity, batch.remainingQuantity,
      batch.purchasedOn, batch.expiresOn, batch.locationId, batch.actualUnitCostMinor, toSqlDateTime(batch.createdAt)])
  }

  private async insertTransaction(connection: PoolConnection, userId: string, entry: InventoryTransaction) {
    await connection.execute(`INSERT INTO life_inventory_transactions
      (id, user_id, item_id, transaction_kind, quantity, unit, base_quantity, delta_base_quantity, batch_id, occurred_at,
       reverses_transaction_id, warning, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [entry.id, userId, entry.itemId, entry.kind, entry.quantity, entry.unit,
      entry.baseQuantity, entry.deltaBaseQuantity, entry.batchId, toSqlDateTime(entry.occurredAt), entry.reversesTransactionId,
      entry.warning, entry.note, toSqlDateTime(entry.createdAt)])
  }

  private async insertAllocations(connection: PoolConnection, userId: string, entry: InventoryTransaction) {
    for (const [position, allocation] of entry.allocations.entries()) {
      await connection.execute(`INSERT INTO life_inventory_allocations
        (user_id, transaction_id, batch_id, quantity, position, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, entry.id, allocation.batchId, allocation.quantity, position, toSqlDateTime(entry.createdAt)])
    }
  }

  private async balanceWarning(connection: PoolConnection, userId: string, itemId: string, pendingDelta: number) {
    const [row] = await rows<SqlRow>(connection, 'SELECT COALESCE(SUM(delta_base_quantity), 0) total FROM life_inventory_transactions WHERE user_id = ? AND item_id = ?', [userId, itemId])
    return Number(row?.total ?? 0) + pendingDelta < 0 ? 'negative_inventory' as const : null
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
    return { id: this.createId(), itemId: item.id, baseUnit: item.baseUnit, originalQuantity: quantity, remainingQuantity: quantity,
      purchasedOn, expiresOn: batch.expiresOn ?? null, locationId: batch.locationId ?? item.locationId,
      actualUnitCostMinor: batch.actualUnitCostMinor ?? null, createdAt: timestamp }
  }

  private mapBatch(row: SqlRow): InventoryBatch {
    return { id: String(row.id), itemId: String(row.item_id), baseUnit: String(row.base_unit), originalQuantity: Number(row.original_quantity),
      remainingQuantity: Number(row.remaining_quantity), purchasedOn: dateOnly(row.purchased_on), expiresOn: dateOnly(row.expires_on),
      locationId: row.location_id == null ? null : String(row.location_id), actualUnitCostMinor: row.actual_unit_cost_minor == null ? null : Number(row.actual_unit_cost_minor),
      createdAt: iso(row.created_at) }
  }

  private baseQuantity(item: CatalogItem, units: LifeUnit[], input: CreateInventoryTransactionInput) {
    if (!Number.isFinite(input.quantity) || input.quantity === 0 || (input.kind !== 'adjustment' && input.quantity < 0)) {
      throw new LifeInventoryDomainError('INVALID_INPUT', 'Inventory quantity must be positive except for signed adjustments.', 400)
    }
    const converted = convertUnit({ itemId: item.id, quantity: Math.abs(input.quantity), fromUnit: input.unit, toBaseUnit: item.baseUnit,
      itemConversions: item.itemConversions, units: units.map((unit) => ({ code: unit.code, dimension: unit.dimension, baseCode: unit.baseCode, toBaseFactor: unit.toBaseFactor })) })
    if (converted.status === 'incomplete') throw new LifeInventoryDomainError('INCOMPLETE_CONVERSION', `Inventory quantity is incomplete: ${converted.reason}.`, 409)
    return converted.baseQuantity
  }

  private async requireItem(userId: string, itemId: string) {
    const item = await this.options.getCatalogItem(userId, itemId)
    if (!item) throw new LifeInventoryDomainError('NOT_FOUND', 'The catalog item does not exist.', 404)
    return item
  }

  private async validateLocation(connection: PoolConnection, userId: string, locationId: string | null | undefined) {
    if (locationId == null) return
    const values = await rows<SqlRow>(connection, `SELECT id FROM life_locations
      WHERE user_id = ? AND id = ? AND status = 'active' AND deleted_at IS NULL LIMIT 1`, [userId, locationId])
    if (!values[0]) throw new LifeInventoryDomainError('NOT_FOUND', 'The inventory batch location does not exist.', 404)
  }

  private validTimestamp(value: string) {
    const result = new Date(value)
    if (!value || Number.isNaN(result.getTime())) throw new LifeInventoryDomainError('INVALID_DATE', 'occurredAt must be a valid timestamp.', 400)
    return result.toISOString()
  }

  private validDate(value: string, field: string) {
    const parsed = new Date(`${value}T00:00:00.000Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new LifeInventoryDomainError('INVALID_DATE', `${field} must be a valid date-only value.`, 400)
    }
  }

  private async idempotently(
    userId: string,
    scope: string,
    rawKey: string,
    input: unknown,
    create: (connection: PoolConnection) => Promise<InventoryTransaction>,
  ) {
    const key = normalizeInventoryIdempotencyKey(rawKey)
    const hash = requestHash(input)
    const connection = await this.pool.getConnection()
    let open = false
    try {
      await connection.beginTransaction()
      open = true
      const existing = await rows<SqlRow>(connection, 'SELECT request_hash, response_body FROM idempotency_keys WHERE user_id = ? AND scope = ? AND idempotency_key = ? LIMIT 1 FOR UPDATE', [userId, scope, key])
      if (existing[0]) {
        const value = this.replay(existing[0], hash)
        await connection.commit(); open = false
        return value
      }
      const timestamp = this.now()
      try {
        await connection.execute(`INSERT INTO idempotency_keys
          (id, user_id, scope, idempotency_key, request_hash, response_status, response_body, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`, [this.createId(), userId, scope, key, hash, toSqlDateTime(timestamp),
          toSqlDateTime(new Date(Date.parse(timestamp) + 24 * 60 * 60 * 1_000).toISOString())])
      } catch (error) {
        if (!this.duplicate(error)) throw error
        await connection.rollback(); open = false
        const raced = await rows<SqlRow>(this.pool, 'SELECT request_hash, response_body FROM idempotency_keys WHERE user_id = ? AND scope = ? AND idempotency_key = ? LIMIT 1', [userId, scope, key])
        if (!raced[0]) throw error
        return this.replay(raced[0], hash)
      }
      const value = await create(connection)
      await connection.execute('UPDATE idempotency_keys SET response_status = 201, response_body = ? WHERE user_id = ? AND scope = ? AND idempotency_key = ?', [JSON.stringify(value), userId, scope, key])
      await connection.commit(); open = false
      return value
    } catch (error) {
      if (open) await connection.rollback()
      throw this.duplicate(error) && scope.startsWith('life-inventory:reverse:')
        ? new LifeInventoryDomainError('TRANSACTION_ALREADY_REVERSED', 'The inventory transaction already has a reversal.', 409)
        : error
    } finally { connection.release() }
  }

  private replay(row: SqlRow, hash: string): InventoryTransaction {
    if (String(row.request_hash).toUpperCase() !== hash) throw new LifeInventoryDomainError('IDEMPOTENCY_CONFLICT', 'The idempotency key belongs to a different inventory request.', 409)
    if (row.response_body == null) throw new LifeInventoryDomainError('IDEMPOTENCY_CONFLICT', 'The matching inventory request is still in progress.', 409)
    return typeof row.response_body === 'string'
      ? JSON.parse(row.response_body) as InventoryTransaction
      : structuredClone(row.response_body as InventoryTransaction)
  }

  private duplicate(error: unknown) {
    return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ER_DUP_ENTRY')
  }
}
