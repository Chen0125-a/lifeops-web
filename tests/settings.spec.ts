import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page, type Route } from '@playwright/test'
import { screenshotToPath } from './helpers/screenshotToPath'

const evidenceDir = resolve('outputs/evidence/browser/p5-t6')
const timestamp = '2026-08-23T02:50:00.000Z'
const session = { mode: 'local-preview', account: 'settings-evidence@lifeops.local' }

let settings = {
  version: 1,
  updatedAt: timestamp,
  appearance: { theme: 'system', motion: 'system' },
  locale: { locale: 'zh-CN', timezone: 'Asia/Shanghai', weekStartsOn: 1 },
  defaults: { startRoute: '/app', quickCreateType: 'record' },
  life: { lowStockDays: 7, expiryWarningDays: 14, remindersEnabled: true },
  publicSite: { defaultVisibility: 'private', rssEnabled: true },
  connections: [
    { id: 'prometheus', label: 'Prometheus', state: 'disabled', detail: '未配置' },
    { id: 'github', label: 'GitHub Actions', state: 'degraded', detail: '已配置；实时状态请在平台页确认' },
    { id: 'obsidian', label: 'Obsidian', state: 'local-only', detail: '浏览器授权' },
  ],
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function installFixture(page: Page) {
  settings = { ...settings, version: 1, appearance: { theme: 'system', motion: 'system' } }
  await page.addInitScript((value) => sessionStorage.setItem('lifeops:session:v1', JSON.stringify(value)), session)
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'GET' && path === '/api/v1/settings') return json(route, settings)
    if (request.method() === 'PATCH' && path === '/api/v1/settings') {
      const body = request.postDataJSON() as Record<string, unknown>
      settings = { ...settings, ...body, version: settings.version + 1, updatedAt: timestamp }
      return json(route, settings)
    }
    if (request.method() === 'GET' && path === '/api/v1/account/sessions') return json(route, {
      sessions: [
        { id: 'session-current', current: true, createdAt: '2026-08-23T01:00:00.000Z', expiresAt: '2026-08-24T01:00:00.000Z' },
        { id: 'session-other', current: false, createdAt: '2026-08-22T01:00:00.000Z', expiresAt: '2026-08-24T01:00:00.000Z' },
      ],
    })
    if (request.method() === 'GET' && path === '/api/v1/audit') return json(route, { events: [{
      id: 'audit-1', actorId: 'owner-1', action: 'settings.update', targetType: 'settings', targetId: null,
      metadata: { version: 2 }, occurredAt: timestamp,
    }] })
    if (request.method() === 'POST' && path === '/api/v1/data/import/preview') return json(route, {
      status: 'ready', previewChecksum: 'b'.repeat(64), counts: { goals: 1, catalogItems: 2 }, conflicts: [], rejectedRecords: [],
      ownerRemap: { source: 'source-owner', target: 'owner-1' },
    })
    if (request.method() === 'POST' && path === '/api/v1/data/import/apply') return json(route, {
      applied: true, counts: { goals: 1, catalogItems: 2 },
      restorePoint: { id: 'restore-e2e', checksumSha256: 'a'.repeat(64), createdAt: '2026-08-23T10:00:00.000Z' },
    })
    if (request.method() === 'GET' && path === '/api/v1/state') return json(route, { schemaVersion: 1, plans: [], records: [], reviews: [], knowledge: [], snapshots: [] })
    return json(route, {})
  })
}

test.beforeEach(async ({ page }) => {
  await installFixture(page)
})

