import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page, type Route } from '@playwright/test'
import { screenshotToPath } from './helpers/screenshotToPath'
import { traceToPath } from './helpers/traceToPath'

const evidenceDir = resolve('outputs/evidence/browser/p3-t5')
const session = { mode: 'local-preview', account: 'records-e2e@lifeops.local' }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XG62WQAAAABJRU5ErkJggg==', 'base64')
const coverFixture = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 720" role="img" aria-label="发布前的闭环检查">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#eef5f2"/>
        <stop offset=".56" stop-color="#dbe9ed"/>
        <stop offset="1" stop-color="#f5eadb"/>
      </linearGradient>
      <radialGradient id="sun">
        <stop offset="0" stop-color="#fffdf4"/>
        <stop offset=".5" stop-color="#f9c977"/>
        <stop offset="1" stop-color="#e68a50" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1200" height="720" fill="url(#sky)"/>
    <circle cx="900" cy="172" r="180" fill="url(#sun)" opacity=".9"/>
    <path d="M0 514 C210 426 344 456 510 514 S846 608 1200 466 V720 H0Z" fill="#607b6f" opacity=".2"/>
    <path d="M0 574 C220 504 396 536 590 592 S944 610 1200 540 V720 H0Z" fill="#3f5c53" opacity=".2"/>
    <g fill="none" stroke="#263e39" stroke-width="4" opacity=".68">
      <path d="M154 492 L332 492 L332 422"/>
      <path d="M154 492 L206 542 L332 422"/>
      <circle cx="154" cy="492" r="14" fill="#f8fbf9"/>
      <circle cx="206" cy="542" r="14" fill="#f8fbf9"/>
      <circle cx="332" cy="422" r="14" fill="#f8fbf9"/>
    </g>
    <text x="82" y="118" fill="#17302b" font-family="system-ui, sans-serif" font-size="54" font-weight="650">发布前的闭环检查</text>
    <text x="84" y="169" fill="#536b65" font-family="system-ui, sans-serif" font-size="23">记录决定、验证证据与下一步，让发生过的事留有来处。</text>
  </svg>
`, 'utf8')

const record = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  title: id,
  body: `# ${id}\n\n真实发生的记录。`,
  occurredAt: '2026-08-15T09:30:00.000Z',
  tags: ['lifeops'],
  pinned: false,
  archivedAt: null,
  links: [],
  mediaIds: [],
  coverMediaId: null,
  version: 3,
  createdAt: '2026-08-15T09:30:00.000Z',
  updatedAt: '2026-08-15T09:30:00.000Z',
  deletedAt: null,
  ...patch,
})

const initialRecords = [
  record('record-release', {
    title: '发布前的闭环检查',
    links: [{ type: 'task', id: 'task:lifeops:step-4' }, { type: 'project', id: 'project-lifeops' }],
    mediaIds: ['media-cover', 'media-detail'],
    coverMediaId: 'media-cover',
  }),
  record('record-walk', { title: '午后散步', occurredAt: '2026-08-15T06:00:00.000Z', tags: ['生活'] }),
  record('record-yesterday', { title: '昨日复盘', occurredAt: '2026-08-14T12:00:00.000Z' }),
]

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function authenticatePreview(page: Page) {
  await page.addInitScript((value) => sessionStorage.setItem('lifeops:session:v1', JSON.stringify(value)), session)
}

interface RecordsCalls {
  creates: Array<Record<string, unknown>>
  lists: string[]
  patches: Array<{ id: string; body: Record<string, unknown> }>
  setConflict(value: boolean): void
  setUploadFailure(value: boolean): void
}

