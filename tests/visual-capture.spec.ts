import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page, type Route } from '@playwright/test'
import { contentVisualRoutes, installPrivateCoreFixture, privateCoreRoutes } from './private-core-fixtures'

const outputDir = resolve('outputs')
const privateCoreOutputDir = resolve(outputDir, 'evidence', 'browser', 'p3-t7')
const contentOutputDir = resolve(outputDir, 'evidence', 'browser', 'p4-t6')
const platformGlobalOutputDir = resolve(outputDir, 'evidence', 'browser', 'p5-t7')
const finalOutputDir = resolve(outputDir, 'final')

interface FilmstripFrame {
  label: string
  image: Buffer
}

async function frame(page: Page, label: string): Promise<FilmstripFrame> {
  return { label, image: await page.screenshot({ fullPage: false }) }
}

async function firstPaint(page: Page) {
  await page.evaluate(() => new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame())))
}

async function renderFilmstrip(page: Page, title: string, frames: FilmstripFrame[], filename: string, directory = privateCoreOutputDir) {
  const width = frames.length * 390 + (frames.length + 1) * 18
  await page.setViewportSize({ width: Math.min(width, 1800), height: 900 })
  await page.setContent(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    html, body { margin: 0; color: #17211e; background: #eaf1ed; font-family: system-ui, sans-serif; }
    main { width: max-content; min-width: 100%; padding: 22px 18px 28px; }
    h1 { margin: 0 0 18px; font-size: 20px; font-weight: 650; }
    section { display: flex; gap: 18px; }
    figure { width: 390px; margin: 0; overflow: hidden; border: 1px solid #7b9186; border-radius: 12px; background: #f3f8f5; box-shadow: 0 16px 36px rgba(23, 33, 30, .12); }
    figcaption { min-height: 42px; padding: 11px 14px; border-bottom: 1px solid #ccd9d3; font-size: 13px; font-weight: 650; }
    img { display: block; width: 390px; height: 844px; object-fit: cover; object-position: top; }
  </style></head><body><main><h1>${title}</h1><section>${frames.map((item) => (
    `<figure><figcaption>${item.label}</figcaption><img alt="${item.label}" src="data:image/png;base64,${item.image.toString('base64')}"></figure>`
  )).join('')}</section></main></body></html>`)
  await page.evaluate(() => scrollTo(0, 0))
  await page.screenshot({ path: resolve(directory, filename), fullPage: true })
}

async function renderContactSheet(page: Page, title: string, frames: FilmstripFrame[], filename: string) {
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.setContent(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    html, body { margin: 0; color: #17211e; background: #eaf1ed; font-family: system-ui, sans-serif; }
    main { padding: 30px; }
    h1 { margin: 0 0 22px; font-size: 28px; font-weight: 650; letter-spacing: -.035em; }
    section { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
    figure { min-width: 0; margin: 0; overflow: hidden; border: 1px solid #9aada4; border-radius: 12px; background: #f8fbf9; box-shadow: 0 12px 30px rgba(23, 33, 30, .1); }
    figcaption { min-height: 44px; padding: 12px 14px; border-bottom: 1px solid #ccd9d3; font-size: 13px; font-weight: 650; }
    img { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: contain; object-position: top; background: #dfe8e3; }
  </style></head><body><main><h1>${title}</h1><section>${frames.map((item) => (
    `<figure><figcaption>${item.label}</figcaption><img alt="${item.label}" src="data:image/png;base64,${item.image.toString('base64')}"></figure>`
  )).join('')}</section></main></body></html>`)
  await page.evaluate(() => scrollTo(0, 0))
  await page.screenshot({ path: resolve(finalOutputDir, filename), fullPage: true, animations: 'disabled' })
}

async function visualFrame(page: Page, label: string): Promise<FilmstripFrame> {
  await page.waitForTimeout(180)
  return { label, image: await page.screenshot({ fullPage: false, animations: 'disabled' }) }
}

function fulfillJson(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

function settingsCategory(page: Page, label: string) {
  return page.locator('nav[aria-label="设置分类"] button').filter({ hasText: label })
}

async function installPlatformGlobalVisualFixture(page: Page) {
  const checkedAt = '2026-08-23T03:30:00.000Z'
  const source = (name: string, state: 'connected' | 'degraded' | 'disabled') => ({
    source: name, state, checkedAt: state === 'disabled' ? null : checkedAt, latencyMs: state === 'connected' ? 7 : null,
    message: state === 'connected' ? '已验证' : state === 'degraded' ? '来源暂时不可用' : '等待配置',
  })
  const envelope = (name: string, state: 'connected' | 'degraded' | 'disabled', data: unknown = null) => ({ source: source(name, state), cachedAt: checkedAt, data })
  const kubernetes = {
    nodes: [{ name: 'worker-1', ready: true, reason: '', message: '' }],
    workloads: [{ namespace: 'lifeops', name: 'api', desired: 2, ready: 2, available: 2, state: 'available' }],
    pods: { total: 4, ready: 4, pending: 0, restarts: 0 }, services: [], httpRoutes: [],
  }
  const metric = { key: 'availability', unit: 'ratio', state: 'connected', deepLinkUrl: null, series: [{ labels: { service: 'api' }, points: [{ timestamp: 1_777_000_000, value: .998 }, { timestamp: 1_777_000_300, value: .999 }] }] }
  const alerts = { state: 'connected', deepLinkUrl: null, firing: [{ id: 'alert-1', name: 'API latency', severity: 'warning', summary: 'P95 elevated', startsAt: checkedAt }], resolved: [{ id: 'alert-2', name: 'Worker restart', severity: 'info', summary: 'Recovered', startsAt: checkedAt, endsAt: checkedAt }] }
  const logs = { state: 'connected', deepLinkUrl: null, total: 1, events: [{ id: 'event-1', timestamp: checkedAt, level: 'error', message: 'bounded failure', namespace: 'lifeops', pod: 'api-1', requestId: 'req-7' }] }
  const delivery = { state: 'connected', github: { state: 'connected', deepLinkUrl: null, latestRun: { number: 27, status: 'completed', conclusion: 'success', revision: 'abc123' } }, argoCd: { state: 'connected', deepLinkUrl: null, sync: 'Synced', health: 'Healthy', revision: 'abc123', images: {} }, images: { web: { repository: 'registry/lifeops-web', tag: 'v1', digest: `sha256:${'a'.repeat(64)}` } } }
  const overview = {
    connections: [source('Web', 'connected'), source('API', 'connected'), source('MySQL', 'connected'), source('Kubernetes', 'connected'), source('Prometheus', 'connected'), source('Alertmanager', 'degraded'), source('Elasticsearch', 'disabled'), source('Argo CD', 'connected')],
    kubernetes: envelope('Kubernetes', 'connected', kubernetes), monitoring: envelope('Prometheus', 'connected', metric),
    alerts: envelope('Alertmanager', 'degraded'), logs: envelope('Elasticsearch', 'disabled'), delivery: envelope('Argo CD', 'connected', delivery),
  }
  const technologies = { technologies: [
    { name: 'Jenkins', role: 'Equivalent pipeline practice', status: 'later-learning-track' },
    { name: 'UHub', role: 'Current image release target', status: 'current-image-mainline' },
    { name: 'Harbor', role: 'Alternative image registry', status: 'optional' },
  ] }
  await page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/platform/overview') return fulfillJson(route, overview)
    if (url.pathname === '/api/v1/platform/kubernetes') return fulfillJson(route, envelope('Kubernetes', 'connected', kubernetes))
    if (url.pathname.startsWith('/api/v1/platform/metrics/')) return fulfillJson(route, envelope('Prometheus', 'connected', { ...metric, key: url.pathname.split('/').at(-1) }))
    if (url.pathname === '/api/v1/platform/alerts') return fulfillJson(route, envelope('Alertmanager', 'connected', alerts))
    if (url.pathname === '/api/v1/platform/logs') return fulfillJson(route, envelope('Elasticsearch', 'connected', logs))
    if (url.pathname === '/api/v1/platform/delivery') return fulfillJson(route, envelope('Argo CD', 'connected', delivery))
    if (url.pathname === '/api/v1/platform/technologies') return fulfillJson(route, technologies)
    if (url.pathname === '/api/v1/search') return fulfillJson(route, { items: [{ type: 'task', id: 'task-visual', title: '平台验收', excerpt: '关闭 P5', context: '项目 · LifeOps', updatedAt: checkedAt, route: '/app/schedule?task=task-visual' }] })
    return route.fallback()
  })
}

test.use({ viewport: { width: 1440, height: 900 } })

test('captures the public themes and the daylight workbench', async ({ page }) => {
  mkdirSync(outputDir, { recursive: true })
  await page.addInitScript(() => {
    if (!localStorage.getItem('lifeops:theme-override')) {
      localStorage.setItem('lifeops:theme-override', JSON.stringify({ theme: 'day', expiresAt: Date.now() + 86_400_000 }))
    }
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /把日子/ })).toBeVisible()
  await page.screenshot({ path: resolve(outputDir, 'lifeops-public-day.png'), fullPage: false })
  await page.getByRole('button', { name: '登录 LifeOps' }).click()
  await expect(page.getByLabel('账号')).toBeFocused()
  await page.waitForTimeout(320)
  await page.screenshot({ path: resolve(outputDir, 'lifeops-public-login.png'), fullPage: false })
  await page.getByRole('button', { name: '关闭登录窗口' }).click()
  await expect(page.locator('[data-public-scene="rest"]')).toBeVisible()
  await page.screenshot({ path: resolve(outputDir, 'lifeops-public-flow.png'), fullPage: false })

  await page.evaluate(() => localStorage.setItem('lifeops:theme-override', JSON.stringify({ theme: 'night', expiresAt: Date.now() + 86_400_000 })))
  await page.goto('/')
  await expect(page.locator('[data-public-theme="night"]')).toBeVisible()
  await page.screenshot({ path: resolve(outputDir, 'lifeops-public-night.png'), fullPage: false })

  await page.evaluate(() => sessionStorage.setItem('lifeops:session:v1', JSON.stringify({ mode: 'local-preview', account: 'delivery@lifeops.local' })))
  await page.goto('/app')
  await expect(page.locator('[data-private-shell]')).toBeVisible()
  await page.waitForTimeout(260)
  await page.screenshot({ path: resolve(outputDir, 'lifeops-private-today.png'), fullPage: true })
  await page.goto('/app/knowledge')
  await expect(page.locator('[data-workspace-route="/app/knowledge"]')).toBeVisible()
  await page.waitForTimeout(260)
  await page.screenshot({ path: resolve(outputDir, 'lifeops-private-knowledge.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.screenshot({ path: resolve(outputDir, 'lifeops-public-mobile.png'), fullPage: true })
  await page.goto('/app')
  await expect(page.locator('[data-private-shell]')).toBeVisible()
  await page.waitForTimeout(260)
  await page.screenshot({ path: resolve(outputDir, 'lifeops-private-mobile.png'), fullPage: true })
})

test('captures every original private-core page at desktop, mobile and overview tablets', async ({ page }) => {
  test.setTimeout(90_000)
  mkdirSync(privateCoreOutputDir, { recursive: true })
  await installPrivateCoreFixture(page)

  for (const target of [
    { suffix: 'desktop-1440', viewport: { width: 1440, height: 900 } },
    { suffix: 'mobile-390', viewport: { width: 390, height: 844 } },
  ] as const) {
    await page.setViewportSize(target.viewport)
    for (const route of privateCoreRoutes) {
      await page.goto(route.path)
      await expect(page.getByRole('heading', { name: route.heading, level: 1, exact: true })).toBeVisible()
      await page.waitForTimeout(300)
      await page.screenshot({
        path: resolve(privateCoreOutputDir, `p3-t7-${route.slug}-${target.suffix}.png`),
        fullPage: false,
      })
    }
  }

  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto('/app/overview')
  await expect(page.getByRole('heading', { name: '总览', level: 1 })).toBeVisible()
  await page.waitForTimeout(300)
  await page.screenshot({ path: resolve(privateCoreOutputDir, 'p3-t7-overview-tablet-1024.png'), fullPage: false })

  await page.setViewportSize({ width: 768, height: 1024 })
  await page.goto('/app/overview')
  await expect(page.getByRole('heading', { name: '总览', level: 1 })).toBeVisible()
  await page.waitForTimeout(300)
  await page.screenshot({ path: resolve(privateCoreOutputDir, 'p3-t7-overview-tablet-768.png'), fullPage: false })
})

test('captures normal and reduced route plus inspector filmstrips from first browser paint', async ({ page }) => {
  test.setTimeout(60_000)
  mkdirSync(privateCoreOutputDir, { recursive: true })
  await installPrivateCoreFixture(page)
  for (const reduced of [false, true]) {
    const mode = reduced ? 'reduced' : 'normal'
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/app/overview')
    await expect(page.getByRole('heading', { name: '总览', level: 1 })).toBeVisible()
    await page.waitForTimeout(280)
    const routeFrames = [await frame(page, '总览 · 静止')]
    await page.getByRole('link', { name: '目标与项目', exact: true }).click()
    await firstPaint(page)
    routeFrames.push(await frame(page, '路由切换 · 首次绘制'))
    await page.waitForTimeout(reduced ? 16 : 80)
    routeFrames.push(await frame(page, `路由切换 · T+${reduced ? 16 : 80}ms`))
    await page.waitForTimeout(reduced ? 64 : 200)
    routeFrames.push(await frame(page, `目标页 · T+${reduced ? 80 : 280}ms`))
    await renderFilmstrip(page, `私人路由切换 · ${mode}`, routeFrames, `p3-t7-route-${mode}-filmstrip.png`)

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/app/records')
    await expect(page.getByRole('heading', { name: '记录', level: 1 })).toBeVisible()
    await page.waitForTimeout(280)
    const recordButton = page.getByRole('button', { name: /私人核心视觉记录/ })
    await recordButton.scrollIntoViewIfNeeded()
    await firstPaint(page)
    const inspectorFrames = [await frame(page, '记录流 · 目标已定位')]
    await recordButton.click()
    await expect(page.locator('[data-records-page]')).toHaveAttribute('data-mobile-editor-open', 'true')
    await firstPaint(page)
    inspectorFrames.push(await frame(page, '详情层 · 首次稳定绘制'))
    await page.waitForTimeout(reduced ? 16 : 80)
    inspectorFrames.push(await frame(page, `详情层 · T+${reduced ? 16 : 80}ms`))
    await page.waitForTimeout(reduced ? 64 : 200)
    inspectorFrames.push(await frame(page, `详情层 · T+${reduced ? 80 : 280}ms`))
    await renderFilmstrip(page, `记录详情任务层 · ${mode}`, inspectorFrames, `p3-t7-inspector-${mode}-filmstrip.png`)
  }
})

test('captures P4 knowledge, Obsidian, publishing and public surfaces plus interruptible mobile filmstrips', async ({ page }) => {
  test.setTimeout(180_000)
  mkdirSync(contentOutputDir, { recursive: true })
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined }))
  await installPrivateCoreFixture(page)

  const viewports = [
    { suffix: '1440x900', width: 1440, height: 900, zoom: '' },
    { suffix: '1024x768', width: 1024, height: 768, zoom: '' },
    { suffix: '768x1024', width: 768, height: 1024, zoom: '' },
    { suffix: '390x844', width: 390, height: 844, zoom: '' },
    { suffix: '320x900', width: 320, height: 900, zoom: '' },
    { suffix: 'zoom-200', width: 640, height: 900, zoom: '200%' },
  ] as const

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    for (const route of contentVisualRoutes) {
      await page.goto(route.path)
      await page.evaluate((zoom) => { document.documentElement.style.zoom = zoom }, viewport.zoom)
      await page.waitForTimeout(360)
      const currentPanel = page.locator('[data-route-panel-current]')
      const heading = await currentPanel.count()
        ? currentPanel.getByRole('heading', { name: route.heading, level: 1, exact: true })
        : page.getByRole('heading', { name: route.heading, level: 1, exact: true }).last()
      await expect(heading).toBeVisible()
      await page.screenshot({ path: resolve(contentOutputDir, `p4-t6-${route.slug}-${viewport.suffix}.png`), fullPage: true })
    }
  }

  await page.setViewportSize({ width: 390, height: 844 })
  for (const reduced of [false, true]) {
    const mode = reduced ? 'reduced' : 'normal'
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' })
    await page.setViewportSize({ width: 390, height: 844 })

    await page.goto('/app/knowledge')
    await expect(page.getByRole('heading', { name: '知识', level: 1 })).toBeVisible()
    const knowledgeFrames = [await frame(page, '知识列表')]
    await page.getByRole('button', { name: '知识 验收经验' }).click()
    await firstPaint(page)
    knowledgeFrames.push(await frame(page, '阅读层 · 首次绘制'))
    await page.waitForTimeout(reduced ? 16 : 120)
    knowledgeFrames.push(await frame(page, `阅读层 · T+${reduced ? 16 : 120}ms`))
    await page.getByRole('button', { name: '返回知识列表' }).click()
    await firstPaint(page)
    knowledgeFrames.push(await frame(page, '返回列表'))
    await renderFilmstrip(page, `知识移动任务层 · ${mode}`, knowledgeFrames, `p4-t6-knowledge-${mode}-filmstrip.png`, contentOutputDir)

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/app/publish?status=draft&draft=publishing-visual')
    await expect(page.getByRole('heading', { name: '发布', level: 1 })).toBeVisible()
    const publishingFrames = [await frame(page, '来源层')]
    await page.getByRole('button', { name: '下一步：编辑公开草稿' }).click()
    await firstPaint(page)
    publishingFrames.push(await frame(page, '编辑层 · 首次绘制'))
    await page.getByRole('button', { name: '下一步：预览公开内容' }).click()
    await firstPaint(page)
    publishingFrames.push(await frame(page, '公开预览层'))
    await page.getByRole('button', { name: '返回公开草稿编辑' }).click()
    await firstPaint(page)
    publishingFrames.push(await frame(page, '返回编辑层'))
    await renderFilmstrip(page, `发布预览与返回 · ${mode}`, publishingFrames, `p4-t6-publishing-${mode}-filmstrip.png`, contentOutputDir)

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/learning')
    await expect(page.getByRole('heading', { name: '最近在学', level: 1 })).toBeVisible()
    const publicFrames = [await frame(page, '公开分类')]
    await page.getByRole('navigation', { name: '公开内容索引' }).getByRole('link', { name: '知识与发布边界' }).click()
    await expect(page.getByRole('heading', { name: '知识与发布边界', level: 1, exact: true }).last()).toBeVisible()
    await firstPaint(page)
    publicFrames.push(await frame(page, '公开文章 · 首次绘制'))
    await page.goBack()
    await expect(page.getByRole('heading', { name: '最近在学', level: 1 })).toBeVisible()
    await firstPaint(page)
    publicFrames.push(await frame(page, '浏览器 Back 返回分类'))
    await renderFilmstrip(page, `公开文章与 Back · ${mode}`, publicFrames, `p4-t6-public-${mode}-filmstrip.png`, contentOutputDir)
  }
})

