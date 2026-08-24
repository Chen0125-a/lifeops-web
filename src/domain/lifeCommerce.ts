import type { InventoryTransaction } from './lifeInventory'

export type ShoppingReasonKind = 'planned_shortage' | 'minimum_stock' | 'expiring' | 'manual'
export type ShoppingReasonSourceType = 'day-plan' | 'inventory-policy' | 'inventory-batch' | 'manual'
export type ShoppingItemStatus = 'added' | 'shopping' | 'partial' | 'purchased' | 'deferred' | 'cancelled' | 'archived'

export interface ShoppingReason {
  id: string
  kind: ShoppingReasonKind
  sourceType: ShoppingReasonSourceType
  sourceId: string
  requiredQuantity: number
  sourceQuantity: number
  sourceUnit: string
  conversionFactor: number
  requiredOn: string | null
  createdAt: string
}

export interface ShoppingSuggestion {
  id: string
  kind: 'suggestion'
  origin: 'manual' | 'derived'
  through: string | null
  itemId: string
  requiredQuantity: number
  suggestedQuantity: number
  unit: string
  packageQuantity: number
  reasons: ShoppingReason[]
  createdAt: string
  updatedAt: string
}

export interface InventoryPolicy {
  id: string
  itemId: string
  minimumStock: number
  packageQuantity: number
  unitId: string
  unit: string
  version: number
  createdAt: string
  updatedAt: string
}

export interface UpsertInventoryPolicyInput {
  minimumStock: number
  packageQuantity: number
  unitId: string
  version?: number
}

export interface ShoppingQuantityEvidence {
  sourceType: 'day-plan-item' | 'inventory-batches' | 'shopping-item'
  sourceId?: string
  date?: string
  sourceQuantity: number | null
  sourceUnit: string | null
  policyQuantity: number | null
  conversionFactor: number | null
}

export interface CompleteShoppingRecalculation {
  status: 'complete'
  itemId: string
  policyVersion: number
  unitId: string
  unit: string
  plannedDemand: number
  minimumStock: number
  effectiveStock: number
  outstandingFormalQuantity: number
  packageQuantity: number
  rawShortage: number
  suggestedQuantity: number
  evidence: {
    planned: ShoppingQuantityEvidence[]
    stock: ShoppingQuantityEvidence[]
    outstanding: ShoppingQuantityEvidence[]
  }
}

export interface IncompleteShoppingRecalculation {
  status: 'incomplete'
  itemId: string
  policyVersion: number
  unitId: string
  unit: string
  reason: 'missing_conversion'
  evidence: ShoppingQuantityEvidence[]
}

export interface ShoppingRecalculationResult {
  through: string
  calculations: CompleteShoppingRecalculation[]
  incomplete: IncompleteShoppingRecalculation[]
  suggestions: ShoppingSuggestion[]
}

export interface ShoppingItem {
  id: string
  kind: 'formal'
  itemId: string
  requestedQuantity: number
  purchasedQuantity: number
  remainingQuantity: number
  unit: string
  neededOn: string | null
  priority: 'low' | 'normal' | 'high'
  storeGroup: string
  status: ShoppingItemStatus
  version: number
  createdAt: string
  updatedAt: string
}

export interface CreateShoppingSuggestionInput {
  itemId: string
  requiredQuantity: number
  unit: string
  packageQuantity: number
  reason: {
    kind: ShoppingReasonKind
    sourceType: ShoppingReasonSourceType
    sourceId: string
    requiredOn: string | null
  }
}

export interface CreateShoppingItemInput {
  itemId: string
  requestedQuantity: number
  unit: string
  neededOn?: string | null
  priority?: 'low' | 'normal' | 'high'
  storeGroup?: string
}

export interface PurchaseItemInput {
  shoppingItemId?: string | null
  itemId: string
  quantity: number
  unit: string
  amountMinor: number
  updateCurrentPrice?: boolean
  expiresOn?: string | null
  locationId?: string | null
}

export interface CreatePurchaseInput {
  purchasedAt: string
  currency: string
  storeName?: string
  items: PurchaseItemInput[]
}

export interface PurchaseItem extends PurchaseItemInput {
  id: string
  purchaseId: string
  shoppingItemId: string | null
  updateCurrentPrice: boolean
  inventoryTransactionId: string
}

export interface Purchase {
  id: string
  purchasedAt: string
  currency: string
  storeName: string
  totalAmountMinor: number
  createdAt: string
}

export interface CashExpenditure {
  id: string
  amountMinor: number
  currency: string
  occurredAt: string
  sourceType: 'purchase' | 'refund'
  sourceId: string
  createdAt: string
}

