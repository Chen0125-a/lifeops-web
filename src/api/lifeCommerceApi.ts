import type {
  Budget,
  BudgetSummary,
  CreateBudgetInput,
  CreatePurchaseInput,
  CreateRefundInput,
  CreateShoppingItemInput,
  CreateShoppingSuggestionInput,
  ExportJob,
  ImportApplyResult,
  ImportPreview,
  ImportResolution,
  InventoryPolicy,
  LifeAnalytics,
  PurchaseResult,
  RefundResult,
  ShoppingItem,
  ShoppingRecalculationResult,
  ShoppingSuggestion,
  UpsertInventoryPolicyInput,
} from '../domain/lifeCommerce'
import { http } from './httpClient'
import { queryClient } from './queryClient'
import { queryKeys } from './queryKeys'

const segment = (value: string) => encodeURIComponent(value)

async function mutation<T>(request: Promise<T>) {
  const result = await request
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.lifeCommerce.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.lifeInventory.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.lifeCatalog.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.lifePlanning.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.lifeRecipes.all }),
  ])
  return result
}

export const lifeCommerceApi = {
  listInventoryPolicies: (signal?: AbortSignal): Promise<InventoryPolicy[]> =>
    http.request('/life/inventory-policies', { signal }),
  listShopping: (signal?: AbortSignal): Promise<{ suggestions: ShoppingSuggestion[]; formalItems: ShoppingItem[] }> =>
    http.request('/life/shopping', { signal }),
  listBudgets: (asOf: string, signal?: AbortSignal): Promise<BudgetSummary[]> => {
    const query = new URLSearchParams({ asOf })
    return http.request(`/life/budgets?${query}`, { signal })
  },
  getAnalytics: (input: { from: string; to: string }, signal?: AbortSignal): Promise<LifeAnalytics> => {
    const query = new URLSearchParams(input)
    return http.request(`/life/analytics?${query}`, { signal })
  },
  listExports: (signal?: AbortSignal): Promise<ExportJob[]> =>
    http.request('/life/exports', { signal }),

  upsertInventoryPolicy: (
    itemId: string,
    input: UpsertInventoryPolicyInput,
    idempotencyKey: string,
    csrf?: string,
  ): Promise<InventoryPolicy> => mutation(
    http.request(`/life/inventory-policies/${segment(itemId)}`, { method: 'PUT', body: input, csrf, idempotencyKey }),
  ),
  recalculateShopping: (
    input: { through: string },
    idempotencyKey: string,
    csrf?: string,
  ): Promise<ShoppingRecalculationResult> => mutation(
    http.request('/life/shopping/recalculate', { method: 'POST', body: input, csrf, idempotencyKey }),
  ),

  createSuggestion: (
    input: CreateShoppingSuggestionInput,
    idempotencyKey: string,
    csrf?: string,
  ): Promise<ShoppingSuggestion> => mutation(
    http.request('/life/shopping/suggestions', { method: 'POST', body: input, csrf, idempotencyKey }),
  ),
  createShoppingItem: (
    input: CreateShoppingItemInput,
    idempotencyKey: string,
    csrf?: string,
  ): Promise<ShoppingItem> => mutation(
    http.request('/life/shopping/items', { method: 'POST', body: input, csrf, idempotencyKey }),
  ),
  createPurchase: (
    input: CreatePurchaseInput,
    idempotencyKey: string,
    csrf?: string,
  ): Promise<PurchaseResult> => mutation(
    http.request('/life/purchases', { method: 'POST', body: input, csrf, idempotencyKey }),
  ),
  createRefund: (
    purchaseId: string,
    input: CreateRefundInput,
    idempotencyKey: string,
    csrf?: string,
  ): Promise<RefundResult> => mutation(
    http.request(`/life/purchases/${segment(purchaseId)}/refunds`, {
      method: 'POST', body: input, csrf, idempotencyKey,
    }),
  ),
  createBudget: (
    input: CreateBudgetInput,
    idempotencyKey: string,
    csrf?: string,
  ): Promise<Budget> => mutation(
    http.request('/life/budgets', { method: 'POST', body: input, csrf, idempotencyKey }),
  ),
  createExport: (
    input: { format: 'json' | 'zip'; includeAttachments: boolean },
    idempotencyKey: string,
    csrf?: string,
  ): Promise<ExportJob> => mutation(
    http.request('/life/exports', { method: 'POST', body: input, csrf, idempotencyKey }),
  ),
  previewImport: (
    input: { formatVersion: number; checksumSha256: string; canonicalJson?: string; archiveBase64?: string; mode: 'merge' | 'replace' },
    idempotencyKey: string,
    csrf?: string,
  ): Promise<ImportPreview> => mutation(
    http.request('/life/imports/preview', { method: 'POST', body: input, csrf, idempotencyKey }),
  ),
  applyImport: (
    importId: string,
    resolutions: ImportResolution[],
    idempotencyKey: string,
    csrf?: string,
  ): Promise<ImportApplyResult> => mutation(
    http.request(`/life/imports/${segment(importId)}/apply`, {
      method: 'POST', body: { resolutions }, csrf, idempotencyKey,
    }),
  ),
}
