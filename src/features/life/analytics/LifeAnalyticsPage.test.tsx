import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appRoutes } from '../../../App'
import { queryClient } from '../../../api/queryClient'
import type { Budget, BudgetSummary, LifeAnalytics } from '../../../domain/lifeCommerce'
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
const budget: BudgetSummary = {
  id: 'budget-august', name: '八月生活预算', scope: { kind: 'all-life' },
  period: { kind: 'monthly', startsOn: '2026-08-01', endsOn: '2026-08-31' },
  limitMinor: 100_000, thresholds: [0.5, 0.8, 1], rolloverMinor: 0, version: 2,
  createdAt: now, updatedAt: now, spentMinor: 82_000, remainingMinor: 18_000,
  thresholdStatus: 'warning', forecast: { status: 'complete', projectedMinor: 112_000 },
}

const analytics: LifeAnalytics = {
  from: '2026-08-17', to: '2026-08-19',
  days: [
    { date: '2026-08-17', cashExpenditure: { status: 'no-record' }, consumptionCost: { status: 'no-record' }, planExecution: { status: 'no-record' } },
    { date: '2026-08-18', cashExpenditure: { status: 'recorded', valueMinor: 0, sourceIds: [] }, consumptionCost: { status: 'recorded', valueMinor: 1200, sourceIds: ['completion-1'] }, planExecution: { status: 'recorded', plannedCount: 4, actualCount: 3, incompleteCount: 1, sourceIds: ['plan-1'] } },
    { date: '2026-08-19', cashExpenditure: { status: 'recorded', valueMinor: 5000, sourceIds: ['purchase-1'] }, consumptionCost: { status: 'recorded', valueMinor: 1800, sourceIds: ['completion-2'] }, planExecution: { status: 'recorded', plannedCount: 2, actualCount: 2, incompleteCount: 0, sourceIds: ['plan-2'] } },
  ],
  totals: { cashExpenditureMinor: 5000, consumptionCostMinor: 3000, plannedCount: 6, actualCount: 5, incompleteCount: 1 },
  drillDown: {
    cashExpenditure: [{ sourceType: 'purchase', sourceId: 'purchase-1', amountMinor: 5000, occurredAt: '2026-08-19T10:00:00.000Z' }],
    consumptionCost: [{ sourceType: 'completion', sourceId: 'completion-1', amountMinor: 1200, occurredAt: '2026-08-18T08:00:00.000Z' }],
  },
}

function renderRoute(path = '/app/life/analytics?from=2026-08-17&to=2026-08-19') {
  sessionStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ mode: 'local-preview', account: 'owner@example.com' }))
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  return { router, ...render(<RouterProvider router={router} />) }
}

describe('budget and traceable life analytics workspace', () => {
  beforeEach(() => {
    queryClient.clear()
    commerceApi.listBudgets.mockReset().mockResolvedValue([budget])
    commerceApi.getAnalytics.mockReset().mockResolvedValue(analytics)
    commerceApi.listShopping.mockReset().mockResolvedValue({ suggestions: [], formalItems: [] })
    commerceApi.createBudget.mockReset().mockResolvedValue({ ...budget, id: 'budget-next', name: '九月生活预算' } as Budget)
  })

  it('separates cash expenditure from consumption cost, distinguishes no-record from recorded zero and provides an accessible table equivalent', async () => {
    renderRoute()

    expect(await screen.findByRole('heading', { name: '生活分析', level: 1 })).toBeVisible()
    expect(commerceApi.getAnalytics).toHaveBeenCalledWith({ from: '2026-08-17', to: '2026-08-19' }, expect.any(AbortSignal))
    expect(screen.getByText('现金支出 ¥50.00')).toBeVisible()
    expect(screen.getByText('消耗成本 ¥30.00')).toBeVisible()
    expect(screen.getByText('八月生活预算 · 已使用 82%')).toBeVisible()
    expect(screen.getByText('预计 ¥1,120.00 · 将超出预算')).toBeVisible()
    expect(screen.getByRole('img', { name: '现金支出与消耗成本趋势' })).toBeVisible()

    const table = screen.getByRole('table', { name: '生活分析数据表' })
    const noRecord = within(table).getByRole('row', { name: /2026-08-17/ })
    expect(noRecord).toHaveTextContent('无记录')
    const recordedZero = within(table).getByRole('row', { name: /2026-08-18/ })
    expect(recordedZero).toHaveTextContent('¥0.00')
    expect(recordedZero).not.toHaveTextContent('无记录 ¥0.00')
    expect(within(table).getByRole('link', { name: '查看 purchase-1' })).toHaveAttribute('href', expect.stringContaining('/app/life/shopping?source=purchase-1'))
  })

  it('preserves the selected range through source drill-down and creates explicit thresholded budgets', async () => {
    const user = userEvent.setup()
    const { router } = renderRoute()
    await screen.findByRole('heading', { name: '生活分析' })

    await user.click(screen.getByRole('link', { name: '查看 purchase-1' }))
    expect(router.state.location.pathname).toBe('/app/life/shopping')
    await router.navigate(-1)
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/life/analytics'))
    expect(router.state.location.search).toBe('?from=2026-08-17&to=2026-08-19')
    const restored = await waitFor(() => {
      const panel = document.querySelector<HTMLElement>('[data-route-panel-current][data-route-key="/app/life/analytics"]')
      expect(panel).not.toBeNull()
      return panel as HTMLElement
    })
    await waitFor(() => {
      expect(within(restored).getByDisplayValue('2026-08-17')).toBeVisible()
      expect(within(restored).getByDisplayValue('2026-08-19')).toBeVisible()
    })

    await user.click(screen.getByRole('button', { name: '新建预算' }))
    const dialog = screen.getByRole('dialog', { name: '新建生活预算' })
    await user.type(within(dialog).getByLabelText('预算名称'), '九月生活预算')
    await user.clear(within(dialog).getByLabelText('预算金额（元）'))
    await user.type(within(dialog).getByLabelText('预算金额（元）'), '1200')
    await user.click(within(dialog).getByRole('button', { name: '创建预算' }))
    await waitFor(() => expect(commerceApi.createBudget).toHaveBeenCalledWith(expect.objectContaining({
      name: '九月生活预算', limitMinor: 120_000, thresholds: [0.5, 0.8, 1],
    }), expect.any(String), undefined))
    expect(await screen.findByRole('status', { name: '预算结果' })).toHaveTextContent('九月生活预算已创建；支出事实与消耗成本仍分开计算')
  })
})
