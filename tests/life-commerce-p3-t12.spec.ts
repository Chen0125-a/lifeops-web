import { mkdir } from 'node:fs/promises'
import { expect, test, type Page, type Route } from '@playwright/test'
import { screenshotToPath } from './helpers/screenshotToPath'

const fixtureId = 'p3-t12-commerce-portability-golden-slice-2026-08-22-v1'
const evidenceDir = 'outputs/evidence/p3-t12-life-commerce-browser-gate'
const now = '2026-08-22T08:00:00.000Z'
const session = { mode: 'local-preview', account: 'p3-t12-browser@lifeops.local', fixtureId }

const suggestions = [{
  id: 'suggestion-oat', kind: 'suggestion', origin: 'derived', through: '2026-08-28', itemId: '燕麦', requiredQuantity: 300,
  suggestedQuantity: 500, unit: 'g', packageQuantity: 500, createdAt: now, updatedAt: now,
  reasons: [
    { id: 'reason-plan', kind: 'planned_shortage', sourceType: 'day-plan', sourceId: 'plan-0824', requiredQuantity: 300, sourceQuantity: 600, sourceUnit: 'g', conversionFactor: 1, requiredOn: '2026-08-24', createdAt: now },
    { id: 'reason-stock', kind: 'minimum_stock', sourceType: 'inventory-policy', sourceId: 'policy-oat', requiredQuantity: 200, sourceQuantity: 200, sourceUnit: 'g', conversionFactor: 1, requiredOn: null, createdAt: now },
  ],
}]
const formalItems = [{
  id: 'formal-oat', kind: 'formal', itemId: '燕麦', requestedQuantity: 500, purchasedQuantity: 0, remainingQuantity: 500, unit: 'g',
  neededOn: '2026-08-24', priority: 'high', storeGroup: '生鲜店', status: 'shopping', version: 2, createdAt: now, updatedAt: now,
}, {
  id: 'formal-cleaner', kind: 'formal', itemId: '清洁剂', requestedQuantity: 2, purchasedQuantity: 0, remainingQuantity: 2, unit: '瓶',
  neededOn: null, priority: 'normal', storeGroup: '日用品店', status: 'added', version: 1, createdAt: now, updatedAt: now,
}]
const budget = {
  id: 'budget-august', name: '八月生活预算', scope: { kind: 'all-life' }, period: { kind: 'monthly', startsOn: '2026-08-01', endsOn: '2026-08-31' },
  limitMinor: 100_000, thresholds: [0.5, 0.8, 1], rolloverMinor: 0, version: 2, createdAt: now, updatedAt: now,
  spentMinor: 82_000, remainingMinor: 18_000, thresholdStatus: 'warning', forecast: { status: 'complete', projectedMinor: 112_000 },
}
const analytics = {
  from: '2026-08-17', to: '2026-08-19',
  days: [
    { date: '2026-08-17', cashExpenditure: { status: 'no-record' }, consumptionCost: { status: 'no-record' }, planExecution: { status: 'no-record' } },
    { date: '2026-08-18', cashExpenditure: { status: 'recorded', valueMinor: 0, sourceIds: [] }, consumptionCost: { status: 'recorded', valueMinor: 1200, sourceIds: ['completion-1'] }, planExecution: { status: 'recorded', plannedCount: 4, actualCount: 3, incompleteCount: 1, sourceIds: ['plan-1'] } },
    { date: '2026-08-19', cashExpenditure: { status: 'recorded', valueMinor: 5000, sourceIds: ['purchase-1'] }, consumptionCost: { status: 'recorded', valueMinor: 1800, sourceIds: ['completion-2'] }, planExecution: { status: 'recorded', plannedCount: 2, actualCount: 2, incompleteCount: 0, sourceIds: ['plan-2'] } },
  ],
  totals: { cashExpenditureMinor: 5000, consumptionCostMinor: 3000, plannedCount: 6, actualCount: 5, incompleteCount: 1 },
  drillDown: { cashExpenditure: [{ sourceType: 'purchase', sourceId: 'purchase-1', amountMinor: 5000, occurredAt: now }], consumptionCost: [{ sourceType: 'completion', sourceId: 'completion-1', amountMinor: 1200, occurredAt: now }] },
}
const payload = { catalogItems: [], shoppingItems: [], purchases: [], refunds: [], budgets: [] }
const existingExport = { id: 'export-existing', status: 'completed', reason: 'user-export', format: 'json', formatVersion: 1, checksumSha256: 'a'.repeat(64), recordCounts: { catalogItems: 8, shoppingItems: 2, budgets: 1 }, payload, canonicalJson: '{}', createdAt: now }

