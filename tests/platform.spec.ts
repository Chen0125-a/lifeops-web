import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page, type Route } from '@playwright/test'

const evidenceDir = resolve('outputs/evidence/browser/p5-t3')
const checkedAt = '2026-08-23T00:14:43.000Z'
const session = { mode: 'local-preview', account: 'platform-evidence@lifeops.local' }

const source = (name: string, state: 'connected' | 'disabled') => ({
  source: name,
  state,
  checkedAt: state === 'connected' ? checkedAt : null,
  latencyMs: state === 'connected' ? 4 : null,
  message: state === 'connected' ? '已验证' : '等待配置',
})

const disabledEnvelope = (name: string) => ({ source: source(name, 'disabled'), cachedAt: null, data: null })
const overview = {
  connections: [
    source('Web', 'connected'), source('API', 'connected'), source('MySQL', 'connected'),
    source('Kubernetes', 'disabled'), source('Prometheus', 'disabled'), source('Alertmanager', 'disabled'),
    source('Elasticsearch', 'disabled'), source('Argo CD', 'disabled'),
  ],
  kubernetes: disabledEnvelope('Kubernetes'),
  monitoring: disabledEnvelope('Prometheus'),
  alerts: disabledEnvelope('Alertmanager'),
  logs: disabledEnvelope('Elasticsearch'),
  delivery: disabledEnvelope('GitHub / Argo CD'),
}

const technologies = {
  technologies: [
    { name: 'React', role: 'Web interface', status: 'implemented' },
    { name: 'TypeScript', role: 'Web and API contracts', status: 'implemented' },
    { name: 'MySQL', role: 'Production application data', status: 'implemented' },
    { name: 'Docker', role: 'Immutable application images', status: 'delivery-pending' },
    { name: 'Kubernetes', role: 'User-operated application runtime', status: 'user-operated' },
    { name: 'Helm', role: 'Application delivery package', status: 'delivery-pending' },
    { name: 'GitHub Actions', role: 'Release mainline', status: 'configured-mainline' },
    { name: 'Argo CD', role: 'Recommended user-operated GitOps consumer', status: 'user-operated' },
    { name: 'Prometheus', role: 'Application and platform metrics', status: 'optional-integration' },
    { name: 'Grafana', role: 'Metric deep links', status: 'optional-integration' },
    { name: 'Alertmanager', role: 'Alert deep links', status: 'optional-integration' },
    { name: 'Elasticsearch', role: 'Bounded log summaries', status: 'optional-integration' },
    { name: 'Kibana', role: 'Log deep links', status: 'optional-integration' },
    { name: 'Elastic Agent / Filebeat', role: 'Log collection', status: 'optional-integration' },
    { name: 'Jenkins', role: 'Equivalent pipeline practice', status: 'later-learning-track' },
    { name: 'UHub', role: 'Current image release target', status: 'current-image-mainline' },
    { name: 'Harbor', role: 'Alternative image registry', status: 'optional' },
  ],
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function installPlatformFixture(page: Page) {
  await page.addInitScript((value) => sessionStorage.setItem('lifeops:session:v1', JSON.stringify(value)), session)
  await page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/platform/overview') return json(route, overview)
    if (url.pathname === '/api/v1/platform/technologies') return json(route, technologies)
    if (url.pathname.startsWith('/api/v1/platform/metrics/')) return json(route, disabledEnvelope('Prometheus'))
    if (url.pathname === '/api/v1/platform/kubernetes') return json(route, disabledEnvelope('Kubernetes'))
    if (url.pathname === '/api/v1/platform/alerts') return json(route, disabledEnvelope('Alertmanager'))
    if (url.pathname === '/api/v1/platform/logs') return json(route, disabledEnvelope('Elasticsearch'))
    if (url.pathname === '/api/v1/platform/delivery') return json(route, disabledEnvelope('GitHub / Argo CD'))
    if (url.pathname === '/api/v1/state') return json(route, { schemaVersion: 1, plans: [], records: [], reviews: [], knowledge: [], snapshots: [] })
    return json(route, {})
  })
}

test.use({ trace: 'off' })

test('platform operations center keeps truthful states, keyboard tabs and approved responsive geometry', async ({ page }) => {
  mkdirSync(evidenceDir, { recursive: true })
  await installPlatformFixture(page)
  await page.goto('/app/platform')
  await expect(page.getByRole('heading', { name: '平台运行中心', level: 1 })).toBeVisible()
  await expect(page.getByRole('region', { name: '平台连接状态' })).toContainText('Prometheus未连接等待配置')
  await expect(page.getByRole('region', { name: '当前告警' })).toContainText('告警来源未连接或暂时不可用')

  for (const viewport of [
    { width: 1440, height: 900, name: 'platform-overview-1440x900.png' },
    { width: 1024, height: 768, name: 'platform-overview-1024x768.png' },
    { width: 768, height: 1024, name: 'platform-overview-768x1024.png' },
    { width: 390, height: 844, name: 'platform-overview-390x844.png' },
  ]) {
    await page.setViewportSize(viewport)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${viewport.width} CSS px`).toBe(true)
    const navigation = page.getByRole('navigation', { name: '私人空间导航' })
    const active = navigation.getByRole('link', { name: '平台' })
    await expect.poll(async () => {
      const [navigationBox, activeBox] = await Promise.all([navigation.boundingBox(), active.boundingBox()])
      if (!navigationBox || !activeBox) return false
      return activeBox.x >= navigationBox.x - 1
        && activeBox.x + activeBox.width <= navigationBox.x + navigationBox.width + 1
    }, { message: `active platform route stays inside the ${viewport.width} CSS px navigation` }).toBe(true)
    await page.screenshot({ path: resolve(evidenceDir, viewport.name), fullPage: true })
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  const monitoringTab = page.getByRole('tab', { name: '监控' })
  await monitoringTab.focus()
  await page.keyboard.press('Enter')
  await expect(monitoringTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('region', { name: '监控详情' })).toContainText('没有可验证的指标序列')

  const archiveTab = page.getByRole('tab', { name: '技术档案' })
  await archiveTab.focus()
  await page.keyboard.press('Enter')
  const archive = page.getByRole('region', { name: '技术档案' })
  await expect(archive).toContainText('JenkinsEquivalent pipeline practice后续学习轨')
  await expect(archive).toContainText('UHubCurrent image release target当前镜像主线')
  await expect(archive).toContainText('HarborAlternative image registry可选')
})

test('platform route respects reduced motion without hiding its current navigation', async ({ page }) => {
  mkdirSync(evidenceDir, { recursive: true })
  await installPlatformFixture(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/app/platform')
  await expect(page.getByRole('heading', { name: '平台运行中心', level: 1 })).toBeVisible()
  const maximumDuration = await page.locator('[data-private-shell]').evaluate((root) => Math.max(...Array.from(root.querySelectorAll('*')).flatMap((element) => {
    const style = getComputedStyle(element)
    return [style.animationDuration, style.transitionDuration].map((value) => Number.parseFloat(value) || 0)
  })))
  expect(maximumDuration).toBeLessThanOrEqual(.001)
  await expect(page.getByRole('navigation', { name: '私人空间导航' }).getByRole('link', { name: '平台' })).toBeVisible()
  await page.screenshot({ path: resolve(evidenceDir, 'platform-overview-390x844-reduced-motion.png'), fullPage: true })
})
