import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise'
import { ensureBootstrapUser } from './bootstrap.js'
import { runMigrations } from './db/migrate.js'
import { detectScheduleConflicts } from './domain/tasks.js'
import type { CreateCatalogItemInput } from './domain/life/catalog.js'
import { checksumSha256, readStoredZip, stableJson } from './domain/life/commerce.js'
import type { MediaStoragePort, PutMediaInput } from './media/storagePort.js'
import type {
  DayPlan,
  LifePlanItem,
  MedicineRecurrenceOccurrence,
  PlanningCompletionInput,
  PlanningCompletionSnapshot,
  PlanningTimeline,
} from './domain/life/planning.js'
import { hashPassword } from './security/password.js'
import { DataTransferService, type DataTransferOwnedData } from './services/dataTransfer.js'
import type { LifePlanningStore } from './store/lifePlanningStore.js'
import { MemoryLifeStore } from './store/memoryLifeStore.js'
import { MySqlLifeStore } from './store/mysqlLifeStore.js'

const integration = process.env.LIFEOPS_MYSQL_INTEGRATION === 'true'

interface CountRow extends RowDataPacket {
  count: number
}

interface VersionRow extends RowDataPacket {
  version: string
}

interface TableRow extends RowDataPacket {
  tableName: string
  tableCollation: string
}

interface ColumnRow extends RowDataPacket {
  tableName: string
  columnName: string
  columnType: string
  columnDefault: string | number | null
  datetimePrecision: number | null
  isNullable?: string
}

interface ConstraintRow extends RowDataPacket {
  constraintName: string
  constraintType: string
}

interface TriggerRow extends RowDataPacket {
  triggerName: string
  actionTiming: string
  eventManipulation: string
}

interface GoalRecoveryAuditRow extends RowDataPacket {
  id: string
  action: string
  entityType: 'goal' | 'project' | 'milestone'
  entityId: string
  reversesEventId: string | null
  versionBefore: number
  versionAfter: number
}

type OccurrenceTransitionInput = {
  entityVersion: number
  action: 'skip' | 'delay'
  at: string
  scheduledDate?: string
  scheduledTime?: string
}

type OccurrenceCapableStore = MySqlLifeStore & {
  getPlanningTimeline: LifePlanningStore['getPlanningTimeline']
  createPlanningCompletionFromSource: LifePlanningStore['createPlanningCompletionFromSource']
  transitionMedicineOccurrence(
    userId: string,
    occurrenceId: string,
    input: OccurrenceTransitionInput,
    idempotencyKey: string,
  ): Promise<MedicineRecurrenceOccurrence | undefined>
}

type GoalRecoveryCapableStore = MySqlLifeStore & {
  restoreGoal(userId: string, id: string, version: number): Promise<{ id: string; version: number; deletedAt: string | null } | undefined>
  restoreProject(userId: string, id: string, version: number): Promise<{ id: string; version: number; deletedAt: string | null } | undefined>
  restoreMilestone(userId: string, id: string, version: number): Promise<{ id: string; version: number; deletedAt: string | null } | undefined>
}

const withOccurrences = (candidate: MySqlLifeStore | MemoryLifeStore) => candidate as unknown as OccurrenceCapableStore
const withGoalRecovery = (candidate: MySqlLifeStore) => candidate as unknown as GoalRecoveryCapableStore

class IntegrationMediaStorage implements MediaStoragePort {
  private readonly values = new Map<string, Uint8Array>()
  private sequence = 0

  async put(input: PutMediaInput) {
    const storageKey = `integration/${randomUUID()}-${++this.sequence}.png`
    this.values.set(storageKey, new Uint8Array(input.bytes))
    return {
      storageKey,
      mimeType: 'image/png' as const,
      sizeBytes: input.bytes.byteLength,
      checksum: createHash('sha256').update(input.bytes).digest('hex').toUpperCase(),
    }
  }

  async read(storageKey: string) { return this.values.get(storageKey) }
  async remove(storageKey: string) { return this.values.delete(storageKey) }
}

async function rows<T extends RowDataPacket>(pool: Pool, sql: string, values: unknown[] = []) {
  const [result] = await pool.query<T[]>(sql, values)
  return result
}