type FailureMode = 'none' | 'forbidden' | 'server' | 'conflict' | 'offline'
interface FixtureState {
  read: FailureMode
  mutation: FailureMode
  delayMs: number
  empty: boolean
  writes: string[]
  shopping: { suggestions: any[]; formalItems: any[] }
}

function fixtureState(): FixtureState {
  return { read: 'none', mutation: 'none', delayMs: 0, empty: false, writes: [], shopping: { suggestions: structuredClone(suggestions), formalItems: structuredClone(formalItems) } }
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

function failure(route: Route, mode: FailureMode) {
  if (mode === 'offline') return route.abort('internetdisconnected')
  if (mode === 'conflict') return json(route, { error: { code: 'VERSION_CONFLICT', message: 'fixture conflict' } }, 409)
  if (mode === 'forbidden') return json(route, { error: { code: 'FORBIDDEN', message: 'fixture forbidden' } }, 403)
  if (mode === 'server') return json(route, { error: { code: 'SERVER_ERROR', message: 'fixture server error' } }, 500)
  return null
}

async function installFixture(page: Page, state: FixtureState) {
  await page.clock.setFixedTime(new Date('2026-08-22T12:00:00+08:00'))
  await page.addInitScript((value) => sessionStorage.setItem('lifeops:session:v1', JSON.stringify(value)), session)
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    if (path === '/api/v1/auth/session') return json(route, { user: { id: 'p3-t12-browser', account: session.account, displayName: 'P3-T12 Browser' }, csrfToken: 'csrf-p3-t12' })
    if (path === '/api/v1/state') return json(route, { schemaVersion: 1, plans: [], records: [], reviews: [], knowledge: [], snapshots: [] })
    if (path === '/api/v1/goals' || path === '/api/v1/tasks' || path === '/api/v1/records' || path === '/api/v1/reviews') return json(route, [])
    if (path === '/api/v1/habits') return json(route, { from: url.searchParams.get('from'), to: url.searchParams.get('to'), habits: [], entries: [] })
    if (/^\/api\/v1\/goals\/[^/]+\/projects$/.test(path)) return json(route, [])

    const isCommerceRead = method === 'GET' && ['/api/v1/life/shopping', '/api/v1/life/budgets', '/api/v1/life/analytics', '/api/v1/life/exports'].includes(path)
    if (isCommerceRead && state.delayMs) await new Promise((resolve) => setTimeout(resolve, state.delayMs))
    if (isCommerceRead && state.read !== 'none') return failure(route, state.read)
    if (method !== 'GET') {
      const failed = failure(route, state.mutation)
      if (failed) return failed
      state.writes.push(`${method} ${path}`)
    }

    if (method === 'GET' && path === '/api/v1/life/shopping') return json(route, state.empty ? { suggestions: [], formalItems: [] } : state.shopping)
    if (method === 'GET' && path === '/api/v1/life/budgets') return json(route, state.empty ? [] : [budget])
    if (method === 'GET' && path === '/api/v1/life/analytics') return json(route, state.empty ? { ...analytics, days: [{ date: '2026-08-17', cashExpenditure: { status: 'no-record' }, consumptionCost: { status: 'no-record' }, planExecution: { status: 'no-record' } }], totals: { cashExpenditureMinor: 0, consumptionCostMinor: 0, plannedCount: 0, actualCount: 0, incompleteCount: 0 }, drillDown: { cashExpenditure: [], consumptionCost: [] } } : analytics)
    if (method === 'GET' && path === '/api/v1/life/exports') return json(route, state.empty ? [] : [existingExport])
    if (method === 'GET' && path === '/api/v1/life/trash/catalog') return json(route, [])
    if (method === 'POST' && path === '/api/v1/life/purchases') {
      const body = request.postDataJSON()
      const purchased = { ...state.shopping.formalItems[0], purchasedQuantity: 250, remainingQuantity: 250, status: 'partial', version: 3 }
      state.shopping.formalItems[0] = purchased
      return json(route, {
        purchase: { id: 'purchase-1', purchasedAt: body.purchasedAt, currency: 'CNY', storeName: '生鲜店', totalAmountMinor: 3600, createdAt: now },
        items: [{ id: 'purchase-item-1', purchaseId: 'purchase-1', shoppingItemId: 'formal-oat', itemId: '燕麦', quantity: 250, unit: 'g', amountMinor: 3600, updateCurrentPrice: true, expiresOn: '2026-12-31', locationId: 'pantry', inventoryTransactionId: 'inventory-purchase-1' }],
        cashExpenditure: { id: 'cash-1', amountMinor: 3600, currency: 'CNY', occurredAt: now, sourceType: 'purchase', sourceId: 'purchase-1', createdAt: now }, inventoryTransactions: [{ id: 'inventory-purchase-1' }], shoppingItems: [purchased],
      }, 201)
    }
    if (method === 'POST' && path === '/api/v1/life/purchases/purchase-1/refunds') return json(route, {
      refund: { id: 'refund-1', purchaseId: 'purchase-1', refundedAt: now, totalAmountMinor: 720, note: '包装破损', createdAt: now },
      items: [{ id: 'refund-item-1', refundId: 'refund-1', purchaseId: 'purchase-1', purchaseItemId: 'purchase-item-1', itemId: '燕麦', quantity: 50, amountMinor: 720, inventoryTransactionId: 'inventory-refund-1' }],
      cashExpenditure: { id: 'cash-refund-1', amountMinor: -720, currency: 'CNY', occurredAt: now, sourceType: 'refund', sourceId: 'refund-1', createdAt: now }, inventoryTransactions: [{ id: 'inventory-refund-1' }],
    }, 201)
    if (method === 'POST' && path === '/api/v1/life/budgets') return json(route, { ...budget, ...request.postDataJSON(), id: 'budget-created' }, 201)
    if (method === 'POST' && path === '/api/v1/life/exports') return json(route, { id: 'export-zip', status: 'completed', reason: 'user-export', format: 'zip', formatVersion: 1, checksumSha256: 'b'.repeat(64), recordCounts: { catalogItems: 8, mediaAssets: 3 }, archiveBase64: 'UEsDBA==', archiveEntries: ['manifest.json', 'lifeops.json', 'media/image-1.webp'], createdAt: now }, 201)
    if (method === 'POST' && path === '/api/v1/life/imports/preview') return json(route, { id: 'import-1', mode: request.postDataJSON().mode, status: 'conflicts', payload, conflicts: [{ entityType: 'budget', entityId: 'budget-august', currentVersion: 2, incomingVersion: 3, resolutions: ['keep-current', 'use-imported', 'duplicate'] }], errors: [], createdAt: now }, 201)
    if (method === 'POST' && path === '/api/v1/life/imports/import-1/apply') return json(route, { status: 'applied', importId: 'import-1', restorePointExportId: 'restore-1', appliedRows: 12 }, 201)
    return json(route, { error: { code: 'UNHANDLED_FIXTURE_ROUTE', message: `${method} ${path}` } }, 404)
  })
}

