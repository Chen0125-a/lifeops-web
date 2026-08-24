import { expect, test, type Page, type Route } from '@playwright/test'

const session = { mode: 'local-preview', account: 'global-tools@lifeops.local' }
const timestamp = '2026-08-23T03:30:00.000Z'
const emptyState = { schemaVersion: 1, plans: [], records: [], reviews: [], knowledge: [], snapshots: [] }
const searchItems = [{
  type: 'task', id: 'task-global', title: '平台全局验收', excerpt: 'P5-T7', context: '项目 · LifeOps',
  updatedAt: timestamp, route: '/app/schedule?task=task-global',
}]
let settings = {
  version: 1, updatedAt: timestamp,
  appearance: { theme: 'system', motion: 'system' },
  locale: { locale: 'zh-CN', timezone: 'Asia/Shanghai', weekStartsOn: 1 },
  defaults: { startRoute: '/app', quickCreateType: 'record' },
  life: { lowStockDays: 7, expiryWarningDays: 14, remindersEnabled: true },
  publicSite: { defaultVisibility: 'private', rssEnabled: true },
  connections: [{ id: 'prometheus', label: 'Prometheus', state: 'disabled', detail: '未配置' }],
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

function settingsCategory(page: Page, label: string) {
  return page.locator('nav[aria-label="设置分类"] button').filter({ hasText: label })
}

async function installFixture(page: Page) {
  let sessions = [
    { id: 'session-current', current: true, createdAt: timestamp, expiresAt: '2026-08-24T03:30:00.000Z' },
    { id: 'session-other', current: false, createdAt: timestamp, expiresAt: '2026-08-24T03:30:00.000Z' },
  ]
  const passwordBodies: unknown[] = []
  const previewBodies: unknown[] = []
  const applyBodies: unknown[] = []
  const createKeys: string[] = []
  let undoCount = 0
  settings = { ...settings, version: 1 }
  await page.addInitScript((value) => sessionStorage.setItem('lifeops:session:v1', JSON.stringify(value)), session)
  await page.route('**/api/v1/**', (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    if (request.method() === 'GET' && path === '/api/v1/state') return json(route, emptyState)
    if (request.method() === 'GET' && path === '/api/v1/search') return json(route, { items: searchItems })
    if (request.method() === 'GET' && path === '/api/v1/records') return json(route, [])
    if (request.method() === 'GET' && path === '/api/v1/habits') return json(route, { from: '', to: '', habits: [], entries: [] })
    if (request.method() === 'GET' && path === '/api/v1/knowledge') return json(route, { items: [] })
    if (request.method() === 'GET' && path === '/api/v1/reviews') return json(route, [])
    if (request.method() === 'POST' && path === '/api/v1/records') {
      createKeys.push(request.headers()['idempotency-key'] ?? '')
      const body = request.postDataJSON() as Record<string, unknown>
      return json(route, { ...body, id: 'record-global', mediaIds: [], coverMediaId: null, tags: [], links: [], pinned: false, archivedAt: null, deletedAt: null, version: 1, createdAt: timestamp, updatedAt: timestamp }, 201)
    }
    if (request.method() === 'DELETE' && path === '/api/v1/records/record-global') { undoCount += 1; return route.fulfill({ status: 204 }) }
    if (request.method() === 'GET' && path === '/api/v1/settings') return json(route, settings)
    if (request.method() === 'PATCH' && path === '/api/v1/settings') {
      settings = { ...settings, ...(request.postDataJSON() as object), version: settings.version + 1, updatedAt: timestamp }
      return json(route, settings)
    }
    if (request.method() === 'GET' && path === '/api/v1/account/sessions') return json(route, { sessions })
    if (request.method() === 'POST' && path === '/api/v1/account/password') { passwordBodies.push(request.postDataJSON()); return route.fulfill({ status: 204 }) }
    if (request.method() === 'POST' && path === '/api/v1/account/sessions/session-other/revoke') { sessions = sessions.filter((item) => item.id !== 'session-other'); return route.fulfill({ status: 204 }) }
    if (request.method() === 'GET' && path === '/api/v1/audit') return json(route, { events: [] })
    if (request.method() === 'POST' && path === '/api/v1/data/import/preview') {
      previewBodies.push(request.postDataJSON())
      return json(route, { status: 'ready', previewChecksum: 'b'.repeat(64), counts: { goals: 1 }, conflicts: [], rejectedRecords: [], ownerRemap: null })
    }
    if (request.method() === 'POST' && path === '/api/v1/data/import/apply') {
      applyBodies.push(request.postDataJSON())
      return json(route, { applied: true, counts: { goals: 1 }, restorePoint: { id: 'restore-global', checksumSha256: 'a'.repeat(64), createdAt: timestamp } })
    }
    return json(route, {})
  })
  return { passwordBodies, previewBodies, applyBodies, createKeys, undoCount: () => undoCount }
}

test('global search and quick create preserve keyboard context, idempotency and undo', async ({ page }) => {
  const fixture = await installFixture(page)
  await page.goto('/app/overview')

  const searchOpener = page.getByRole('button', { name: '打开全局搜索' })
  await searchOpener.focus()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
  const search = page.getByRole('searchbox', { name: '搜索 LifeOps' })
  await search.fill('平台')
  const option = page.getByRole('option', { name: '任务 平台全局验收' })
  await expect(option).toBeVisible()
  await search.press('ArrowDown')
  await expect(option).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Escape')
  await expect(searchOpener).toBeFocused()

  const quickOpener = page.getByRole('button', { name: '快速记录' })
  await quickOpener.focus()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+/' : 'Control+/')
  const dialog = page.getByRole('dialog', { name: '快速记录' })
  await expect(dialog.getByRole('combobox', { name: '记录类型' })).toHaveValue('record')
  await dialog.getByLabel('标题').fill('P5-T7 全局记录')
  await dialog.getByRole('button', { name: '创建记录' }).click()
  await expect(dialog.getByRole('status', { name: '创建成功' })).toContainText('P5-T7 全局记录')
  expect(fixture.createKeys).toHaveLength(1)
  expect(fixture.createKeys[0]).not.toBe('')
  await dialog.getByRole('button', { name: '撤销' }).click()
  await expect(dialog.getByText('已撤销')).toBeVisible()
  expect(fixture.undoCount()).toBe(1)
})

test('all settings categories include password/session and preview-before-apply journeys', async ({ page }) => {
  const fixture = await installFixture(page)
  await page.goto('/app/settings')
  const categories = page.getByRole('navigation', { name: '设置分类' }).getByRole('button')
  await expect(categories).toHaveCount(9)
  for (const label of ['账户与会话', '外观与动效', '时间与区域', '默认行为', '生活阈值与提醒', 'Obsidian', '平台连接', '公开站点', '数据与安全']) {
    await settingsCategory(page, label).click()
    await expect(settingsCategory(page, label)).toHaveAttribute('aria-current', 'page')
  }

  await settingsCategory(page, '账户与会话').click()
  await page.getByLabel('当前密码').fill('Current-password-2026!')
  await page.getByLabel('新密码').fill('Next-password-2026!')
  await page.getByRole('button', { name: '更新密码' }).click()
  await expect(page.getByText('密码已更新，其他会话已撤销。')).toBeVisible()
  expect(fixture.passwordBodies).toEqual([{ currentPassword: 'Current-password-2026!', newPassword: 'Next-password-2026!' }])
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(page.getByText('其他会话', { exact: true })).toHaveCount(0)
  await expect(page.getByText('通过退出登录结束')).toBeVisible()

  await settingsCategory(page, '数据与安全').click()
  await page.getByLabel('选择导入 JSON').setInputFiles({ name: 'lifeops.json', mimeType: 'application/json', buffer: Buffer.from('{}') })
  await expect(page.getByText(/预览完成/)).toBeVisible()
  expect(fixture.previewBodies).toHaveLength(1)
  expect(fixture.applyBodies).toHaveLength(0)
  await expect(page.getByRole('button', { name: '应用导入' })).toBeDisabled()
  await page.getByLabel('当前密码').fill('Current-password-2026!')
  await page.getByRole('checkbox', { name: /我已理解影响与恢复方式/ }).check()
  await page.getByRole('button', { name: '应用导入' }).click()
  await expect(page.getByText('导入已原子应用；恢复点 restore-global 已校验并保留。')).toBeVisible()
  expect(fixture.applyBodies).toEqual([{ previewChecksum: 'b'.repeat(64), currentPassword: 'Current-password-2026!' }])
})

test('mobile settings enters and returns from every category without losing navigation state', async ({ page }) => {
  await installFixture(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/app/settings')
  for (const label of ['账户与会话', '外观与动效', '时间与区域', '默认行为', '生活阈值与提醒', 'Obsidian', '平台连接', '公开站点', '数据与安全']) {
    const category = settingsCategory(page, label)
    await category.click()
    await expect(page.getByRole('button', { name: '返回设置分类' })).toBeVisible()
    await expect(category).toHaveAttribute('aria-current', 'page')
    await page.getByRole('button', { name: '返回设置分类' }).click()
    await expect(category).toBeVisible()
  }
})
