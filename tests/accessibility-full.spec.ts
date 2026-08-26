import { expect, test, type Page, type Route } from '@playwright/test'
import { expectNoSeriousOrCriticalViolations } from './helpers/axe'
import { installPrivateCoreFixture } from './private-core-fixtures'

const publicRoutes = ['/', '/now', '/doing', '/learning', '/moments', '/archive'] as const
const privateRoutes = [
  '/app/overview', '/app/goals', '/app/schedule', '/app/habits', '/app/records',
  '/app/reviews', '/app/knowledge', '/app/life', '/app/life/calendar', '/app/life/plans',
  '/app/life/recipes', '/app/life/ingredients', '/app/life/medicines', '/app/life/household',
  '/app/life/fitness', '/app/life/shopping', '/app/life/analytics', '/app/life/data',
  '/app/publish', '/app/platform', '/app/settings',
] as const

const timestamp = '2026-08-23T04:00:00.000Z'

async function fulfillJson(route: Route, body: unknown, status = 200) {
  try {
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  } catch (error) {
    // A navigation can cancel a deliberately delayed loading-state request
    // after Playwright has already disposed its route. The next page owns the
    // live assertion, so only that exact stale-route condition is ignorable.
    if (error instanceof Error && error.message.includes('Route is already handled')) return
    throw error
  }
}

async function installPrivateSession(page: Page) {
  await page.addInitScript((session) => {
    sessionStorage.setItem('lifeops:session:v1', JSON.stringify(session))
  }, { mode: 'local-preview', account: 'p6-t5-a11y@lifeops.local' })
}

async function installEmptyApi(page: Page, mode: 'empty' | 'error' | 'loading') {
  await page.route('**/api/v1/**', async (route) => {
    if (mode === 'loading') await new Promise((resolve) => setTimeout(resolve, 600))
    if (mode === 'error') return fulfillJson(route, { error: { code: 'FIXTURE_FAILURE', message: '可恢复的验收失败。' } }, 500)
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    if (path === '/api/v1/auth/session') return fulfillJson(route, { user: { id: 'a11y', account: 'p6-t5-a11y@lifeops.local', displayName: 'A11y' }, csrfToken: 'a11y-csrf' })
    if (path === '/api/v1/settings') return fulfillJson(route, {
      version: 1, updatedAt: timestamp, appearance: { theme: 'system', motion: 'system' },
      locale: { locale: 'zh-CN', timezone: 'Asia/Shanghai', weekStartsOn: 1 },
      defaults: { startRoute: '/app', quickCreateType: 'record' },
      life: { lowStockDays: 7, expiryWarningDays: 14, remindersEnabled: true },
      publicSite: { defaultVisibility: 'private', rssEnabled: true }, connections: [],
    })
    if (path === '/api/v1/state') return fulfillJson(route, { schemaVersion: 1, plans: [], records: [], reviews: [], knowledge: [], snapshots: [] })
    if (path === '/api/v1/habits') return fulfillJson(route, { from: url.searchParams.get('from'), to: url.searchParams.get('to'), habits: [], entries: [] })
    if (path === '/api/v1/knowledge') return fulfillJson(route, { items: [] })
    if (path === '/api/v1/search') return fulfillJson(route, { items: [] })
    if (path === '/api/v1/life/calendar') return fulfillJson(route, [])
    if (path === '/api/v1/life/budgets') return fulfillJson(route, [])
    if (path === '/api/v1/life/shopping') return fulfillJson(route, { suggestions: [], list: [], purchases: [], returns: [] })
    if (path === '/api/v1/life/analytics') return fulfillJson(route, {
      from: '2026-08-17', to: '2026-08-23', days: [],
      totals: { cashExpenditureMinor: 0, consumptionCostMinor: 0, plannedCount: 0, actualCount: 0, incompleteCount: 0 },
      drillDown: { cashExpenditure: [], consumptionCost: [] },
    })
    if (/\/api\/v1\/life\/day-plans\/[^/]+\/projection$/.test(path)) return fulfillJson(route, { date: '2026-08-23', status: 'incomplete', plannedNutrition: null, actualNutrition: {}, plannedCostMinor: null, actualCostMinor: null, plannedEnergyKcal: 0, actualEnergyKcal: 0, inventory: [], items: [], sourceIds: [] })
    if (/\/api\/v1\/life\/day-plans\/[^/]+$/.test(path)) return fulfillJson(route, { id: null, date: '2026-08-23', mealSlots: [], items: [], entityVersion: 0 })
    if (/\/api\/v1\/life\/timeline\/[^/]+$/.test(path)) return fulfillJson(route, { date: '2026-08-23', timelineItems: [] })
    if (path === '/api/v1/platform/overview') {
      const source = { source: 'fixture', state: 'disabled', checkedAt: null, latencyMs: null, message: '未配置' }
      const envelope = { source, cachedAt: null, data: null }
      return fulfillJson(route, {
        connections: ['Web', 'API', 'MySQL', 'Kubernetes', 'Prometheus', 'Alertmanager', 'Elasticsearch', 'Argo CD']
          .map((name) => ({ ...source, source: name })),
        kubernetes: envelope, monitoring: envelope, alerts: envelope, logs: envelope, delivery: envelope,
      })
    }
    if (path === '/api/v1/platform/technologies') return fulfillJson(route, { technologies: [] })
    if (path.startsWith('/api/v1/platform/')) return fulfillJson(route, { source: { source: 'fixture', state: 'disabled', checkedAt: null, latencyMs: null, message: '未配置' }, cachedAt: null, data: null })
    if (path === '/api/v1/public/content') return fulfillJson(route, [])
    if (path === '/api/v1/public/feed.xml') return route.fulfill({ status: 200, contentType: 'application/rss+xml', body: '<rss />' })
    if (path.includes('/collections')) return fulfillJson(route, [])
    if (path.includes('/resurface')) return fulfillJson(route, [])
    if (path.includes('/conflicts')) return fulfillJson(route, [])
    return fulfillJson(route, [])
  })
}

