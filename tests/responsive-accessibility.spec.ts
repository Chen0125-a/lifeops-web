import { expect, test } from '@playwright/test'
import { contentVisualRoutes, installPrivateCoreFixture, privateCoreRoutes } from './private-core-fixtures'

test.use({ viewport: { width: 390, height: 844 } })

test('public and private surfaces fit a phone and expose usable touch targets', async ({ page }) => {
  await page.route('**/api/v1/public/content?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '[]',
  }))
  await page.addInitScript(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /把日子/ })).toBeVisible()
  await expect(page.locator('[data-public-orbit]')).toHaveAttribute('data-motion-enhanced', 'true')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
  const target = await page.locator('[data-public-object]').first().boundingBox()
  expect(Math.min(target?.width ?? 0, target?.height ?? 0)).toBeGreaterThanOrEqual(44)

  await page.getByRole('button', { name: '登录 LifeOps' }).click()
  await page.getByLabel('账号').fill('mobile@lifeops.local')
  await page.getByRole('textbox', { name: '密码', exact: true }).fill('local-preview')
  await page.getByRole('button', { name: '进入 LifeOps' }).click()
  await expect(page.locator('[data-private-shell]')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)

  for (const route of ['/app/plans', '/app/records', '/app/reviews', '/app/knowledge', '/app/snapshots', '/doing', '/learning']) {
    await page.goto(route)
    await expect(page.locator('main')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), route).toBe(true)
  }
})

test('reduced-motion preference disables orbit and entry animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('[data-public-orbit]')).toHaveAttribute('data-reduced-motion', 'true')
  await expect(page.locator('[data-public-orbit]')).toHaveAttribute('data-motion-suspended', 'true')
  await page.getByRole('button', { name: '登录 LifeOps' }).click()
  await page.getByLabel('账号').fill('motion@lifeops.local')
  await page.getByRole('textbox', { name: '密码', exact: true }).fill('local-preview')
  await page.getByRole('button', { name: '进入 LifeOps' }).click()
  await expect(page).toHaveURL(/\/app\/overview$/)
  await expect(page.locator('[data-private-shell]')).toBeVisible()
})

const privateViewports = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'tablet-1024', width: 1024, height: 768 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'phone-390', width: 390, height: 844 },
] as const

for (const viewport of privateViewports) {
  test(`original private-core routes preserve their task-native layout at ${viewport.name}`, async ({ page }) => {
    await installPrivateCoreFixture(page)
    await page.setViewportSize(viewport)

    for (const route of privateCoreRoutes) {
      await page.goto(route.path)
      await expect(page.getByRole('heading', { name: route.heading, level: 1, exact: true })).toBeVisible()
      await expect(page.locator('[data-route-panel-current]')).toHaveCount(1)
      await page.waitForTimeout(280)

      const geometry = await page.evaluate(() => {
        const root = document.documentElement
        const viewportWidth = root.clientWidth
        const viewportHeight = window.innerHeight
        const clippedFixed = Array.from(document.body.querySelectorAll<HTMLElement>('*')).flatMap((element) => {
          const style = getComputedStyle(element)
          const rect = element.getBoundingClientRect()
          if (style.position !== 'fixed' || rect.width <= 0 || rect.height <= 0 || style.visibility === 'hidden') return []
          if (rect.left >= -1 && rect.right <= viewportWidth + 1 && rect.top >= -1 && rect.bottom <= viewportHeight + 1) return []
          return [{ className: element.className, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }]
        })
        const main = document.querySelector<HTMLElement>('.workspace-route')
        const mainBox = main?.getBoundingClientRect()
        return {
          fits: root.scrollWidth <= root.clientWidth + 1,
          scrollWidth: root.scrollWidth,
          clientWidth: root.clientWidth,
          clippedFixed,
          mainWidth: mainBox?.width ?? 0,
          viewportWidth,
        }
      })

      expect(geometry.fits, `${viewport.name} ${route.path}: ${JSON.stringify(geometry)}`).toBe(true)
      expect(geometry.clippedFixed, `${viewport.name} ${route.path}`).toEqual([])
      expect(geometry.mainWidth, `${viewport.name} ${route.path}`).toBeGreaterThanOrEqual(geometry.viewportWidth * 0.84)
      await expect(page.locator('.private-orrery')).toHaveCount(0)

      if (viewport.name === 'phone-390' && route.slug === 'overview') {
        const timelineHeight = await page.locator('.overview-timeline').evaluate((element) => element.getBoundingClientRect().height)
        expect(timelineHeight, '低数据量时间线不能制造半屏无效留白').toBeLessThan(320)
      }
      if (viewport.name === 'desktop-1440' && route.slug === 'publish') {
        const headingLines = await page.getByRole('heading', { name: route.heading, level: 1, exact: true }).evaluate((element) => {
          const style = getComputedStyle(element)
          const measuredLineHeight = Number.parseFloat(style.lineHeight)
          const lineHeight = Number.isFinite(measuredLineHeight) ? measuredLineHeight : Number.parseFloat(style.fontSize) * 1.2
          return Math.round(element.getBoundingClientRect().height / lineHeight)
        })
        expect(headingLines, '桌面发布标题不能留下两个汉字的孤行').toBe(1)
      }
    }
  })
}

