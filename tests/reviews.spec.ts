import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page, type Route } from '@playwright/test'
import { screenshotToPath } from './helpers/screenshotToPath'
import { traceToPath } from './helpers/traceToPath'

const evidenceDir = resolve('outputs/evidence/browser/p3-t6')
const session = { mode: 'local-preview', account: 'reviews-e2e@lifeops.local' }

const evidence = {
  period: { from: '2026-08-15', to: '2026-08-21' },
  goals: { active: 2, completed: 1 },
  projects: { active: 1, completed: 1 },
  tasks: { total: 8, completed: 6, skipped: 1, cancelled: 0 },
  habits: { entries: 12, done: 8, partial: 2, intentionalSkips: 2 },
  records: { total: 3, ids: ['record-release', 'record-walk', 'record-review'] },
  priorCommitments: [{ reviewId: 'review-previous', text: '完成 P3-T5 真实浏览器门禁', status: 'pending' }],
  hasFacts: true,
}

const action = (id: string, text: string, patch: Record<string, unknown> = {}) => ({
  id,
  text,
  status: 'pending',
  convertedTarget: null,
  convertedId: null,
  version: 1,
  createdAt: '2026-08-21T08:00:00.000Z',
  updatedAt: '2026-08-21T08:00:00.000Z',
  ...patch,
})

const review = (id: string, type: 'weekly' | 'monthly' | 'custom', period: { from: string; to: string }, patch: Record<string, unknown> = {}) => ({
  id,
  type,
  period,
  status: 'draft',
  achievements: ['完成 P3-T5 全量门禁'],
  problems: ['局部会话无法保留预览 Cookie'],
  causes: ['Vite 代理下的会话边界与真实服务不同'],
  insights: ['界面证据和发布证据需要分开表达'],
  nextChanges: ['完成 P3-T6 证据化回顾工作台'],
  evidence: { ...evidence, period },
  actions: [
    action('action-knowledge', '把本次回顾沉淀为知识草稿'),
    action('action-task', '追踪发布边界', { status: 'converted', convertedTarget: 'task', convertedId: 'task-delivery' }),
  ],
  version: 4,
  createdAt: '2026-08-21T08:00:00.000Z',
  updatedAt: '2026-08-21T08:00:00.000Z',
  deletedAt: null,
  ...patch,
})

const initialReviews = [
  review('review-weekly', 'weekly', { from: '2026-08-15', to: '2026-08-21' }),
  review('review-monthly', 'monthly', { from: '2026-08-01', to: '2026-08-21' }, { achievements: [] }),
  review('review-custom', 'custom', { from: '2026-07-23', to: '2026-08-21' }, { achievements: [] }),
]

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function authenticatePreview(page: Page) {
  await page.addInitScript((value) => sessionStorage.setItem('lifeops:session:v1', JSON.stringify(value)), session)
}

interface ReviewCalls {
  conversions: Array<{ actionId: string; body: Record<string, unknown> }>
  patches: Array<Record<string, unknown>>
  refreshes: number
  setConflict(value: boolean): void
}

