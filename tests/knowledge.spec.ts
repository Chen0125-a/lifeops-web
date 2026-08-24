import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page, type Route } from '@playwright/test'

const evidenceDir = resolve('outputs/evidence/browser/p4-t2')
const session = { mode: 'local-preview', account: 'knowledge-e2e@lifeops.local' }

const note = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  title: id,
  body: `# ${id}\n\n可追溯的知识正文。`,
  tags: ['lifeops'],
  collectionIds: ['collection-work'],
  sourceLinks: [],
  relatedIds: [],
  pinned: false,
  favorite: false,
  reviewOn: null,
  version: 4,
  createdAt: '2026-08-20T08:00:00.000Z',
  updatedAt: '2026-08-20T08:00:00.000Z',
  archivedAt: null,
  deletedAt: null,
  ...patch,
})

const initialNotes = [
  note('note-release', {
    title: '从复盘提炼发布门禁',
    body: '# 发布门禁\n\n每条结论都要保留来源，并经过新鲜验证。',
    tags: ['k8s', '发布'],
    sourceLinks: [{ type: 'review', id: 'review-week-32' }],
    relatedIds: ['note-observability'],
    pinned: true,
    favorite: true,
    reviewOn: '2026-08-22',
  }),
  note('note-observability', {
    title: '可观测性要保留来源',
    body: '# 可观测性\n\n指标、日志与告警只呈现已连接的事实。',
    tags: ['k8s', '可观测性'],
    collectionIds: ['collection-tech'],
    sourceLinks: [{ type: 'record', id: 'record-incident-7' }],
  }),
  note('note-rhythm', { title: '每周回顾节奏', tags: ['复盘'] }),
]

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function authenticatePreview(page: Page) {
  await page.addInitScript((value) => sessionStorage.setItem('lifeops:session:v1', JSON.stringify(value)), session)
}

interface KnowledgeCalls {
  patches: Array<Record<string, unknown>>
  setConflict(value: boolean): void
}

async function routeKnowledge(page: Page, listStatus = 200): Promise<KnowledgeCalls> {
  let values = structuredClone(initialNotes)
  let conflict = false
  const calls: KnowledgeCalls = {
    patches: [],
    setConflict: (value) => { conflict = value },
  }

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname

    if (request.method() === 'GET' && path === '/api/v1/knowledge/collections') {
      return json(route, [
        { id: 'collection-work', name: '工作', color: '#D95D39', position: 1, version: 1 },
        { id: 'collection-tech', name: '技术', color: '#2E6F65', position: 2, version: 1 },
      ])
    }
    if (request.method() === 'GET' && path === '/api/v1/knowledge/resurface') return json(route, [values[0]])
    if (request.method() === 'GET' && path === '/api/v1/knowledge') {
      if (listStatus === 403) return json(route, { error: { code: 'FORBIDDEN', message: '你没有权限读取这些知识' } }, 403)
      return json(route, { items: values })
    }
    const item = path.match(/^\/api\/v1\/knowledge\/([^/]+)$/)
    if (request.method() === 'PATCH' && item) {
      const id = decodeURIComponent(item[1])
      const body = request.postDataJSON() as Record<string, unknown>
      calls.patches.push(body)
      if (conflict) {
        conflict = false
        return json(route, { error: { code: 'VERSION_CONFLICT', message: '知识已在另一处更新', requestId: 'knowledge-e2e-409' } }, 409)
      }
      const current = values.find((candidate) => candidate.id === id)
      if (!current) return json(route, { error: { code: 'NOT_FOUND', message: '找不到知识' } }, 404)
      const updated = { ...current, ...body, version: Number(body.version) + 1, updatedAt: '2026-08-22T10:00:00.000Z' }
      values = values.map((candidate) => candidate.id === id ? updated : candidate)
      return json(route, updated)
    }
    if (request.method() === 'GET' && path === '/api/v1/state') return json(route, { schemaVersion: 1, plans: [], records: [], reviews: [], knowledge: [], snapshots: [] })
    return json(route, {})
  })
  return calls
}

test.use({ trace: 'off' })

