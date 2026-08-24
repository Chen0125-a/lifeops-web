import { expect, test, type Route } from '@playwright/test'
import { installPrivateCoreFixture, privateCoreRoutes } from './private-core-fixtures'

const timestamp = '2026-08-23T04:30:00.000Z'

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

test('one authenticated journey crosses the complete product without losing its shell, writes or preference', async ({ page }) => {
  test.setTimeout(120_000)
  await installPrivateCoreFixture(page)
  let settings = {
    version: 1, updatedAt: timestamp, appearance: { theme: 'system', motion: 'system' },
    locale: { locale: 'zh-CN', timezone: 'Asia/Shanghai', weekStartsOn: 1 },
    defaults: { startRoute: '/app', quickCreateType: 'record' },
    life: { lowStockDays: 7, expiryWarningDays: 14, remindersEnabled: true },
    publicSite: { defaultVisibility: 'private', rssEnabled: true }, connections: [],
  }
  const created: string[] = []
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'POST' && path === '/api/v1/records') {
      const body = request.postDataJSON() as Record<string, unknown>
      created.push('record')
      return json(route, { ...body, id: 'complete-record', version: 1, links: [], mediaIds: [], coverMediaId: null, pinned: false, archivedAt: null, deletedAt: null, createdAt: timestamp, updatedAt: timestamp }, 201)
    }
    if (request.method() === 'POST' && path === '/api/v1/tasks') {
      const body = request.postDataJSON() as Record<string, unknown>
      created.push('task')
      return json(route, { ...body, id: 'complete-task', status: 'planned', version: 1, checklist: [], tags: [], startsAt: null, endsAt: null, completedAt: null, deletedAt: null, createdAt: timestamp, updatedAt: timestamp }, 201)
    }
    if (request.method() === 'GET' && path === '/api/v1/settings') return json(route, settings)
    if (request.method() === 'PATCH' && path === '/api/v1/settings') {
      settings = { ...settings, ...(request.postDataJSON() as object), version: settings.version + 1, updatedAt: timestamp }
      return json(route, settings)
    }
    if (request.method() === 'GET' && [
      '/api/v1/life/catalog', '/api/v1/life/recipes', '/api/v1/life/prepared-food',
      '/api/v1/life/trash/recipes', '/api/v1/life/trash/catalog', '/api/v1/life/trash/units',
      '/api/v1/life/units', '/api/v1/life/templates', '/api/v1/life/day-plans/recurrence-rules',
      '/api/v1/life/fitness', '/api/v1/life/inventory-policies', '/api/v1/life/exports',
      '/api/v1/life/inventory/balances', '/api/v1/life/inventory/transactions',
      '/api/v1/life/inventory/forecasts',
    ].includes(path)) return json(route, [])
    if (request.method() === 'GET' && path.startsWith('/api/v1/life/catalog?')) return json(route, [])
    if (request.method() === 'GET' && path.startsWith('/api/v1/life/taxonomy/')) return json(route, [])
    if (request.method() === 'GET' && path === '/api/v1/life/calendar') return json(route, [])
    if (request.method() === 'GET' && path === '/api/v1/life/shopping') return json(route, { suggestions: [], formalItems: [] })
    if (request.method() === 'GET' && path === '/api/v1/life/budgets') return json(route, [])
    if (request.method() === 'GET' && path === '/api/v1/life/analytics') return json(route, {
      from: '2026-08-17', to: '2026-08-23', days: [],
      totals: { cashExpenditureMinor: 0, consumptionCostMinor: 0, plannedCount: 0, actualCount: 0, incompleteCount: 0 },
      drillDown: { cashExpenditure: [], consumptionCost: [] },
    })
    if (request.method() === 'GET' && /^\/api\/v1\/life\/day-plans\/[^/]+\/projection$/.test(path)) return json(route, {
      date: '2026-08-23', status: 'incomplete', plannedNutrition: null, actualNutrition: {},
      plannedCostMinor: null, actualCostMinor: null, plannedEnergyKcal: 0, actualEnergyKcal: 0,
      sourceIds: [], inventory: [], items: [],
    })
    if (request.method() === 'GET' && /^\/api\/v1\/life\/day-plans\/[^/]+$/.test(path)) return json(route, {
      id: 'empty-day', date: '2026-08-23', mealSlots: [], items: [], entityVersion: 1,
    })
    if (request.method() === 'GET' && /^\/api\/v1\/life\/timeline\/[^/]+$/.test(path)) return json(route, {
      date: '2026-08-23', timelineItems: [],
    })
    if (path === '/api/v1/platform/overview') {
      const source = { source: 'fixture', state: 'disabled', checkedAt: null, latencyMs: null, message: '未配置' }
      const envelope = { source, cachedAt: null, data: null }
      return json(route, {
        connections: ['Web', 'API', 'MySQL', 'Kubernetes', 'Prometheus', 'Alertmanager', 'Elasticsearch', 'Argo CD']
          .map((name) => ({ ...source, source: name })),
        kubernetes: envelope, monitoring: envelope, alerts: envelope, logs: envelope, delivery: envelope,
      })
    }
    if (path === '/api/v1/platform/technologies') return json(route, { technologies: [] })
    if (path.startsWith('/api/v1/platform/')) return json(route, { source: { source: 'fixture', state: 'disabled', checkedAt: null, latencyMs: null, message: '未配置' }, cachedAt: null, data: null })
    return route.fallback()
  })

  await page.goto('/app/overview')
  await expect(page.locator('[data-private-shell]')).toBeVisible()

  await test.step('quick record and an explicit alternate task type use the same mounted shell', async () => {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+/' : 'Control+/')
    const dialog = page.getByRole('dialog', { name: '快速记录' })
    await dialog.getByLabel('标题').fill('完整产品旅程记录')
    await dialog.getByRole('button', { name: '创建记录' }).click()
    await expect(dialog.getByRole('status', { name: '创建成功' })).toContainText('完整产品旅程记录')
    await dialog.getByRole('button', { name: '再建一个' }).click()
    await dialog.getByRole('combobox', { name: '记录类型' }).selectOption('task')
    await dialog.getByLabel('标题').fill('完整产品旅程任务')
    await dialog.getByRole('button', { name: '创建任务' }).click()
    await expect(dialog.getByRole('status', { name: '创建成功' })).toContainText('完整产品旅程任务')
    await dialog.getByRole('button', { name: '留在这里' }).click()
    expect(created).toEqual(['record', 'task'])
  })

  await test.step('original domains remain linked in one closed-loop workspace', async () => {
    for (const route of privateCoreRoutes) {
      await page.goto(route.path)
      await expect(page.getByRole('heading', { name: route.heading, level: 1, exact: true })).toBeVisible()
      await expect(page.locator('[data-private-shell]')).toBeVisible()
    }
  })

  await test.step('the independent life workspace exposes every task-native module', async () => {
    const lifeRoutes = [
      '/app/life', '/app/life/calendar', '/app/life/plans', '/app/life/recipes',
      '/app/life/ingredients', '/app/life/medicines', '/app/life/household', '/app/life/fitness',
      '/app/life/shopping', '/app/life/analytics', '/app/life/data',
    ]
    for (const route of lifeRoutes) {
      await page.goto(route)
      await expect(page.locator('[data-private-shell]')).toBeVisible()
      await expect(page.locator('[data-route-panel-current]')).toHaveCount(1)
    }
  })

  await test.step('platform truth is inspectable and a preference survives reload', async () => {
    await page.goto('/app/platform')
    await expect(page.getByRole('heading', { name: '平台运行中心', level: 1 })).toBeVisible()
    for (const tab of ['总览', 'Kubernetes', '监控', '告警', '日志', '发布', '技术档案']) {
      await page.getByRole('tab', { name: tab, exact: true }).click()
    }
    await page.goto('/app/settings')
    await page.getByRole('button', { name: '外观与动效' }).click()
    await page.getByLabel('界面主题').selectOption('dark')
    await expect(page.getByRole('region', { name: '外观与动效' }).getByRole('status')).toHaveText('已保存')
    await page.reload()
    await page.getByRole('button', { name: '外观与动效' }).click()
    await expect(page.getByLabel('界面主题')).toHaveValue('dark')
  })
})

// The mutation-heavy legs remain independently replayable in their domain suites so a failure
// identifies the exact owner: goals/schedule/habits, records/reviews/knowledge, publishing-public,
// life catalog/recipes/planning/commerce/data-recovery, Obsidian, platform, search and settings.
