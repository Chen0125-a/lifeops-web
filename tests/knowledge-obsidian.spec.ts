import { expect, test, type Page, type Route } from '@playwright/test'

const session = { mode: 'local-preview', account: 'p4-t6-knowledge@lifeops.local' }
const timestamp = '2026-08-22T08:00:00.000Z'

type KnowledgeValue = ReturnType<typeof knowledgeNote>

function knowledgeNote(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    title: id,
    body: `# ${id}\n\n可追溯的知识正文。`,
    tags: ['LifeOps'],
    collectionIds: ['collection-work'],
    sourceLinks: [],
    relatedIds: [],
    pinned: false,
    favorite: false,
    reviewOn: null,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
    deletedAt: null,
    ...patch,
  }
}

function reviewValue() {
  return {
    id: 'review-source',
    type: 'weekly',
    period: { from: '2026-08-17', to: '2026-08-22' },
    status: 'draft',
    achievements: ['完成知识与发布边界核对'],
    problems: [],
    causes: [],
    insights: ['来源必须随知识保留'],
    nextChanges: ['把本次回顾沉淀为知识草稿'],
    evidence: {
      period: { from: '2026-08-17', to: '2026-08-22' },
      goals: { active: 1, completed: 0 },
      projects: { active: 1, completed: 0 },
      tasks: { total: 2, completed: 1, skipped: 0, cancelled: 0 },
      habits: { entries: 3, done: 2, partial: 1, intentionalSkips: 0 },
      records: { total: 1, ids: ['record-source'] },
      priorCommitments: [],
      hasFacts: true,
    },
    actions: [{
      id: 'action-derive',
      text: '把本次回顾沉淀为知识草稿',
      status: 'pending',
      convertedTarget: null,
      convertedId: null,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  }
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

interface ContentFixture {
  calls: {
    created: Array<Record<string, unknown>>
    updated: Array<Record<string, unknown>>
    relations: Array<Record<string, unknown>>
    converted: number
  }
  note(id: string): KnowledgeValue | undefined
}

async function authenticate(page: Page) {
  await page.addInitScript((value) => sessionStorage.setItem('lifeops:session:v1', JSON.stringify(value)), session)
}

async function installContentFixture(page: Page): Promise<ContentFixture> {
  let notes: KnowledgeValue[] = [
    knowledgeNote('note-related', {
      title: '关系图谱不是装饰',
      body: '# 关系图谱\n\n关系必须能回到真实来源。',
      tags: ['关系'],
    }),
  ]
  let review = reviewValue()
  let nextId = 1
  const calls = { created: [] as Array<Record<string, unknown>>, updated: [] as Array<Record<string, unknown>>, relations: [] as Array<Record<string, unknown>>, converted: 0 }

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()

    if (method === 'GET' && path === '/api/v1/settings') return json(route, {
      version: 1, updatedAt: timestamp,
      appearance: { theme: 'system', motion: 'system' },
      locale: { locale: 'zh-CN', timezone: 'Asia/Shanghai', weekStartsOn: 1 },
      defaults: { startRoute: '/app', quickCreateType: 'record' },
      life: { lowStockDays: 7, expiryWarningDays: 14, remindersEnabled: true },
      publicSite: { defaultVisibility: 'private', rssEnabled: true },
      connections: [{ id: 'obsidian', label: 'Obsidian', state: 'local-only', detail: '浏览器授权' }],
    })
    if (method === 'GET' && path === '/api/v1/account/sessions') return json(route, { sessions: [] })
    if (method === 'GET' && path === '/api/v1/audit') return json(route, { events: [] })

    if (method === 'GET' && path === '/api/v1/knowledge/collections') {
      return json(route, [{ id: 'collection-work', name: '工作', color: '#2E6F65', position: 1, version: 1 }])
    }
    if (method === 'GET' && path === '/api/v1/knowledge/resurface') {
      return json(route, notes.filter((note) => note.reviewOn === '2026-08-22' && note.deletedAt == null))
    }
    if (method === 'GET' && path === '/api/v1/knowledge') {
      const query = (url.searchParams.get('q') ?? '').trim().toLocaleLowerCase('zh-CN')
      const tag = url.searchParams.get('tag')
      const source = url.searchParams.get('source')
      const collectionId = url.searchParams.get('collectionId')
      const items = notes.filter((note) => {
        if (note.deletedAt != null) return false
        const haystack = `${note.title} ${note.body} ${note.tags.join(' ')}`.toLocaleLowerCase('zh-CN')
        return (!query || haystack.includes(query))
          && (!tag || note.tags.includes(tag))
          && (!source || note.sourceLinks.some((link: { type: string }) => link.type === source))
          && (!collectionId || note.collectionIds.includes(collectionId))
      })
      return json(route, { items })
    }
    if (method === 'POST' && path === '/api/v1/knowledge') {
      const body = request.postDataJSON() as Record<string, unknown>
      calls.created.push(body)
      const created = knowledgeNote(`note-created-${nextId++}`, {
        ...body,
        tags: body.tags ?? [],
        collectionIds: body.collectionIds ?? [],
        sourceLinks: body.sourceLinks ?? [],
        relatedIds: body.relatedIds ?? [],
        version: 1,
        updatedAt: '2026-08-22T09:00:00.000Z',
      })
      notes = [created, ...notes]
      return json(route, created, 201)
    }

    const item = path.match(/^\/api\/v1\/knowledge\/([^/]+)$/)
    if (item && method === 'GET') {
      const found = notes.find((note) => note.id === decodeURIComponent(item[1]) && note.deletedAt == null)
      return found ? json(route, found) : json(route, { error: { code: 'NOT_FOUND', message: '找不到知识' } }, 404)
    }
    if (item && method === 'PATCH') {
      const id = decodeURIComponent(item[1])
      const body = request.postDataJSON() as Record<string, unknown>
      calls.updated.push(body)
      const current = notes.find((note) => note.id === id)
      if (!current) return json(route, { error: { code: 'NOT_FOUND', message: '找不到知识' } }, 404)
      const updated = knowledgeNote(id, { ...current, ...body, version: Number(body.version) + 1, updatedAt: '2026-08-22T09:10:00.000Z' })
      notes = notes.map((note) => note.id === id ? updated : note)
      return json(route, updated)
    }
    if (item && method === 'DELETE') {
      const id = decodeURIComponent(item[1])
      const body = request.postDataJSON() as { version: number }
      notes = notes.map((note) => note.id === id ? knowledgeNote(id, { ...note, version: body.version + 1, deletedAt: '2026-08-22T09:20:00.000Z' }) : note)
      return route.fulfill({ status: 204, body: '' })
    }

    const archive = path.match(/^\/api\/v1\/knowledge\/([^/]+)\/archive$/)
    if (archive && method === 'POST') {
      const id = decodeURIComponent(archive[1])
      const body = request.postDataJSON() as { version: number }
      const current = notes.find((note) => note.id === id)
      if (!current) return json(route, { error: { code: 'NOT_FOUND', message: '找不到知识' } }, 404)
      const updated = knowledgeNote(id, { ...current, version: body.version + 1, archivedAt: '2026-08-22T09:15:00.000Z' })
      notes = notes.map((note) => note.id === id ? updated : note)
      return json(route, updated)
    }
    const restore = path.match(/^\/api\/v1\/knowledge\/([^/]+)\/restore$/)
    if (restore && method === 'POST') {
      const id = decodeURIComponent(restore[1])
      const body = request.postDataJSON() as { version: number }
      const current = notes.find((note) => note.id === id)
      if (!current) return json(route, { error: { code: 'NOT_FOUND', message: '找不到知识' } }, 404)
      const restored = knowledgeNote(id, { ...current, version: body.version + 1, deletedAt: null })
      notes = notes.map((note) => note.id === id ? restored : note)
      return json(route, restored)
    }
    const relation = path.match(/^\/api\/v1\/knowledge\/([^/]+)\/relations$/)
    if (relation && (method === 'POST' || method === 'DELETE')) {
      const id = decodeURIComponent(relation[1])
      const body = request.postDataJSON() as { relatedId: string; version: number }
      calls.relations.push({ method, ...body })
      const current = notes.find((note) => note.id === id)
      if (!current) return json(route, { error: { code: 'NOT_FOUND', message: '找不到知识' } }, 404)
      const relatedIds = method === 'POST'
        ? [...new Set([...current.relatedIds, body.relatedId])]
        : current.relatedIds.filter((relatedId: string) => relatedId !== body.relatedId)
      const updated = knowledgeNote(id, { ...current, relatedIds, version: body.version + 1 })
      notes = notes.map((note) => note.id === id ? updated : note)
      return json(route, updated)
    }

    if (method === 'GET' && path === '/api/v1/reviews') return json(route, [review])
    const conversion = path.match(/^\/api\/v1\/reviews\/review-source\/actions\/action-derive\/convert$/)
    if (conversion && method === 'POST') {
      calls.converted += 1
      const derived = knowledgeNote('note-derived', {
        title: '把本次回顾沉淀为知识草稿',
        body: '# 回顾结论\n\n来源随知识保留。',
        tags: ['回顾'],
        sourceLinks: [{ type: 'review', id: 'review-source' }],
        reviewOn: '2026-08-22',
      })
      notes = [derived, ...notes.filter((note) => note.id !== derived.id)]
      const converted = {
        ...review.actions[0],
        status: 'converted',
        convertedTarget: 'knowledge',
        convertedId: derived.id,
        version: 2,
      }
      review = { ...review, actions: [converted], version: 2 }
      return json(route, { review, action: converted, target: { type: 'knowledge', id: derived.id, title: derived.title } }, 201)
    }
    if (method === 'GET' && path === '/api/v1/state') {
      return json(route, { schemaVersion: 1, plans: [], records: [], reviews: [], knowledge: [], snapshots: [] })
    }
    return json(route, {})
  })

  return { calls, note: (id) => notes.find((note) => note.id === id) }
}

function frontmatter(body: string) {
  return `---\nlifeops_id: "note-related"\ntype: "knowledge"\ntags:\n  - "关系"\nsource: null\nupdated_at: "2026-08-22T08:00:00.000Z"\nsync_revision: 1\ntitle: "Obsidian 冲突标题"\n---\n${body}`
}

async function installDirectoryFixture(page: Page, permission: 'granted' | 'denied') {
  await page.addInitScript(({ selectedPermission, markdown }) => {
    const values = window as unknown as Record<string, unknown>
    const encoder = new TextEncoder()
    const files = new Map<string, Uint8Array>([['LifeOps/Knowledge/note-related.md', encoder.encode(markdown)]])
    const directories = new Set(['', 'LifeOps', 'LifeOps/Knowledge'])
    const events: Array<{ kind: string; path: string }> = []
    values.__lifeopsObsidianEvents = events

    const notFound = () => new DOMException('Not found', 'NotFoundError')
    const join = (base: string, name: string) => base ? `${base}/${name}` : name
    const fileHandle = (path: string) => ({
      kind: 'file' as const,
      name: path.split('/').at(-1) ?? path,
      getFile: async () => {
        const bytes = files.get(path)
        if (!bytes) throw notFound()
        return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
      },
      createWritable: async () => {
        let next = new Uint8Array()
        return {
          write: async (bytes: Uint8Array) => { next = new Uint8Array(bytes); events.push({ kind: 'write', path }) },
          close: async () => { files.set(path, next) },
        }
      },
      move: async (destination: ReturnType<typeof directoryHandle>, name: string) => {
        const target = join(destination.__path, name)
        const bytes = files.get(path)
        if (!bytes) throw notFound()
        files.set(target, bytes)
        files.delete(path)
        events.push({ kind: 'replace', path: target })
      },
    })
    function directoryHandle(path: string) {
      return {
        __path: path,
        kind: 'directory' as const,
        name: path.split('/').at(-1) || 'Life vault',
        queryPermission: async () => selectedPermission,
        getDirectoryHandle: async (name: string, options?: { create?: boolean }) => {
          const target = join(path, name)
          if (!directories.has(target)) {
            if (!options?.create) throw notFound()
            directories.add(target)
            events.push({ kind: 'mkdir', path: target })
          }
          return directoryHandle(target)
        },
        getFileHandle: async (name: string, options?: { create?: boolean }) => {
          const target = join(path, name)
          if (!files.has(target) && !options?.create) throw notFound()
          if (!files.has(target)) files.set(target, new Uint8Array())
          return fileHandle(target)
        },
        values: async function* () {
          const prefix = path ? `${path}/` : ''
          for (const [candidate] of files) {
            if (!candidate.startsWith(prefix)) continue
            const remainder = candidate.slice(prefix.length)
            if (remainder && !remainder.includes('/')) yield fileHandle(candidate)
          }
        },
        removeEntry: async (name: string) => {
          const target = join(path, name)
          if (!files.delete(target)) throw notFound()
        },
      }
    }
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => directoryHandle(''),
    })
  }, { selectedPermission: permission, markdown: frontmatter('# Obsidian 版本\n\n这份内容与 Web 同版本但正文不同。') })
}