async function routeReviews(page: Page, listStatus = 200): Promise<ReviewCalls> {
  let values = structuredClone(initialReviews)
  let conflict = false
  const calls: ReviewCalls = {
    conversions: [],
    patches: [],
    refreshes: 0,
    setConflict: (value) => { conflict = value },
  }

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname

    if (request.method() === 'GET' && path === '/api/v1/reviews') {
      if (listStatus === 403) return json(route, { error: { code: 'FORBIDDEN', message: '你没有权限读取这些回顾' } }, 403)
      return json(route, values)
    }
    if (request.method() === 'POST' && path === '/api/v1/reviews') {
      const body = request.postDataJSON() as { type: 'weekly' | 'monthly' | 'custom'; period: { from: string; to: string } }
      const created = review(`review-created-${values.length}`, body.type, body.period, { version: 1, achievements: [], problems: [], causes: [], insights: [], nextChanges: [], actions: [] })
      values = [created, ...values]
      return json(route, created, 201)
    }
    const itemMatch = path.match(/^\/api\/v1\/reviews\/([^/]+)$/)
    if (request.method() === 'PATCH' && itemMatch) {
      const id = decodeURIComponent(itemMatch[1])
      const body = request.postDataJSON() as Record<string, unknown>
      calls.patches.push(body)
      if (conflict) {
        conflict = false
        return json(route, { error: { code: 'VERSION_CONFLICT', message: '回顾已在其他位置更新', requestId: 'reviews-e2e-409' } }, 409)
      }
      const current = values.find((item) => item.id === id)
      if (!current) return json(route, { error: { code: 'NOT_FOUND', message: '找不到回顾' } }, 404)
      const updated = { ...current, ...body, version: Number(body.version) + 1, updatedAt: '2026-08-21T09:00:00.000Z' }
      values = values.map((item) => item.id === id ? updated : item)
      return json(route, updated)
    }
    const refreshMatch = path.match(/^\/api\/v1\/reviews\/([^/]+)\/refresh-evidence$/)
    if (request.method() === 'POST' && refreshMatch) {
      calls.refreshes += 1
      const id = decodeURIComponent(refreshMatch[1])
      const body = request.postDataJSON() as { version: number }
      const current = values.find((item) => item.id === id)
      if (!current) return json(route, { error: { code: 'NOT_FOUND', message: '找不到回顾' } }, 404)
      const updated = { ...current, version: body.version + 1, updatedAt: '2026-08-21T09:00:00.000Z' }
      values = values.map((item) => item.id === id ? updated : item)
      return json(route, updated)
    }
    const conversionMatch = path.match(/^\/api\/v1\/reviews\/([^/]+)\/actions\/([^/]+)\/convert$/)
    if (request.method() === 'POST' && conversionMatch) {
      const reviewId = decodeURIComponent(conversionMatch[1])
      const actionId = decodeURIComponent(conversionMatch[2])
      const body = request.postDataJSON() as Record<string, unknown>
      calls.conversions.push({ actionId, body })
      const current = values.find((item) => item.id === reviewId)
      if (!current) return json(route, { error: { code: 'NOT_FOUND', message: '找不到回顾' } }, 404)
      const converted = { ...current.actions.find((item) => item.id === actionId)!, status: 'converted', convertedTarget: body.target, convertedId: 'knowledge-review-p3-t6', version: 2, updatedAt: '2026-08-21T09:00:00.000Z' }
      const updated = { ...current, actions: current.actions.map((item) => item.id === actionId ? converted : item), version: current.version + 1, updatedAt: '2026-08-21T09:00:00.000Z' }
      values = values.map((item) => item.id === reviewId ? updated : item)
      return json(route, { review: updated, action: converted, target: { type: body.target, id: 'knowledge-review-p3-t6', title: '本次回顾知识草稿' } })
    }
    if (request.method() === 'GET' && path === '/api/v1/state') {
      return json(route, { schemaVersion: 1, plans: [], records: [], reviews: [], knowledge: [], snapshots: [] })
    }
    return json(route, {})
  })
  return calls
}

test.use({ trace: 'off' })
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-08-21T12:00:00.000Z'))
})