async function assertNoHorizontalOverflow(page: Page, width: number) {
  expect(await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))).toEqual({ client: width, scroll: width })
}

async function settleVisualFrame(page: Page) {
  await expect(page.locator('.route-stage__panel')).toHaveCount(1)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
}

test.beforeAll(async () => mkdir(evidenceDir, { recursive: true }))

test('P3-T12 visual gate covers three routes, standard viewports, 320 CSS px, 200% zoom and reduced motion', async ({ page }) => {
  test.slow()
  await installFixture(page, fixtureState())
  const routes = [
    { name: 'shopping', path: '/app/life/shopping?item=%E7%87%95%E9%BA%A6', heading: '采购工作台' },
    { name: 'analytics', path: '/app/life/analytics?from=2026-08-17&to=2026-08-19', heading: '生活分析' },
    { name: 'data', path: '/app/life/data?section=export', heading: '生活数据管理' },
  ]
  const viewports = [
    { name: '1440x900', width: 1440, height: 900 }, { name: '1024x768', width: 1024, height: 768 },
    { name: '768x1024', width: 768, height: 1024 }, { name: '390x844', width: 390, height: 844 }, { name: '320x844', width: 320, height: 844 },
  ]
  for (const route of routes) for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    await page.goto(route.path)
    await expect(page.getByRole('heading', { name: route.heading, level: 1 })).toBeVisible()
    await assertNoHorizontalOverflow(page, viewport.width)
    if (route.name === 'analytics') {
      const dateLabels = page.getByRole('img', { name: '现金支出与消耗成本趋势' }).locator('text')
      await expect(dateLabels).toHaveCount(3)
      for (const label of await dateLabels.all()) {
        const box = await label.boundingBox()
        expect(box, `missing analytics date label at ${viewport.name}`).not.toBeNull()
        expect(box!.x + box!.width, `analytics date label clipped at ${viewport.name}`).toBeLessThanOrEqual(viewport.width)
      }
    }
    await screenshotToPath(page, { path: `${evidenceDir}/${route.name}-${viewport.name}-full-page.png`, fullPage: true })
  }
  for (const route of routes) {
    await page.setViewportSize({ width: 640, height: 900 })
    await page.goto(route.path)
    await page.evaluate(() => { document.documentElement.style.zoom = '2' })
    await expect(page.getByRole('heading', { name: route.heading, level: 1 })).toBeVisible()
    await screenshotToPath(page, { path: `${evidenceDir}/${route.name}-200-percent-zoom.png`, fullPage: true })
    await page.evaluate(() => { document.documentElement.style.zoom = '1' })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(route.path)
    await expect(page.getByRole('heading', { name: route.heading, level: 1 })).toBeVisible()
    await assertNoHorizontalOverflow(page, 390)
    await screenshotToPath(page, { path: `${evidenceDir}/${route.name}-390x844-reduced-motion.png`, fullPage: true })
  }
})