test.beforeEach(async ({ page }) => {
  await authenticate(page)
})

test('knowledge journey derives from a review, creates and edits safe Markdown, searches, relates, resurfaces, archives and restores', async ({ page }) => {
  const fixture = await installContentFixture(page)
  await page.goto('/app/reviews?review=review-source&period=weekly')
  const action = page.getByRole('article', { name: '行动 · 把本次回顾沉淀为知识草稿' })
  await action.getByLabel('转换去向').selectOption('knowledge')
  await action.getByRole('button', { name: '转换行动' }).click()
  await action.getByRole('link', { name: '打开转换结果' }).click()
  await expect(page).toHaveURL(/\/app\/knowledge\?note=note-derived/)
  await expect(page.getByRole('button', { name: '来源 回顾 review-source' })).toBeVisible()
  await expect(page.getByRole('region', { name: '今天重现' })).toContainText('把本次回顾沉淀为知识草稿')
  expect(fixture.calls.converted).toBe(1)

  await page.getByRole('button', { name: '新建知识' }).click()
  await page.getByLabel('知识标题').fill('安全 Markdown 与关系')
  await page.getByLabel('Markdown 正文').fill('<script>window.__lifeopsXss = true</script>\n\n<img src=x onerror="window.__lifeopsXss = true">\n\n**安全正文**')
  await page.getByRole('textbox', { name: '标签', exact: true }).fill('安全，关系')
  await page.getByLabel('复习日期', { exact: true }).fill('2026-08-22')
  await page.getByRole('button', { name: '创建知识' }).click()
  await expect(page).toHaveURL(/note=note-created-1/)
  await expect(page.getByText('安全正文', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__lifeopsXss ?? false)).toBe(false)
  await expect(page.locator('script').filter({ hasText: '__lifeopsXss' })).toHaveCount(0)

  await page.getByRole('button', { name: '编辑知识' }).click()
  await page.getByLabel('知识标题').fill('安全 Markdown 与关系 · 已编辑')
  await page.getByLabel('复习日期', { exact: true }).fill('2026-08-22')
  await expect(page.getByRole('status').filter({ hasText: /已保存 ·/ })).toBeVisible({ timeout: 4_000 })
  await page.getByLabel('添加相关知识').selectOption('note-derived')
  await page.getByRole('button', { name: '建立知识关系' }).click()
  await expect(page.getByRole('button', { name: '相关知识 把本次回顾沉淀为知识草稿' })).toBeVisible()
  expect(fixture.calls.relations.at(-1)).toMatchObject({ method: 'POST', relatedId: 'note-derived' })

  await page.getByRole('button', { name: '阅读知识' }).click()
  await page.getByRole('searchbox', { name: '搜索知识' }).fill('已编辑')
  await expect(page.getByRole('button', { name: '知识 安全 Markdown 与关系 · 已编辑' })).toBeVisible()
  await expect(page.getByRole('button', { name: '知识 关系图谱不是装饰' })).toHaveCount(0)
  await page.getByRole('searchbox', { name: '搜索知识' }).fill('')
  await page.getByRole('button', { name: '知识 安全 Markdown 与关系 · 已编辑' }).click()

  await page.getByRole('button', { name: '归档知识' }).click()
  await expect(page.getByRole('button', { name: '已归档' })).toBeVisible()
  await page.getByRole('button', { name: '删除知识' }).click()
  await expect(page.locator('.knowledge-undo')).toContainText('已删除“安全 Markdown 与关系 · 已编辑”')
  await page.getByRole('button', { name: '恢复刚删除的知识' }).click()
  await expect(page).toHaveURL(/note=note-created-1/)
  await expect(page.getByRole('heading', { name: '安全 Markdown 与关系 · 已编辑', level: 2 })).toBeVisible()
  expect(fixture.note('note-created-1')?.deletedAt).toBeNull()
})