async function routeRecords(page: Page): Promise<RecordsCalls> {
  let values = structuredClone(initialRecords)
  let conflict = false
  let failUpload = false
  let uploadSequence = 0
  let deleted: (typeof values)[number] | undefined
  const calls: RecordsCalls = {
    creates: [],
    lists: [],
    patches: [],
    setConflict: (value) => { conflict = value },
    setUploadFailure: (value) => { failUpload = value },
  }

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname

    if (request.method() === 'GET' && path === '/api/v1/records') {
      calls.lists.push(url.search)
      return json(route, values)
    }
    if (request.method() === 'GET' && path.startsWith('/api/v1/media/')) {
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: coverFixture })
    }
    if (request.method() === 'POST' && path === '/api/v1/media') {
      if (failUpload) {
        failUpload = false
        return json(route, { error: { code: 'UPLOAD_FAILED', message: '测试上传失败' } }, 503)
      }
      uploadSequence += 1
      return json(route, {
        id: `media-upload-${uploadSequence}`, visibility: 'private', mimeType: 'image/png', originalName: 'proof.png', sizeBytes: png.length,
        checksum: 'A'.repeat(64), width: 800, height: 600, version: 1,
        createdAt: '2026-08-15T12:00:00.000Z', updatedAt: '2026-08-15T12:00:00.000Z', deletedAt: null,
      }, 201)
    }
    if (request.method() === 'POST' && path === '/api/v1/records') {
      const body = request.postDataJSON() as Record<string, unknown>
      calls.creates.push(body)
      const created = record(`record-created-${calls.creates.length}`, {
        ...body,
        occurredAt: '2026-08-15T12:00:00.000Z',
        version: 1,
        createdAt: '2026-08-15T12:00:00.000Z',
        updatedAt: '2026-08-15T12:00:00.000Z',
      })
      values = [created, ...values]
      return json(route, created, 201)
    }
    const recordMatch = path.match(/^\/api\/v1\/records\/([^/]+)$/)
    if (request.method() === 'PATCH' && recordMatch) {
      const id = decodeURIComponent(recordMatch[1])
      const body = request.postDataJSON() as Record<string, unknown>
      calls.patches.push({ id, body })
      if (conflict) {
        conflict = false
        return json(route, { error: { code: 'VERSION_CONFLICT', message: '记录已被更新', requestId: 'records-e2e-409' } }, 409)
      }
      const current = values.find((item) => item.id === id)
      if (!current) return json(route, { error: { code: 'NOT_FOUND', message: '找不到记录' } }, 404)
      const updated = {
        ...current,
        ...body,
        archivedAt: body.archived === true ? '2026-08-15T12:00:00.000Z' : current.archivedAt,
        version: Number(body.version) + 1,
        updatedAt: '2026-08-15T12:00:00.000Z',
      }
      values = values.map((item) => item.id === id ? updated : item)
      return json(route, updated)
    }
    if (request.method() === 'DELETE' && recordMatch) {
      const id = decodeURIComponent(recordMatch[1])
      const body = request.postDataJSON() as { version: number }
      const current = values.find((item) => item.id === id)
      if (current) deleted = { ...current, version: body.version + 1, deletedAt: '2026-08-15T12:00:00.000Z' }
      values = values.filter((item) => item.id !== id)
      return route.fulfill({ status: 204 })
    }
    const restoreMatch = path.match(/^\/api\/v1\/records\/([^/]+)\/restore$/)
    if (request.method() === 'POST' && restoreMatch && deleted) {
      const body = request.postDataJSON() as { version: number }
      const restored = { ...deleted, version: body.version + 1, deletedAt: null }
      values = [restored, ...values]
      deleted = undefined
      return json(route, restored)
    }
    if (request.method() === 'GET' && path === '/api/v1/state') {
      return json(route, { schemaVersion: 1, plans: [], records: [], reviews: [], knowledge: [], snapshots: [] })
    }
    return json(route, {})
  })
  return calls
}

test.use({ trace: 'off' })