test('captures P5 platform, global tools, settings categories and normal/reduced task layers', async ({ page }) => {
  test.setTimeout(720_000)
  mkdirSync(platformGlobalOutputDir, { recursive: true })
  await installPrivateCoreFixture(page)
  await installPlatformGlobalVisualFixture(page)

  for (const viewport of [
    { suffix: '1440x900', width: 1440, height: 900 },
    { suffix: '1024x768', width: 1024, height: 768 },
    { suffix: '768x1024', width: 768, height: 1024 },
    { suffix: '390x844', width: 390, height: 844 },
    { suffix: '320x900', width: 320, height: 900 },
  ] as const) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/app/platform?tab=overview')
    await expect(page.getByRole('region', { name: '平台连接状态' })).toBeVisible()
    await page.screenshot({ path: resolve(platformGlobalOutputDir, `platform-overview-${viewport.suffix}.png`), fullPage: true })
  }

  await page.setViewportSize({ width: 640, height: 900 })
  await page.goto('/app/platform?tab=overview')
  await page.evaluate(() => { document.documentElement.style.zoom = '200%' })
  await expect(page.getByRole('region', { name: '平台连接状态' })).toBeVisible()
  await page.screenshot({ path: resolve(platformGlobalOutputDir, 'platform-overview-zoom-200.png'), fullPage: true })
  await page.evaluate(() => { document.documentElement.style.zoom = '' })

  const platformTabs = [
    ['overview', '总览', '平台连接状态'], ['kubernetes', 'Kubernetes', 'Kubernetes 详情'],
    ['monitoring', '监控', '监控详情'], ['alerts', '告警', '告警详情'],
    ['logs', '日志', '日志详情'], ['delivery', '发布', '发布详情'],
    ['technologies', '技术档案', '技术档案'],
  ] as const
  for (const viewport of [
    { suffix: '1440x900', width: 1440, height: 900 },
    { suffix: '390x844', width: 390, height: 844 },
  ] as const) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    for (const [tab, label, region] of platformTabs) {
      await page.goto(`/app/platform?tab=${tab}`)
      await expect(page.getByRole('tab', { name: label, exact: true })).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByRole('region', { name: region })).toBeVisible()
      await page.screenshot({ path: resolve(platformGlobalOutputDir, `platform-${tab}-${viewport.suffix}.png`), fullPage: true })
    }
  }

  for (const viewport of [
    { suffix: '1440x900', width: 1440, height: 900 },
    { suffix: '1024x768', width: 1024, height: 768 },
    { suffix: '768x1024', width: 768, height: 1024 },
    { suffix: '390x844', width: 390, height: 844 },
  ] as const) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/app/overview')
    await expect(page.locator('[data-private-shell]')).toBeVisible()
    await page.getByRole('button', { name: '打开全局搜索' }).click()
    await page.getByRole('searchbox', { name: '搜索 LifeOps' }).fill('平台')
    await expect(page.getByRole('option', { name: '任务 平台验收' })).toBeVisible()
    await page.screenshot({ path: resolve(platformGlobalOutputDir, `global-search-${viewport.suffix}.png`), fullPage: true })
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '快速记录' }).click()
    await expect(page.getByRole('dialog', { name: '快速记录' })).toBeVisible()
    await page.screenshot({ path: resolve(platformGlobalOutputDir, `quick-create-${viewport.suffix}.png`), fullPage: true })
    await page.keyboard.press('Escape')
  }

  const settingsCategories = ['账户与会话', '外观与动效', '时间与区域', '默认行为', '生活阈值与提醒', 'Obsidian', '平台连接', '公开站点', '数据与安全'] as const
  for (const viewport of [
    { suffix: '1440x900', width: 1440, height: 900 },
    { suffix: '390x844', width: 390, height: 844 },
  ] as const) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    for (const [index, category] of settingsCategories.entries()) {
      await page.goto('/app/settings')
      await settingsCategory(page, category).click()
      await expect(settingsCategory(page, category)).toHaveAttribute('aria-current', 'page')
      await page.screenshot({ path: resolve(platformGlobalOutputDir, `settings-${String(index + 1).padStart(2, '0')}-${viewport.suffix}.png`), fullPage: true })
    }
  }

  for (const reduced of [false, true]) {
    const mode = reduced ? 'reduced' : 'normal'
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' })
    await page.setViewportSize({ width: 390, height: 844 })

    await page.goto('/app/platform?tab=overview')
    await expect(page.getByRole('region', { name: '平台连接状态' })).toBeVisible()
    const platformFrames = [await frame(page, '平台总览')]
    await page.getByRole('tab', { name: '日志' }).click(); await firstPaint(page)
    platformFrames.push(await frame(page, '日志层 · 首次绘制'))
    await page.waitForTimeout(reduced ? 16 : 120)
    platformFrames.push(await frame(page, `日志层 · T+${reduced ? 16 : 120}ms`))
    await renderFilmstrip(page, `平台 tab 任务层 · ${mode}`, platformFrames, `platform-tabs-${mode}-filmstrip.png`, platformGlobalOutputDir)

    await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/app/overview')
    const searchFrames = [await frame(page, '总览')]
    await page.getByRole('button', { name: '打开全局搜索' }).click(); await firstPaint(page)
    searchFrames.push(await frame(page, '搜索层 · 首次绘制'))
    await page.getByRole('searchbox', { name: '搜索 LifeOps' }).fill('平台')
    await expect(page.getByRole('option', { name: '任务 平台验收' })).toBeVisible()
    searchFrames.push(await frame(page, '搜索结果稳定态'))
    await renderFilmstrip(page, `全局搜索任务层 · ${mode}`, searchFrames, `global-search-${mode}-filmstrip.png`, platformGlobalOutputDir)

    await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/app/overview')
    const quickFrames = [await frame(page, '总览')]
    await page.getByRole('button', { name: '快速记录' }).click(); await firstPaint(page)
    quickFrames.push(await frame(page, '快速记录 · 首次绘制'))
    await page.waitForTimeout(reduced ? 16 : 120)
    quickFrames.push(await frame(page, `快速记录 · T+${reduced ? 16 : 120}ms`))
    await renderFilmstrip(page, `快速记录任务层 · ${mode}`, quickFrames, `quick-create-${mode}-filmstrip.png`, platformGlobalOutputDir)

    await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/app/settings')
    const settingsFrames = [await frame(page, '设置分类')]
    await settingsCategory(page, '数据与安全').click(); await firstPaint(page)
    settingsFrames.push(await frame(page, '数据与安全 · 首次绘制'))
    await page.getByRole('button', { name: '返回设置分类' }).click(); await firstPaint(page)
    settingsFrames.push(await frame(page, '返回设置分类'))
    await renderFilmstrip(page, `设置分类任务层 · ${mode}`, settingsFrames, `settings-categories-${mode}-filmstrip.png`, platformGlobalOutputDir)
  }
})

