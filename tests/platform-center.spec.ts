import { expect, test, type Page, type Route } from '@playwright/test'

const session = { mode: 'local-preview', account: 'platform-acceptance@lifeops.local' }
const checkedAt = '2026-08-23T03:30:00.000Z'

const source = (name: string, state: 'connected' | 'degraded' | 'disabled') => ({
  source: name,
  state,
  checkedAt: state === 'disabled' ? null : checkedAt,
  latencyMs: state === 'connected' ? 7 : null,
  message: state === 'connected' ? '已验证' : state === 'degraded' ? '来源暂时不可用' : '等待配置',
})

const envelope = <T,>(name: string, state: 'connected' | 'degraded' | 'disabled', data: T | null) => ({
  source: source(name, state),
  cachedAt: state === 'connected' ? checkedAt : null,
  data,
})

const kubernetes = {
  nodes: [{ name: 'worker-1', ready: true, reason: '', message: '' }],
  workloads: [{ namespace: 'lifeops', name: 'api', desired: 2, ready: 2, available: 2, state: 'available' }],
  pods: { total: 4, ready: 4, pending: 0, restarts: 0 },
  services: [{ namespace: 'lifeops', name: 'api', type: 'ClusterIP', clusterIP: '10.0.0.2', ports: [8080] }],
  httpRoutes: [{ namespace: 'lifeops', name: 'web', hostnames: ['lifeops.example'], accepted: true, resolvedRefs: true }],
}
const monitoring = {
  key: 'availability', unit: 'ratio', state: 'connected', deepLinkUrl: 'https://grafana.example/',
  series: [{ labels: { service: 'api' }, points: [{ timestamp: 1_777_000_000, value: 0.998 }] }],
}
const alerts = {
  state: 'connected', deepLinkUrl: 'https://alertmanager.example/',
  firing: [{ id: 'alert-1', name: 'API latency', severity: 'warning', summary: 'P95 elevated', startsAt: checkedAt }],
  resolved: [{ id: 'alert-2', name: 'Worker restart', severity: 'info', summary: 'Recovered', startsAt: checkedAt, endsAt: checkedAt }],
}
const logs = {
  state: 'connected', deepLinkUrl: 'https://kibana.example/', total: 1,
  events: [{ id: 'event-1', timestamp: checkedAt, level: 'error', message: 'bounded failure', namespace: 'lifeops', pod: 'api-1', requestId: 'req-7' }],
}
const delivery = {
  state: 'connected',
  github: { state: 'connected', deepLinkUrl: 'https://github.example/', latestRun: { number: 27, status: 'completed', conclusion: 'success', revision: 'abc123' } },
  argoCd: { state: 'connected', deepLinkUrl: 'https://argocd.example/', sync: 'Synced', health: 'Healthy', revision: 'abc123', images: {} },
  images: { web: { repository: 'registry/lifeops-web', tag: 'v1', digest: `sha256:${'a'.repeat(64)}` } },
}
const overview = {
  connections: [
    source('Web', 'connected'), source('API', 'connected'), source('MySQL', 'connected'),
    source('Kubernetes', 'connected'), source('Prometheus', 'connected'), source('Alertmanager', 'degraded'),
    source('Elasticsearch', 'disabled'), source('Argo CD', 'connected'),
  ],
  kubernetes: envelope('Kubernetes', 'connected', kubernetes),
  monitoring: envelope('Prometheus', 'connected', monitoring),
  alerts: envelope('Alertmanager', 'degraded', null),
  logs: envelope('Elasticsearch', 'disabled', null),
  delivery: envelope('Argo CD', 'connected', delivery),
}
const technologies = { technologies: [
  { name: 'Jenkins', role: 'Equivalent pipeline practice', status: 'later-learning-track' },
  { name: 'UHub', role: 'Current image release target', status: 'current-image-mainline' },
  { name: 'Harbor', role: 'Alternative image registry', status: 'optional' },
] }

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function installFixture(page: Page, options: { failFirstLogs?: boolean } = {}) {
  let overviewReads = 0
  let logReads = 0
  const requestedLogs: URL[] = []
  await page.addInitScript((value) => sessionStorage.setItem('lifeops:session:v1', JSON.stringify(value)), session)
  await page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/platform/overview') { overviewReads += 1; return json(route, overview) }
    if (url.pathname === '/api/v1/platform/kubernetes') return json(route, envelope('Kubernetes', 'connected', kubernetes))
    if (url.pathname.startsWith('/api/v1/platform/metrics/')) return json(route, envelope('Prometheus', 'connected', { ...monitoring, key: url.pathname.split('/').at(-1) }))
    if (url.pathname === '/api/v1/platform/alerts') return json(route, envelope('Alertmanager', 'connected', alerts))
    if (url.pathname === '/api/v1/platform/logs') {
      requestedLogs.push(url); logReads += 1
      if (options.failFirstLogs && logReads <= 2) return json(route, { error: { code: 'UPSTREAM', message: '日志来源暂时不可用' } }, 503)
      return json(route, envelope('Elasticsearch', 'connected', logs))
    }
    if (url.pathname === '/api/v1/platform/delivery') return json(route, envelope('Argo CD', 'connected', delivery))
    if (url.pathname === '/api/v1/platform/technologies') return json(route, technologies)
    if (url.pathname === '/api/v1/state') return json(route, { schemaVersion: 1, plans: [], records: [], reviews: [], knowledge: [], snapshots: [] })
    return json(route, {})
  })
  return {
    overviewReads: () => overviewReads,
    logReads: () => logReads,
    requestedLogs,
  }
}