test('record stream preserves source identity, keyboard history and responsive editor layers', async ({ page, context }) => {
  mkdirSync(evidenceDir, { recursive: true })
  await authenticatePreview(page)
  const calls = await routeRecords(page)
  await context.tracing.start({ screenshots: true, snapshots: true })
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/app/records?record=record-release&source=task:task%3Alifeops%3Astep-4')
    await expect(page.getByRole('heading', { name: '记录', level: 1 })).toBeVisible()
    await expect(page.getByRole('group', { name: '2026年8月15日' })).toContainText('发布前的闭环检查')
    await expect(page.getByRole('region', { name: '记录编辑器' }).getByRole('img', { name: '发布前的闭环检查封面' })).toBeVisible()
    expect(calls.lists).toContain('?linkType=task&linkId=task%3Alifeops%3Astep-4')

    for (const viewport of [
      { width: 1440, height: 900, name: 'records-1440x900.png' },
      { width: 1024, height: 768, name: 'records-1024x768.png' },
      { width: 768, height: 1024, name: 'records-768x1024.png' },
      { width: 390, height: 844, name: 'records-390x844-editor.png' },
    ]) {
      await page.setViewportSize(viewport)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${viewport.width} CSS px`).toBe(true)
      await screenshotToPath(page, { path: resolve(evidenceDir, viewport.name), fullPage: true })
    }

    await page.setViewportSize({ width: 1440, height: 900 })
    const walk = page.getByRole('button', { name: /午后散步/ })
    await walk.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/record=record-walk/)
    await page.goBack()
    await expect(page).toHaveURL(/record=record-release/)
    await expect(page.getByLabel('标题')).toHaveValue('发布前的闭环检查')

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByRole('button', { name: '返回记录流' })).toBeVisible()
    await expect(page.getByRole('region', { name: '记录编辑器' })).toHaveCSS('position', 'fixed')
    await page.getByRole('button', { name: '返回记录流' }).click()
    await expect(page.getByRole('heading', { name: '发生过的事' })).toBeVisible()

    await page.setViewportSize({ width: 320, height: 900 })
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), '200% text / 320 CSS px').toBe(true)
    await screenshotToPath(page, { path: resolve(evidenceDir, 'records-320x900-200pct-reflow.png'), fullPage: true })
  } finally {
    await traceToPath(context, resolve(evidenceDir, 'records-responsive-keyboard-trace.zip'))
  }
})

test('record autosave exposes timestamp, local 409 recovery and honest offline session draft', async ({ page, context }) => {
  mkdirSync(evidenceDir, { recursive: true })
  await authenticatePreview(page)
  const calls = await routeRecords(page)
  await page.goto('/app/records?record=record-release')
  const body = page.getByLabel('Markdown 正文')
  await expect(body).toHaveValue(/真实发生/)

  await body.fill('第一次自动保存成功。')
  await expect(page.getByRole('status', { name: '' }).filter({ hasText: /已保存 ·/ })).toBeVisible({ timeout: 4_000 })
  expect(calls.patches.at(-1)?.body).toMatchObject({ body: '第一次自动保存成功。', version: 3 })

  calls.setConflict(true)
  await body.fill('产生版本冲突但不能丢失的正文。')
  await expect(page.getByText('保存冲突', { exact: true })).toBeVisible({ timeout: 4_000 })
  await expect(page.getByRole('alert').filter({ hasText: '本地草稿没有覆盖新内容' })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('lifeops:record-draft:record-release'))).toContain('产生版本冲突')

  await context.setOffline(true)
  try {
    await body.fill('离线时保留在当前会话的明文草稿。')
    await expect(page.getByText('离线草稿', { exact: true })).toBeVisible({ timeout: 4_000 })
    await expect(page.getByText(/当前浏览器会话.*明文/)).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('lifeops:record-draft:record-release'))).toBeNull()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.evaluate(() => scrollTo(0, 0))
    await screenshotToPath(page, { path: resolve(evidenceDir, 'records-1440x900-offline.png') })
  } finally {
    await context.setOffline(false)
  }
})

test('record upload retries, revokes removed previews and creates with an explicit private cover', async ({ page }) => {
  await authenticatePreview(page)
  await page.addInitScript(() => {
    const original = URL.revokeObjectURL.bind(URL)
    Object.defineProperty(window, '__lifeopsRevokedUrls', { configurable: true, value: [] as string[], writable: true })
    URL.revokeObjectURL = (url) => {
      ;(window as typeof window & { __lifeopsRevokedUrls: string[] }).__lifeopsRevokedUrls.push(url)
      original(url)
    }
  })
  const calls = await routeRecords(page)
  calls.setUploadFailure(true)
  await page.goto('/app/records?create=record&source=task:task-closed-loop')
  await page.getByLabel('标题').fill('任务完成记录')
  await page.getByLabel('Markdown 正文').fill('完成了真实闭环。')
  const upload = page.getByLabel('上传图片')
  await upload.setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByText('上传失败')).toBeVisible()
  await page.getByRole('button', { name: '重试上传 proof.png' }).click()
  await expect(page.getByText('上传完成')).toBeVisible()
  await page.getByRole('button', { name: '设为封面 proof.png' }).click()
  await page.getByRole('button', { name: '移除 proof.png' }).click()
  await expect(page.getByText('proof.png')).toHaveCount(0)
  expect(await page.evaluate(() => (window as typeof window & { __lifeopsRevokedUrls: string[] }).__lifeopsRevokedUrls.length)).toBeGreaterThan(0)

  await upload.setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByText('上传完成')).toBeVisible()
  await page.getByRole('button', { name: '设为封面 proof.png' }).click()
  await page.getByRole('button', { name: '创建记录' }).click()
  await expect.poll(() => calls.creates.length).toBe(1)
  expect(calls.creates[0]).toMatchObject({
    title: '任务完成记录',
    body: '完成了真实闭环。',
    links: [{ type: 'task', id: 'task-closed-loop' }],
    mediaIds: ['media-upload-2'],
    coverMediaId: 'media-upload-2',
  })
  await expect(page.getByText('仅自己可见')).toBeVisible()
})

test('invalid and duplicate record source values stay scoped and send no guessed list request', async ({ page }) => {
  await authenticatePreview(page)
  const calls = await routeRecords(page)
  await page.goto('/app/records?source=task')
  await expect(page.getByRole('alert', { name: '来源筛选错误' })).toContainText('来源筛选格式无效')
  expect(calls.lists).toHaveLength(0)
  await page.goto('/app/records?source=goal:goal-1&source=task:task-1')
  await expect(page.getByRole('alert', { name: '来源筛选错误' })).toBeVisible()
  expect(calls.lists).toHaveLength(0)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/app/records')
  await expect(page.getByRole('region', { name: '记录时间流' })).toBeVisible()
  const maximumTransition = await page.locator('.records-page').evaluate((root) => Math.max(...Array.from(root.querySelectorAll('*')).map((element) => Number.parseFloat(getComputedStyle(element).transitionDuration) || 0)))
  expect(maximumTransition).toBeLessThanOrEqual(.001)
})
