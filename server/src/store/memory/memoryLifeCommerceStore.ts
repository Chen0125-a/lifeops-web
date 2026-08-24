import { randomUUID } from 'node:crypto'
import { convertUnit, type CatalogItem, type LifeUnit } from '../../domain/life/catalog.js'
import type { MediaAsset } from '../../domain/types.js'
import type { CreateInventoryTransactionInput, InventoryBalance, InventoryTransaction } from '../../domain/life/inventory.js'
import type { DayPlanProjection, PlanningCompletionSnapshot, PlanningTimeline } from '../../domain/life/planning.js'
import {
  LifeCommerceDomainError,
  budgetScopeMatchesItemIds,
  buildPortableMediaAsset,
  buildSuggestion,
  checksumSha256,
  cleanText,
  createStoredZip,
  datesBetween,
  nonNegative,
  normalizeCommerceIdempotencyKey,
  portableJsonFromArchive,
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
  type ImportPreview,
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
import type { MemoryOwnerTransactionParticipant } from './memoryOwnerTransactionCoordinator.js'

interface Owned<T> { userId: string; value: T }
interface CommerceOwnerState {
  policies: Array<Owned<InventoryPolicy>>
  suggestions: Array<Owned<ShoppingSuggestion>>
  shoppingItems: Array<Owned<ShoppingItem>>
  purchases: Array<Owned<Purchase>>
  purchaseItems: Array<Owned<PurchaseItem>>
  refunds: Array<Owned<Refund>>
  refundItems: Array<Owned<RefundItem>>
  cashExpenditures: Array<Owned<CashExpenditure>>
  budgets: Array<Owned<Budget>>
  exports: Array<Owned<ExportJob>>
  imports: Array<Owned<ImportPreview>>
  idempotency: Array<[string, { hash: string; promise: Promise<unknown> }]>
}

const clone = <T>(value: T): T => structuredClone(value)
const round = (value: number) => Math.round((value + Number.EPSILON) * 1_000_000_000) / 1_000_000_000

export class MemoryLifeCommerceStore implements LifeCommerceStore, MemoryOwnerTransactionParticipant<CommerceOwnerState> {
  private policies: Array<Owned<InventoryPolicy>> = []
  private suggestions: Array<Owned<ShoppingSuggestion>> = []
  private shoppingItems: Array<Owned<ShoppingItem>> = []
  private purchases: Array<Owned<Purchase>> = []
  private purchaseItems: Array<Owned<PurchaseItem>> = []
  private refunds: Array<Owned<Refund>> = []
  private refundItems: Array<Owned<RefundItem>> = []
  private cashExpenditures: Array<Owned<CashExpenditure>> = []
  private budgets: Array<Owned<Budget>> = []
  private exports: Array<Owned<ExportJob>> = []
  private imports: Array<Owned<ImportPreview>> = []
  private readonly importRestorePoints = new Map<string, string>()
  private readonly importApplyResults = new Map<string, Extract<ImportApplyResult, { status: 'applied' }>>()
  private readonly idempotency = new Map<string, { hash: string; promise: Promise<unknown> }>()

  constructor(private readonly options: {
    createId?: () => string
    now?: () => string
    getCatalogItem: (userId: string, itemId: string) => Promise<CatalogItem | undefined>
    listCatalogItems: (userId: string) => Promise<CatalogItem[]>
    listCategoryIds: (userId: string) => Promise<string[]>
    readMediaAsset: (userId: string, mediaId: string) => Promise<{ asset: MediaAsset; bytes: Uint8Array } | undefined>
    restoreMediaAssets: (userId: string, mediaAssets: PortableMediaAsset[]) => Promise<{ commit(): Promise<void>; rollback(): Promise<void> }>
    listUnits: (userId: string) => Promise<LifeUnit[]>
    updateCatalogItem: (userId: string, itemId: string, input: { version: number; pricePoints: Array<{ amountMinor: number; currency: string; purchaseQuantity: number; purchaseUnit: string; effectiveFrom: string }> }) => Promise<CatalogItem | undefined>
    createInventoryTransaction: (userId: string, input: CreateInventoryTransactionInput, key: string) => Promise<InventoryTransaction>
    listInventoryBalances: (userId: string) => Promise<InventoryBalance[]>
    listUsableInventoryBalances: (userId: string, asOf: string) => Promise<InventoryBalance[]>
    listDayPlanProjections: (userId: string, from: string, through: string) => Promise<DayPlanProjection[]>
    listCompletionSnapshots: (userId: string, from: string, to: string) => Promise<PlanningCompletionSnapshot[]>
    getPlanningTimeline: (userId: string, date: string) => Promise<PlanningTimeline>
    exportBusinessData: (userId: string) => Promise<Record<string, unknown[]>> | Record<string, unknown[]>
    replaceBusinessData: (userId: string, payload: Record<string, unknown>) => Promise<void> | void
    mergeCatalogItems: (userId: string, items: CatalogItem[]) => Promise<void> | void
    onImportBusinessDataReplaced?: (userId: string) => Promise<void> | void
  }) {}

  private createId = () => this.options.createId?.() ?? randomUUID()
  private now = () => this.options.now?.() ?? new Date().toISOString()

  captureOwnerTransactionState(userId: string): CommerceOwnerState {
    const prefix = `${userId}\0`
    return {
      policies: clone(this.policies.filter((entry) => entry.userId === userId)),
      suggestions: clone(this.suggestions.filter((entry) => entry.userId === userId)),
      shoppingItems: clone(this.shoppingItems.filter((entry) => entry.userId === userId)),
      purchases: clone(this.purchases.filter((entry) => entry.userId === userId)),
      purchaseItems: clone(this.purchaseItems.filter((entry) => entry.userId === userId)),
      refunds: clone(this.refunds.filter((entry) => entry.userId === userId)),
      refundItems: clone(this.refundItems.filter((entry) => entry.userId === userId)),
      cashExpenditures: clone(this.cashExpenditures.filter((entry) => entry.userId === userId)),
      budgets: clone(this.budgets.filter((entry) => entry.userId === userId)),
      exports: clone(this.exports.filter((entry) => entry.userId === userId)),
      imports: clone(this.imports.filter((entry) => entry.userId === userId)),
      idempotency: [...this.idempotency.entries()].filter(([key]) => key.startsWith(prefix)),
    }
  }

  restoreOwnerTransactionState(userId: string, state: CommerceOwnerState) {
    const restore = <T>(current: Array<Owned<T>>, saved: Array<Owned<T>>) => [
      ...current.filter((entry) => entry.userId !== userId),
      ...clone(saved),
    ]
    this.suggestions = restore(this.suggestions, state.suggestions)
    this.policies = restore(this.policies, state.policies)
    this.shoppingItems = restore(this.shoppingItems, state.shoppingItems)
    this.purchases = restore(this.purchases, state.purchases)
    this.purchaseItems = restore(this.purchaseItems, state.purchaseItems)
    this.refunds = restore(this.refunds, state.refunds)
    this.refundItems = restore(this.refundItems, state.refundItems)
    this.cashExpenditures = restore(this.cashExpenditures, state.cashExpenditures)
    this.budgets = restore(this.budgets, state.budgets)
    this.exports = restore(this.exports, state.exports)
    this.imports = restore(this.imports, state.imports)
    const prefix = `${userId}\0`
    for (const key of [...this.idempotency.keys()]) if (key.startsWith(prefix)) this.idempotency.delete(key)
    for (const [key, value] of state.idempotency) this.idempotency.set(key, value)
  }

  replaceOwnerPortableData(userId: string, payload: Record<string, unknown>) {
    const imported = <T>(key: string) => clone((Array.isArray(payload[key]) ? payload[key] : []) as T[])
    const replace = <T>(current: Array<Owned<T>>, values: T[]) => [
      ...current.filter((entry) => entry.userId !== userId),
      ...values.map((value) => ({ userId, value })),
    ]
    this.policies = replace(this.policies, imported<InventoryPolicy>('inventoryPolicies'))
    this.suggestions = replace(this.suggestions, imported<ShoppingSuggestion>('shoppingSuggestions'))
    this.shoppingItems = replace(this.shoppingItems, imported<ShoppingItem>('shoppingItems'))
    this.purchases = replace(this.purchases, imported<Purchase>('purchases'))
    this.purchaseItems = replace(this.purchaseItems, imported<PurchaseItem>('purchaseItems'))
    this.refunds = replace(this.refunds, imported<Refund>('refunds'))
    this.refundItems = replace(this.refundItems, imported<RefundItem>('refundItems'))
    this.cashExpenditures = replace(this.cashExpenditures, imported<CashExpenditure>('cashExpenditures'))
    this.budgets = replace(this.budgets, imported<Budget>('budgets'))
    const prefix = `${userId}\0`
    for (const key of [...this.idempotency.keys()]) if (key.startsWith(prefix)) this.idempotency.delete(key)
  }

  async listInventoryPolicies(userId: string) {
    return clone(this.policies.filter((entry) => entry.userId === userId).map((entry) => entry.value)
      .sort((left, right) => left.itemId.localeCompare(right.itemId)))
  }

  async upsertInventoryPolicy(userId: string, itemId: string, input: UpsertInventoryPolicyInput, key: string) {
    return this.idempotently(userId, `inventory-policy:${itemId}`, key, input, async () => {
      const item = await this.requireItem(userId, itemId)
      const units = await this.options.listUnits(userId)
      const unit = units.find((candidate) => candidate.id === cleanText(input.unitId, 'unitId') && candidate.deletedAt == null)
      if (!unit) throw new LifeCommerceDomainError('NOT_FOUND', 'The inventory policy unit does not exist.', 404)
      const compatible = convertUnit({
        itemId: item.id, quantity: 1, fromUnit: unit.code, toBaseUnit: item.baseUnit,
        itemConversions: item.itemConversions, units: this.unitDefinitions(units),
      })
      if (compatible.status === 'incomplete') {
        throw new LifeCommerceDomainError('INCOMPATIBLE_POLICY_UNIT', 'The inventory policy unit is not compatible with the catalog item.', 409)
      }
      const owned = this.policies.find((entry) => entry.userId === userId && entry.value.itemId === item.id)
      if (owned && input.version == null) {
        throw new LifeCommerceDomainError('VERSION_REQUIRED', 'Updating an inventory policy requires its current version.', 409, { current: clone(owned.value) })
      }
      if ((owned && input.version !== owned.value.version) || (!owned && input.version != null)) {
        throw new LifeCommerceDomainError('VERSION_CONFLICT', 'The inventory policy changed before this request.', 409, { current: owned ? clone(owned.value) : null })
      }
      const timestamp = this.now()
      const policy: InventoryPolicy = {
        id: owned?.value.id ?? this.createId(), itemId: item.id,
        minimumStock: nonNegative(input.minimumStock, 'minimumStock'),
        packageQuantity: positive(input.packageQuantity, 'packageQuantity'),
        unitId: unit.id, unit: unit.code,
        version: owned ? owned.value.version + 1 : 1,
        createdAt: owned?.value.createdAt ?? timestamp, updatedAt: timestamp,
      }
      if (owned) owned.value = policy
      else this.policies.push({ userId, value: policy })
      return { policy: clone(policy), created: !owned }
    })
  }

  async recalculateShopping(userId: string, input: { through: string }, key: string): Promise<ShoppingRecalculationResult> {
    return this.idempotently(userId, 'shopping:recalculate', key, input, async () => {
      const through = validDate(input.through, 'through')
      const today = this.now().slice(0, 10)
      if (through < today) throw new LifeCommerceDomainError('INVALID_RANGE', 'through cannot precede today.', 400)
      const [policies, catalog, units, projections, usableBalances] = await Promise.all([
        this.listInventoryPolicies(userId),
        this.options.listCatalogItems(userId),
        this.options.listUnits(userId),
        this.options.listDayPlanProjections(userId, today, through),
        this.options.listUsableInventoryBalances(userId, today),
      ])
      const calculations: CompleteShoppingRecalculation[] = []
      const incomplete: IncompleteShoppingRecalculation[] = []
      const derived: ShoppingSuggestion[] = []
      for (const policy of policies) {
        const item = catalog.find((candidate) => candidate.id === policy.itemId && candidate.deletedAt == null)
        const policyUnit = units.find((candidate) => candidate.id === policy.unitId && candidate.deletedAt == null)
        if (!item || !policyUnit) {
          incomplete.push(this.incompletePolicy(policy, [{
            sourceType: 'inventory-batches', sourceQuantity: null, sourceUnit: null,
            policyQuantity: null, conversionFactor: null,
          }]))
          continue
        }
        const invalid: ShoppingQuantityEvidence[] = []
        const planned: ShoppingQuantityEvidence[] = []
        for (const projection of projections) {
          for (const projectedItem of projection.items.filter((candidate) => candidate.mode === 'planned')) {
            for (const demand of projectedItem.inventory.filter((candidate) => candidate.itemId === policy.itemId)) {
              if (demand.status === 'incomplete') {
                invalid.push({
                  sourceType: 'day-plan-item', sourceId: projectedItem.dayPlanItemId, date: projection.date,
                  sourceQuantity: null, sourceUnit: null, policyQuantity: null, conversionFactor: null,
                })
                continue
              }
              const evidence = this.convertEvidence(item, units, {
                sourceType: 'day-plan-item', sourceId: projectedItem.dayPlanItemId, date: projection.date,
                quantity: demand.plannedDemand, unit: demand.baseUnit,
              }, policyUnit.code)
              if (evidence.policyQuantity == null) invalid.push(evidence)
              else planned.push(evidence)
            }
          }
        }
        const balance = usableBalances.find((candidate) => candidate.itemId === policy.itemId)
        const stockEvidence = this.convertEvidence(item, units, {
          sourceType: 'inventory-batches', quantity: balance?.onHand ?? 0, unit: balance?.baseUnit ?? item.baseUnit,
        }, policyUnit.code)
        if (stockEvidence.policyQuantity == null) invalid.push(stockEvidence)
        const outstanding: ShoppingQuantityEvidence[] = []
        for (const formal of this.shoppingItems.filter((entry) => entry.userId === userId
          && entry.value.itemId === policy.itemId && ['added', 'shopping', 'partial'].includes(entry.value.status)).map((entry) => entry.value)) {
          const evidence = this.convertEvidence(item, units, {
            sourceType: 'shopping-item', sourceId: formal.id, quantity: formal.remainingQuantity, unit: formal.unit,
          }, policyUnit.code)
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
        const suggestedQuantity = rawShortage > 0
          ? round(Math.ceil(rawShortage / policy.packageQuantity) * policy.packageQuantity) : 0
        const calculation: CompleteShoppingRecalculation = {
          status: 'complete', itemId: policy.itemId, policyVersion: policy.version,
          unitId: policy.unitId, unit: policyUnit.code, plannedDemand, minimumStock: policy.minimumStock,
          effectiveStock, outstandingFormalQuantity, packageQuantity: policy.packageQuantity,
          rawShortage, suggestedQuantity, evidence: { planned, stock: [stockEvidence], outstanding },
        }
        calculations.push(calculation)
        if (suggestedQuantity > 0) derived.push(this.buildDerivedSuggestion(userId, policy, calculation, through))
      }
      const derivedItemIds = new Set(derived.map((value) => value.itemId))
      this.suggestions = [
        ...this.suggestions.filter((entry) => entry.userId !== userId || entry.value.origin !== 'derived' || derivedItemIds.has(entry.value.itemId)),
      ]
      for (const suggestion of derived) {
        const current = this.suggestions.find((entry) => entry.userId === userId && entry.value.origin === 'derived' && entry.value.itemId === suggestion.itemId)
        if (current) current.value = suggestion
        else this.suggestions.push({ userId, value: suggestion })
      }
      const removed = new Set(policies.map((policy) => policy.itemId).filter((itemId) => !derivedItemIds.has(itemId)))
      this.suggestions = this.suggestions.filter((entry) => entry.userId !== userId || entry.value.origin !== 'derived' || !removed.has(entry.value.itemId))
      return { through, calculations, incomplete, suggestions: clone(derived) }
    })
  }

  async createShoppingSuggestion(userId: string, input: CreateShoppingSuggestionInput, key: string) {
    return this.idempotently(userId, 'shopping:suggestion', key, input, async () => {
      validateShoppingReasonSource(input.reason)
      if (input.reason.kind !== 'manual' || input.reason.sourceType !== 'manual') {
        throw new LifeCommerceDomainError('DERIVED_SHOPPING_FACTS_SERVER_OWNED', 'Derived shopping facts can only be created by server recalculation.', 400)
      }
      await this.requireItem(userId, input.itemId)
      const current = this.suggestions.find((entry) => entry.userId === userId && entry.value.origin === 'manual' && entry.value.itemId === input.itemId)
      const suggestion = buildSuggestion(current?.value, input, {
        suggestionId: current?.value.id ?? this.createId(),
        reasonId: this.createId(),
        timestamp: this.now(),
      }, this.outstandingQuantity(userId, input.itemId, input.unit))
      if (current) current.value = suggestion
      else this.suggestions.push({ userId, value: suggestion })
      return (await this.listShopping(userId)).suggestions.find((entry) => entry.id === suggestion.id)!
    })
  }

  async listShopping(userId: string) {
    const balances = await this.options.listInventoryBalances(userId)
    const formalItems = this.shoppingItems
      .filter((entry) => entry.userId === userId)
      .map((entry) => clone(entry.value))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    const suggestions = this.suggestions
      .filter((entry) => entry.userId === userId)
      .map((entry) => {
        const value = clone(entry.value)
        const outstanding = this.outstandingQuantity(userId, value.itemId, value.unit)
        const balance = balances.find((entry) => entry.itemId === value.itemId && entry.baseUnit === value.unit)?.onHand ?? 0
        if (value.origin === 'manual') value.suggestedQuantity = round(Math.ceil(Math.max(0, value.requiredQuantity - balance - outstanding) / value.packageQuantity) * value.packageQuantity)
        return value
      })
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    return { suggestions, formalItems }
  }

  async createShoppingItem(userId: string, input: CreateShoppingItemInput, key: string) {
    return this.idempotently(userId, 'shopping:item', key, input, async () => {
      await this.requireItem(userId, input.itemId)
      const timestamp = this.now()
      const item: ShoppingItem = {
        id: this.createId(), kind: 'formal', itemId: cleanText(input.itemId, 'itemId'),
        requestedQuantity: positive(input.requestedQuantity, 'requestedQuantity'), purchasedQuantity: 0,
        remainingQuantity: input.requestedQuantity, unit: cleanText(input.unit, 'unit').toLocaleLowerCase(),
        neededOn: input.neededOn == null ? null : validDate(input.neededOn, 'neededOn'),
        priority: input.priority ?? 'normal', storeGroup: cleanText(input.storeGroup ?? '', 'storeGroup', true),
        status: 'added', version: 1, createdAt: timestamp, updatedAt: timestamp,
      }
      this.shoppingItems.push({ userId, value: item })
      return clone(item)
    })
  }

  async createPurchase(userId: string, input: CreatePurchaseInput, key: string) {
    return this.idempotently(userId, 'purchase:create', key, input, async () => {
      if (!input.items.length) throw new LifeCommerceDomainError('INVALID_INPUT', 'A purchase must contain at least one item.', 400)
      const purchasedAt = validTimestamp(input.purchasedAt, 'purchasedAt')
      const currency = cleanText(input.currency, 'currency').toUpperCase()
      const timestamp = this.now()
      const purchase: Purchase = {
        id: this.createId(), purchasedAt, currency, storeName: cleanText(input.storeName ?? '', 'storeName', true),
        totalAmountMinor: input.items.reduce((total, item) => total + nonNegative(item.amountMinor, 'amountMinor'), 0),
        createdAt: timestamp,
      }
      const units = await this.options.listUnits(userId)
      const purchaseItems: PurchaseItem[] = []
      const inventoryTransactions: InventoryTransaction[] = []
      const updatedShoppingItems: ShoppingItem[] = []
      const usedShoppingIds = new Set<string>()
      for (const inputItem of input.items) {
        const catalogItem = await this.requireItem(userId, inputItem.itemId)
        positive(inputItem.quantity, 'quantity')
        if (!Number.isInteger(inputItem.amountMinor)) throw new LifeCommerceDomainError('INVALID_INPUT', 'amountMinor must be an integer.', 400)
        let formal: Owned<ShoppingItem> | undefined
        let formalQuantity = inputItem.quantity
        if (inputItem.shoppingItemId) {
          if (usedShoppingIds.has(inputItem.shoppingItemId)) throw new LifeCommerceDomainError('INVALID_INPUT', 'A formal item can appear only once per purchase.', 400)
          usedShoppingIds.add(inputItem.shoppingItemId)
          formal = this.shoppingItems.find((entry) => entry.userId === userId && entry.value.id === inputItem.shoppingItemId)
          if (!formal || formal.value.itemId !== inputItem.itemId) throw new LifeCommerceDomainError('NOT_FOUND', 'The formal shopping item does not exist.', 404)
          const convertedFormal = convertUnit({
            quantity: inputItem.quantity, fromUnit: inputItem.unit, toBaseUnit: formal.value.unit,
            itemId: catalogItem.id, itemConversions: catalogItem.itemConversions, units,
          })
          if (convertedFormal.status === 'incomplete') throw new LifeCommerceDomainError('MISSING_CONVERSION', 'Purchase unit cannot be converted to the formal shopping unit.', 409)
          formalQuantity = convertedFormal.baseQuantity
          if (formalQuantity > formal.value.remainingQuantity) throw new LifeCommerceDomainError('PURCHASE_EXCEEDS_REMAINDER', 'Purchase quantity exceeds the formal item remainder.', 409)
        }
        const converted = convertUnit({
          quantity: inputItem.quantity, fromUnit: inputItem.unit, toBaseUnit: catalogItem.baseUnit,
          itemId: catalogItem.id, itemConversions: catalogItem.itemConversions, units,
        })
        if (converted.status === 'incomplete') throw new LifeCommerceDomainError('MISSING_CONVERSION', 'Purchase unit cannot be converted to the catalog base unit.', 409)
        const inventory = await this.options.createInventoryTransaction(userId, {
          itemId: inputItem.itemId, kind: 'purchase', quantity: inputItem.quantity,
          unit: inputItem.unit, occurredAt: purchasedAt,
          batch: {
            purchasedOn: purchasedAt.slice(0, 10), expiresOn: inputItem.expiresOn ?? null,
            locationId: inputItem.locationId ?? null,
            actualUnitCostMinor: converted.baseQuantity === 0 ? null : round(inputItem.amountMinor / converted.baseQuantity),
          },
          note: `Purchase ${purchase.id}`,
        }, `commerce:purchase:${purchase.id}:${inputItem.itemId}:${purchaseItems.length}`)
        inventoryTransactions.push(inventory)
        const purchaseItem: PurchaseItem = {
          ...clone(inputItem), id: this.createId(), purchaseId: purchase.id, shoppingItemId: inputItem.shoppingItemId ?? null,
          updateCurrentPrice: inputItem.updateCurrentPrice ?? false, inventoryTransactionId: inventory.id,
        }
        purchaseItems.push(purchaseItem)
        if (purchaseItem.updateCurrentPrice) {
          const updated = await this.options.updateCatalogItem(userId, catalogItem.id, {
            version: catalogItem.version,
            pricePoints: [{
              amountMinor: inputItem.amountMinor, currency, purchaseQuantity: inputItem.quantity,
              purchaseUnit: cleanText(inputItem.unit, 'unit').toLocaleLowerCase(), effectiveFrom: purchasedAt.slice(0, 10),
            }],
          })
          if (!updated) throw new LifeCommerceDomainError('NOT_FOUND', 'The purchased catalog item no longer exists.', 404)
        }
        if (formal) {
          const nextPurchased = round(formal.value.purchasedQuantity + formalQuantity)
          const remaining = round(Math.max(0, formal.value.requestedQuantity - nextPurchased))
          formal.value = {
            ...formal.value, purchasedQuantity: nextPurchased, remainingQuantity: remaining,
            status: remaining === 0 ? 'purchased' : 'partial', version: formal.value.version + 1, updatedAt: timestamp,
          }
          updatedShoppingItems.push(clone(formal.value))
        }
      }
      const cash: CashExpenditure = {
        id: this.createId(), amountMinor: purchase.totalAmountMinor, currency, occurredAt: purchasedAt,
        sourceType: 'purchase', sourceId: purchase.id, createdAt: timestamp,
      }
      this.purchases.push({ userId, value: purchase })
      this.purchaseItems.push(...purchaseItems.map((value) => ({ userId, value })))
      this.cashExpenditures.push({ userId, value: cash })
      return clone({ purchase, items: purchaseItems, cashExpenditure: cash, inventoryTransactions, shoppingItems: updatedShoppingItems })
    })
  }

  async createRefund(userId: string, purchaseId: string, input: CreateRefundInput, key: string) {
    const purchase = this.purchases.find((entry) => entry.userId === userId && entry.value.id === purchaseId)?.value
    if (!purchase) return undefined
    return this.idempotently(userId, `refund:${purchaseId}`, key, input, async () => {
      if (!input.items.length) throw new LifeCommerceDomainError('INVALID_INPUT', 'A refund must contain at least one item.', 400)
      const refundedAt = validTimestamp(input.refundedAt, 'refundedAt')
      const timestamp = this.now()
      const refund: Refund = {
        id: this.createId(), purchaseId, refundedAt,
        totalAmountMinor: input.items.reduce((total, item) => total + nonNegative(item.amountMinor, 'amountMinor'), 0),
        note: cleanText(input.note ?? '', 'note', true), createdAt: timestamp,
      }
      const items: RefundItem[] = []
      const inventoryTransactions: InventoryTransaction[] = []
      const usedPurchaseItems = new Set<string>()
      for (const inputItem of input.items) {
        if (usedPurchaseItems.has(inputItem.purchaseItemId)) throw new LifeCommerceDomainError('INVALID_INPUT', 'A purchase item can appear only once per refund.', 400)
        usedPurchaseItems.add(inputItem.purchaseItemId)
        const original = this.purchaseItems.find((entry) => entry.userId === userId && entry.value.id === inputItem.purchaseItemId)?.value
        if (!original || original.purchaseId !== purchaseId) {
          throw new LifeCommerceDomainError('NOT_FOUND', 'The purchase item does not exist.', 404)
        }
        const alreadyRefunded = this.refundItems
          .filter((entry) => entry.userId === userId && entry.value.purchaseItemId === original.id)
          .reduce((total, entry) => total + entry.value.quantity, 0)
        if (positive(inputItem.quantity, 'quantity') + alreadyRefunded > original.quantity) {
          throw new LifeCommerceDomainError('REFUND_EXCEEDS_PURCHASE', 'Refund quantity exceeds the purchased quantity.', 409)
        }
        const inventory = await this.options.createInventoryTransaction(userId, {
          itemId: original.itemId, kind: 'return', quantity: inputItem.quantity, unit: original.unit,
          occurredAt: refundedAt, note: `Refund ${refund.id} for purchase ${purchaseId}`,
        }, `commerce:refund:${refund.id}:${original.id}`)
        inventoryTransactions.push(inventory)
        items.push({ ...clone(inputItem), id: this.createId(), refundId: refund.id, purchaseId, itemId: original.itemId, inventoryTransactionId: inventory.id })
      }
      const cash: CashExpenditure = {
        id: this.createId(), amountMinor: -refund.totalAmountMinor, currency: purchase.currency,
        occurredAt: refundedAt, sourceType: 'refund', sourceId: refund.id, createdAt: timestamp,
      }
      this.refunds.push({ userId, value: refund })
      this.refundItems.push(...items.map((value) => ({ userId, value })))
      this.cashExpenditures.push({ userId, value: cash })
      return clone({ refund, items, cashExpenditure: cash, inventoryTransactions })
    })
  }

  async createBudget(userId: string, input: CreateBudgetInput, key: string) {
    return this.idempotently(userId, 'budget:create', key, input, async () => {
      validateBudgetInput(input)
      await this.validateBudgetReferences(userId, input)
      const timestamp = this.now()
      const budget: Budget = {
        ...clone(input), id: this.createId(), name: cleanText(input.name, 'name'),
        rolloverMinor: input.rolloverMinor ?? 0, version: 1, createdAt: timestamp, updatedAt: timestamp,
      }
      this.budgets.push({ userId, value: budget })
      return clone(budget)
    })
  }

  private async validateBudgetReferences(userId: string, input: CreateBudgetInput) {
    if (input.scope.kind === 'all-life') return
    const catalogIds = new Set((await this.options.listCatalogItems(userId)).map((item) => item.id))
    const categoryIds = new Set(await this.options.listCategoryIds(userId))
    const itemReferences = input.scope.kind === 'category' ? [] : input.scope.itemIds
    const categoryReferences = input.scope.kind === 'item' ? [] : input.scope.categoryIds
    if (itemReferences.some((id) => !catalogIds.has(id)) || categoryReferences.some((id) => !categoryIds.has(id))) {
      throw new LifeCommerceDomainError('NOT_FOUND', 'A budget scope reference does not exist for this owner.', 404)
    }
  }

  async listBudgetSummaries(userId: string, asOf: string) {
    const catalog = await this.options.listCatalogItems(userId)
    const cash = this.cashExpenditures.filter((entry) => entry.userId === userId).map((entry) => entry.value)
    const scopedCash = (budget: Budget) => cash.flatMap((entry) => {
      if (budget.scope.kind === 'all-life') return [entry]
      const lines = entry.sourceType === 'purchase'
        ? this.purchaseItems.filter((item) => item.userId === userId && item.value.purchaseId === entry.sourceId).map((item) => item.value)
        : this.refundItems.filter((item) => item.userId === userId && item.value.refundId === entry.sourceId).map((item) => item.value)
      const amountMinor = lines
        .filter((line) => budgetScopeMatchesItemIds(budget.scope, [line.itemId], catalog))
        .reduce((total, line) => total + (entry.sourceType === 'purchase' ? line.amountMinor : -line.amountMinor), 0)
      return amountMinor === 0 ? [] : [{ ...entry, amountMinor }]
    })
    return this.budgets
      .filter((entry) => entry.userId === userId)
      .map((entry) => summarizeBudget(entry.value, scopedCash(entry.value), asOf))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
  }

  async getLifeAnalytics(userId: string, from: string, to: string): Promise<LifeAnalytics> {
    const dates = datesBetween(from, to)
    const cash = this.cashExpenditures.filter((entry) => entry.userId === userId && entry.value.occurredAt.slice(0, 10) >= from && entry.value.occurredAt.slice(0, 10) <= to).map((entry) => entry.value)
    const completions = await this.options.listCompletionSnapshots(userId, from, to)
    const timelines = await Promise.all(dates.map((date) => this.options.getPlanningTimeline(userId, date)))
    const completionFacts = completions.filter((entry) => entry.costMinor != null).map((entry) => ({
      sourceType: 'completion' as const, sourceId: entry.id, amountMinor: entry.costMinor!, occurredAt: entry.completedAt,
    }))
    const cashFacts = cash.map((entry) => ({ sourceType: entry.sourceType, sourceId: entry.sourceId, amountMinor: entry.amountMinor, occurredAt: entry.occurredAt }))
    return {
      from, to,
      days: dates.map((date) => {
        const dailyCash = cashFacts.filter((entry) => entry.occurredAt.slice(0, 10) === date)
        const dailyCost = completionFacts.filter((entry) => entry.occurredAt.slice(0, 10) === date)
        const timeline = timelines.find((entry) => entry.date === date)?.timelineItems ?? []
        const actualCount = timeline.filter((entry) => entry.status === 'completed').length
        const incompleteCount = timeline.filter((entry) => !['completed', 'skipped', 'cancelled'].includes(entry.status)).length
        return {
          date,
          cashExpenditure: dailyCash.length
            ? { status: 'recorded' as const, valueMinor: dailyCash.reduce((total, entry) => total + entry.amountMinor, 0), sourceIds: dailyCash.map((entry) => entry.sourceId) }
            : { status: 'no-record' as const },
          consumptionCost: dailyCost.length
            ? { status: 'recorded' as const, valueMinor: dailyCost.reduce((total, entry) => total + entry.amountMinor, 0), sourceIds: dailyCost.map((entry) => entry.sourceId) }
            : { status: 'no-record' as const },
          planExecution: timeline.length
            ? { status: 'recorded' as const, plannedCount: timeline.length, actualCount, incompleteCount, sourceIds: timeline.map((entry) => entry.id) }
            : { status: 'no-record' as const },
        }
      }),
      totals: {
        cashExpenditureMinor: cashFacts.reduce((total, entry) => total + entry.amountMinor, 0),
        consumptionCostMinor: completionFacts.reduce((total, entry) => total + entry.amountMinor, 0),
        plannedCount: timelines.reduce((total, entry) => total + entry.timelineItems.length, 0),
        actualCount: timelines.reduce((total, entry) => total + entry.timelineItems.filter((item) => item.status === 'completed').length, 0),
        incompleteCount: timelines.reduce((total, entry) => total + entry.timelineItems.filter((item) => !['completed', 'skipped', 'cancelled'].includes(item.status)).length, 0),
      },
      drillDown: { cashExpenditure: cashFacts, consumptionCost: completionFacts },
    }
  }

  async createLifeExport(userId: string, input: { format: 'json' | 'zip'; includeAttachments: boolean }, key: string, reason: 'user-export' | 'pre-import-restore-point' = 'user-export') {
    return this.idempotently(userId, `export:${reason}`, key, input, async () => {
      const businessData = await this.options.exportBusinessData(userId)
      const catalogItems = (businessData.catalogItems ?? []) as CatalogItem[]
      const mediaAssets: PortableMediaAsset[] = []
      if (input.includeAttachments) {
        const mediaIds = [...new Set(catalogItems.flatMap((item) => item.attachments.map((attachment) => attachment.mediaId)))].sort()
        for (const mediaId of mediaIds) {
          const source = await this.options.readMediaAsset(userId, mediaId)
          if (!source) throw new LifeCommerceDomainError('ATTACHMENT_CONTENT_UNAVAILABLE', `Attachment ${mediaId} is unavailable for export.`, 409)
          mediaAssets.push(buildPortableMediaAsset(source.asset, source.bytes))
        }
      }
      const payload: PortablePayload = {
        ...businessData,
        catalogItems: catalogItems.map((item) => input.includeAttachments ? item : { ...item, attachments: [] }),
        ...(input.includeAttachments ? { mediaAssets } : {}),
        inventoryPolicies: this.policies.filter((entry) => entry.userId === userId).map((entry) => clone(entry.value)),
        shoppingSuggestions: this.suggestions.filter((entry) => entry.userId === userId).map((entry) => clone(entry.value)),
        shoppingItems: this.shoppingItems.filter((entry) => entry.userId === userId).map((entry) => clone(entry.value)),
        purchases: this.purchases.filter((entry) => entry.userId === userId).map((entry) => clone(entry.value)),
        purchaseItems: this.purchaseItems.filter((entry) => entry.userId === userId).map((entry) => clone(entry.value)),
        refunds: this.refunds.filter((entry) => entry.userId === userId).map((entry) => clone(entry.value)),
        refundItems: this.refundItems.filter((entry) => entry.userId === userId).map((entry) => clone(entry.value)),
        budgets: this.budgets.filter((entry) => entry.userId === userId).map((entry) => clone(entry.value)),
        cashExpenditures: this.cashExpenditures.filter((entry) => entry.userId === userId).map((entry) => clone(entry.value)),
      }
      const canonicalJson = stableJson(payload)
      const recordCounts = Object.fromEntries(Object.entries(payload)
        .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
        .map(([name, values]) => [name, values.length]))
      const base = { id: this.createId(), status: 'completed' as const, reason, format: input.format, formatVersion: 1 as const, recordCounts, createdAt: this.now() }
      const job: ExportJob = input.format === 'json'
        ? { ...base, checksumSha256: checksumSha256(canonicalJson), canonicalJson, payload }
        : (() => {
          const attachmentManifest = mediaAssets.map((asset) => ({ id: asset.id, entry: asset.archiveEntry, checksumSha256: asset.checksum, sizeBytes: asset.sizeBytes }))
          const manifest = stableJson({ formatVersion: 1, recordCounts, payloadChecksumSha256: checksumSha256(canonicalJson), attachments: attachmentManifest })
          const archiveEntries = ['manifest.json', 'lifeops.json', ...mediaAssets.map((asset) => asset.archiveEntry)]
          const archive = createStoredZip([
            { name: archiveEntries[0]!, contents: manifest },
            { name: archiveEntries[1]!, contents: canonicalJson },
            ...mediaAssets.map((asset) => ({ name: asset.archiveEntry, contents: Buffer.from(asset.bytesBase64, 'base64') })),
          ])
          return { ...base, checksumSha256: checksumSha256(archive), archiveBase64: archive.toString('base64'), archiveEntries }
        })()
      this.exports.push({ userId, value: job })
      return clone(job)
    })
  }

  async listLifeExports(userId: string) {
    return this.exports.filter((entry) => entry.userId === userId).map((entry) => clone(entry.value)).sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id))
  }

  async previewLifeImport(userId: string, input: PreviewLifeImportInput, key: string) {
    return this.idempotently(userId, 'import:preview', key, input, async () => {
      if (input.formatVersion !== 1) throw new LifeCommerceDomainError('IMPORT_VERSION_UNSUPPORTED', 'Only LifeOps portable format version 1 is supported.', 409)
      if ((input.canonicalJson == null) === (input.archiveBase64 == null)) throw new LifeCommerceDomainError('INVALID_IMPORT', 'Provide exactly one JSON payload or ZIP archive.', 400)
      let canonicalJson: string
      if (input.archiveBase64 != null) {
        const archive = Buffer.from(input.archiveBase64, 'base64')
        if (checksumSha256(archive) !== input.checksumSha256.toLocaleLowerCase()) throw new LifeCommerceDomainError('IMPORT_CHECKSUM_MISMATCH', 'Import checksum does not match its ZIP archive.', 400)
        canonicalJson = portableJsonFromArchive(archive, input.formatVersion)
      } else {
        canonicalJson = input.canonicalJson!
        if (checksumSha256(canonicalJson) !== input.checksumSha256.toLocaleLowerCase()) throw new LifeCommerceDomainError('IMPORT_CHECKSUM_MISMATCH', 'Import checksum does not match its payload.', 400)
      }
      let parsed: unknown
      try { parsed = JSON.parse(canonicalJson) } catch { throw new LifeCommerceDomainError('INVALID_IMPORT', 'Import payload is not valid JSON.', 400) }
      const payload = validatePortablePayload(parsed)
      const currentCatalog = await this.options.listCatalogItems(userId)
      const conflicts = payload.catalogItems.flatMap((raw) => {
        const incoming = raw as { id?: unknown; version?: unknown }
        const current = currentCatalog.find((item) => item.id === incoming.id)
        if (!current) return []
        return [{
          entityType: 'catalog-item', entityId: current.id, currentVersion: current.version,
          incomingVersion: typeof incoming.version === 'number' ? incoming.version : 0,
          resolutions: ['keep-current', 'use-imported', 'duplicate'] as Array<'keep-current' | 'use-imported' | 'duplicate'>,
        }]
      })
      const errors = [
        ...validatePortablePayloadRelationships(payload, input.mode),
        ...payload.budgets.flatMap((raw) => {
        try {
          validateBudgetInput(raw)
          return []
        } catch (error) {
          const entity = raw as { id?: unknown }
          return [{ entityType: 'budget', entityId: typeof entity.id === 'string' ? entity.id : 'unknown', code: error instanceof LifeCommerceDomainError ? error.code : 'INVALID_INPUT', message: error instanceof Error ? error.message : 'Invalid budget row.' }]
        }
        }),
      ]
      const preview: ImportPreview = {
        id: this.createId(), mode: input.mode, payload, conflicts: clone(conflicts), errors,
        status: errors.length ? 'invalid' : conflicts.length ? 'conflicts' : 'ready', createdAt: this.now(),
      }
      this.imports.push({ userId, value: preview })
      return clone(preview)
    })
  }

  async ensureImportRestorePoint(userId: string, importId: string, resolutions: ImportResolution[]): Promise<string | undefined> {
    const preview = this.imports.find((entry) => entry.userId === userId && entry.value.id === importId)?.value
    if (!preview) return undefined
    const unresolved = preview.conflicts.filter((conflict) => !resolutions.some((resolution) => resolution.entityType === conflict.entityType && resolution.entityId === conflict.entityId))
    if (unresolved.length) return undefined
    const restoreKey = `${userId}\0${importId}`
    const existing = this.importRestorePoints.get(restoreKey)
    if (existing) return existing
    const restorePoint = await this.createLifeExport(userId, { format: 'json', includeAttachments: false }, `restore-point:${importId}`, 'pre-import-restore-point')
    this.importRestorePoints.set(restoreKey, restorePoint.id)
    return restorePoint.id
  }

  async applyLifeImport(userId: string, importId: string, resolutions: ImportResolution[], key: string): Promise<ImportApplyResult | undefined> {
    const preview = this.imports.find((entry) => entry.userId === userId && entry.value.id === importId)?.value
    if (!preview) return undefined
    const terminalKey = `${userId}\0${importId}`
    const terminal = this.importApplyResults.get(terminalKey)
    if (terminal) return clone(terminal)
    const restorePointExportId = await this.ensureImportRestorePoint(userId, importId, resolutions)
    const result = await this.idempotently<ImportApplyResult>(userId, `import:apply:${importId}`, key, resolutions, async () => {
      const unresolved = preview.conflicts.filter((conflict) => !resolutions.some((resolution) => resolution.entityType === conflict.entityType && resolution.entityId === conflict.entityId))
      if (unresolved.length) return { status: 'rejected', code: 'IMPORT_CONFLICTS_UNRESOLVED', message: 'Every import conflict requires an explicit resolution.', appliedRows: 0 }
      if (!restorePointExportId) throw new LifeCommerceDomainError('IMPORT_RESTORE_POINT_MISSING', 'The import restore point was not persisted before applying rows.', 409)
      if (preview.errors.length) return { status: 'rejected', code: 'IMPORT_VALIDATION_FAILED', message: 'Import validation failed; no rows were applied.', restorePointExportId, appliedRows: 0 }
      const currentCatalog = await this.options.listCatalogItems(userId)
      const resolvedPayload = this.resolveCatalogConflicts(preview.payload, currentCatalog, preview.conflicts, resolutions)
      if (preview.mode === 'replace') {
        await this.options.replaceBusinessData(userId, resolvedPayload)
        await this.options.onImportBusinessDataReplaced?.(userId)
        this.policies = this.policies.filter((entry) => entry.userId !== userId)
        this.suggestions = this.suggestions.filter((entry) => entry.userId !== userId)
        this.shoppingItems = this.shoppingItems.filter((entry) => entry.userId !== userId)
        this.purchases = this.purchases.filter((entry) => entry.userId !== userId)
        this.purchaseItems = this.purchaseItems.filter((entry) => entry.userId !== userId)
        this.refunds = this.refunds.filter((entry) => entry.userId !== userId)
        this.refundItems = this.refundItems.filter((entry) => entry.userId !== userId)
        this.cashExpenditures = this.cashExpenditures.filter((entry) => entry.userId !== userId)
        this.budgets = this.budgets.filter((entry) => entry.userId !== userId)
      }
      const imported = <T>(key: string) => clone((Array.isArray(preview.payload[key]) ? preview.payload[key] : []) as T[])
      if (preview.mode === 'replace') {
        this.policies.push(...imported<InventoryPolicy>('inventoryPolicies').map((value) => ({ userId, value })))
        this.suggestions.push(...imported<ShoppingSuggestion>('shoppingSuggestions').map((value) => ({ userId, value })))
        this.shoppingItems.push(...imported<ShoppingItem>('shoppingItems').map((value) => ({ userId, value })))
        this.purchases.push(...imported<Purchase>('purchases').map((value) => ({ userId, value })))
        this.purchaseItems.push(...imported<PurchaseItem>('purchaseItems').map((value) => ({ userId, value })))
        this.refunds.push(...imported<Refund>('refunds').map((value) => ({ userId, value })))
        this.refundItems.push(...imported<RefundItem>('refundItems').map((value) => ({ userId, value })))
        this.cashExpenditures.push(...imported<CashExpenditure>('cashExpenditures').map((value) => ({ userId, value })))
      } else {
        await this.options.mergeCatalogItems(userId, resolvedPayload.catalogItems as CatalogItem[])
      }
      for (const budget of preview.payload.budgets) {
        validateBudgetInput(budget)
        this.budgets.push({ userId, value: clone(budget) })
      }
      let appliedRows = 0
      for (const value of Object.values(preview.payload)) if (Array.isArray(value)) appliedRows += value.length
      if (preview.mode === 'replace' && resolvedPayload.mediaAssets?.length) {
        const mediaRestore = await this.options.restoreMediaAssets(userId, resolvedPayload.mediaAssets)
        await mediaRestore.commit()
      }
      preview.status = 'applied'
      return { status: 'applied' as const, importId, restorePointExportId, appliedRows }
    })
    if (result.status === 'applied') this.importApplyResults.set(terminalKey, clone(result))
    return result
  }

  private resolveCatalogConflicts(
    payload: PortablePayload,
    current: CatalogItem[],
    conflicts: ImportPreview['conflicts'],
    resolutions: ImportResolution[],
  ): PortablePayload {
    const resolutionFor = (id: string) => resolutions.find((entry) => entry.entityType === 'catalog-item' && entry.entityId === id)?.resolution
    const catalogItems = payload.catalogItems.map((raw) => {
      const incoming = clone(raw as CatalogItem)
      if (!conflicts.some((conflict) => conflict.entityType === 'catalog-item' && conflict.entityId === incoming.id)) return incoming
      const resolution = resolutionFor(incoming.id)
      if (resolution === 'keep-current') return clone(current.find((item) => item.id === incoming.id)!)
      if (resolution === 'duplicate') {
        const id = this.createId()
        return {
          ...incoming,
          id,
          itemConversions: incoming.itemConversions.map((conversion) => ({ ...conversion, itemId: id })),
          pricePoints: incoming.pricePoints.map((point) => ({ ...point, id: this.createId() })),
        }
      }
      return incoming
    })
    return { ...clone(payload), catalogItems }
  }

  private unitDefinitions(units: LifeUnit[]) {
    return units.map((unit) => ({
      code: unit.code, dimension: unit.dimension, baseCode: unit.baseCode, toBaseFactor: unit.toBaseFactor,
    }))
  }

  private convertEvidence(
    item: CatalogItem,
    units: LifeUnit[],
    source: {
      sourceType: ShoppingQuantityEvidence['sourceType']
      sourceId?: string
      date?: string
      quantity: number
      unit: string
    },
    policyUnit: string,
  ): ShoppingQuantityEvidence {
    const converted = convertUnit({
      itemId: item.id, quantity: source.quantity, fromUnit: source.unit, toBaseUnit: policyUnit,
      itemConversions: item.itemConversions, units: this.unitDefinitions(units),
    })
    const factor = convertUnit({
      itemId: item.id, quantity: 1, fromUnit: source.unit, toBaseUnit: policyUnit,
      itemConversions: item.itemConversions, units: this.unitDefinitions(units),
    })
    return {
      sourceType: source.sourceType, ...(source.sourceId ? { sourceId: source.sourceId } : {}),
      ...(source.date ? { date: source.date } : {}), sourceQuantity: source.quantity, sourceUnit: source.unit,
      policyQuantity: converted.status === 'complete' ? converted.baseQuantity : null,
      conversionFactor: factor.status === 'complete' ? factor.baseQuantity : null,
    }
  }

  private incompletePolicy(policy: InventoryPolicy, evidence: ShoppingQuantityEvidence[]): IncompleteShoppingRecalculation {
    return {
      status: 'incomplete', itemId: policy.itemId, policyVersion: policy.version,
      unitId: policy.unitId, unit: policy.unit, reason: 'missing_conversion', evidence,
    }
  }

  private buildDerivedSuggestion(
    userId: string,
    policy: InventoryPolicy,
    calculation: CompleteShoppingRecalculation,
    through: string,
  ): ShoppingSuggestion {
    const current = this.suggestions.find((entry) => entry.userId === userId
      && entry.value.origin === 'derived' && entry.value.itemId === policy.itemId)?.value
    const timestamp = this.now()
    const plannedBySource = new Map<string, ShoppingQuantityEvidence>()
    for (const evidence of calculation.evidence.planned) {
      const key = `${evidence.sourceId}\0${evidence.date}`
      const existing = plannedBySource.get(key)
      plannedBySource.set(key, existing ? {
        ...existing,
        sourceQuantity: round((existing.sourceQuantity ?? 0) + (evidence.sourceQuantity ?? 0)),
        policyQuantity: round((existing.policyQuantity ?? 0) + (evidence.policyQuantity ?? 0)),
      } : evidence)
    }
    const reasons: ShoppingReason[] = [...plannedBySource.values()].filter((evidence) => (evidence.policyQuantity ?? 0) > 0).map((evidence) => {
      const previous = current?.reasons.find((reason) => reason.sourceType === 'day-plan' && reason.sourceId === evidence.sourceId)
      return {
        id: previous?.id ?? this.createId(), kind: 'planned_shortage' as const, sourceType: 'day-plan' as const,
        sourceId: evidence.sourceId!, requiredQuantity: evidence.policyQuantity!,
        sourceQuantity: evidence.sourceQuantity!, sourceUnit: evidence.sourceUnit!, conversionFactor: evidence.conversionFactor!,
        requiredOn: evidence.date ?? null, createdAt: previous?.createdAt ?? timestamp,
      }
    })
    if (policy.minimumStock > 0) {
      const previous = current?.reasons.find((reason) => reason.sourceType === 'inventory-policy' && reason.sourceId === policy.id)
      reasons.push({
        id: previous?.id ?? this.createId(), kind: 'minimum_stock', sourceType: 'inventory-policy',
        sourceId: policy.id, requiredQuantity: policy.minimumStock, sourceQuantity: policy.minimumStock,
        sourceUnit: calculation.unit, conversionFactor: 1, requiredOn: null, createdAt: previous?.createdAt ?? timestamp,
      })
    }
    return {
      id: current?.id ?? this.createId(), kind: 'suggestion', origin: 'derived', through,
      itemId: policy.itemId, requiredQuantity: round(calculation.plannedDemand + policy.minimumStock),
      suggestedQuantity: calculation.suggestedQuantity, unit: calculation.unit,
      packageQuantity: policy.packageQuantity, reasons,
      createdAt: current?.createdAt ?? timestamp, updatedAt: timestamp,
    }
  }

  private outstandingQuantity(userId: string, itemId: string, unit: string) {
    return round(this.shoppingItems
      .filter((entry) => entry.userId === userId && entry.value.itemId === itemId && entry.value.unit === unit.trim().toLocaleLowerCase())
      .filter((entry) => !['cancelled', 'archived', 'purchased'].includes(entry.value.status))
      .reduce((total, entry) => total + entry.value.remainingQuantity, 0))
  }

  private async requireItem(userId: string, itemId: string) {
    const item = await this.options.getCatalogItem(userId, itemId)
    if (!item) throw new LifeCommerceDomainError('NOT_FOUND', 'The catalog item does not exist.', 404)
    return item
  }

  private async idempotently<T>(userId: string, operation: string, rawKey: string, input: unknown, work: () => Promise<T>): Promise<T> {
    const key = normalizeCommerceIdempotencyKey(rawKey)
    const mapKey = `${userId}\0${operation}\0${key}`
    const hash = requestHash(input)
    const existing = this.idempotency.get(mapKey)
    if (existing) {
      if (existing.hash !== hash) throw new LifeCommerceDomainError('IDEMPOTENCY_CONFLICT', 'The idempotency key belongs to a different commerce request.', 409)
      return clone(await existing.promise as T)
    }
    const promise = Promise.resolve().then(work)
    this.idempotency.set(mapKey, { hash, promise })
    try { return clone(await promise) } catch (error) { this.idempotency.delete(mapKey); throw error }
  }
}