describe.runIf(integration)('MySQL 8.4 integration', () => {
  let pool: Pool
  let store: MySqlLifeStore

  beforeAll(async () => {
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST ?? '127.0.0.1',
      port: Number(process.env.MYSQL_PORT ?? 3306),
      database: process.env.MYSQL_DATABASE ?? 'lifeops',
      user: process.env.MYSQL_USER ?? 'lifeops',
      password: process.env.MYSQL_PASSWORD ?? '',
      connectionLimit: 4,
      dateStrings: true,
      timezone: 'Z',
    })
    await Promise.all([runMigrations(pool), runMigrations(pool)])
    store = new MySqlLifeStore(pool, { now: () => '2026-08-15T12:00:00.000Z' })
  })

  afterAll(async () => pool?.end())

  it('runs against the required MySQL 8.4.10 release', async () => {
    const [version] = await rows<VersionRow>(pool, 'SELECT VERSION() version')
    expect(version?.version).toBe('8.4.10')
  })

  it('maintains the personal search index inside owner-scoped domain transactions', async () => {
    const stamp = `${Date.now()}`
    const owner = await store.createUser({
      account: `search-${stamp}@example.com`, displayName: 'Search owner', passwordHash: await hashPassword('search-owner-password'),
    })
    const other = await store.createUser({
      account: `search-other-${stamp}@example.com`, displayName: 'Search other', passwordHash: await hashPassword('search-other-password'),
    })
    const goal = await store.createGoal(owner.id, {
      title: `平台验收 100%_${stamp}`,
      description: '正文包含回滚与所有权证据',
    }, `search-goal-${stamp}`)

    expect(await store.search(owner.id, { query: '平台验收', types: ['goal'] })).toEqual([
      expect.objectContaining({ type: 'goal', id: goal.id, title: goal.title, route: `/app/goals?goal=${goal.id}` }),
    ])
    expect(await store.search(other.id, { query: '平台验收' })).toEqual([])
    expect((await store.search(owner.id, { query: '%_', types: ['goal'] })).map((item) => item.id)).toEqual([goal.id])

    const updated = await store.updateGoal(owner.id, goal.id, { title: `交付关闭 ${stamp}`, version: goal.version })
    expect(await store.search(owner.id, { query: '平台验收', types: ['goal'] })).toEqual([])
    expect(await store.search(owner.id, { query: '交付关闭', types: ['goal'] })).toEqual([
      expect.objectContaining({ id: goal.id, title: `交付关闭 ${stamp}` }),
    ])

    const rollbackId = randomUUID()
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      await connection.execute(`INSERT INTO goals
        (id,user_id,title,description,status,priority,progress_mode,manual_progress,version,created_at,updated_at,deleted_at)
        VALUES (?,?,?,'rollback evidence','active',2,'manual',0,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),NULL)`, [rollbackId, owner.id, `不应出现 ${stamp}`])
      await connection.rollback()
    } finally {
      connection.release()
    }
    expect(await store.search(owner.id, { query: '不应出现', types: ['goal'] })).toEqual([])

    expect(await store.deleteGoal(owner.id, goal.id, updated!.version)).toBe(true)
    expect(await store.search(owner.id, { query: '交付关闭', types: ['goal'] })).toEqual([])

    const [migration] = await rows<CountRow>(pool, "SELECT COUNT(*) count FROM schema_migrations WHERE version='015'")
    expect(migration?.count).toBe(1)
    const triggers = await rows<TriggerRow>(pool, `SELECT trigger_name triggerName,action_timing actionTiming,event_manipulation eventManipulation
      FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND trigger_name LIKE 'trg_search_%'`)
    expect(triggers.length).toBeGreaterThanOrEqual(25)
    expect(triggers.every((trigger) => ['BEFORE', 'AFTER'].includes(trigger.actionTiming))).toBe(true)
  })

  it('creates owner-scoped commerce, analytics and portability ledgers with enforced relationships', async () => {
    const commerceTables = [
      'life_inventory_policies',
      'life_shopping_suggestions',
      'life_shopping_suggestion_reasons',
      'life_shopping_items',
      'life_purchases',
      'life_purchase_items',
      'life_refunds',
      'life_refund_items',
      'life_cash_expenditures',
      'life_budgets',
      'life_exports',
      'life_imports',
      'life_commerce_idempotency',
    ]
    const placeholders = commerceTables.map(() => '?').join(', ')
    const tables = await rows<TableRow>(pool, `SELECT table_name tableName, table_collation tableCollation
      FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name IN (${placeholders})`, commerceTables)
    expect(tables.map((row) => row.tableName).sort()).toEqual([...commerceTables].sort())
    expect(tables.every((row) => row.tableCollation === 'utf8mb4_0900_ai_ci')).toBe(true)

    const indexed = await rows<RowDataPacket>(pool, `SELECT DISTINCT table_name tableName
      FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name IN (${placeholders})
        AND seq_in_index = 1 AND column_name = 'user_id'`, commerceTables)
    expect(indexed.map((row) => String(row.tableName)).sort()).toEqual([...commerceTables].sort())

    const millisecondColumns = await rows<ColumnRow>(pool, `SELECT table_name tableName, column_name columnName,
        column_type columnType, column_default columnDefault, datetime_precision datetimePrecision
      FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name IN (${placeholders})
        AND column_name IN ('created_at', 'updated_at', 'purchased_at', 'refunded_at', 'occurred_at')`, commerceTables)
    expect(millisecondColumns.length).toBeGreaterThanOrEqual(commerceTables.length)
    expect(millisecondColumns.every((column) => column.datetimePrecision === 3)).toBe(true)

    const constraints = await rows<RowDataPacket>(pool, `SELECT table_name tableName, constraint_name constraintName,
        constraint_type constraintType
      FROM information_schema.table_constraints
      WHERE table_schema = DATABASE() AND table_name IN (${placeholders})`, commerceTables)
    const names = new Set(constraints.map((row) => String(row.constraintName)))
    for (const required of [
      'uq_life_inventory_policy_user_item',
      'uq_life_shopping_suggestion_user_item_origin',
      'uq_life_shopping_reason_source',
      'fk_life_shopping_reason_suggestion',
      'fk_life_purchase_item_purchase',
      'fk_life_refund_purchase',
      'fk_life_refund_item_purchase_item',
      'fk_life_cash_purchase',
      'fk_life_cash_refund',
    ]) expect(names).toContain(required)
  })

  it('persists one owner-scoped shopping, purchase, refund, budget and analytics lifecycle across reconnects', async () => {
    const stamp = `${Date.now()}`
    const owner = await store.createUser({
      account: `commerce-${stamp}@example.com`,
      displayName: 'Commerce owner',
      passwordHash: await hashPassword('commerce-owner-password'),
    })
    const other = await store.createUser({
      account: `commerce-other-${stamp}@example.com`,
      displayName: 'Commerce other',
      passwordHash: await hashPassword('commerce-other-password'),
    })
    const item = await store.createCatalogItem(owner.id, {
      kind: 'supplement', name: `Dishwasher tablet ${stamp}`, baseUnit: 'each',
      availableUnits: ['each'],
    }, `commerce-item-${stamp}`)
    await expect(store.createShoppingSuggestion(owner.id, {
      itemId: item.id, requiredQuantity: 5, unit: 'each', packageQuantity: 4,
      reason: { kind: 'planned_shortage', sourceType: 'day-plan', sourceId: `day-${stamp}`, requiredOn: '2026-08-20' },
    }, `commerce-suggestion-forged-${stamp}`)).rejects.toMatchObject({ code: 'DERIVED_SHOPPING_FACTS_SERVER_OWNED' })
    const manual = await store.createShoppingSuggestion(owner.id, {
      itemId: item.id, requiredQuantity: 1, unit: 'each', packageQuantity: 1,
      reason: { kind: 'manual', sourceType: 'manual', sourceId: `manual-${stamp}`, requiredOn: null },
    }, `commerce-suggestion-manual-${stamp}`)
    const createdPolicy = await store.upsertInventoryPolicy(owner.id, item.id, {
      minimumStock: 1, packageQuantity: 4, unitId: 'builtin:each',
    }, `commerce-policy-${stamp}`)
    expect(createdPolicy).toMatchObject({ created: true, policy: { itemId: item.id, version: 1, unit: 'each' } })
    const policy = await store.upsertInventoryPolicy(owner.id, item.id, {
      minimumStock: 2, packageQuantity: 4, unitId: 'builtin:each', version: createdPolicy.policy.version,
    }, `commerce-policy-update-${stamp}`)
    expect(policy).toMatchObject({ created: false, policy: { id: createdPolicy.policy.id, itemId: item.id, version: 2, minimumStock: 2 } })
    await expect(store.upsertInventoryPolicy(owner.id, item.id, {
      minimumStock: 3, packageQuantity: 4, unitId: 'builtin:each', version: 1,
    }, `commerce-policy-stale-${stamp}`)).rejects.toMatchObject({
      code: 'VERSION_CONFLICT', details: { current: expect.objectContaining({ id: policy.policy.id, version: 2, minimumStock: 2 }) },
    })
    await expect(store.upsertInventoryPolicy(other.id, item.id, {
      minimumStock: 2, packageQuantity: 4, unitId: 'builtin:each',
    }, `commerce-policy-foreign-${stamp}`)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const day = await store.createDayPlan(owner.id, {
      date: '2026-08-20', mealSlots: [], items: [{
        kind: 'supplement', title: 'Planned dishwasher tablets', mealSlotId: null, scheduledTime: '20:00',
        source: { type: 'catalog-item', id: item.id }, quantity: 5, unit: 'each', servings: null, durationMinutes: null,
      }],
    }, `commerce-day-${stamp}`)
    const recalculationInput = { through: '2026-08-20' }
    const recalculated = await store.recalculateShopping(owner.id, recalculationInput, `commerce-recalculate-${stamp}`)
    expect(await store.recalculateShopping(owner.id, recalculationInput, `commerce-recalculate-${stamp}`)).toEqual(recalculated)
    expect(recalculated).toMatchObject({
      calculations: [{ itemId: item.id, plannedDemand: 5, minimumStock: 2, effectiveStock: 0, outstandingFormalQuantity: 0, rawShortage: 7, suggestedQuantity: 8 }],
      suggestions: [{ origin: 'derived', through: '2026-08-20', itemId: item.id, suggestedQuantity: 8,
        reasons: [expect.objectContaining({ sourceId: day.items[0]!.id }), expect.objectContaining({ sourceId: policy.policy.id })] }],
    })
    expect(await store.listShopping(owner.id)).toMatchObject({
      suggestions: expect.arrayContaining([
        expect.objectContaining({ id: manual.id, origin: 'manual' }),
        expect.objectContaining({ origin: 'derived', itemId: item.id, suggestedQuantity: 8 }),
      ]),
      formalItems: [],
    })

    const formal = await store.createShoppingItem(owner.id, {
      itemId: item.id, requestedQuantity: 4, unit: 'each', neededOn: '2026-08-20', priority: 'normal', storeGroup: 'Household',
    }, `commerce-formal-${stamp}`)
    const purchaseInput = {
      purchasedAt: '2026-08-14T08:00:00.000Z', currency: 'CNY', storeName: 'Local market',
      items: [{ shoppingItemId: formal.id, itemId: item.id, quantity: 2, unit: 'each', amountMinor: 600, updateCurrentPrice: true }],
    }
    const purchase = await store.createPurchase(owner.id, purchaseInput, `commerce-purchase-${stamp}`)
    expect(await store.createPurchase(owner.id, purchaseInput, `commerce-purchase-${stamp}`)).toEqual(purchase)
    expect(purchase).toMatchObject({
      purchase: { totalAmountMinor: 600, currency: 'CNY' },
      cashExpenditure: { amountMinor: 600, sourceType: 'purchase' },
      shoppingItems: [{ id: formal.id, status: 'partial', remainingQuantity: 2 }],
      inventoryTransactions: [{ itemId: item.id, kind: 'purchase', quantity: 2 }],
    })

    const reconnected = new MySqlLifeStore(pool, { now: () => '2026-08-15T12:00:00.000Z' })
    expect(await reconnected.listInventoryPolicies(owner.id)).toEqual([
      expect.objectContaining({ id: policy.policy.id, itemId: item.id, version: 2, unitId: 'builtin:each' }),
    ])
    expect(await reconnected.recalculateShopping(owner.id, recalculationInput, `commerce-recalculate-after-purchase-${stamp}`)).toMatchObject({
      calculations: [{ itemId: item.id, effectiveStock: 2, outstandingFormalQuantity: 2, rawShortage: 3, suggestedQuantity: 4 }],
    })
    expect(await reconnected.listShopping(owner.id)).toMatchObject({
      suggestions: expect.arrayContaining([
        expect.objectContaining({ id: manual.id, origin: 'manual' }),
        expect.objectContaining({ origin: 'derived', itemId: item.id, suggestedQuantity: 4 }),
      ]),
      formalItems: [{ id: formal.id, status: 'partial', purchasedQuantity: 2, remainingQuantity: 2 }],
    })
    expect((await reconnected.listInventoryBalances(owner.id)).find((entry) => entry.itemId === item.id)?.onHand).toBe(2)
    expect((await reconnected.getCatalogItem(owner.id, item.id))?.pricePoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ amountMinor: 600, purchaseQuantity: 2, purchaseUnit: 'each', effectiveFrom: '2026-08-14' }),
    ]))

    const refundInput = {
      refundedAt: '2026-08-14T10:00:00.000Z',
      items: [{ purchaseItemId: purchase.items[0]!.id, quantity: 1, amountMinor: 300 }],
      note: 'Returned one unopened item',
    }
    const refund = await reconnected.createRefund(owner.id, purchase.purchase.id, refundInput, `commerce-refund-${stamp}`)
    expect(await reconnected.createRefund(owner.id, purchase.purchase.id, refundInput, `commerce-refund-${stamp}`)).toEqual(refund)
    expect(refund).toMatchObject({
      refund: { purchaseId: purchase.purchase.id, totalAmountMinor: 300 },
      cashExpenditure: { amountMinor: -300, sourceType: 'refund' },
      inventoryTransactions: [{ itemId: item.id, kind: 'return', quantity: 1 }],
    })
    expect((await reconnected.listInventoryBalances(owner.id)).find((entry) => entry.itemId === item.id)?.onHand).toBe(1)

    const budget = await reconnected.createBudget(owner.id, {
      name: 'August household', scope: { kind: 'all-life' },
      period: { kind: 'monthly', startsOn: '2026-08-01', endsOn: '2026-08-31' },
      limitMinor: 500, thresholds: [0.5, 0.8, 1], rolloverMinor: 0,
    }, `commerce-budget-${stamp}`)
    expect(await reconnected.listBudgetSummaries(owner.id, '2026-08-14')).toEqual([
      expect.objectContaining({ id: budget.id, spentMinor: 300, remainingMinor: 200, thresholdStatus: 'warning', forecast: { status: 'insufficient-data' } }),
    ])
    expect(await reconnected.getLifeAnalytics(owner.id, '2026-08-14', '2026-08-14')).toMatchObject({
      totals: { cashExpenditureMinor: 300, consumptionCostMinor: 0 },
      drillDown: { cashExpenditure: [
        expect.objectContaining({ sourceType: 'purchase', sourceId: purchase.purchase.id, amountMinor: 600 }),
        expect.objectContaining({ sourceType: 'refund', sourceId: refund!.refund.id, amountMinor: -300 }),
      ] },
    })
    expect(await reconnected.listShopping(other.id)).toEqual({ suggestions: [], formalItems: [] })
    expect(await reconnected.listInventoryPolicies(other.id)).toEqual([])
    expect(await reconnected.listBudgetSummaries(other.id, '2026-08-14')).toEqual([])
  })

  it('rejects direct mutation of every immutable commerce evidence row', async () => {
    const stamp = `${Date.now()}`
    const owner = await store.createUser({
      account: `commerce-immutable-${stamp}@example.com`,
      displayName: 'Commerce immutable owner',
      passwordHash: await hashPassword('commerce-immutable-password'),
    })
    const item = await store.createCatalogItem(owner.id, {
      kind: 'household_consumable', name: `Immutable item ${stamp}`, baseUnit: 'each',
      availableUnits: ['each'],
    }, `commerce-immutable-item-${stamp}`)
    const purchase = await store.createPurchase(owner.id, {
      purchasedAt: '2026-08-14T08:00:00.000Z', currency: 'CNY', storeName: 'Immutable store',
      items: [{ itemId: item.id, quantity: 2, unit: 'each', amountMinor: 200 }],
    }, `commerce-immutable-purchase-${stamp}`)
    const refund = await store.createRefund(owner.id, purchase.purchase.id, {
      refundedAt: '2026-08-14T09:00:00.000Z', note: 'Immutable refund',
      items: [{ purchaseItemId: purchase.items[0]!.id, quantity: 1, amountMinor: 100 }],
    }, `commerce-immutable-refund-${stamp}`)
    const exported = await store.createLifeExport(owner.id, {
      format: 'json', includeAttachments: false,
    }, `commerce-immutable-export-${stamp}`)

    const immutableRows = [
      ['life_purchases', purchase.purchase.id, 'store_name'],
      ['life_purchase_items', purchase.items[0]!.id, 'amount_minor'],
      ['life_refunds', refund!.refund.id, 'note'],
      ['life_refund_items', refund!.items[0]!.id, 'amount_minor'],
      ['life_cash_expenditures', purchase.cashExpenditure.id, 'amount_minor'],
      ['life_exports', exported.id, 'checksum_sha256'],
    ] as const
    for (const [table, id, column] of immutableRows) {
      await expect(pool.execute(`UPDATE ${table} SET ${column}=${column} WHERE user_id=? AND id=?`, [owner.id,id]))
        .rejects.toMatchObject({ code: 'ER_SIGNAL_EXCEPTION' })
      await expect(pool.execute(`DELETE FROM ${table} WHERE user_id=? AND id=?`, [owner.id,id]))
        .rejects.toMatchObject({ code: 'ER_SIGNAL_EXCEPTION' })
    }
  })

  it('round-trips referenced attachment bytes through a verified ZIP and MySQL replace restore', async () => {
    const stamp = `${Date.now()}`
    const mediaStorage = new IntegrationMediaStorage()
    const subject = new MySqlLifeStore(pool, { mediaStorage })
    const owner = await subject.createUser({
      account: `commerce-media-${stamp}@example.com`, displayName: 'Commerce media owner',
      passwordHash: await hashPassword('commerce-media-password'),
    })
    const bytes = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x01])
    const stored = await mediaStorage.put({ originalName: 'portable.png', mimeType: 'image/png', bytes })
    const media = await subject.createMediaAsset(owner.id, {
      originalName: 'portable.png', mimeType: stored.mimeType, sizeBytes: stored.sizeBytes,
      storageKey: stored.storageKey, checksum: stored.checksum, width: 1, height: 1,
    }, `commerce-media-asset-${stamp}`)
    const item = await subject.createCatalogItem(owner.id, {
      kind: 'ingredient', name: `Attached ingredient ${stamp}`, baseUnit: 'gram', availableUnits: ['gram'],
      attachments: [{ mediaId: media.id, caption: 'Portable source photo' }],
    }, `commerce-media-item-${stamp}`)
    const exported = await subject.createLifeExport(owner.id, {
      format: 'zip', includeAttachments: true,
    }, `commerce-media-export-${stamp}`)
    expect(exported.archiveEntries).toEqual(['manifest.json','lifeops.json',`attachments/${media.id}.png`])
    const archiveEntries = readStoredZip(Buffer.from(exported.archiveBase64!, 'base64'))
    expect(archiveEntries.get(`attachments/${media.id}.png`)).toEqual(bytes)

    await pool.execute('DELETE FROM life_item_attachments WHERE user_id=? AND item_id=?', [owner.id,item.id])
    await pool.execute('DELETE FROM life_item_profiles WHERE user_id=? AND item_id=?', [owner.id,item.id])
    await pool.execute('DELETE FROM life_items WHERE user_id=? AND id=?', [owner.id,item.id])
    await pool.execute('DELETE FROM media_assets WHERE user_id=? AND id=?', [owner.id,media.id])

    const preview = await subject.previewLifeImport(owner.id, {
      formatVersion: exported.formatVersion, checksumSha256: exported.checksumSha256,
      archiveBase64: exported.archiveBase64, mode: 'replace',
    }, `commerce-media-preview-${stamp}`)
    expect(preview).toMatchObject({ status: 'ready', conflicts: [], errors: [] })
    await expect(subject.applyLifeImport(owner.id, preview.id, [], `commerce-media-apply-${stamp}`))
      .resolves.toMatchObject({ status: 'applied' })
    expect(await subject.getCatalogItem(owner.id,item.id)).toMatchObject({
      attachments: [{ mediaId: media.id, caption: 'Portable source photo' }],
    })
    const restoredMedia = await subject.getMediaAsset(owner.id,media.id)
    expect(restoredMedia).toMatchObject({ id: media.id, checksum: stored.checksum, sizeBytes: bytes.length })
    expect(Buffer.from((await mediaStorage.read(restoredMedia!.storageKey))!)).toEqual(bytes)
  })

  it('exports inventory, day-plan and immutable completion facts with MySQL parity', async () => {
    const stamp = `${Date.now()}`
    const owner = await store.createUser({
      account: `commerce-export-${stamp}@example.com`,
      displayName: 'Commerce export owner',
      passwordHash: await hashPassword('commerce-export-password'),
    })
    const supplement = await store.createCatalogItem(owner.id, {
      kind: 'supplement', name: `Portable supplement ${stamp}`, baseUnit: 'each',
      availableUnits: ['each'],
      pricePoints: [{
        amountMinor: 500, currency: 'CNY', purchaseQuantity: 5, purchaseUnit: 'each',
        effectiveFrom: '2026-08-01',
      }],
    }, `commerce-export-item-${stamp}`)
    const portablePolicy = await store.upsertInventoryPolicy(owner.id, supplement.id, {
      minimumStock: 2, packageQuantity: 4, unitId: 'builtin:each',
    }, `commerce-export-policy-${stamp}`)
    const stocked = await store.createInventoryTransaction(owner.id, {
      itemId: supplement.id, kind: 'purchase', quantity: 5, unit: 'each',
      occurredAt: '2026-08-13T08:00:00.000Z', batch: { actualUnitCostMinor: 100 },
    }, `commerce-export-stock-${stamp}`)
    const day = await store.createDayPlan(owner.id, {
      date: '2026-08-14', mealSlots: [], items: [{
        kind: 'supplement', title: 'Portable supplement', mealSlotId: null,
        scheduledTime: '09:00', source: { type: 'catalog-item', id: supplement.id },
        quantity: 1, unit: 'each', servings: null, durationMinutes: null,
      }],
    }, `commerce-export-day-${stamp}`)
    const completion = await store.createPlanningCompletion(owner.id, {
      date: day.date, dayPlanItemId: day.items[0]!.id,
      completedAt: '2026-08-14T09:05:00.000Z',
    }, `commerce-export-completion-${stamp}`)
    const formal = await store.createShoppingItem(owner.id, {
      itemId: supplement.id, requestedQuantity: 2, unit: 'each', neededOn: '2026-08-15',
      priority: 'high', storeGroup: 'Pharmacy',
    }, `commerce-export-formal-${stamp}`)
    const portablePurchase = await store.createPurchase(owner.id, {
      purchasedAt: '2026-08-14T10:00:00.000Z', currency: 'CNY', storeName: 'Portable store',
      items: [{ shoppingItemId: formal.id, itemId: supplement.id, quantity: 2, unit: 'each', amountMinor: 220, updateCurrentPrice: true }],
    }, `commerce-export-purchase-${stamp}`)
    await store.createRefund(owner.id, portablePurchase.purchase.id, {
      refundedAt: '2026-08-14T11:00:00.000Z', note: 'Portable refund',
      items: [{ purchaseItemId: portablePurchase.items[0]!.id, quantity: 1, amountMinor: 110 }],
    }, `commerce-export-refund-${stamp}`)
    await store.createBudget(owner.id, {
      name: 'Portable budget', scope: { kind: 'item', itemIds: [supplement.id] },
      period: { kind: 'monthly', startsOn: '2026-08-01', endsOn: '2026-08-31' },
      limitMinor: 1_000, thresholds: [0.5, 0.8, 1], rolloverMinor: 0,
    }, `commerce-export-budget-${stamp}`)
    const ingredient = await store.createCatalogItem(owner.id, {
      kind: 'ingredient', name: `Portable ingredient ${stamp}`, baseUnit: 'gram', availableUnits: ['gram'],
    }, `commerce-export-ingredient-${stamp}`)
    const recipe = await store.createRecipe(owner.id, {
      name: `Portable recipe ${stamp}`, description: 'Portable recipe graph', coverMediaId: null,
      servings: 1, yieldQuantity: 1, yieldUnit: 'portion',
      components: [{ itemId: ingredient.id, quantity: 10, unit: 'gram', role: 'ingredient', position: 0 }],
      steps: [{ instruction: 'Mix.', ingredientItemIds: [ingredient.id], durationSeconds: null, imageMediaId: null, caution: '', position: 0 }],
    }, `commerce-export-recipe-${stamp}`)
    await store.createCookingSession(owner.id, {
      recipeId: recipe.id, plannedServings: 1, note: 'Portable active session',
    }, `commerce-export-cooking-${stamp}`)
    await store.createFitnessActivity(owner.id, {
      name: `Portable walk ${stamp}`, defaultMinutes: 30, kcalPerHour: 180,
      intensity: 'light', steps: ['Walk'], equipment: [],
    }, `commerce-export-fitness-${stamp}`)
    await store.createPlanTemplate(owner.id, {
      name: `Portable template ${stamp}`, mealSlots: [], items: [{
        kind: 'supplement', title: 'Portable template supplement', mealSlotId: null, scheduledTime: '08:30',
        weekdays: [1], source: { type: 'catalog-item', id: supplement.id }, quantity: 1, unit: 'each',
        servings: null, durationMinutes: null,
      }],
    }, `commerce-export-template-${stamp}`)
    const medicine = await store.createCatalogItem(owner.id, {
      kind: 'medicine', name: `Portable medicine ${stamp}`, baseUnit: 'tablet', availableUnits: ['tablet'],
    }, `commerce-export-medicine-${stamp}`)
    await store.createMedicineRecurrenceRule(owner.id, {
      title: 'Portable factual schedule', sourceId: medicine.id, quantity: 1, unit: 'tablet',
      recurrence: { mode: 'weekdays', weekdays: [5], times: ['08:00'], startDate: '2026-08-14', endDate: '2026-08-21' },
    }, `commerce-export-medicine-rule-${stamp}`)

    const exported = await store.createLifeExport(owner.id, {
      format: 'json', includeAttachments: false,
    }, `commerce-export-business-${stamp}`)
    expect(exported.payload?.inventoryPolicies).toEqual([
      expect.objectContaining({ id: portablePolicy.policy.id, itemId: supplement.id, version: 1 }),
    ])
    expect(exported.payload?.inventoryTransactions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: stocked.id, itemId: supplement.id, kind: 'purchase' }),
      expect.objectContaining({ itemId: supplement.id, kind: 'consume' }),
    ]))
    expect(exported.payload?.dayPlans).toEqual([
      expect.objectContaining({ id: day.id, date: day.date }),
    ])
    expect(exported.payload?.completionSnapshots).toEqual([
      expect.objectContaining({ id: completion.id, dayPlanId: day.id, costMinor: 100 }),
    ])
    expect(exported.payload?.recipes).toEqual([expect.objectContaining({ id: recipe.id })])
    expect(exported.payload?.cookingSessions).toEqual([expect.objectContaining({ recipeId: recipe.id, status: 'active' })])
    expect(exported.payload?.planTemplates).toHaveLength(1)
    expect(exported.payload?.fitnessActivities).toHaveLength(1)
    expect(exported.payload?.medicineRecurrenceRules).toHaveLength(1)
    expect(exported.payload?.medicineOccurrences).not.toHaveLength(0)

    const extra = await store.createCatalogItem(owner.id, {
      kind: 'ingredient', name: `Must disappear ${stamp}`, baseUnit: 'gram', availableUnits: ['gram'],
    }, `commerce-export-extra-${stamp}`)
    await store.createInventoryTransaction(owner.id, {
      itemId: extra.id, kind: 'purchase', quantity: 50, unit: 'gram', occurredAt: '2026-08-14T10:00:00.000Z',
    }, `commerce-export-extra-stock-${stamp}`)
    await store.createPurchase(owner.id, {
      purchasedAt: '2026-08-14T10:30:00.000Z', currency: 'CNY', storeName: 'Must disappear store',
      items: [{ itemId: extra.id, quantity: 25, unit: 'gram', amountMinor: 75 }],
    }, `commerce-export-extra-purchase-${stamp}`)
    const currentSupplement = await store.getCatalogItem(owner.id, supplement.id)
    await store.updateCatalogItem(owner.id, supplement.id, {
      version: currentSupplement!.version, name: `Changed after backup ${stamp}`,
    })
    const preview = await store.previewLifeImport(owner.id, {
      formatVersion: 1, checksumSha256: exported.checksumSha256,
      canonicalJson: exported.canonicalJson!, mode: 'replace',
    }, `commerce-export-restore-preview-${stamp}`)
    expect(preview.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: 'catalog-item', entityId: supplement.id }),
      expect.objectContaining({ entityType: 'catalog-item', entityId: ingredient.id }),
      expect.objectContaining({ entityType: 'catalog-item', entityId: medicine.id }),
    ]))
    const applied = await store.applyLifeImport(owner.id, preview.id, preview.conflicts.map((conflict) => ({
      entityType: conflict.entityType, entityId: conflict.entityId, resolution: 'use-imported',
    })), `commerce-export-restore-apply-${stamp}`)
    const expectedAppliedRows = Object.values(exported.payload!).reduce(
      (total, value) => total + (Array.isArray(value) ? value.length : 0), 0,
    )
    expect(applied).toMatchObject({
      status: 'applied', restorePointExportId: expect.any(String), appliedRows: expectedAppliedRows,
    })
    expect(await store.getCatalogItem(owner.id, extra.id)).toBeUndefined()
    const verified = await store.createLifeExport(owner.id, {
      format: 'json', includeAttachments: false,
    }, `commerce-export-restore-verify-${stamp}`)
    expect(verified.canonicalJson).toBe(exported.canonicalJson)
  })

  it('rolls back every purchase effect and releases its idempotency key when cash persistence fails', async () => {
    const stamp = `${Date.now()}`
    const owner = await store.createUser({
      account: `commerce-rollback-${stamp}@example.com`,
      displayName: 'Commerce rollback owner',
      passwordHash: await hashPassword('commerce-rollback-password'),
    })
    const item = await store.createCatalogItem(owner.id, {
      kind: 'household_consumable', name: `Rollback item ${stamp}`, baseUnit: 'each',
      availableUnits: ['each'],
    }, `commerce-rollback-item-${stamp}`)
    const shopping = await store.createShoppingItem(owner.id, {
      itemId: item.id, requestedQuantity: 2, unit: 'each', neededOn: null,
      priority: 'normal', storeGroup: 'Rollback',
    }, `commerce-rollback-shopping-${stamp}`)
    const purchaseInput = {
      purchasedAt: '2026-08-14T08:00:00.000Z', currency: 'CNY', storeName: 'Rollback store',
      items: [{ shoppingItemId: shopping.id, itemId: item.id, quantity: 1, unit: 'each', amountMinor: 125, updateCurrentPrice: true }],
    }
    const key = `commerce-rollback-purchase-${stamp}`
    await pool.query('DROP TRIGGER IF EXISTS trg_test_commerce_cash_fail')
    await pool.query(`CREATE TRIGGER trg_test_commerce_cash_fail BEFORE INSERT ON life_cash_expenditures
      FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test commerce cash failure'`)
    try {
      await expect(store.createPurchase(owner.id, purchaseInput, key)).rejects.toMatchObject({ code: 'ER_SIGNAL_EXCEPTION' })
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS trg_test_commerce_cash_fail')
    }

    expect(await store.listShopping(owner.id)).toMatchObject({
      formalItems: [expect.objectContaining({ id: shopping.id, status: 'added', purchasedQuantity: 0, remainingQuantity: 2 })],
    })
    expect((await store.listInventoryBalances(owner.id)).find((entry) => entry.itemId === item.id)).toBeUndefined()
    expect((await store.getCatalogItem(owner.id, item.id))?.pricePoints).toEqual([])
    expect(await store.getLifeAnalytics(owner.id, '2026-08-14', '2026-08-14')).toMatchObject({
      totals: { cashExpenditureMinor: 0, consumptionCostMinor: 0 },
    })
    const [idempotencyCount] = await rows<CountRow>(pool, `SELECT COUNT(*) count FROM life_commerce_idempotency
      WHERE user_id=? AND operation_key='purchase:create' AND idempotency_key=?`, [owner.id, key])
    expect(Number(idempotencyCount?.count)).toBe(0)

    const retried = await store.createPurchase(owner.id, purchaseInput, key)
    expect(retried).toMatchObject({
      purchase: { totalAmountMinor: 125 }, cashExpenditure: { amountMinor: 125 },
      inventoryTransactions: [expect.objectContaining({ itemId: item.id, kind: 'purchase' })],
      shoppingItems: [expect.objectContaining({ id: shopping.id, status: 'partial', remainingQuantity: 1 })],
    })
  })

  it('rolls back derived replacement and its idempotency row when recalculation fails after deleting old reasons', async () => {
    const stamp = `${Date.now()}`
    const owner = await store.createUser({
      account: `commerce-recalculate-rollback-${stamp}@example.com`, displayName: 'Recalculation rollback owner',
      passwordHash: await hashPassword('commerce-recalculate-rollback-password'),
    })
    const item = await store.createCatalogItem(owner.id, {
      kind: 'supplement', name: `Recalculation rollback item ${stamp}`, baseUnit: 'each', availableUnits: ['each'],
    }, `commerce-recalculate-rollback-item-${stamp}`)
    const policy = await store.upsertInventoryPolicy(owner.id, item.id, {
      minimumStock: 1, packageQuantity: 4, unitId: 'builtin:each',
    }, `commerce-recalculate-rollback-policy-${stamp}`)
    await store.createDayPlan(owner.id, {
      date: '2026-08-20', mealSlots: [], items: [{
        kind: 'supplement', title: 'Rollback planned demand', mealSlotId: null, scheduledTime: '09:00',
        source: { type: 'catalog-item', id: item.id }, quantity: 5, unit: 'each', servings: null, durationMinutes: null,
      }],
    }, `commerce-recalculate-rollback-day-${stamp}`)
    const input = { through: '2026-08-20' }
    await store.recalculateShopping(owner.id, input, `commerce-recalculate-rollback-before-${stamp}`)
    const before = await store.listShopping(owner.id)
    await store.upsertInventoryPolicy(owner.id, item.id, {
      minimumStock: 6, packageQuantity: 4, unitId: 'builtin:each', version: policy.policy.version,
    }, `commerce-recalculate-rollback-policy-update-${stamp}`)
    const key = `commerce-recalculate-rollback-failing-${stamp}`
    await pool.query('DROP TRIGGER IF EXISTS trg_test_recalculate_reason_fail')
    await pool.query(`CREATE TRIGGER trg_test_recalculate_reason_fail BEFORE INSERT ON life_shopping_suggestion_reasons
      FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test recalculation reason failure'`)
    try {
      await expect(store.recalculateShopping(owner.id, input, key)).rejects.toMatchObject({ code: 'ER_SIGNAL_EXCEPTION' })
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS trg_test_recalculate_reason_fail')
    }
    expect(await store.listShopping(owner.id)).toEqual(before)
    const [idempotencyCount] = await rows<CountRow>(pool, `SELECT COUNT(*) count FROM life_commerce_idempotency
      WHERE user_id=? AND operation_key='shopping:recalculate' AND idempotency_key=?`, [owner.id, key])
    expect(Number(idempotencyCount?.count)).toBe(0)
    await expect(store.recalculateShopping(owner.id, input, key)).resolves.toMatchObject({
      calculations: [{ itemId: item.id, minimumStock: 6, rawShortage: 11, suggestedQuantity: 12 }],
      suggestions: [{ itemId: item.id, suggestedQuantity: 12 }],
    })
  })

  it('serializes concurrent owner inventory writes around one consistent shopping recalculation snapshot', async () => {
    const stamp = `${Date.now()}`
    const owner = await store.createUser({
      account: `commerce-recalculate-concurrency-${stamp}@example.com`, displayName: 'Recalculation concurrency owner',
      passwordHash: await hashPassword('commerce-recalculate-concurrency-password'),
    })
    const item = await store.createCatalogItem(owner.id, {
      kind: 'supplement', name: `Recalculation concurrency item ${stamp}`, baseUnit: 'each', availableUnits: ['each'],
    }, `commerce-recalculate-concurrency-item-${stamp}`)
    await store.upsertInventoryPolicy(owner.id, item.id, {
      minimumStock: 2, packageQuantity: 4, unitId: 'builtin:each',
    }, `commerce-recalculate-concurrency-policy-${stamp}`)
    await store.createInventoryTransaction(owner.id, {
      itemId: item.id, kind: 'purchase', quantity: 1, unit: 'each', occurredAt: '2026-08-14T08:00:00.000Z',
    }, `commerce-recalculate-concurrency-stock-before-${stamp}`)
    await store.createDayPlan(owner.id, {
      date: '2026-08-20', mealSlots: [], items: [{
        kind: 'supplement', title: 'Concurrent planned demand', mealSlotId: null, scheduledTime: '09:00',
        source: { type: 'catalog-item', id: item.id }, quantity: 5, unit: 'each', servings: null, durationMinutes: null,
      }],
    }, `commerce-recalculate-concurrency-day-${stamp}`)
    await pool.query('DROP TRIGGER IF EXISTS trg_test_recalculate_reason_pause')
    await pool.query(`CREATE TRIGGER trg_test_recalculate_reason_pause BEFORE INSERT ON life_shopping_suggestion_reasons
      FOR EACH ROW BEGIN DO SLEEP(0.3); END`)
    let concurrentWrite: Promise<unknown> | undefined
    try {
      const input = { through: '2026-08-20' }
      const recalculation = store.recalculateShopping(owner.id, input, `commerce-recalculate-concurrency-before-${stamp}`)
      let holder: number | null = null
      for (let attempt = 0; attempt < 100 && holder == null; attempt += 1) {
        const [lock] = await rows<RowDataPacket & { holder: number | null }>(pool, 'SELECT IS_USED_LOCK(?) holder', [`lifeops:owner:${owner.id}`])
        holder = lock?.holder == null ? null : Number(lock.holder)
        if (holder == null) await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(holder).not.toBeNull()
      let writeSettled = false
      concurrentWrite = store.createInventoryTransaction(owner.id, {
        itemId: item.id, kind: 'purchase', quantity: 4, unit: 'each', occurredAt: '2026-08-14T09:00:00.000Z',
      }, `commerce-recalculate-concurrency-stock-after-${stamp}`).finally(() => { writeSettled = true })
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(writeSettled).toBe(false)
      await expect(recalculation).resolves.toMatchObject({
        calculations: [{ itemId: item.id, effectiveStock: 1, rawShortage: 6, suggestedQuantity: 8 }],
      })
      await concurrentWrite
      concurrentWrite = undefined
    } finally {
      await concurrentWrite
      await pool.query('DROP TRIGGER IF EXISTS trg_test_recalculate_reason_pause')
    }
    await expect(store.recalculateShopping(owner.id, { through: '2026-08-20' }, `commerce-recalculate-concurrency-after-${stamp}`))
      .resolves.toMatchObject({ calculations: [{ itemId: item.id, effectiveStock: 5, rawShortage: 2, suggestedQuantity: 4 }] })
  })

  it('preserves an indivisible purchase amount as fractional per-unit actual cost without changing cash', async () => {
    const stamp = `${Date.now()}`
    const owner = await store.createUser({
      account: `commerce-fractional-cost-${stamp}@example.com`, displayName: 'Fractional cost owner',
      passwordHash: await hashPassword('commerce-fractional-cost-password'),
    })
    const item = await store.createCatalogItem(owner.id, {
      kind: 'supplement', name: `Three for one yuan ${stamp}`, baseUnit: 'each', availableUnits: ['each'],
    }, `commerce-fractional-item-${stamp}`)
    const purchased = await store.createPurchase(owner.id, {
      purchasedAt: '2026-08-14T08:00:00.000Z', currency: 'CNY',
      items: [{ itemId: item.id, quantity: 3, unit: 'each', amountMinor: 100, updateCurrentPrice: false }],
    }, `commerce-fractional-purchase-${stamp}`)
    expect(purchased.purchase.totalAmountMinor).toBe(100)
    expect(purchased.cashExpenditure.amountMinor).toBe(100)
    const batches = await rows<RowDataPacket & { actualUnitCostMinor: string }>(pool,
      'SELECT actual_unit_cost_minor actualUnitCostMinor FROM life_inventory_batches WHERE user_id=? AND item_id=?',
      [owner.id, item.id],
    )
    expect(batches).toHaveLength(1)
    expect(Number(batches[0]!.actualUnitCostMinor)).toBeCloseTo(100 / 3, 8)

    const day = await store.createDayPlan(owner.id, {
      date: '2026-08-14', mealSlots: [], items: [{
        kind: 'supplement', title: 'Consume one', mealSlotId: null, scheduledTime: '09:00',
        source: { type: 'catalog-item', id: item.id }, quantity: 1, unit: 'each', servings: null, durationMinutes: null,
      }],
    }, `commerce-fractional-day-${stamp}`)
    const completion = await store.createPlanningCompletion(owner.id, {
      date: day.date, dayPlanItemId: day.items[0]!.id, completedAt: '2026-08-14T09:00:00.000Z',
    }, `commerce-fractional-completion-${stamp}`)
    expect(completion.costMinor).toBeCloseTo(100 / 3, 8)
    expect(await new MySqlLifeStore(pool).getLifeAnalytics(owner.id, '2026-08-14', '2026-08-14')).toMatchObject({
      totals: { cashExpenditureMinor: 100, consumptionCostMinor: expect.closeTo(100 / 3, 8) },
    })
  })

  it('persists item, category and custom budget scope semantics across reconnects', async () => {
    const stamp = `${Date.now()}`
    const owner = await store.createUser({
      account: `commerce-budget-scope-${stamp}@example.com`, displayName: 'Budget scope owner',
      passwordHash: await hashPassword('commerce-budget-scope-password'),
    })
    const category = await store.createTaxonomy(owner.id, 'category', { name: `Scoped category ${stamp}` })
    const included = await store.createCatalogItem(owner.id, {
      kind: 'supplement', name: `Scoped included ${stamp}`, baseUnit: 'each', availableUnits: ['each'],
      categoryId: category.id,
    }, `commerce-budget-included-${stamp}`)
    const excluded = await store.createCatalogItem(owner.id, {
      kind: 'supplement', name: `Scoped excluded ${stamp}`, baseUnit: 'each', availableUnits: ['each'],
    }, `commerce-budget-excluded-${stamp}`)
    await store.createPurchase(owner.id, {
      purchasedAt: '2026-08-14T08:00:00.000Z', currency: 'CNY',
      items: [{ itemId: included.id, quantity: 1, unit: 'each', amountMinor: 300, updateCurrentPrice: false }],
    }, `commerce-budget-purchase-included-${stamp}`)
    await store.createPurchase(owner.id, {
      purchasedAt: '2026-08-14T09:00:00.000Z', currency: 'CNY',
      items: [{ itemId: excluded.id, quantity: 1, unit: 'each', amountMinor: 700, updateCurrentPrice: false }],
    }, `commerce-budget-purchase-excluded-${stamp}`)
    for (const [name, scope] of [
      ['Item scope', { kind: 'item', itemIds: [included.id] }],
      ['Category scope', { kind: 'category', categoryIds: [category.id] }],
      ['Custom scope', { kind: 'custom', itemIds: [excluded.id], categoryIds: [category.id] }],
    ] as const) {
      await store.createBudget(owner.id, {
        name, scope, period: { kind: 'monthly', startsOn: '2026-08-01', endsOn: '2026-08-31' },
        limitMinor: 2_000, thresholds: [0.5, 0.8, 1], rolloverMinor: 0,
      }, `commerce-budget-${name}-${stamp}`)
    }
    expect((await new MySqlLifeStore(pool).listBudgetSummaries(owner.id, '2026-08-14'))
      .map(({ name, spentMinor }) => ({ name, spentMinor }))
      .sort((left, right) => left.name.localeCompare(right.name))).toEqual([
      { name: 'Category scope', spentMinor: 300 },
      { name: 'Custom scope', spentMinor: 1_000 },
      { name: 'Item scope', spentMinor: 300 },
    ])
  })

  it('rejects foreign budget references and contradictory shopping reasons in MySQL', async () => {
    const stamp = `${Date.now()}`
    const owner = await store.createUser({
      account: `commerce-boundary-${stamp}@example.com`, displayName: 'Commerce boundary owner',
      passwordHash: await hashPassword('commerce-boundary-password'),
    })
    const other = await store.createUser({
      account: `commerce-boundary-other-${stamp}@example.com`, displayName: 'Commerce boundary other',
      passwordHash: await hashPassword('commerce-boundary-other-password'),
    })
    const ownerItem = await store.createCatalogItem(owner.id, {
      kind: 'supplement', name: `Owner item ${stamp}`, baseUnit: 'each', availableUnits: ['each'],
    }, `commerce-boundary-owner-item-${stamp}`)
    const foreignItem = await store.createCatalogItem(other.id, {
      kind: 'supplement', name: `Foreign item ${stamp}`, baseUnit: 'each', availableUnits: ['each'],
    }, `commerce-boundary-foreign-item-${stamp}`)
    const foreignCategory = await store.createTaxonomy(other.id, 'category', { name: `Foreign category ${stamp}` })
    const budgetBase = {
      period: { kind: 'monthly' as const, startsOn: '2026-08-01', endsOn: '2026-08-31' },
      limitMinor: 1_000, thresholds: [0.5,0.8,1], rolloverMinor: 0,
    }
    for (const [suffix,scope] of [
      ['foreign-item', { kind: 'item' as const, itemIds: [foreignItem.id] }],
      ['foreign-category', { kind: 'category' as const, categoryIds: [foreignCategory.id] }],
      ['missing-custom', { kind: 'custom' as const, itemIds: ['missing-item'], categoryIds: ['missing-category'] }],
    ] as const) {
      await expect(store.createBudget(owner.id, {
        ...budgetBase, name: `Rejected ${suffix}`, scope,
      }, `commerce-boundary-budget-${suffix}-${stamp}`)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    }
    await expect(store.createShoppingSuggestion(owner.id, {
      itemId: ownerItem.id, requiredQuantity: 1, unit: 'each', packageQuantity: 1,
      reason: { kind: 'minimum_stock', sourceType: 'day-plan', sourceId: 'forged-plan', requiredOn: null },
    }, `commerce-boundary-reason-${stamp}`)).rejects.toMatchObject({ code: 'INVALID_SHOPPING_REASON_SOURCE' })
    expect(await store.listBudgetSummaries(owner.id, '2026-08-14')).toEqual([])
    expect(await store.listShopping(owner.id)).toEqual({ suggestions: [], formalItems: [] })
  })

  it('keeps mixed scoped cash, converted formal quantities, refunds and plan analytics aligned in MySQL', async () => {
    const stamp = `${Date.now()}`
    const owner = await store.createUser({
      account: `commerce-parity-${stamp}@example.com`, displayName: 'Commerce parity owner',
      passwordHash: await hashPassword('commerce-parity-password'),
    })
    const category = await store.createTaxonomy(owner.id, 'category', { name: `Parity category ${stamp}` })
    const included = await store.createCatalogItem(owner.id, {
      kind: 'supplement', name: `Parity included ${stamp}`, baseUnit: 'gram',
      availableUnits: ['gram','kilogram'], categoryId: category.id,
    }, `commerce-parity-included-${stamp}`)
    const excluded = await store.createCatalogItem(owner.id, {
      kind: 'supplement', name: `Parity excluded ${stamp}`, baseUnit: 'each', availableUnits: ['each'],
    }, `commerce-parity-excluded-${stamp}`)
    const formal = await store.createShoppingItem(owner.id, {
      itemId: included.id, requestedQuantity: 1, unit: 'kilogram', neededOn: null,
      priority: 'normal', storeGroup: 'Bulk',
    }, `commerce-parity-formal-${stamp}`)
    const mixed = await store.createPurchase(owner.id, {
      purchasedAt: '2026-08-14T08:00:00.000Z', currency: 'CNY', storeName: 'Parity store',
      items: [
        { shoppingItemId: formal.id, itemId: included.id, quantity: 500, unit: 'gram', amountMinor: 300 },
        { itemId: excluded.id, quantity: 1, unit: 'each', amountMinor: 700 },
      ],
    }, `commerce-parity-mixed-${stamp}`)
    expect(mixed.shoppingItems).toEqual([
      expect.objectContaining({ id: formal.id, purchasedQuantity: 0.5, remainingQuantity: 0.5, status: 'partial' }),
    ])
    const second = await store.createPurchase(owner.id, {
      purchasedAt: '2026-08-14T09:00:00.000Z', currency: 'CNY',
      items: [{ shoppingItemId: formal.id, itemId: included.id, quantity: 0.5, unit: 'kilogram', amountMinor: 300 }],
    }, `commerce-parity-second-${stamp}`)
    expect(second.shoppingItems).toEqual([
      expect.objectContaining({ id: formal.id, purchasedQuantity: 1, remainingQuantity: 0, status: 'purchased' }),
    ])
    const includedLine = mixed.items.find((item) => item.itemId === included.id)!
    await expect(store.createRefund(owner.id, mixed.purchase.id, {
      refundedAt: '2026-08-14T09:30:00.000Z', items: [
        { purchaseItemId: includedLine.id, quantity: 300, amountMinor: 60 },
        { purchaseItemId: includedLine.id, quantity: 300, amountMinor: 60 },
      ],
    }, `commerce-parity-duplicate-refund-${stamp}`)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect((await store.listInventoryBalances(owner.id)).find((entry) => entry.itemId === included.id)?.onHand).toBe(1_000)
    await store.createRefund(owner.id, mixed.purchase.id, {
      refundedAt: '2026-08-14T10:00:00.000Z',
      items: [{ purchaseItemId: includedLine.id, quantity: 500, amountMinor: 100 }],
    }, `commerce-parity-refund-${stamp}`)

    for (const [name,scope] of [
      ['Parity item', { kind: 'item' as const, itemIds: [included.id] }],
      ['Parity category', { kind: 'category' as const, categoryIds: [category.id] }],
      ['Parity custom', { kind: 'custom' as const, itemIds: [excluded.id], categoryIds: [category.id] }],
    ] as const) {
      await store.createBudget(owner.id, {
        name, scope, period: { kind: 'monthly', startsOn: '2026-08-01', endsOn: '2026-08-31' },
        limitMinor: 2_000, thresholds: [0.5,0.8,1], rolloverMinor: 0,
      }, `commerce-parity-budget-${name}-${stamp}`)
    }
    expect((await new MySqlLifeStore(pool).listBudgetSummaries(owner.id, '2026-08-14'))
      .map(({ name,spentMinor }) => ({ name,spentMinor }))
      .sort((left, right) => left.name.localeCompare(right.name))).toEqual([
      { name: 'Parity category', spentMinor: 500 },
      { name: 'Parity custom', spentMinor: 1_200 },
      { name: 'Parity item', spentMinor: 500 },
    ])

    const day = await store.createDayPlan(owner.id, {
      date: '2026-08-14', mealSlots: [], items: [
        { kind: 'supplement', title: 'Parity completed', mealSlotId: null, scheduledTime: '11:00', source: { type: 'catalog-item', id: included.id }, quantity: 10, unit: 'gram', servings: null, durationMinutes: null },
        { kind: 'supplement', title: 'Parity pending', mealSlotId: null, scheduledTime: '12:00', source: { type: 'catalog-item', id: included.id }, quantity: 10, unit: 'gram', servings: null, durationMinutes: null },
      ],
    }, `commerce-parity-day-${stamp}`)
    await store.createPlanningCompletion(owner.id, {
      date: day.date, dayPlanItemId: day.items[0]!.id, completedAt: '2026-08-14T11:05:00.000Z',
    }, `commerce-parity-completion-${stamp}`)
    expect(await new MySqlLifeStore(pool).getLifeAnalytics(owner.id, '2026-08-13', '2026-08-14')).toMatchObject({
      days: [
        { date: '2026-08-13', planExecution: { status: 'no-record' } },
        { date: '2026-08-14', planExecution: {
          status: 'recorded', plannedCount: 2, actualCount: 1, incompleteCount: 1,
          sourceIds: [day.items[0]!.id,day.items[1]!.id],
        } },
      ],
      totals: { cashExpenditureMinor: 1_200, plannedCount: 2, actualCount: 1, incompleteCount: 1 },
    })
  })

  it('keeps a restore point while rolling back every imported row after a mid-transaction failure', async () => {
    const stamp = `${Date.now()}`
    const owner = await store.createUser({
      account: `commerce-import-rollback-${stamp}@example.com`, displayName: 'Import rollback owner',
      passwordHash: await hashPassword('commerce-import-rollback-password'),
    })
    const baseline = await store.createBudget(owner.id, {
      name: 'Baseline budget', scope: { kind: 'all-life' },
      period: { kind: 'monthly', startsOn: '2026-08-01', endsOn: '2026-08-31' },
      limitMinor: 1_000, thresholds: [0.5, 0.8, 1], rolloverMinor: 0,
    }, `commerce-import-baseline-${stamp}`)
    const timestamp = '2026-08-14T09:00:00.000Z'
    const importedBudgets = ['first', 'second'].map((suffix, index) => ({
      id: `import-${suffix}-${stamp}`, name: `Imported ${suffix}`, scope: { kind: 'all-life' as const },
      period: { kind: 'monthly' as const, startsOn: '2026-08-01', endsOn: '2026-08-31' },
      limitMinor: 2_000 + index, thresholds: [0.5, 0.8, 1], rolloverMinor: 0,
      version: 1, createdAt: timestamp, updatedAt: timestamp,
    }))
    const canonicalJson = stableJson({
      catalogItems: [], shoppingItems: [], purchases: [], refunds: [], budgets: importedBudgets,
    })
    const preview = await store.previewLifeImport(owner.id, {
      formatVersion: 1, checksumSha256: checksumSha256(canonicalJson), canonicalJson, mode: 'replace',
    }, `commerce-import-rollback-preview-${stamp}`)
    expect(preview.status).toBe('ready')
    const key = `commerce-import-rollback-apply-${stamp}`
    await pool.query('DROP TRIGGER IF EXISTS trg_test_commerce_import_budget_fail')
    await pool.query(`CREATE TRIGGER trg_test_commerce_import_budget_fail BEFORE INSERT ON life_budgets
      FOR EACH ROW BEGIN IF NEW.id = 'import-second-${stamp}' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test import row failure'; END IF; END`)
    try {
      await expect(store.applyLifeImport(owner.id, preview.id, [], key)).rejects.toMatchObject({ code: 'ER_SIGNAL_EXCEPTION' })
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS trg_test_commerce_import_budget_fail')
    }
    expect(await store.listBudgetSummaries(owner.id, '2026-08-14')).toEqual([
      expect.objectContaining({ id: baseline.id, name: baseline.name }),
    ])
    expect((await store.listLifeExports(owner.id)).filter((entry) => entry.reason === 'pre-import-restore-point')).toHaveLength(1)
    const [applyKeyCount] = await rows<CountRow>(pool, `SELECT COUNT(*) count FROM life_commerce_idempotency
      WHERE user_id=? AND operation_key=? AND idempotency_key=?`, [owner.id, `import:apply:${preview.id}`, key])
    expect(Number(applyKeyCount?.count)).toBe(0)
    expect(await store.applyLifeImport(owner.id, preview.id, [], key)).toMatchObject({
      status: 'applied', restorePointExportId: expect.any(String), appliedRows: 2,
    })
  })

  it('creates the owned, versioned domain foundation and replays legacy backfill exactly once', async () => {
    const domainTables = [
      'goals',
      'projects',
      'milestones',
      'tasks',
      'task_checklist_items',
      'task_recurrence_rules',
      'schedule_blocks',
      'habits',
      'habit_schedules',
      'habit_entries',
      'media_assets',
      'audit_events',
      'idempotency_keys',
    ]
    const recoverableTables = domainTables.filter(
      (table) => table !== 'audit_events' && table !== 'idempotency_keys',
    )
    const placeholders = domainTables.map(() => '?').join(', ')
    const tableRows = await rows<TableRow>(
      pool,
      `SELECT table_name tableName, table_collation tableCollation
       FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name IN (${placeholders})`,
      domainTables,
    )
    expect(tableRows).toHaveLength(domainTables.length)
    expect(tableRows.every((row) => row.tableCollation === 'utf8mb4_0900_ai_ci')).toBe(true)

    const recoverablePlaceholders = recoverableTables.map(() => '?').join(', ')
    const columnRows = await rows<ColumnRow>(
      pool,
      `SELECT table_name tableName, column_name columnName, column_type columnType,
              column_default columnDefault, datetime_precision datetimePrecision
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name IN (${recoverablePlaceholders})
         AND column_name IN ('user_id', 'version', 'deleted_at')`,
      recoverableTables,
    )
    for (const table of recoverableTables) {
      const columns = new Map(
        columnRows.filter((row) => row.tableName === table).map((row) => [row.columnName, row]),
      )
      expect(columns.get('user_id')?.columnType).toBe('char(36)')
      expect(columns.get('version')).toMatchObject({
        columnType: 'bigint unsigned',
        columnDefault: '1',
      })
      expect(columns.get('deleted_at')?.datetimePrecision).toBe(3)
      const [userLeadingIndex] = await rows<CountRow>(
        pool,
        `SELECT COUNT(*) count
         FROM information_schema.statistics
         WHERE table_schema = DATABASE() AND table_name = ?
           AND seq_in_index = 1 AND column_name = 'user_id'`,
        [table],
      )
      expect(Number(userLeadingIndex?.count)).toBeGreaterThan(0)
    }

    const { user: owner } = await ensureBootstrapUser(store, {
      account: 'owner@example.com',
      password: 'integration-owner-password',
      displayName: 'Owner',
    })
    const plan = await store.createPlan(owner.id, { title: `legacy-backfill-${Date.now()}` })
    const countBackfilledTasks = async () => Number((await rows<CountRow>(
      pool,
      'SELECT COUNT(*) count FROM tasks WHERE legacy_plan_id = ?',
      [plan.id],
    ))[0]?.count)

    expect(await countBackfilledTasks()).toBe(0)
    await pool.query("DELETE FROM schema_migrations WHERE version = '002'")
    await runMigrations(pool)
    expect(await countBackfilledTasks()).toBe(1)
    const [legacyPlan] = await rows<RowDataPacket>(
      pool,
      'SELECT title, status FROM plans WHERE id = ? AND user_id = ?',
      [plan.id, owner.id],
    )
    expect(legacyPlan).toMatchObject({ title: plan.title, status: plan.status })

    await runMigrations(pool)
    expect(await countBackfilledTasks()).toBe(1)
  })

  it('persists owner-scoped goals, projects, milestones, versions, soft deletes and idempotent replay', async () => {
    const stamp = `${Date.now()}`
    const { user: owner } = await ensureBootstrapUser(store, {
      account: 'owner@example.com',
      password: 'integration-owner-password',
      displayName: 'Owner',
    })
    const other = await store.createUser({
      account: `goal-other-${stamp}@example.com`,
      displayName: 'Goal Other',
      passwordHash: await hashPassword('integration-other-password'),
    })

    const goalInput = { title: `goal-${stamp}`, priority: 1 as const, manualProgress: 12.5 }
    const goal = await store.createGoal(owner.id, goalInput, `goal-idempotency-${stamp}`)
    const replay = await store.createGoal(owner.id, goalInput, `goal-idempotency-${stamp}`)
    expect(replay.id).toBe(goal.id)
    await expect(store.createGoal(owner.id, { ...goalInput, title: `changed-${stamp}` }, `goal-idempotency-${stamp}`))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 })
    expect(await store.getGoal(other.id, goal.id)).toBeUndefined()
    expect((await store.listGoals(other.id)).some((item) => item.id === goal.id)).toBe(false)
    await expect(store.updateGoal(owner.id, goal.id, { title: 'stale', version: 0 }))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 })

    const paused = await store.updateGoal(owner.id, goal.id, { status: 'paused', version: 1 })
    const completed = await store.updateGoal(owner.id, goal.id, { status: 'completed', version: paused!.version })
    await expect(store.createProject(owner.id, goal.id, { title: 'rejected-active-project' }, `project-rejected-${stamp}`))
      .rejects.toMatchObject({ code: 'GOAL_COMPLETED', status: 409 })
    const reopened = await store.updateGoal(owner.id, goal.id, { status: 'active', version: completed!.version })
    expect(reopened?.status).toBe('active')

    const project = await store.createProject(owner.id, goal.id, { title: `project-${stamp}` }, `project-${stamp}`)
    const later = await store.createMilestone(owner.id, project.id, { title: 'later', position: 20 }, `milestone-later-${stamp}`)
    const earlier = await store.createMilestone(owner.id, project.id, { title: 'earlier', position: 10 }, `milestone-earlier-${stamp}`)
    expect((await store.listMilestones(owner.id, project.id)).map((item) => item.id)).toEqual([earlier.id, later.id])
    const finished = await store.updateMilestone(owner.id, earlier.id, { completedAt: '2026-08-11T09:30:00.000Z', version: 1 })
    expect(finished).toMatchObject({ completedAt: '2026-08-11T09:30:00.000Z', version: 2 })

    expect(await store.deleteMilestone(owner.id, earlier.id, finished!.version)).toBe(true)
    expect(await store.getMilestone(owner.id, earlier.id)).toBeUndefined()
    expect(await store.deleteProject(owner.id, project.id, project.version)).toBe(true)
    expect(await store.getProject(owner.id, project.id)).toBeUndefined()
    expect(await store.deleteMilestone(owner.id, later.id, later.version)).toBe(false)
    expect(await store.deleteGoal(owner.id, goal.id, reopened!.version)).toBe(true)
    expect(await store.getGoal(owner.id, goal.id)).toBeUndefined()
  })

  it('persists project risk notes and restores the goal hierarchy with linked compensating audits atomically', async () => {
    const [riskNoteColumn] = await rows<ColumnRow>(pool, `SELECT table_name tableName, column_name columnName,
        column_type columnType, column_default columnDefault, datetime_precision datetimePrecision,
        is_nullable isNullable
      FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'projects' AND column_name = 'risk_note'`)
    expect(riskNoteColumn).toMatchObject({
      tableName: 'projects',
      columnName: 'risk_note',
      columnType: 'text',
      isNullable: 'YES',
    })
    const [migration] = await rows<CountRow>(pool, `SELECT COUNT(*) count FROM schema_migrations WHERE version = '011'`)
    expect(Number(migration?.count)).toBe(1)

    const stamp = `${Date.now()}`
    const owner = await store.createUser({
      account: `goal-recovery-owner-${stamp}@example.com`,
      displayName: 'Goal Recovery Owner',
      passwordHash: await hashPassword('goal-recovery-owner-password'),
    })
    const other = await store.createUser({
      account: `goal-recovery-other-${stamp}@example.com`,
      displayName: 'Goal Recovery Other',
      passwordHash: await hashPassword('goal-recovery-other-password'),
    })
    const goal = await store.createGoal(owner.id, { title: `recovery-goal-${stamp}` }, `recovery-goal-${stamp}`)
    const project = await store.createProject(owner.id, goal.id, {
      title: `recovery-project-${stamp}`,
      description: '独立描述',
      riskNote: '独立风险备注',
    } as Parameters<MySqlLifeStore['createProject']>[2], `recovery-project-${stamp}`)
    expect(project).toMatchObject({ description: '独立描述', riskNote: '独立风险备注' })
    const milestone = await store.createMilestone(
      owner.id,
      project.id,
      { title: `recovery-milestone-${stamp}`, position: 10 },
      `recovery-milestone-${stamp}`,
    )
    const recoveryStore = withGoalRecovery(store)

    expect(await store.deleteMilestone(owner.id, milestone.id, 1)).toBe(true)
    await expect(recoveryStore.restoreMilestone(owner.id, milestone.id, 1))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 })
    expect(await recoveryStore.restoreMilestone(other.id, milestone.id, 2)).toBeUndefined()
    expect(await recoveryStore.restoreMilestone(owner.id, milestone.id, 2))
      .toMatchObject({ id: milestone.id, version: 3, deletedAt: null })

    expect(await store.deleteProject(owner.id, project.id, 1)).toBe(true)
    expect(await recoveryStore.restoreProject(owner.id, project.id, 2))
      .toMatchObject({ id: project.id, version: 3, deletedAt: null })

    expect(await store.deleteGoal(owner.id, goal.id, 1)).toBe(true)
    await pool.query('DROP TRIGGER IF EXISTS trg_test_goal_restore_audit_fail')
    await pool.query(`CREATE TRIGGER trg_test_goal_restore_audit_fail BEFORE INSERT ON audit_events
      FOR EACH ROW BEGIN
        IF NEW.action = 'goal.restore' AND NEW.entity_id = '${goal.id}'
          THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test goal restore audit failure';
        END IF;
      END`)
    try {
      await expect(recoveryStore.restoreGoal(owner.id, goal.id, 2))
        .rejects.toMatchObject({ code: 'ER_SIGNAL_EXCEPTION' })
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS trg_test_goal_restore_audit_fail')
    }
    const [stillArchived] = await rows<RowDataPacket>(pool,
      'SELECT version, deleted_at deletedAt FROM goals WHERE user_id = ? AND id = ?',
      [owner.id, goal.id],
    )
    expect(stillArchived).toMatchObject({ version: 2, deletedAt: expect.anything() })
    const [failedRestoreAudit] = await rows<CountRow>(pool, `SELECT COUNT(*) count FROM audit_events
      WHERE user_id = ? AND entity_type = 'goal' AND entity_id = ? AND action = 'goal.restore'`,
    [owner.id, goal.id])
    expect(Number(failedRestoreAudit?.count)).toBe(0)

    expect(await recoveryStore.restoreGoal(owner.id, goal.id, 2))
      .toMatchObject({ id: goal.id, version: 3, deletedAt: null })

    const auditRows = await rows<GoalRecoveryAuditRow>(pool, `SELECT id, action, entity_type entityType,
        entity_id entityId,
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(details, '$.reversesEventId')), 'null') reversesEventId,
        CAST(JSON_UNQUOTE(JSON_EXTRACT(details, '$.versionBefore')) AS UNSIGNED) versionBefore,
        CAST(JSON_UNQUOTE(JSON_EXTRACT(details, '$.versionAfter')) AS UNSIGNED) versionAfter
      FROM audit_events
      WHERE user_id = ? AND entity_id IN (?, ?, ?)
        AND action IN ('goal.archive', 'goal.restore', 'project.archive', 'project.restore', 'milestone.archive', 'milestone.restore')`,
    [owner.id, goal.id, project.id, milestone.id])
    expect(auditRows).toHaveLength(6)
    for (const [entityType, entityId] of [
      ['goal', goal.id],
      ['project', project.id],
      ['milestone', milestone.id],
    ] as const) {
      const archived = auditRows.find((row) => row.entityType === entityType && row.entityId === entityId && row.action === `${entityType}.archive`)
      const restored = auditRows.find((row) => row.entityType === entityType && row.entityId === entityId && row.action === `${entityType}.restore`)
      expect(archived).toMatchObject({ versionBefore: 1, versionAfter: 2, reversesEventId: null })
      expect(restored).toMatchObject({ versionBefore: 2, versionAfter: 3, reversesEventId: archived!.id })
    }
  })

  it('persists owner-scoped tasks, recurrence, checklist, completion and schedule transactions', async () => {
    const stamp = `${Date.now()}`
    const owner = await store.createUser({
      account: `task-owner-${stamp}@example.com`,
      displayName: 'Task Owner',
      passwordHash: await hashPassword('integration-task-owner-password'),
    })
    const other = await store.createUser({
      account: `task-other-${stamp}@example.com`,
      displayName: 'Task Other',
      passwordHash: await hashPassword('integration-task-other-password'),
    })
    const goal = await store.createGoal(owner.id, { title: `task-goal-${stamp}` }, `task-goal-${stamp}`)
    const project = await store.createProject(owner.id, goal.id, { title: `task-project-${stamp}` }, `task-project-${stamp}`)
    const milestone = await store.createMilestone(owner.id, project.id, { title: 'task-milestone' }, `task-milestone-${stamp}`)
    const taskInput = {
      goalId: goal.id,
      projectId: project.id,
      milestoneId: milestone.id,
      title: `task-${stamp}`,
      startsAt: '2026-08-11T09:00:00.000Z',
      endsAt: '2026-08-11T10:00:00.000Z',
      recurrence: { frequency: 'monthly' as const, interval: 1, monthDay: 31, until: '2026-12-31' },
    }
    const task = await store.createTask(owner.id, taskInput, `task-create-${stamp}`)
    const replay = await store.createTask(owner.id, taskInput, `task-create-${stamp}`)
    expect(replay.id).toBe(task.id)
    expect((await store.getTask(owner.id, task.id))?.recurrence).toEqual(taskInput.recurrence)
    expect(await store.getTask(other.id, task.id)).toBeUndefined()
    await expect(store.createTask(other.id, { title: 'cross-owner', goalId: goal.id }, `cross-owner-${stamp}`))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    await expect(store.updateTask(owner.id, task.id, { title: 'stale', version: 0 }))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 })

    const later = await store.addChecklistItem(owner.id, task.id, { title: 'later', position: 20 }, `task-check-later-${stamp}`)
    const earlier = await store.addChecklistItem(owner.id, task.id, { title: 'earlier', position: 10 }, `task-check-earlier-${stamp}`)
    const checked = await store.updateChecklistItem(owner.id, task.id, earlier.id, { isCompleted: true, version: 1 })
    expect(checked).toMatchObject({ isCompleted: true, version: 2 })
    expect((await store.getTask(owner.id, task.id))?.checklist.map((item) => item.id)).toEqual([earlier.id, later.id])

    const completed = await store.setTaskCompletion(owner.id, task.id, task.version, true)
    expect(completed).toMatchObject({ status: 'done', version: 2 })
    const undone = await store.setTaskCompletion(owner.id, task.id, completed!.version, false)
    expect(undone).toMatchObject({ status: 'planned', completedAt: null, version: 3 })
    const weekly = await store.updateTask(owner.id, task.id, {
      recurrence: { frequency: 'weekly', interval: 2, weekdays: [1, 3] },
      version: undone!.version,
    })
    expect((await store.getTask(owner.id, task.id))?.recurrence).toEqual({ frequency: 'weekly', interval: 2, weekdays: [1, 3] })
    const withoutRecurrence = await store.updateTask(owner.id, task.id, { recurrence: null, version: weekly!.version })
    expect((await store.getTask(owner.id, task.id))?.recurrence).toBeNull()

    const secondTask = await store.createTask(owner.id, { title: `second-task-${stamp}` }, `second-task-${stamp}`)
    const firstBlock = await store.createScheduleBlock(owner.id, {
      taskId: task.id,
      startsAt: '2026-08-11T09:00:00.000Z',
      endsAt: '2026-08-11T10:00:00.000Z',
    }, `first-block-${stamp}`)
    const secondBlock = await store.createScheduleBlock(owner.id, {
      taskId: secondTask.id,
      startsAt: '2026-08-11T10:00:00.000Z',
      endsAt: '2026-08-11T11:00:00.000Z',
    }, `second-block-${stamp}`)
    expect(detectScheduleConflicts(await store.listScheduleBlocks(owner.id, '2026-08-11T00:00:00.000Z', '2026-08-12T00:00:00.000Z'))).toEqual([])
    const moved = await store.updateScheduleBlock(owner.id, secondBlock.id, {
      startsAt: '2026-08-11T09:30:00.000Z',
      endsAt: '2026-08-11T10:30:00.000Z',
      version: secondBlock.version,
    })
    expect(detectScheduleConflicts(await store.listScheduleBlocks(owner.id, '2026-08-11T00:00:00.000Z', '2026-08-12T00:00:00.000Z')))
      .toContainEqual({ leftId: firstBlock.id, rightId: moved!.id, overlapMinutes: 30 })

    expect(await store.deleteTask(owner.id, task.id, withoutRecurrence!.version)).toBe(true)
    expect(await store.getTask(owner.id, task.id)).toBeUndefined()
    expect((await store.listScheduleBlocks(owner.id)).some((block) => block.id === firstBlock.id)).toBe(false)
    expect(await store.updateChecklistItem(owner.id, task.id, later.id, { title: 'hidden', version: later.version })).toBeUndefined()
  })

  it('applies additive nullable habit goal/project links with owner-leading indexes', async () => {
    const linkColumns = await rows<ColumnRow>(
      pool,
      `SELECT table_name tableName, column_name columnName, column_type columnType,
              column_default columnDefault, datetime_precision datetimePrecision,
              is_nullable isNullable
       FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'habits'
         AND column_name IN ('goal_id', 'project_id')
       ORDER BY column_name`,
    )
    expect(linkColumns).toEqual([
      expect.objectContaining({ columnName: 'goal_id', columnType: 'char(36)', isNullable: 'YES' }),
      expect.objectContaining({ columnName: 'project_id', columnType: 'char(36)', isNullable: 'YES' }),
    ])
    for (const column of ['goal_id', 'project_id']) {
      const [index] = await rows<CountRow>(
        pool,
        `SELECT COUNT(*) count
         FROM information_schema.statistics first_column
         INNER JOIN information_schema.statistics linked_column
           ON linked_column.table_schema = first_column.table_schema
          AND linked_column.table_name = first_column.table_name
          AND linked_column.index_name = first_column.index_name
         WHERE first_column.table_schema = DATABASE()
           AND first_column.table_name = 'habits'
           AND first_column.seq_in_index = 1 AND first_column.column_name = 'user_id'
           AND linked_column.seq_in_index = 2 AND linked_column.column_name = ?`,
        [column],
      )
      expect(Number(index?.count)).toBeGreaterThan(0)
    }
  })

  it('adds versioned record lifecycle columns and normalized record link/media tables', async () => {
    const recordColumns = await rows<ColumnRow>(
      pool,
      `SELECT table_name tableName, column_name columnName, column_type columnType,
              column_default columnDefault, datetime_precision datetimePrecision,
              is_nullable isNullable
       FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'life_records'
         AND column_name IN ('pinned', 'archived_at', 'cover_media_id', 'version', 'updated_at', 'deleted_at')
       ORDER BY column_name`,
    )
    expect(recordColumns).toEqual([
      expect.objectContaining({ columnName: 'archived_at', datetimePrecision: 3, isNullable: 'YES' }),
      expect.objectContaining({ columnName: 'cover_media_id', columnType: 'char(36)', columnDefault: null, isNullable: 'YES' }),
      expect.objectContaining({ columnName: 'deleted_at', datetimePrecision: 3, isNullable: 'YES' }),
      expect.objectContaining({ columnName: 'pinned', columnType: 'tinyint(1)', columnDefault: '0' }),
      expect.objectContaining({ columnName: 'updated_at', datetimePrecision: 3, isNullable: 'NO' }),
      expect.objectContaining({ columnName: 'version', columnType: 'bigint unsigned', columnDefault: '1' }),
    ])

    const relationTables = await rows<TableRow>(
      pool,
      `SELECT table_name tableName, table_collation tableCollation
       FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name IN ('record_links', 'record_media')
       ORDER BY table_name`,
    )
    expect(relationTables).toEqual([
      expect.objectContaining({ tableName: 'record_links', tableCollation: 'utf8mb4_0900_ai_ci' }),
      expect.objectContaining({ tableName: 'record_media', tableCollation: 'utf8mb4_0900_ai_ci' }),
    ])
  })

  it('adds the versioned review lifecycle, action and goal-update schema', async () => {
    const reviewColumns = await rows<ColumnRow>(
      pool,
      `SELECT table_name tableName, column_name columnName, column_type columnType,
              column_default columnDefault, datetime_precision datetimePrecision,
              is_nullable isNullable
       FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'period_reviews'
         AND column_name IN ('review_type', 'status', 'evidence_json', 'version', 'updated_at', 'deleted_at')
       ORDER BY column_name`,
    )
    expect(reviewColumns).toEqual([
      expect.objectContaining({ columnName: 'deleted_at', datetimePrecision: 3, isNullable: 'YES' }),
      expect.objectContaining({ columnName: 'evidence_json', columnType: 'json', isNullable: 'NO' }),
      expect.objectContaining({ columnName: 'review_type', isNullable: 'NO' }),
      expect.objectContaining({ columnName: 'status', isNullable: 'NO' }),
      expect.objectContaining({ columnName: 'updated_at', datetimePrecision: 3, isNullable: 'NO' }),
      expect.objectContaining({ columnName: 'version', columnType: 'bigint unsigned', columnDefault: '1' }),
    ])
    const tables = await rows<TableRow>(pool, `SELECT table_name tableName, table_collation tableCollation
      FROM information_schema.tables WHERE table_schema = DATABASE()
        AND table_name IN ('review_actions', 'goal_updates') ORDER BY table_name`)
    expect(tables).toEqual([
      expect.objectContaining({ tableName: 'goal_updates', tableCollation: 'utf8mb4_0900_ai_ci' }),
      expect.objectContaining({ tableName: 'review_actions', tableCollation: 'utf8mb4_0900_ai_ci' }),
    ])
  })

  it('persists owner-scoped linked habits, schedules, lifecycle and versioned rhythm entries', async () => {
    const stamp = `${Date.now()}`
    const owner = await store.createUser({
      account: `habit-owner-${stamp}@example.com`,
      displayName: 'Habit Owner',
      passwordHash: await hashPassword('integration-habit-owner-password'),
    })
    const other = await store.createUser({
      account: `habit-other-${stamp}@example.com`,
      displayName: 'Habit Other',
      passwordHash: await hashPassword('integration-habit-other-password'),
    })
    const goal = await store.createGoal(owner.id, { title: `habit-goal-${stamp}` }, `habit-goal-${stamp}`)
    const project = await store.createProject(owner.id, goal.id, { title: `habit-project-${stamp}` }, `habit-project-${stamp}`)
    const secondGoal = await store.createGoal(owner.id, { title: `habit-second-goal-${stamp}` }, `habit-second-goal-${stamp}`)
    const secondProject = await store.createProject(owner.id, secondGoal.id, { title: `habit-second-project-${stamp}` }, `habit-second-project-${stamp}`)
    const input = {
      goalId: goal.id,
      projectId: project.id,
      title: `habit-${stamp}`,
      measure: 'count' as const,
      unit: '次',
      targetValue: 3,
      timezone: 'Asia/Shanghai',
      schedule: { scheduleType: 'weekdays' as const, weekdays: [1, 3, 5], startsOn: '2026-08-01' },
    }
    const habit = await store.createHabit(owner.id, input, `habit-create-${stamp}`)
    const replay = await store.createHabit(owner.id, input, `habit-create-${stamp}`)
    expect(replay.id).toBe(habit.id)
    expect(await store.getHabit(other.id, habit.id)).toBeUndefined()
    expect((await store.getHabit(owner.id, habit.id))?.schedule).toEqual(habit.schedule)
    await expect(store.createHabit(other.id, input, `habit-cross-owner-${stamp}`))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    await expect(store.createHabit(owner.id, { ...input, projectId: secondProject.id }, `habit-mismatch-${stamp}`))
      .rejects.toMatchObject({ code: 'INVALID_INPUT', status: 400 })
    await expect(store.updateHabit(owner.id, habit.id, { title: 'stale', version: 0 }))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 })

    const cleared = await store.updateHabit(owner.id, habit.id, { goalId: null, projectId: null, version: 1 })
    const paused = await store.updateHabit(owner.id, habit.id, { status: 'paused', version: cleared!.version })
    expect(paused).toMatchObject({ status: 'paused', pausedAt: expect.any(String), version: 3 })
    const archived = await store.updateHabit(owner.id, habit.id, { status: 'archived', version: paused!.version })
    expect(archived).toMatchObject({ status: 'archived', deletedAt: null, version: 4 })

    const entryInput = { status: 'done' as const, value: 3, note: '按计划完成' }
    const created = await store.upsertHabitEntry(owner.id, habit.id, '2026-08-13', entryInput, `habit-entry-${stamp}`)
    const entryReplay = await store.upsertHabitEntry(owner.id, habit.id, '2026-08-13', entryInput, `habit-entry-${stamp}`)
    expect(entryReplay?.entry.id).toBe(created?.entry.id)
    expect(entryReplay).toMatchObject({ created: true, replayed: true })
    const corrected = await store.upsertHabitEntry(owner.id, habit.id, '2026-08-13', {
      status: 'partial', value: 2, note: '复核修正', version: 1,
    })
    expect(corrected).toMatchObject({ created: false, entry: { id: created?.entry.id, status: 'partial', version: 2 } })
    expect(await store.listHabitEntries(other.id, '2026-08-01', '2026-08-31')).toEqual([])
    expect(await store.listHabitEntries(owner.id, '2026-08-01', '2026-08-31'))
      .toEqual([expect.objectContaining({ id: created?.entry.id, status: 'partial', version: 2 })])
  })

  it('persists owner-scoped record autosave, relations, media policy and reversible lifecycle', async () => {
    const stamp = `${Date.now()}`
    const owner = await store.createUser({
      account: `record-owner-${stamp}@example.com`,
      displayName: 'Record Owner',
      passwordHash: await hashPassword('integration-record-owner-password'),
    })
    const other = await store.createUser({
      account: `record-other-${stamp}@example.com`,
      displayName: 'Record Other',
      passwordHash: await hashPassword('integration-record-other-password'),
    })
    const goal = await store.createGoal(owner.id, { title: `record-goal-${stamp}` }, `record-goal-${stamp}`)
    const foreignGoal = await store.createGoal(other.id, { title: `foreign-goal-${stamp}` }, `foreign-goal-${stamp}`)
    const mediaInput = {
      originalName: 'evidence.png',
      mimeType: 'image/png' as const,
      sizeBytes: 67,
      storageKey: `ab/record-${stamp}.png`,
      checksum: 'A'.repeat(64),
    }
    const media = await store.createMediaAsset(owner.id, mediaInput, `record-media-${stamp}`)
    const mediaReplay = await store.createMediaAsset(owner.id, mediaInput, `record-media-${stamp}`)
    expect(mediaReplay.id).toBe(media.id)
    expect(await store.getMediaAsset(other.id, media.id)).toBeUndefined()

    const input = {
      title: `record-${stamp}`,
      body: 'MySQL 记录闭环正文',
      occurredAt: '2026-08-13T08:30:00.000Z',
      tags: ['mysql', 'lifeops'],
      pinned: true,
      links: [{ type: 'goal' as const, id: goal.id }],
      mediaIds: [media.id],
    }
    const record = await store.createRecord(owner.id, input, `record-create-${stamp}`)
    const replay = await store.createRecord(owner.id, input, `record-create-${stamp}`)
    expect(replay.id).toBe(record.id)
    expect(record).toMatchObject({ version: 1, archivedAt: null, links: input.links, mediaIds: [media.id] })
    expect(await store.getRecord(other.id, record.id)).toBeUndefined()
    expect(await store.listRecords(owner.id, {
      from: '2026-08-13', to: '2026-08-13', tag: 'mysql', linkType: 'goal', linkId: goal.id, q: '闭环',
    })).toEqual([expect.objectContaining({ id: record.id })])
    const literalTag = await store.createRecord(owner.id, {
      title: `literal-tag-${stamp}`, body: 'literal JSON tag matching', tags: ['my%'],
    }, `record-literal-tag-${stamp}`)
    expect(await store.listRecords(owner.id, { tag: 'my%' }))
      .toEqual([expect.objectContaining({ id: literalTag.id })])
    expect(await store.deleteRecord(owner.id, literalTag.id, 1)).toBe(true)
    await expect(store.createRecord(owner.id, {
      ...input, title: 'cross-owner-link', links: [{ type: 'goal', id: foreignGoal.id }], mediaIds: [],
    }, `record-cross-owner-${stamp}`)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })

    const updated = await store.updateRecord(owner.id, record.id, {
      body: 'MySQL 自动保存后的正文', archived: true, version: record.version,
    })
    expect(updated).toMatchObject({ version: 2, archivedAt: expect.any(String) })
    await expect(store.updateRecord(owner.id, record.id, { title: 'stale', version: 1 }))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 })
    expect(await store.listRecords(owner.id)).toEqual([])
    expect(await store.listRecords(owner.id, { includeArchived: true }))
      .toEqual([expect.objectContaining({ id: record.id, version: 2 })])

    const snapshot = await store.createSnapshot(owner.id, {
      slug: `record-media-${stamp}`,
      sourceType: 'record',
      sourceId: record.id,
      title: record.title,
      excerpt: record.body,
    })
    await pool.execute("UPDATE media_assets SET visibility = 'public' WHERE id = ? AND user_id = ?", [media.id, owner.id])
    expect(await store.getPublicMediaAsset(media.id)).toBeUndefined()
    await store.publishSnapshot(owner.id, snapshot.id)
    expect(await store.getPublicMediaAsset(media.id)).toMatchObject({ id: media.id, visibility: 'public' })
    await store.revokeSnapshot(owner.id, snapshot.id)
    expect(await store.getPublicMediaAsset(media.id)).toBeUndefined()

    expect(await store.deleteRecord(owner.id, record.id, updated!.version)).toBe(true)
    expect(await store.getRecord(owner.id, record.id)).toBeUndefined()
    const restored = await store.restoreRecord(owner.id, record.id, 3)
    expect(restored).toMatchObject({ id: record.id, version: 4, deletedAt: null })
  })

  it('persists record cover create, omit, clear and atomic replacement with owner isolation', async () => {
    const stamp = `${Date.now()}`
    const owner = await store.createUser({
      account: `record-cover-owner-${stamp}@example.com`, displayName: 'Record Cover Owner',
      passwordHash: await hashPassword('record-cover-owner-password'),
    })
    const other = await store.createUser({
      account: `record-cover-other-${stamp}@example.com`, displayName: 'Record Cover Other',
      passwordHash: await hashPassword('record-cover-other-password'),
    })
    const media = (userId: string, suffix: string) => store.createMediaAsset(userId, {
      originalName: `${suffix}.png`, mimeType: 'image/png', sizeBytes: 67,
      storageKey: `cover/${stamp}-${suffix}.png`, checksum: suffix.padEnd(64, 'A').slice(0, 64),
    }, `record-cover-media-${suffix}-${stamp}`)
    const cover = await media(owner.id, 'cover')
    const replacement = await media(owner.id, 'replacement')
    const foreign = await media(other.id, 'foreign')

    const defaulted = await store.createRecord(owner.id, {
      title: `cover-default-${stamp}`, body: 'default null', mediaIds: [cover.id],
    }, `record-cover-default-${stamp}`) as { coverMediaId: string | null }
    expect(defaulted.coverMediaId).toBeNull()

    const created = await store.createRecord(owner.id, {
      title: `cover-record-${stamp}`, body: 'cover identity', mediaIds: [cover.id, replacement.id], coverMediaId: cover.id,
    }, `record-cover-create-${stamp}`) as Awaited<ReturnType<typeof store.createRecord>> & { coverMediaId: string | null }
    expect(created).toMatchObject({ coverMediaId: cover.id, version: 1 })
    await expect(store.createRecord(owner.id, {
      title: 'foreign cover', body: 'must fail', mediaIds: [foreign.id], coverMediaId: foreign.id,
    }, `record-cover-foreign-${stamp}`)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })

    const omitted = await store.updateRecord(owner.id, created.id, { title: 'omit cover', version: 1 }) as typeof created
    expect(omitted).toMatchObject({ coverMediaId: cover.id, version: 2 })
    await expect(store.updateRecord(owner.id, created.id, { mediaIds: [replacement.id], version: 2 }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT', status: 400 })
    expect(await store.getRecord(owner.id, created.id)).toMatchObject({
      mediaIds: [cover.id, replacement.id], coverMediaId: cover.id, version: 2,
    })

    const replaced = await store.updateRecord(owner.id, created.id, {
      mediaIds: [replacement.id], coverMediaId: replacement.id, version: 2,
    } as Parameters<typeof store.updateRecord>[2] & { coverMediaId: string | null }) as typeof created
    expect(replaced).toMatchObject({ mediaIds: [replacement.id], coverMediaId: replacement.id, version: 3 })
    const cleared = await store.updateRecord(owner.id, created.id, {
      mediaIds: [], coverMediaId: null, version: 3,
    } as Parameters<typeof store.updateRecord>[2] & { coverMediaId: string | null })
    expect(cleared).toMatchObject({ mediaIds: [], coverMediaId: null, version: 4 })
  })

  it('persists evidence reviews and converts each action transactionally once', async () => {
    const stamp = `${Date.now()}`
    const owner = await store.createUser({
      account: `review-owner-${stamp}@example.com`,
      displayName: 'Review Owner',
      passwordHash: await hashPassword('integration-review-owner-password'),
    })
    const other = await store.createUser({
      account: `review-other-${stamp}@example.com`,
      displayName: 'Review Other',
      passwordHash: await hashPassword('integration-review-other-password'),
    })
    const goal = await store.createGoal(owner.id, { title: `review-goal-${stamp}` }, `review-goal-${stamp}`)
    const foreignGoal = await store.createGoal(other.id, { title: `review-foreign-goal-${stamp}` }, `review-foreign-goal-${stamp}`)
    const task = await store.createTask(owner.id, { title: `review-fact-${stamp}` }, `review-fact-${stamp}`)
    await store.setTaskCompletion(owner.id, task.id, task.version, true)
    const habit = await store.createHabit(owner.id, {
      title: `review-habit-${stamp}`,
      measure: 'boolean',
      timezone: 'Asia/Shanghai',
      schedule: { scheduleType: 'daily', startsOn: '2026-08-01' },
    }, `review-habit-${stamp}`)
    await store.upsertHabitEntry(owner.id, habit.id, '2026-08-13', { status: 'done', note: 'review evidence' }, `review-entry-${stamp}`)
    await store.createRecord(owner.id, {
      title: `review-record-${stamp}`, body: 'review evidence', occurredAt: '2026-08-13T09:00:00.000Z',
    }, `review-record-${stamp}`)

    const input = {
      type: 'weekly' as const,
      period: { from: '2026-08-01', to: '2026-08-31' },
      achievements: ['Persisted achievement'],
      problems: ['Persisted problem'],
      causes: ['Persisted cause'],
      insights: ['Persisted insight'],
      nextChanges: ['Persisted next change'],
      actions: [
        { id: 'mysql-action-task', text: `Converted task ${stamp}` },
        { id: 'mysql-action-goal', text: `Goal update ${stamp}` },
        { id: 'mysql-action-knowledge', text: `Knowledge ${stamp}` },
        { id: 'mysql-action-public', text: `Public draft ${stamp}` },
      ],
    }
    const review = await store.createReview(owner.id, input, `review-create-${stamp}`)
    const replay = await store.createReview(owner.id, input, `review-create-${stamp}`)
    expect(replay.id).toBe(review.id)
    expect(review).toMatchObject({
      status: 'draft', version: 1,
      evidence: { tasks: { completed: 1 }, habits: { done: 1 }, records: { total: 1 }, hasFacts: true },
    })
    expect(await store.getReview(other.id, review.id)).toBeUndefined()
    await expect(store.updateReview(owner.id, review.id, { insights: ['stale'], version: 0 }))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 })

    await store.createRecord(owner.id, {
      title: `second-review-record-${stamp}`, body: 'second fact', occurredAt: '2026-08-14T09:00:00.000Z',
    }, `second-review-record-${stamp}`)
    const refreshed = await store.refreshReviewEvidence(owner.id, review.id, 1)
    expect(refreshed).toMatchObject({
      achievements: ['Persisted achievement'], insights: ['Persisted insight'], evidence: { records: { total: 2 } }, version: 2,
    })
    const archived = await store.updateReview(owner.id, review.id, {
      period: { from: '2026-08-02', to: '2026-08-31' }, status: 'archived', version: 2,
    })
    expect(archived).toMatchObject({
      period: { from: '2026-08-02', to: '2026-08-31' },
      evidence: { period: { from: '2026-08-02', to: '2026-08-31' } },
      status: 'archived', version: 3,
    })
    expect((await store.listReviews(owner.id)).some((item) => item.id === review.id)).toBe(false)
    expect((await store.listReviews(owner.id, { includeArchived: true })).some((item) => item.id === review.id)).toBe(true)

    const taskConversion = await store.convertReviewAction(owner.id, review.id, 'mysql-action-task', { target: 'task' }, `convert-task-${stamp}`)
    expect(taskConversion).toMatchObject({ action: { status: 'converted', convertedTarget: 'task' }, target: { type: 'task' } })
    const taskReplay = await store.convertReviewAction(owner.id, review.id, 'mysql-action-task', { target: 'task' }, `convert-task-${stamp}`)
    expect(taskReplay?.target.id).toBe(taskConversion?.target.id)
    await expect(store.convertReviewAction(owner.id, review.id, 'mysql-action-task', { target: 'task' }, `convert-task-again-${stamp}`))
      .rejects.toMatchObject({ code: 'ACTION_ALREADY_CONVERTED', status: 409 })
    expect((await store.listTasks(owner.id)).filter((item) => item.title === `Converted task ${stamp}`)).toHaveLength(1)

    await expect(store.convertReviewAction(
      owner.id, review.id, 'mysql-action-goal', { target: 'goal-update', goalId: foreignGoal.id }, `convert-goal-${stamp}`,
    )).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect((await store.getReview(owner.id, review.id))?.actions.find((item) => item.id === 'mysql-action-goal'))
      .toMatchObject({ status: 'pending', convertedId: null })
    const goalConversion = await store.convertReviewAction(owner.id, review.id, 'mysql-action-goal', { target: 'goal-update', goalId: goal.id }, `convert-goal-${stamp}`)
    const knowledgeConversion = await store.convertReviewAction(owner.id, review.id, 'mysql-action-knowledge', { target: 'knowledge' }, `convert-knowledge-${stamp}`)
    const publicConversion = await store.convertReviewAction(owner.id, review.id, 'mysql-action-public', { target: 'public-draft' }, `convert-public-${stamp}`)
    expect(goalConversion?.target.type).toBe('goal-update')
    expect(knowledgeConversion?.target.type).toBe('knowledge')
    expect(publicConversion?.target.type).toBe('public-draft')
    const [goalUpdateCount] = await rows<CountRow>(pool, 'SELECT COUNT(*) count FROM goal_updates WHERE review_id = ?', [review.id])
    expect(Number(goalUpdateCount?.count)).toBe(1)

    const current = publicConversion!.review
    expect(await store.deleteReview(owner.id, review.id, current.version)).toBe(true)
    expect(await store.getReview(owner.id, review.id)).toBeUndefined()
    const restored = await store.restoreReview(owner.id, review.id, current.version + 1)
    expect(restored).toMatchObject({ id: review.id, deletedAt: null, version: current.version + 2 })
  })

  it('persists the owner-scoped life catalog and rolls back stale batches and unsafe medicine writes', async () => {
    const catalogTables = [
      'life_categories',
      'life_tags',
      'life_locations',
      'life_units',
      'life_items',
      'life_item_profiles',
      'life_item_tags',
      'life_item_unit_conversions',
      'life_price_history',
      'life_item_attachments',
      'life_trash_references',
    ]
    const tableRows = await rows<TableRow>(pool, `SELECT table_name tableName, table_collation tableCollation
      FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (${catalogTables.map(() => '?').join(', ')})`, catalogTables)
    expect(tableRows).toHaveLength(catalogTables.length)
    expect(tableRows.every((row) => row.tableCollation === 'utf8mb4_0900_ai_ci')).toBe(true)

    const stamp = `${Date.now()}`
    const owner = await store.createUser({
      account: `catalog-owner-${stamp}@example.com`, displayName: 'Catalog Owner', passwordHash: await hashPassword('catalog-owner-password'),
    })
    const other = await store.createUser({
      account: `catalog-other-${stamp}@example.com`, displayName: 'Catalog Other', passwordHash: await hashPassword('catalog-other-password'),
    })
    const food = await store.createTaxonomy(owner.id, 'category', { name: `Food ${stamp}` })
    const fresh = await store.createTaxonomy(owner.id, 'category', { name: `Fresh ${stamp}`, parentId: food.id })
    const tag = await store.createTaxonomy(owner.id, 'tag', { name: `Protein ${stamp}` })
    const location = await store.createTaxonomy(owner.id, 'location', { name: `Fridge ${stamp}` })
    const foreignCategory = await store.createTaxonomy(other.id, 'category', { name: `Foreign ${stamp}` })

    const renamed = await store.updateTaxonomy(owner.id, 'category', food.id, { name: `Ingredients ${stamp}`, version: 1 })
    expect(renamed).toMatchObject({ id: food.id, name: `Ingredients ${stamp}`, version: 2 })
    await expect(store.updateTaxonomy(owner.id, 'category', food.id, { parentId: fresh.id, version: 2 }))
      .rejects.toMatchObject({ code: 'CATEGORY_CYCLE', status: 409 })
    expect(await store.listTaxonomy(owner.id, 'category')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: food.id, parentId: null, version: 2 }),
      expect.objectContaining({ id: fresh.id, parentId: food.id, version: 1 }),
    ]))

    const rejectedKey = `catalog-cross-owner-${stamp}`
    await expect(store.createCatalogItem(owner.id, {
      kind: 'ingredient', name: `Foreign item ${stamp}`, baseUnit: 'gram', categoryId: foreignCategory.id,
    }, rejectedKey)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })

    const eggInput: CreateCatalogItemInput = {
      kind: 'ingredient',
      name: `Egg ${stamp}`,
      aliases: ['Chicken egg'],
      categoryId: fresh.id,
      tagIds: [tag.id],
      locationId: location.id,
      baseUnit: 'gram',
      availableUnits: ['egg'],
      itemConversions: [{ itemId: 'input-placeholder', fromUnit: 'egg', toUnit: 'gram', factor: 55 }],
      pricePoints: [{ amountMinor: 1_200, currency: 'CNY', purchaseQuantity: 12, purchaseUnit: 'egg', effectiveFrom: '2026-08-01' }],
      nutrition: {
        basisQuantity: 100,
        basisUnit: 'gram',
        values: { energyKcal: 143, proteinGrams: 13, fatGrams: 9.5, carbohydrateGrams: 0.7 },
      },
    }
    const egg = await store.createCatalogItem(owner.id, eggInput, rejectedKey)
    const replay = await store.createCatalogItem(owner.id, eggInput, rejectedKey)
    expect(replay.id).toBe(egg.id)
    expect(egg).toMatchObject({
      categoryId: fresh.id,
      tagIds: [tag.id],
      locationId: location.id,
      itemConversions: [{ itemId: egg.id, fromUnit: 'egg', toUnit: 'gram', factor: 55 }],
      pricePoints: [expect.objectContaining({ amountMinor: 1_200, effectiveFrom: '2026-08-01' })],
      nutrition: { values: { proteinGrams: 13 } },
      version: 1,
    })
    expect(await store.getCatalogItem(other.id, egg.id)).toBeUndefined()
    expect(await store.listCatalogItems(other.id)).toEqual([])

    const milk = await store.createCatalogItem(owner.id, {
      kind: 'ingredient', name: `Milk ${stamp}`, categoryId: food.id, baseUnit: 'millilitre',
    }, `catalog-milk-${stamp}`)
    const changed = await store.batchUpdateCatalogItems(owner.id, {
      items: [{ id: egg.id, version: 1 }, { id: milk.id, version: 1 }],
      patch: { categoryId: food.id, addTagIds: [tag.id] },
    })
    expect(changed).toEqual([
      expect.objectContaining({ id: egg.id, categoryId: food.id, tagIds: [tag.id], version: 2 }),
      expect.objectContaining({ id: milk.id, categoryId: food.id, tagIds: [tag.id], version: 2 }),
    ])
    await expect(store.batchUpdateCatalogItems(owner.id, {
      items: [{ id: egg.id, version: 1 }, { id: milk.id, version: 2 }],
      patch: { categoryId: fresh.id, removeTagIds: [tag.id] },
    })).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 })
    expect(await store.getCatalogItem(owner.id, milk.id)).toMatchObject({ categoryId: food.id, tagIds: [tag.id], version: 2 })

    const retypedMilk = await store.updateCatalogItem(owner.id, milk.id, { kind: 'household_consumable', version: 2 })
    expect(retypedMilk).toMatchObject({ kind: 'household_consumable', version: 3 })
    const [profileCount] = await rows<CountRow>(pool, 'SELECT COUNT(*) count FROM life_item_profiles WHERE user_id = ? AND item_id = ?', [owner.id, milk.id])
    expect(Number(profileCount?.count)).toBe(1)

    const supplement = await store.createCatalogItem(owner.id, {
      kind: 'supplement', name: `Supplement ${stamp}`, baseUnit: 'capsule',
      profile: {
        kind: 'supplement', servingQuantity: 2, servingUnit: 'capsule', ingredients: ['magnesium glycinate'],
        defaultFrequency: 'evening', userInstructions: 'My note',
        reminder: { enabled: true, localTimes: ['19:30'], note: 'My reminder' },
      },
    }, `catalog-supplement-profile-${stamp}`)
    const consumable = await store.createCatalogItem(owner.id, {
      kind: 'household_consumable', name: `Consumable ${stamp}`, baseUnit: 'bottle',
      profile: {
        kind: 'household_consumable', defaultPurchaseQuantity: 2, defaultPurchaseUnit: 'bottle',
        consumptionCycleDays: 45, estimatedDepletionDate: '2026-10-05',
      },
    }, `catalog-consumable-profile-${stamp}`)
    const durable = await store.createCatalogItem(owner.id, {
      kind: 'household_durable', name: `Durable ${stamp}`, baseUnit: 'each',
      profile: {
        kind: 'household_durable', valueMinor: 129_900, currency: 'CNY', valueAsOfDate: '2026-08-21',
        lifecycleStatus: 'maintenance', acquiredOn: '2025-03-01', warrantyExpiresOn: '2027-03-01',
        maintenanceRecords: [{ id: 'maintenance-1', performedOn: '2026-08-20', summary: 'Filter replaced', costMinor: 4_500, currency: 'CNY' }],
        retiredOn: null, retirementReason: null, setItemIds: ['attachment-1'],
      },
    }, `catalog-durable-profile-${stamp}`)
    const profileKinds = await rows<RowDataPacket & { itemId: string; profileKind: string | null }>(pool, `
      SELECT item_id itemId, JSON_UNQUOTE(JSON_EXTRACT(profile_data, '$.profile.kind')) profileKind
      FROM life_item_profiles WHERE user_id = ? AND item_id IN (?, ?, ?) ORDER BY item_id
    `, [owner.id, supplement.id, consumable.id, durable.id])
    expect(profileKinds.map((row) => row.profileKind).sort()).toEqual(['household_consumable', 'household_durable', 'supplement'])

    const reconnectedStore = new MySqlLifeStore(pool, { now: () => '2026-08-15T12:00:00.000Z' })
    expect(await reconnectedStore.getCatalogItem(owner.id, supplement.id)).toMatchObject({ profile: supplement.profile })
    expect(await reconnectedStore.getCatalogItem(owner.id, consumable.id)).toMatchObject({ profile: consumable.profile })
    expect(await reconnectedStore.getCatalogItem(owner.id, durable.id)).toMatchObject({ profile: durable.profile })

    const retypedDurable = await store.updateCatalogItem(owner.id, durable.id, { kind: 'supplement', version: 1 })
    expect(retypedDurable).toMatchObject({ kind: 'supplement', version: 2 })
    expect(retypedDurable.profile).toBeUndefined()
    expect((await reconnectedStore.getCatalogItem(owner.id, durable.id))?.profile).toBeUndefined()

    expect(await store.previewCatalogItemDelete(owner.id, egg.id)).toEqual({ recipeIds: [], templateIds: [], futurePlanIds: [] })
    expect(await store.deleteCatalogItem(owner.id, egg.id, 2)).toBe(true)
    expect(await store.getCatalogItem(owner.id, egg.id)).toBeUndefined()
    expect(await store.listDeletedCatalogItems(owner.id)).toEqual(expect.arrayContaining([expect.objectContaining({ id: egg.id, version: 3 })]))
    expect(await store.restoreCatalogItem(owner.id, egg.id, 3)).toMatchObject({ id: egg.id, categoryId: food.id, tagIds: [tag.id], version: 4, deletedAt: null })

    const unsafeMedicine = {
      kind: 'medicine',
      name: `Unsafe medicine ${stamp}`,
      baseUnit: 'tablet',
      medicine: { tradeName: 'User fact', userScheduleText: 'User reminder', recommendation: 'Take twice daily' },
    } as unknown as CreateCatalogItemInput
    const medicineKey = `catalog-medicine-${stamp}`
    await expect(store.createCatalogItem(owner.id, unsafeMedicine, medicineKey))
      .rejects.toMatchObject({ code: 'MEDICINE_ADVICE_NOT_ALLOWED', status: 400 })
    const safeMedicine = await store.createCatalogItem(owner.id, {
      kind: 'medicine', name: `Safe medicine ${stamp}`, baseUnit: 'tablet',
      medicine: { tradeName: 'User fact', userScheduleText: 'User reminder' },
    }, medicineKey)
    expect(safeMedicine.medicine).toEqual({ tradeName: 'User fact', userScheduleText: 'User reminder' })
    expect(safeMedicine).not.toHaveProperty('recommendation')
    expect(safeMedicine.medicine).not.toHaveProperty('recommendation')

    const [auditCount] = await rows<CountRow>(pool, `SELECT COUNT(*) count FROM audit_events
      WHERE user_id = ? AND entity_type = 'life-catalog'`, [owner.id])
    expect(Number(auditCount?.count)).toBeGreaterThanOrEqual(8)
  })

  it('persists an owner-scoped append-only inventory ledger with exact-once replay and reversal', async () => {
    const inventoryTables = ['life_inventory_batches', 'life_inventory_transactions', 'life_inventory_allocations']
    const tableRows = await rows<TableRow>(pool, `SELECT table_name tableName, table_collation tableCollation
      FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (${inventoryTables.map(() => '?').join(', ')})`, inventoryTables)
    expect(tableRows).toHaveLength(inventoryTables.length)
    expect(tableRows.every((row) => row.tableCollation === 'utf8mb4_0900_ai_ci')).toBe(true)

    const stamp = `${Date.now()}`
    const owner = await store.createUser({
      account: `inventory-owner-${stamp}@example.com`, displayName: 'Inventory Owner', passwordHash: await hashPassword('inventory-owner-password'),
    })
    const other = await store.createUser({
      account: `inventory-other-${stamp}@example.com`, displayName: 'Inventory Other', passwordHash: await hashPassword('inventory-other-password'),
    })
    const foreignLocation = await store.createTaxonomy(other.id, 'location', { name: `Foreign pantry ${stamp}` })
    const item = await store.createCatalogItem(owner.id, {
      kind: 'ingredient', name: `Inventory rice ${stamp}`, baseUnit: 'gram', availableUnits: ['package'],
      itemConversions: [{ itemId: 'input-placeholder', fromUnit: 'package', toUnit: 'gram', factor: 500 }],
    }, `inventory-item-${stamp}`)

    const purchaseInput = {
      itemId: item.id, kind: 'purchase' as const, quantity: 2, unit: 'package', occurredAt: '2026-08-13T09:00:00.000Z',
      batch: { purchasedOn: '2026-08-13', expiresOn: '2026-12-31' },
    }
    const purchase = await store.createInventoryTransaction(owner.id, purchaseInput, `inventory-purchase-${stamp}`)
    const purchaseReplay = await store.createInventoryTransaction(owner.id, purchaseInput, `inventory-purchase-${stamp}`)
    expect(purchaseReplay.id).toBe(purchase.id)
    expect(purchase).toMatchObject({ kind: 'purchase', baseQuantity: 1_000, deltaBaseQuantity: 1_000, batchId: expect.any(String) })

    const consume = await store.createInventoryTransaction(owner.id, {
      itemId: item.id, kind: 'consume', quantity: 600, unit: 'gram', occurredAt: '2026-08-14T09:00:00.000Z',
    }, `inventory-consume-${stamp}`)
    expect(consume).toMatchObject({
      deltaBaseQuantity: -600,
      allocations: [{ batchId: purchase.batchId, quantity: 600, expiresOn: '2026-12-31' }],
    })
    const negative = await store.createInventoryTransaction(owner.id, {
      itemId: item.id, kind: 'consume', quantity: 500, unit: 'gram', occurredAt: '2026-08-15T09:00:00.000Z',
    }, `inventory-negative-${stamp}`)
    expect(negative).toMatchObject({ warning: 'negative_inventory', allocations: [{ quantity: 400 }] })
    expect(await store.listInventoryBalances(owner.id, { itemId: item.id })).toEqual([
      expect.objectContaining({ itemId: item.id, onHand: -100, warnings: ['negative_inventory'] }),
    ])

    const reversal = await store.reverseInventoryTransaction(owner.id, consume.id, { note: 'Undo MySQL consume' }, `inventory-reverse-${stamp}`)
    const reversalReplay = await store.reverseInventoryTransaction(owner.id, consume.id, { note: 'Undo MySQL consume' }, `inventory-reverse-${stamp}`)
    expect(reversalReplay?.id).toBe(reversal?.id)
    expect(reversal).toMatchObject({ kind: 'reversal', reversesTransactionId: consume.id, deltaBaseQuantity: 600 })
    await expect(store.reverseInventoryTransaction(owner.id, consume.id, { note: 'Second undo' }, `inventory-reverse-again-${stamp}`))
      .rejects.toMatchObject({ code: 'TRANSACTION_ALREADY_REVERSED', status: 409 })
    expect(await store.listInventoryBalances(owner.id, { itemId: item.id })).toEqual([
      expect.objectContaining({ itemId: item.id, onHand: 500, warnings: [] }),
    ])

    const rollbackKey = `inventory-rollback-${stamp}`
    await expect(store.createInventoryTransaction(owner.id, {
      itemId: item.id, kind: 'purchase', quantity: 100, unit: 'gram', occurredAt: '2026-08-16T09:00:00.000Z',
      batch: { locationId: foreignLocation.id },
    }, rollbackKey)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    const afterRollback = await store.createInventoryTransaction(owner.id, {
      itemId: item.id, kind: 'purchase', quantity: 100, unit: 'gram', occurredAt: '2026-08-16T09:00:00.000Z',
    }, rollbackKey)
    expect(afterRollback).toMatchObject({ kind: 'purchase', deltaBaseQuantity: 100 })

    expect(await store.listInventoryTransactions(other.id, { itemId: item.id })).toEqual([])
    expect(await store.listInventoryBalances(other.id)).toEqual([])
    const [transactionCount] = await rows<CountRow>(pool, 'SELECT COUNT(*) count FROM life_inventory_transactions WHERE user_id = ? AND item_id = ?', [owner.id, item.id])
    expect(Number(transactionCount?.count)).toBe(5)
    expect((await store.listInventoryTransactions(owner.id, { itemId: item.id }))
      .find((entry) => entry.id === consume.id)?.reversedByTransactionId).toBe(reversal?.id)

    const connection = await pool.getConnection()
    await connection.beginTransaction()
    try {
      await expect(connection.execute(
        "UPDATE life_inventory_transactions SET note = 'tampered' WHERE user_id = ? AND id = ?",
        [owner.id, purchase.id],
      )).rejects.toMatchObject({ code: 'ER_SIGNAL_EXCEPTION' })
      await expect(connection.execute(
        'DELETE FROM life_inventory_transactions WHERE user_id = ? AND id = ?',
        [owner.id, purchase.id],
      )).rejects.toMatchObject({ code: 'ER_SIGNAL_EXCEPTION' })
    } finally {
      await connection.rollback()
      connection.release()
    }
  })

  it('persists immutable recipe versions and completes prepared food atomically exactly once', async () => {
    const recipeTables = ['life_recipes', 'life_recipe_versions', 'life_recipe_components', 'life_recipe_steps', 'life_cooking_sessions', 'life_cooking_snapshots', 'life_prepared_food_stock', 'life_recipe_idempotency']
    const tableRows = await rows<TableRow>(pool, `SELECT table_name tableName, table_collation tableCollation
      FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (${recipeTables.map(() => '?').join(', ')})`, recipeTables)
    expect(tableRows).toHaveLength(recipeTables.length)
    expect(tableRows.every((row) => row.tableCollation === 'utf8mb4_0900_ai_ci')).toBe(true)

    const stamp = `${Date.now()}`
    const owner = await store.createUser({ account: `recipe-owner-${stamp}@example.com`, displayName: 'Recipe Owner', passwordHash: await hashPassword('recipe-owner-password') })
    const other = await store.createUser({ account: `recipe-other-${stamp}@example.com`, displayName: 'Recipe Other', passwordHash: await hashPassword('recipe-other-password') })
    const rice = await store.createCatalogItem(owner.id, {
      kind: 'ingredient', name: `Recipe rice ${stamp}`, baseUnit: 'gram', availableUnits: ['kilogram'],
      nutrition: { basisQuantity: 100, basisUnit: 'gram', values: { energyKcal: 130, proteinGrams: 2.7, fatGrams: 0.3, carbohydrateGrams: 28 } },
      pricePoints: [{ amountMinor: 1_000, currency: 'CNY', purchaseQuantity: 1, purchaseUnit: 'kilogram', effectiveFrom: '2026-08-01' }],
    }, `recipe-rice-${stamp}`)
    const egg = await store.createCatalogItem(owner.id, {
      kind: 'ingredient', name: `Recipe egg ${stamp}`, baseUnit: 'each',
      nutrition: { basisQuantity: 1, basisUnit: 'each', values: { energyKcal: 70, proteinGrams: 6, fatGrams: 5, carbohydrateGrams: 0.5 } },
      pricePoints: [{ amountMinor: 600, currency: 'CNY', purchaseQuantity: 12, purchaseUnit: 'each', effectiveFrom: '2026-08-01' }],
    }, `recipe-egg-${stamp}`)
    const tofu = await store.createCatalogItem(owner.id, {
      kind: 'ingredient', name: `Recipe tofu ${stamp}`, baseUnit: 'gram',
      nutrition: { basisQuantity: 100, basisUnit: 'gram', values: { energyKcal: 80, proteinGrams: 8, fatGrams: 4, carbohydrateGrams: 2 } },
      pricePoints: [{ amountMinor: 300, currency: 'CNY', purchaseQuantity: 100, purchaseUnit: 'gram', effectiveFrom: '2026-08-01' }],
    }, `recipe-tofu-${stamp}`)
    const oil = await store.createCatalogItem(owner.id, {
      kind: 'ingredient', name: `Recipe oil ${stamp}`, baseUnit: 'gram', isCookingOil: true,
      nutrition: { basisQuantity: 100, basisUnit: 'gram', values: { energyKcal: 900, proteinGrams: 0, fatGrams: 100, carbohydrateGrams: 0, custom: { sodiumMilligrams: 2 } } },
      pricePoints: [{ amountMinor: 2_000, currency: 'CNY', purchaseQuantity: 1_000, purchaseUnit: 'gram', effectiveFrom: '2026-08-01' }],
    }, `recipe-oil-${stamp}`)
    expect(await store.getCatalogItem(owner.id, oil.id)).toMatchObject({ isCookingOil: true, nutrition: { values: { custom: { sodiumMilligrams: 2 } } } })
    await store.createInventoryTransaction(owner.id, { itemId: rice.id, kind: 'purchase', quantity: 1_000, unit: 'gram', occurredAt: '2026-08-13T08:00:00.000Z' }, `recipe-stock-rice-${stamp}`)
    await store.createInventoryTransaction(owner.id, { itemId: egg.id, kind: 'purchase', quantity: 12, unit: 'each', occurredAt: '2026-08-13T08:00:00.000Z' }, `recipe-stock-egg-${stamp}`)
    await store.createInventoryTransaction(owner.id, { itemId: tofu.id, kind: 'purchase', quantity: 500, unit: 'gram', occurredAt: '2026-08-13T08:00:00.000Z' }, `recipe-stock-tofu-${stamp}`)
    const ownerCover = await store.createMediaAsset(owner.id, {
      originalName: `recipe-cover-${stamp}.png`, mimeType: 'image/png', sizeBytes: 67,
      storageKey: `owner/recipe-cover-${stamp}.png`, checksum: 'C'.repeat(64), width: 1, height: 1,
    }, `owner-recipe-cover-${stamp}`)
    const input = {
      name: `Rice and egg ${stamp}`, description: 'MySQL recipe', coverMediaId: ownerCover.id, servings: 4, yieldQuantity: 4, yieldUnit: 'portion',
      components: [
        { itemId: rice.id, quantity: 200, unit: 'gram', role: 'ingredient' as const, position: 0 },
        { itemId: egg.id, quantity: 2, unit: 'each', role: 'ingredient' as const, position: 1 },
      ],
      steps: [{ instruction: 'Cook.', ingredientItemIds: [rice.id, egg.id], durationSeconds: 600, imageMediaId: null, caution: '', position: 0 }],
    }
    const foreignMedia = await store.createMediaAsset(other.id, {
      originalName: `foreign-recipe-step-${stamp}.png`, mimeType: 'image/png', sizeBytes: 67,
      storageKey: `foreign/recipe-step-${stamp}.png`, checksum: 'B'.repeat(64), width: 1, height: 1,
    }, `foreign-recipe-media-${stamp}`)
    const foreignCategory = await store.createTaxonomy(other.id, 'category', { name: `Foreign recipe category ${stamp}` })
    const foreignTag = await store.createTaxonomy(other.id, 'tag', { name: `Foreign recipe tag ${stamp}` })
    await expect(store.createRecipe(owner.id, {
      ...input,
      steps: [{ ...input.steps[0], imageMediaId: foreignMedia.id }],
    }, `recipe-foreign-media-${stamp}`)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    await expect(store.createRecipe(owner.id, {
      ...input, coverMediaId: foreignMedia.id,
    }, `recipe-foreign-cover-${stamp}`)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    await expect(store.createRecipe(owner.id, {
      ...input, categoryId: foreignCategory.id,
    }, `recipe-foreign-category-${stamp}`)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    await expect(store.createRecipe(owner.id, {
      ...input, tagIds: [foreignTag.id],
    }, `recipe-foreign-tag-${stamp}`)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    const disabledIngredient = await store.createCatalogItem(owner.id, {
      kind: 'ingredient', name: `Disabled recipe ingredient ${stamp}`, baseUnit: 'gram',
      nutrition: { basisQuantity: 100, basisUnit: 'gram', values: { energyKcal: 10, proteinGrams: 1, fatGrams: 0, carbohydrateGrams: 1 } },
      pricePoints: [{ amountMinor: 100, currency: 'CNY', purchaseQuantity: 100, purchaseUnit: 'gram', effectiveFrom: '2026-08-01' }],
    }, `disabled-recipe-ingredient-${stamp}`)
    await store.updateCatalogItem(owner.id, disabledIngredient.id, { status: 'disabled', version: disabledIngredient.version })
    await expect(store.createRecipe(owner.id, {
      ...input,
      components: [{ itemId: disabledIngredient.id, quantity: 100, unit: 'gram', role: 'ingredient', position: 0 }],
      steps: [{ ...input.steps[0], ingredientItemIds: [disabledIngredient.id] }],
    }, `recipe-disabled-ingredient-${stamp}`)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })

    const recipe = await store.createRecipe(owner.id, input, `recipe-create-${stamp}`)
    expect(recipe.coverMediaId).toBe(ownerCover.id)
    expect(await store.previewCatalogItemDelete(owner.id, rice.id)).toEqual({ recipeIds: [recipe.id], templateIds: [], futurePlanIds: [] })
    const replay = await store.createRecipe(owner.id, input, `recipe-create-${stamp}`)
    expect(replay.id).toBe(recipe.id)
    const disabledRice = await store.updateCatalogItem(owner.id, rice.id, { status: 'disabled', version: rice.version })
    await expect(store.createRecipe(owner.id, input, `recipe-create-${stamp}`)).resolves.toEqual(recipe)
    const activeRice = await store.updateCatalogItem(owner.id, rice.id, { status: 'active', version: disabledRice!.version })
    expect(await store.listRecipes(other.id)).toEqual([])
    const alternateRecipe = await store.createRecipe(owner.id, { ...input, name: `Alternate recipe ${stamp}` }, `recipe-alternate-${stamp}`)
    await expect(pool.execute(
      'UPDATE life_recipes SET current_version_id = ? WHERE user_id = ? AND id = ?',
      [alternateRecipe.currentVersion.id, owner.id, recipe.id],
    )).rejects.toMatchObject({ code: 'ER_NO_REFERENCED_ROW_2' })
    expect(await store.deleteRecipe(owner.id, alternateRecipe.id, 1)).toBe(true)
    expect(await store.getRecipe(owner.id, alternateRecipe.id)).toBeUndefined()
    expect(await store.listDeletedRecipes(other.id)).toEqual([])
    expect(await store.listDeletedRecipes(owner.id)).toEqual([expect.objectContaining({ id: alternateRecipe.id, entityVersion: 2, deletedAt: expect.any(String) })])
    await expect(store.createCookingSession(owner.id, {
      recipeId: alternateRecipe.id, plannedServings: 1, note: '',
    }, `deleted-recipe-session-${stamp}`)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    await expect(store.restoreRecipe(owner.id, alternateRecipe.id, 1)).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 })
    expect(await store.restoreRecipe(owner.id, alternateRecipe.id, 2)).toMatchObject({ id: alternateRecipe.id, entityVersion: 3, deletedAt: null })
    await expect(pool.execute(
      `INSERT INTO life_cooking_sessions
        (id,user_id,recipe_id,recipe_version_id,planned_servings,note,status,created_at,completed_at)
       VALUES (?,?,?,?,?,?,'active',CURRENT_TIMESTAMP(3),NULL)`,
      [`mismatched-session-${stamp}`, owner.id, recipe.id, alternateRecipe.currentVersion.id, 1, ''],
    )).rejects.toMatchObject({ code: 'ER_NO_REFERENCED_ROW_2' })
    await expect(pool.execute(
      `INSERT INTO life_recipe_steps
        (id,user_id,recipe_version_id,instruction,ingredient_item_ids,duration_seconds,image_media_id,caution,position)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [`foreign-step-${stamp}`, owner.id, recipe.currentVersion.id, 'Foreign image.', JSON.stringify([rice.id]), null, foreignMedia.id, '', 99],
    )).rejects.toMatchObject({ code: 'ER_NO_REFERENCED_ROW_2' })
    const metadataOnly = await store.updateRecipe(owner.id, recipe.id, { ...input, entityVersion: 1, description: 'Metadata only' })
    expect(metadataOnly).toMatchObject({ entityVersion: 2, currentVersion: { id: recipe.currentVersion.id, number: 1 } })
    expect(await store.listRecipeVersions(owner.id, recipe.id)).toHaveLength(1)
    const updated = await store.updateRecipe(owner.id, recipe.id, { ...input, entityVersion: 2, servings: 6 })
    expect(updated).toMatchObject({ entityVersion: 3, currentVersion: { number: 2, servings: 6 } })
    expect(await store.listRecipeVersions(owner.id, recipe.id)).toHaveLength(2)
    await expect(store.createCookingSession(owner.id, {
      recipeId: recipe.id, recipeVersionId: recipe.currentVersion.id, plannedServings: 0, note: '',
    }, `recipe-invalid-session-${stamp}`)).rejects.toMatchObject({ code: 'INVALID_INPUT', status: 400 })
    const invalidSnapshotSession = await store.createCookingSession(owner.id, {
      recipeId: recipe.id, recipeVersionId: recipe.currentVersion.id, plannedServings: 1, note: '',
    }, `recipe-invalid-snapshot-session-${stamp}`)
    await expect(pool.execute(
      `INSERT INTO life_cooking_snapshots
        (id,user_id,cooking_session_id,recipe_id,recipe_version_id,made_servings,eaten_servings,ingredients_snapshot,total_cost_minor,total_nutrition,intake_nutrition,cooking_oil_grams,intake_cooking_oil_grams,completed_at)
       VALUES (?,?,?,?,?,?,?,'[]',0,'{}','{}',0,0,CURRENT_TIMESTAMP(3))`,
      [`invalid-snapshot-${stamp}`, owner.id, invalidSnapshotSession.id, recipe.id, recipe.currentVersion.id, 0, 1],
    )).rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' })

    const session = await store.createCookingSession(owner.id, { recipeId: recipe.id, recipeVersionId: recipe.currentVersion.id, plannedServings: 4, note: 'Use lower heat.' }, `recipe-session-${stamp}`)
    const stepId = recipe.currentVersion.steps[0]!.id
    const progress = await store.updateCookingSession(owner.id, session.id, {
      entityVersion: 1,
      currentStepIndex: 1,
      completedStepIds: [stepId],
      actualIngredients: [
        { itemId: rice.id, quantity: 150, unit: 'gram', replacesItemId: null },
        { itemId: tofu.id, quantity: 100, unit: 'gram', replacesItemId: egg.id },
      ],
      timers: [{ stepId, elapsedSeconds: 45, running: false, startedAt: null }],
    })
    expect(progress).toMatchObject({ entityVersion: 2, progress: { currentStepIndex: 1, completedStepIds: [stepId] } })
    expect(await store.getCookingSession(owner.id, session.id)).toEqual(progress)
    await expect(store.updateCookingSession(owner.id, session.id, {
      entityVersion: 1, currentStepIndex: 0, completedStepIds: [], actualIngredients: [], timers: [],
    })).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 })
    const promoted = await store.promoteCookingNote(owner.id, session.id, 3, `recipe-promote-${stamp}`)
    expect(promoted).toMatchObject({ number: 3, promotedNote: 'Use lower heat.' })
    const metadataAfterPromotion = await store.updateRecipe(owner.id, recipe.id, {
      ...input, entityVersion: 4, servings: 6, description: 'Keep the promoted note.',
    })
    expect(metadataAfterPromotion).toMatchObject({ entityVersion: 5, currentVersion: { number: 3, promotedNote: 'Use lower heat.' } })
    expect(await store.listRecipeVersions(owner.id, recipe.id)).toHaveLength(3)
    const completionInput = { madeServings: 4, eatenServings: 1, completedAt: '2026-08-13T10:00:00.000Z' }
    const completed = await store.completeCookingSession(owner.id, session.id, completionInput, `recipe-complete-${stamp}`)
    expect(completed?.snapshot.ingredients).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: tofu.id, quantity: 100, replacesItemId: egg.id }),
    ]))
    const unavailableRice = await store.updateCatalogItem(owner.id, rice.id, { status: 'disabled', version: activeRice!.version })
    const completedReplay = await store.completeCookingSession(owner.id, session.id, completionInput, `recipe-complete-${stamp}`)
    expect(completedReplay).toEqual(completed)
    await store.updateCatalogItem(owner.id, rice.id, { status: 'active', version: unavailableRice!.version })
    expect(completed).toMatchObject({
      snapshot: { cookingOilGrams: 0, intakeCookingOilGrams: 0 },
      preparedFood: { portionsCreated: 3, portionsRemaining: 3, cookingOilGramsRemaining: 0 },
      intake: { servings: 1, cookingOilGrams: 0 },
    })
    expect(await store.listPreparedFood(owner.id)).toEqual([expect.objectContaining({ recipeId: recipe.id, recipeVersionId: recipe.currentVersion.id, portionsRemaining: 3 })])
    expect(await store.listInventoryBalances(owner.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: rice.id, onHand: 850 }),
      expect.objectContaining({ itemId: egg.id, onHand: 12 }),
      expect.objectContaining({ itemId: tofu.id, onHand: 400 }),
    ]))
    await expect(pool.execute(
      `INSERT INTO life_prepared_food_stock
        (id,user_id,cooking_snapshot_id,recipe_id,recipe_version_id,portions_created,portions_remaining,nutrition_remaining,cooking_oil_grams_remaining,cost_remaining_minor,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP(3))`,
      [`invalid-prepared-${stamp}`, owner.id, completed!.snapshot.id, recipe.id, recipe.currentVersion.id, 1, 2, '{}', 0, 0],
    )).rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' })
    const [snapshotCount] = await rows<CountRow>(pool, 'SELECT COUNT(*) count FROM life_cooking_snapshots WHERE user_id = ? AND cooking_session_id = ?', [owner.id, session.id])
    expect(Number(snapshotCount?.count)).toBe(1)
    await expect(pool.execute('UPDATE life_cooking_snapshots SET eaten_servings = 0 WHERE user_id = ? AND id = ?', [owner.id, completed!.snapshot.id]))
      .rejects.toMatchObject({ code: 'ER_SIGNAL_EXCEPTION' })
    await expect(pool.execute('DELETE FROM life_cooking_snapshots WHERE user_id = ? AND id = ?', [owner.id, completed!.snapshot.id]))
      .rejects.toMatchObject({ code: 'ER_SIGNAL_EXCEPTION' })

    const connection = await pool.getConnection()
    await connection.beginTransaction()
    try {
      await expect(connection.execute('UPDATE life_recipe_versions SET servings = 99 WHERE user_id = ? AND id = ?', [owner.id, recipe.currentVersion.id]))
        .rejects.toMatchObject({ code: 'ER_SIGNAL_EXCEPTION' })
      await expect(connection.execute('DELETE FROM life_recipe_components WHERE user_id = ? AND recipe_version_id = ?', [owner.id, recipe.currentVersion.id]))
        .rejects.toMatchObject({ code: 'ER_SIGNAL_EXCEPTION' })
    } finally {
      await connection.rollback()
      connection.release()
    }
  })

  it('persists independent planning facts and completes or undoes inventory atomically exactly once', async () => {
    const planningTables = [
      'life_plan_templates',
      'life_day_plans',
      'life_template_applications',
      'life_medicine_recurrence_rules',
      'life_medicine_recurrence_occurrences',
      'fitness_activities',
      'life_completion_snapshots',
      'life_completion_inventory_events',
      'life_completion_prepared_food_events',
      'life_completion_reversals',
      'life_planning_idempotency',
    ]
    const tableRows = await rows<TableRow>(pool, `SELECT table_name tableName, table_collation tableCollation
      FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (${planningTables.map(() => '?').join(', ')})`, planningTables)
    expect(tableRows).toHaveLength(planningTables.length)
    expect(tableRows.every((row) => row.tableCollation === 'utf8mb4_0900_ai_ci')).toBe(true)

    const expectedConstraints = new Map([
      ['uq_life_day_plans_user_date', 'UNIQUE'],
      ['fk_life_template_applications_template', 'FOREIGN KEY'],
      ['fk_life_template_applications_day', 'FOREIGN KEY'],
      ['fk_life_medicine_recurrence_source', 'FOREIGN KEY'],
      ['chk_life_medicine_recurrence_quantity', 'CHECK'],
      ['uq_life_medicine_occurrence_identity', 'UNIQUE'],
      ['fk_life_medicine_occurrences_rule', 'FOREIGN KEY'],
      ['fk_life_medicine_occurrences_source', 'FOREIGN KEY'],
      ['chk_life_medicine_occurrence_quantity', 'CHECK'],
      ['chk_life_medicine_occurrence_completion', 'CHECK'],
      ['fk_life_medicine_occurrences_completion', 'FOREIGN KEY'],
      ['chk_fitness_activities_values', 'CHECK'],
      ['chk_life_completion_snapshot_source', 'CHECK'],
      ['fk_life_completion_snapshots_occurrence', 'FOREIGN KEY'],
      ['uq_life_completion_snapshots_occurrence_link', 'UNIQUE'],
      ['chk_life_completion_snapshot_values', 'CHECK'],
      ['uq_life_completion_reversals_completion', 'UNIQUE'],
    ])
    const constraintRows = await rows<ConstraintRow>(pool, `SELECT constraint_name constraintName, constraint_type constraintType
      FROM information_schema.table_constraints
      WHERE constraint_schema = DATABASE() AND constraint_name IN (${[...expectedConstraints].map(() => '?').join(', ')})`, [...expectedConstraints.keys()])
    expect(new Map(constraintRows.map((row) => [row.constraintName, row.constraintType]))).toEqual(expectedConstraints)

    const triggerRows = await rows<TriggerRow>(pool, `SELECT trigger_name triggerName, action_timing actionTiming, event_manipulation eventManipulation
      FROM information_schema.triggers
      WHERE trigger_schema = DATABASE() AND event_object_table IN (
        'life_completion_snapshots', 'life_completion_inventory_events', 'life_completion_prepared_food_events',
        'life_completion_reversals', 'life_medicine_recurrence_occurrences', 'life_medicine_recurrence_rules'
      )
      ORDER BY trigger_name`)
    expect(triggerRows).toEqual([
      { triggerName: 'trg_life_completion_inventory_no_delete', actionTiming: 'BEFORE', eventManipulation: 'DELETE' },
      { triggerName: 'trg_life_completion_inventory_no_update', actionTiming: 'BEFORE', eventManipulation: 'UPDATE' },
      { triggerName: 'trg_life_completion_prepared_no_delete', actionTiming: 'BEFORE', eventManipulation: 'DELETE' },
      { triggerName: 'trg_life_completion_prepared_no_update', actionTiming: 'BEFORE', eventManipulation: 'UPDATE' },
      { triggerName: 'trg_life_completion_reversals_no_delete', actionTiming: 'BEFORE', eventManipulation: 'DELETE' },
      { triggerName: 'trg_life_completion_reversals_no_update', actionTiming: 'BEFORE', eventManipulation: 'UPDATE' },
      { triggerName: 'trg_life_completion_snapshots_no_delete', actionTiming: 'BEFORE', eventManipulation: 'DELETE' },
      { triggerName: 'trg_life_completion_snapshots_no_update', actionTiming: 'BEFORE', eventManipulation: 'UPDATE' },
      { triggerName: 'trg_life_completion_snapshot_source_validate', actionTiming: 'BEFORE', eventManipulation: 'INSERT' },
      { triggerName: 'trg_life_medicine_occurrence_identity_no_update', actionTiming: 'BEFORE', eventManipulation: 'UPDATE' },
      { triggerName: 'trg_life_medicine_occurrence_no_delete', actionTiming: 'BEFORE', eventManipulation: 'DELETE' },
      { triggerName: 'trg_life_medicine_recurrence_rule_no_delete', actionTiming: 'BEFORE', eventManipulation: 'DELETE' },
      { triggerName: 'trg_life_medicine_recurrence_rule_no_update', actionTiming: 'BEFORE', eventManipulation: 'UPDATE' },
    ])

    const stamp = `${Date.now()}`
    const owner = await store.createUser({
      account: `planning-owner-${stamp}@example.com`, displayName: 'Planning Owner', passwordHash: await hashPassword('planning-owner-password'),
    })
    const other = await store.createUser({
      account: `planning-other-${stamp}@example.com`, displayName: 'Planning Other', passwordHash: await hashPassword('planning-other-password'),
    })
    const supplement = await store.createCatalogItem(owner.id, {
      kind: 'supplement', name: `Planning supplement ${stamp}`, baseUnit: 'capsule', availableUnits: ['capsule'],
      nutrition: { basisQuantity: 1, basisUnit: 'capsule', values: { energyKcal: 5, proteinGrams: 0, fatGrams: 0, carbohydrateGrams: 1 } },
      pricePoints: [{ amountMinor: 3_000, currency: 'CNY', purchaseQuantity: 30, purchaseUnit: 'capsule', effectiveFrom: '2026-08-01' }],
    }, `planning-supplement-${stamp}`)
    const medicine = await store.createCatalogItem(owner.id, {
      kind: 'medicine', name: `Planning medicine ${stamp}`, baseUnit: 'tablet', availableUnits: ['tablet'],
    }, `planning-medicine-${stamp}`)
    const recurrenceInput = {
      title: `User medicine schedule ${stamp}`, sourceId: medicine.id, quantity: 1, unit: 'tablet',
      recurrence: { mode: 'weekdays' as const, weekdays: [1, 3], times: ['08:00'], startDate: '2026-08-17', endDate: '2026-08-23' },
    }
    const recurrenceRule = await store.createMedicineRecurrenceRule(owner.id, recurrenceInput, `planning-recurrence-${stamp}`)
    expect(await store.createMedicineRecurrenceRule(owner.id, recurrenceInput, `planning-recurrence-${stamp}`)).toEqual(recurrenceRule)
    expect(await new MySqlLifeStore(pool).listMedicineRecurrenceRules(owner.id)).toEqual([recurrenceRule])
    expect(await store.listMedicineRecurrenceRules(other.id)).toEqual([])
    expect(await store.updateMedicineRecurrenceRule(other.id, recurrenceRule.id, { ...recurrenceInput, entityVersion: 1 })).toBeUndefined()
    const updatedRecurrenceRule = await store.updateMedicineRecurrenceRule(owner.id, recurrenceRule.id, {
      ...recurrenceInput, entityVersion: 1,
      recurrence: { mode: 'interval', everyDays: 2, times: ['09:00'], startDate: '2026-08-17', endDate: '2026-08-23' },
    })
    expect(updatedRecurrenceRule).toMatchObject({ entityVersion: 2, recurrence: { mode: 'interval', everyDays: 2, times: ['09:00'] } })
    await expect(store.updateMedicineRecurrenceRule(owner.id, recurrenceRule.id, { ...recurrenceInput, entityVersion: 1 }))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 })
    expect(await store.deleteMedicineRecurrenceRule(other.id, recurrenceRule.id, 2)).toBe(false)
    await expect(store.deleteMedicineRecurrenceRule(owner.id, recurrenceRule.id, 1))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 })
    expect(await store.deleteMedicineRecurrenceRule(owner.id, recurrenceRule.id, 2)).toBe(true)
    expect(await store.listMedicineRecurrenceRules(owner.id)).toEqual([])
    const [deletedRule] = await rows<RowDataPacket & { entityVersion: number; deletedAt: Date | string | null }>(pool,
      'SELECT entity_version entityVersion,deleted_at deletedAt FROM life_medicine_recurrence_rules WHERE user_id=? AND id=?', [owner.id, recurrenceRule.id])
    expect(deletedRule).toMatchObject({ entityVersion: 3 })
    expect(deletedRule?.deletedAt).not.toBeNull()
    await store.createInventoryTransaction(owner.id, {
      itemId: supplement.id, kind: 'purchase', quantity: 10, unit: 'capsule', occurredAt: '2026-08-18T06:00:00.000Z',
      batch: { actualUnitCostMinor: 73 },
    }, `planning-stock-${stamp}`)

    const mealSlots = [{ id: 'morning', name: 'Morning', position: 0, hidden: false }]
    const templateInput = {
      name: `Weekday plan ${stamp}`,
      mealSlots,
      items: [{
        kind: 'supplement' as const, title: 'Original supplement fact', mealSlotId: 'morning', scheduledTime: '08:00',
        weekdays: [1, 2, 3, 4, 5], source: { type: 'catalog-item' as const, id: supplement.id },
        quantity: 1, unit: 'capsule', servings: null, durationMinutes: null,
      }],
    }
    const template = await store.createPlanTemplate(owner.id, templateInput, `planning-template-${stamp}`)
    expect(await new MySqlLifeStore(pool).getPlanTemplate(owner.id, template.id)).toEqual(template)
    const day = await store.createDayPlan(owner.id, { date: '2026-08-18', mealSlots, items: [] }, `planning-day-${stamp}`)
    const applied = await store.applyTemplateToDayPlan(owner.id, day.date, {
      templateId: template.id, resolution: 'merge', entityVersion: day.entityVersion, templateVersion: template.entityVersion,
    }, `planning-apply-${stamp}`)
    expect(applied).toMatchObject({
      items: [expect.objectContaining({
        title: 'Original supplement fact', originTemplateItemId: template.items[0]!.id, status: 'planned',
      })],
    })
    const updatedTemplate = await store.updatePlanTemplate(owner.id, template.id, {
      ...templateInput,
      entityVersion: template.entityVersion,
      name: `Changed plan ${stamp}`,
      items: [{ ...templateInput.items[0]!, title: 'Changed template fact' }],
    })
    await expect(store.applyTemplateToDayPlan(owner.id, day.date, {
      templateId: template.id, resolution: 'replace', entityVersion: applied!.entityVersion, templateVersion: template.entityVersion,
    }, `planning-stale-template-apply-${stamp}`)).rejects.toMatchObject({ code: 'TEMPLATE_VERSION_CONFLICT', status: 409 })
    const syncPreview = await store.previewTemplateSync(owner.id, template.id, { fromDate: day.date, target: 'future-incomplete' })
    expect(syncPreview).toMatchObject({ templateVersion: updatedTemplate!.entityVersion, dayPlanVersions: { [day.date]: applied!.entityVersion } })
    await store.transitionDayPlanItem(owner.id, day.date, applied!.items[0]!.id, {
      entityVersion: applied!.items[0]!.entityVersion, action: 'delay', at: '2026-08-18T07:00:00.000Z', delayedUntil: '08:15',
    })
    await expect(store.syncPlanTemplate(owner.id, template.id, {
      fromDate: day.date, target: 'future-incomplete', templateVersion: syncPreview!.templateVersion, dayPlanVersions: syncPreview!.dayPlanVersions,
    }, `planning-stale-day-sync-${stamp}`)).rejects.toMatchObject({ code: 'DAY_PLAN_VERSION_CONFLICT', status: 409 })
    expect(await new MySqlLifeStore(pool).getDayPlan(owner.id, day.date)).toMatchObject({
      items: [expect.objectContaining({ title: 'Original supplement fact', originTemplateItemId: template.items[0]!.id })],
    })
    expect(await store.getDayPlanProjection(owner.id, day.date)).toMatchObject({
      status: 'complete', plannedNutrition: { energyKcal: 5, proteinGrams: 0, fatGrams: 0, carbohydrateGrams: 1 },
      plannedCostMinor: 100,
      inventory: [expect.objectContaining({ itemId: supplement.id, status: 'complete', onHand: 10, plannedDemand: 1, projectedBalance: 9 })],
      items: [expect.objectContaining({ mode: 'planned', source: { type: 'catalog-item', id: supplement.id } })],
    })
    expect(await store.getPlanTemplate(other.id, template.id)).toBeUndefined()
    expect(await store.getDayPlan(other.id, day.date)).toBeUndefined()
    expect(await store.getDayPlanProjection(other.id, day.date)).toBeUndefined()
    await expect(store.createDayPlan(other.id, {
      date: '2026-08-18', mealSlots, items: templateInput.items,
    }, `planning-foreign-source-${stamp}`)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })

    const draftDay = await store.createDayPlan(owner.id, {
      date: '2026-08-24', mealSlots: [], items: [{
        kind: 'custom', title: 'Original reminder', scheduledTime: '08:00', source: null,
        quantity: null, unit: null, servings: null, durationMinutes: null,
      }],
    }, `planning-draft-${stamp}`)
    const draftStore = store as unknown as {
      updateDayPlan: (userId: string, date: string, input: {
        entityVersion: number
        mealSlots: typeof mealSlots
        items: Array<Record<string, unknown>>
      }) => Promise<DayPlan | undefined>
    }
    expect(typeof draftStore.updateDayPlan).toBe('function')
    const updateDayPlan = (...args: Parameters<typeof draftStore.updateDayPlan>) => draftStore.updateDayPlan(...args)
    const draftInput = {
      entityVersion: draftDay.entityVersion,
      mealSlots,
      items: [
        {
          id: draftDay.items[0]!.id, entityVersion: draftDay.items[0]!.entityVersion,
          kind: 'custom', title: 'Edited reminder', mealSlotId: 'morning', scheduledTime: '09:15', source: null,
          quantity: null, unit: null, servings: null, durationMinutes: null,
        },
        {
          kind: 'custom', title: 'New reminder', mealSlotId: 'morning', scheduledTime: '12:00', source: null,
          quantity: null, unit: null, servings: null, durationMinutes: null,
        },
      ],
    }
    const updatedDraft = await updateDayPlan(owner.id, draftDay.date, draftInput)
    expect(updatedDraft).toMatchObject({
      entityVersion: 2,
      items: [
        expect.objectContaining({ id: draftDay.items[0]!.id, title: 'Edited reminder', entityVersion: 2 }),
        expect.objectContaining({ title: 'New reminder', entityVersion: 1 }),
      ],
    })
    expect(await new MySqlLifeStore(pool).getDayPlan(owner.id, draftDay.date)).toEqual(updatedDraft)
    await expect(updateDayPlan(owner.id, draftDay.date, draftInput))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 })
    expect(await updateDayPlan(other.id, draftDay.date, draftInput)).toBeUndefined()
    await store.createPlanningCompletion(owner.id, {
      date: draftDay.date,
      dayPlanItemId: updatedDraft!.items[0]!.id,
      completedAt: '2026-08-24T09:30:00.000Z',
    }, `planning-draft-complete-${stamp}`)
    const completedDraft = (await store.getDayPlan(owner.id, draftDay.date))!
    await expect(updateDayPlan(owner.id, draftDay.date, {
      entityVersion: completedDraft.entityVersion,
      mealSlots: completedDraft.mealSlots,
      items: completedDraft.items.map((item, index) => ({
        id: item.id, entityVersion: item.entityVersion, kind: item.kind,
        title: index === 0 ? 'Changed completed history' : item.title,
        mealSlotId: item.mealSlotId, scheduledTime: item.scheduledTime, source: item.source,
        quantity: item.quantity, unit: item.unit, servings: item.servings, durationMinutes: item.durationMinutes,
      })),
    })).rejects.toMatchObject({ code: 'COMPLETED_ITEM_IMMUTABLE', status: 409 })

    const inventoryBalance = async () => (await store.listInventoryBalances(owner.id))
      .find((entry) => entry.itemId === supplement.id)?.onHand
    const itemId = applied!.items[0]!.id
    const completionInput = { date: day.date, dayPlanItemId: itemId, completedAt: '2026-08-18T08:05:00.000Z' }
    const completion = await store.createPlanningCompletion(owner.id, completionInput, `planning-complete-${stamp}`)
    expect(await store.createPlanningCompletion(owner.id, completionInput, `planning-complete-${stamp}`)).toEqual(completion)
    await expect(store.createPlanningCompletion(owner.id, {
      ...completionInput, completedAt: '2026-08-18T08:06:00.000Z',
    }, `planning-complete-${stamp}`)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 })
    expect(await inventoryBalance()).toBe(9)
    expect(await store.getDayPlanProjection(owner.id, day.date)).toMatchObject({
      plannedNutrition: {}, actualNutrition: { energyKcal: 5, proteinGrams: 0, fatGrams: 0, carbohydrateGrams: 1 },
      plannedCostMinor: 0, actualCostMinor: 73, inventory: [],
      items: [expect.objectContaining({ mode: 'actual', costMinor: 73 })],
    })
    const [mutableDayRow] = await rows<RowDataPacket & { itemsJson: unknown }>(pool,
      'SELECT items_json itemsJson FROM life_day_plans WHERE user_id = ? AND id = ?', [owner.id, day.id])
    const staleItems = (typeof mutableDayRow!.itemsJson === 'string'
      ? JSON.parse(mutableDayRow!.itemsJson) : structuredClone(mutableDayRow!.itemsJson)) as LifePlanItem[]
    staleItems[0]!.actual = null
    await pool.execute('UPDATE life_day_plans SET items_json = ? WHERE user_id = ? AND id = ?', [JSON.stringify(staleItems), owner.id, day.id])
    expect(await store.getDayPlan(owner.id, day.date)).toMatchObject({
      items: [expect.objectContaining({
        completionId: completion.id,
        actual: expect.objectContaining({ completedAt: completion.completedAt, costMinor: completion.costMinor }),
      })],
    })
    expect(await store.undoPlanningCompletion(other.id, completion.id, `planning-foreign-undo-${stamp}`)).toBeUndefined()
    await expect(pool.execute(
      'UPDATE life_completion_snapshots SET cost_minor = 0 WHERE user_id = ? AND id = ?',
      [owner.id, completion.id],
    )).rejects.toMatchObject({ code: 'ER_SIGNAL_EXCEPTION' })
    await expect(pool.execute(
      'DELETE FROM life_completion_inventory_events WHERE user_id = ? AND completion_id = ?',
      [owner.id, completion.id],
    )).rejects.toMatchObject({ code: 'ER_SIGNAL_EXCEPTION' })

    const undo = await store.undoPlanningCompletion(owner.id, completion.id, `planning-undo-${stamp}`)
    expect(await store.undoPlanningCompletion(owner.id, completion.id, `planning-undo-${stamp}`)).toEqual(undo)
    await expect(store.undoPlanningCompletion(owner.id, completion.id, `planning-undo-again-${stamp}`))
      .rejects.toMatchObject({ code: 'COMPLETION_ALREADY_UNDONE', status: 409 })
    expect(await inventoryBalance()).toBe(10)
    expect(await store.getDayPlan(owner.id, day.date)).toMatchObject({
      items: [expect.objectContaining({ id: itemId, status: 'planned', completionId: null, actual: null })],
    })

    const secondCompletion = await store.createPlanningCompletion(
      owner.id,
      completionInput,
      `planning-recomplete-${stamp}`,
    )
    expect(secondCompletion.id).not.toBe(completion.id)
    expect(await inventoryBalance()).toBe(9)
    const [completionCount] = await rows<CountRow>(pool, `SELECT COUNT(*) count FROM life_completion_snapshots
      WHERE user_id = ? AND day_plan_id = ? AND day_plan_item_id = ?`, [owner.id, day.id, itemId])
    expect(Number(completionCount?.count)).toBe(2)

    const rollbackDay = await store.createDayPlan(owner.id, {
      date: '2026-08-19', mealSlots, items: [{ ...templateInput.items[0]!, weekdays: undefined, title: 'Rollback supplement fact' }],
    }, `planning-rollback-day-${stamp}`)
    const rollbackInput = {
      date: rollbackDay.date, dayPlanItemId: rollbackDay.items[0]!.id, completedAt: '2026-08-19T08:05:00.000Z',
    }
    const rollbackKey = `planning-rollback-${stamp}`
    const balanceBeforeRollback = await inventoryBalance()
    await pool.query('DROP TRIGGER IF EXISTS trg_test_life_completion_insert_fail')
    await pool.query(`CREATE TRIGGER trg_test_life_completion_insert_fail BEFORE INSERT ON life_completion_snapshots
      FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TEST_PLANNING_COMPLETION_ROLLBACK'`)
    try {
      await expect(store.createPlanningCompletion(owner.id, rollbackInput, rollbackKey))
        .rejects.toMatchObject({ code: 'ER_SIGNAL_EXCEPTION' })
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS trg_test_life_completion_insert_fail')
    }
    expect(await inventoryBalance()).toBe(balanceBeforeRollback)
    expect(await store.getDayPlan(owner.id, rollbackDay.date)).toMatchObject({
      items: [expect.objectContaining({ status: 'planned', completionId: null, actual: null })],
    })
    const [rolledBackKey] = await rows<CountRow>(pool, `SELECT COUNT(*) count FROM life_planning_idempotency
      WHERE user_id = ? AND operation_key = 'planning:create-completion' AND idempotency_key = ?`, [owner.id, rollbackKey])
    expect(Number(rolledBackKey?.count)).toBe(0)
    const retriedCompletion = await store.createPlanningCompletion(owner.id, rollbackInput, rollbackKey)
    expect(retriedCompletion.dayPlanItemId).toBe(rollbackDay.items[0]!.id)
    expect(await inventoryBalance()).toBe(balanceBeforeRollback! - 1)
  })

  it('persists stable occurrence-only timelines without eager day-plan JSON writes and survives store reconnection', async () => {
    const stamp = `${Date.now()}`
    const now = '2098-12-15T12:00:00.000Z'
    const occurrenceStore = withOccurrences(new MySqlLifeStore(pool, { now: () => now }))
    const owner = await occurrenceStore.createUser({
      account: `occurrence-timeline-owner-${stamp}@example.com`,
      displayName: 'Occurrence Timeline Owner',
      passwordHash: await hashPassword('occurrence-timeline-owner-password'),
    })
    const other = await occurrenceStore.createUser({
      account: `occurrence-timeline-other-${stamp}@example.com`,
      displayName: 'Occurrence Timeline Other',
      passwordHash: await hashPassword('occurrence-timeline-other-password'),
    })
    const medicine = await occurrenceStore.createCatalogItem(owner.id, {
      kind: 'medicine', name: `Occurrence timeline medicine ${stamp}`, baseUnit: 'tablet', availableUnits: ['tablet'],
    }, `occurrence-timeline-medicine-${stamp}`)
    const explicitDay = await occurrenceStore.createDayPlan(owner.id, {
      date: '2099-01-01', mealSlots: [], items: [{
        kind: 'custom', title: 'Explicit day fact', mealSlotId: null, scheduledTime: '07:00', source: null,
        quantity: null, unit: null, servings: null, durationMinutes: null,
      }],
    }, `occurrence-explicit-day-${stamp}`)
    const [dayBefore] = await rows<RowDataPacket & { itemsJson: unknown; entityVersion: number }>(pool,
      'SELECT items_json itemsJson, entity_version entityVersion FROM life_day_plans WHERE user_id=? AND id=?',
      [owner.id, explicitDay.id])

    const input = {
      title: 'User-authored occurrence timeline', sourceId: medicine.id, quantity: 1.5, unit: 'tablet',
      recurrence: {
        mode: 'interval' as const, everyDays: 1, times: ['08:00', '20:00'],
        startDate: '2099-01-01', endDate: '2099-01-03',
      },
    }
    const rule = await occurrenceStore.createMedicineRecurrenceRule(owner.id, input, `occurrence-timeline-rule-${stamp}`)
    expect(await occurrenceStore.createMedicineRecurrenceRule(owner.id, input, `occurrence-timeline-rule-${stamp}`)).toEqual(rule)

    const occurrenceRows = await rows<RowDataPacket & {
      id: string; userId: string; ruleId: string; sourceItemId: string; originalDate: string; originalTime: string
      scheduledDate: string; scheduledTime: string; status: string; entityVersion: number
    }>(pool, `SELECT id,user_id userId,rule_id ruleId,source_item_id sourceItemId,
      original_date originalDate,original_time originalTime,scheduled_date scheduledDate,scheduled_time scheduledTime,
      status,entity_version entityVersion FROM life_medicine_recurrence_occurrences
      WHERE user_id=? AND rule_id=? ORDER BY original_date,original_time`, [owner.id, rule.id])
    expect(occurrenceRows).toHaveLength(6)
    expect(occurrenceRows[0]).toMatchObject({
      userId: owner.id, ruleId: rule.id, sourceItemId: medicine.id,
      originalDate: '2099-01-01', originalTime: '08:00:00',
      scheduledDate: '2099-01-01', scheduledTime: '08:00:00', status: 'planned', entityVersion: 1,
    })
    expect(new Set(occurrenceRows.map((entry) => `${entry.userId}\0${entry.ruleId}\0${entry.originalDate}\0${entry.originalTime}`)).size).toBe(6)

    const [dayAfter] = await rows<RowDataPacket & { itemsJson: unknown; entityVersion: number }>(pool,
      'SELECT items_json itemsJson, entity_version entityVersion FROM life_day_plans WHERE user_id=? AND id=?',
      [owner.id, explicitDay.id])
    expect(dayAfter).toEqual(dayBefore)
    const [occurrenceOnlyDayCount] = await rows<CountRow>(pool,
      "SELECT COUNT(*) count FROM life_day_plans WHERE user_id=? AND plan_date IN ('2099-01-02','2099-01-03')", [owner.id])
    expect(Number(occurrenceOnlyDayCount?.count)).toBe(0)

    const explicitTimeline = await occurrenceStore.getPlanningTimeline(owner.id, '2099-01-01')
    expect(explicitTimeline.timelineItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceType: 'day-plan-item', id: explicitDay.items[0]!.id }),
      expect.objectContaining({
        sourceType: 'medicine-occurrence', ruleId: rule.id, source: { type: 'catalog-item', id: medicine.id },
        quantity: 1.5, unit: 'tablet', originalDate: '2099-01-01', originalTime: '08:00',
        scheduledDate: '2099-01-01', scheduledTime: '08:00', status: 'planned', entityVersion: 1,
      }),
    ]))
    const occurrenceOnlyTimeline = await occurrenceStore.getPlanningTimeline(owner.id, '2099-01-02')
    expect(occurrenceOnlyTimeline.timelineItems).toEqual([
      expect.objectContaining({ sourceType: 'medicine-occurrence', originalTime: '08:00', status: 'planned' }),
      expect.objectContaining({ sourceType: 'medicine-occurrence', originalTime: '20:00', status: 'planned' }),
    ])
    expect(await occurrenceStore.getPlanningTimeline(other.id, '2099-01-02')).toEqual({ date: '2099-01-02', timelineItems: [] })
    expect(await occurrenceStore.listCalendar(owner.id, '2099-01-01', '2099-01-03', '2098-12-15')).toEqual([
      { date: '2099-01-01', state: 'planned', itemCount: 3, completedCount: 0 },
      { date: '2099-01-02', state: 'planned', itemCount: 2, completedCount: 0 },
      { date: '2099-01-03', state: 'planned', itemCount: 2, completedCount: 0 },
    ])

    const reconnected = withOccurrences(new MySqlLifeStore(pool, { now: () => now }))
    expect(await reconnected.getPlanningTimeline(owner.id, '2099-01-02')).toEqual(occurrenceOnlyTimeline)
    expect(await reconnected.createMedicineRecurrenceRule(owner.id, input, `occurrence-timeline-rule-${stamp}`)).toEqual(rule)
    const [occurrenceCountAfterReplay] = await rows<CountRow>(pool,
      'SELECT COUNT(*) count FROM life_medicine_recurrence_occurrences WHERE user_id=? AND rule_id=?', [owner.id, rule.id])
    expect(Number(occurrenceCountAfterReplay?.count)).toBe(6)
  })

  it('enforces the inclusive 366-day and 10,000-row medicine occurrence limits atomically', async () => {
    const stamp = `${Date.now()}`
    const boundedStore = withOccurrences(new MySqlLifeStore(pool, { now: () => '2098-12-01T00:00:00.000Z' }))
    const owner = await boundedStore.createUser({
      account: `occurrence-bounds-${stamp}@example.com`, displayName: 'Occurrence Bounds',
      passwordHash: await hashPassword('occurrence-bounds-password'),
    })
    const medicine = await boundedStore.createCatalogItem(owner.id, {
      kind: 'medicine', name: `Occurrence bounds medicine ${stamp}`, baseUnit: 'tablet', availableUnits: ['tablet'],
    }, `occurrence-bounds-medicine-${stamp}`)

    const inclusiveRule = await boundedStore.createMedicineRecurrenceRule(owner.id, {
      title: 'Exactly 366 inclusive days', sourceId: medicine.id, quantity: 1, unit: 'tablet',
      recurrence: { mode: 'interval', everyDays: 1, times: ['08:00'], startDate: '2099-01-01', endDate: '2100-01-01' },
    }, `occurrence-366-days-${stamp}`)
    const [inclusiveCount] = await rows<CountRow>(pool,
      'SELECT COUNT(*) count FROM life_medicine_recurrence_occurrences WHERE user_id=? AND rule_id=?', [owner.id, inclusiveRule.id])
    expect(Number(inclusiveCount?.count)).toBe(366)

    const oneHundredTimes = Array.from({ length: 100 }, (_, minute) => (
      `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
    ))
    const exactTenThousand = {
      title: 'Exactly ten thousand occurrences', sourceId: medicine.id, quantity: 1, unit: 'tablet',
      recurrence: { mode: 'interval' as const, everyDays: 1, times: oneHundredTimes, startDate: '2099-01-01', endDate: '2099-04-10' },
    }
    const tenThousandRule = await boundedStore.createMedicineRecurrenceRule(owner.id, exactTenThousand, `occurrence-10000-${stamp}`)
    expect(await boundedStore.createMedicineRecurrenceRule(owner.id, exactTenThousand, `occurrence-10000-${stamp}`)).toEqual(tenThousandRule)
    const [tenThousandCount] = await rows<CountRow>(pool,
      'SELECT COUNT(*) count FROM life_medicine_recurrence_occurrences WHERE user_id=? AND rule_id=?', [owner.id, tenThousandRule.id])
    expect(Number(tenThousandCount?.count)).toBe(10_000)

    await expect(boundedStore.createMedicineRecurrenceRule(owner.id, {
      title: 'Reject 367 inclusive days', sourceId: medicine.id, quantity: 1, unit: 'tablet',
      recurrence: { mode: 'interval', everyDays: 1, times: ['08:00'], startDate: '2099-01-01', endDate: '2100-01-02' },
    }, `occurrence-367-days-${stamp}`)).rejects.toMatchObject({ code: 'RECURRENCE_RANGE_TOO_LARGE', status: 400 })

    const seventyThreeTimes = oneHundredTimes.slice(0, 73)
    await expect(boundedStore.createMedicineRecurrenceRule(owner.id, {
      title: 'Reject ten thousand and one occurrences', sourceId: medicine.id, quantity: 1, unit: 'tablet',
      recurrence: { mode: 'interval', everyDays: 1, times: seventyThreeTimes, startDate: '2099-01-01', endDate: '2099-05-17' },
    }, `occurrence-10001-${stamp}`)).rejects.toMatchObject({ code: 'RECURRENCE_OCCURRENCE_LIMIT', status: 400 })

    const [failedRuleCount] = await rows<CountRow>(pool, `SELECT COUNT(*) count FROM life_medicine_recurrence_rules
      WHERE user_id=? AND title IN ('Reject 367 inclusive days','Reject ten thousand and one occurrences')`, [owner.id])
    expect(Number(failedRuleCount?.count)).toBe(0)
    const [failedIdempotencyCount] = await rows<CountRow>(pool, `SELECT COUNT(*) count FROM life_planning_idempotency
      WHERE user_id=? AND operation_key='planning:create-medicine-recurrence'
      AND idempotency_key IN (?,?)`, [owner.id, `occurrence-367-days-${stamp}`, `occurrence-10001-${stamp}`])
    expect(Number(failedIdempotencyCount?.count)).toBe(0)
  })

  it('preserves owner-versioned skip, delay and reconciliation history while completing and undoing occurrence inventory once', async () => {
    const stamp = `${Date.now()}`
    const now = '2026-08-14T12:00:00.000Z'
    const occurrenceStore = withOccurrences(new MySqlLifeStore(pool, { now: () => now }))
    const owner = await occurrenceStore.createUser({
      account: `occurrence-lifecycle-owner-${stamp}@example.com`, displayName: 'Occurrence Lifecycle Owner',
      passwordHash: await hashPassword('occurrence-lifecycle-owner-password'),
    })
    const other = await occurrenceStore.createUser({
      account: `occurrence-lifecycle-other-${stamp}@example.com`, displayName: 'Occurrence Lifecycle Other',
      passwordHash: await hashPassword('occurrence-lifecycle-other-password'),
    })
    const medicine = await occurrenceStore.createCatalogItem(owner.id, {
      kind: 'medicine', name: `Occurrence lifecycle medicine ${stamp}`, baseUnit: 'tablet', availableUnits: ['tablet'],
      pricePoints: [{ amountMinor: 3_000, currency: 'CNY', purchaseQuantity: 30, purchaseUnit: 'tablet', effectiveFrom: '2026-08-01' }],
    }, `occurrence-lifecycle-medicine-${stamp}`)
    await occurrenceStore.createInventoryTransaction(owner.id, {
      itemId: medicine.id, kind: 'purchase', quantity: 20, unit: 'tablet', occurredAt: '2026-08-14T06:00:00.000Z',
      batch: { actualUnitCostMinor: 73 },
    }, `occurrence-lifecycle-stock-${stamp}`)
    const ruleInput = {
      title: 'Occurrence lifecycle facts', sourceId: medicine.id, quantity: 1, unit: 'tablet',
      recurrence: { mode: 'interval' as const, everyDays: 1, times: ['08:00', '09:00'], startDate: '2026-08-12', endDate: '2026-08-18' },
    }
    const rule = await occurrenceStore.createMedicineRecurrenceRule(owner.id, ruleInput, `occurrence-lifecycle-rule-${stamp}`)
    const occurrenceAt = async (date: string, time: string, subject = occurrenceStore, userId = owner.id) => {
      const timeline = await subject.getPlanningTimeline(userId, date)
      const occurrence = timeline.timelineItems.find((entry): entry is MedicineRecurrenceOccurrence & { sourceType: 'medicine-occurrence' } => (
        entry.sourceType === 'medicine-occurrence' && entry.originalTime === time
      ))
      expect(occurrence, `expected ${date} ${time} occurrence`).toBeDefined()
      return occurrence!
    }
    const occurrenceHistory = async (id: string) => {
      const [occurrence] = await rows<RowDataPacket & {
        id: string; status: string; completionId: string | null; entityVersion: number
        originalDate: string; originalTime: string; scheduledDate: string; scheduledTime: string
      }>(pool, `SELECT id,status,completion_id completionId,entity_version entityVersion,
        original_date originalDate,DATE_FORMAT(original_time,'%H:%i') originalTime,
        scheduled_date scheduledDate,DATE_FORMAT(scheduled_time,'%H:%i') scheduledTime
        FROM life_medicine_recurrence_occurrences WHERE user_id=? AND id=?`, [owner.id, id])
      expect(occurrence, `expected persisted occurrence history ${id}`).toBeDefined()
      return occurrence!
    }
    const inventoryBalance = async () => (await occurrenceStore.listInventoryBalances(owner.id))
      .find((entry) => entry.itemId === medicine.id)?.onHand

    const past = await occurrenceAt('2026-08-12', '08:00')
    const skippedSource = await occurrenceAt('2026-08-15', '08:00')
    const skipInput: OccurrenceTransitionInput = {
      entityVersion: skippedSource.entityVersion, action: 'skip', at: '2026-08-14T12:05:00.000Z',
    }
    const skipped = await occurrenceStore.transitionMedicineOccurrence(owner.id, skippedSource.id, skipInput, `occurrence-skip-${stamp}`)
    expect(await occurrenceStore.transitionMedicineOccurrence(owner.id, skippedSource.id, skipInput, `occurrence-skip-${stamp}`)).toEqual(skipped)
    expect(skipped).toMatchObject({ id: skippedSource.id, originalDate: '2026-08-15', originalTime: '08:00', status: 'skipped', entityVersion: 2 })
    await expect(occurrenceStore.createPlanningCompletionFromSource(owner.id, {
      source: { type: 'medicine-occurrence', id: skippedSource.id, entityVersion: 2 },
      completedAt: '2026-08-15T08:05:00.000Z',
    }, `occurrence-complete-skipped-${stamp}`)).rejects.toMatchObject({
      code: 'OCCURRENCE_NOT_COMPLETABLE',
      status: 409,
      details: { current: expect.objectContaining({ id: skippedSource.id, entityVersion: 2, status: 'skipped' }) },
    })
    await expect(occurrenceStore.transitionMedicineOccurrence(owner.id, skippedSource.id, {
      ...skipInput, action: 'delay', scheduledDate: '2026-08-20', scheduledTime: '10:00',
    }, `occurrence-skip-${stamp}`)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 })
    await expect(occurrenceStore.transitionMedicineOccurrence(owner.id, skippedSource.id, skipInput, `occurrence-skip-stale-${stamp}`))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409, details: { current: expect.objectContaining({ id: skippedSource.id }) } })
    expect(await occurrenceStore.transitionMedicineOccurrence(other.id, skippedSource.id, skipInput, `occurrence-skip-foreign-${stamp}`)).toBeUndefined()

    const delayedSource = await occurrenceAt('2026-08-16', '08:00')
    const delayed = await occurrenceStore.transitionMedicineOccurrence(owner.id, delayedSource.id, {
      entityVersion: delayedSource.entityVersion, action: 'delay', at: '2026-08-14T12:10:00.000Z',
      scheduledDate: '2026-08-20', scheduledTime: '10:00',
    }, `occurrence-delay-${stamp}`)
    expect(delayed).toMatchObject({
      id: delayedSource.id, originalDate: '2026-08-16', originalTime: '08:00',
      scheduledDate: '2026-08-20', scheduledTime: '10:00', status: 'planned', entityVersion: 2,
    })
    expect(await occurrenceStore.getPlanningTimeline(other.id, '2026-08-20')).toEqual({ date: '2026-08-20', timelineItems: [] })

    const completedSource = await occurrenceAt('2026-08-17', '08:00')
    const completionInput: PlanningCompletionInput = {
      source: { type: 'medicine-occurrence', id: completedSource.id, entityVersion: completedSource.entityVersion },
      completedAt: '2026-08-17T08:05:00.000Z',
    }
    const completion = await occurrenceStore.createPlanningCompletionFromSource(owner.id, completionInput, `occurrence-complete-${stamp}`)
    expect(await occurrenceStore.createPlanningCompletionFromSource(owner.id, completionInput, `occurrence-complete-${stamp}`)).toEqual(completion)
    expect(completion).toMatchObject({
      dayPlanId: null, dayPlanItemId: null, kind: 'medicine', source: { type: 'catalog-item', id: medicine.id },
      quantity: 1, unit: 'tablet', costMinor: 73,
      completionSource: {
        type: 'medicine-occurrence', id: completedSource.id, ruleId: rule.id,
        originalDate: '2026-08-17', originalTime: '08:00',
        scheduledDate: '2026-08-17', scheduledTime: '08:00',
      },
    })
    expect(completion.inventoryTransactionIds).toHaveLength(1)
    expect(await inventoryBalance()).toBe(19)
    await expect(occurrenceStore.createPlanningCompletionFromSource(other.id, completionInput, `occurrence-complete-foreign-${stamp}`))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    await expect(occurrenceStore.createPlanningCompletionFromSource(owner.id, completionInput, `occurrence-complete-stale-${stamp}`))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409, details: { current: expect.objectContaining({ id: completedSource.id }) } })

    const [snapshotRow] = await rows<RowDataPacket & {
      dayPlanId: string | null; dayPlanItemId: string | null; occurrenceId: string | null
      completionSourceJson: unknown; sourceJson: unknown; costMinor: string | number | null
    }>(pool, `SELECT day_plan_id dayPlanId,day_plan_item_id dayPlanItemId,medicine_occurrence_id occurrenceId,
      completion_source_json completionSourceJson,source_json sourceJson,cost_minor costMinor
      FROM life_completion_snapshots WHERE user_id=? AND id=?`, [owner.id, completion.id])
    expect(snapshotRow).toMatchObject({
      dayPlanId: null, dayPlanItemId: null, occurrenceId: completedSource.id,
      completionSourceJson: {
        type: 'medicine-occurrence', id: completedSource.id, ruleId: rule.id,
        originalDate: '2026-08-17', originalTime: '08:00',
        scheduledDate: '2026-08-17', scheduledTime: '08:00',
      },
      sourceJson: { type: 'catalog-item', id: medicine.id },
    })
    expect(Number(snapshotRow?.costMinor)).toBe(73)
    const [completionLinkCount] = await rows<CountRow>(pool,
      'SELECT COUNT(*) count FROM life_completion_inventory_events WHERE user_id=? AND completion_id=?', [owner.id, completion.id])
    expect(Number(completionLinkCount?.count)).toBe(1)
    await expect(pool.execute('UPDATE life_completion_snapshots SET cost_minor=0 WHERE user_id=? AND id=?', [owner.id, completion.id]))
      .rejects.toMatchObject({ code: 'ER_SIGNAL_EXCEPTION' })
    await expect(pool.execute('DELETE FROM life_completion_snapshots WHERE user_id=? AND id=?', [owner.id, completion.id]))
      .rejects.toMatchObject({ code: 'ER_SIGNAL_EXCEPTION' })

    const stillIncluded = await occurrenceAt('2026-08-17', '09:00')
    const includedCompletion = await occurrenceStore.createPlanningCompletionFromSource(owner.id, {
      source: { type: 'medicine-occurrence', id: stillIncluded.id, entityVersion: stillIncluded.entityVersion },
      completedAt: '2026-08-17T09:05:00.000Z',
    }, `occurrence-complete-included-${stamp}`)
    const plannedUndo = await occurrenceStore.undoPlanningCompletion(owner.id, includedCompletion.id, `occurrence-undo-included-${stamp}`)
    expect(await occurrenceStore.undoPlanningCompletion(owner.id, includedCompletion.id, `occurrence-undo-included-${stamp}`)).toEqual(plannedUndo)
    expect(plannedUndo).toMatchObject({ status: 'planned' })
    expect((await occurrenceAt('2026-08-17', '09:00')).status).toBe('planned')
    expect(await inventoryBalance()).toBe(19)

    const futureBefore = await occurrenceAt('2026-08-18', '08:00')
    const updatedRule = await occurrenceStore.updateMedicineRecurrenceRule(owner.id, rule.id, {
      ...ruleInput, entityVersion: rule.entityVersion,
      recurrence: { mode: 'interval', everyDays: 1, times: ['09:00'], startDate: '2026-08-18', endDate: '2026-08-18' },
    })
    expect(updatedRule).toMatchObject({ entityVersion: 2 })
    expect(await occurrenceAt('2026-08-12', '08:00')).toEqual(past)
    expect(await occurrenceAt('2026-08-15', '08:00')).toMatchObject(skipped!)
    expect(await occurrenceAt('2026-08-17', '08:00')).toMatchObject({ id: completedSource.id, status: 'completed', completionId: completion.id })
    expect(await occurrenceHistory(futureBefore.id)).toMatchObject({ id: futureBefore.id, status: 'cancelled' })
    expect(await occurrenceAt('2026-08-18', '09:00')).toMatchObject({ status: 'planned', entityVersion: 1 })
    expect(await occurrenceHistory(delayedSource.id)).toMatchObject({
      id: delayedSource.id, originalDate: '2026-08-16', scheduledDate: '2026-08-20', scheduledTime: '10:00', status: 'cancelled',
    })
    expect((await occurrenceStore.getPlanningTimeline(owner.id, '2026-08-20')).timelineItems)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: delayedSource.id })]))

    const cancelledUndo = await occurrenceStore.undoPlanningCompletion(owner.id, completion.id, `occurrence-undo-removed-${stamp}`)
    expect(cancelledUndo).toMatchObject({ status: 'cancelled' })
    expect(await occurrenceHistory(completedSource.id)).toMatchObject({ status: 'cancelled', completionId: null })
    expect((await occurrenceStore.getPlanningTimeline(owner.id, '2026-08-17')).timelineItems)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: completedSource.id })]))
    expect(await inventoryBalance()).toBe(20)
    await expect(occurrenceStore.undoPlanningCompletion(owner.id, completion.id, `occurrence-undo-removed-again-${stamp}`))
      .rejects.toMatchObject({ code: 'COMPLETION_ALREADY_UNDONE', status: 409 })

    const plannedBeforeDelete = await occurrenceAt('2026-08-18', '09:00')
    expect(await occurrenceStore.deleteMedicineRecurrenceRule(owner.id, rule.id, updatedRule!.entityVersion)).toBe(true)
    expect(await occurrenceHistory(plannedBeforeDelete.id)).toMatchObject({ status: 'cancelled' })
    expect((await occurrenceStore.getPlanningTimeline(owner.id, '2026-08-18')).timelineItems)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: plannedBeforeDelete.id })]))
    expect(await occurrenceStore.getPlanningTimeline(other.id, '2026-08-18')).toEqual({ date: '2026-08-18', timelineItems: [] })
  })

  it('rejects mismatched completion identities and immutable occurrence or reversal mutations at the database boundary', async () => {
    const stamp = `${Date.now()}`
    const now = '2098-12-15T12:00:00.000Z'
    const subject = withOccurrences(new MySqlLifeStore(pool, { now: () => now }))
    const owner = await subject.createUser({
      account: `occurrence-db-hardening-${stamp}@example.com`, displayName: 'Occurrence DB Hardening',
      passwordHash: await hashPassword('occurrence-db-hardening-password'),
    })
    const medicine = await subject.createCatalogItem(owner.id, {
      kind: 'medicine', name: `Occurrence DB hardening medicine ${stamp}`, baseUnit: 'tablet', availableUnits: ['tablet'],
    }, `occurrence-db-hardening-medicine-${stamp}`)
    const alternateMedicine = await subject.createCatalogItem(owner.id, {
      kind: 'medicine', name: `Alternate occurrence DB hardening medicine ${stamp}`, baseUnit: 'tablet', availableUnits: ['tablet'],
    }, `occurrence-db-hardening-alternate-medicine-${stamp}`)
    await subject.createInventoryTransaction(owner.id, {
      itemId: medicine.id, kind: 'purchase', quantity: 10, unit: 'tablet', occurredAt: '2098-12-15T06:00:00.000Z',
      batch: { actualUnitCostMinor: 73 },
    }, `occurrence-db-hardening-stock-${stamp}`)
    const rule = await subject.createMedicineRecurrenceRule(owner.id, {
      title: 'Occurrence DB hardening facts', sourceId: medicine.id, quantity: 1, unit: 'tablet',
      recurrence: { mode: 'interval', everyDays: 1, times: ['08:00', '09:00', '10:00'], startDate: '2099-01-01', endDate: '2099-01-01' },
    }, `occurrence-db-hardening-rule-${stamp}`)
    const occurrences = (await subject.getPlanningTimeline(owner.id, '2099-01-01')).timelineItems
      .filter((entry): entry is MedicineRecurrenceOccurrence & { sourceType: 'medicine-occurrence' } => entry.sourceType === 'medicine-occurrence')
    expect(occurrences).toHaveLength(3)
    const [first, second, undone] = occurrences
    const completion = await subject.createPlanningCompletionFromSource(owner.id, {
      source: { type: 'medicine-occurrence', id: second!.id, entityVersion: second!.entityVersion },
      completedAt: '2099-01-01T09:05:00.000Z',
    }, `occurrence-db-hardening-completion-${stamp}`)
    const undoneCompletion = await subject.createPlanningCompletionFromSource(owner.id, {
      source: { type: 'medicine-occurrence', id: undone!.id, entityVersion: undone!.entityVersion },
      completedAt: '2099-01-01T10:05:00.000Z',
    }, `occurrence-db-hardening-undone-completion-${stamp}`)
    await subject.undoPlanningCompletion(owner.id, undoneCompletion.id, `occurrence-db-hardening-undo-${stamp}`)
    const day = await subject.createDayPlan(owner.id, {
      date: '2099-01-02', mealSlots: [], items: [{
        kind: 'custom', title: 'Canonical day item', mealSlotId: null, scheduledTime: '08:00', source: null,
        quantity: null, unit: null, servings: null, durationMinutes: null,
      }],
    }, `occurrence-db-hardening-day-${stamp}`)
    const [reversal] = await rows<RowDataPacket & { id: string }>(pool,
      'SELECT id FROM life_completion_reversals WHERE user_id=? AND completion_id=?', [owner.id, undoneCompletion.id])
    expect(reversal).toBeDefined()

    const connection = await pool.getConnection()
    await connection.beginTransaction()
    let savepoint = 0
    const expectRejectedMutation = async (sql: string, values: unknown[], code: string) => {
      const name = `hardening_${savepoint += 1}`
      await connection.query(`SAVEPOINT ${name}`)
      await expect.soft(connection.execute(sql, values as never[])).rejects.toMatchObject({ code })
      await connection.query(`ROLLBACK TO SAVEPOINT ${name}`)
    }
    try {
      await expectRejectedMutation('UPDATE life_medicine_recurrence_occurrences SET id=? WHERE user_id=? AND id=?', [randomUUID(), owner.id, first!.id], 'ER_SIGNAL_EXCEPTION')
      await expectRejectedMutation('UPDATE life_medicine_recurrence_occurrences SET user_id=? WHERE user_id=? AND id=?', [randomUUID(), owner.id, first!.id], 'ER_SIGNAL_EXCEPTION')
      await expectRejectedMutation('UPDATE life_medicine_recurrence_occurrences SET rule_id=? WHERE user_id=? AND id=?', [randomUUID(), owner.id, first!.id], 'ER_SIGNAL_EXCEPTION')
      await expectRejectedMutation("UPDATE life_medicine_recurrence_occurrences SET original_date='2099-01-03' WHERE user_id=? AND id=?", [owner.id, first!.id], 'ER_SIGNAL_EXCEPTION')
      await expectRejectedMutation("UPDATE life_medicine_recurrence_occurrences SET original_time='10:00' WHERE user_id=? AND id=?", [owner.id, first!.id], 'ER_SIGNAL_EXCEPTION')
      await expectRejectedMutation("UPDATE life_medicine_recurrence_occurrences SET created_at='2098-12-16 00:00:00.000' WHERE user_id=? AND id=?", [owner.id, first!.id], 'ER_SIGNAL_EXCEPTION')
      await expectRejectedMutation('UPDATE life_medicine_recurrence_occurrences SET status=status WHERE user_id=? AND id=?', [owner.id, first!.id], 'ER_SIGNAL_EXCEPTION')
      await expectRejectedMutation("UPDATE life_medicine_recurrence_occurrences SET scheduled_date='2099-01-03',entity_version=entity_version+1,updated_at='2098-12-14 00:00:00.000' WHERE user_id=? AND id=?", [owner.id, first!.id], 'ER_SIGNAL_EXCEPTION')
      await expectRejectedMutation('DELETE FROM life_medicine_recurrence_occurrences WHERE user_id=? AND id=?', [owner.id, first!.id], 'ER_SIGNAL_EXCEPTION')

      await expectRejectedMutation('UPDATE life_medicine_recurrence_rules SET id=? WHERE user_id=? AND id=?', [randomUUID(), owner.id, rule.id], 'ER_SIGNAL_EXCEPTION')
      await expectRejectedMutation('UPDATE life_medicine_recurrence_rules SET user_id=? WHERE user_id=? AND id=?', [randomUUID(), owner.id, rule.id], 'ER_SIGNAL_EXCEPTION')
      await expectRejectedMutation("UPDATE life_medicine_recurrence_rules SET created_at='2098-12-16 00:00:00.000' WHERE user_id=? AND id=?", [owner.id, rule.id], 'ER_SIGNAL_EXCEPTION')
      await expectRejectedMutation('UPDATE life_medicine_recurrence_rules SET title=title WHERE user_id=? AND id=?', [owner.id, rule.id], 'ER_SIGNAL_EXCEPTION')
      await expectRejectedMutation("UPDATE life_medicine_recurrence_rules SET title='backdated',entity_version=entity_version+1,updated_at='2098-12-14 00:00:00.000' WHERE user_id=? AND id=?", [owner.id, rule.id], 'ER_SIGNAL_EXCEPTION')
      await expectRejectedMutation('DELETE FROM life_medicine_recurrence_rules WHERE user_id=? AND id=?', [owner.id, rule.id], 'ER_SIGNAL_EXCEPTION')

      await expectRejectedMutation(`INSERT INTO life_completion_snapshots
        (id,user_id,day_plan_id,day_plan_item_id,medicine_occurrence_id,completion_source_json,item_kind,completed_at,energy_is_estimate,created_at)
        VALUES (?,?,?,?,NULL,?,'custom',?,FALSE,?)`, [
        randomUUID(), owner.id, day.id, day.items[0]!.id,
        JSON.stringify({ type: 'day-plan-item', dayPlanId: randomUUID(), dayPlanItemId: randomUUID() }),
        '2099-01-02 08:05:00.000', '2098-12-15 12:00:00.000',
      ], 'ER_CHECK_CONSTRAINT_VIOLATED')
      await expectRejectedMutation(`INSERT INTO life_completion_snapshots
        (id,user_id,day_plan_id,day_plan_item_id,medicine_occurrence_id,completion_source_json,item_kind,completed_at,energy_is_estimate,created_at)
        VALUES (?,?,NULL,NULL,?,?, 'medicine',?,FALSE,?)`, [
        randomUUID(), owner.id, first!.id,
        JSON.stringify({
          type: 'medicine-occurrence', id: second!.id, ruleId: second!.ruleId,
          originalDate: second!.originalDate, originalTime: second!.originalTime,
          scheduledDate: second!.scheduledDate, scheduledTime: second!.scheduledTime,
        }),
        '2099-01-01 08:05:00.000', '2098-12-15 12:00:00.000',
      ], 'ER_SIGNAL_EXCEPTION')
      for (const invalidSource of [
        {
          type: 'medicine-occurrence', id: first!.id, ruleId: randomUUID(),
          originalDate: first!.originalDate, originalTime: first!.originalTime,
          scheduledDate: first!.scheduledDate, scheduledTime: first!.scheduledTime,
        },
        {
          type: 'medicine-occurrence', id: first!.id, ruleId: first!.ruleId,
          originalDate: '2099-01-03', originalTime: first!.originalTime,
          scheduledDate: first!.scheduledDate, scheduledTime: first!.scheduledTime,
        },
        {
          type: 'medicine-occurrence', id: first!.id, ruleId: first!.ruleId,
          originalDate: first!.originalDate, originalTime: first!.originalTime,
          scheduledDate: first!.scheduledDate,
        },
      ]) {
        await expectRejectedMutation(`INSERT INTO life_completion_snapshots
          (id,user_id,day_plan_id,day_plan_item_id,medicine_occurrence_id,completion_source_json,item_kind,completed_at,energy_is_estimate,created_at)
          VALUES (?,?,NULL,NULL,?,?, 'medicine',?,FALSE,?)`, [
          randomUUID(), owner.id, first!.id, JSON.stringify(invalidSource),
          '2099-01-01 08:05:00.000', '2098-12-15 12:00:00.000',
        ], 'ER_SIGNAL_EXCEPTION')
      }
      const canonicalOccurrenceSource = JSON.stringify({
        type: 'medicine-occurrence', id: first!.id, ruleId: first!.ruleId,
        originalDate: first!.originalDate, originalTime: first!.originalTime,
        scheduledDate: first!.scheduledDate, scheduledTime: first!.scheduledTime,
      })
      for (const invalidActual of [
        { itemKind: 'custom', source: { type: 'catalog-item', id: medicine.id }, quantity: 1, unit: 'tablet', servings: null },
        { itemKind: 'medicine', source: { type: 'catalog-item', id: alternateMedicine.id }, quantity: 1, unit: 'tablet', servings: null },
        { itemKind: 'medicine', source: { type: 'catalog-item', id: medicine.id }, quantity: 2, unit: 'tablet', servings: null },
        { itemKind: 'medicine', source: { type: 'catalog-item', id: medicine.id }, quantity: 1, unit: 'capsule', servings: null },
        { itemKind: 'medicine', source: { type: 'catalog-item', id: medicine.id }, quantity: 1, unit: 'tablet', servings: 1 },
      ]) {
        await expectRejectedMutation(`INSERT INTO life_completion_snapshots
          (id,user_id,day_plan_id,day_plan_item_id,medicine_occurrence_id,completion_source_json,item_kind,source_json,
           actual_quantity,actual_unit,actual_servings,completed_at,energy_is_estimate,created_at)
          VALUES (?,?,NULL,NULL,?,?,?,?,?,?,?,?,FALSE,?)`, [
          randomUUID(), owner.id, first!.id, canonicalOccurrenceSource, invalidActual.itemKind,
          JSON.stringify(invalidActual.source), invalidActual.quantity, invalidActual.unit, invalidActual.servings,
          '2099-01-01 08:05:00.000', '2098-12-15 12:00:00.000',
        ], 'ER_SIGNAL_EXCEPTION')
      }
      await expectRejectedMutation(`UPDATE life_medicine_recurrence_occurrences
        SET status='completed',completion_id=?,entity_version=entity_version+1 WHERE user_id=? AND id=?`,
      [completion.id, owner.id, first!.id], 'ER_NO_REFERENCED_ROW_2')

      for (const [assignment, values] of [
        ["status='planned',completion_id=NULL", []],
        ["status='cancelled',completion_id=NULL", []],
        ["title='forged terminal title'", []],
        ['source_item_id=?', [alternateMedicine.id]],
        ['quantity=2', []],
        ["unit='capsule'", []],
        ["scheduled_date='2099-01-03'", []],
        ["scheduled_time='11:00:00'", []],
      ] as const) {
        await expectRejectedMutation(`UPDATE life_medicine_recurrence_occurrences
          SET ${assignment},entity_version=entity_version+1,updated_at='2098-12-15 12:00:01.000'
          WHERE user_id=? AND id=?`, [...values, owner.id, second!.id], 'ER_SIGNAL_EXCEPTION')
      }
      await connection.execute(`UPDATE life_medicine_recurrence_occurrences
        SET status='skipped',entity_version=entity_version+1,updated_at='2098-12-15 12:00:01.000'
        WHERE user_id=? AND id=?`, [owner.id, first!.id])
      await expectRejectedMutation(`UPDATE life_medicine_recurrence_occurrences
        SET status='planned',entity_version=entity_version+1,updated_at='2098-12-15 12:00:02.000'
        WHERE user_id=? AND id=?`, [owner.id, first!.id], 'ER_SIGNAL_EXCEPTION')
      await expectRejectedMutation(`UPDATE life_medicine_recurrence_occurrences
        SET title='forged skipped title',entity_version=entity_version+1,updated_at='2098-12-15 12:00:02.000'
        WHERE user_id=? AND id=?`, [owner.id, first!.id], 'ER_SIGNAL_EXCEPTION')

      await expectRejectedMutation(`UPDATE life_completion_reversals
        SET reversed_inventory_transaction_ids=JSON_ARRAY() WHERE user_id=? AND id=?`, [owner.id, reversal!.id], 'ER_SIGNAL_EXCEPTION')
      await expectRejectedMutation('DELETE FROM life_completion_reversals WHERE user_id=? AND id=?', [owner.id, reversal!.id], 'ER_SIGNAL_EXCEPTION')
    } finally {
      await connection.rollback()
      connection.release()
    }
  })

  it('rolls back the rule and every occurrence when future reconciliation fails after an earlier row update', async () => {
    const stamp = `${Date.now()}`
    const now = '2098-12-15T12:00:00.000Z'
    const subject = withOccurrences(new MySqlLifeStore(pool, { now: () => now }))
    const owner = await subject.createUser({
      account: `occurrence-reconcile-rollback-${stamp}@example.com`, displayName: 'Occurrence Reconcile Rollback',
      passwordHash: await hashPassword('occurrence-reconcile-rollback-password'),
    })
    const medicine = await subject.createCatalogItem(owner.id, {
      kind: 'medicine', name: `Occurrence reconcile rollback medicine ${stamp}`, baseUnit: 'tablet', availableUnits: ['tablet'],
    }, `occurrence-reconcile-rollback-medicine-${stamp}`)
    const ruleInput = {
      title: 'Original reconcile facts', sourceId: medicine.id, quantity: 1, unit: 'tablet',
      recurrence: { mode: 'interval' as const, everyDays: 1, times: ['08:00', '09:00', '10:00'], startDate: '2099-01-01', endDate: '2099-01-01' },
    }
    const rule = await subject.createMedicineRecurrenceRule(owner.id, ruleInput, `occurrence-reconcile-rollback-rule-${stamp}`)
    const beforeTimeline = await subject.getPlanningTimeline(owner.id, '2099-01-01')
    const [beforeRule] = await rows<RowDataPacket & {
      title: string; quantity: string | number; recurrenceJson: unknown; entityVersion: number; updatedAt: string
    }>(pool, `SELECT title,quantity,recurrence_json recurrenceJson,entity_version entityVersion,updated_at updatedAt
      FROM life_medicine_recurrence_rules WHERE user_id=? AND id=?`, [owner.id, rule.id])
    const beforeOccurrences = await rows<RowDataPacket & {
      id: string; title: string; quantity: string | number; status: string; entityVersion: number; updatedAt: string
    }>(pool, `SELECT id,title,quantity,status,entity_version entityVersion,updated_at updatedAt
      FROM life_medicine_recurrence_occurrences WHERE user_id=? AND rule_id=? ORDER BY original_date,original_time,id`, [owner.id, rule.id])

    await pool.query('DROP TRIGGER IF EXISTS trg_test_occurrence_reconcile_fail')
    await pool.query(`CREATE TRIGGER trg_test_occurrence_reconcile_fail BEFORE UPDATE ON life_medicine_recurrence_occurrences
      FOR EACH ROW FOLLOWS trg_life_medicine_occurrence_identity_no_update
      BEGIN
        IF OLD.original_time = '09:00:00' THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='TEST_OCCURRENCE_RECONCILE_ROLLBACK';
        END IF;
      END`)
    try {
      await expect(subject.updateMedicineRecurrenceRule(owner.id, rule.id, {
        ...ruleInput, title: 'Partially applied reconcile facts', quantity: 2, entityVersion: rule.entityVersion,
      })).rejects.toMatchObject({ code: 'ER_SIGNAL_EXCEPTION' })
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS trg_test_occurrence_reconcile_fail')
    }

    const [afterRule] = await rows<typeof beforeRule>(pool, `SELECT title,quantity,recurrence_json recurrenceJson,
      entity_version entityVersion,updated_at updatedAt FROM life_medicine_recurrence_rules WHERE user_id=? AND id=?`, [owner.id, rule.id])
    const afterOccurrences = await rows<(typeof beforeOccurrences)[number]>(pool, `SELECT id,title,quantity,status,
      entity_version entityVersion,updated_at updatedAt FROM life_medicine_recurrence_occurrences
      WHERE user_id=? AND rule_id=? ORDER BY original_date,original_time,id`, [owner.id, rule.id])
    expect(afterRule).toEqual(beforeRule)
    expect(afterOccurrences).toEqual(beforeOccurrences)
    expect(await subject.getPlanningTimeline(owner.id, '2099-01-01')).toEqual(beforeTimeline)
  })

  it('returns the same public occurrence transition shape and idempotency semantics as Memory', async () => {
    const stamp = `${Date.now()}`
    const now = '2098-12-15T12:00:00.000Z'
    const mysqlSubject = withOccurrences(new MySqlLifeStore(pool, { now: () => now }))
    const memorySubject = withOccurrences(new MemoryLifeStore({ now: () => now }))
    const exercise = async (subject: OccurrenceCapableStore, prefix: string, account: string) => {
      const owner = await subject.createUser({ account, displayName: 'Occurrence Shape Parity', passwordHash: 'shape-parity-password' })
      const medicine = await subject.createCatalogItem(owner.id, {
        kind: 'medicine', name: 'Occurrence shape parity medicine', baseUnit: 'tablet', availableUnits: ['tablet'],
      }, `${prefix}-medicine`)
      await subject.createMedicineRecurrenceRule(owner.id, {
        title: 'Occurrence shape parity facts', sourceId: medicine.id, quantity: 1, unit: 'tablet',
        recurrence: { mode: 'interval', everyDays: 1, times: ['08:00'], startDate: '2099-01-01', endDate: '2099-01-01' },
      }, `${prefix}-rule`)
      const occurrence = (await subject.getPlanningTimeline(owner.id, '2099-01-01')).timelineItems
        .find((entry): entry is MedicineRecurrenceOccurrence & { sourceType: 'medicine-occurrence' } => entry.sourceType === 'medicine-occurrence')!
      const transitionInput: OccurrenceTransitionInput = { entityVersion: occurrence.entityVersion, action: 'skip', at: '2098-12-14T08:05:00.000Z' }
      const transitioned = await subject.transitionMedicineOccurrence(owner.id, occurrence.id, transitionInput, `${prefix}-skip`)
      const replay = await subject.transitionMedicineOccurrence(owner.id, occurrence.id, transitionInput, `${prefix}-skip`)
      let staleError: unknown
      try {
        await subject.transitionMedicineOccurrence(owner.id, occurrence.id, transitionInput, `${prefix}-skip-stale`)
      } catch (error) {
        staleError = error
      }
      return { owner, occurrence, transitioned, replay, staleError }
    }

    const mysqlResult = await exercise(mysqlSubject, `mysql-occurrence-shape-${stamp}`, `mysql-occurrence-shape-${stamp}@example.com`)
    const memoryResult = await exercise(memorySubject, 'memory-occurrence-shape', 'memory-occurrence-shape@example.com')
    expect(mysqlResult.replay).toEqual(mysqlResult.transitioned)
    expect(memoryResult.replay).toEqual(memoryResult.transitioned)
    expect(mysqlResult.staleError).toMatchObject({ code: 'VERSION_CONFLICT', status: 409 })
    expect(memoryResult.staleError).toMatchObject({ code: 'VERSION_CONFLICT', status: 409 })
    expect(mysqlResult.transitioned).toMatchObject({ updatedAt: now })
    expect(memoryResult.transitioned).toMatchObject({ updatedAt: now })
    expect(Object.keys(mysqlResult.transitioned ?? {}).sort()).toEqual(Object.keys(memoryResult.transitioned ?? {}).sort())
    expect((await mysqlSubject.getPlanningTimeline(mysqlResult.owner.id, '2099-01-01')).timelineItems)
      .toEqual([expect.objectContaining({ sourceType: 'medicine-occurrence', status: 'skipped', entityVersion: 2 })])
    const reconnected = withOccurrences(new MySqlLifeStore(pool, { now: () => now }))
    expect(await reconnected.getPlanningTimeline(mysqlResult.owner.id, '2099-01-01'))
      .toEqual(await mysqlSubject.getPlanningTimeline(mysqlResult.owner.id, '2099-01-01'))
  })

  it('keeps the compact skip-delay-reconcile-delete-complete-undo lifecycle in Memory/MySQL parity', async () => {
    const stamp = `${Date.now()}`
    const now = '2098-12-15T12:00:00.000Z'
    const mysqlSubject = withOccurrences(new MySqlLifeStore(pool, { now: () => now }))
    const memorySubject = withOccurrences(new MemoryLifeStore({ now: () => now }))
    const errorShape = (error: unknown) => {
      const value = error as { code?: string; status?: number }
      return { code: value.code, status: value.status }
    }
    const exercise = async (subject: OccurrenceCapableStore, prefix: string, account: string) => {
      const owner = await subject.createUser({ account, displayName: 'Occurrence Lifecycle Parity', passwordHash: 'lifecycle-parity-password' })
      const medicine = await subject.createCatalogItem(owner.id, {
        kind: 'medicine', name: 'Occurrence lifecycle parity medicine', baseUnit: 'tablet', availableUnits: ['tablet'],
      }, `${prefix}-medicine`)
      await subject.createInventoryTransaction(owner.id, {
        itemId: medicine.id, kind: 'purchase', quantity: 10, unit: 'tablet', occurredAt: '2098-12-15T06:00:00.000Z',
        batch: { actualUnitCostMinor: 73 },
      }, `${prefix}-stock`)
      const ruleInput = {
        title: 'Occurrence lifecycle parity facts', sourceId: medicine.id, quantity: 1, unit: 'tablet',
        recurrence: { mode: 'interval' as const, everyDays: 1, times: ['08:00', '09:00'], startDate: '2099-01-01', endDate: '2099-01-03' },
      }
      const rule = await subject.createMedicineRecurrenceRule(owner.id, ruleInput, `${prefix}-rule`)
      const occurrenceAt = async (date: string, time: string) => (await subject.getPlanningTimeline(owner.id, date)).timelineItems
        .find((entry): entry is MedicineRecurrenceOccurrence & { sourceType: 'medicine-occurrence' } => (
          entry.sourceType === 'medicine-occurrence' && entry.originalTime === time
        ))!

      const skippedSource = await occurrenceAt('2099-01-01', '08:00')
      const skipInput: OccurrenceTransitionInput = { entityVersion: skippedSource.entityVersion, action: 'skip', at: '2098-12-15T12:05:00.000Z' }
      const skipped = await subject.transitionMedicineOccurrence(owner.id, skippedSource.id, skipInput, `${prefix}-skip`)
      const skipReplay = await subject.transitionMedicineOccurrence(owner.id, skippedSource.id, skipInput, `${prefix}-skip`)
      let skipConflict: unknown
      let staleTransition: unknown
      try {
        await subject.transitionMedicineOccurrence(owner.id, skippedSource.id, {
          ...skipInput, action: 'delay', scheduledDate: '2099-01-04', scheduledTime: '10:00',
        }, `${prefix}-skip`)
      } catch (error) { skipConflict = error }
      try {
        await subject.transitionMedicineOccurrence(owner.id, skippedSource.id, skipInput, `${prefix}-skip-stale`)
      } catch (error) { staleTransition = error }

      const delayedSource = await occurrenceAt('2099-01-02', '08:00')
      const delayed = await subject.transitionMedicineOccurrence(owner.id, delayedSource.id, {
        entityVersion: delayedSource.entityVersion, action: 'delay', at: '2098-12-15T12:10:00.000Z',
        scheduledDate: '2099-01-04', scheduledTime: '10:00',
      }, `${prefix}-delay`)

      const includedSource = await occurrenceAt('2099-01-02', '09:00')
      const includedInput: PlanningCompletionInput = {
        source: { type: 'medicine-occurrence', id: includedSource.id, entityVersion: includedSource.entityVersion },
        completedAt: '2099-01-02T09:05:00.000Z',
      }
      const includedCompletion = await subject.createPlanningCompletionFromSource(owner.id, includedInput, `${prefix}-complete-included`)
      const includedReplay = await subject.createPlanningCompletionFromSource(owner.id, includedInput, `${prefix}-complete-included`)
      const plannedUndo = await subject.undoPlanningCompletion(owner.id, includedCompletion.id, `${prefix}-undo-included`)

      const removedSource = await occurrenceAt('2099-01-03', '08:00')
      const removedCompletion = await subject.createPlanningCompletionFromSource(owner.id, {
        source: { type: 'medicine-occurrence', id: removedSource.id, entityVersion: removedSource.entityVersion },
        completedAt: '2099-01-03T08:05:00.000Z',
      }, `${prefix}-complete-removed`)
      const updated = await subject.updateMedicineRecurrenceRule(owner.id, rule.id, {
        ...ruleInput, entityVersion: rule.entityVersion,
        recurrence: { mode: 'interval', everyDays: 1, times: ['09:00'], startDate: '2099-01-03', endDate: '2099-01-03' },
      })
      const targetAfterReconcile = await occurrenceAt('2099-01-03', '09:00')
      const cancelledUndo = await subject.undoPlanningCompletion(owner.id, removedCompletion.id, `${prefix}-undo-removed`)
      let staleDelete: unknown
      try { await subject.deleteMedicineRecurrenceRule(owner.id, rule.id, rule.entityVersion) } catch (error) { staleDelete = error }
      const deleted = await subject.deleteMedicineRecurrenceRule(owner.id, rule.id, updated!.entityVersion)
      const timelinesAfterDelete = await Promise.all(['2099-01-01', '2099-01-02', '2099-01-03', '2099-01-04']
        .map((date) => subject.getPlanningTimeline(owner.id, date)))
      return {
        ownerId: owner.id,
        semantics: {
          skipped: { status: skipped?.status, version: skipped?.entityVersion },
          skipReplay: skipReplay?.entityVersion,
          skipConflict: errorShape(skipConflict), staleTransition: errorShape(staleTransition),
          delayed: { status: delayed?.status, version: delayed?.entityVersion, scheduledDate: delayed?.scheduledDate, scheduledTime: delayed?.scheduledTime },
          completionReplay: includedReplay.id === includedCompletion.id,
          plannedUndo: plannedUndo?.status, cancelledUndo: cancelledUndo?.status,
          updatedRuleVersion: updated?.entityVersion, targetVersion: targetAfterReconcile.entityVersion,
          staleDelete: errorShape(staleDelete), deleted,
          visibleAfterDelete: timelinesAfterDelete.map((timeline) => timeline.timelineItems.map((entry) => ({
            sourceType: entry.sourceType, status: entry.status,
          }))),
        },
      }
    }

    const mysqlResult = await exercise(mysqlSubject, `mysql-occurrence-lifecycle-${stamp}`, `mysql-occurrence-lifecycle-${stamp}@example.com`)
    const memoryResult = await exercise(memorySubject, 'memory-occurrence-lifecycle', 'memory-occurrence-lifecycle@example.com')
    expect(mysqlResult.semantics).toEqual(memoryResult.semantics)
    expect(mysqlResult.semantics).toEqual({
      skipped: { status: 'skipped', version: 2 }, skipReplay: 2,
      skipConflict: { code: 'IDEMPOTENCY_CONFLICT', status: 409 }, staleTransition: { code: 'VERSION_CONFLICT', status: 409 },
      delayed: { status: 'planned', version: 2, scheduledDate: '2099-01-04', scheduledTime: '10:00' },
      completionReplay: true, plannedUndo: 'planned', cancelledUndo: 'cancelled',
      updatedRuleVersion: 2, targetVersion: 1, staleDelete: { code: 'VERSION_CONFLICT', status: 409 }, deleted: true,
      visibleAfterDelete: [[{ sourceType: 'medicine-occurrence', status: 'skipped' }], [], [], []],
    })
    const reconnected = withOccurrences(new MySqlLifeStore(pool, { now: () => now }))
    expect(await Promise.all(['2099-01-01', '2099-01-02', '2099-01-03', '2099-01-04']
      .map((date) => reconnected.getPlanningTimeline(mysqlResult.ownerId, date))))
      .toEqual(await Promise.all(['2099-01-01', '2099-01-02', '2099-01-03', '2099-01-04']
        .map((date) => mysqlSubject.getPlanningTimeline(mysqlResult.ownerId, date))))
  })

  it('rolls back failed occurrence completion, releases its idempotency key and reconnects with Memory-equivalent facts', async () => {
    const stamp = `${Date.now()}`
    const now = '2098-12-15T12:00:00.000Z'
    const mysqlStore = withOccurrences(new MySqlLifeStore(pool, { now: () => now }))
    const owner = await mysqlStore.createUser({
      account: `occurrence-rollback-${stamp}@example.com`, displayName: 'Occurrence Rollback',
      passwordHash: await hashPassword('occurrence-rollback-password'),
    })
    const medicineInput = {
      kind: 'medicine' as const, name: `Occurrence rollback medicine ${stamp}`, baseUnit: 'tablet', availableUnits: ['tablet'],
      pricePoints: [{ amountMinor: 3_000, currency: 'CNY', purchaseQuantity: 30, purchaseUnit: 'tablet', effectiveFrom: '2098-12-01' }],
    }
    const medicine = await mysqlStore.createCatalogItem(owner.id, medicineInput, `occurrence-rollback-medicine-${stamp}`)
    await mysqlStore.createInventoryTransaction(owner.id, {
      itemId: medicine.id, kind: 'purchase', quantity: 10, unit: 'tablet', occurredAt: '2098-12-15T06:00:00.000Z',
      batch: { actualUnitCostMinor: 73 },
    }, `occurrence-rollback-stock-${stamp}`)
    const recurrenceInput = {
      title: 'Occurrence rollback facts', sourceId: medicine.id, quantity: 1, unit: 'tablet',
      recurrence: { mode: 'interval' as const, everyDays: 1, times: ['08:00'], startDate: '2099-01-01', endDate: '2099-01-01' },
    }
    await mysqlStore.createMedicineRecurrenceRule(owner.id, recurrenceInput, `occurrence-rollback-rule-${stamp}`)
    const initialTimeline = await mysqlStore.getPlanningTimeline(owner.id, '2099-01-01')
    const occurrence = initialTimeline.timelineItems.find((entry): entry is MedicineRecurrenceOccurrence & { sourceType: 'medicine-occurrence' } => entry.sourceType === 'medicine-occurrence')
    expect(occurrence).toBeDefined()
    const completionInput: PlanningCompletionInput = {
      source: { type: 'medicine-occurrence', id: occurrence!.id, entityVersion: occurrence!.entityVersion },
      completedAt: '2099-01-01T08:05:00.000Z',
    }
    const completionKey = `occurrence-rollback-completion-${stamp}`
    const balance = async (subject = mysqlStore) => (await subject.listInventoryBalances(owner.id))
      .find((entry) => entry.itemId === medicine.id)?.onHand

    await pool.query('DROP TRIGGER IF EXISTS trg_test_occurrence_completion_fail')
    await pool.query(`CREATE TRIGGER trg_test_occurrence_completion_fail BEFORE INSERT ON life_completion_snapshots
      FOR EACH ROW BEGIN
        IF NEW.medicine_occurrence_id IS NOT NULL THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='TEST_OCCURRENCE_COMPLETION_ROLLBACK';
        END IF;
      END`)
    try {
      await expect(mysqlStore.createPlanningCompletionFromSource(owner.id, completionInput, completionKey))
        .rejects.toMatchObject({ code: 'ER_SIGNAL_EXCEPTION' })
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS trg_test_occurrence_completion_fail')
    }

    expect(await balance()).toBe(10)
    const [rolledBackOccurrence] = await rows<RowDataPacket & { status: string; completionId: string | null; entityVersion: number }>(pool,
      'SELECT status,completion_id completionId,entity_version entityVersion FROM life_medicine_recurrence_occurrences WHERE user_id=? AND id=?',
      [owner.id, occurrence!.id])
    expect(rolledBackOccurrence).toMatchObject({ status: 'planned', completionId: null, entityVersion: 1 })
    const [rolledBackSnapshots] = await rows<CountRow>(pool,
      'SELECT COUNT(*) count FROM life_completion_snapshots WHERE user_id=? AND medicine_occurrence_id=?', [owner.id, occurrence!.id])
    expect(Number(rolledBackSnapshots?.count)).toBe(0)
    const [rolledBackLinks] = await rows<CountRow>(pool, `SELECT COUNT(*) count FROM life_completion_inventory_events e
      JOIN life_completion_snapshots s ON s.user_id=e.user_id AND s.id=e.completion_id
      WHERE s.user_id=? AND s.medicine_occurrence_id=?`, [owner.id, occurrence!.id])
    expect(Number(rolledBackLinks?.count)).toBe(0)
    const [rolledBackKey] = await rows<CountRow>(pool, `SELECT COUNT(*) count FROM life_planning_idempotency
      WHERE user_id=? AND operation_key='planning:create-completion' AND idempotency_key=?`, [owner.id, completionKey])
    expect(Number(rolledBackKey?.count)).toBe(0)

    const reconnected = withOccurrences(new MySqlLifeStore(pool, { now: () => now }))
    expect(await reconnected.getPlanningTimeline(owner.id, '2099-01-01')).toEqual(initialTimeline)
    const retried = await reconnected.createPlanningCompletionFromSource(owner.id, completionInput, completionKey)
    expect(retried).toMatchObject({ kind: 'medicine', quantity: 1, unit: 'tablet', costMinor: 73 })
    expect(await balance(reconnected)).toBe(9)

    const memoryStore = withOccurrences(new MemoryLifeStore({ now: () => now }))
    const memoryOwner = await memoryStore.createUser({
      account: 'occurrence-parity@example.com', displayName: 'Occurrence Parity', passwordHash: 'not-used-by-store-contract',
    })
    const memoryMedicine = await memoryStore.createCatalogItem(memoryOwner.id, { ...medicineInput, name: 'Occurrence rollback medicine' }, 'occurrence-parity-medicine')
    await memoryStore.createInventoryTransaction(memoryOwner.id, {
      itemId: memoryMedicine.id, kind: 'purchase', quantity: 10, unit: 'tablet', occurredAt: '2098-12-15T06:00:00.000Z',
      batch: { actualUnitCostMinor: 73 },
    }, 'occurrence-parity-stock')
    await memoryStore.createMedicineRecurrenceRule(memoryOwner.id, {
      ...recurrenceInput, sourceId: memoryMedicine.id,
    }, 'occurrence-parity-rule')
    const memoryTimeline = await memoryStore.getPlanningTimeline(memoryOwner.id, '2099-01-01')
    const memoryOccurrence = memoryTimeline.timelineItems.find((entry): entry is MedicineRecurrenceOccurrence & { sourceType: 'medicine-occurrence' } => entry.sourceType === 'medicine-occurrence')
    const memoryCompletion = await memoryStore.createPlanningCompletionFromSource(memoryOwner.id, {
      source: { type: 'medicine-occurrence', id: memoryOccurrence!.id, entityVersion: memoryOccurrence!.entityVersion },
      completedAt: '2099-01-01T08:05:00.000Z',
    }, 'occurrence-parity-completion')
    const completionSemantics = (value: PlanningCompletionSnapshot) => ({
      dayPlanId: value.dayPlanId, dayPlanItemId: value.dayPlanItemId, kind: value.kind,
      sourceType: value.source?.type ?? null, quantity: value.quantity, unit: value.unit, costMinor: value.costMinor,
      inventoryEventCount: value.inventoryTransactionIds.length,
      completionSource: value.completionSource.type === 'medicine-occurrence' ? {
        type: value.completionSource.type,
        originalDate: value.completionSource.originalDate,
        originalTime: value.completionSource.originalTime,
      } : value.completionSource,
    })
    expect(completionSemantics(retried)).toEqual(completionSemantics(memoryCompletion))
    const timelineSemantics = (value: PlanningTimeline) => value.timelineItems.map((entry) => entry.sourceType === 'medicine-occurrence' ? {
      sourceType: entry.sourceType, kind: entry.kind, title: entry.title, quantity: entry.quantity, unit: entry.unit,
      originalDate: entry.originalDate, originalTime: entry.originalTime, scheduledDate: entry.scheduledDate,
      scheduledTime: entry.scheduledTime, status: entry.status, entityVersion: entry.entityVersion,
    } : entry)
    expect(timelineSemantics(await reconnected.getPlanningTimeline(owner.id, '2099-01-01')))
      .toEqual(timelineSemantics(await memoryStore.getPlanningTimeline(memoryOwner.id, '2099-01-01')))
  })

  it('consumes prepared meals before ingredients and restores the exact immutable prepared-food events', async () => {
    const stamp = `${Date.now()}`
    const owner = await store.createUser({
      account: `planning-meal-${stamp}@example.com`, displayName: 'Planning Meal', passwordHash: await hashPassword('planning-meal-password'),
    })
    const ingredient = await store.createCatalogItem(owner.id, {
      kind: 'ingredient', name: `Planning grain ${stamp}`, baseUnit: 'gram',
      nutrition: { basisQuantity: 100, basisUnit: 'gram', values: { energyKcal: 100, proteinGrams: 4, fatGrams: 1, carbohydrateGrams: 20 } },
      pricePoints: [{ amountMinor: 100, currency: 'CNY', purchaseQuantity: 100, purchaseUnit: 'gram', effectiveFrom: '2026-08-01' }],
    }, `planning-meal-ingredient-${stamp}`)
    await store.createInventoryTransaction(owner.id, {
      itemId: ingredient.id, kind: 'purchase', quantity: 1_000, unit: 'gram', occurredAt: '2026-08-18T06:00:00.000Z',
    }, `planning-meal-stock-${stamp}`)
    const recipe = await store.createRecipe(owner.id, {
      name: `Planning bowl ${stamp}`, servings: 4,
      components: [{ itemId: ingredient.id, quantity: 400, unit: 'gram', role: 'ingredient', position: 0 }],
      steps: [{ instruction: 'Cook.', ingredientItemIds: [ingredient.id], durationSeconds: 600, imageMediaId: null, caution: '', position: 0 }],
    }, `planning-meal-recipe-${stamp}`)
    const cooking = await store.createCookingSession(owner.id, {
      recipeId: recipe.id, recipeVersionId: recipe.currentVersion.id, plannedServings: 4,
    }, `planning-meal-cooking-${stamp}`)
    await store.completeCookingSession(owner.id, cooking.id, {
      madeServings: 4, eatenServings: 0, completedAt: '2026-08-19T10:00:00.000Z',
    }, `planning-meal-cooking-complete-${stamp}`)
    const day = await store.createDayPlan(owner.id, {
      date: '2026-08-21', mealSlots: [{ id: 'breakfast', name: 'Breakfast', position: 0, hidden: false }],
      items: [{ kind: 'meal', title: 'Prepared bowl', mealSlotId: 'breakfast', scheduledTime: '08:00',
        source: { type: 'recipe-version', id: recipe.id, versionId: null }, quantity: null, unit: null, servings: 2, durationMinutes: null }],
    }, `planning-meal-day-${stamp}`)
    await store.updateCatalogItem(owner.id, ingredient.id, { version: ingredient.version, status: 'disabled' })

    const completion = await store.createPlanningCompletion(owner.id, {
      date: day.date, dayPlanItemId: day.items[0]!.id, completedAt: '2026-08-21T08:05:00.000Z',
    }, `planning-meal-completion-${stamp}`)
    expect(completion).toMatchObject({
      kind: 'meal', nutrition: { energyKcal: 200, proteinGrams: 8, fatGrams: 2, carbohydrateGrams: 40 },
      costMinor: 200, preparedFoodEventIds: [expect.any(String)], inventoryTransactionIds: [],
      source: { type: 'recipe-version', id: recipe.id, versionId: recipe.currentVersion.id },
      quantity: null, unit: null, servings: 2, energyIsEstimate: false,
    })
    expect(await store.getDayPlan(owner.id, day.date)).toMatchObject({
      items: [expect.objectContaining({
        actual: expect.objectContaining({
          source: { type: 'recipe-version', id: recipe.id, versionId: recipe.currentVersion.id },
          quantity: null, unit: null, servings: 2, energyIsEstimate: false,
        }),
      })],
    })
    expect(await store.listPreparedFood(owner.id)).toEqual([
      expect.objectContaining({ portionsRemaining: 2, costRemainingMinor: 200 }),
    ])
    const undo = await store.undoPlanningCompletion(owner.id, completion.id, `planning-meal-undo-${stamp}`)
    expect(undo).toMatchObject({ restoredPreparedFoodEventIds: completion.preparedFoodEventIds })
    expect(await store.listPreparedFood(owner.id)).toEqual([
      expect.objectContaining({ portionsRemaining: 4, costRemainingMinor: 400 }),
    ])
  })

  it('captures catalog facts from the completion transaction snapshot under a concurrent update', async () => {
    const stamp = `${Date.now()}`
    const owner = await store.createUser({
      account: `planning-snapshot-${stamp}@example.com`, displayName: 'Planning Snapshot', passwordHash: await hashPassword('planning-snapshot-password'),
    })
    const supplement = await store.createCatalogItem(owner.id, {
      kind: 'supplement', name: `Snapshot supplement ${stamp}`, baseUnit: 'capsule', availableUnits: ['capsule'],
      nutrition: { basisQuantity: 1, basisUnit: 'capsule', values: { energyKcal: 5, proteinGrams: 1, fatGrams: 0, carbohydrateGrams: 0 } },
      pricePoints: [{ amountMinor: 100, currency: 'CNY', purchaseQuantity: 1, purchaseUnit: 'capsule', effectiveFrom: '2026-08-01' }],
    }, `planning-snapshot-supplement-${stamp}`)
    await store.createInventoryTransaction(owner.id, {
      itemId: supplement.id, kind: 'purchase', quantity: 2, unit: 'capsule', occurredAt: '2026-08-18T06:00:00.000Z',
      batch: { actualUnitCostMinor: 73 },
    }, `planning-snapshot-stock-${stamp}`)
    const day = await store.createDayPlan(owner.id, {
      date: '2026-08-22', mealSlots: [],
      items: [{ kind: 'supplement', title: 'Snapshot supplement', mealSlotId: null, scheduledTime: '08:00',
        source: { type: 'catalog-item', id: supplement.id }, quantity: 1, unit: 'capsule', servings: null, durationMinutes: null }],
    }, `planning-snapshot-day-${stamp}`)
    const completionKey = `planning-snapshot-completion-${stamp}`
    await pool.query('DROP TRIGGER IF EXISTS trg_test_planning_completion_snapshot_pause')
    await pool.query(`CREATE TRIGGER trg_test_planning_completion_snapshot_pause BEFORE INSERT ON life_planning_idempotency
      FOR EACH ROW SET @lifeops_test_pause = IF(NEW.operation_key = 'planning:create-completion' AND NEW.idempotency_key = '${completionKey}', SLEEP(0.5), 0)`)
    try {
      const completionPromise = store.createPlanningCompletion(owner.id, {
        date: day.date, dayPlanItemId: day.items[0]!.id, completedAt: '2026-08-22T08:05:00.000Z',
      }, completionKey)
      await new Promise((resolve) => setTimeout(resolve, 100))
      await store.updateCatalogItem(owner.id, supplement.id, {
        version: supplement.version,
        nutrition: { basisQuantity: 1, basisUnit: 'capsule', values: { energyKcal: 50, proteinGrams: 10, fatGrams: 0, carbohydrateGrams: 0 } },
      })
      const completion = await completionPromise
      expect(completion.nutrition).toEqual({ energyKcal: 5, proteinGrams: 1, fatGrams: 0, carbohydrateGrams: 0 })
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS trg_test_planning_completion_snapshot_pause')
    }
  })

  it('freezes occurrence completion facts under a concurrent catalog update and consumes inventory once', async () => {
    const stamp = `${Date.now()}`
    const now = '2098-12-15T12:00:00.000Z'
    const subject = withOccurrences(new MySqlLifeStore(pool, { now: () => now }))
    const owner = await subject.createUser({
      account: `occurrence-snapshot-${stamp}@example.com`, displayName: 'Occurrence Snapshot',
      passwordHash: await hashPassword('occurrence-snapshot-password'),
    })
    const medicine = await subject.createCatalogItem(owner.id, {
      kind: 'medicine', name: `Occurrence snapshot medicine ${stamp}`, baseUnit: 'tablet', availableUnits: ['tablet'],
      nutrition: { basisQuantity: 1, basisUnit: 'tablet', values: { energyKcal: 5, proteinGrams: 1, fatGrams: 0, carbohydrateGrams: 0 } },
    }, `occurrence-snapshot-medicine-${stamp}`)
    await subject.createInventoryTransaction(owner.id, {
      itemId: medicine.id, kind: 'purchase', quantity: 2, unit: 'tablet', occurredAt: '2098-12-15T06:00:00.000Z',
      batch: { actualUnitCostMinor: 73 },
    }, `occurrence-snapshot-stock-${stamp}`)
    await subject.createMedicineRecurrenceRule(owner.id, {
      title: 'Occurrence snapshot facts', sourceId: medicine.id, quantity: 1, unit: 'tablet',
      recurrence: { mode: 'interval', everyDays: 1, times: ['08:00'], startDate: '2099-01-01', endDate: '2099-01-01' },
    }, `occurrence-snapshot-rule-${stamp}`)
    const occurrence = (await subject.getPlanningTimeline(owner.id, '2099-01-01')).timelineItems
      .find((entry): entry is MedicineRecurrenceOccurrence & { sourceType: 'medicine-occurrence' } => entry.sourceType === 'medicine-occurrence')!
    const completionInput: PlanningCompletionInput = {
      source: { type: 'medicine-occurrence', id: occurrence.id, entityVersion: occurrence.entityVersion },
      completedAt: '2099-01-01T08:05:00.000Z',
    }
    const completionKey = `occurrence-snapshot-completion-${stamp}`

    await pool.query('DROP TRIGGER IF EXISTS trg_test_occurrence_completion_snapshot_pause')
    await pool.query(`CREATE TRIGGER trg_test_occurrence_completion_snapshot_pause BEFORE INSERT ON life_planning_idempotency
      FOR EACH ROW SET @lifeops_occurrence_test_pause = IF(NEW.operation_key = 'planning:create-completion' AND NEW.idempotency_key = '${completionKey}', SLEEP(0.5), 0)`)
    let completion: PlanningCompletionSnapshot
    try {
      const completionPromise = subject.createPlanningCompletionFromSource(owner.id, completionInput, completionKey)
      await new Promise((resolve) => setTimeout(resolve, 100))
      await subject.updateCatalogItem(owner.id, medicine.id, {
        version: medicine.version,
        nutrition: { basisQuantity: 1, basisUnit: 'tablet', values: { energyKcal: 50, proteinGrams: 10, fatGrams: 0, carbohydrateGrams: 0 } },
      })
      completion = await completionPromise
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS trg_test_occurrence_completion_snapshot_pause')
    }

    expect(completion!).toMatchObject({
      quantity: 1, unit: 'tablet', nutrition: { energyKcal: 5, proteinGrams: 1, fatGrams: 0, carbohydrateGrams: 0 },
      costMinor: 73,
      completionSource: {
        type: 'medicine-occurrence', id: occurrence.id, ruleId: occurrence.ruleId,
        originalDate: '2099-01-01', originalTime: '08:00', scheduledDate: '2099-01-01', scheduledTime: '08:00',
      },
    })
    expect(await subject.createPlanningCompletionFromSource(owner.id, completionInput, completionKey)).toEqual(completion!)
    expect((await subject.listInventoryBalances(owner.id)).find((entry) => entry.itemId === medicine.id)?.onHand).toBe(1)
    expect((await subject.getPlanningTimeline(owner.id, '2099-01-01')).timelineItems).toEqual([
      expect.objectContaining({ id: occurrence.id, status: 'completed', completionId: completion!.id, entityVersion: 2 }),
    ])
  })

  it('closes the legacy migration and owned foundation journey across a reconnect', async () => {
    const stamp = `${Date.now()}`
    const owner = await store.createUser({
      account: `p1-legacy-journey-${stamp}@example.com`,
      displayName: 'P1 Legacy Journey',
      passwordHash: await hashPassword('p1-legacy-journey-password'),
    })
    const legacyPlan = await store.createPlan(owner.id, { title: `Legacy bridge ${stamp}` })

    await pool.query("DELETE FROM schema_migrations WHERE version = '002'")
    await runMigrations(pool)
    const [backfilledRow] = await rows<RowDataPacket & { id: string; evidenceDate: string }>(pool,
      `SELECT id, DATE_FORMAT(updated_at, '%Y-%m-%d') evidenceDate
       FROM tasks WHERE user_id = ? AND legacy_plan_id = ?`, [owner.id, legacyPlan.id])
    expect(backfilledRow).toEqual(expect.objectContaining({ id: expect.any(String) }))
    const evidenceDate = backfilledRow!.evidenceDate

    const goal = await store.createGoal(owner.id, {
      title: `Foundation goal ${stamp}`,
    }, `p1-legacy-goal-${stamp}`)
    const project = await store.createProject(owner.id, goal.id, {
      title: `Foundation project ${stamp}`,
    }, `p1-legacy-project-${stamp}`)
    const task = await store.createTask(owner.id, {
      goalId: goal.id,
      projectId: project.id,
      title: `Foundation task ${stamp}`,
      startsAt: `${evidenceDate}T08:00:00.000Z`,
      endsAt: `${evidenceDate}T09:00:00.000Z`,
    }, `p1-legacy-task-${stamp}`)
    const habit = await store.createHabit(owner.id, {
      goalId: goal.id,
      projectId: project.id,
      title: `Foundation habit ${stamp}`,
      measure: 'boolean',
      timezone: 'Asia/Shanghai',
      schedule: { scheduleType: 'daily', startsOn: evidenceDate },
    }, `p1-legacy-habit-${stamp}`)
    await store.upsertHabitEntry(owner.id, habit.id, evidenceDate, {
      status: 'done', note: 'P1 reconnect evidence',
    }, `p1-legacy-habit-entry-${stamp}`)
    const record = await store.createRecord(owner.id, {
      title: `Foundation record ${stamp}`,
      body: 'Legacy and owned domain facts survive one reconnect.',
      occurredAt: `${evidenceDate}T09:30:00.000Z`,
      links: [{ type: 'task', id: task.id }],
    }, `p1-legacy-record-${stamp}`)
    const review = await store.createReview(owner.id, {
      type: 'weekly',
      period: { from: evidenceDate, to: evidenceDate },
      achievements: ['P1 owned foundation persisted'],
      insights: ['Legacy compatibility and new writes coexist'],
    }, `p1-legacy-review-${stamp}`)

    const reconnected = new MySqlLifeStore(pool)
    expect(await reconnected.getTask(owner.id, backfilledRow!.id)).toMatchObject({
      id: backfilledRow!.id,
      title: legacyPlan.title,
    })
    expect(await reconnected.getGoal(owner.id, goal.id)).toMatchObject({ id: goal.id, title: goal.title })
    expect(await reconnected.getProject(owner.id, project.id)).toMatchObject({ id: project.id, goalId: goal.id })
    expect(await reconnected.getTask(owner.id, task.id)).toMatchObject({
      id: task.id, goalId: goal.id, projectId: project.id,
    })
    expect(await reconnected.getHabit(owner.id, habit.id)).toMatchObject({
      id: habit.id, goalId: goal.id, projectId: project.id,
    })
    expect(await reconnected.getRecord(owner.id, record.id)).toMatchObject({
      id: record.id, links: [{ type: 'task', id: task.id }],
    })
    expect(await reconnected.getReview(owner.id, review.id)).toMatchObject({
      id: review.id,
      evidence: { tasks: { total: 2 }, habits: { done: 1 }, records: { total: 1 }, hasFacts: true },
    })
    expect((await reconnected.getState(owner.id)).plans).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: legacyPlan.id, title: legacyPlan.title }),
    ]))
  })

  it('closes the complete life policy to prepared plan to portable commerce journey across a reconnect', async () => {
    const stamp = `${Date.now()}`
    const owner = await store.createUser({
      account: `p1-life-journey-${stamp}@example.com`,
      displayName: 'P1 Life Journey',
      passwordHash: await hashPassword('p1-life-journey-password'),
    })
    const other = await store.createUser({
      account: `p1-life-journey-other-${stamp}@example.com`,
      displayName: 'P1 Life Journey Other',
      passwordHash: await hashPassword('p1-life-journey-other-password'),
    })
    const ingredient = await store.createCatalogItem(owner.id, {
      kind: 'ingredient',
      name: `P1 journey grain ${stamp}`,
      baseUnit: 'gram',
      availableUnits: ['gram', 'kilogram'],
      nutrition: {
        basisQuantity: 100,
        basisUnit: 'gram',
        values: { energyKcal: 100, proteinGrams: 4, fatGrams: 1, carbohydrateGrams: 20 },
      },
      pricePoints: [{
        amountMinor: 1_000,
        currency: 'CNY',
        purchaseQuantity: 1,
        purchaseUnit: 'kilogram',
        effectiveFrom: '2026-08-01',
      }],
    }, `p1-life-ingredient-${stamp}`)
    await store.createInventoryTransaction(owner.id, {
      itemId: ingredient.id,
      kind: 'purchase',
      quantity: 1_000,
      unit: 'gram',
      occurredAt: '2026-08-14T06:00:00.000Z',
      batch: { actualUnitCostMinor: 1 },
    }, `p1-life-opening-stock-${stamp}`)
    const createdPolicy = await store.upsertInventoryPolicy(owner.id, ingredient.id, {
      minimumStock: 250,
      packageQuantity: 250,
      unitId: 'builtin:gram',
    }, `p1-life-policy-${stamp}`)
    const policy = await store.upsertInventoryPolicy(owner.id, ingredient.id, {
      minimumStock: 500,
      packageQuantity: 250,
      unitId: 'builtin:gram',
      version: createdPolicy.policy.version,
    }, `p1-life-policy-update-${stamp}`)
    expect(policy).toMatchObject({ created: false, policy: { version: 2, minimumStock: 500 } })

    const recipe = await store.createRecipe(owner.id, {
      name: `P1 journey bowl ${stamp}`,
      servings: 4,
      yieldQuantity: 4,
      yieldUnit: 'portion',
      components: [{ itemId: ingredient.id, quantity: 400, unit: 'gram', role: 'ingredient', position: 0 }],
      steps: [{
        instruction: 'Cook the grain.', ingredientItemIds: [ingredient.id], durationSeconds: 600,
        imageMediaId: null, caution: '', position: 0,
      }],
    }, `p1-life-recipe-${stamp}`)
    const cooking = await store.createCookingSession(owner.id, {
      recipeId: recipe.id,
      recipeVersionId: recipe.currentVersion.id,
      plannedServings: 4,
    }, `p1-life-cooking-${stamp}`)
    const cooked = await store.completeCookingSession(owner.id, cooking.id, {
      madeServings: 4,
      eatenServings: 1,
      completedAt: '2026-08-14T10:00:00.000Z',
    }, `p1-life-cooking-complete-${stamp}`)
    expect(cooked).toMatchObject({
      snapshot: { totalCostMinor: 400 },
      preparedFood: { portionsCreated: 3, portionsRemaining: 3, costRemainingMinor: 300 },
    })

    const template = await store.createPlanTemplate(owner.id, {
      name: `P1 journey template ${stamp}`,
      mealSlots: [{ id: 'lunch', name: 'Lunch', position: 0, hidden: false }],
      items: [{
        kind: 'meal', title: 'P1 journey planned bowl', mealSlotId: 'lunch', scheduledTime: '12:00',
        weekdays: [1], source: { type: 'recipe-version', id: recipe.id, versionId: null },
        quantity: null, unit: null, servings: 8, durationMinutes: null,
      }],
    }, `p1-life-template-${stamp}`)
    const day = await store.createDayPlan(owner.id, {
      date: '2026-08-24',
      mealSlots: template.mealSlots,
      items: [],
    }, `p1-life-day-${stamp}`)
    const applied = await store.applyTemplateToDayPlan(owner.id, day.date, {
      templateId: template.id,
      resolution: 'merge',
      entityVersion: day.entityVersion,
      templateVersion: template.entityVersion,
    }, `p1-life-template-apply-${stamp}`)
    expect(applied).toMatchObject({
      items: [expect.objectContaining({ source: { type: 'recipe-version', id: recipe.id, versionId: null }, servings: 8 })],
    })
    expect(await store.getDayPlanProjection(owner.id, day.date)).toMatchObject({
      inventory: [expect.objectContaining({ itemId: ingredient.id, baseUnit: 'gram', plannedDemand: 500 })],
      items: [expect.objectContaining({
        preparedFood: expect.objectContaining({
          portionsAvailable: 3, portionsAllocated: 3, portionsRemainingAfterPlan: 0,
        }),
      })],
    })

    const manual = await store.createShoppingSuggestion(owner.id, {
      itemId: ingredient.id,
      requiredQuantity: 100,
      unit: 'gram',
      packageQuantity: 100,
      reason: { kind: 'manual', sourceType: 'manual', sourceId: `p1-life-manual-${stamp}`, requiredOn: null },
    }, `p1-life-manual-suggestion-${stamp}`)
    const firstRecalculation = await store.recalculateShopping(owner.id, {
      through: day.date,
    }, `p1-life-recalculate-${stamp}`)
    expect(firstRecalculation).toMatchObject({
      calculations: [{
        itemId: ingredient.id, policyVersion: 2, unit: 'gram', plannedDemand: 500,
        minimumStock: 500, effectiveStock: 600, outstandingFormalQuantity: 0,
        rawShortage: 400, suggestedQuantity: 500,
      }],
      suggestions: [{ origin: 'derived', itemId: ingredient.id, through: day.date, suggestedQuantity: 500 }],
    })

    const formal = await store.createShoppingItem(owner.id, {
      itemId: ingredient.id,
      requestedQuantity: 0.25,
      unit: 'kilogram',
      neededOn: day.date,
      priority: 'high',
      storeGroup: 'Bulk',
    }, `p1-life-formal-${stamp}`)
    const purchase = await store.createPurchase(owner.id, {
      purchasedAt: '2026-08-14T11:00:00.000Z',
      currency: 'CNY',
      storeName: 'P1 journey market',
      items: [{
        shoppingItemId: formal.id,
        itemId: ingredient.id,
        quantity: 0.1,
        unit: 'kilogram',
        amountMinor: 100,
        updateCurrentPrice: true,
      }],
    }, `p1-life-purchase-${stamp}`)
    expect(purchase.shoppingItems).toEqual([
      expect.objectContaining({ id: formal.id, status: 'partial', purchasedQuantity: 0.1, remainingQuantity: 0.15 }),
    ])
    const secondRecalculation = await store.recalculateShopping(owner.id, {
      through: day.date,
    }, `p1-life-recalculate-after-purchase-${stamp}`)
    expect(secondRecalculation).toMatchObject({
      calculations: [{
        itemId: ingredient.id, plannedDemand: 500, effectiveStock: 700,
        outstandingFormalQuantity: 150, rawShortage: 150, suggestedQuantity: 250,
      }],
      suggestions: [{ origin: 'derived', itemId: ingredient.id, suggestedQuantity: 250 }],
    })
    expect(await store.listShopping(owner.id)).toMatchObject({
      suggestions: expect.arrayContaining([
        expect.objectContaining({ id: manual.id, origin: 'manual', requiredQuantity: 100 }),
        expect.objectContaining({ origin: 'derived', itemId: ingredient.id, suggestedQuantity: 250 }),
      ]),
      formalItems: [expect.objectContaining({ id: formal.id, status: 'partial', remainingQuantity: 0.15 })],
    })

    const completion = await store.createPlanningCompletion(owner.id, {
      date: day.date,
      dayPlanItemId: applied!.items[0]!.id,
      completedAt: '2026-08-24T12:05:00.000Z',
    }, `p1-life-plan-completion-${stamp}`)
    expect(completion).toMatchObject({
      source: { type: 'recipe-version', id: recipe.id, versionId: recipe.currentVersion.id },
      servings: 8,
      costMinor: 800,
      preparedFoodEventIds: [expect.any(String)],
      inventoryTransactionIds: [expect.any(String)],
    })
    expect(await store.listPreparedFood(owner.id)).toEqual([
      expect.objectContaining({
        recipeId: recipe.id, recipeVersionId: recipe.currentVersion.id,
        portionsCreated: 3, portionsRemaining: 0, costRemainingMinor: 0,
      }),
    ])

    const refund = await store.createRefund(owner.id, purchase.purchase.id, {
      refundedAt: '2026-08-24T13:00:00.000Z',
      note: 'Return unused grain',
      items: [{ purchaseItemId: purchase.items[0]!.id, quantity: 0.05, amountMinor: 50 }],
    }, `p1-life-refund-${stamp}`)
    expect(refund).toMatchObject({
      refund: { totalAmountMinor: 50 },
      cashExpenditure: { amountMinor: -50, sourceType: 'refund' },
    })
    expect(await store.getLifeAnalytics(owner.id, '2026-08-14', day.date)).toMatchObject({
      totals: {
        cashExpenditureMinor: 50,
        consumptionCostMinor: 800,
        plannedCount: 1,
        actualCount: 1,
        incompleteCount: 0,
      },
    })

    const exported = await store.createLifeExport(owner.id, {
      format: 'json',
      includeAttachments: false,
    }, `p1-life-export-${stamp}`)
    expect(exported.payload).toMatchObject({
      inventoryPolicies: [expect.objectContaining({ id: policy.policy.id, version: 2 })],
      recipes: [expect.objectContaining({ id: recipe.id })],
      dayPlans: [expect.objectContaining({ id: day.id, date: day.date })],
      completionSnapshots: [expect.objectContaining({ id: completion.id, costMinor: 800 })],
      shoppingSuggestions: expect.arrayContaining([
        expect.objectContaining({ id: manual.id, origin: 'manual' }),
        expect.objectContaining({ origin: 'derived', suggestedQuantity: 250 }),
      ]),
      shoppingItems: [expect.objectContaining({ id: formal.id, status: 'partial' })],
    })
    const preview = await store.previewLifeImport(owner.id, {
      formatVersion: 1,
      checksumSha256: exported.checksumSha256,
      canonicalJson: exported.canonicalJson!,
      mode: 'replace',
    }, `p1-life-import-preview-${stamp}`)
    expect(preview).toMatchObject({
      status: 'conflicts',
      errors: [],
      conflicts: expect.arrayContaining([
        expect.objectContaining({ entityType: 'catalog-item', entityId: ingredient.id }),
      ]),
    })

    const reconnected = new MySqlLifeStore(pool)
    expect(await reconnected.listInventoryPolicies(owner.id)).toEqual([
      expect.objectContaining({ id: policy.policy.id, itemId: ingredient.id, version: 2 }),
    ])
    expect((await reconnected.listInventoryBalances(owner.id)).find((entry) => entry.itemId === ingredient.id))
      .toMatchObject({ baseUnit: 'gram', onHand: 150 })
    expect(await reconnected.getDayPlan(owner.id, day.date)).toMatchObject({
      id: day.id,
      items: [expect.objectContaining({
        id: applied!.items[0]!.id,
        status: 'completed',
        completionId: completion.id,
        actual: expect.objectContaining({ costMinor: 800 }),
      })],
    })
    expect(await reconnected.listShopping(owner.id)).toMatchObject({
      suggestions: expect.arrayContaining([
        expect.objectContaining({ id: manual.id, origin: 'manual' }),
        expect.objectContaining({ origin: 'derived', suggestedQuantity: 250 }),
      ]),
      formalItems: [expect.objectContaining({ id: formal.id, status: 'partial' })],
    })
    expect(await reconnected.listInventoryPolicies(other.id)).toEqual([])
    expect(await reconnected.listRecipes(other.id)).toEqual([])
    expect(await reconnected.getDayPlan(other.id, day.date)).toBeUndefined()
    expect(await reconnected.listShopping(other.id)).toEqual({ suggestions: [], formalItems: [] })
  })

  it('survives concurrent bootstrap and keeps private state isolated', async () => {
    const password = 'integration-owner-password'
    const [first, second] = await Promise.all([
      ensureBootstrapUser(store, { account: 'owner@example.com', password, displayName: 'Owner' }),
      ensureBootstrapUser(store, { account: 'owner@example.com', password, displayName: 'Owner' }),
    ])
    expect(first.user.id).toBe(second.user.id)

    const other = await store.createUser({ account: `other-${Date.now()}@example.com`, displayName: 'Other', passwordHash: await hashPassword('integration-other-password') })
    await store.createPlan(first.user.id, { title: '只属于 owner' })
    expect((await store.getState(other.id)).plans).toEqual([])
  })

  it('persists the complete owner-scoped knowledge contract across reconnects', async () => {
    const stamp = `${Date.now()}`
    const owner = await store.createUser({
      account: `knowledge-${stamp}@example.com`,
      displayName: 'Knowledge owner',
      passwordHash: await hashPassword('knowledge-owner-password'),
    })
    const other = await store.createUser({
      account: `knowledge-other-${stamp}@example.com`,
      displayName: 'Knowledge other',
      passwordHash: await hashPassword('knowledge-other-password'),
    })
    const source = await store.createReview(owner.id, {
      type: 'custom',
      period: { from: '2026-08-01', to: '2026-08-15' },
      achievements: ['Closed the knowledge persistence loop'],
      insights: ['Facts remain owner scoped'],
    }, `knowledge-review-${stamp}`)
    const collection = await store.createKnowledgeCollection(owner.id, {
      name: `Operations ${stamp}`,
      color: '#4F6F52',
      position: 2,
    })
    const first = await store.createKnowledgeNote(owner.id, {
      title: 'MySQL knowledge persistence',
      body: 'The exact database stores source links, collections and review metadata.',
      tags: ['mysql', 'evidence'],
      collectionIds: [collection.id],
      sourceLinks: [{ type: 'review', id: source.id }],
      pinned: true,
      favorite: true,
      reviewOn: '2026-08-14',
    })
    const second = await store.createKnowledgeNote(owner.id, {
      title: 'Related operational note',
      body: 'Cycle-safe relation traversal must preserve both note identities.',
      tags: ['operations'],
    })
    const firstRelated = await store.addKnowledgeRelation(owner.id, first.id, second.id, first.version)
    const secondRelated = await store.addKnowledgeRelation(owner.id, second.id, first.id, second.version)
    expect(firstRelated).toMatchObject({ id: first.id, relatedIds: [second.id], version: 2 })
    expect(secondRelated).toMatchObject({ id: second.id, relatedIds: [first.id], version: 2 })

    const updated = await store.updateKnowledgeNote(owner.id, first.id, {
      title: 'MySQL knowledge persistence verified',
      tags: ['mysql', 'exact'],
      version: firstRelated!.version,
    })
    expect(updated).toMatchObject({
      id: first.id,
      title: 'MySQL knowledge persistence verified',
      tags: ['mysql', 'exact'],
      collectionIds: [collection.id],
      sourceLinks: [{ type: 'review', id: source.id }],
      relatedIds: [second.id],
      pinned: true,
      favorite: true,
      reviewOn: '2026-08-14',
      version: 3,
    })
    await expect(store.updateKnowledgeNote(owner.id, first.id, {
      body: 'stale overwrite',
      version: firstRelated!.version,
    })).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 })

    const reconnected = new MySqlLifeStore(pool, { now: () => '2026-08-15T12:00:00.000Z' })
    expect(await reconnected.listKnowledge(owner.id, {
      q: 'verified', tag: 'exact', source: 'review', collectionId: collection.id,
    })).toEqual({ items: [expect.objectContaining({ id: first.id, version: 3 })] })
    expect((await reconnected.resurfaceKnowledge(owner.id, '2026-08-15T12:00:00.000Z'))[0]?.id).toBe(first.id)
    expect(await reconnected.listKnowledgeCollections(owner.id)).toEqual([
      expect.objectContaining({ id: collection.id, name: `Operations ${stamp}`, version: 1 }),
    ])
    expect(await reconnected.listKnowledge(other.id)).toEqual({ items: [] })
    expect(await reconnected.getKnowledgeNote(other.id, first.id)).toBeUndefined()
    await expect(reconnected.createKnowledgeNote(other.id, {
      title: 'Forged source', body: 'Must not cross the owner boundary.',
      sourceLinks: [{ type: 'review', id: source.id }],
    })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })

    const archived = await reconnected.archiveKnowledgeNote(owner.id, first.id, updated!.version)
    expect(archived).toMatchObject({ id: first.id, version: 4, archivedAt: '2026-08-15T12:00:00.000Z' })
    expect(await reconnected.listKnowledge(owner.id)).toEqual({
      items: [expect.objectContaining({ id: second.id })],
    })
    expect(await reconnected.deleteKnowledgeNote(owner.id, first.id, archived!.version)).toBe(true)
    const deleted = await reconnected.getKnowledgeNote(owner.id, first.id, true)
    expect(deleted).toMatchObject({ id: first.id, version: 5, deletedAt: '2026-08-15T12:00:00.000Z' })
    const restored = await reconnected.restoreKnowledgeNote(owner.id, first.id, deleted!.version)
    expect(restored).toMatchObject({ id: first.id, version: 6, archivedAt: null, deletedAt: null })

    const persisted = await rows<RowDataPacket>(pool, `SELECT collection_ids collectionIds, source_links sourceLinks,
        related_ids relatedIds, version FROM knowledge_notes WHERE user_id=? AND id=?`, [owner.id, first.id])
    expect(persisted[0]).toMatchObject({
      collectionIds: [collection.id],
      sourceLinks: [{ type: 'review', id: source.id }],
      relatedIds: [second.id],
      version: 6,
    })
    expect(await reconnected.deleteKnowledgeCollection(owner.id, collection.id, collection.version)).toBe(true)
    expect((await reconnected.getKnowledgeNote(owner.id, first.id))?.collectionIds).toEqual([])
  })

  it('creates revision-backed publishing tables and persists owner-scoped immutable public history across reconnects', async () => {
    const publishingTables = ['public_drafts', 'public_revisions']
    const schema = await rows<TableRow>(pool, `SELECT table_name tableName, table_collation tableCollation
      FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN (?,?)`, publishingTables)
    expect(schema.map((row) => row.tableName).sort()).toEqual(publishingTables)
    expect(schema.every((row) => row.tableCollation === 'utf8mb4_0900_ai_ci')).toBe(true)

    const stamp = `${Date.now()}`
    const owner = await store.createUser({ account: `publishing-${stamp}@example.com`, displayName: 'Publishing owner', passwordHash: await hashPassword('publishing-owner-password') })
    const other = await store.createUser({ account: `publishing-other-${stamp}@example.com`, displayName: 'Publishing other', passwordHash: await hashPassword('publishing-other-password') })
    const draft = await store.createPublicDraft(owner.id, {
      category: 'learning', source: { type: 'knowledge', id: `knowledge-${stamp}`, version: 7 },
      slug: `mysql-publishing-${stamp}`, title: 'MySQL publishing', excerpt: 'Exact persisted excerpt',
      body: '# Exact persisted body', tags: ['mysql', 'public'], featured: true,
      seo: { title: 'MySQL publishing SEO', description: 'Exact SEO description' },
    })
    expect(await store.getPublicDraft(other.id, draft.id)).toBeUndefined()
    await expect(store.updatePublicDraft(owner.id, draft.id, { title: 'stale', version: draft.version + 1 }))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 })

    const first = await store.publishPublicDraft(owner.id, draft.id, draft.version)
    expect(first).toMatchObject({ draftId: draft.id, revision: 1 })
    const edited = await store.updatePublicDraft(owner.id, draft.id, { title: 'MySQL publishing v2', version: draft.version + 1 })
    const second = await store.publishPublicDraft(owner.id, draft.id, edited!.version)
    expect(second).toMatchObject({ revision: 2 })

    const reconnected = new MySqlLifeStore(pool, { now: () => '2026-08-15T12:00:00.000Z' })
    expect((await reconnected.listPublicRevisions(owner.id, draft.id)).map((revision) => revision.title)).toEqual([
      'MySQL publishing v2', 'MySQL publishing',
    ])
    expect(await reconnected.getPublishedRevision(draft.slug)).toMatchObject({ title: 'MySQL publishing v2', revision: 2, sourceVersion: 3 })
    expect(await reconnected.diffPublicRevisionHistory(owner.id, draft.id, 1, 2)).toMatchObject({
      from: 1, to: 2, changed: expect.arrayContaining([{ field: 'title', before: 'MySQL publishing', after: 'MySQL publishing v2' }]),
    })
    expect(await reconnected.listPublicRevisions(other.id, draft.id)).toEqual([])

    const persisted = await rows<RowDataPacket>(pool, 'SELECT revision,source_version sourceVersion,title FROM public_revisions WHERE draft_id=? ORDER BY revision', [draft.id])
    expect(persisted).toEqual([
      expect.objectContaining({ revision: 1, sourceVersion: 1, title: 'MySQL publishing' }),
      expect.objectContaining({ revision: 2, sourceVersion: 3, title: 'MySQL publishing v2' }),
    ])
  })

  it('atomically allows only one scheduled publication when two MySQL replicas race the same due draft', async () => {
    const stamp = `${Date.now()}`
    const owner = await store.createUser({ account: `scheduler-${stamp}@example.com`, displayName: 'Scheduler owner', passwordHash: await hashPassword('scheduler-owner-password') })
    const draft = await store.createPublicDraft(owner.id, {
      category: 'doing', slug: `scheduled-${stamp}`, title: 'Scheduled publish', excerpt: 'One revision only', body: '# Scheduled publish',
    })
    const scheduled = await store.schedulePublicDraft(owner.id, draft.id, draft.version, '2026-08-15T12:01:00.000Z')
    expect(scheduled).toMatchObject({ status: 'scheduled', version: 2 })

    const replica = new MySqlLifeStore(pool, { now: () => '2026-08-15T12:02:00.000Z' })
    const [first, second] = await Promise.all([
      store.publishDuePublicDraft(draft.id, '2026-08-15T12:02:00.000Z'),
      replica.publishDuePublicDraft(draft.id, '2026-08-15T12:02:00.000Z'),
    ])
    expect([first, second].filter(Boolean)).toHaveLength(1)
    expect(await store.listPublicRevisions(owner.id, draft.id)).toHaveLength(1)
    expect(await replica.publishDuePublicDraft(draft.id, '2026-08-15T12:03:00.000Z')).toBeUndefined()
    expect(await rows<CountRow>(pool, 'SELECT COUNT(*) count FROM public_revisions WHERE draft_id=?', [draft.id]))
      .toEqual([expect.objectContaining({ count: 1 })])
  })

  it('persists the plan to record to review to knowledge to snapshot loop', async () => {
    const { user: owner } = await ensureBootstrapUser(store, { account: 'owner@example.com', password: 'integration-owner-password', displayName: 'Owner' })
    const plan = await store.createPlan(owner.id, { title: '私人计划' })
    const record = await store.createRecord(owner.id, { planId: plan.id, title: '执行记录', body: '完成了数据库闭环验证', tags: ['mysql'] })
    const review = await store.createReview(owner.id, {
      type: 'custom',
      period: { from: '2026-08-01', to: '2026-08-09' },
      achievements: ['真实数据库回顾'],
      insights: ['写入与读取一致'],
    }, `legacy-loop-review-${Date.now()}`)
    const knowledge = await store.createKnowledge(owner.id, {
      sourceType: 'review',
      sourceId: review.id,
      title: '数据库经验',
      body: '通过真实 MySQL 验证完整闭环。',
      tags: ['integration'],
    })
    const snapshot = await store.createSnapshot(owner.id, {
      slug: `integration-${Date.now()}`,
      sourceType: 'knowledge',
      sourceId: knowledge.id,
      title: '公开标题',
      excerpt: '仅公开经过选择的摘要',
    })
    expect(await store.getPublicSnapshot(snapshot.slug)).toBeUndefined()
    await store.publishSnapshot(owner.id, snapshot.id)
    expect((await store.getPublicSnapshot(snapshot.slug))?.excerpt).toBe('仅公开经过选择的摘要')
    await store.revokeSnapshot(owner.id, snapshot.id)
    expect(await store.getPublicSnapshot(snapshot.slug)).toBeUndefined()
    const state = await store.getState(owner.id)
    expect(state.plans.some((item) => item.id === plan.id)).toBe(true)
    expect(state.records.some((item) => item.id === record.id)).toBe(true)
    expect(state.reviews.some((item) => item.id === review.id)).toBe(true)
    expect(state.knowledge.some((item) => item.id === knowledge.id)).toBe(true)
    expect(state.snapshots.some((item) => item.id === snapshot.id)).toBe(true)
  })

  it('shares login failure state between store instances', async () => {
    const secondStore = new MySqlLifeStore(pool)
    const key = `integration-rate-${Date.now()}`
    const now = new Date().toISOString()
    const resetAt = new Date(Date.now() + 60_000).toISOString()
    await Promise.all(Array.from({ length: 8 }, () => store.recordLoginFailure(key, now, resetAt)))
    expect((await secondStore.getLoginFailure(key))?.count).toBe(8)
    await secondStore.clearLoginFailures(key)
    expect(await store.getLoginFailure(key)).toBeUndefined()
  })

  it('remaps and atomically replaces full owner data and settings in one MySQL transaction', async () => {
    const stamp = `${Date.now()}`
    const source = await store.createUser({
      account: `transfer-source-${stamp}@example.com`, displayName: 'Transfer source', passwordHash: await hashPassword('Transfer-source-password-2026!'),
    })
    const target = await store.createUser({
      account: `transfer-target-${stamp}@example.com`, displayName: 'Transfer target', passwordHash: await hashPassword('Transfer-target-password-2026!'),
    })
    const sourceGoal = await store.createGoal(source.id, { title: `Imported MySQL goal ${stamp}`, manualProgress: 37 }, `transfer-source-goal-${stamp}`)
    const deletedSourceRecord = await store.createRecord(source.id, {
      title: `Deleted MySQL record ${stamp}`, body: 'Deleted content must remain restorable.', occurredAt: '2026-08-23T03:00:00.000Z',
    })
    await store.deleteRecord(source.id, deletedSourceRecord.id, deletedSourceRecord.version)
    await store.updateUserSettings(source.id, { version: 1, appearance: { theme: 'dark', motion: 'reduce' } })
    await store.createGoal(target.id, { title: `Replace MySQL goal ${stamp}` }, `transfer-target-goal-${stamp}`)

    let remap = 0
    const transfer = new DataTransferService(store, { createId: () => `xfer-${stamp}-${++remap}` })
    const exported = await transfer.export(source.id)
    expect(exported.canonicalJson).toContain(`Deleted MySQL record ${stamp}`)
    const preview = await transfer.preview(target.id, { canonicalJson: exported.canonicalJson, checksumSha256: exported.checksumSha256 })
    const applied = await transfer.apply(
      target.id,
      { previewChecksum: preview.previewChecksum, currentPassword: 'verified-by-route' },
      async () => true,
      async ({ restorePoint }) => { await store.appendSafeAuditEvent(target.id, { action: 'data.import.apply', targetType: 'data-transfer', metadata: { restorePointId: restorePoint.id } }) },
    )
    expect(applied.restorePoint).toMatchObject({ id: expect.any(String), checksumSha256: expect.stringMatching(/^[a-f0-9]{64}$/) })
    const [restoreRows] = await pool.execute<Array<RowDataPacket & { checksum_sha256: string; canonical_json: string }>>(
      'SELECT checksum_sha256,canonical_json FROM data_transfer_restore_points WHERE user_id=? AND id=?',
      [target.id, applied.restorePoint.id],
    )
    expect(restoreRows).toHaveLength(1)
    expect(createHash('sha256').update(String(restoreRows[0]!.canonical_json)).digest('hex')).toBe(String(restoreRows[0]!.checksum_sha256))
    expect(String(restoreRows[0]!.canonical_json)).toContain(`Replace MySQL goal ${stamp}`)

    const importedGoals = await store.listGoals(target.id)
    expect(importedGoals).toHaveLength(1)
    expect(importedGoals[0]).toMatchObject({ title: `Imported MySQL goal ${stamp}`, manualProgress: 37 })
    expect(importedGoals[0]!.id).not.toBe(sourceGoal.id)
    expect(await store.getUserSettings(target.id)).toMatchObject({ appearance: { theme: 'dark', motion: 'reduce' } })
    expect((await store.listGoals(source.id))[0]?.id).toBe(sourceGoal.id)
    const importedDeletedRecord = (await store.readOwnedData(target.id)).original.records
      .find((record) => record.title === `Deleted MySQL record ${stamp}`)!
    expect(importedDeletedRecord.deletedAt).toEqual(expect.any(String))
    await expect(store.restoreRecord(target.id, importedDeletedRecord.id, importedDeletedRecord.version)).resolves.toMatchObject({
      title: `Deleted MySQL record ${stamp}`, body: 'Deleted content must remain restorable.', deletedAt: null,
    })

    const before = await store.readOwnedData(target.id)
    const changed = structuredClone(before) as DataTransferOwnedData
    changed.original.goals[0]!.title = 'This transaction must roll back'
    const auditBefore = (await store.listSafeAuditEvents(target.id, 500)).length
    await expect(store.transaction(target.id, async () => {
      await store.applyOwnedData(target.id, changed)
      await store.appendSafeAuditEvent(target.id, { action: 'data.import.rollback-probe', targetType: 'data-transfer' })
      throw new Error('injected data-transfer rollback')
    })).rejects.toThrow('injected data-transfer rollback')
    expect((await store.listGoals(target.id))[0]?.title).toBe(`Imported MySQL goal ${stamp}`)
    expect((await store.listSafeAuditEvents(target.id, 500)).length).toBe(auditBefore)
  })
})
