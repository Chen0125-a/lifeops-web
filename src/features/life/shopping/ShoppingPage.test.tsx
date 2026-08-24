import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appRoutes } from '../../../App'
import { queryClient } from '../../../api/queryClient'
import type { PurchaseResult, RefundResult, ShoppingItem, ShoppingSuggestion } from '../../../domain/lifeCommerce'
import { LOCAL_SESSION_KEY } from '../../../state/AuthContext'

const { commerceApi } = vi.hoisted(() => ({
  commerceApi: {
    listInventoryPolicies: vi.fn(), listShopping: vi.fn(), listBudgets: vi.fn(), getAnalytics: vi.fn(), listExports: vi.fn(),
    upsertInventoryPolicy: vi.fn(), recalculateShopping: vi.fn(), createSuggestion: vi.fn(), createShoppingItem: vi.fn(),
    createPurchase: vi.fn(), createRefund: vi.fn(), createBudget: vi.fn(), createExport: vi.fn(), previewImport: vi.fn(), applyImport: vi.fn(),
  },
}))

vi.mock('../../../api/lifeCommerceApi', () => ({ lifeCommerceApi: commerceApi }))

const now = '2026-08-22T08:00:00.000Z'
const suggestions: ShoppingSuggestion[] = [{
  id: 'suggestion-oat', kind: 'suggestion', origin: 'derived', through: '2026-08-28', itemId: '燕麦',
  requiredQuantity: 300, suggestedQuantity: 500, unit: 'g', packageQuantity: 500,
  reasons: [
    { id: 'reason-plan', kind: 'planned_shortage', sourceType: 'day-plan', sourceId: 'plan-0824', requiredQuantity: 300, sourceQuantity: 600, sourceUnit: 'g', conversionFactor: 1, requiredOn: '2026-08-24', createdAt: now },
    { id: 'reason-stock', kind: 'minimum_stock', sourceType: 'inventory-policy', sourceId: 'policy-oat', requiredQuantity: 200, sourceQuantity: 200, sourceUnit: 'g', conversionFactor: 1, requiredOn: null, createdAt: now },
  ],
  createdAt: now, updatedAt: now,
}, {
  id: 'suggestion-milk', kind: 'suggestion', origin: 'derived', through: '2026-08-28', itemId: '牛奶',
  requiredQuantity: 1, suggestedQuantity: 1, unit: 'L', packageQuantity: 1,
  reasons: [{ id: 'reason-milk', kind: 'planned_shortage', sourceType: 'day-plan', sourceId: 'plan-0825', requiredQuantity: 1, sourceQuantity: 1, sourceUnit: 'L', conversionFactor: 1, requiredOn: '2026-08-25', createdAt: now }],
  createdAt: now, updatedAt: now,
}]

const formalItems: ShoppingItem[] = [{
  id: 'formal-oat', kind: 'formal', itemId: '燕麦', requestedQuantity: 500, purchasedQuantity: 0,
  remainingQuantity: 500, unit: 'g', neededOn: '2026-08-24', priority: 'high', storeGroup: '生鲜店',
  status: 'shopping', version: 2, createdAt: now, updatedAt: now,
}, {
  id: 'formal-cleaner', kind: 'formal', itemId: '清洁剂', requestedQuantity: 2, purchasedQuantity: 0,
  remainingQuantity: 2, unit: '瓶', neededOn: null, priority: 'normal', storeGroup: '日用品店',
  status: 'added', version: 1, createdAt: now, updatedAt: now,
}]

const purchasedFormal: ShoppingItem = {
  ...formalItems[0], purchasedQuantity: 250, remainingQuantity: 250, status: 'partial', version: 3,
}

const purchaseResult = {
  purchase: { id: 'purchase-1', purchasedAt: now, currency: 'CNY', storeName: '生鲜店', totalAmountMinor: 3600, createdAt: now },
  items: [{ id: 'purchase-item-1', purchaseId: 'purchase-1', shoppingItemId: 'formal-oat', itemId: '燕麦', quantity: 250, unit: 'g', amountMinor: 3600, updateCurrentPrice: true, expiresOn: '2026-12-31', locationId: 'pantry', inventoryTransactionId: 'inventory-purchase-1' }],
  cashExpenditure: { id: 'cash-1', amountMinor: 3600, currency: 'CNY', occurredAt: now, sourceType: 'purchase', sourceId: 'purchase-1', createdAt: now },
  inventoryTransactions: [{ id: 'inventory-purchase-1' }],
  shoppingItems: [purchasedFormal],
} as unknown as PurchaseResult

const refundResult = {
  refund: { id: 'refund-1', purchaseId: 'purchase-1', refundedAt: now, totalAmountMinor: 720, note: '包装破损', createdAt: now },
  items: [{ id: 'refund-item-1', refundId: 'refund-1', purchaseId: 'purchase-1', purchaseItemId: 'purchase-item-1', itemId: '燕麦', quantity: 50, amountMinor: 720, inventoryTransactionId: 'inventory-refund-1' }],
  cashExpenditure: { id: 'cash-refund-1', amountMinor: -720, currency: 'CNY', occurredAt: now, sourceType: 'refund', sourceId: 'refund-1', createdAt: now },
  inventoryTransactions: [{ id: 'inventory-refund-1' }],
} as unknown as RefundResult

