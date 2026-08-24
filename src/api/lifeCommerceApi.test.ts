import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type {
  BudgetSummary,
  ExportJob,
  ImportApplyResult,
  ImportApplyFailureDetails,
  ImportPreview,
  InventoryPolicy,
  LifeAnalytics,
  PurchaseResult,
  RefundResult,
  ShoppingItem,
  ShoppingRecalculationResult,
  ShoppingSuggestion,
} from '../domain/lifeCommerce'
import { http } from './httpClient'
import { lifeCommerceApi } from './lifeCommerceApi'
import { queryClient } from './queryClient'
import { queryKeys } from './queryKeys'

vi.mock('./httpClient', () => ({ http: { request: vi.fn() } }))
vi.mock('./queryClient', () => ({ queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) } }))
const request = vi.mocked(http.request)
const invalidate = vi.mocked(queryClient.invalidateQueries)

describe('lifeCommerceApi', () => {
  beforeEach(() => { request.mockReset(); request.mockResolvedValue(undefined); invalidate.mockClear() })

  it('uses cancellable shopping, budget, analytics and export reads with encoded query values', async () => {
    const signal = new AbortController().signal
    await lifeCommerceApi.listInventoryPolicies(signal)
    await lifeCommerceApi.listShopping(signal)
    await lifeCommerceApi.listBudgets('2026/08/14', signal)
    await lifeCommerceApi.getAnalytics({ from: '2026/08/01', to: '2026/08/31' }, signal)
    await lifeCommerceApi.listExports(signal)
    expect(request.mock.calls).toEqual([
      ['/life/inventory-policies', { signal }],
      ['/life/shopping', { signal }],
      ['/life/budgets?asOf=2026%2F08%2F14', { signal }],
      ['/life/analytics?from=2026%2F08%2F01&to=2026%2F08%2F31', { signal }],
      ['/life/exports', { signal }],
    ])
  })

  it('preserves CSRF, idempotency and encoded identities across commerce and portability writes', async () => {
    const suggestion = {
      itemId: 'item/one', requiredQuantity: 4, unit: 'each', packageQuantity: 2,
      reason: { kind: 'manual' as const, sourceType: 'manual' as const, sourceId: 'source/one', requiredOn: null },
    }
    const shopping = { itemId: 'item/one', requestedQuantity: 4, unit: 'each' }
    const purchase = {
      purchasedAt: '2026-08-14T09:00:00.000Z', currency: 'CNY',
      items: [{ shoppingItemId: 'shopping/one', itemId: 'item/one', quantity: 2, unit: 'each', amountMinor: 600 }],
    }
    const refund = { refundedAt: '2026-08-14T10:00:00.000Z', items: [{ purchaseItemId: 'purchase-item/one', quantity: 1, amountMinor: 300 }] }
    const budget = {
      name: 'August', scope: { kind: 'item' as const, itemIds: ['item/one'] },
      period: { kind: 'monthly' as const, startsOn: '2026-08-01', endsOn: '2026-08-31' },
      limitMinor: 1_000, thresholds: [0.5, 0.8, 1],
    }
    const exportInput = { format: 'json' as const, includeAttachments: false }
    const importInput = { formatVersion: 1, checksumSha256: 'a'.repeat(64), canonicalJson: '{}', mode: 'replace' as const }
    const resolutions = [{ entityType: 'catalog-item', entityId: 'item/one', resolution: 'use-imported' as const }]

    const policy = { minimumStock: 2, packageQuantity: 4, unitId: 'builtin:each' }
    const recalculation = { through: '2026-08-20' }
    await lifeCommerceApi.upsertInventoryPolicy('item/one', policy, 'policy-key', 'csrf')
    await lifeCommerceApi.recalculateShopping(recalculation, 'recalculate-key', 'csrf')
    await lifeCommerceApi.createSuggestion(suggestion, 'suggestion-key', 'csrf')
    await lifeCommerceApi.createShoppingItem(shopping, 'shopping-key', 'csrf')
    await lifeCommerceApi.createPurchase(purchase, 'purchase-key', 'csrf')
    await lifeCommerceApi.createRefund('purchase/one', refund, 'refund-key', 'csrf')
    await lifeCommerceApi.createBudget(budget, 'budget-key', 'csrf')
    await lifeCommerceApi.createExport(exportInput, 'export-key', 'csrf')
    await lifeCommerceApi.previewImport(importInput, 'preview-key', 'csrf')
    await lifeCommerceApi.applyImport('import/one', resolutions, 'apply-key', 'csrf')

    expect(request.mock.calls).toEqual([
      ['/life/inventory-policies/item%2Fone', { method: 'PUT', body: policy, csrf: 'csrf', idempotencyKey: 'policy-key' }],
      ['/life/shopping/recalculate', { method: 'POST', body: recalculation, csrf: 'csrf', idempotencyKey: 'recalculate-key' }],
      ['/life/shopping/suggestions', { method: 'POST', body: suggestion, csrf: 'csrf', idempotencyKey: 'suggestion-key' }],
      ['/life/shopping/items', { method: 'POST', body: shopping, csrf: 'csrf', idempotencyKey: 'shopping-key' }],
      ['/life/purchases', { method: 'POST', body: purchase, csrf: 'csrf', idempotencyKey: 'purchase-key' }],
      ['/life/purchases/purchase%2Fone/refunds', { method: 'POST', body: refund, csrf: 'csrf', idempotencyKey: 'refund-key' }],
      ['/life/budgets', { method: 'POST', body: budget, csrf: 'csrf', idempotencyKey: 'budget-key' }],
      ['/life/exports', { method: 'POST', body: exportInput, csrf: 'csrf', idempotencyKey: 'export-key' }],
      ['/life/imports/preview', { method: 'POST', body: importInput, csrf: 'csrf', idempotencyKey: 'preview-key' }],
      ['/life/imports/import%2Fone/apply', { method: 'POST', body: { resolutions }, csrf: 'csrf', idempotencyKey: 'apply-key' }],
    ])
  })

  it('invalidates commerce and every fact source touched by transactional writes', async () => {
    await lifeCommerceApi.createPurchase({
      purchasedAt: '2026-08-14T09:00:00.000Z', currency: 'CNY',
      items: [{ itemId: 'item', quantity: 1, unit: 'each', amountMinor: 100 }],
    }, 'purchase-key', 'csrf')
    expect(invalidate.mock.calls.map(([value]) => value)).toEqual([
      { queryKey: queryKeys.lifeCommerce.all },
      { queryKey: queryKeys.lifeInventory.all },
      { queryKey: queryKeys.lifeCatalog.all },
      { queryKey: queryKeys.lifePlanning.all },
      { queryKey: queryKeys.lifeRecipes.all },
    ])
  })

  it('exposes discriminated shopping, analytics, budget and portability contracts', () => {
    expectTypeOf<ShoppingSuggestion['kind']>().toEqualTypeOf<'suggestion'>()
    expectTypeOf<ShoppingSuggestion['origin']>().toEqualTypeOf<'manual' | 'derived'>()
    expectTypeOf<InventoryPolicy>().toHaveProperty('version')
    expectTypeOf<ShoppingRecalculationResult['incomplete'][number]['reason']>().toEqualTypeOf<'missing_conversion'>()
    expectTypeOf<ShoppingItem['kind']>().toEqualTypeOf<'formal'>()
    expectTypeOf<PurchaseResult>().toHaveProperty('cashExpenditure')
    expectTypeOf<RefundResult>().toHaveProperty('inventoryTransactions')
    expectTypeOf<BudgetSummary['forecast']>().toMatchTypeOf<{ status: 'complete' | 'insufficient-data' }>()
    expectTypeOf<LifeAnalytics['days'][number]['cashExpenditure']>().toHaveProperty('status')
    expectTypeOf<LifeAnalytics['drillDown']>().toHaveProperty('consumptionCost')
    expectTypeOf<Extract<ExportJob, { format: 'json' }>>().toHaveProperty('canonicalJson')
    expectTypeOf<ImportPreview>().toHaveProperty('conflicts')
    expectTypeOf<ImportApplyResult>().toHaveProperty('status')
    expectTypeOf<ImportApplyFailureDetails>().toHaveProperty('restorePointExportId')
  })
})
