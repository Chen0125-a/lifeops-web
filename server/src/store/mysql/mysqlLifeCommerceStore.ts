import { randomUUID } from 'node:crypto'
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'
import { convertUnit, type CatalogItem, type LifeUnit, type UpdateCatalogItemInput } from '../../domain/life/catalog.js'
import type { CreateInventoryTransactionInput, InventoryBalance, InventoryTransaction } from '../../domain/life/inventory.js'
import type { DayPlanProjection, PlanningTimeline } from '../../domain/life/planning.js'
import type { MediaAsset } from '../../domain/types.js'
import {
  LifeCommerceDomainError,
  budgetScopeMatchesItemIds,
  buildPortableMediaAsset,
  checksumSha256,
  cleanText,
  createStoredZip,
  datesBetween,
  nonNegative,
  normalizeCommerceIdempotencyKey,
  portableJsonFromArchive,
  readStoredZip,
  positive,
  requestHash,
  stableJson,
  summarizeBudget,
  validDate,
  validTimestamp,
  validateBudgetInput,
  validateShoppingReasonSource,
  validatePortablePayload,
  validatePortablePayloadRelationships,
  type Budget,
  type CashExpenditure,
  type CreateBudgetInput,
  type CreatePurchaseInput,
  type CreateRefundInput,
  type CreateShoppingItemInput,
  type CreateShoppingSuggestionInput,
  type ExportJob,
  type ImportConflict,
  type ImportPreview,
  type ImportValidationError,
  type InventoryPolicy,
  type CompleteShoppingRecalculation,
  type IncompleteShoppingRecalculation,
  type LifeAnalytics,
  type PortablePayload,
  type PortableMediaAsset,
  type Purchase,
  type PurchaseItem,
  type Refund,
  type RefundItem,
  type ShoppingItem,
  type ShoppingQuantityEvidence,
  type ShoppingRecalculationResult,
  type ShoppingReason,
  type ShoppingSuggestion,
  type UpsertInventoryPolicyInput,
} from '../../domain/life/commerce.js'
import type { ImportApplyResult, ImportResolution, LifeCommerceStore, PreviewLifeImportInput } from '../lifeCommerceStore.js'

type Executor = Pool | PoolConnection
type SqlRow = RowDataPacket & Record<string, unknown>
const clone = <T>(value: T): T => structuredClone(value)
const sqlDateTime = (value: string) => new Date(value).toISOString().slice(0, 23).replace('T', ' ')
const iso = (value: unknown) => {
  if (value instanceof Date) return value.toISOString()
  const raw = String(value).replace(' ', 'T')
  return `${raw}${raw.endsWith('Z') ? '' : 'Z'}`
}
const dateOnly = (value: unknown) => value == null ? null : String(value).slice(0, 10)
const json = <T>(value: unknown, fallback: T): T => {
  if (value == null) return fallback
  if (typeof value !== 'string') return clone(value as T)
  try { return JSON.parse(value) as T } catch { return fallback }
}
const round = (value: number) => Math.round((value + Number.EPSILON) * 1_000_000_000) / 1_000_000_000
const portableSemanticJson = (value: unknown) => stableJson(JSON.parse(JSON.stringify(value), (_key, entry) => (
  typeof entry === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(entry)
    ? entry.replace('.000Z', 'Z')
    : entry
)))

async function rows<T>(executor: Executor, sql: string, values: unknown[] = []): Promise<T[]> {
  const [result] = await executor.execute(sql, values as never[])
  return result as unknown as T[]
}

export class MySqlLifeCommerceStore implements LifeCommerceStore {
  constructor(private readonly pool: Pool, private readonly options: {
    createId?: () => string
    now?: () => string
    getCatalogItemFrom: (executor: Executor, userId: string, itemId: string) => Promise<CatalogItem | undefined>
    listCatalogItemsFrom: (executor: Executor, userId: string) => Promise<CatalogItem[]>
    readMediaAsset: (executor: Executor, userId: string, mediaId: string) => Promise<{ asset: MediaAsset; bytes: Uint8Array } | undefined>
    restoreMediaAssetsFrom: (connection: PoolConnection, userId: string, mediaAssets: PortableMediaAsset[]) => Promise<{ commit(): Promise<void>; rollback(): Promise<void> }>
    listUnitsFrom: (executor: Executor, userId: string) => Promise<LifeUnit[]>
    updateCatalogItemFrom: (connection: PoolConnection, userId: string, itemId: string, input: UpdateCatalogItemInput) => Promise<CatalogItem | undefined>
    createInventoryTransactionFrom: (connection: PoolConnection, userId: string, input: CreateInventoryTransactionInput) => Promise<InventoryTransaction>
    listInventoryBalancesFrom: (executor: Executor, userId: string) => Promise<InventoryBalance[]>
    listUsableInventoryBalancesFrom: (executor: Executor, userId: string, asOf: string) => Promise<InventoryBalance[]>
    getPlanningTimeline: (userId: string, date: string) => Promise<PlanningTimeline>
    listDayPlanProjectionsFrom: (executor: Executor, userId: string, from: string, through: string) => Promise<DayPlanProjection[]>
    exportBusinessDataFrom: (executor: Executor, userId: string) => Promise<Record<string, unknown[]>>
    restoreCatalogItemsFrom: (connection: PoolConnection, userId: string, items: CatalogItem[]) => Promise<void>
  }) {}

  private createId = () => this.options.createId?.() ?? randomUUID()
  private now = () => this.options.now?.() ?? new Date().toISOString()

  async listInventoryPolicies(userId: string) {
    return this.listInventoryPoliciesFrom(this.pool, userId)
  }

  async upsertInventoryPolicy(userId: string, itemId: string, input: UpsertInventoryPolicyInput, key: string) {
    return this.idempotently(userId, `inventory-policy:${itemId}`, key, input, async (connection) => {
      const item = await this.requireItem(connection, userId, itemId)
      const units = await this.options.listUnitsFrom(connection, userId)
      const unitId = cleanText(input.unitId, 'unitId')
      const unit = units.find((candidate) => candidate.id === unitId && candidate.deletedAt == null)
      if (!unit) throw new LifeCommerceDomainError('NOT_FOUND', 'The inventory policy unit does not exist.', 404)
      const compatible = convertUnit({
        itemId: item.id, quantity: 1, fromUnit: unit.code, toBaseUnit: item.baseUnit,
        itemConversions: item.itemConversions, units: this.unitDefinitions(units),
      })
      if (compatible.status === 'incomplete') {
        throw new LifeCommerceDomainError('INCOMPATIBLE_POLICY_UNIT', 'The inventory policy unit is not compatible with the catalog item.', 409)
      }
      const currentRow = (await rows<SqlRow>(connection,
        'SELECT * FROM life_inventory_policies WHERE user_id=? AND item_id=? FOR UPDATE', [userId, item.id]))[0]
      const current = currentRow ? this.mapInventoryPolicy(currentRow) : undefined
      if (current && input.version == null) {
        throw new LifeCommerceDomainError('VERSION_REQUIRED', 'Updating an inventory policy requires its current version.', 409, { current })
      }
      if ((current && input.version !== current.version) || (!current && input.version != null)) {
        throw new LifeCommerceDomainError('VERSION_CONFLICT', 'The inventory policy changed before this request.', 409, { current: current ?? null })
      }
      const timestamp = this.now()
      const minimumStock = nonNegative(input.minimumStock, 'minimumStock')
      const packageQuantity = positive(input.packageQuantity, 'packageQuantity')
      const policy: InventoryPolicy = {
        id: current?.id ?? this.createId(), itemId: item.id, minimumStock, packageQuantity,
        unitId: unit.id, unit: unit.code, version: current ? current.version + 1 : 1,
        createdAt: current?.createdAt ?? timestamp, updatedAt: timestamp,
      }
      if (current) {
        await connection.execute(`UPDATE life_inventory_policies SET minimum_stock=?,package_quantity=?,unit_id=?,unit=?,
          entity_version=?,updated_at=? WHERE user_id=? AND id=?`, [
          policy.minimumStock, policy.packageQuantity, policy.unitId, policy.unit, policy.version,
          sqlDateTime(policy.updatedAt), userId, policy.id,
        ])
      } else {
        await connection.execute(`INSERT INTO life_inventory_policies
          (id,user_id,item_id,minimum_stock,package_quantity,unit_id,unit,entity_version,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,1,?,?)`, [
          policy.id, userId, policy.itemId, policy.minimumStock, policy.packageQuantity, policy.unitId,
          policy.unit, sqlDateTime(policy.createdAt), sqlDateTime(policy.updatedAt),
        ])
      }
      return { policy, created: !current }
    })
  }