test.describe('public accessibility acceptance', () => {
  for (const route of publicRoutes) {
    test(`${route} has no serious or critical WCAG violations`, async ({ page }) => {
      await page.route('**/api/v1/public/**', (request) => fulfillJson(request, []))
      await page.goto(route)
      await expect(page.locator('main')).toBeVisible()
      await expectNoSeriousOrCriticalViolations(page, { route, state: 'data' })
    })
  }

  test('login dialog exposes focus, errors and a keyboard-only close path', async ({ page }) => {
    await page.goto('/')
    const trigger = page.getByRole('button', { name: '登录 LifeOps' })
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByLabel('账号')).toBeFocused()
    await page.getByRole('button', { name: '进入 LifeOps' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    const publicCopy = page.getByTestId('public-copy')
    await expect(publicCopy).toHaveAttribute('aria-hidden', 'true')
    await expect.poll(async () => publicCopy.evaluate((element) => (
      Number.parseFloat(getComputedStyle(element).opacity)
    ))).toBeLessThanOrEqual(0.24)
    await expectNoSeriousOrCriticalViolations(page, { route: '/', state: 'interactive' })
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
  })
})

test.describe('private accessibility acceptance', () => {
  for (const route of privateRoutes) {
    test(`${route} covers data, empty, loading and error states`, async ({ page }) => {
      test.setTimeout(90_000)
      await installPrivateSession(page)
      await installPrivateCoreFixture(page)
      if (route.startsWith('/app/life') || route === '/app/platform') await installEmptyApi(page, 'empty')
      await page.goto(route)
      await expect(page.locator('main, article').first()).toBeVisible()
      await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0)
      await expectNoSeriousOrCriticalViolations(page, { route, state: 'data' })

      for (const state of ['empty', 'loading', 'error'] as const) {
        await page.unrouteAll({ behavior: 'ignoreErrors' })
        await installEmptyApi(page, state)
        await page.goto(route)
        await expect(page.locator('main, article').first()).toBeVisible()
        await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0)
        await expectNoSeriousOrCriticalViolations(page, { route, state })
      }
    })
  }

  test('keyboard-only navigation, corner calendar and live-save status remain perceivable', async ({ page }) => {
    await installPrivateSession(page)
    await installEmptyApi(page, 'empty')
    await page.goto('/app/life')
    const calendar = page.getByRole('link', { name: /生活日历/ })
    await calendar.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: /生活日历/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(calendar).toBeFocused()

    await page.goto('/app/settings')
    await expect(page.locator('[aria-live], [role="status"]').first()).toBeVisible()
  })
})
