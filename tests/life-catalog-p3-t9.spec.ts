import { mkdir } from 'node:fs/promises'
import { expect, test, type Page, type Route } from '@playwright/test'
import { installLifeFixture } from './life-fixtures'

const fixtureId = 'p3-t9-catalog-golden-slice-2026-08-22-v1'
const evidenceDir = 'outputs/evidence/p3-t9-life-catalog-browser-gate'
const timestamp = '2026-08-22T00:00:00.000Z'
const session = { mode: 'local-preview', account: 'p3-t9-browser@lifeops.local', fixtureId }

const item = (input: Record<string, unknown>) => ({
  aliases: [], status: 'active', categoryId: null, tagIds: [], locationId: null,
  availableUnits: [input.baseUnit], itemConversions: [], pricePoints: [], isCookingOil: false,
  attachments: [], notes: '', customOrder: 10, version: 1, createdAt: timestamp, updatedAt: timestamp,
  deletedAt: null, ...input,
})

const catalog = [
  item({ id: 'oat', kind: 'ingredient', name: '燕麦', aliases: ['oats'], baseUnit: 'g', categoryId: 'dry-goods', locationId: 'pantry', availableUnits: ['g', 'box'], itemConversions: [{ itemId: 'oat', fromUnit: 'box', toUnit: 'g', factor: 500 }], pricePoints: [{ id: 'oat-price', amountMinor: 1890, currency: 'CNY', purchaseQuantity: 1, purchaseUnit: 'box', effectiveFrom: '2026-08-01' }], nutrition: { basisQuantity: 100, basisUnit: 'g', values: { energyKcal: 367, proteinGrams: 15, fatGrams: 7, carbohydrateGrams: 61, custom: { 膳食纤维: 10 } } } }),
  item({ id: 'milk', kind: 'ingredient', name: '牛奶', baseUnit: 'ml', categoryId: 'fresh', locationId: 'fridge', availableUnits: ['ml', 'carton'] }),
  item({ id: 'vitamin-d', kind: 'supplement', name: '维生素 D', baseUnit: 'tablet', categoryId: 'supplements', profile: { kind: 'supplement', servingQuantity: 1, servingUnit: 'tablet', ingredients: ['维生素 D3'], defaultFrequency: '每日一次', userInstructions: '用户记录：随早餐查看', reminder: { enabled: true, localTimes: ['08:00'], note: '用户自定义提醒' } } }),
  item({ id: 'medicine', kind: 'medicine', name: '用户记录的感冒片', baseUnit: 'tablet', categoryId: 'medicine-category', locationId: 'medicine-box', medicine: { tradeName: '家庭药箱记录', genericName: '用户录入通用名', specification: '12 片/盒', dosageForm: '片剂', packageDescription: '铝塑板', userInstructions: '仅记录包装原文', userScheduleText: '用户自定义：需要时查看记录', asNeeded: true } }),
  item({ id: 'detergent', kind: 'household_consumable', name: '洗衣液', baseUnit: 'ml', categoryId: 'cleaning', locationId: 'laundry', profile: { kind: 'household_consumable', defaultPurchaseQuantity: 2, defaultPurchaseUnit: 'bottle', consumptionCycleDays: 45, estimatedDepletionDate: '2026-09-15' } }),
  item({ id: 'vacuum', kind: 'household_durable', name: '吸尘器', baseUnit: 'each', categoryId: 'appliance', locationId: 'storage', profile: { kind: 'household_durable', valueMinor: 229900, currency: 'CNY', valueAsOfDate: '2026-08-01', lifecycleStatus: 'maintenance', acquiredOn: '2025-03-01', warrantyExpiresOn: '2027-03-01', maintenanceRecords: [{ id: 'maintenance-1', performedOn: '2026-07-18', summary: '更换滤芯', costMinor: 12900, currency: 'CNY' }], setItemIds: ['filter'] } }),
]

const taxonomy = [
  { id: 'fresh', kind: 'category', name: '生鲜', parentId: null, status: 'active', position: 10 },
  { id: 'protein', kind: 'category', name: '蛋白质', parentId: 'fresh', status: 'active', position: 20 },
  { id: 'dry-goods', kind: 'category', name: '干货', parentId: null, status: 'active', position: 30 },
  ...Array.from({ length: 12 }, (_, index) => ({ id: `dense-${index}`, kind: 'category', name: `密集分类 ${index + 1}`, parentId: index % 3 === 0 ? 'dry-goods' : null, status: 'active', position: 40 + index })),
  { id: 'breakfast', kind: 'tag', name: '早餐', parentId: null, status: 'active', position: 10 },
  { id: 'fridge', kind: 'location', name: '冷藏层', parentId: null, status: 'active', position: 10 },
  { id: 'pantry', kind: 'location', name: '食品柜', parentId: null, status: 'active', position: 20 },
].map((entry) => ({ ...entry, version: 1, createdAt: timestamp, updatedAt: timestamp, deletedAt: null }))