test('builds the final approved public, private and platform contact sheets', async ({ page }) => {
  test.setTimeout(600_000)
  mkdirSync(finalOutputDir, { recursive: true })
  await page.addInitScript(() => {
    if (!localStorage.getItem('lifeops:theme-override')) {
      localStorage.setItem('lifeops:theme-override', JSON.stringify({ theme: 'day', expiresAt: Date.now() + 86_400_000 }))
    }
  })
  await installPrivateCoreFixture(page)
  await installPlatformGlobalVisualFixture(page)

  const publicFrames: FilmstripFrame[] = []
  for (const viewport of [
    { label: '公开首页 · 1440×900', width: 1440, height: 900 },
    { label: '公开首页 · 1024×768', width: 1024, height: 768 },
    { label: '公开首页 · 768×1024', width: 768, height: 1024 },
    { label: '公开首页 · 390×844', width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await expect(page.locator('[data-public-orbit]')).toHaveAttribute('data-motion-enhanced', 'true')
    publicFrames.push(await visualFrame(page, viewport.label))
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => localStorage.setItem('lifeops:theme-override', JSON.stringify({ theme: 'night', expiresAt: Date.now() + 86_400_000 })))
  await page.goto('/')
  await expect(page.locator('[data-public-theme="night"] [data-public-orbit]')).toHaveAttribute('data-motion-enhanced', 'true')
  publicFrames.push(await visualFrame(page, '公开首页 · 夜间'))
  await page.getByRole('button', { name: '登录 LifeOps' }).click()
  await expect(page.getByRole('dialog', { name: 'LifeOps 登录窗口' })).toBeVisible()
  await page.waitForTimeout(720)
  publicFrames.push(await visualFrame(page, '登录任务层 · 桌面'))
  await renderContactSheet(page, 'LifeOps 最终公开面与登录任务层', publicFrames, 'visual-public-breakpoints.png')

  const detailFrames: FilmstripFrame[] = []
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const [path, label] of [['/now', '此刻'], ['/doing', '正在做'], ['/learning', '最近在学'], ['/moments', '生活切片'], ['/archive', '时间档案']] as const) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: label, level: 1 })).toBeVisible()
    detailFrames.push(await visualFrame(page, `公开详情 · ${label}`))
  }
  await renderContactSheet(page, 'LifeOps 最终五个公开详情', detailFrames, 'visual-public-details.png')

  const privateFrames: FilmstripFrame[] = []
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const route of privateCoreRoutes) {
    await page.goto(route.path)
    await expect(page.getByRole('heading', { name: route.heading, level: 1, exact: true })).toBeVisible()
    privateFrames.push(await visualFrame(page, `${route.heading} · 1440×900`))
  }
  await renderContactSheet(page, 'LifeOps 最终私人工作台', privateFrames, 'visual-private-core.png')

  const platformFrames: FilmstripFrame[] = []
  for (const viewport of [
    { label: '平台中心 · 1440×900', width: 1440, height: 900 },
    { label: '平台中心 · 1024×768', width: 1024, height: 768 },
    { label: '平台中心 · 768×1024', width: 768, height: 1024 },
    { label: '平台中心 · 390×844', width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/app/platform?tab=overview')
    await expect(page.getByRole('region', { name: '平台连接状态' })).toBeVisible()
    platformFrames.push(await visualFrame(page, viewport.label))
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/app/overview')
  await expect(page.locator('[data-private-shell]')).toBeVisible()
  await page.getByRole('button', { name: '打开全局搜索' }).click()
  await page.getByRole('searchbox', { name: '搜索 LifeOps' }).fill('平台')
  await expect(page.getByRole('option', { name: '任务 平台验收' })).toBeVisible()
  platformFrames.push(await visualFrame(page, '全局搜索 · 结果态'))
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '快速记录' }).click()
  await expect(page.getByRole('dialog', { name: '快速记录' })).toBeVisible()
  platformFrames.push(await visualFrame(page, '快速记录 · 任务层'))
  await renderContactSheet(page, 'LifeOps 最终平台与全局任务层', platformFrames, 'visual-platform-global.png')
})
