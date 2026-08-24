import type {
  Budget,
  BudgetSummary,
  CreateBudgetInput,
  CreatePurchaseInput,
  CreateRefundInput,
  CreateShoppingItemInput,
  CreateShoppingSuggestionInput,
  ExportJob,
  ImportPreview,
  InventoryPolicy,
  LifeAnalytics,
  PurchaseResult,
  RefundResult,
  ShoppingItem,
  ShoppingSuggestion,
  ShoppingRecalculationResult,
  UpsertInventoryPolicyInput,
} from '../domain/life/commerce.js'

export type ImportResolution = {
  entityType: string
  entityId: string
  resolution: 'keep-current' | 'use-imported' | 'duplicate'
}

export type PreviewLifeImportInput = {
  formatVersion: number
  checksumSha256: string
  mode: 'merge' | 'replace'
  canonicalJson?: string
  archiveBase64?: string
}

export type ImportApplyResult =
  | { status: 'applied'; importId: string; restorePointExportId: string; appliedRows: number }
  | { status: 'rejected'; code: 'IMPORT_CONFLICTS_UNRESOLVED' | 'IMPORT_VALIDATION_FAILED'; message: string; restorePointExportId?: string; appliedRows: 0 }

export interface LifeCommerceStore {
  listInventoryPolicies(userId: string): Promise<InventoryPolicy[]>
  upsertInventoryPolicy(userId: string, itemId: string, input: UpsertInventoryPolicyInput, idempotencyKey: string): Promise<{ policy: InventoryPolicy; created: boolean }>
  recalculateShopping(userId: string, input: { through: string }, idempotencyKey: string): Promise<ShoppingRecalculationResult>
  createShoppingSuggestion(userId: string, input: CreateShoppingSuggestionInput, idempotencyKey: string): Promise<ShoppingSuggestion>
  listShopping(userId: string): Promise<{ suggestions: ShoppingSuggestion[]; formalItems: ShoppingItem[] }>
  createShoppingItem(userId: string, input: CreateShoppingItemInput, idempotencyKey: string): Promise<ShoppingItem>
  createPurchase(userId: string, input: CreatePurchaseInput, idempotencyKey: string): Promise<PurchaseResult>
  createRefund(userId: string, purchaseId: string, input: CreateRefundInput, idempotencyKey: string): Promise<RefundResult | undefined>
  createBudget(userId: string, input: CreateBudgetInput, idempotencyKey: string): Promise<Budget>
  listBudgetSummaries(userId: string, asOf: string): Promise<BudgetSummary[]>
  getLifeAnalytics(userId: string, from: string, to: string): Promise<LifeAnalytics>
  createLifeExport(userId: string, input: { format: 'json' | 'zip'; includeAttachments: boolean }, idempotencyKey: string, reason?: 'user-export' | 'pre-import-restore-point'): Promise<ExportJob>
  listLifeExports(userId: string): Promise<ExportJob[]>
  previewLifeImport(userId: string, input: PreviewLifeImportInput, idempotencyKey: string): Promise<ImportPreview>
  applyLifeImport(userId: string, importId: string, resolutions: ImportResolution[], idempotencyKey: string): Promise<ImportApplyResult | undefined>
}