const units = [
  { id: 'g', code: 'g', name: '克', symbol: 'g', dimension: 'mass', baseCode: 'g', toBaseFactor: 1, builtIn: true },
  { id: 'ml', code: 'ml', name: '毫升', symbol: 'ml', dimension: 'volume', baseCode: 'ml', toBaseFactor: 1, builtIn: true },
  { id: 'tablet', code: 'tablet', name: '片', symbol: '片', dimension: 'count', baseCode: 'each', toBaseFactor: 1, builtIn: true },
  { id: 'each', code: 'each', name: '个', symbol: '个', dimension: 'count', baseCode: 'each', toBaseFactor: 1, builtIn: true },
  { id: 'box', code: 'box', name: '盒', symbol: '盒', dimension: 'package', baseCode: 'each', toBaseFactor: null, builtIn: false },
].map((unit) => ({ ...unit, version: 1, createdAt: timestamp, updatedAt: timestamp, deletedAt: null }))

const balances = [
  { itemId: 'oat', baseUnit: 'g', onHand: 860, warnings: [] },
  { itemId: 'milk', baseUnit: 'ml', onHand: 250, warnings: [] },
  { itemId: 'medicine', baseUnit: 'tablet', onHand: 8, warnings: [] },
]
const transactions = [{ id: 'purchase-oat', itemId: 'oat', kind: 'purchase', quantity: 2, unit: 'box', baseQuantity: 1000, deltaBaseQuantity: 1000, batchId: 'batch-oat-aug', occurredAt: '2026-08-01T10:00:00.000Z', reversesTransactionId: null, reversedByTransactionId: null, warning: null, note: '八月采购', allocations: [], createdAt: timestamp }, { id: 'consume-oat', itemId: 'oat', kind: 'consume', quantity: 140, unit: 'g', baseQuantity: 140, deltaBaseQuantity: -140, batchId: null, occurredAt: '2026-08-20T07:30:00.000Z', reversesTransactionId: null, reversedByTransactionId: null, warning: null, note: '早餐', allocations: [{ batchId: 'batch-oat-aug', quantity: 140, expiresOn: '2026-10-01' }], createdAt: timestamp }]
const forecasts = [{ status: 'complete', itemId: 'oat', baseUnit: 'g', onHand: 860, plannedDemand: 400, projectedBalance: 460, minimumStock: 200, shortage: 0, outstandingShopping: 0, packageQuantity: 500, suggestedPurchase: 0 }, { status: 'incomplete', itemId: 'milk', baseUnit: 'ml', onHand: 250, reason: 'missing_conversion' }]

type FailureMode = 'none' | 'conflict' | 'forbidden' | 'server' | 'offline'

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function installFixture(page: Page, state: { read: FailureMode; mutation: FailureMode; delayMs: number }) {
  await page.addInitScript((value) => sessionStorage.setItem('lifeops:session:v1', JSON.stringify(value)), session)
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'GET' && path === '/api/v1/auth/session') return json(route, { user: { id: 'p3-t9-browser', account: session.account, displayName: 'P3-T9 Browser' }, csrfToken: 'csrf-p3-t9-browser' })
    if (state.delayMs && request.method() === 'GET' && path === '/api/v1/life/catalog') await new Promise((resolve) => setTimeout(resolve, state.delayMs))
    if (request.method() === 'GET' && path === '/api/v1/life/catalog' && state.read !== 'none') {
      const status = state.read === 'forbidden' ? 403 : 500
      return json(route, { error: { code: state.read.toUpperCase(), message: 'fixture failure' } }, status)
    }
    if (request.method() !== 'GET' && state.mutation === 'conflict') return json(route, { error: { code: 'VERSION_CONFLICT', message: 'fixture conflict' } }, 409)
    if (request.method() !== 'GET' && state.mutation === 'offline') return route.abort('internetdisconnected')
    if (request.method() === 'GET' && path === '/api/v1/life/catalog') return json(route, catalog)
    if (request.method() === 'GET' && path === '/api/v1/life/taxonomy/categories') return json(route, taxonomy.filter((entry) => entry.kind === 'category'))
    if (request.method() === 'GET' && path === '/api/v1/life/taxonomy/tags') return json(route, taxonomy.filter((entry) => entry.kind === 'tag'))
    if (request.method() === 'GET' && path === '/api/v1/life/taxonomy/locations') return json(route, taxonomy.filter((entry) => entry.kind === 'location'))
    if (request.method() === 'GET' && path === '/api/v1/life/units') return json(route, units)
    if (request.method() === 'GET' && path === '/api/v1/life/inventory/balances') return json(route, balances)
    if (request.method() === 'GET' && path === '/api/v1/life/inventory/transactions') return json(route, transactions)
    if (request.method() === 'GET' && path === '/api/v1/life/inventory/forecasts') return json(route, forecasts)
    if (request.method() === 'GET' && path === '/api/v1/life/trash/catalog') return json(route, [{ ...catalog[0], deletedAt: timestamp, version: 2 }])
    if (request.method() === 'GET' && path.endsWith('/delete-impact')) return json(route, { recipeIds: ['recipe-breakfast'], templateIds: ['template-weekday'], futurePlanIds: ['plan-2026-08-25'] })
    if (request.method() === 'POST' && path === '/api/v1/life/catalog/batch') return json(route, catalog.slice(0, 2).map((entry) => ({ ...entry, version: 2 })))
    if (request.method() === 'PATCH' && path.startsWith('/api/v1/life/catalog/')) return json(route, { ...catalog.find((entry) => path.endsWith(`/${entry.id}`)), ...request.postDataJSON(), version: 2 })
    if (request.method() === 'POST' && path.includes('/inventory/transactions')) return json(route, transactions[0], 201)
    if (request.method() === 'DELETE') return route.fulfill({ status: 204 })
    return json(route, {})
  })
}

