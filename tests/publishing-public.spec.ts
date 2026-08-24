import { expect, test, type Page, type Route } from '@playwright/test'

const session = { mode: 'local-preview', account: 'p4-t6-publishing@lifeops.local' }
const privateSentinel = 'PRIVATE_SOURCE_BODY_MUST_NEVER_RENDER'
const timestamp = '2026-08-22T08:00:00.000Z'

type Value = Record<string, any>

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

function draft(id: string, patch: Value = {}): Value {
  return {
    id,
    category: 'learning',
    source: null,
    title: '未命名公开草稿',
    excerpt: '请在发布前完成公开摘要。',
    body: '请在发布前完成公开正文。',
    coverUrl: null,
    tags: [],
    slug: id,
    scheduledAt: null,
    featured: false,
    seo: { title: '未命名公开草稿', description: '请在发布前完成公开摘要。' },
    status: 'draft',
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...patch,
  }
}

function revisionFrom(value: Value, revision: number): Value {
  return {
    id: `revision-${value.id}-${revision}`,
    draftId: value.id,
    sourceVersion: value.version,
    revision,
    category: value.category,
    slug: value.slug,
    title: value.title,
    excerpt: value.excerpt,
    body: value.body,
    coverUrl: value.coverUrl,
    tags: value.tags,
    featured: value.featured,
    seo: value.seo,
    publishedAt: new Date(Date.parse(timestamp) + revision * 60_000).toISOString(),
    updatedAt: value.updatedAt,
  }
}

function publicView(value: Value) {
  return {
    body: value.body,
    category: value.category,
    coverUrl: value.coverUrl,
    excerpt: value.excerpt,
    featured: value.featured,
    publishedAt: value.publishedAt,
    revision: value.revision,
    slug: value.slug,
    tags: value.tags,
    title: value.title,
    updatedAt: value.updatedAt,
  }
}

interface PublishingFixture {
  calls: {
    creates: Value[]
    updates: Value[]
    schedules: Value[]
    publishes: Value[]
    revokes: Value[]
  }
  advanceTo(iso: string): void
  draft(id: string): Value | undefined
}

