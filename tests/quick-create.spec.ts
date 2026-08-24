import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Route } from '@playwright/test'

const evidenceDir = resolve('outputs/evidence/browser/p5-t5')
const session = { mode: 'local-preview', account: 'quick-create@lifeops.local' }
const state = {
  schemaVersion: 1,
  plans: [],
  records: [{
    id: 'record-context', title: 'P5 搜索验收', body: '从当前记录继承来源。', occurredAt: '2026-08-23T00:30:00.000Z',
    tags: ['P5'], links: [], mediaIds: [], coverMediaId: null, pinned: false, archivedAt: null, version: 1,
    createdAt: '2026-08-23T00:30:00.000Z', updatedAt: '2026-08-23T00:30:00.000Z', deletedAt: null,
  }],
  reviews: [],
  knowledge: [],
  snapshots: [],
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-08-23T01:45:00+08:00'))
  await page.addInitScript((fixture) => {
    sessionStorage.setItem('lifeops:session:v1', JSON.stringify(fixture.session))
    localStorage.setItem('lifeops:data:v1', JSON.stringify(fixture.state))
  }, { session, state })
})

test('quick create is contextual, retry-safe, undoable and responsive', async ({ page }) => {
  mkdirSync(evidenceDir, { recursive: true })
  const createKeys: string[] = []
  let createAttempts = 0
  let deleteCount = 0
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'GET' && path === '/api/v1/records') return json(route, state.records)
    if (request.method() === 'GET' && path === '/api/v1/habits') return json(route, { from: '', to: '', habits: [], entries: [] })
    if (request.method() === 'POST' && path === '/api/v1/records') {
      createAttempts += 1
      createKeys.push(request.headers()['idempotency-key'] ?? '')
      if (createAttempts === 1) return json(route, { error: { code: 'TEMPORARY', message: '临时写入失败' } }, 503)
      const body = request.postDataJSON() as Record<string, unknown>
      return json(route, {
        ...state.records[0], ...body, id: 'record-created', version: 1,
        createdAt: '2026-08-23T01:45:00.000Z', updatedAt: '2026-08-23T01:45:00.000Z', deletedAt: null,
      }, 201)
    }
    if (request.method() === 'DELETE' && path === '/api/v1/records/record-created') {
      deleteCount += 1
      return route.fulfill({ status: 204 })
    }
    if (request.method() === 'GET' && path === '/api/v1/state') return json(route, state)
    return json(route, [])
  })

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/app/records?record=record-context')
  const opener = page.getByRole('button', { name: '快速记录' })
  await opener.focus()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+/' : 'Control+/')
  const dialog = page.getByRole('dialog', { name: '快速记录' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('标题')).toBeFocused()
  await expect(dialog.getByRole('combobox', { name: '记录类型' })).toHaveValue('record')
  await expect(dialog.getByText('来源 record record-context')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+/' : 'Control+/')
  await dialog.getByRole('combobox', { name: '记录类型' }).selectOption('task')
  await expect(dialog.getByRole('button', { name: '创建任务' })).toBeDisabled()
  await dialog.getByRole('combobox', { name: '记录类型' }).selectOption('record')

  for (const viewport of [
    { width: 1440, height: 900, name: 'quick-create-1440x900.png' },
    { width: 1024, height: 768, name: 'quick-create-1024x768.png' },
    { width: 768, height: 1024, name: 'quick-create-768x1024.png' },
    { width: 390, height: 844, name: 'quick-create-390x844.png' },
    { width: 320, height: 900, name: 'quick-create-320x900-reflow.png' },
  ]) {
    await page.setViewportSize(viewport)
    await expect(dialog).toBeVisible()
    const geometry = await page.evaluate(() => {
      const root = document.documentElement
      const form = document.querySelector('.quick-create form')!.getBoundingClientRect()
      return {
        documentFits: root.scrollWidth <= root.clientWidth + 1,
        panelFits: form.left >= -1 && form.right <= root.clientWidth + 1 && form.top >= -1 && form.bottom <= innerHeight + 1,
      }
    })
    expect(geometry, `${viewport.width} CSS px`).toEqual({ documentFits: true, panelFits: true })
    const titleIsTopmost = await dialog.getByLabel('标题').evaluate((input) => {
      const rect = input.getBoundingClientRect()
      const topmost = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return topmost === input || input.contains(topmost)
    })
    expect(titleIsTopmost, `Quick Create must remain interactive at ${viewport.width} CSS px`).toBe(true)
    await dialog.screenshot({ path: resolve(evidenceDir, viewport.name) })
  }

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await dialog.screenshot({ path: resolve(evidenceDir, 'quick-create-390x844-reduced-motion.png') })

  await page.setViewportSize({ width: 1440, height: 900 })
  await dialog.getByLabel('标题').fill('完成 P5-T5 快速记录验收')
  await dialog.getByRole('button', { name: '展开高级字段' }).click()
  await dialog.getByLabel('补充说明').fill('验证一次创建、同键重试与安全撤销。')
  await dialog.getByRole('button', { name: '创建记录' }).click()
  await expect(dialog.getByRole('alert')).toContainText('临时写入失败')
  await dialog.getByRole('button', { name: '重试创建' }).click()
  await expect(dialog.getByRole('status', { name: '创建成功' })).toContainText('完成 P5-T5 快速记录验收')
  expect(createKeys).toHaveLength(2)
  expect(createKeys[0]).not.toBe('')
  expect(createKeys[1]).toBe(createKeys[0])

  await dialog.getByRole('button', { name: '撤销' }).click()
  await expect(dialog.getByText('已撤销')).toBeVisible()
  expect(deleteCount).toBe(1)
})