test.beforeAll(async () => mkdir(evidenceDir, { recursive: true }))

test('P3-T9 catalog visual gate covers four viewports, 320 CSS px, 200% zoom and reduced motion', async ({ page }) => {
  test.slow()
  const state = { read: 'none' as FailureMode, mutation: 'none' as FailureMode, delayMs: 0 }
  await installFixture(page, state)
  const viewports = [
    { name: '1440x900', width: 1440, height: 900 },
    { name: '1024x768', width: 1024, height: 768 },
    { name: '768x1024', width: 768, height: 1024 },
    { name: '390x844', width: 390, height: 844 },
    { name: '320x844', width: 320, height: 844 },
  ]
  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    await page.goto('/app/life/ingredients?item=oat')
    await expect(page.getByRole('heading', { name: '物品与库存', level: 1 })).toBeVisible()
    await expect(page.getByText('缺少 carton → ml 换算，预测不会猜测数量')).toBeVisible()
    expect(await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))).toEqual({ client: viewport.width, scroll: viewport.width })
    if (viewport.width <= 1040) {
      expect(await page.locator('.catalog-inspector').evaluate((element) => getComputedStyle(element).position)).toBe('fixed')
      await expect(page.getByRole('button', { name: '返回列表' })).toBeVisible()
      const [headerBox, inspectorBox] = await Promise.all([
        page.locator('.workspace-header').boundingBox(),
        page.locator('.catalog-inspector').boundingBox(),
      ])
      expect(Math.abs((headerBox!.y + headerBox!.height) - inspectorBox!.y), JSON.stringify({ viewport, headerBox, inspectorBox })).toBeLessThanOrEqual(1)
    }
    await page.screenshot({ path: `${evidenceDir}/inventory-${viewport.name}.png`, fullPage: viewport.width > 1040 })
    if (viewport.width <= 768) {
      await page.getByRole('button', { name: '返回列表' }).click()
      await page.screenshot({ path: `${evidenceDir}/inventory-list-${viewport.name}-full-page.png`, fullPage: true })
    }
  }

  await page.setViewportSize({ width: 640, height: 900 })
  await page.goto('/app/life/ingredients')
  await page.evaluate(() => { document.documentElement.style.zoom = '2' })
  await expect(page.getByRole('heading', { name: '物品与库存', level: 1 })).toBeVisible()
  await page.screenshot({ path: `${evidenceDir}/inventory-200-percent-zoom.png`, fullPage: true })

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/app/life/medicines')
  await expect(page.getByText('本页不验证或推断药品用法。需要医疗判断时请联系有资质的专业人员。')).toBeVisible()
  await page.screenshot({ path: `${evidenceDir}/medicine-390x844-reduced-motion.png` })
})