async function installPublishingFixture(page: Page): Promise<PublishingFixture> {
  let drafts: Value[] = []
  const revisions = new Map<string, Value[]>()
  let nextId = 1
  let controlledNow = new Date(timestamp).getTime()
  const calls = { creates: [] as Value[], updates: [] as Value[], schedules: [] as Value[], publishes: [] as Value[], revokes: [] as Value[] }

  const publishDue = () => {
    drafts = drafts.map((current) => {
      if (current.status !== 'scheduled' || !current.scheduledAt || Date.parse(current.scheduledAt) > controlledNow) return current
      const history = revisions.get(current.id) ?? []
      const published = revisionFrom(current, history.length + 1)
      revisions.set(current.id, [published, ...history])
      return { ...current, status: 'published', scheduledAt: null, version: current.version + 1, updatedAt: new Date(controlledNow).toISOString() }
    })
  }

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    publishDue()

    if (method === 'GET' && path === '/api/v1/state') {
      return json(route, {
        schemaVersion: 1,
        plans: [{ id: 'plan-source', title: '发布计划来源', updatedAt: timestamp }],
        records: [], reviews: [], knowledge: [], snapshots: [],
      })
    }
    if (method === 'GET' && path === '/api/v1/records') {
      return json(route, [{
        id: 'record-source', title: '记录来源', body: privateSentinel, occurredAt: timestamp, tags: [], pinned: false,
        archivedAt: null, links: [], mediaIds: [], coverMediaId: null, version: 1, createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
      }])
    }
    if (method === 'GET' && path === '/api/v1/reviews') {
      return json(route, [{ id: 'review-source', period: { from: '2026-08-17', to: '2026-08-22' }, updatedAt: timestamp, deletedAt: null }])
    }
    if (method === 'GET' && path === '/api/v1/knowledge') {
      return json(route, { items: [{
        id: 'knowledge-source', title: '发布边界知识', body: privateSentinel, tags: ['私人'], collectionIds: [], sourceLinks: [{ type: 'review', id: 'review-source' }], relatedIds: [],
        pinned: false, favorite: false, reviewOn: null, version: 7, createdAt: timestamp, updatedAt: timestamp, archivedAt: null, deletedAt: null,
      }] })
    }
    if (method === 'GET' && path === '/api/v1/publishing/drafts') return json(route, drafts)
    if (method === 'POST' && path === '/api/v1/publishing/drafts') {
      const body = request.postDataJSON() as Value
      calls.creates.push(body)
      const id = `draft-${nextId++}`
      const created = body.source
        ? draft(id, {
            category: body.category,
            source: { ...body.source, version: body.source.type === 'knowledge' ? 7 : 1 },
            title: body.source.type === 'knowledge' ? '发布边界知识 · 公开副本' : '来源公开副本',
            excerpt: '只复制明确允许公开的摘要。',
            body: '# 公开副本\n\n这里没有私人来源正文。',
            tags: ['公开'],
            slug: body.slug,
            seo: { title: '发布边界知识 · 公开副本', description: '只复制明确允许公开的摘要。' },
          })
        : draft(id, body)
      drafts = [created, ...drafts]
      return json(route, created, 201)
    }

    const diff = path.match(/^\/api\/v1\/publishing\/drafts\/([^/]+)\/revisions\/diff$/)
    if (diff && method === 'GET') {
      const id = decodeURIComponent(diff[1])
      const history = revisions.get(id) ?? []
      const from = Number(url.searchParams.get('from'))
      const to = Number(url.searchParams.get('to'))
      const before = history.find((entry) => entry.revision === from)
      const after = history.find((entry) => entry.revision === to)
      return json(route, {
        from,
        to,
        changed: before && after ? [{ field: 'title', before: before.title, after: after.title }] : [],
      })
    }
    const history = path.match(/^\/api\/v1\/publishing\/drafts\/([^/]+)\/revisions$/)
    if (history && method === 'GET') return json(route, revisions.get(decodeURIComponent(history[1])) ?? [])
    const action = path.match(/^\/api\/v1\/publishing\/drafts\/([^/]+)\/(preview|publish|schedule|revoke)$/)
    if (action && method === 'POST') {
      const id = decodeURIComponent(action[1])
      const kind = action[2]
      const current = drafts.find((entry) => entry.id === id)
      if (!current) return json(route, { error: { code: 'NOT_FOUND', message: '找不到公开草稿' } }, 404)
      if (kind === 'preview') return json(route, publicView({ ...current, publishedAt: current.updatedAt }))
      const body = (request.postDataJSON() ?? {}) as Value
      if (kind === 'publish') {
        calls.publishes.push(body)
        const existing = revisions.get(id) ?? []
        const published = revisionFrom(current, existing.length + 1)
        revisions.set(id, [published, ...existing])
        drafts = drafts.map((entry) => entry.id === id ? { ...entry, status: 'published', scheduledAt: null, version: entry.version + 1 } : entry)
        return json(route, { draftId: id, revisionId: published.id, revision: published.revision })
      }
      if (kind === 'schedule') {
        calls.schedules.push(body)
        const scheduled = { ...current, status: 'scheduled', scheduledAt: body.scheduledAt, version: current.version + 1 }
        drafts = drafts.map((entry) => entry.id === id ? scheduled : entry)
        return json(route, scheduled)
      }
      calls.revokes.push(body)
      const revoked = { ...current, status: 'revoked', scheduledAt: null, version: current.version + 1 }
      drafts = drafts.map((entry) => entry.id === id ? revoked : entry)
      return json(route, revoked)
    }
    const item = path.match(/^\/api\/v1\/publishing\/drafts\/([^/]+)$/)
    if (item && method === 'PATCH') {
      const id = decodeURIComponent(item[1])
      const body = request.postDataJSON() as Value
      calls.updates.push(body)
      const current = drafts.find((entry) => entry.id === id)
      if (!current) return json(route, { error: { code: 'NOT_FOUND', message: '找不到公开草稿' } }, 404)
      const updated = { ...current, ...body, version: Number(body.version) + 1, updatedAt: '2026-08-22T09:00:00.000Z' }
      drafts = drafts.map((entry) => entry.id === id ? updated : entry)
      return json(route, updated)
    }

    if (method === 'GET' && path === '/api/v1/public/content') {
      const category = url.searchParams.get('category')
      const items = drafts
        .filter((entry) => entry.status === 'published' && entry.category === category)
        .flatMap((entry) => (revisions.get(entry.id) ?? []).slice(0, 1))
        .map((entry) => ({ id: entry.id, slug: entry.slug, category: entry.category, title: entry.title, excerpt: entry.excerpt, coverUrl: entry.coverUrl, publishedAt: entry.publishedAt, featured: entry.featured, revision: entry.revision }))
      return json(route, items)
    }
    const publicItem = path.match(/^\/api\/v1\/public\/content\/([^/]+)$/)
    if (publicItem && method === 'GET') {
      const slug = decodeURIComponent(publicItem[1])
      const owner = drafts.find((entry) => entry.slug === slug && entry.status === 'published')
      const value = owner ? (revisions.get(owner.id) ?? [])[0] : undefined
      return value ? json(route, publicView(value)) : json(route, { error: { code: 'NOT_FOUND', message: '找不到公开内容' } }, 404)
    }
    if (method === 'GET' && path === '/api/v1/public/feed.xml') {
      const items = drafts.filter((entry) => entry.status === 'published').flatMap((entry) => (revisions.get(entry.id) ?? []).slice(0, 1))
      const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>LifeOps</title>${items.map((entry) => `<item><title>${entry.title}</title><link>http://127.0.0.1:4193/p/${entry.slug}</link></item>`).join('')}</channel></rss>`
      return route.fulfill({ status: 200, contentType: 'application/rss+xml', body: xml })
    }
    return json(route, {})
  })

  return {
    calls,
    advanceTo: (iso) => { controlledNow = Date.parse(iso); publishDue() },
    draft: (id) => drafts.find((entry) => entry.id === id),
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((value) => sessionStorage.setItem('lifeops:session:v1', JSON.stringify(value)), session)
  await page.clock.setFixedTime(new Date('2026-08-22T08:00:00.000Z'))
})

test('publishing journey copies a source, keeps preview live, gates privacy, versions public content, schedules, revokes and keeps RSS private-safe', async ({ page }) => {
  const fixture = await installPublishingFixture(page)
  await page.goto('/app/publish?status=draft')
  await page.getByRole('button', { name: '知识 · 发布边界知识' }).click()
  await expect(page).toHaveURL(/draft=draft-1/)
  await expect(page.getByLabel('公开标题')).toHaveValue('发布边界知识 · 公开副本')
  await expect(page.locator('body')).not.toContainText(privateSentinel)
  expect(fixture.calls.creates[0]).toEqual({ category: 'now', slug: 'knowledge-knowledge-source', source: { type: 'knowledge', id: 'knowledge-source' } })

  await page.getByLabel('公开分类').selectOption('learning')
  await page.getByLabel('公开标题').fill('公开副本 Revision 1')
  await page.getByLabel('公开摘要').fill('只包含经过人工选择的公开摘要。')
  await page.getByLabel('Markdown 正文').fill('# 公开正文\n\n第一版公开内容。')
  await expect(page.getByRole('region', { name: '公开内容预览' })).toContainText('公开副本 Revision 1')
  await page.getByRole('button', { name: '夜间预览' }).click()
  await expect(page.getByRole('region', { name: '公开内容预览' })).toHaveAttribute('data-preview-theme', 'night')
  await page.getByRole('button', { name: '移动端预览' }).click()
  await expect(page.getByRole('region', { name: '公开内容预览' })).toHaveAttribute('data-preview-device', 'mobile')
  await page.getByRole('button', { name: '保存公开草稿' }).click()
  await expect(page.getByText('版本 2', { exact: true })).toBeVisible()

  const publish = page.getByRole('button', { name: '立即发布' })
  await expect(publish).toBeDisabled()
  await page.getByLabel('我已确认公开字段').check()
  await publish.click()
  await expect(page.getByRole('tab', { name: /已发布 1/ })).toBeVisible()

  await page.goto('/learning')
  await expect(page.getByRole('navigation', { name: '公开内容索引' })).toContainText('公开副本 Revision 1')
  await page.getByRole('link', { name: '公开副本 Revision 1' }).last().click()
  await expect(page).toHaveURL('/p/knowledge-knowledge-source')
  await expect(page.getByRole('heading', { name: '公开副本 Revision 1', level: 1 })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('knowledge-source')
  await expect(page.locator('body')).not.toContainText(privateSentinel)

  await page.goto('/app/publish?status=published&draft=draft-1')
  await page.getByLabel('公开标题').fill('公开副本 Revision 2')
  await expect(page.getByLabel('我已确认公开字段')).not.toBeChecked()
  await page.getByRole('button', { name: '保存公开草稿' }).click()
  await expect(page.getByText('版本 4', { exact: true })).toBeVisible()
  await page.getByLabel('我已确认公开字段').check()
  await page.getByRole('button', { name: '立即发布' }).click()
  await expect(page.getByRole('region', { name: '公开 revision 历史' })).toContainText('Revision 2')
  await page.getByRole('button', { name: '比较 Revision 1 → 2' }).click()
  await expect(page.getByLabel('Revision 1 到 2 的差异')).toContainText('公开副本 Revision 1')
  await expect(page.getByLabel('Revision 1 到 2 的差异')).toContainText('公开副本 Revision 2')

  await page.getByRole('button', { name: '新建独立草稿' }).click()
  await expect(page).toHaveURL(/draft=draft-2/)
  await page.getByLabel('公开分类').selectOption('now')
  await page.getByLabel('公开标题').fill('受控时钟计划稿')
  await page.getByLabel('公开摘要').fill('到时才公开。')
  await page.getByLabel('Markdown 正文').fill('# 计划稿\n\n受控时钟到期后公开。')
  await page.getByLabel('公开 slug').fill('controlled-schedule')
  await page.getByRole('button', { name: '保存公开草稿' }).click()
  await expect(page.getByText('版本 2', { exact: true })).toBeVisible()
  await page.getByLabel('我已确认公开字段').check()
  await page.getByLabel('计划发布时间').fill('2026-08-23T10:00')
  await page.getByRole('button', { name: '计划发布' }).click()
  await expect(page.getByRole('tab', { name: /计划中 1/ })).toBeVisible()
  expect(fixture.calls.schedules).toHaveLength(1)

  fixture.advanceTo('2026-08-23T02:00:01.000Z')
  await page.clock.setFixedTime(new Date('2026-08-23T02:00:01.000Z'))
  await page.goto('/now')
  await expect(page.getByRole('navigation', { name: '公开内容索引' })).toContainText('受控时钟计划稿')

  await page.goto('/app/publish?status=published&draft=draft-1')
  await page.getByRole('button', { name: '撤回公开' }).click()
  await page.goto('/p/knowledge-knowledge-source')
  await expect(page.getByRole('heading', { name: '这份快照当前不可公开访问' })).toBeVisible()
  expect(fixture.calls.revokes).toHaveLength(1)

  const rss = await page.evaluate(() => fetch('/api/v1/public/feed.xml').then((response) => response.text()))
  expect(rss).toContain('受控时钟计划稿')
  expect(rss).not.toContain('公开副本 Revision 2')
  expect(rss).not.toContain(privateSentinel)
})
