import { expect, test, type Page, type Route } from '@playwright/test'

const session = { mode: 'local-preview', account: 'p3-t7-records-reviews@lifeops.local' }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XG62WQAAAABJRU5ErkJggg==', 'base64')

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function authenticate(page: Page) {
  await page.addInitScript((value) => sessionStorage.setItem('lifeops:session:v1', JSON.stringify(value)), session)
}

const record = (id: string, patch: Record<string, unknown> = {}) => ({
  id, title: '私人核心记录', body: '初始正文', occurredAt: '2026-08-21T01:00:00.000Z', tags: ['LifeOps'], pinned: false,
  archivedAt: null, links: [{ type: 'task', id: 'task-core' }], mediaIds: [], coverMediaId: null, version: 1,
  createdAt: '2026-08-21T01:00:00.000Z', updatedAt: '2026-08-21T01:00:00.000Z', deletedAt: null, ...patch,
})

async function routeRecords(page: Page) {
  let values = [record('record-core')]
  let deleted: ReturnType<typeof record> | null = null
  let mediaSequence = 0
  const calls: Array<{ method: string; path: string; body: Record<string, unknown> }> = []
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    if (method === 'GET' && path === '/api/v1/records') return json(route, values)
    if (method === 'GET' && path.startsWith('/api/v1/media/')) return route.fulfill({ status: 200, contentType: 'image/png', body: png })
    if (method === 'GET' && path === '/api/v1/state') return json(route, { schemaVersion: 1, plans: [], records: [], reviews: [], knowledge: [], snapshots: [] })
    if (method === 'POST' && path === '/api/v1/media') {
      mediaSequence += 1
      calls.push({ method, path, body: {} })
      return json(route, {
        id: `media-${mediaSequence}`, visibility: 'private', mimeType: 'image/png', originalName: 'proof.png', sizeBytes: png.length,
        checksum: 'A'.repeat(64), width: 1, height: 1, version: 1,
        createdAt: '2026-08-21T02:00:00.000Z', updatedAt: '2026-08-21T02:00:00.000Z', deletedAt: null,
      }, 201)
    }
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>
    calls.push({ method, path, body })
    if (method === 'POST' && path === '/api/v1/records') {
      const created = record('record-created', { ...body, version: 1, createdAt: '2026-08-21T02:00:00.000Z', updatedAt: '2026-08-21T02:00:00.000Z' })
      values = [created, ...values]
      return json(route, created, 201)
    }
    const item = path.match(/^\/api\/v1\/records\/([^/]+)$/)
    if (item && method === 'PATCH') {
      const id = decodeURIComponent(item[1])
      const current = values.find((value) => value.id === id)!
      const updated = {
        ...current,
        ...body,
        archivedAt: body.archived === true ? '2026-08-21T02:00:00.000Z' : body.archived === false ? null : current.archivedAt,
        version: Number(body.version) + 1,
        updatedAt: '2026-08-21T02:00:00.000Z',
      }
      values = values.map((value) => value.id === id ? updated : value)
      return json(route, updated)
    }
    if (item && method === 'DELETE') {
      const id = decodeURIComponent(item[1])
      const current = values.find((value) => value.id === id)!
      deleted = { ...current, version: Number(body.version) + 1, deletedAt: '2026-08-21T02:00:00.000Z' }
      values = values.filter((value) => value.id !== id)
      return route.fulfill({ status: 204 })
    }
    const restore = path.match(/^\/api\/v1\/records\/([^/]+)\/restore$/)
    if (restore && method === 'POST' && deleted) {
      const restored = { ...deleted, version: Number(body.version) + 1, deletedAt: null }
      values = [restored, ...values]
      deleted = null
      return json(route, restored)
    }
    return json(route, {})
  })
  return calls
}