test('P3-T12 purchase/refund, drill-down Back, budget and import/export flows are keyboard operable and explicit', async ({ page }) => {
  const state = fixtureState()
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await installFixture(page, state)
  await page.goto('/app/life/shopping?item=%E7%87%95%E9%BA%A6')
  const shoppingHeading = page.getByRole('heading', { name: '采购工作台', level: 1 })
  await expect(shoppingHeading).toBeFocused()
  await page.getByRole('button', { name: '采购正式清单中的燕麦' }).focus()
  await page.keyboard.press('Enter')
  const purchase = page.getByRole('dialog', { name: '确认采购燕麦' })
  await expect(purchase.getByRole('button', { name: '关闭' })).toBeFocused()
  await purchase.getByLabel('实际数量').fill('250')
  await purchase.getByLabel('实付金额（元）').fill('36')
  await purchase.getByLabel('批次到期日').fill('2026-12-31')
  await purchase.getByLabel('将本次价格设为当前价格').check()
  await purchase.getByRole('button', { name: '确认部分采购' }).click()
  await expect(page.getByRole('status', { name: '采购结果' })).toContainText('清单剩余 250 g')
  await settleVisualFrame(page)
  await screenshotToPath(page, { path: `${evidenceDir}/filmstrip-01-partial-purchase.png`, fullPage: true })
  await page.getByRole('button', { name: '为本次采购办理退款' }).click()
  const refund = page.getByRole('dialog', { name: '办理燕麦退款' })
  await refund.getByLabel('退回数量').fill('50')
  await refund.getByLabel('退款金额（元）').fill('7.2')
  await refund.getByLabel('退款说明').fill('包装破损')
  await refund.getByRole('button', { name: '确认退款' }).click()
  await expect(page.getByRole('status', { name: '退款结果' })).toContainText('现金净额 -¥7.20')

  await page.goto('/app/life/analytics?from=2026-08-17&to=2026-08-19')
  await expect(page.getByText('现金支出 ¥50.00')).toBeVisible()
  await page.getByRole('link', { name: '查看 purchase-1' }).click()
  await expect(page.getByText('来源：purchase-1')).toBeVisible()
  await page.goBack()
  await expect(page.getByLabel('开始日期')).toHaveValue('2026-08-17')
  await expect(page.getByLabel('结束日期')).toHaveValue('2026-08-19')
  await page.getByRole('button', { name: '新建预算' }).click()
  const budgetDialog = page.getByRole('dialog', { name: '新建生活预算' })
  await budgetDialog.getByLabel('预算名称').fill('九月生活预算')
  await budgetDialog.getByLabel('预算金额（元）').fill('1200')
  await budgetDialog.getByRole('button', { name: '创建预算' }).click()
  await expect(page.getByRole('status', { name: '预算结果' })).toContainText('支出事实与消耗成本仍分开计算')
  await settleVisualFrame(page)
  await screenshotToPath(page, { path: `${evidenceDir}/filmstrip-02-analysis-and-budget.png`, fullPage: true })

  await page.goto('/app/life/data?section=export')
  await page.getByRole('button', { name: '创建导出' }).click()
  const exportDialog = page.getByRole('dialog', { name: '创建生活数据导出' })
  await expect(exportDialog.getByRole('button', { name: '关闭' })).toBeFocused()
  await exportDialog.getByLabel('格式').selectOption('zip')
  await exportDialog.getByLabel('包含私有附件').check()
  await exportDialog.getByRole('button', { name: '生成导出包' }).click()
  await expect(page.getByText(`SHA-256 ${'b'.repeat(64)}`)).toBeVisible()
  await page.getByRole('tab', { name: '导入' }).focus()
  await page.keyboard.press('Enter')
  await page.getByLabel('导入 JSON').fill('{"formatVersion":1}')
  await page.getByLabel('SHA-256').fill('c'.repeat(64))
  await page.getByRole('radio', { name: '替换现有生活数据' }).check()
  await page.getByRole('button', { name: '只预览，不写入' }).click()
  await expect(page.getByText('写入尚未发生')).toBeVisible()
  await page.getByRole('radio', { name: '使用导入版本' }).check()
  await page.getByRole('button', { name: '应用导入' }).click()
  await page.getByRole('button', { name: '创建恢复点并替换' }).click()
  await expect(page.getByRole('status', { name: '导入结果' })).toContainText('恢复点 restore-1')
  await settleVisualFrame(page)
  await screenshotToPath(page, { path: `${evidenceDir}/filmstrip-03-import-applied.png`, fullPage: true })
  await page.getByRole('tab', { name: '回收站' }).click()
  await expect(page.getByRole('region', { name: '生活数据回收站' })).toContainText('回收站为空')
  expect(pageErrors).toEqual([])
})