test('settings workbench saves locally, keeps connection truth safe and confirms destructive import', async ({ page }) => {
  mkdirSync(evidenceDir, { recursive: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/app/settings')
  await expect(page.getByRole('heading', { name: '账户与设置', level: 1 })).toBeVisible()
  await expect(page.getByRole('navigation', { name: '设置分类' }).getByRole('button')).toHaveCount(9)

  await page.getByRole('button', { name: '外观与动效' }).click()
  await page.getByLabel('界面主题').selectOption('dark')
  await expect(page.getByRole('region', { name: '外观与动效' }).getByRole('status')).toHaveText('已保存')

  await page.getByRole('button', { name: '平台连接' }).click()
  await expect(page.getByText('GitHub Actions')).toBeVisible()
  await expect(page.getByText('待确认')).toBeVisible()
  await expect(page.getByText(/实时状态请在平台页确认/)).toBeVisible()
  expect((await page.getByRole('region', { name: '平台连接' }).textContent()) ?? '').not.toMatch(/token|password|cookie|secret/i)

  await page.getByRole('button', { name: '数据与安全' }).click()
  const dataSecurity = page.getByRole('region', { name: '数据与安全' })
  await expect(page.getByText(/导入会变更当前账户数据/)).toBeVisible()
  await expect(page.getByText(/导入前恢复点恢复/)).toBeVisible()
  await page.getByLabel('选择导入 JSON').setInputFiles({ name: 'lifeops.json', mimeType: 'application/json', buffer: Buffer.from('{}') })
  await expect(dataSecurity.getByRole('status')).toContainText('预览完成')
  await expect(page.getByRole('button', { name: '应用导入' })).toBeDisabled()
  await page.getByLabel('当前密码').fill('Correct-password-2026!')
  await page.getByRole('checkbox', { name: /我已理解影响与恢复方式/ }).check()
  await page.getByRole('button', { name: '应用导入' }).click()
  await expect(dataSecurity.getByRole('status')).toHaveText('导入已原子应用；恢复点 restore-e2e 已校验并保留。')
})

test('settings workbench holds continuous geometry, mobile reverse navigation and reduced motion at every gate', async ({ page }) => {
  mkdirSync(evidenceDir, { recursive: true })
  const viewports = [
    { width: 1440, height: 900, name: 'settings-account-1440x900.png' },
    { width: 1024, height: 768, name: 'settings-account-1024x768.png' },
    { width: 768, height: 1024, name: 'settings-categories-768x1024.png' },
    { width: 390, height: 844, name: 'settings-categories-390x844.png' },
  ]
  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    await page.goto('/app/settings')
    await expect(page.getByRole('heading', { name: '账户与设置', level: 1 })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${viewport.width} CSS px`).toBe(true)
    await screenshotToPath(page, { path: resolve(evidenceDir, viewport.name), fullPage: true })
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/app/settings')
  const localeCategory = page.getByRole('button', { name: '时间与区域' })
  await localeCategory.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: '时间与区域', level: 2 })).toBeVisible()
  await expect(page.getByRole('button', { name: '返回设置分类' })).toBeFocused()
  await screenshotToPath(page, { path: resolve(evidenceDir, 'settings-locale-390x844.png'), fullPage: true })
  await page.getByRole('button', { name: '返回设置分类' }).click()
  await expect(localeCategory).toHaveAttribute('aria-current', 'page')
  await expect(localeCategory).toBeFocused()

  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto('/app/settings')
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), '320 CSS px at 200% text').toBe(true)
  await screenshotToPath(page, { path: resolve(evidenceDir, 'settings-categories-320x900-200pct.png'), fullPage: true })
  await page.evaluate(() => { document.documentElement.style.fontSize = '' })

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/app/settings')
  await page.getByRole('button', { name: '数据与安全' }).click()
  const maximumDuration = await page.locator('[data-settings-page]').evaluate((root) => Math.max(0, ...Array.from(root.querySelectorAll('*')).flatMap((element) => {
    const style = getComputedStyle(element)
    return [style.animationDuration, style.transitionDuration].map((duration) => Number.parseFloat(duration) || 0)
  })))
  expect(maximumDuration).toBeLessThanOrEqual(.001)
  await screenshotToPath(page, { path: resolve(evidenceDir, 'settings-data-390x844-reduced-motion.png'), fullPage: true })
})