export interface PurchaseResult {
  purchase: Purchase
  items: PurchaseItem[]
  cashExpenditure: CashExpenditure
  inventoryTransactions: InventoryTransaction[]
  shoppingItems: ShoppingItem[]
}

export interface RefundItemInput { purchaseItemId: string; quantity: number; amountMinor: number }
export interface CreateRefundInput { refundedAt: string; items: RefundItemInput[]; note?: string }

export interface RefundItem extends RefundItemInput {
  id: string
  refundId: string
  purchaseId: string
  itemId: string
  inventoryTransactionId: string
}

export interface Refund {
  id: string
  purchaseId: string
  refundedAt: string
  totalAmountMinor: number
  note: string
  createdAt: string
}

export interface RefundResult {
  refund: Refund
  items: RefundItem[]
  cashExpenditure: CashExpenditure
  inventoryTransactions: InventoryTransaction[]
}

export type BudgetScope =
  | { kind: 'all-life' }
  | { kind: 'item'; itemIds: string[] }
  | { kind: 'category'; categoryIds: string[] }
  | { kind: 'custom'; itemIds: string[]; categoryIds: string[] }

export interface CreateBudgetInput {
  name: string
  scope: BudgetScope
  period: { kind: 'weekly' | 'monthly' | 'custom'; startsOn: string; endsOn: string }
  limitMinor: number
  thresholds: number[]
  rolloverMinor?: number
}

export interface Budget extends CreateBudgetInput {
  id: string
  rolloverMinor: number
  version: number
  createdAt: string
  updatedAt: string
}

export interface BudgetSummary extends Budget {
  spentMinor: number
  remainingMinor: number
  thresholdStatus: 'ok' | 'warning' | 'critical' | 'exceeded'
  forecast: { status: 'complete'; projectedMinor: number } | { status: 'insufficient-data' }
}

export interface LifeAnalytics {
  from: string
  to: string
  days: Array<{
    date: string
    cashExpenditure: { status: 'recorded'; valueMinor: number; sourceIds: string[] } | { status: 'no-record' }
    consumptionCost: { status: 'recorded'; valueMinor: number; sourceIds: string[] } | { status: 'no-record' }
    planExecution: { status: 'recorded'; plannedCount: number; actualCount: number; incompleteCount: number; sourceIds: string[] } | { status: 'no-record' }
  }>
  totals: { cashExpenditureMinor: number; consumptionCostMinor: number; plannedCount: number; actualCount: number; incompleteCount: number }
  drillDown: {
    cashExpenditure: Array<{ sourceType: 'purchase' | 'refund'; sourceId: string; amountMinor: number; occurredAt: string }>
    consumptionCost: Array<{ sourceType: 'completion'; sourceId: string; amountMinor: number; occurredAt: string }>
  }
}

export interface PortablePayload {
  catalogItems: Array<Record<string, unknown>>
  inventoryPolicies?: InventoryPolicy[]
  shoppingItems: ShoppingItem[]
  purchases: Purchase[]
  refunds: Refund[]
  budgets: Budget[]
  [key: string]: unknown
}

interface ExportJobBase {
  id: string
  status: 'completed'
  reason: 'user-export' | 'pre-import-restore-point'
  formatVersion: 1
  checksumSha256: string
  recordCounts: Record<string, number>
  createdAt: string
}

export type ExportJob =
  | (ExportJobBase & { format: 'json'; payload: PortablePayload; canonicalJson: string })
  | (ExportJobBase & { format: 'zip'; archiveBase64: string; archiveEntries: string[] })

export interface ImportConflict {
  entityType: string
  entityId: string
  currentVersion: number
  incomingVersion: number
  resolutions: Array<'keep-current' | 'use-imported' | 'duplicate'>
}

export interface ImportValidationError { entityType: string; entityId: string; code: string; message: string }
export interface ImportPreview {
  id: string
  mode: 'merge' | 'replace'
  status: 'ready' | 'conflicts' | 'invalid' | 'applied'
  payload: PortablePayload
  conflicts: ImportConflict[]
  errors: ImportValidationError[]
  createdAt: string
}

export interface ImportResolution {
  entityType: string
  entityId: string
  resolution: 'keep-current' | 'use-imported' | 'duplicate'
}

export interface ImportApplyResult {
  status: 'applied'
  importId: string
  restorePointExportId: string
  appliedRows: number
}

export interface ImportApplyFailureDetails {
  restorePointExportId?: string
  appliedRows: 0
}