function renderRoute(path = '/app/life/shopping?item=%E7%87%95%E9%BA%A6') {
  sessionStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ mode: 'local-preview', account: 'owner@example.com' }))
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  return { router, ...render(<RouterProvider router={router} />) }
}

describe('shopping, purchase and refund workspace', () => {
  beforeEach(() => {
    queryClient.clear()
    commerceApi.listShopping.mockReset().mockResolvedValue({ suggestions, formalItems })
    commerceApi.listBudgets.mockReset().mockResolvedValue([])
    commerceApi.createPurchase.mockReset().mockResolvedValue(purchaseResult)
    commerceApi.createRefund.mockReset().mockResolvedValue(refundResult)
  })

  it('keeps immediate blockers, formal rows, merged system reasons and history distinct while grouping actions by priority and store', async () => {
    renderRoute()

    expect(await screen.findByRole('heading', { name: '采购工作台', level: 1 })).toBeVisible()
    expect(screen.getByText('筛选：燕麦')).toBeVisible()
    const urgent = screen.getByRole('region', { name: '立即处理' })
    expect(within(urgent).getByText('燕麦')).toBeVisible()
    expect(within(urgent).getByText('2026-08-24 前需要')).toBeVisible()

    const formal = screen.getByRole('region', { name: '正式采购清单' })
    expect(within(formal).getByRole('heading', { name: '生鲜店 · 高优先级' })).toBeVisible()
    expect(within(formal).getByRole('heading', { name: '日用品店 · 常规' })).toBeVisible()
    expect(within(formal).getByText('燕麦 · 500 g 待采购')).toBeVisible()

    const derived = screen.getByRole('region', { name: '系统建议' })
    expect(within(derived).getByText('建议采购 500 g')).toBeVisible()
    expect(within(derived).getByText('计划缺口 300 g')).toBeVisible()
    expect(within(derived).getByText('最低库存 200 g')).toBeVisible()
    expect(screen.getByRole('region', { name: '采购与退款历史' })).toHaveTextContent('暂无已确认交易')
  })

  it('confirms a partial purchase into inventory, cash and the formal list, then records a compensating refund', async () => {
    const user = userEvent.setup()
    renderRoute()
    await screen.findByRole('heading', { name: '采购工作台' })

    await user.click(screen.getByRole('button', { name: '采购正式清单中的燕麦' }))
    const purchase = screen.getByRole('dialog', { name: '确认采购燕麦' })
    await user.clear(within(purchase).getByLabelText('实际数量'))
    await user.type(within(purchase).getByLabelText('实际数量'), '250')
    await user.clear(within(purchase).getByLabelText('实付金额（元）'))
    await user.type(within(purchase).getByLabelText('实付金额（元）'), '36')
    await user.type(within(purchase).getByLabelText('批次到期日'), '2026-12-31')
    await user.selectOptions(within(purchase).getByLabelText('存放位置'), 'pantry')
    await user.click(within(purchase).getByLabelText('将本次价格设为当前价格'))
    await user.click(within(purchase).getByRole('button', { name: '确认部分采购' }))

    await waitFor(() => expect(commerceApi.createPurchase).toHaveBeenCalledWith(expect.objectContaining({
      currency: 'CNY', storeName: '生鲜店',
      items: [expect.objectContaining({ shoppingItemId: 'formal-oat', itemId: '燕麦', quantity: 250, unit: 'g', amountMinor: 3600, updateCurrentPrice: true, expiresOn: '2026-12-31', locationId: 'pantry' })],
    }), expect.any(String), undefined))
    expect(await screen.findByRole('status', { name: '采购结果' })).toHaveTextContent('采购已确认 · 库存 +250 g · 现金支出 ¥36.00 · 清单剩余 250 g')

    await user.click(screen.getByRole('button', { name: '为本次采购办理退款' }))
    const refund = screen.getByRole('dialog', { name: '办理燕麦退款' })
    await user.clear(within(refund).getByLabelText('退回数量'))
    await user.type(within(refund).getByLabelText('退回数量'), '50')
    await user.clear(within(refund).getByLabelText('退款金额（元）'))
    await user.type(within(refund).getByLabelText('退款金额（元）'), '7.2')
    await user.type(within(refund).getByLabelText('退款说明'), '包装破损')
    await user.click(within(refund).getByRole('button', { name: '确认退款' }))
    await waitFor(() => expect(commerceApi.createRefund).toHaveBeenCalledWith('purchase-1', {
      refundedAt: expect.any(String), items: [{ purchaseItemId: 'purchase-item-1', quantity: 50, amountMinor: 720 }], note: '包装破损',
    }, expect.any(String), undefined))
    expect(await screen.findByText('退款已确认 · 库存 -50 g · 现金净额 -¥7.20')).toBeVisible()
  })
})