test('P3-T9 keyboard, focus, Back, dense taxonomy, batch, editor and mobile task-layer journeys remain reversible', async ({ page }) => {
  const state = { read: 'none' as FailureMode, mutation: 'none' as FailureMode, delayMs: 0 }
  await installFixture(page, state)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/app/life/ingredients')
  await expect(page.getByRole('treeitem')).toHaveCount(18)
  await page.getByRole('button', { name: '下移 生鲜' }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('searchbox', { name: '搜索当前列表' }).fill('oats')
  await expect(page).toHaveURL(/q=oats/)
  await expect(page.getByRole('button', { name: '查看 燕麦' })).toBeVisible()
  await page.getByRole('searchbox', { name: '搜索当前列表' }).fill('')
  await page.getByRole('button', { name: '查看 燕麦' }).click()
  await expect(page).toHaveURL(/item=oat/)
  await page.screenshot({ path: `${evidenceDir}/filmstrip-01-inspector.png`, fullPage: true })
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '编辑 燕麦' })
  await expect(editor).toBeVisible()
  expect(await editor.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  await page.screenshot({ path: `${evidenceDir}/filmstrip-02-editor.png` })
  await page.keyboard.press('Escape')
  await expect(editor).toBeHidden()
  await page.goBack()
  await expect(page).not.toHaveURL(/item=oat/)

  await page.getByLabel('选择 燕麦').check()
  await page.getByLabel('选择 牛奶').check()
  await page.getByRole('button', { name: '批量修改 2 项' }).click()
  await page.getByLabel('批量分类').selectOption('fresh')
  await expect(page.getByRole('region', { name: '批量变更预览' })).toContainText('分类将改为“生鲜”')
  await page.screenshot({ path: `${evidenceDir}/filmstrip-03-batch-preview.png`, fullPage: true })
  await page.getByRole('button', { name: '确认批量修改' }).click()
  await page.getByRole('button', { name: '撤销上次批量修改' }).click()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/app/life/household?kind=household_durable')
  await page.getByRole('button', { name: '查看 吸尘器' }).click()
  await expect(page.getByRole('button', { name: '返回列表' })).toBeVisible()
  await page.screenshot({ path: `${evidenceDir}/filmstrip-04-mobile-household-inspector.png` })
  await page.getByRole('button', { name: '返回列表' }).click()
  await expect(page).not.toHaveURL(/item=vacuum/)
})

test('P3-T9 preserves the Today and Calendar daylight workspaces at desktop and mobile viewports', async ({ page }) => {
  await installLifeFixture(page)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/app/life?date=2026-08-21')
  await expect(page.getByRole('heading', { name: '今日生活', level: 1 })).toBeVisible()
  await page.screenshot({ path: `${evidenceDir}/today-1440x900.png`, fullPage: true })
  await page.goto('/app/life/calendar?date=2026-08-21')
  await expect(page.getByRole('dialog', { name: '生活日历' })).toBeVisible()
  await page.screenshot({ path: `${evidenceDir}/calendar-1440x900.png`, fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/app/life?date=2026-08-21')
  await expect(page.getByRole('heading', { name: '今日生活', level: 1 })).toBeVisible()
  await page.screenshot({ path: `${evidenceDir}/today-390x844.png`, fullPage: true })
  await page.goto('/app/life/calendar?date=2026-08-21')
  await expect(page.getByRole('dialog', { name: '生活日历' })).toBeVisible()
  await page.screenshot({ path: `${evidenceDir}/calendar-390x844.png`, fullPage: true })
})

test('P3-T9 failure states keep loading, 403, 500 retry, conflict and offline changes scoped', async ({ page, context }) => {
  const state = { read: 'none' as FailureMode, mutation: 'none' as FailureMode, delayMs: 250 }
  await installFixture(page, state)
  await page.goto('/app/life/ingredients')
  await expect(page.locator('.life-catalog__loading')).toContainText('正在读取分类、库存与价格事实')
  await expect(page.getByText('燕麦')).toBeVisible()

  state.read = 'forbidden'
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('没有查看或修改这个生活事实库的权限')
  state.read = 'server'
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('生活事实库暂时无法加载')
  state.read = 'none'
  await page.getByRole('button', { name: '重新加载' }).click()
  await expect(page.getByText('燕麦')).toBeVisible()

  state.mutation = 'conflict'
  await page.getByRole('button', { name: '查看 燕麦' }).click()
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await page.getByRole('button', { name: '保存物品' }).click()
  await expect(page.getByRole('alert')).toContainText('内容可能已在另一处更新')
  await page.getByRole('button', { name: '关闭', exact: true }).click()

  state.mutation = 'offline'
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await context.setOffline(true)
  await page.getByRole('button', { name: '保存物品' }).click()
  await expect(page.getByRole('alert')).toContainText('当前设备离线，修改尚未保存')
  await context.setOffline(false)
})