  async recalculateShopping(userId: string, input: { through: string }, key: string): Promise<ShoppingRecalculationResult> {
    return this.idempotently(userId, 'shopping:recalculate', key, input, async (connection) => {
      const through = validDate(input.through, 'through')
      const today = this.now().slice(0, 10)
      if (through < today) throw new LifeCommerceDomainError('INVALID_RANGE', 'through cannot precede today.', 400)
      const [policies, catalog, units, projections, usableBalances, formalRows] = await Promise.all([
        this.listInventoryPoliciesFrom(connection, userId),
        this.options.listCatalogItemsFrom(connection, userId),
        this.options.listUnitsFrom(connection, userId),
        this.options.listDayPlanProjectionsFrom(connection, userId, today, through),
        this.options.listUsableInventoryBalancesFrom(connection, userId, today),
        rows<SqlRow>(connection, `SELECT * FROM life_shopping_items WHERE user_id=?
          AND status IN ('added','shopping','partial') ORDER BY created_at,id FOR UPDATE`, [userId]),
      ])
      const formalItems = formalRows.map((row) => this.mapShoppingItem(row))
      const existingRows = await rows<SqlRow>(connection,
        "SELECT * FROM life_shopping_suggestions WHERE user_id=? AND suggestion_origin='derived' FOR UPDATE", [userId])
      const existingReasons = await rows<SqlRow>(connection, `SELECT reason.* FROM life_shopping_suggestion_reasons reason
        INNER JOIN life_shopping_suggestions suggestion ON suggestion.user_id=reason.user_id AND suggestion.id=reason.suggestion_id
        WHERE reason.user_id=? AND suggestion.suggestion_origin='derived' ORDER BY reason.created_at,reason.id FOR UPDATE`, [userId])
      const existing = existingRows.map((row): ShoppingSuggestion => this.mapSuggestion(
        row, existingReasons.filter((reason) => String(reason.suggestion_id) === String(row.id)).map((reason) => this.mapReason(reason)),
        formalItems, usableBalances,
      ))
      const calculations: CompleteShoppingRecalculation[] = []
      const incomplete: IncompleteShoppingRecalculation[] = []
      const derived: ShoppingSuggestion[] = []
      for (const policy of policies) {
        const item = catalog.find((candidate) => candidate.id === policy.itemId && candidate.deletedAt == null)
        const policyUnit = units.find((candidate) => candidate.id === policy.unitId && candidate.deletedAt == null)
        if (!item || !policyUnit) {
          incomplete.push(this.incompletePolicy(policy, [{ sourceType: 'inventory-batches', sourceQuantity: null,
            sourceUnit: null, policyQuantity: null, conversionFactor: null }]))
          continue
        }
        const invalid: ShoppingQuantityEvidence[] = []
        const planned: ShoppingQuantityEvidence[] = []
        for (const projection of projections) {
          for (const projectedItem of projection.items.filter((candidate) => candidate.mode === 'planned')) {
            for (const demand of projectedItem.inventory.filter((candidate) => candidate.itemId === policy.itemId)) {
              if (demand.status === 'incomplete') {
                invalid.push({ sourceType: 'day-plan-item', sourceId: projectedItem.dayPlanItemId, date: projection.date,
                  sourceQuantity: null, sourceUnit: null, policyQuantity: null, conversionFactor: null })
                continue
              }
              const evidence = this.convertEvidence(item, units, { sourceType: 'day-plan-item',
                sourceId: projectedItem.dayPlanItemId, date: projection.date, quantity: demand.plannedDemand,
                unit: demand.baseUnit }, policyUnit.code)
              if (evidence.policyQuantity == null) invalid.push(evidence)
              else planned.push(evidence)
            }
          }
        }
        const balance = usableBalances.find((candidate) => candidate.itemId === policy.itemId)
        const stockEvidence = this.convertEvidence(item, units, { sourceType: 'inventory-batches',
          quantity: balance?.onHand ?? 0, unit: balance?.baseUnit ?? item.baseUnit }, policyUnit.code)
        if (stockEvidence.policyQuantity == null) invalid.push(stockEvidence)
        const outstanding: ShoppingQuantityEvidence[] = []
        for (const formal of formalItems.filter((candidate) => candidate.itemId === policy.itemId)) {
          const evidence = this.convertEvidence(item, units, { sourceType: 'shopping-item', sourceId: formal.id,
            quantity: formal.remainingQuantity, unit: formal.unit }, policyUnit.code)
          if (evidence.policyQuantity == null) invalid.push(evidence)
          else outstanding.push(evidence)
        }
        if (invalid.length) {
          incomplete.push(this.incompletePolicy(policy, invalid))
          continue
        }
        const plannedDemand = round(planned.reduce((total, value) => total + value.policyQuantity!, 0))
        const effectiveStock = stockEvidence.policyQuantity!
        const outstandingFormalQuantity = round(outstanding.reduce((total, value) => total + value.policyQuantity!, 0))
        const rawShortage = round(Math.max(0, plannedDemand + policy.minimumStock - effectiveStock - outstandingFormalQuantity))
        const suggestedQuantity = rawShortage > 0 ? round(Math.ceil(rawShortage / policy.packageQuantity) * policy.packageQuantity) : 0
        const calculation: CompleteShoppingRecalculation = {
          status: 'complete', itemId: policy.itemId, policyVersion: policy.version, unitId: policy.unitId,
          unit: policyUnit.code, plannedDemand, minimumStock: policy.minimumStock, effectiveStock,
          outstandingFormalQuantity, packageQuantity: policy.packageQuantity, rawShortage, suggestedQuantity,
          evidence: { planned, stock: [stockEvidence], outstanding },
        }
        calculations.push(calculation)
        if (suggestedQuantity > 0) derived.push(this.buildDerivedSuggestion(policy, calculation, through,
          existing.find((candidate) => candidate.itemId === policy.itemId)))
      }
      for (const policy of policies) {
        const suggestion = derived.find((candidate) => candidate.itemId === policy.itemId)
        const current = existingRows.find((row) => String(row.item_id) === policy.itemId)
        if (!suggestion) {
          if (current) await connection.execute("DELETE FROM life_shopping_suggestions WHERE user_id=? AND id=? AND suggestion_origin='derived'", [userId, current.id])
          continue
        }
        if (current) {
          await connection.execute(`UPDATE life_shopping_suggestions SET through_date=?,required_quantity=?,suggested_quantity=?,
            unit=?,package_quantity=?,updated_at=? WHERE user_id=? AND id=? AND suggestion_origin='derived'`, [
            suggestion.through, suggestion.requiredQuantity, suggestion.suggestedQuantity, suggestion.unit,
            suggestion.packageQuantity, sqlDateTime(suggestion.updatedAt), userId, suggestion.id,
          ])
          await connection.execute('DELETE FROM life_shopping_suggestion_reasons WHERE user_id=? AND suggestion_id=?', [userId, suggestion.id])
        } else {
          await connection.execute(`INSERT INTO life_shopping_suggestions
            (id,user_id,item_id,suggestion_origin,through_date,required_quantity,suggested_quantity,unit,package_quantity,created_at,updated_at)
            VALUES (?,?,?,'derived',?,?,?,?,?,?,?)`, [suggestion.id, userId, suggestion.itemId, suggestion.through,
            suggestion.requiredQuantity, suggestion.suggestedQuantity, suggestion.unit, suggestion.packageQuantity,
            sqlDateTime(suggestion.createdAt), sqlDateTime(suggestion.updatedAt)])
        }
        for (const reason of suggestion.reasons) await connection.execute(`INSERT INTO life_shopping_suggestion_reasons
          (id,user_id,suggestion_id,reason_kind,source_type,source_id,required_quantity,source_quantity,source_unit,conversion_factor,required_on,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [reason.id, userId, suggestion.id, reason.kind, reason.sourceType,
          reason.sourceId, reason.requiredQuantity, reason.sourceQuantity, reason.sourceUnit, reason.conversionFactor,
          reason.requiredOn, sqlDateTime(reason.createdAt)])
      }
      return { through, calculations, incomplete, suggestions: derived }
    })
  }

  async createShoppingSuggestion(userId: string, input: CreateShoppingSuggestionInput, key: string) {
    return this.idempotently(userId, 'shopping:suggestion', key, input, async (connection) => {
      validateShoppingReasonSource(input.reason)
      if (input.reason.kind !== 'manual' || input.reason.sourceType !== 'manual') {
        throw new LifeCommerceDomainError('DERIVED_SHOPPING_FACTS_SERVER_OWNED', 'Derived shopping facts can only be created by server recalculation.', 400)
      }
      await this.requireItem(connection, userId, input.itemId)
      const timestamp = this.now()
      const unit = cleanText(input.unit, 'unit').toLocaleLowerCase()
      positive(input.requiredQuantity, 'requiredQuantity')
      positive(input.packageQuantity, 'packageQuantity')
      const current = (await rows<SqlRow>(connection, "SELECT * FROM life_shopping_suggestions WHERE user_id = ? AND item_id = ? AND suggestion_origin='manual' FOR UPDATE", [userId, input.itemId]))[0]
      let suggestionId: string
      if (!current) {
        suggestionId = this.createId()
        await connection.execute(`INSERT INTO life_shopping_suggestions
          (id,user_id,item_id,suggestion_origin,through_date,required_quantity,suggested_quantity,unit,package_quantity,created_at,updated_at)
          VALUES (?,?,?,'manual',NULL,?,?,?,?,?,?)`,
        [suggestionId, userId, input.itemId, input.requiredQuantity, input.requiredQuantity, unit, input.packageQuantity, sqlDateTime(timestamp), sqlDateTime(timestamp)])
      } else {
        suggestionId = String(current.id)
        if (String(current.unit) !== unit || Number(current.package_quantity) !== input.packageQuantity) {
          throw new LifeCommerceDomainError('SUGGESTION_FACT_CONFLICT', 'Suggestion facts for one item must use one unit and package quantity.', 409)
        }
      }
      const reasonId = this.createId()
      const sourceId = cleanText(input.reason.sourceId, 'reason.sourceId')
      const requiredOn = input.reason.requiredOn == null ? null : validDate(input.reason.requiredOn, 'reason.requiredOn')
      await connection.execute(`INSERT IGNORE INTO life_shopping_suggestion_reasons
        (id,user_id,suggestion_id,reason_kind,source_type,source_id,required_quantity,source_quantity,source_unit,conversion_factor,required_on,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [reasonId, userId, suggestionId, input.reason.kind, input.reason.sourceType,
        sourceId, input.requiredQuantity, input.requiredQuantity, unit, 1, requiredOn, sqlDateTime(timestamp)])
      const reason = (await rows<SqlRow>(connection, `SELECT * FROM life_shopping_suggestion_reasons
        WHERE user_id=? AND suggestion_id=? AND source_type=? AND source_id=? FOR UPDATE`, [userId, suggestionId, input.reason.sourceType, sourceId]))[0]!
      if (String(reason.reason_kind) !== input.reason.kind || Number(reason.required_quantity) !== input.requiredQuantity || dateOnly(reason.required_on) !== requiredOn) {
        throw new LifeCommerceDomainError('SUGGESTION_REASON_CONFLICT', 'A suggestion source cannot be reused with different facts.', 409)
      }
      const [sum] = await rows<SqlRow>(connection, 'SELECT SUM(required_quantity) total FROM life_shopping_suggestion_reasons WHERE user_id=? AND suggestion_id=?', [userId, suggestionId])
      await connection.execute('UPDATE life_shopping_suggestions SET required_quantity=?,updated_at=? WHERE user_id=? AND id=?', [Number(sum?.total ?? 0), sqlDateTime(timestamp), userId, suggestionId])
      return (await this.listShoppingFrom(connection, userId)).suggestions.find((entry) => entry.id === suggestionId)!
    })
  }

  async listShopping(userId: string) { return this.listShoppingFrom(this.pool, userId) }

  async createShoppingItem(userId: string, input: CreateShoppingItemInput, key: string) {
    return this.idempotently(userId, 'shopping:item', key, input, async (connection) => {
      await this.requireItem(connection, userId, input.itemId)
      const timestamp = this.now()
      const item: ShoppingItem = {
        id: this.createId(), kind: 'formal', itemId: cleanText(input.itemId, 'itemId'),
        requestedQuantity: positive(input.requestedQuantity, 'requestedQuantity'), purchasedQuantity: 0,
        remainingQuantity: input.requestedQuantity, unit: cleanText(input.unit, 'unit').toLocaleLowerCase(),
        neededOn: input.neededOn == null ? null : validDate(input.neededOn, 'neededOn'), priority: input.priority ?? 'normal',
        storeGroup: cleanText(input.storeGroup ?? '', 'storeGroup', true), status: 'added', version: 1,
        createdAt: timestamp, updatedAt: timestamp,
      }
      await connection.execute(`INSERT INTO life_shopping_items
        (id,user_id,item_id,requested_quantity,purchased_quantity,unit,needed_on,priority,store_group,status,entity_version,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)`, [item.id,userId,item.itemId,item.requestedQuantity,0,item.unit,item.neededOn,item.priority,item.storeGroup,item.status,sqlDateTime(timestamp),sqlDateTime(timestamp)])
      return item
    })
  }

  async createPurchase(userId: string, input: CreatePurchaseInput, key: string) {
    return this.idempotently(userId, 'purchase:create', key, input, async (connection) => {
      if (!input.items.length) throw new LifeCommerceDomainError('INVALID_INPUT', 'A purchase must contain at least one item.', 400)
      const purchasedAt = validTimestamp(input.purchasedAt, 'purchasedAt')
      const currency = cleanText(input.currency, 'currency').toUpperCase()
      const timestamp = this.now()
      const purchase: Purchase = { id: this.createId(), purchasedAt, currency, storeName: cleanText(input.storeName ?? '', 'storeName', true), totalAmountMinor: input.items.reduce((total, item) => total + nonNegative(item.amountMinor, 'amountMinor'), 0), createdAt: timestamp }
      await connection.execute('INSERT INTO life_purchases (id,user_id,purchased_at,currency,store_name,total_amount_minor,created_at) VALUES (?,?,?,?,?,?,?)', [purchase.id,userId,sqlDateTime(purchasedAt),currency,purchase.storeName,purchase.totalAmountMinor,sqlDateTime(timestamp)])
      const units = await this.options.listUnitsFrom(connection, userId)
      const items: PurchaseItem[] = [], inventoryTransactions: InventoryTransaction[] = [], shoppingItems: ShoppingItem[] = []
      const used = new Set<string>()
      for (const inputItem of input.items) {
        const catalog = await this.requireItem(connection, userId, inputItem.itemId)
        positive(inputItem.quantity, 'quantity')
        let formal: SqlRow | undefined
        let formalQuantity = inputItem.quantity
        if (inputItem.shoppingItemId) {
          if (used.has(inputItem.shoppingItemId)) throw new LifeCommerceDomainError('INVALID_INPUT', 'A formal item can appear only once per purchase.', 400)
          used.add(inputItem.shoppingItemId)
          formal = (await rows<SqlRow>(connection, 'SELECT * FROM life_shopping_items WHERE user_id=? AND id=? FOR UPDATE', [userId,inputItem.shoppingItemId]))[0]
          if (!formal || String(formal.item_id) !== inputItem.itemId) throw new LifeCommerceDomainError('NOT_FOUND', 'The formal shopping item does not exist.', 404)
          const convertedFormal = convertUnit({ quantity: inputItem.quantity, fromUnit: inputItem.unit, toBaseUnit: String(formal.unit), itemId: catalog.id, itemConversions: catalog.itemConversions, units })
          if (convertedFormal.status === 'incomplete') throw new LifeCommerceDomainError('MISSING_CONVERSION', 'Purchase unit cannot be converted to the formal shopping unit.', 409)
          formalQuantity = convertedFormal.baseQuantity
          if (formalQuantity > Number(formal.requested_quantity) - Number(formal.purchased_quantity)) throw new LifeCommerceDomainError('PURCHASE_EXCEEDS_REMAINDER', 'Purchase quantity exceeds the formal item remainder.', 409)
        }
        const converted = convertUnit({ quantity: inputItem.quantity, fromUnit: inputItem.unit, toBaseUnit: catalog.baseUnit, itemId: catalog.id, itemConversions: catalog.itemConversions, units })
        if (converted.status === 'incomplete') throw new LifeCommerceDomainError('MISSING_CONVERSION', 'Purchase unit cannot be converted to the catalog base unit.', 409)
        const unitCost = round(inputItem.amountMinor / converted.baseQuantity)
        const inventory = await this.options.createInventoryTransactionFrom(connection, userId, {
          itemId: inputItem.itemId, kind: 'purchase', quantity: inputItem.quantity, unit: inputItem.unit, occurredAt: purchasedAt,
          batch: { purchasedOn: purchasedAt.slice(0,10), expiresOn: inputItem.expiresOn ?? null, locationId: inputItem.locationId ?? null, actualUnitCostMinor: unitCost }, note: `Purchase ${purchase.id}`,
        })
        inventoryTransactions.push(inventory)
        const item: PurchaseItem = { ...clone(inputItem), id: this.createId(), purchaseId: purchase.id, shoppingItemId: inputItem.shoppingItemId ?? null, updateCurrentPrice: inputItem.updateCurrentPrice ?? false, inventoryTransactionId: inventory.id }
        await connection.execute(`INSERT INTO life_purchase_items
          (id,user_id,purchase_id,shopping_item_id,item_id,quantity,unit,amount_minor,update_current_price,inventory_transaction_id,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [item.id,userId,purchase.id,item.shoppingItemId,item.itemId,item.quantity,item.unit,item.amountMinor,item.updateCurrentPrice,inventory.id,sqlDateTime(timestamp)])
        items.push(item)
        if (item.updateCurrentPrice) await this.options.updateCatalogItemFrom(connection, userId, catalog.id, { version: catalog.version, pricePoints: [{ amountMinor: item.amountMinor, currency, purchaseQuantity: item.quantity, purchaseUnit: item.unit, effectiveFrom: purchasedAt.slice(0,10) }] })
        if (formal) {
          const purchased = round(Number(formal.purchased_quantity) + formalQuantity)
          const remaining = round(Number(formal.requested_quantity) - purchased)
          const status = remaining === 0 ? 'purchased' : 'partial'
          await connection.execute('UPDATE life_shopping_items SET purchased_quantity=?,status=?,entity_version=entity_version+1,updated_at=? WHERE user_id=? AND id=?', [purchased,status,sqlDateTime(timestamp),userId,formal.id])
          shoppingItems.push(this.mapShoppingItem({ ...formal, purchased_quantity: purchased, status, entity_version: Number(formal.entity_version)+1, updated_at: sqlDateTime(timestamp) }))
        }
      }
      const cash: CashExpenditure = { id:this.createId(),amountMinor:purchase.totalAmountMinor,currency,occurredAt:purchasedAt,sourceType:'purchase',sourceId:purchase.id,createdAt:timestamp }
      await connection.execute(`INSERT INTO life_cash_expenditures
        (id,user_id,amount_minor,currency,occurred_at,source_type,purchase_id,refund_id,created_at) VALUES (?,?,?,?,?,'purchase',?,NULL,?)`, [cash.id,userId,cash.amountMinor,currency,sqlDateTime(purchasedAt),purchase.id,sqlDateTime(timestamp)])
      return { purchase, items, cashExpenditure: cash, inventoryTransactions, shoppingItems }
    })
  }

  async createRefund(userId: string, purchaseId: string, input: CreateRefundInput, key: string) {
    const exists = await rows<SqlRow>(this.pool, 'SELECT id FROM life_purchases WHERE user_id=? AND id=?', [userId,purchaseId])
    if (!exists[0]) return undefined
    return this.idempotently(userId, `refund:${purchaseId}`, key, input, async (connection) => {
      const purchaseRow = (await rows<SqlRow>(connection, 'SELECT * FROM life_purchases WHERE user_id=? AND id=? FOR UPDATE', [userId,purchaseId]))[0]
      if (!purchaseRow) throw new LifeCommerceDomainError('NOT_FOUND', 'The purchase does not exist.', 404)
      const refundedAt = validTimestamp(input.refundedAt, 'refundedAt'), timestamp = this.now()
      const refund: Refund = { id:this.createId(),purchaseId,refundedAt,totalAmountMinor:input.items.reduce((total,item)=>total+nonNegative(item.amountMinor,'amountMinor'),0),note:cleanText(input.note??'','note',true),createdAt:timestamp }
      await connection.execute('INSERT INTO life_refunds (id,user_id,purchase_id,refunded_at,total_amount_minor,note,created_at) VALUES (?,?,?,?,?,?,?)', [refund.id,userId,purchaseId,sqlDateTime(refundedAt),refund.totalAmountMinor,refund.note,sqlDateTime(timestamp)])
      const items: RefundItem[] = [], inventoryTransactions: InventoryTransaction[] = []
      const usedPurchaseItems = new Set<string>()
      for (const inputItem of input.items) {
        if (usedPurchaseItems.has(inputItem.purchaseItemId)) throw new LifeCommerceDomainError('INVALID_INPUT','A purchase item can appear only once per refund.',400)
        usedPurchaseItems.add(inputItem.purchaseItemId)
        const original = (await rows<SqlRow>(connection, 'SELECT * FROM life_purchase_items WHERE user_id=? AND id=? AND purchase_id=? FOR UPDATE', [userId,inputItem.purchaseItemId,purchaseId]))[0]
        if (!original) throw new LifeCommerceDomainError('NOT_FOUND', 'The purchase item does not exist.', 404)
        const [sum] = await rows<SqlRow>(connection, 'SELECT COALESCE(SUM(quantity),0) total FROM life_refund_items WHERE user_id=? AND purchase_item_id=?', [userId,inputItem.purchaseItemId])
        if (positive(inputItem.quantity,'quantity') + Number(sum?.total??0) > Number(original.quantity)) throw new LifeCommerceDomainError('REFUND_EXCEEDS_PURCHASE','Refund quantity exceeds the purchased quantity.',409)
        const inventory = await this.options.createInventoryTransactionFrom(connection,userId,{ itemId:String(original.item_id),kind:'return',quantity:inputItem.quantity,unit:String(original.unit),occurredAt:refundedAt,note:`Refund ${refund.id} for purchase ${purchaseId}` })
        inventoryTransactions.push(inventory)
        const item: RefundItem = { ...clone(inputItem),id:this.createId(),refundId:refund.id,purchaseId,itemId:String(original.item_id),inventoryTransactionId:inventory.id }
        await connection.execute(`INSERT INTO life_refund_items
          (id,user_id,refund_id,purchase_id,purchase_item_id,item_id,quantity,amount_minor,inventory_transaction_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`, [item.id,userId,refund.id,purchaseId,item.purchaseItemId,item.itemId,item.quantity,item.amountMinor,item.inventoryTransactionId,sqlDateTime(timestamp)])
        items.push(item)
      }
      const cash: CashExpenditure = { id:this.createId(),amountMinor:-refund.totalAmountMinor,currency:String(purchaseRow.currency),occurredAt:refundedAt,sourceType:'refund',sourceId:refund.id,createdAt:timestamp }
      await connection.execute(`INSERT INTO life_cash_expenditures
        (id,user_id,amount_minor,currency,occurred_at,source_type,purchase_id,refund_id,created_at) VALUES (?,?,?,?,?,'refund',NULL,?,?)`, [cash.id,userId,cash.amountMinor,cash.currency,sqlDateTime(refundedAt),refund.id,sqlDateTime(timestamp)])
      return { refund,items,cashExpenditure:cash,inventoryTransactions }
    })
  }

  async createBudget(userId:string,input:CreateBudgetInput,key:string){return this.idempotently(userId,'budget:create',key,input,async connection=>{validateBudgetInput(input);await this.validateBudgetReferences(connection,userId,input);const timestamp=this.now();const budget:Budget={...clone(input),id:this.createId(),name:cleanText(input.name,'name'),rolloverMinor:input.rolloverMinor??0,version:1,createdAt:timestamp,updatedAt:timestamp};await connection.execute(`INSERT INTO life_budgets
    (id,user_id,name,scope_json,period_kind,starts_on,ends_on,limit_minor,thresholds_json,rollover_minor,entity_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)`,[budget.id,userId,budget.name,JSON.stringify(budget.scope),budget.period.kind,budget.period.startsOn,budget.period.endsOn,budget.limitMinor,JSON.stringify(budget.thresholds),budget.rolloverMinor,sqlDateTime(timestamp),sqlDateTime(timestamp)]);return budget})}

  private async validateBudgetReferences(connection:PoolConnection,userId:string,input:CreateBudgetInput){
    if(input.scope.kind==='all-life')return
    const itemIds=input.scope.kind==='category'?[]:input.scope.itemIds
    const categoryIds=input.scope.kind==='item'?[]:input.scope.categoryIds
    const foundItems=itemIds.length?await rows<SqlRow>(connection,`SELECT id FROM life_items WHERE user_id=? AND deleted_at IS NULL AND id IN (${itemIds.map(()=>'?').join(',')})`,[userId,...itemIds]):[]
    const foundCategories=categoryIds.length?await rows<SqlRow>(connection,`SELECT id FROM life_categories WHERE user_id=? AND deleted_at IS NULL AND id IN (${categoryIds.map(()=>'?').join(',')})`,[userId,...categoryIds]):[]
    if(foundItems.length!==itemIds.length||foundCategories.length!==categoryIds.length)throw new LifeCommerceDomainError('NOT_FOUND','A budget scope reference does not exist for this owner.',404)
  }

  async listBudgetSummaries(userId:string,asOf:string){
    const budgets=(await rows<SqlRow>(this.pool,'SELECT * FROM life_budgets WHERE user_id=? ORDER BY created_at,id',[userId])).map(row=>this.mapBudget(row))
    const cash=await this.cashRows(this.pool,userId)
    const catalog=await this.options.listCatalogItemsFrom(this.pool,userId)
    const purchaseItems=await rows<SqlRow>(this.pool,'SELECT purchase_id,item_id,amount_minor FROM life_purchase_items WHERE user_id=?',[userId])
    const refundItems=await rows<SqlRow>(this.pool,'SELECT refund_id,item_id,amount_minor FROM life_refund_items WHERE user_id=?',[userId])
    const scopedCash=(budget:Budget)=>cash.flatMap((entry)=>{
      if(budget.scope.kind==='all-life')return[entry]
      const lines=entry.sourceType==='purchase'
        ?purchaseItems.filter((item)=>String(item.purchase_id)===entry.sourceId)
        :refundItems.filter((item)=>String(item.refund_id)===entry.sourceId)
      const amountMinor=lines.filter((line)=>budgetScopeMatchesItemIds(budget.scope,[String(line.item_id)],catalog))
        .reduce((total,line)=>total+(entry.sourceType==='purchase'?Number(line.amount_minor):-Number(line.amount_minor)),0)
      return amountMinor===0?[]:[{...entry,amountMinor}]
    })
    return budgets.map((budget)=>summarizeBudget(budget,scopedCash(budget),asOf))
  }

  async getLifeAnalytics(userId:string,from:string,to:string):Promise<LifeAnalytics>{const dates=datesBetween(from,to);const cash=(await this.cashRows(this.pool,userId)).filter(entry=>entry.occurredAt.slice(0,10)>=from&&entry.occurredAt.slice(0,10)<=to);const completionRows=await rows<SqlRow>(this.pool,`SELECT snapshot.id,snapshot.cost_minor,snapshot.completed_at FROM life_completion_snapshots snapshot
    LEFT JOIN life_completion_reversals reversal ON reversal.user_id=snapshot.user_id AND reversal.completion_id=snapshot.id
    WHERE snapshot.user_id=? AND snapshot.completed_at>=? AND snapshot.completed_at<? AND snapshot.cost_minor IS NOT NULL AND reversal.id IS NULL ORDER BY snapshot.completed_at,snapshot.id`,[userId,`${from} 00:00:00.000`,`${new Date(Date.parse(`${to}T00:00:00.000Z`)+86400000).toISOString().slice(0,10)} 00:00:00.000`]);const cashFacts=cash.map(entry=>({sourceType:entry.sourceType,sourceId:entry.sourceId,amountMinor:entry.amountMinor,occurredAt:entry.occurredAt}));const costFacts=completionRows.map(row=>({sourceType:'completion' as const,sourceId:String(row.id),amountMinor:Number(row.cost_minor),occurredAt:iso(row.completed_at)}));const timelines=await Promise.all(dates.map(date=>this.options.getPlanningTimeline(userId,date)));return{from,to,days:dates.map(date=>{const dayCash=cashFacts.filter(entry=>entry.occurredAt.slice(0,10)===date),dayCost=costFacts.filter(entry=>entry.occurredAt.slice(0,10)===date),timeline=timelines.find(entry=>entry.date===date)?.timelineItems??[],actualCount=timeline.filter(entry=>entry.status==='completed').length,incompleteCount=timeline.filter(entry=>!['completed','skipped','cancelled'].includes(entry.status)).length;return{date,cashExpenditure:dayCash.length?{status:'recorded' as const,valueMinor:dayCash.reduce((sum,entry)=>sum+entry.amountMinor,0),sourceIds:dayCash.map(entry=>entry.sourceId)}:{status:'no-record' as const},consumptionCost:dayCost.length?{status:'recorded' as const,valueMinor:dayCost.reduce((sum,entry)=>sum+entry.amountMinor,0),sourceIds:dayCost.map(entry=>entry.sourceId)}:{status:'no-record' as const},planExecution:timeline.length?{status:'recorded' as const,plannedCount:timeline.length,actualCount,incompleteCount,sourceIds:timeline.map(entry=>entry.id)}:{status:'no-record' as const}}}),totals:{cashExpenditureMinor:cashFacts.reduce((sum,entry)=>sum+entry.amountMinor,0),consumptionCostMinor:costFacts.reduce((sum,entry)=>sum+entry.amountMinor,0),plannedCount:timelines.reduce((sum,entry)=>sum+entry.timelineItems.length,0),actualCount:timelines.reduce((sum,entry)=>sum+entry.timelineItems.filter(item=>item.status==='completed').length,0),incompleteCount:timelines.reduce((sum,entry)=>sum+entry.timelineItems.filter(item=>!['completed','skipped','cancelled'].includes(item.status)).length,0)},drillDown:{cashExpenditure:cashFacts,consumptionCost:costFacts}}}

  async createLifeExport(userId:string,input:{format:'json'|'zip';includeAttachments:boolean},key:string,reason:'user-export'|'pre-import-restore-point'='user-export'){return this.idempotently(userId,`export:${reason}`,key,input,connection=>this.createExportFrom(connection,userId,input,reason))}
  async listLifeExports(userId:string){return Promise.all((await rows<SqlRow>(this.pool,'SELECT * FROM life_exports WHERE user_id=? ORDER BY created_at DESC,id',[userId])).map(row=>this.mapExport(row)))}

  async previewLifeImport(userId:string,input:PreviewLifeImportInput,key:string){return this.idempotently(userId,'import:preview',key,input,async connection=>{if(input.formatVersion!==1)throw new LifeCommerceDomainError('IMPORT_VERSION_UNSUPPORTED','Only LifeOps portable format version 1 is supported.',409);if((input.canonicalJson==null)===(input.archiveBase64==null))throw new LifeCommerceDomainError('INVALID_IMPORT','Provide exactly one JSON payload or ZIP archive.',400);let canonicalJson:string;if(input.archiveBase64!=null){const archive=Buffer.from(input.archiveBase64,'base64');if(checksumSha256(archive)!==input.checksumSha256.toLowerCase())throw new LifeCommerceDomainError('IMPORT_CHECKSUM_MISMATCH','Import checksum does not match its ZIP archive.',400);canonicalJson=portableJsonFromArchive(archive,input.formatVersion)}else{canonicalJson=input.canonicalJson!;if(checksumSha256(canonicalJson)!==input.checksumSha256.toLowerCase())throw new LifeCommerceDomainError('IMPORT_CHECKSUM_MISMATCH','Import checksum does not match its payload.',400)}let parsed:unknown;try{parsed=JSON.parse(canonicalJson)}catch{throw new LifeCommerceDomainError('INVALID_IMPORT','Import payload is not valid JSON.',400)}const payload=validatePortablePayload(parsed),current=await this.options.listCatalogItemsFrom(connection,userId);const conflicts:ImportConflict[]=payload.catalogItems.flatMap(raw=>{const incoming=raw as {id?:unknown;version?:unknown},found=current.find(item=>item.id===incoming.id);return found?[{entityType:'catalog-item',entityId:found.id,currentVersion:found.version,incomingVersion:typeof incoming.version==='number'?incoming.version:0,resolutions:['keep-current','use-imported','duplicate']}]:[]});const errors:ImportValidationError[]=[...validatePortablePayloadRelationships(payload,input.mode),...payload.budgets.flatMap(raw=>{try{validateBudgetInput(raw);return[]}catch(error){return[{entityType:'budget',entityId:raw.id,code:error instanceof LifeCommerceDomainError?error.code:'INVALID_INPUT',message:error instanceof Error?error.message:'Invalid budget row.'}]}})];const timestamp=this.now();const preview:ImportPreview={id:this.createId(),mode:input.mode,status:errors.length?'invalid':conflicts.length?'conflicts':'ready',payload,conflicts,errors,createdAt:timestamp};await connection.execute(`INSERT INTO life_imports
    (id,user_id,import_mode,format_version,checksum_sha256,canonical_json,payload_json,conflicts_json,errors_json,status,restore_point_export_id,applied_rows,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,NULL,0,?,?)`,[preview.id,userId,preview.mode,1,input.checksumSha256.toLowerCase(),canonicalJson,JSON.stringify(payload),JSON.stringify(conflicts),JSON.stringify(errors),preview.status,sqlDateTime(timestamp),sqlDateTime(timestamp)]);return preview})}

  async applyLifeImport(
    userId:string,
    importId:string,
    resolutions:ImportResolution[],
    key:string,
  ):Promise<ImportApplyResult|undefined>{
    const existing=(await rows<SqlRow>(this.pool,
      'SELECT conflicts_json,status,restore_point_export_id,applied_rows FROM life_imports WHERE user_id=? AND id=?',
      [userId,importId],
    ))[0]
    if(!existing)return undefined
    if(String(existing.status)==='applied')return{
      status:'applied',importId,restorePointExportId:String(existing.restore_point_export_id),appliedRows:Number(existing.applied_rows),
    }

    const existingConflicts=json<ImportConflict[]>(existing.conflicts_json,[])
    const hasUnresolvedConflict=existingConflicts.some((conflict)=>!resolutions.some((resolution)=>(
      resolution.entityType===conflict.entityType&&resolution.entityId===conflict.entityId
    )))
    if(!hasUnresolvedConflict)await this.ensureImportRestorePoint(userId,importId)

    let mediaRestore:{commit():Promise<void>;rollback():Promise<void>}|undefined
    try{
      const result=await this.idempotently<ImportApplyResult>(userId,`import:apply:${importId}`,key,resolutions,async connection=>{
      const row=(await rows<SqlRow>(connection,
        'SELECT * FROM life_imports WHERE user_id=? AND id=? FOR UPDATE',
        [userId,importId],
      ))[0]!
      const conflicts=json<ImportConflict[]>(row.conflicts_json,[])
      const errors=json<ImportValidationError[]>(row.errors_json,[])
      if(conflicts.some((conflict)=>!resolutions.some((resolution)=>(
        resolution.entityType===conflict.entityType&&resolution.entityId===conflict.entityId
      )))){
        return{
          status:'rejected',
          code:'IMPORT_CONFLICTS_UNRESOLVED',
          message:'Every import conflict requires an explicit resolution.',
          appliedRows:0,
        }
      }

      if(row.restore_point_export_id==null){
        throw new LifeCommerceDomainError(
          'IMPORT_RESTORE_POINT_MISSING',
          'The import restore point was not persisted before applying rows.',
          409,
        )
      }
      const restorePointExportId=String(row.restore_point_export_id)
      if(errors.length){
        return{
          status:'rejected',
          code:'IMPORT_VALIDATION_FAILED',
          message:'Import validation failed; no rows were applied.',
          restorePointExportId,
          appliedRows:0,
        }
      }

      const payload=validatePortablePayload(json(row.payload_json,{}))
      const currentCatalog=await this.options.listCatalogItemsFrom(connection,userId)
      const resolvedPayload=this.resolveCatalogConflicts(payload,currentCatalog,conflicts,resolutions)
      if(String(row.import_mode)==='replace'){
        if(resolvedPayload.mediaAssets?.length)mediaRestore=await this.options.restoreMediaAssetsFrom(connection,userId,resolvedPayload.mediaAssets)
        await this.replacePortableBusinessRowsFrom(connection,userId,resolvedPayload)
        await this.restoreCommerceRowsFrom(connection,userId,resolvedPayload)
      }
      if(String(row.import_mode)!=='replace'){
        await this.options.restoreCatalogItemsFrom(connection,userId,resolvedPayload.catalogItems as CatalogItem[])
      }
      if(String(row.import_mode)!=='replace')for(const budget of resolvedPayload.budgets){
        validateBudgetInput(budget)
        await connection.execute(`INSERT INTO life_budgets
          (id,user_id,name,scope_json,period_kind,starts_on,ends_on,limit_minor,thresholds_json,rollover_minor,entity_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
          budget.id,userId,budget.name,JSON.stringify(budget.scope),budget.period.kind,
          budget.period.startsOn,budget.period.endsOn,budget.limitMinor,JSON.stringify(budget.thresholds),
          budget.rolloverMinor,budget.version,sqlDateTime(budget.createdAt),sqlDateTime(budget.updatedAt),
        ])
      }
      if(String(row.import_mode)==='replace'){
        const verified=await this.buildPayload(connection,userId,true)
        const mismatchedCollections=Object.entries(verified).filter(([name,value])=>Array.isArray(value)&&(
          portableSemanticJson(value)!==portableSemanticJson(Array.isArray(resolvedPayload[name])?resolvedPayload[name]:[])
        )).map(([name])=>name)
        if(mismatchedCollections.length)throw new LifeCommerceDomainError(
          'IMPORT_POST_VERIFY_FAILED',`Imported business data did not reproduce: ${mismatchedCollections.join(', ')}.`,409,{mismatchedCollections},
        )
      }
      let appliedRows=payload.budgets.length
      if(String(row.import_mode)==='replace'){
        appliedRows=0
        for(const value of Object.values(payload))if(Array.isArray(value))appliedRows+=value.length
      }
      await connection.execute(
        "UPDATE life_imports SET status='applied',applied_rows=?,updated_at=? WHERE user_id=? AND id=?",
        [appliedRows,sqlDateTime(this.now()),userId,importId],
      )
      return{status:'applied',importId,restorePointExportId,appliedRows}
      })
      await mediaRestore?.commit()
      return result
    }catch(error){
      await mediaRestore?.rollback()
      throw error
    }
  }

  async replaceOwnerPortableDataFrom(connection: PoolConnection, userId: string, rawPayload: Record<string, unknown>) {
    const payload = validatePortablePayload(rawPayload)
    if (payload.mediaAssets?.length) {
      throw new LifeCommerceDomainError('INVALID_IMPORT', 'Full JSON transfer does not carry attachment bytes.', 409)
    }
    await this.replacePortableBusinessRowsFrom(connection, userId, payload)
    await this.restoreCommerceRowsFrom(connection, userId, payload)
    const verified = await this.buildPayload(connection, userId, false)
    const mismatchedCollections = Object.entries(verified).filter(([name, value]) => Array.isArray(value) && (
      portableSemanticJson(value) !== portableSemanticJson(Array.isArray(payload[name]) ? payload[name] : [])
    )).map(([name]) => name)
    if (mismatchedCollections.length) throw new LifeCommerceDomainError(
      'IMPORT_POST_VERIFY_FAILED', `Imported business data did not reproduce: ${mismatchedCollections.join(', ')}.`, 409, { mismatchedCollections },
    )
  }

  private resolveCatalogConflicts(payload:PortablePayload,current:CatalogItem[],conflicts:ImportConflict[],resolutions:ImportResolution[]):PortablePayload{
    const resolutionFor=(id:string)=>resolutions.find((entry)=>entry.entityType==='catalog-item'&&entry.entityId===id)?.resolution
    const catalogItems=payload.catalogItems.map((raw)=>{
      const incoming=clone(raw as CatalogItem)
      if(!conflicts.some((conflict)=>conflict.entityType==='catalog-item'&&conflict.entityId===incoming.id))return incoming
      const resolution=resolutionFor(incoming.id)
      if(resolution==='keep-current')return clone(current.find((item)=>item.id===incoming.id)!)
      if(resolution==='duplicate'){
        const id=this.createId()
        return{...incoming,id,itemConversions:incoming.itemConversions.map((conversion)=>({...conversion,itemId:id})),pricePoints:incoming.pricePoints.map((point)=>({...point,id:this.createId()}))}
      }
      return incoming
    })
    return{...clone(payload),catalogItems}
  }

  private async ensureImportRestorePoint(userId:string,importId:string):Promise<string|undefined>{
    const connection=await this.pool.getConnection()
    try{
      await connection.beginTransaction()
      const row=(await rows<SqlRow>(connection,
        'SELECT restore_point_export_id FROM life_imports WHERE user_id=? AND id=? FOR UPDATE',
        [userId,importId],
      ))[0]
      if(!row){
        await connection.rollback()
        return undefined
      }
      if(row.restore_point_export_id!=null){
        await connection.commit()
        return String(row.restore_point_export_id)
      }
      const restore=await this.createExportFrom(
        connection,userId,{format:'json',includeAttachments:false},'pre-import-restore-point',
      )
      await connection.execute(
        'UPDATE life_imports SET restore_point_export_id=?,updated_at=? WHERE user_id=? AND id=?',
        [restore.id,sqlDateTime(this.now()),userId,importId],
      )
      await connection.commit()
      return restore.id
    }catch(error){
      await connection.rollback()
      throw error
    }finally{
      connection.release()
    }
  }

  private async replacePortableBusinessRowsFrom(connection:PoolConnection,userId:string,payload:PortablePayload){
    await connection.query('SET @lifeops_restore_mode = 1')
    try{
      for(const table of [
        'life_cash_expenditures','life_refund_items','life_refunds','life_purchase_items','life_purchases',
        'life_shopping_suggestion_reasons','life_shopping_suggestions','life_shopping_items','life_budgets','life_inventory_policies',
      ])await connection.execute(`DELETE FROM ${table} WHERE user_id=?`,[userId])
      await connection.execute("UPDATE life_medicine_recurrence_occurrences SET status='planned',completion_id=NULL,entity_version=entity_version+1,updated_at=GREATEST(updated_at,NOW(3)) WHERE user_id=? AND completion_id IS NOT NULL",[userId])
      for(const table of [
        'life_completion_reversals','life_completion_prepared_food_events','life_completion_inventory_events','life_completion_snapshots',
        'life_template_applications','life_medicine_recurrence_occurrences','life_medicine_recurrence_rules','life_day_plans','life_plan_templates','fitness_activities',
        'life_prepared_food_stock','life_cooking_snapshots','life_cooking_sessions','life_recipe_steps','life_recipe_components',
      ])await connection.execute(`DELETE FROM ${table} WHERE user_id=?`,[userId])
      await connection.execute('UPDATE life_recipes SET current_version_id=NULL WHERE user_id=?',[userId])
      for(const table of ['life_recipe_versions','life_recipes','life_inventory_allocations','life_inventory_transactions','life_inventory_batches']){
        await connection.execute(`DELETE FROM ${table} WHERE user_id=?`,[userId])
      }
      for(const table of ['life_trash_references','life_item_attachments','life_item_tags','life_item_unit_conversions','life_price_history','life_item_profiles','life_items']){
        await connection.execute(`DELETE FROM ${table} WHERE user_id=?`,[userId])
      }
      await connection.execute('UPDATE life_categories SET parent_id=NULL WHERE user_id=?',[userId])
      await connection.execute('UPDATE life_locations SET parent_id=NULL WHERE user_id=?',[userId])
      for(const table of ['life_units','life_categories','life_tags','life_locations'])await connection.execute(`DELETE FROM ${table} WHERE user_id=?`,[userId])
      await this.restoreCoreBusinessRowsFrom(connection,userId,payload)
    }finally{
      await connection.query('SET @lifeops_restore_mode = NULL')
    }
  }

  private async restoreCoreBusinessRowsFrom(connection:PoolConnection,userId:string,payload:PortablePayload){
    type PortableRow=Record<string,any>
    const values=(key:string)=>(Array.isArray(payload[key])?payload[key]:[]) as PortableRow[]
    const taxonomy=values('catalogTaxonomy')
    const pending=[...taxonomy]
    const inserted=new Set<string>()
    while(pending.length){
      const index=pending.findIndex((row)=>row.kind==='tag'||row.parentId==null||inserted.has(String(row.parentId)))
      if(index<0)throw new LifeCommerceDomainError('IMPORT_RELATION_MISSING','Catalog taxonomy contains a parent cycle or missing parent.',409)
      const row=pending.splice(index,1)[0]!
      const table=row.kind==='category'?'life_categories':row.kind==='tag'?'life_tags':'life_locations'
      if(row.kind==='tag')await connection.execute(`INSERT INTO ${table}
        (id,user_id,name,status,version,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?)`,[
        row.id,userId,row.name,row.status,row.version,sqlDateTime(row.createdAt),sqlDateTime(row.updatedAt),row.deletedAt==null?null:sqlDateTime(row.deletedAt),
      ])
      else await connection.execute(`INSERT INTO ${table}
        (id,user_id,name,parent_id,status,position,version,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,[
        row.id,userId,row.name,row.parentId,row.status,row.position,row.version,sqlDateTime(row.createdAt),sqlDateTime(row.updatedAt),row.deletedAt==null?null:sqlDateTime(row.deletedAt),
      ])
      inserted.add(String(row.id))
    }
    for(const row of values('lifeUnits'))await connection.execute(`INSERT INTO life_units
      (id,user_id,code,name,symbol,dimension,base_code,to_base_factor,version,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,[
      row.id,userId,row.code,row.name,row.symbol,row.dimension,row.baseCode,row.toBaseFactor,row.version,
      sqlDateTime(row.createdAt),sqlDateTime(row.updatedAt),row.deletedAt==null?null:sqlDateTime(row.deletedAt),
    ])
    await this.options.restoreCatalogItemsFrom(connection,userId,values('catalogItems') as unknown as CatalogItem[])

    for(const row of values('inventoryBatches'))await connection.execute(`INSERT INTO life_inventory_batches
      (id,user_id,item_id,base_unit,original_quantity,remaining_quantity,purchased_on,expires_on,location_id,actual_unit_cost_minor,version,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`,[
      row.id,userId,row.itemId,row.baseUnit,row.originalQuantity,row.remainingQuantity,row.purchasedOn,row.expiresOn,row.locationId,row.actualUnitCostMinor,sqlDateTime(row.createdAt),
    ])
    const inventoryTransactions=values('inventoryTransactions')
    const orderedTransactions=[...inventoryTransactions.filter((row)=>row.reversesTransactionId==null),...inventoryTransactions.filter((row)=>row.reversesTransactionId!=null)]
    for(const row of orderedTransactions)await connection.execute(`INSERT INTO life_inventory_transactions
      (id,user_id,item_id,transaction_kind,quantity,unit,base_quantity,delta_base_quantity,batch_id,occurred_at,reverses_transaction_id,warning,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
      row.id,userId,row.itemId,row.kind,row.quantity,row.unit,row.baseQuantity,row.deltaBaseQuantity,row.batchId,sqlDateTime(row.occurredAt),row.reversesTransactionId,row.warning,row.note,sqlDateTime(row.createdAt),
    ])
    for(const row of inventoryTransactions)for(const [position,allocation] of (row.allocations??[]).entries())await connection.execute(`INSERT INTO life_inventory_allocations
      (user_id,transaction_id,batch_id,quantity,position,created_at) VALUES (?,?,?,?,?,?)`,[
      userId,row.id,allocation.batchId,allocation.quantity,position,sqlDateTime(row.createdAt),
    ])

    const recipes=values('recipes')
    for(const row of recipes)await connection.execute(`INSERT INTO life_recipes
      (id,user_id,name,description,cover_media_id,prep_minutes,cook_minutes,difficulty,category_id,tag_ids,storage_notes,current_version_id,entity_version,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?)`,[
      row.id,userId,row.name,row.description,row.coverMediaId,row.prepMinutes,row.cookMinutes,row.difficulty,row.categoryId,JSON.stringify(row.tagIds),row.storageNotes,row.entityVersion,
      sqlDateTime(row.createdAt),sqlDateTime(row.updatedAt),row.deletedAt==null?null:sqlDateTime(row.deletedAt),
    ])
    for(const row of values('recipeVersions')){
      await connection.execute(`INSERT INTO life_recipe_versions
        (id,user_id,recipe_id,version_number,servings,yield_quantity,yield_unit,promoted_note,created_at) VALUES (?,?,?,?,?,?,?,?,?)`,[
        row.id,userId,row.recipeId,row.number,row.servings,row.yieldQuantity,row.yieldUnit,row.promotedNote,sqlDateTime(row.createdAt),
      ])
      for(const component of row.components??[])await connection.execute(`INSERT INTO life_recipe_components
        (id,user_id,recipe_version_id,item_id,quantity,unit,component_role,position) VALUES (?,?,?,?,?,?,?,?)`,[
        component.id,userId,row.id,component.itemId,component.quantity,component.unit,component.role,component.position,
      ])
      for(const step of row.steps??[])await connection.execute(`INSERT INTO life_recipe_steps
        (id,user_id,recipe_version_id,instruction,ingredient_item_ids,duration_seconds,image_media_id,caution,position) VALUES (?,?,?,?,?,?,?,?,?)`,[
        step.id,userId,row.id,step.instruction,JSON.stringify(step.ingredientItemIds),step.durationSeconds,step.imageMediaId,step.caution,step.position,
      ])
    }
    for(const row of recipes)await connection.execute('UPDATE life_recipes SET current_version_id=? WHERE user_id=? AND id=?',[row.currentVersion?.id??null,userId,row.id])
    for(const row of values('cookingSessions'))await connection.execute(`INSERT INTO life_cooking_sessions
      (id,user_id,recipe_id,recipe_version_id,planned_servings,note,entity_version,progress_json,status,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[
      row.id,userId,row.recipeId,row.recipeVersionId,row.plannedServings,row.note,row.entityVersion,JSON.stringify(row.progress),row.status,sqlDateTime(row.createdAt),row.completedAt==null?null:sqlDateTime(row.completedAt),
    ])
    for(const row of values('cookingCompletions'))await connection.execute(`INSERT INTO life_cooking_snapshots
      (id,user_id,cooking_session_id,recipe_id,recipe_version_id,made_servings,eaten_servings,ingredients_snapshot,total_cost_minor,total_nutrition,intake_nutrition,cooking_oil_grams,intake_cooking_oil_grams,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
      row.id,userId,row.cookingSessionId,row.recipeId,row.recipeVersionId,row.madeServings,row.eatenServings,JSON.stringify(row.ingredients),row.totalCostMinor,
      JSON.stringify(row.totalNutrition),JSON.stringify(row.intakeNutrition),row.cookingOilGrams,row.intakeCookingOilGrams,sqlDateTime(row.completedAt),
    ])
    for(const row of values('preparedFood'))await connection.execute(`INSERT INTO life_prepared_food_stock
      (id,user_id,cooking_snapshot_id,recipe_id,recipe_version_id,portions_created,portions_remaining,nutrition_remaining,cooking_oil_grams_remaining,cost_remaining_minor,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[
      row.id,userId,row.cookingSnapshotId,row.recipeId,row.recipeVersionId,row.portionsCreated,row.portionsRemaining,JSON.stringify(row.nutritionRemaining),row.cookingOilGramsRemaining,row.costRemainingMinor,sqlDateTime(row.createdAt),
    ])

    const now=this.now()
    for(const row of values('planTemplates'))await connection.execute(`INSERT INTO life_plan_templates
      (id,user_id,name,meal_slots_json,items_json,entity_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`,[
      row.id,userId,row.name,JSON.stringify(row.mealSlots),JSON.stringify(row.items),row.entityVersion,sqlDateTime(now),sqlDateTime(now),
    ])
    for(const row of values('dayPlans'))await connection.execute(`INSERT INTO life_day_plans
      (id,user_id,plan_date,meal_slots_json,items_json,entity_version,conflicted,created_at,updated_at) VALUES (?,?,?,?,?,?,FALSE,?,?)`,[
      row.id,userId,row.date,JSON.stringify(row.mealSlots),JSON.stringify(row.items),row.entityVersion,sqlDateTime(now),sqlDateTime(now),
    ])
    for(const row of values('medicineRecurrenceRules'))await connection.execute(`INSERT INTO life_medicine_recurrence_rules
      (id,user_id,title,source_item_id,quantity,unit,recurrence_json,entity_version,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[
      row.id,userId,row.title,row.sourceId,row.quantity,row.unit,JSON.stringify(row.recurrence),row.entityVersion,sqlDateTime(row.createdAt),sqlDateTime(row.updatedAt),row.deletedAt==null?null:sqlDateTime(row.deletedAt),
    ])
    const occurrences=values('medicineOccurrences')
    for(const row of occurrences)await connection.execute(`INSERT INTO life_medicine_recurrence_occurrences
      (id,user_id,rule_id,title,source_item_id,quantity,unit,original_date,original_time,scheduled_date,scheduled_time,status,completion_id,entity_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?)`,[
      row.id,userId,row.ruleId,row.title,row.source.id,row.quantity,row.unit,row.originalDate,row.originalTime,row.scheduledDate,row.scheduledTime,
      row.status==='completed'?'planned':row.status,row.status==='completed'?Math.max(1,row.entityVersion-1):row.entityVersion,sqlDateTime(row.createdAt),sqlDateTime(row.updatedAt),
    ])
    for(const row of values('fitnessActivities'))await connection.execute(`INSERT INTO fitness_activities
      (id,user_id,name,default_minutes,kcal_per_hour,intensity,steps_json,equipment_json,entity_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[
      row.id,userId,row.name,row.defaultMinutes,row.kcalPerHour,row.intensity,JSON.stringify(row.steps),JSON.stringify(row.equipment),row.entityVersion,sqlDateTime(row.createdAt),sqlDateTime(row.updatedAt),
    ])
    for(const row of values('templateApplications'))await connection.execute(`INSERT INTO life_template_applications
      (id,user_id,template_id,day_plan_id,applied_template_version,resolution,applied_at) VALUES (?,?,?,?,?,?,?)`,[
      row.id,userId,row.templateId,row.dayPlanId,row.appliedVersion,row.resolution,sqlDateTime(row.appliedAt),
    ])
    const completions=values('completionSnapshots')
    for(const row of completions){
      const occurrenceId=row.completionSource?.type==='medicine-occurrence'?row.completionSource.id:null
      await connection.execute(`INSERT INTO life_completion_snapshots
        (id,user_id,day_plan_id,day_plan_item_id,medicine_occurrence_id,completion_source_json,item_kind,source_json,actual_quantity,actual_unit,actual_servings,completed_at,nutrition_json,cost_minor,actual_minutes,estimated_energy_kcal,energy_is_estimate,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
        row.id,userId,row.dayPlanId,row.dayPlanItemId,occurrenceId,JSON.stringify(row.completionSource),row.kind,row.source==null?null:JSON.stringify(row.source),row.quantity,row.unit,row.servings,
        sqlDateTime(row.completedAt),row.nutrition==null?null:JSON.stringify(row.nutrition),row.costMinor,row.actualMinutes,row.estimatedEnergyKcal,row.energyIsEstimate,sqlDateTime(row.completedAt),
      ])
      for(const [position,transactionId] of (row.inventoryTransactionIds??[]).entries())await connection.execute(`INSERT INTO life_completion_inventory_events
        (user_id,completion_id,transaction_id,position,created_at) VALUES (?,?,?,?,?)`,[userId,row.id,transactionId,position,sqlDateTime(row.completedAt)])
    }
    for(const group of values('completionPreparedFoodEvents'))for(const [position,event] of (group.events??[]).entries())await connection.execute(`INSERT INTO life_completion_prepared_food_events
      (id,user_id,completion_id,prepared_food_stock_id,portions,nutrition_json,cooking_oil_grams,cost_minor,position,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,[
      event.id,userId,group.completionId,event.stockId,event.portions,JSON.stringify(event.nutrition),event.cookingOilGrams,event.costMinor,position,sqlDateTime(now),
    ])
    for(const row of values('completionReversals'))await connection.execute(`INSERT INTO life_completion_reversals
      (id,user_id,completion_id,reversed_inventory_transaction_ids,restored_prepared_food_event_ids,created_at) VALUES (?,?,?,?,?,?)`,[
      this.createId(),userId,row.completionId,JSON.stringify(row.reversedInventoryTransactionIds),JSON.stringify(row.restoredPreparedFoodEventIds??[]),sqlDateTime(row.createdAt),
    ])
    for(const row of occurrences.filter((entry)=>entry.status==='completed'))await connection.execute(`UPDATE life_medicine_recurrence_occurrences
      SET status='completed',completion_id=?,entity_version=?,updated_at=? WHERE user_id=? AND id=?`,[
      row.completionId,row.entityVersion,sqlDateTime(row.updatedAt),userId,row.id,
    ])
  }

  private async restoreCommerceRowsFrom(connection:PoolConnection,userId:string,payload:PortablePayload){
    const values=<T>(key:string)=>(Array.isArray(payload[key])?payload[key]:[]) as T[]
    for(const policy of values<InventoryPolicy>('inventoryPolicies'))await connection.execute(`INSERT INTO life_inventory_policies
      (id,user_id,item_id,minimum_stock,package_quantity,unit_id,unit,entity_version,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,[
      policy.id,userId,policy.itemId,policy.minimumStock,policy.packageQuantity,policy.unitId,policy.unit,policy.version,
      sqlDateTime(policy.createdAt),sqlDateTime(policy.updatedAt),
    ])
    for(const suggestion of values<ShoppingSuggestion>('shoppingSuggestions')){
      await connection.execute(`INSERT INTO life_shopping_suggestions
        (id,user_id,item_id,suggestion_origin,through_date,required_quantity,suggested_quantity,unit,package_quantity,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[
        suggestion.id,userId,suggestion.itemId,suggestion.origin,suggestion.through,suggestion.requiredQuantity,suggestion.suggestedQuantity,suggestion.unit,suggestion.packageQuantity,
        sqlDateTime(suggestion.createdAt),sqlDateTime(suggestion.updatedAt),
      ])
      for(const reason of suggestion.reasons)await connection.execute(`INSERT INTO life_shopping_suggestion_reasons
        (id,user_id,suggestion_id,reason_kind,source_type,source_id,required_quantity,source_quantity,source_unit,conversion_factor,required_on,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,[
        reason.id,userId,suggestion.id,reason.kind,reason.sourceType,reason.sourceId,reason.requiredQuantity,
        reason.sourceQuantity,reason.sourceUnit,reason.conversionFactor,reason.requiredOn,sqlDateTime(reason.createdAt),
      ])
    }
    for(const item of values<ShoppingItem>('shoppingItems'))await connection.execute(`INSERT INTO life_shopping_items
      (id,user_id,item_id,requested_quantity,purchased_quantity,unit,needed_on,priority,store_group,status,entity_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
      item.id,userId,item.itemId,item.requestedQuantity,item.purchasedQuantity,item.unit,item.neededOn,item.priority,
      item.storeGroup,item.status,item.version,sqlDateTime(item.createdAt),sqlDateTime(item.updatedAt),
    ])
    const purchases=values<Purchase>('purchases')
    for(const purchase of purchases)await connection.execute(`INSERT INTO life_purchases
      (id,user_id,purchased_at,currency,store_name,total_amount_minor,created_at) VALUES (?,?,?,?,?,?,?)`,[
      purchase.id,userId,sqlDateTime(purchase.purchasedAt),purchase.currency,purchase.storeName,purchase.totalAmountMinor,
      sqlDateTime(purchase.createdAt),
    ])
    for(const item of values<PurchaseItem>('purchaseItems')){
      const parent=purchases.find((purchase)=>purchase.id===item.purchaseId)
      await connection.execute(`INSERT INTO life_purchase_items
        (id,user_id,purchase_id,shopping_item_id,item_id,quantity,unit,amount_minor,update_current_price,inventory_transaction_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[
        item.id,userId,item.purchaseId,item.shoppingItemId,item.itemId,item.quantity,item.unit,item.amountMinor,
        item.updateCurrentPrice,item.inventoryTransactionId,sqlDateTime(parent?.createdAt??this.now()),
      ])
    }
    const refunds=values<Refund>('refunds')
    for(const refund of refunds)await connection.execute(`INSERT INTO life_refunds
      (id,user_id,purchase_id,refunded_at,total_amount_minor,note,created_at) VALUES (?,?,?,?,?,?,?)`,[
      refund.id,userId,refund.purchaseId,sqlDateTime(refund.refundedAt),refund.totalAmountMinor,refund.note,
      sqlDateTime(refund.createdAt),
    ])
    for(const item of values<RefundItem>('refundItems')){
      const parent=refunds.find((refund)=>refund.id===item.refundId)
      await connection.execute(`INSERT INTO life_refund_items
        (id,user_id,refund_id,purchase_id,purchase_item_id,item_id,quantity,amount_minor,inventory_transaction_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,[
        item.id,userId,item.refundId,item.purchaseId,item.purchaseItemId,item.itemId,item.quantity,item.amountMinor,
        item.inventoryTransactionId,sqlDateTime(parent?.createdAt??this.now()),
      ])
    }
    for(const cash of values<CashExpenditure>('cashExpenditures'))await connection.execute(`INSERT INTO life_cash_expenditures
      (id,user_id,amount_minor,currency,occurred_at,source_type,purchase_id,refund_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)`,[
      cash.id,userId,cash.amountMinor,cash.currency,sqlDateTime(cash.occurredAt),cash.sourceType,
      cash.sourceType==='purchase'?cash.sourceId:null,cash.sourceType==='refund'?cash.sourceId:null,sqlDateTime(cash.createdAt),
    ])
    for(const budget of payload.budgets){
      validateBudgetInput(budget)
      await connection.execute(`INSERT INTO life_budgets
        (id,user_id,name,scope_json,period_kind,starts_on,ends_on,limit_minor,thresholds_json,rollover_minor,entity_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
        budget.id,userId,budget.name,JSON.stringify(budget.scope),budget.period.kind,budget.period.startsOn,
        budget.period.endsOn,budget.limitMinor,JSON.stringify(budget.thresholds),budget.rolloverMinor,budget.version,
        sqlDateTime(budget.createdAt),sqlDateTime(budget.updatedAt),
      ])
    }
  }

  private async listInventoryPoliciesFrom(executor: Executor, userId: string) {
    const found = await rows<SqlRow>(executor,
      'SELECT * FROM life_inventory_policies WHERE user_id=? ORDER BY item_id,id', [userId])
    return found.map((row) => this.mapInventoryPolicy(row))
  }

  private async listShoppingFrom(executor: Executor, userId: string): Promise<{ suggestions: ShoppingSuggestion[]; formalItems: ShoppingItem[] }> {
    const [suggestionRows, reasonRows, formalRows, balances] = await Promise.all([
      rows<SqlRow>(executor, 'SELECT * FROM life_shopping_suggestions WHERE user_id=? ORDER BY created_at,id', [userId]),
      rows<SqlRow>(executor, 'SELECT * FROM life_shopping_suggestion_reasons WHERE user_id=? ORDER BY created_at,id', [userId]),
      rows<SqlRow>(executor, 'SELECT * FROM life_shopping_items WHERE user_id=? ORDER BY created_at,id', [userId]),
      this.options.listInventoryBalancesFrom(executor, userId),
    ])
    const formalItems = formalRows.map((row) => this.mapShoppingItem(row))
    const suggestions = suggestionRows.map((row) => this.mapSuggestion(
      row,
      reasonRows.filter((reason) => String(reason.suggestion_id) === String(row.id)).map((reason) => this.mapReason(reason)),
      formalItems,
      balances,
    ))
    return { suggestions, formalItems }
  }

  private mapSuggestion(row: SqlRow, reasons: ShoppingReason[], formalItems: ShoppingItem[], balances: InventoryBalance[]): ShoppingSuggestion {
    const requiredQuantity = Number(row.required_quantity)
    const packageQuantity = Number(row.package_quantity)
    const unit = String(row.unit)
    const origin = row.suggestion_origin as ShoppingSuggestion['origin']
    const outstanding = formalItems.filter((item) => item.itemId === row.item_id && item.unit === unit
      && !['cancelled', 'archived', 'purchased'].includes(item.status)).reduce((sum, item) => sum + item.remainingQuantity, 0)
    const onHand = balances.find((balance) => balance.itemId === row.item_id && balance.baseUnit === unit)?.onHand ?? 0
    return {
      id: String(row.id), kind: 'suggestion', origin, through: dateOnly(row.through_date), itemId: String(row.item_id),
      requiredQuantity, suggestedQuantity: origin === 'derived' ? Number(row.suggested_quantity)
        : round(Math.ceil(Math.max(0, requiredQuantity - onHand - outstanding) / packageQuantity) * packageQuantity),
      unit, packageQuantity, reasons, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    }
  }

  private mapInventoryPolicy(row: SqlRow): InventoryPolicy {
    return {
      id: String(row.id), itemId: String(row.item_id), minimumStock: Number(row.minimum_stock),
      packageQuantity: Number(row.package_quantity), unitId: String(row.unit_id), unit: String(row.unit),
      version: Number(row.entity_version), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    }
  }

  private mapReason(row:SqlRow):ShoppingReason{return{id:String(row.id),kind:row.reason_kind as ShoppingReason['kind'],sourceType:row.source_type as ShoppingReason['sourceType'],sourceId:String(row.source_id),requiredQuantity:Number(row.required_quantity),sourceQuantity:Number(row.source_quantity),sourceUnit:String(row.source_unit),conversionFactor:Number(row.conversion_factor),requiredOn:dateOnly(row.required_on),createdAt:iso(row.created_at)}}

  private unitDefinitions(units: LifeUnit[]) {
    return units.map((unit) => ({ code: unit.code, dimension: unit.dimension, baseCode: unit.baseCode, toBaseFactor: unit.toBaseFactor }))
  }

  private convertEvidence(
    item: CatalogItem,
    units: LifeUnit[],
    source: { sourceType: ShoppingQuantityEvidence['sourceType']; sourceId?: string; date?: string; quantity: number; unit: string },
    policyUnit: string,
  ): ShoppingQuantityEvidence {
    const converted = convertUnit({ itemId: item.id, quantity: source.quantity, fromUnit: source.unit,
      toBaseUnit: policyUnit, itemConversions: item.itemConversions, units: this.unitDefinitions(units) })
    const factor = convertUnit({ itemId: item.id, quantity: 1, fromUnit: source.unit,
      toBaseUnit: policyUnit, itemConversions: item.itemConversions, units: this.unitDefinitions(units) })
    return {
      sourceType: source.sourceType, ...(source.sourceId ? { sourceId: source.sourceId } : {}),
      ...(source.date ? { date: source.date } : {}), sourceQuantity: source.quantity, sourceUnit: source.unit,
      policyQuantity: converted.status === 'complete' ? converted.baseQuantity : null,
      conversionFactor: factor.status === 'complete' ? factor.baseQuantity : null,
    }
  }

  private incompletePolicy(policy: InventoryPolicy, evidence: ShoppingQuantityEvidence[]): IncompleteShoppingRecalculation {
    return { status: 'incomplete', itemId: policy.itemId, policyVersion: policy.version, unitId: policy.unitId,
      unit: policy.unit, reason: 'missing_conversion', evidence }
  }

  private buildDerivedSuggestion(
    policy: InventoryPolicy,
    calculation: CompleteShoppingRecalculation,
    through: string,
    current?: ShoppingSuggestion,
  ): ShoppingSuggestion {
    const timestamp = this.now()
    const plannedBySource = new Map<string, ShoppingQuantityEvidence>()
    for (const evidence of calculation.evidence.planned) {
      const key = `${evidence.sourceId}\0${evidence.date}`
      const previous = plannedBySource.get(key)
      plannedBySource.set(key, previous ? {
        ...previous,
        sourceQuantity: round((previous.sourceQuantity ?? 0) + (evidence.sourceQuantity ?? 0)),
        policyQuantity: round((previous.policyQuantity ?? 0) + (evidence.policyQuantity ?? 0)),
      } : evidence)
    }
    const reasons: ShoppingReason[] = [...plannedBySource.values()]
      .filter((evidence) => (evidence.policyQuantity ?? 0) > 0)
      .map((evidence) => {
        const previous = current?.reasons.find((reason) => reason.sourceType === 'day-plan' && reason.sourceId === evidence.sourceId)
        return {
          id: previous?.id ?? this.createId(), kind: 'planned_shortage', sourceType: 'day-plan', sourceId: evidence.sourceId!,
          requiredQuantity: evidence.policyQuantity!, sourceQuantity: evidence.sourceQuantity!, sourceUnit: evidence.sourceUnit!,
          conversionFactor: evidence.conversionFactor!, requiredOn: evidence.date ?? null, createdAt: previous?.createdAt ?? timestamp,
        }
      })
    if (policy.minimumStock > 0) {
      const previous = current?.reasons.find((reason) => reason.sourceType === 'inventory-policy' && reason.sourceId === policy.id)
      reasons.push({
        id: previous?.id ?? this.createId(), kind: 'minimum_stock', sourceType: 'inventory-policy', sourceId: policy.id,
        requiredQuantity: policy.minimumStock, sourceQuantity: policy.minimumStock, sourceUnit: calculation.unit,
        conversionFactor: 1, requiredOn: null, createdAt: previous?.createdAt ?? timestamp,
      })
    }
    return {
      id: current?.id ?? this.createId(), kind: 'suggestion', origin: 'derived', through, itemId: policy.itemId,
      requiredQuantity: round(calculation.plannedDemand + policy.minimumStock), suggestedQuantity: calculation.suggestedQuantity,
      unit: calculation.unit, packageQuantity: policy.packageQuantity, reasons,
      createdAt: current?.createdAt ?? timestamp, updatedAt: timestamp,
    }
  }
  private mapShoppingItem(row:SqlRow):ShoppingItem{const requested=Number(row.requested_quantity),purchased=Number(row.purchased_quantity);return{id:String(row.id),kind:'formal',itemId:String(row.item_id),requestedQuantity:requested,purchasedQuantity:purchased,remainingQuantity:round(requested-purchased),unit:String(row.unit),neededOn:dateOnly(row.needed_on),priority:row.priority as ShoppingItem['priority'],storeGroup:String(row.store_group),status:row.status as ShoppingItem['status'],version:Number(row.entity_version),createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)}}
  private mapBudget(row:SqlRow):Budget{return{id:String(row.id),name:String(row.name),scope:json(row.scope_json,{kind:'all-life'}),period:{kind:row.period_kind as Budget['period']['kind'],startsOn:String(row.starts_on).slice(0,10),endsOn:String(row.ends_on).slice(0,10)},limitMinor:Number(row.limit_minor),thresholds:json(row.thresholds_json,[]),rolloverMinor:Number(row.rollover_minor),version:Number(row.entity_version),createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)}}
  private async cashRows(executor:Executor,userId:string){const values=await rows<SqlRow>(executor,'SELECT * FROM life_cash_expenditures WHERE user_id=? ORDER BY occurred_at,id',[userId]);return values.map(row=>({id:String(row.id),amountMinor:Number(row.amount_minor),currency:String(row.currency),occurredAt:iso(row.occurred_at),sourceType:row.source_type as CashExpenditure['sourceType'],sourceId:String(row.source_type==='purchase'?row.purchase_id:row.refund_id),createdAt:iso(row.created_at)}))}

  private async buildPayload(executor:Executor,userId:string,includeAttachments:boolean):Promise<PortablePayload>{
    const businessData=await this.options.exportBusinessDataFrom(executor,userId)
    const sourceCatalog=(businessData.catalogItems??[]) as CatalogItem[]
    const catalog=sourceCatalog.map((item)=>includeAttachments?item:{...item,attachments:[]})
    const mediaAssets:PortableMediaAsset[]=[]
    if(includeAttachments)for(const mediaId of [...new Set(sourceCatalog.flatMap((item)=>item.attachments.map((attachment)=>attachment.mediaId)))].sort()){
      const source=await this.options.readMediaAsset(executor,userId,mediaId)
      if(!source)throw new LifeCommerceDomainError('ATTACHMENT_CONTENT_UNAVAILABLE',`Attachment ${mediaId} is unavailable for export.`,409)
      mediaAssets.push(buildPortableMediaAsset(source.asset,source.bytes))
    }
    const shoppingState=await this.listShoppingFrom(executor,userId)
    const shopping=shoppingState.formalItems
    const purchases=(await rows<SqlRow>(executor,'SELECT * FROM life_purchases WHERE user_id=? ORDER BY purchased_at,id',[userId])).map((row)=>({
      id:String(row.id),purchasedAt:iso(row.purchased_at),currency:String(row.currency),storeName:String(row.store_name),
      totalAmountMinor:Number(row.total_amount_minor),createdAt:iso(row.created_at),
    }))
    const purchaseItems=(await rows<SqlRow>(executor,'SELECT * FROM life_purchase_items WHERE user_id=? ORDER BY created_at,id',[userId])).map((row)=>({
      id:String(row.id),purchaseId:String(row.purchase_id),shoppingItemId:row.shopping_item_id==null?null:String(row.shopping_item_id),
      itemId:String(row.item_id),quantity:Number(row.quantity),unit:String(row.unit),amountMinor:Number(row.amount_minor),
      updateCurrentPrice:Boolean(row.update_current_price),inventoryTransactionId:String(row.inventory_transaction_id),
    }))
    const refunds=(await rows<SqlRow>(executor,'SELECT * FROM life_refunds WHERE user_id=? ORDER BY refunded_at,id',[userId])).map((row)=>({
      id:String(row.id),purchaseId:String(row.purchase_id),refundedAt:iso(row.refunded_at),totalAmountMinor:Number(row.total_amount_minor),
      note:String(row.note),createdAt:iso(row.created_at),
    }))
    const refundItems=(await rows<SqlRow>(executor,'SELECT * FROM life_refund_items WHERE user_id=? ORDER BY created_at,id',[userId])).map((row)=>({
      id:String(row.id),refundId:String(row.refund_id),purchaseId:String(row.purchase_id),purchaseItemId:String(row.purchase_item_id),
      itemId:String(row.item_id),quantity:Number(row.quantity),amountMinor:Number(row.amount_minor),
      inventoryTransactionId:String(row.inventory_transaction_id),
    }))
    const budgets=(await rows<SqlRow>(executor,'SELECT * FROM life_budgets WHERE user_id=? ORDER BY created_at,id',[userId])).map((row)=>this.mapBudget(row))
    return{
      ...businessData,catalogItems:catalog,...(includeAttachments?{mediaAssets}:{}),inventoryPolicies:await this.listInventoryPoliciesFrom(executor,userId),shoppingSuggestions:shoppingState.suggestions,
      shoppingItems:shopping,purchases,purchaseItems,refunds,refundItems,budgets,
      cashExpenditures:await this.cashRows(executor,userId),
    }
  }
  private async createExportFrom(connection:PoolConnection,userId:string,input:{format:'json'|'zip';includeAttachments:boolean},reason:'user-export'|'pre-import-restore-point'){const payload=await this.buildPayload(connection,userId,input.includeAttachments),canonicalJson=stableJson(payload),recordCounts=Object.fromEntries(Object.entries(payload).filter(([,value])=>Array.isArray(value)).map(([name,value])=>[name,(value as unknown[]).length])),base={id:this.createId(),status:'completed' as const,reason,format:input.format,formatVersion:1 as const,recordCounts,createdAt:this.now()};let job:ExportJob,archive:Buffer|null=null;if(input.format==='json')job={...base,checksumSha256:checksumSha256(canonicalJson),canonicalJson,payload};else{const mediaAssets=payload.mediaAssets??[],attachmentManifest=mediaAssets.map((asset)=>({id:asset.id,entry:asset.archiveEntry,checksumSha256:asset.checksum,sizeBytes:asset.sizeBytes})),manifest=stableJson({formatVersion:1,recordCounts,payloadChecksumSha256:checksumSha256(canonicalJson),attachments:attachmentManifest}),archiveEntries=['manifest.json','lifeops.json',...mediaAssets.map((asset)=>asset.archiveEntry)];archive=createStoredZip([{name:archiveEntries[0]!,contents:manifest},{name:archiveEntries[1]!,contents:canonicalJson},...mediaAssets.map((asset)=>({name:asset.archiveEntry,contents:Buffer.from(asset.bytesBase64,'base64')}))]);job={...base,checksumSha256:checksumSha256(archive),archiveBase64:archive.toString('base64'),archiveEntries}}await connection.execute(`INSERT INTO life_exports
    (id,user_id,reason,export_format,format_version,checksum_sha256,record_counts_json,canonical_json,archive_blob,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,[job.id,userId,reason,input.format,1,job.checksumSha256,JSON.stringify(recordCounts),input.format==='json'?canonicalJson:null,archive,sqlDateTime(job.createdAt)]);return job}
  private async mapExport(row:SqlRow):Promise<ExportJob>{const base={id:String(row.id),status:'completed' as const,reason:row.reason as ExportJob['reason'],format:row.export_format as ExportJob['format'],formatVersion:1 as const,checksumSha256:String(row.checksum_sha256),recordCounts:json<Record<string,number>>(row.record_counts_json,{}),createdAt:iso(row.created_at)};if(base.format==='json'){const canonicalJson=String(row.canonical_json);return{...base,canonicalJson,payload:validatePortablePayload(JSON.parse(canonicalJson))}}const archive=Buffer.from(row.archive_blob as Buffer);return{...base,archiveBase64:archive.toString('base64'),archiveEntries:[...readStoredZip(archive).keys()]}}

  private async requireItem(executor:Executor,userId:string,itemId:string){const item=await this.options.getCatalogItemFrom(executor,userId,itemId);if(!item)throw new LifeCommerceDomainError('NOT_FOUND','The catalog item does not exist.',404);return item}
  private async idempotently<T>(userId:string,operation:string,rawKey:string,input:unknown,work:(connection:PoolConnection)=>Promise<T>):Promise<T>{const key=normalizeCommerceIdempotencyKey(rawKey),hash=requestHash(input),connection=await this.pool.getConnection();try{await connection.beginTransaction();await connection.execute('INSERT IGNORE INTO life_commerce_idempotency (user_id,operation_key,idempotency_key,request_hash,response_json,created_at) VALUES (?,?,?,?,NULL,?)',[userId,operation,key,hash,sqlDateTime(this.now())]);const found=(await rows<SqlRow>(connection,'SELECT * FROM life_commerce_idempotency WHERE user_id=? AND operation_key=? AND idempotency_key=? FOR UPDATE',[userId,operation,key]))[0]!;if(String(found.request_hash)!==hash)throw new LifeCommerceDomainError('IDEMPOTENCY_CONFLICT','The idempotency key belongs to a different commerce request.',409);if(found.response_json!=null){const response=json<T>(found.response_json,undefined as T);await connection.commit();return clone(response)}const result=await work(connection);await connection.execute('UPDATE life_commerce_idempotency SET response_json=? WHERE user_id=? AND operation_key=? AND idempotency_key=?',[JSON.stringify(result),userId,operation,key]);await connection.commit();return clone(result)}catch(error){await connection.rollback();throw error}finally{connection.release()}}
}