test('platform tabs preserve deep links, filters and truthful mixed source states', async ({ page }) => {
  const fixture = await installFixture(page)
  await page.goto('/app/platform?tab=logs&namespace=lifeops&level=error')
  await expect(page.getByRole('tab', { name: '日志' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('region', { name: '日志详情' })).toContainText('bounded failure')
  expect(fixture.requestedLogs[0]?.searchParams.get('namespace')).toBe('lifeops')
  expect(fixture.requestedLogs[0]?.searchParams.get('level')).toBe('error')

  await page.getByLabel('Request ID').fill('req-7')
  await page.getByRole('button', { name: '应用筛选' }).click()
  await expect(page).toHaveURL(/tab=logs/)
  await expect(page).toHaveURL(/requestId=req-7/)

  const tabs = [
    ['总览', '平台连接状态'], ['Kubernetes', 'Kubernetes 详情'], ['监控', '监控详情'],
    ['告警', '告警详情'], ['日志', '日志详情'], ['发布', '发布详情'], ['技术档案', '技术档案'],
  ] as const
  for (const [tab, region] of tabs) {
    await page.getByRole('tab', { name: tab, exact: true }).click()
    await expect(page.getByRole('region', { name: region })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(tab === '总览' ? 'tab=overview' : 'tab='))
  }

  await page.getByRole('tab', { name: '总览', exact: true }).click()
  const connections = page.getByRole('region', { name: '平台连接状态' })
  await expect(connections).toContainText('已连接')
  await expect(connections).toContainText('局部降级')
  await expect(connections).toContainText('未连接')
})

test('mobile deep links keep the selected platform tab inside the visible tab rail', async ({ page }) => {
  await installFixture(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/app/platform?tab=technologies')
  const rail = page.getByRole('tablist', { name: '平台区域' })
  const selected = page.getByRole('tab', { name: '技术档案', exact: true })
  await expect(selected).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('region', { name: '技术档案' })).toBeVisible()
  const [railBox, selectedBox] = await Promise.all([rail.boundingBox(), selected.boundingBox()])
  expect(railBox).not.toBeNull()
  expect(selectedBox).not.toBeNull()
  expect(selectedBox!.x).toBeGreaterThanOrEqual(railBox!.x)
  expect(selectedBox!.x + selectedBox!.width).toBeLessThanOrEqual(railBox!.x + railBox!.width)
  expect(await page.evaluate(() => window.scrollX)).toBe(0)
  await expect.poll(() => page.locator('.route-stage').evaluate((element) => element.scrollLeft)).toBe(0)
})

test('platform polling stops while hidden and a partial tab failure retries locally', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-08-23T03:30:00.000Z') })
  const fixture = await installFixture(page, { failFirstLogs: true })
  await page.goto('/app/platform')
  await expect(page.getByRole('heading', { name: '平台运行中心', level: 1 })).toBeVisible()
  const visibleBaseline = fixture.overviewReads()
  expect(visibleBaseline).toBeGreaterThan(0)

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.fastForward(31_000)
  expect(fixture.overviewReads()).toBe(visibleBaseline)

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.getByRole('tab', { name: '日志' }).click()
  await page.clock.fastForward(2_000)
  await expect(page.getByRole('alert')).toContainText('日志来源暂时不可用')
  await page.getByRole('button', { name: '重试当前区域' }).click()
  await expect(page.getByRole('region', { name: '日志详情' })).toContainText('bounded failure')
  expect(fixture.logReads()).toBe(3)
})