test('Obsidian settings route exposes the unsupported ZIP fallback without claiming a connection', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined }))
  await installContentFixture(page)
  await page.goto('/app/settings')
  await expect(page.getByRole('heading', { name: '账户与设置', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Obsidian' }).click()
  await expect(page.getByRole('heading', { name: 'Obsidian 人工同步' })).toBeVisible()
  await expect(page.getByText(/浏览器不支持文件夹连接/)).toBeVisible()
  await expect(page.getByRole('button', { name: '导出 ZIP' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Life Obsidian 知识副本' })).toHaveCount(0)
  await expect(page.getByText(/已连接/)).toHaveCount(0)
})

test('Obsidian settings refuses denied permission and never records a false connected state', async ({ page }) => {
  await installDirectoryFixture(page, 'denied')
  await installContentFixture(page)
  await page.goto('/app/settings')
  await page.getByRole('button', { name: 'Obsidian' }).click()
  await page.getByRole('button', { name: '连接文件夹' }).click()
  await expect(page.getByRole('alert')).toContainText(/权限.*拒绝/)
  await expect(page.getByText(/已连接/)).toHaveCount(0)
})

test('Obsidian first scan is read-only, conflicts require an explicit choice, apply backs up first and never proposes deletion', async ({ page }) => {
  await installDirectoryFixture(page, 'granted')
  await installContentFixture(page)
  await page.goto('/app/settings')
  await page.getByRole('button', { name: 'Obsidian' }).click()
  await page.getByRole('button', { name: '连接文件夹' }).click()
  await expect(page.getByText('已连接 · Life vault')).toBeVisible()
  await expect(page.getByText(/\d+ 项 · 1 个冲突/)).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { __lifeopsObsidianEvents: unknown[] }).__lifeopsObsidianEvents)).toEqual([])
  await expect(page.getByText(/delete|删除同步/i)).toHaveCount(0)

  const conflict = page.getByRole('group', { name: 'note-related 冲突处理' })
  await expect(conflict.getByRole('button', { name: '保留 Web 版本' })).toBeVisible()
  await expect(conflict.getByRole('button', { name: '采用 Obsidian 版本' })).toBeVisible()
  await expect(conflict.getByRole('button', { name: '保留两份副本' })).toBeVisible()
  await expect(page.getByRole('button', { name: '确认并应用' })).toBeDisabled()
  await conflict.getByRole('button', { name: '保留 Web 版本' }).click()
  await page.getByRole('button', { name: '确认并应用' }).click()

  const events = await page.evaluate(() => (window as unknown as { __lifeopsObsidianEvents: Array<{ kind: string; path: string }> }).__lifeopsObsidianEvents)
  const backupIndex = events.findIndex((event) => event.kind === 'mkdir' && event.path.includes('.lifeops-backup'))
  const contentWriteIndex = events.findIndex((event) => event.kind === 'write' && event.path === 'LifeOps/Knowledge/note-related.md.lifeops-tmp')
  expect(backupIndex).toBeGreaterThanOrEqual(0)
  expect(contentWriteIndex).toBeGreaterThan(backupIndex)
})