test('record journey creates private media, autosaves edits and completes pin/archive/delete/same-ID restore', async ({ page }) => {
  await authenticate(page)
  const calls = await routeRecords(page)

  await page.goto('/app/records?create=record&source=task:task-core')
  const create = page.getByRole('region', { name: '记录编辑器' })
  await create.getByLabel('标题').fill('带证据的新记录')
  await create.getByLabel('Markdown 正文').fill('上传证据后创建。')
  await create.getByLabel('上传图片').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: png })
  await expect(create.getByText('上传完成')).toBeVisible()
  await create.getByRole('button', { name: '设为封面 proof.png' }).click()
  await create.getByRole('button', { name: '创建记录' }).click()
  await expect(page).toHaveURL(/record=record-created/)
  expect(calls.find((call) => call.method === 'POST' && call.path === '/api/v1/records')?.body).toMatchObject({
    title: '带证据的新记录', links: [{ type: 'task', id: 'task-core' }], mediaIds: ['media-1'], coverMediaId: 'media-1',
  })

  await page.goto('/app/records?record=record-core')
  const editor = page.getByRole('region', { name: '记录编辑器' })
  await editor.getByLabel('Markdown 正文').fill('800ms 后保存的真实正文。')
  await expect(editor.getByRole('status').filter({ hasText: /已保存 ·/ })).toBeVisible({ timeout: 4_000 })
  await editor.getByLabel('上传图片').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: png })
  await expect(editor.getByText('上传完成')).toBeVisible()
  await editor.getByRole('button', { name: '设为封面 proof.png' }).click()
  await expect.poll(() => calls.some((call) => call.method === 'PATCH' && call.body.coverMediaId === 'media-2')).toBe(true)

  await editor.getByRole('button', { name: '置顶记录' }).click()
  await expect(editor.getByRole('button', { name: '取消置顶' })).toBeVisible()
  await editor.getByRole('button', { name: '归档记录' }).click()
  await expect(editor.getByRole('button', { name: '取消归档' })).toBeVisible()
  await editor.getByRole('button', { name: '取消归档' }).click()
  await expect(editor.getByRole('button', { name: '归档记录' })).toBeVisible()

  await editor.getByRole('button', { name: '删除记录' }).click()
  await expect(page.locator('.records-undo')).toContainText('已删除“私人核心记录”')
  await page.getByRole('button', { name: '恢复刚删除的记录' }).click()
  await expect(page).toHaveURL(/record=record-core/)
  await expect(page.getByLabel('标题')).toHaveValue('私人核心记录')
  await expect.poll(() => calls.some((call) => call.method === 'POST' && call.path === '/api/v1/records/record-core/restore')).toBe(true)
})

const reviewEvidence = {
  period: { from: '2026-08-15', to: '2026-08-21' },
  goals: { active: 1, completed: 1 }, projects: { active: 1, completed: 0 },
  tasks: { total: 6, completed: 4, skipped: 1, cancelled: 0 },
  habits: { entries: 8, done: 5, partial: 2, intentionalSkips: 1 },
  records: { total: 2, ids: ['record-core', 'record-created'] },
  priorCommitments: [{ reviewId: 'review-prior', text: '完成私人核心 E2E', status: 'pending' }], hasFacts: true,
}
const reviewAction = (id: string, text: string) => ({
  id, text, status: 'pending', convertedTarget: null, convertedId: null, version: 1,
  createdAt: '2026-08-21T03:00:00.000Z', updatedAt: '2026-08-21T03:00:00.000Z',
})
const review = (id: string, patch: Record<string, unknown> = {}) => ({
  id, type: 'weekly', period: reviewEvidence.period, status: 'draft', achievements: ['已完成基础实现'], problems: ['缺少跨域锁定'],
  causes: ['尚未形成统一旅程'], insights: ['行为证据必须能重放'], nextChanges: ['完成 P3-T7'], evidence: reviewEvidence,
  actions: [
    reviewAction('action-task', '转为任务'),
    reviewAction('action-goal', '转为目标更新'),
    reviewAction('action-knowledge', '转为知识'),
    reviewAction('action-public', '转为公开草稿'),
  ],
  version: 1, createdAt: '2026-08-21T03:00:00.000Z', updatedAt: '2026-08-21T03:00:00.000Z', deletedAt: null, ...patch,
})

async function routeReviews(page: Page) {
  let values = [review('review-core')]
  let deleted: ReturnType<typeof review> | null = null
  const calls: Array<{ method: string; path: string; body: Record<string, unknown> }> = []
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    if (method === 'GET' && path === '/api/v1/reviews') return json(route, values)
    if (method === 'GET' && path === '/api/v1/state') return json(route, { schemaVersion: 1, plans: [], records: [], reviews: [], knowledge: [], snapshots: [] })
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>
    calls.push({ method, path, body })
    if (method === 'POST' && path === '/api/v1/reviews') {
      const created = review('review-created', { ...body, achievements: [], problems: [], causes: [], insights: [], nextChanges: [], actions: [], version: 1 })
      values = [created, ...values]
      return json(route, created, 201)
    }
    const item = path.match(/^\/api\/v1\/reviews\/([^/]+)$/)
    if (item && method === 'PATCH') {
      const id = decodeURIComponent(item[1])
      const current = values.find((value) => value.id === id)!
      const updated = { ...current, ...body, version: Number(body.version) + 1, updatedAt: '2026-08-21T04:00:00.000Z' }
      values = values.map((value) => value.id === id ? updated : value)
      return json(route, updated)
    }
    if (item && method === 'DELETE') {
      const id = decodeURIComponent(item[1])
      const current = values.find((value) => value.id === id)!
      deleted = { ...current, version: Number(body.version) + 1, deletedAt: '2026-08-21T04:00:00.000Z' }
      values = values.filter((value) => value.id !== id)
      return route.fulfill({ status: 204 })
    }
    const restore = path.match(/^\/api\/v1\/reviews\/([^/]+)\/restore$/)
    if (restore && method === 'POST' && deleted) {
      const restored = { ...deleted, version: Number(body.version) + 1, deletedAt: null }
      values = [restored, ...values]
      deleted = null
      return json(route, restored)
    }
    const refresh = path.match(/^\/api\/v1\/reviews\/([^/]+)\/refresh-evidence$/)
    if (refresh && method === 'POST') {
      const id = decodeURIComponent(refresh[1])
      const current = values.find((value) => value.id === id)!
      const updated = { ...current, version: Number(body.version) + 1, updatedAt: '2026-08-21T04:00:00.000Z' }
      values = values.map((value) => value.id === id ? updated : value)
      return json(route, updated)
    }
    const conversion = path.match(/^\/api\/v1\/reviews\/([^/]+)\/actions\/([^/]+)\/convert$/)
    if (conversion && method === 'POST') {
      const reviewId = decodeURIComponent(conversion[1])
      const actionId = decodeURIComponent(conversion[2])
      const current = values.find((value) => value.id === reviewId)!
      const currentAction = current.actions.find((action) => action.id === actionId)!
      const target = String(body.target)
      const converted = { ...currentAction, status: 'converted', convertedTarget: target, convertedId: `${target}-result`, version: 2, updatedAt: '2026-08-21T04:00:00.000Z' }
      const updated = { ...current, actions: current.actions.map((action) => action.id === actionId ? converted : action), version: current.version + 1 }
      values = values.map((value) => value.id === reviewId ? updated : value)
      return json(route, { review: updated, action: converted, target: { type: target, id: `${target}-result`, title: currentAction.text } })
    }
    return json(route, {})
  })
  return calls
}