test('review workspace preserves the 3/6/3 facts, URL modes and ordered mobile layers across target breakpoints', async ({ page, context }) => {
  mkdirSync(evidenceDir, { recursive: true })
  await authenticatePreview(page)
  const calls = await routeReviews(page)
  await context.tracing.start({ screenshots: true, snapshots: true })
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/app/reviews?review=review-weekly&period=weekly')
    await expect(page.getByRole('heading', { name: '回顾', level: 1 })).toBeVisible()
    const evidenceRail = page.getByRole('region', { name: '证据目录' })
    const editor = page.getByRole('region', { name: '叙事回顾' })
    const actionRail = page.getByRole('region', { name: '洞察与行动' })
    await expect(evidenceRail).toContainText('6 / 8 完成')
    await expect(evidenceRail).toContainText('完成 P3-T5 真实浏览器门禁')
    await expect(editor.getByLabel('成果')).toHaveValue('完成 P3-T5 全量门禁')
    await expect(actionRail.getByRole('article', { name: /追踪发布边界/ })).toContainText('该行动已绑定唯一结果')

    await page.getByRole('button', { name: '月回顾' }).click()
    await expect(page).toHaveURL(/review=review-monthly&period=monthly/)
    await page.getByRole('button', { name: '自定义周期' }).click()
    await expect(page).toHaveURL(/review=review-custom&period=custom/)
    await page.goBack()
    await expect(page).toHaveURL(/review=review-monthly&period=monthly/)
    await page.goBack()
    await expect(page).toHaveURL(/review=review-weekly&period=weekly/)

    await page.getByRole('button', { name: '记录', exact: true }).click()
    await expect(evidenceRail.getByRole('group', { name: '记录证据' })).toBeVisible()
    await expect(evidenceRail.getByRole('group', { name: '任务证据' })).toHaveCount(0)
    await page.getByRole('button', { name: '全部' }).click()
    await page.getByRole('button', { name: '刷新证据' }).click()
    await expect.poll(() => calls.refreshes).toBe(1)

    for (const viewport of [
      { width: 1440, height: 900, name: 'reviews-1440x900.png' },
      { width: 1024, height: 768, name: 'reviews-1024x768.png' },
      { width: 768, height: 1024, name: 'reviews-768x1024.png' },
    ]) {
      await page.setViewportSize(viewport)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${viewport.width} CSS px`).toBe(true)
      await screenshotToPath(page, { path: resolve(evidenceDir, viewport.name), fullPage: true })
    }

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByRole('button', { name: '证据 1/3' })).toHaveAttribute('aria-current', 'step')
    await expect(evidenceRail).toBeVisible()
    await expect(editor).toBeHidden()
    await screenshotToPath(page, { path: resolve(evidenceDir, 'reviews-390x844-evidence.png'), fullPage: true })
    await page.getByRole('button', { name: '继续到书写' }).click()
    await expect(page.getByRole('button', { name: '书写 2/3' })).toHaveAttribute('aria-current', 'step')
    await expect(editor).toBeVisible()
    await screenshotToPath(page, { path: resolve(evidenceDir, 'reviews-390x844-writing.png'), fullPage: true })
    await page.getByRole('button', { name: '继续到行动' }).click()
    await expect(page.getByRole('button', { name: '行动 3/3' })).toHaveAttribute('aria-current', 'step')
    await expect(actionRail).toBeVisible()
    await expect(page.getByRole('button', { name: '返回书写' })).toHaveCSS('position', 'static')
    await screenshotToPath(page, { path: resolve(evidenceDir, 'reviews-390x844-actions.png'), fullPage: true })

    await page.setViewportSize({ width: 320, height: 900 })
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), '200% text / 320 CSS px').toBe(true)
    const dateGeometry = await page.evaluate(() => {
      const from = document.querySelector<HTMLInputElement>('input[aria-label="周期开始"]')?.getBoundingClientRect()
      const to = document.querySelector<HTMLInputElement>('input[aria-label="周期结束"]')?.getBoundingClientRect()
      if (!from || !to) return null
      return { separateRows: from.bottom <= to.top, contained: from.left >= 0 && from.right <= innerWidth && to.left >= 0 && to.right <= innerWidth }
    })
    expect(dateGeometry).toEqual({ separateRows: true, contained: true })
    await screenshotToPath(page, { path: resolve(evidenceDir, 'reviews-320x900-200pct-reflow.png'), fullPage: true })
  } finally {
    await traceToPath(context, resolve(evidenceDir, 'reviews-responsive-history-trace.zip'))
  }
})

test('review narrative keeps factual evidence visible through 409 recovery and converts one action once', async ({ page }) => {
  await authenticatePreview(page)
  const calls = await routeReviews(page)
  await page.goto('/app/reviews?review=review-weekly&period=weekly')
  const evidenceRail = page.getByRole('region', { name: '证据目录' })
  const achievements = page.getByLabel('成果')
  await expect(achievements).toHaveValue('完成 P3-T5 全量门禁')

  await achievements.fill('完成 P3-T6 主流程')
  await expect(page.getByRole('status').filter({ hasText: /已保存 ·/ })).toBeVisible({ timeout: 4_000 })
  expect(calls.patches.at(-1)).toMatchObject({ achievements: ['完成 P3-T6 主流程'], version: 4 })
  await expect(evidenceRail).toContainText('6 / 8 完成')

  calls.setConflict(true)
  await achievements.fill('冲突时不能丢失的本地叙事')
  await expect(page.getByRole('alert', { name: '回顾保存冲突' })).toContainText('回顾已在其他位置更新', { timeout: 4_000 })
  await expect(evidenceRail).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('lifeops:record-draft:review:review-weekly'))).toContain('冲突时不能丢失')
  await page.getByRole('button', { name: '保留本地草稿' }).click()
  await expect(page.getByText('本地草稿已保留')).toBeVisible()

  const pending = page.getByRole('article', { name: /把本次回顾沉淀为知识草稿/ })
  await pending.getByLabel('转换去向').selectOption('knowledge')
  await pending.getByRole('button', { name: '转换行动' }).click()
  await expect(pending).toContainText('已转为知识草稿')
  await expect(pending.getByRole('link', { name: '打开转换结果' })).toHaveAttribute('href', '/app/knowledge?note=knowledge-review-p3-t6')
  await expect(pending.getByRole('button', { name: '转换行动' })).toHaveCount(0)
  expect(calls.conversions).toEqual([{ actionId: 'action-knowledge', body: { target: 'knowledge' } }])
})

test('review permission failure stays scoped and retryable', async ({ page }) => {
  await authenticatePreview(page)
  await routeReviews(page, 403)
  await page.goto('/app/reviews')
  await expect(page.getByRole('heading', { name: '回顾', level: 1 })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('你没有权限读取这些回顾')
  await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
  await expect(page.getByRole('region', { name: '证据目录' })).toHaveCount(0)
  await expect(page.getByText('还没有回顾草稿')).toHaveCount(0)
})

test('review reduced motion keeps controls immediate without changing semantics', async ({ page }) => {
  await authenticatePreview(page)
  await routeReviews(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/app/reviews?review=review-weekly&period=weekly')
  await expect(page.getByRole('region', { name: '证据目录' })).toBeVisible()
  const maximumTransition = await page.locator('.reviews-page').evaluate((root) => Math.max(...Array.from(root.querySelectorAll('*')).map((element) => Number.parseFloat(getComputedStyle(element).transitionDuration) || 0)))
  expect(maximumTransition).toBeLessThanOrEqual(.001)
})