test('knowledge workspace preserves 2.5/3.5/6, URL history, keyboard focus and responsive layers', async ({ page, context }) => {
  mkdirSync(evidenceDir, { recursive: true })
  await authenticatePreview(page)
  await routeKnowledge(page)
  await context.tracing.start({ screenshots: true, snapshots: true })
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/app/knowledge?note=note-release')
    await expect(page.getByRole('heading', { name: '知识', level: 1 })).toBeVisible()
    await expect(page.getByRole('navigation', { name: '知识资料库' })).toContainText('工作')
    await expect(page.getByRole('region', { name: '知识列表' })).toContainText('可观测性要保留来源')
    await expect(page.getByRole('region', { name: '知识阅读与编辑' })).toContainText('每条结论都要保留来源')

    for (const viewport of [
      { width: 1440, height: 900, name: 'knowledge-1440x900.png' },
      { width: 1024, height: 768, name: 'knowledge-1024x768.png' },
      { width: 768, height: 1024, name: 'knowledge-768x1024-reader.png' },
      { width: 390, height: 844, name: 'knowledge-390x844-reader.png' },
    ]) {
      await page.setViewportSize(viewport)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${viewport.width} CSS px`).toBe(true)
      await page.screenshot({ path: resolve(evidenceDir, viewport.name), fullPage: true })
    }

    await page.setViewportSize({ width: 1440, height: 900 })
    const observable = page.getByRole('button', { name: '知识 可观测性要保留来源', exact: true })
    await observable.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/note=note-observability/)
    await expect(page.getByRole('button', { name: '返回知识列表' })).toBeFocused()
    await page.goBack()
    await expect(page).toHaveURL(/note=note-release/)

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByRole('navigation', { name: '知识资料库' })).toBeHidden()
    await page.getByRole('button', { name: '返回知识列表' }).click()
    await expect(page.getByRole('region', { name: '知识列表' })).toBeVisible()
    await expect(page.getByRole('region', { name: '知识阅读与编辑' })).toBeHidden()
    await page.screenshot({ path: resolve(evidenceDir, 'knowledge-390x844-list.png'), fullPage: true })

    await page.setViewportSize({ width: 320, height: 900 })
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    await page.evaluate(() => scrollTo(0, 0))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), '200% text / 320 CSS px').toBe(true)
    await page.screenshot({ path: resolve(evidenceDir, 'knowledge-320x900-200pct-reflow.png'), fullPage: true })
  } finally {
    await context.tracing.stop({ path: resolve(evidenceDir, 'knowledge-responsive-keyboard-trace.zip') })
  }
})

test('knowledge autosave preserves conflict and offline drafts and reduced motion remains immediate', async ({ page, context }) => {
  await authenticatePreview(page)
  const calls = await routeKnowledge(page)
  await page.goto('/app/knowledge?note=note-release')
  await page.getByRole('button', { name: '编辑知识' }).click()
  const body = page.getByLabel('Markdown 正文')
  await body.fill('第一次知识自动保存成功。')
  await expect(page.getByRole('status').filter({ hasText: /已保存 ·/ })).toBeVisible({ timeout: 4_000 })
  expect(calls.patches.at(-1)).toMatchObject({ body: '第一次知识自动保存成功。', version: 4 })

  calls.setConflict(true)
  await body.fill('冲突时不能丢失的本地知识。')
  await expect(page.getByRole('alert', { name: '知识保存冲突' })).toContainText('服务器版本', { timeout: 4_000 })
  expect(await page.evaluate(() => sessionStorage.getItem('lifeops:record-draft:knowledge:note-release'))).toContain('冲突时不能丢失')

  await context.setOffline(true)
  try {
    await body.fill('离线时保留在当前会话的明文知识草稿。')
    await expect(page.getByText('离线草稿', { exact: true })).toBeVisible({ timeout: 4_000 })
    await expect(page.getByText(/当前浏览器会话.*明文/)).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('lifeops:record-draft:knowledge:note-release'))).toBeNull()
    await page.screenshot({ path: resolve(evidenceDir, 'knowledge-1440x900-offline.png'), fullPage: true })
  } finally {
    await context.setOffline(false)
  }

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  await expect(page.getByRole('region', { name: '知识阅读与编辑' })).toBeVisible()
  const maximumTransition = await page.locator('.knowledge-page').evaluate((root) => Math.max(...Array.from(root.querySelectorAll('*')).map((element) => Number.parseFloat(getComputedStyle(element).transitionDuration) || 0)))
  expect(maximumTransition).toBeLessThanOrEqual(.001)
  await page.screenshot({ path: resolve(evidenceDir, 'knowledge-1440x900-reduced-motion.png'), fullPage: true })
})

test('knowledge permission failure stays scoped and retryable', async ({ page }) => {
  await authenticatePreview(page)
  await routeKnowledge(page, 403)
  await page.goto('/app/knowledge')
  await expect(page.getByRole('heading', { name: '知识', level: 1 })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('你没有访问这些知识的权限')
  await expect(page.getByRole('button', { name: '重新加载' })).toBeVisible()
})