test('review journey creates, autosaves five narratives, refreshes evidence, converts four destinations once and restores identity', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-08-21T12:00:00+08:00'))
  await authenticate(page)
  const calls = await routeReviews(page)
  await page.goto('/app/reviews?review=review-core&period=weekly')

  await page.getByRole('button', { name: '新建回顾' }).click()
  await expect.poll(() => calls.some((call) => call.method === 'POST' && call.path === '/api/v1/reviews')).toBe(true)
  await expect(page).toHaveURL(/review=review-created/)
  await page.goto('/app/reviews?review=review-core&period=weekly')

  const narratives = [
    ['成果', '完成私人核心全旅程'],
    ['问题', '跨域验收仍有失败'],
    ['原因', '新约束尚未全部落地'],
    ['洞察', '同一事实必须跨页面保持一致'],
    ['下一步变化', '修正真实失败后再做视觉收口'],
  ] as const
  const narrativeEditor = page.getByRole('region', { name: '叙事回顾' })
  for (const [label, value] of narratives) await narrativeEditor.getByLabel(label, { exact: true }).fill(value)
  await expect(page.getByRole('status').filter({ hasText: /已保存 ·/ })).toBeVisible({ timeout: 4_000 })
  expect(calls.filter((call) => call.method === 'PATCH' && call.path === '/api/v1/reviews/review-core').at(-1)?.body).toMatchObject({
    achievements: ['完成私人核心全旅程'], problems: ['跨域验收仍有失败'], causes: ['新约束尚未全部落地'],
    insights: ['同一事实必须跨页面保持一致'], nextChanges: ['修正真实失败后再做视觉收口'],
  })

  await page.getByRole('button', { name: '刷新证据' }).click()
  await expect.poll(() => calls.some((call) => call.path === '/api/v1/reviews/review-core/refresh-evidence')).toBe(true)

  const conversions = [
    { action: '转为任务', target: 'task', label: '任务' },
    { action: '转为目标更新', target: 'goal-update', label: '目标更新' },
    { action: '转为知识', target: 'knowledge', label: '知识草稿' },
    { action: '转为公开草稿', target: 'public-draft', label: '公开草稿' },
  ] as const
  for (const conversion of conversions) {
    const card = page.getByRole('article', { name: new RegExp(conversion.action) })
    await card.getByLabel('转换去向').selectOption(conversion.target)
    await card.getByRole('button', { name: '转换行动' }).click()
    await expect(card).toContainText(`已转为${conversion.label}`)
    await expect(card.getByRole('button', { name: '转换行动' })).toHaveCount(0)
  }
  expect(calls.filter((call) => call.path.endsWith('/convert')).map((call) => call.body.target)).toEqual(['task', 'goal-update', 'knowledge', 'public-draft'])

  await page.getByRole('button', { name: '归档回顾' }).click()
  await expect(page.getByRole('button', { name: '已归档' })).toBeVisible()
  await page.getByRole('button', { name: '删除回顾' }).click()
  await expect(page.locator('.reviews-undo')).toContainText('回顾已移到回收站')
  await page.getByRole('button', { name: '恢复刚删除的回顾' }).click()
  await expect(page).toHaveURL(/review=review-core/)
  await expect(page.getByLabel('成果')).toHaveValue('完成私人核心全旅程')
  await expect.poll(() => calls.some((call) => call.method === 'POST' && call.path === '/api/v1/reviews/review-core/restore')).toBe(true)
})