test('P3-T12 empty states distinguish no facts from zero without inventing activity', async ({ page }) => {
  const state = fixtureState()
  state.empty = true
  await installFixture(page, state)
  await page.goto('/app/life/shopping')
  await expect(page.getByRole('region', { name: '正式采购清单' })).toContainText('正式清单为空')
  await expect(page.getByRole('region', { name: '系统建议' })).toContainText('暂无系统建议')
  await page.goto('/app/life/analytics?from=2026-08-17&to=2026-08-17')
  await expect(page.getByRole('row', { name: /2026-08-17/ })).toContainText('无记录')
  await page.goto('/app/life/data?section=export')
  await expect(page.getByRole('region', { name: '导出清单' })).toContainText('还没有导出')
})

test('P3-T12 loading, permission, retry, conflict and offline failures stay scoped and truthful', async ({ page }) => {
  const state = fixtureState()
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  state.delayMs = 250
  await installFixture(page, state)
  await page.goto('/app/life/shopping')
  await expect(page.getByText('正在核对采购事实…')).toBeVisible()
  await expect(page.getByRole('heading', { name: '采购工作台', level: 1 })).toBeVisible()

  state.delayMs = 0
  state.read = 'forbidden'
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('当前账户没有权限')
  state.read = 'server'
  await page.getByRole('button', { name: '重新载入采购' }).click()
  await expect(page.getByRole('alert')).toContainText('请重新载入服务端事实。')
  state.read = 'none'
  await page.getByRole('button', { name: '重新载入采购' }).click()
  await expect(page.getByRole('heading', { name: '采购工作台' })).toBeVisible()

  state.mutation = 'conflict'
  await page.getByRole('button', { name: '采购正式清单中的燕麦' }).click()
  await page.getByRole('dialog', { name: '确认采购燕麦' }).getByLabel('实付金额（元）').fill('36')
  await page.getByRole('dialog', { name: '确认采购燕麦' }).getByRole('button', { name: '确认采购' }).click()
  await expect(page.getByRole('alert')).toContainText('另一处更新')
  await page.getByRole('alert').getByRole('button', { name: '关闭' }).click()
  state.mutation = 'offline'
  await page.getByRole('dialog', { name: '确认采购燕麦' }).getByRole('button', { name: '确认采购' }).click()
  await expect(page.getByRole('alert')).toContainText('当前设备离线')
  expect(pageErrors).toEqual([])
})