for (const mode of [
  { name: '320 CSS px', viewport: { width: 320, height: 900 }, zoom: '' },
  { name: '200% zoom', viewport: { width: 640, height: 900 }, zoom: '200%' },
] as const) {
  test(`knowledge, Obsidian, publishing and public content reflow at ${mode.name}`, async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined }))
    await installPrivateCoreFixture(page)
    await page.setViewportSize(mode.viewport)

    for (const route of contentVisualRoutes) {
      await page.goto(route.path)
      await page.evaluate((zoom) => { document.documentElement.style.zoom = zoom }, mode.zoom)
      await page.waitForTimeout(360)
      const currentPanel = page.locator('[data-route-panel-current]')
      const heading = await currentPanel.count()
        ? currentPanel.getByRole('heading', { name: route.heading, level: 1, exact: true })
        : page.getByRole('heading', { name: route.heading, level: 1, exact: true }).last()
      await expect(heading).toBeVisible()
      const geometry = await page.evaluate(() => {
        const root = document.documentElement
        const clippedFixed = Array.from(document.body.querySelectorAll<HTMLElement>('*')).flatMap((element) => {
          const style = getComputedStyle(element)
          const rect = element.getBoundingClientRect()
          if (style.position !== 'fixed' || rect.width <= 0 || rect.height <= 0 || style.visibility === 'hidden') return []
          if (rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1) return []
          return [{ className: String(element.className), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }]
        })
        return { fits: root.scrollWidth <= root.clientWidth + 1, scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, clippedFixed }
      })
      expect(geometry.fits, `${mode.name} ${route.path}: ${JSON.stringify(geometry)}`).toBe(true)
      expect(geometry.clippedFixed, `${mode.name} ${route.path}`).toEqual([])
    }
  })
}

test('platform and global settings reflow without compressing the desktop dashboard hierarchy', async ({ page }) => {
  await installPrivateCoreFixture(page)
  const source = (name: string, state: 'connected' | 'degraded' | 'disabled') => ({
    source: name, state, checkedAt: state === 'disabled' ? null : '2026-08-23T03:30:00.000Z', latencyMs: null,
    message: state === 'connected' ? '已验证' : state === 'degraded' ? '来源暂时不可用' : '等待配置',
  })
  const metric = {
    key: 'availability', unit: 'ratio', state: 'connected', deepLinkUrl: null,
    series: [{ labels: { service: 'api' }, points: [{ timestamp: 1_777_000_000, value: .998 }] }],
  }
  const empty = (name: string, state: 'connected' | 'degraded' | 'disabled' = 'disabled', data: unknown = null) => ({ source: source(name, state), cachedAt: null, data })
  await page.route('**/api/v1/platform/**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/platform/overview') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      connections: [source('Web', 'connected'), source('API', 'connected'), source('MySQL', 'connected'), source('Kubernetes', 'disabled'), source('Prometheus', 'connected'), source('Alertmanager', 'degraded'), source('Elasticsearch', 'disabled'), source('Argo CD', 'disabled')],
      kubernetes: empty('Kubernetes'), monitoring: empty('Prometheus', 'connected', metric), alerts: empty('Alertmanager', 'degraded'), logs: empty('Elasticsearch'), delivery: empty('Argo CD'),
    }) })
    if (url.pathname.startsWith('/api/v1/platform/metrics/')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(empty('Prometheus', 'connected', metric)) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(empty('Platform')) })
  })

  for (const viewport of [...privateViewports, { name: 'narrow-320', width: 320, height: 900 }] as const) {
    await page.setViewportSize(viewport)
    await page.goto('/app/platform')
    await expect(page.getByRole('heading', { name: '平台运行中心', level: 1 })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), viewport.name).toBe(true)
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/app/platform')
  await expect(page.getByRole('region', { name: '平台连接状态' })).toBeVisible()
  await expect(page.getByRole('region', { name: '当前告警' })).toBeVisible()
  await expect(page.getByRole('region', { name: '最新部署' })).toBeVisible()
  const order = await page.evaluate(() => Object.fromEntries([
    ['overall', '[aria-label="平台连接状态"]'], ['alerts', '[aria-label="当前告警"]'], ['delivery', '[aria-label="最新部署"]'],
    ['topology', '[aria-label="服务拓扑"]'], ['monitoring', '[aria-label="资源与可用性趋势"]'],
  ].map(([key, selector]) => [key, document.querySelector(selector)?.getBoundingClientRect().top ?? -1]))) as Record<string, number>
  expect(order.overall).toBeLessThan(order.alerts)
  expect(order.alerts).toBeLessThan(order.delivery)
  expect(order.delivery).toBeLessThan(order.topology)
  expect(order.topology).toBeLessThan(order.monitoring)

  await page.getByRole('tab', { name: '监控' }).click()
  await expect(page.getByRole('table', { name: /可用率数据/ })).toBeVisible()

  await page.setViewportSize({ width: 640, height: 900 })
  await page.goto('/app/settings')
  await page.evaluate(() => { document.documentElement.style.zoom = '200%' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'settings at 200% zoom').toBe(true)
})
