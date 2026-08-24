import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page, type Route } from '@playwright/test'
import { strToU8, zipSync } from 'fflate'

const timestamp = '2026-08-22T08:00:00.000Z'
const session = { mode: 'local-preview', account: 'p4-t7-life-obsidian@lifeops.local' }
const evidenceDir = resolve('outputs/evidence/browser/p4-t7')

const recipe = {
  id: 'recipe-1', name: '番茄炒蛋', description: '家常做法', coverMediaId: null,
  prepMinutes: 8, cookMinutes: 6, difficulty: 'easy', categoryId: null, tagIds: ['家常'], storageNotes: '当天食用',
  entityVersion: 4,
  currentVersion: {
    id: 'recipe-version-4', recipeId: 'recipe-1', number: 4, servings: 2, yieldQuantity: null, yieldUnit: null,
    components: [{ id: 'component-1', itemId: 'tomato', quantity: 300, unit: 'gram', role: 'ingredient', position: 0 }],
    steps: [{ id: 'step-1', instruction: '低火炒熟', ingredientItemIds: ['tomato'], durationSeconds: 180, imageMediaId: null, caution: '避免飞溅', position: 0 }],
    promotedNote: null, createdAt: timestamp,
  },
  createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
}

const payload = {
  catalogItems: [],
  inventoryTransactions: [{ id: 'raw-inventory-transaction', idempotencyKey: 'never-in-markdown' }],
  recipes: [recipe],
  recipeVersions: [recipe.currentVersion],
  cookingSessions: [],
  fitnessActivities: [{
    id: 'fitness-1', name: '室内骑行', defaultMinutes: 35, kcalPerHour: 420, intensity: 'moderate',
    steps: ['热身'], equipment: ['单车'], entityVersion: 2, createdAt: timestamp, updatedAt: timestamp,
  }],
  shoppingItems: [{
    id: 'shopping-1', kind: 'formal', itemId: 'rice', requestedQuantity: 2, purchasedQuantity: 1, remainingQuantity: 1,
    unit: 'kg', neededOn: '2026-08-24', priority: 'high', storeGroup: '市场', status: 'partial', version: 3,
    createdAt: timestamp, updatedAt: timestamp,
  }],
  purchases: [], refunds: [],
  budgets: [{
    id: 'budget-1', name: '八月餐食', scope: { kind: 'all-life' }, period: { kind: 'monthly', startsOn: '2026-08-01', endsOn: '2026-08-31' },
    limitMinor: 120000, thresholds: [0.7, 0.9], rolloverMinor: 0, version: 2, createdAt: timestamp, updatedAt: timestamp,
  }],
}

const review = {
  id: 'review-1', type: 'weekly', period: { from: '2026-08-15', to: '2026-08-21' }, status: 'draft',
  achievements: ['保持记录'], problems: [], causes: [], insights: ['提前收尾'], nextChanges: ['22:30 停止工作'],
  evidence: {
    period: { from: '2026-08-15', to: '2026-08-21' }, goals: { active: 1, completed: 0 }, projects: { active: 1, completed: 0 },
    tasks: { total: 4, completed: 3, skipped: 0, cancelled: 0 }, habits: { entries: 5, done: 4, partial: 1, intentionalSkips: 0 },
    records: { total: 2, ids: ['record-private'] }, priorCommitments: [], hasFacts: true,
  },
  actions: [], version: 3, createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
}

const exportJob = {
  id: 'export-life-current', status: 'completed', reason: 'user-export', format: 'json', formatVersion: 1,
  checksumSha256: 'a'.repeat(64), recordCounts: { recipes: 1, fitnessActivities: 1, shoppingItems: 1, budgets: 1 },
  payload, canonicalJson: JSON.stringify(payload), createdAt: timestamp,
}

function recipeMarkdown(body = '# 番茄炒蛋\n\nObsidian 调整后的做法') {
  return `---\nlifeops_id: "recipe-1"\ntype: "recipe"\nversion: 4\nupdated_at: "${timestamp}"\ntitle: "番茄炒蛋"\ntags:\n  - "家常"\n---\n${body}`
}

function reviewMarkdown() {
  return `---\nlifeops_id: "review-1"\ntype: "life-review"\nversion: 3\nupdated_at: "${timestamp}"\ntitle: "2026-08-15 至 2026-08-21 生活回顾"\ntags:\n  - "生活回顾"\n  - "weekly"\n---\n# Obsidian 回顾修改`
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

interface LifeFixture {
  previews: Array<Record<string, unknown>>
}

async function installLifeApi(page: Page, options: { failFreshExport?: boolean } = {}): Promise<LifeFixture> {
  const previews: Array<Record<string, unknown>> = []
  await page.route('**/api/v1/**', (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'GET' && path === '/api/v1/life/exports') return json(route, [exportJob])
    if (request.method() === 'POST' && path === '/api/v1/life/exports') {
      if (options.failFreshExport) return route.abort('failed')
      return json(route, { ...exportJob, id: `export-life-fresh-${Date.now()}` }, 201)
    }
    if (request.method() === 'GET' && path === '/api/v1/reviews') return json(route, [review])
    if (request.method() === 'POST' && path === '/api/v1/life/imports/preview') {
      const body = request.postDataJSON() as Record<string, unknown>
      previews.push(body)
      const imported = JSON.parse(String(body.canonicalJson)) as Record<string, unknown>
      return json(route, { id: 'obsidian-import-draft-1', mode: 'merge', status: 'ready', payload: imported, conflicts: [], errors: [], createdAt: timestamp }, 201)
    }
    if (request.method() === 'GET' && path === '/api/v1/state') return json(route, { schemaVersion: 1, plans: [], records: [], reviews: [], knowledge: [], snapshots: [] })
    if (request.method() === 'GET') return json(route, [])
    return json(route, { error: { code: 'UNEXPECTED_WRITE', message: `${request.method()} ${path}` } }, 405)
  })
  return { previews }
}

async function authenticate(page: Page) {
  await page.addInitScript((value) => sessionStorage.setItem('lifeops:session:v1', JSON.stringify(value)), session)
}

async function installLifeDirectory(page: Page, options: { permission?: 'granted' | 'denied'; failWrites?: boolean } = {}) {
  await page.addInitScript(({ permission, markdown, reviewBody, failWrites }) => {
    const values = window as unknown as Record<string, unknown>
    const encoder = new TextEncoder()
    const files = new Map<string, Uint8Array>([
      ['LifeOps/Life/Recipes/recipe-1.md', encoder.encode(markdown)],
      ['LifeOps/Life/Reviews/review-1.md', encoder.encode(reviewBody)],
    ])
    const directories = new Set(['', 'LifeOps', 'LifeOps/Life', 'LifeOps/Life/Recipes', 'LifeOps/Life/Reviews'])
    const events: Array<{ kind: string; path: string }> = []
    values.__lifeObsidianEvents = events
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
          write: async (bytes: Uint8Array) => {
            events.push({ kind: 'write', path })
            if (failWrites) throw new DOMException('Disk unavailable', 'OperationError')
            next = new Uint8Array(bytes)
          },
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
        queryPermission: async () => permission,
        getDirectoryHandle: async (name: string, create?: { create?: boolean }) => {
          const target = join(path, name)
          if (!directories.has(target)) {
            if (!create?.create) throw notFound()
            directories.add(target)
            events.push({ kind: 'mkdir', path: target })
          }
          return directoryHandle(target)
        },
        getFileHandle: async (name: string, create?: { create?: boolean }) => {
          const target = join(path, name)
          if (!files.has(target) && !create?.create) throw notFound()
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
          events.push({ kind: 'remove', path: target })
          if (!files.delete(target)) throw notFound()
        },
      }
    }
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => directoryHandle('') })
  }, { permission: options.permission ?? 'granted', markdown: recipeMarkdown(), reviewBody: reviewMarkdown(), failWrites: options.failWrites ?? false })
}

test.beforeEach(async ({ page }) => authenticate(page))
test.beforeAll(() => mkdirSync(evidenceDir, { recursive: true }))

test('Life FSA round trip refreshes facts, previews first, requires recipe version intent and backs up before file writes', async ({ page }) => {
  const api = await installLifeApi(page)
  await installLifeDirectory(page)
  await page.goto('/app/life/data?section=obsidian')
  await expect(page.getByRole('heading', { name: 'Life Obsidian 知识副本' })).toBeVisible()
  await page.getByRole('button', { name: '连接并扫描' }).click()
  await expect(page.getByText('已连接 · Life vault')).toBeVisible()
  const preview = page.getByRole('region', { name: 'Life Obsidian 同步预览' })
  await expect(preview.getByText('首次连接只完成扫描与预览，尚未写入任何文件。')).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { __lifeObsidianEvents: unknown[] }).__lifeObsidianEvents)).toEqual([])
  await expect(preview.locator('pre').filter({ hasText: '# 番茄炒蛋' }).first()).toBeVisible()
  await expect(preview.locator('pre').filter({ hasText: 'Obsidian 调整后的做法' })).toBeVisible()
  await expect(preview.getByRole('radio', { name: '人工合并' })).toBeVisible()
  await expect(preview.getByRole('button', { name: '确认应用' })).toBeDisabled()
  await preview.getByRole('radio', { name: '创建新的配方版本' }).click()
  await preview.getByRole('radio', { name: '保留 Web 回顾' }).click()
  await preview.getByRole('button', { name: '确认应用' }).click()
  await expect(page.getByRole('status').filter({ hasText: '导入草稿 obsidian-import-draft-1 已生成' })).toBeVisible()

  expect(api.previews).toHaveLength(1)
  const canonical = JSON.parse(String(api.previews[0].canonicalJson)) as { obsidianProjectionDrafts: Array<{ action: string; markdown: string }> }
  expect(canonical.obsidianProjectionDrafts).toEqual([expect.objectContaining({ action: 'create-recipe-version' })])
  expect(canonical.obsidianProjectionDrafts[0].markdown).not.toContain('raw-inventory-transaction')
  expect(canonical.obsidianProjectionDrafts[0].markdown).not.toContain('never-in-markdown')
  const events = await page.evaluate(() => (window as unknown as { __lifeObsidianEvents: Array<{ kind: string; path: string }> }).__lifeObsidianEvents)
  const backupIndex = events.findIndex(({ kind, path }) => kind === 'mkdir' && path.includes('.lifeops-backup'))
  const contentWriteIndex = events.findIndex(({ kind, path }) => kind === 'write' && path.includes('LifeOps/Life/') && path.endsWith('.lifeops-tmp'))
  expect(backupIndex).toBeGreaterThanOrEqual(0)
  expect(contentWriteIndex).toBeGreaterThan(backupIndex)
  await expect(page.getByText(/delete|自动删除/i)).toHaveCount(0)
})

test('Life Obsidian denied permission never claims a connected state', async ({ page }) => {
  await installLifeApi(page)
  await installLifeDirectory(page, { permission: 'denied' })
  await page.goto('/app/life/data?section=obsidian')
  await page.getByRole('button', { name: '连接并扫描' }).click()
  await expect(page.getByRole('alert')).toContainText('权限未授予')
  await expect(page.getByText(/已连接/)).toHaveCount(0)
  await expect(page.getByText('降级状态 · 尚未连接')).toBeVisible()
})

test('Life Obsidian ZIP fallback remains preview-only and disables direct apply', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined }))
  await installLifeApi(page)
  await page.goto('/app/life/data?section=obsidian')
  await expect(page.getByText('当前浏览器不支持文件夹连接；可使用 ZIP 手动往返。')).toBeVisible()
  const bytes = zipSync({ 'LifeOps/Life/Recipes/recipe-1.md': strToU8(recipeMarkdown()) })
  await page.getByLabel('导入 Life Obsidian ZIP').setInputFiles({ name: 'life.zip', mimeType: 'application/zip', buffer: Buffer.from(bytes) })
  const preview = page.getByRole('region', { name: 'Life Obsidian 同步预览' })
  await expect(preview).toBeVisible()
  await expect(preview.getByRole('button', { name: '确认应用' })).toBeDisabled()
  await expect(page.getByText(/已连接/)).toHaveCount(0)
})

test('Life Obsidian write failure becomes degraded while the MySQL-backed data page remains operational', async ({ page }) => {
  await installLifeApi(page)
  await installLifeDirectory(page, { failWrites: true })
  await page.goto('/app/life/data?section=obsidian')
  await page.getByRole('button', { name: '连接并扫描' }).click()
  const preview = page.getByRole('region', { name: 'Life Obsidian 同步预览' })
  await preview.getByRole('radio', { name: '保留 Web 配方' }).click()
  await preview.getByRole('radio', { name: '保留 Web 回顾' }).click()
  await preview.getByRole('button', { name: '确认应用' }).click()
  await expect(page.getByRole('alert')).toContainText('Disk unavailable')
  await expect(page.getByText('降级状态 · 文件夹连接需复核')).toBeVisible()
  await page.getByRole('tab', { name: '导出' }).click()
  await expect(page.getByRole('region', { name: '导出清单' })).toContainText('export-life-fresh')
})

test('Life Obsidian conflict workspace passes responsive, keyboard, Back, zoom and reduced-motion acceptance', async ({ page }) => {
  const expectActiveLifeRouteVisible = async (label: string) => {
    const activeLifeRoute = await page.locator('.life-subnav').evaluate((navigation) => {
      const active = navigation.querySelector<HTMLElement>('[aria-current="page"]')
      if (!active) return { visible: false, scrollLeft: navigation.scrollLeft }
      const navigationBox = navigation.getBoundingClientRect()
      const activeBox = active.getBoundingClientRect()
      return {
        visible: activeBox.left >= navigationBox.left - 1 && activeBox.right <= navigationBox.right + 1,
        scrollLeft: navigation.scrollLeft,
      }
    })
    expect(activeLifeRoute.visible, `${label}: ${JSON.stringify(activeLifeRoute)}`).toBe(true)
  }

  await installLifeApi(page)
  await installLifeDirectory(page)
  await page.goto('/app/life/data?section=export')
  const obsidianTab = page.getByRole('tab', { name: 'Obsidian' })
  await obsidianTab.press('Enter')
  await expect(page).toHaveURL(/section=obsidian/)
  await page.getByRole('button', { name: '连接并扫描' }).click()
  await expect(page.getByRole('region', { name: 'Life Obsidian 同步预览' })).toBeVisible()

  for (const viewport of [
    { name: '1440x900', width: 1440, height: 900 },
    { name: '1024x768', width: 1024, height: 768 },
    { name: '768x1024', width: 768, height: 1024 },
    { name: '390x844', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.evaluate(() => { document.documentElement.style.zoom = '' })
    await page.evaluate(() => scrollTo(0, 0))
    const geometry = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      fits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    }))
    expect(geometry.fits, `${viewport.name}: ${JSON.stringify(geometry)}`).toBe(true)
    await expectActiveLifeRouteVisible(viewport.name)
    await page.screenshot({ path: resolve(evidenceDir, `life-obsidian-conflict-${viewport.name}.png`), fullPage: true })
  }

  await page.setViewportSize({ width: 320, height: 900 })
  await page.evaluate(() => scrollTo(0, 0))
  await expectActiveLifeRouteVisible('320x900')
  await page.screenshot({ path: resolve(evidenceDir, 'life-obsidian-conflict-320x900.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)

  await page.setViewportSize({ width: 640, height: 900 })
  await page.evaluate(() => { document.documentElement.style.zoom = '200%' })
  await page.evaluate(() => scrollTo(0, 0))
  await expectActiveLifeRouteVisible('200pct')
  await page.screenshot({ path: resolve(evidenceDir, 'life-obsidian-conflict-200pct.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
  await page.evaluate(() => { document.documentElement.style.zoom = '' })

  await page.getByRole('tab', { name: '导出' }).press('Enter')
  await expect(page).toHaveURL(/section=export/)
  await page.goBack()
  await expect(page).toHaveURL(/section=obsidian/)
  await expect(page.getByRole('heading', { name: '生活数据管理', level: 1 })).toBeFocused()

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  await page.getByRole('button', { name: '连接并扫描' }).click()
  const maximumMotion = await page.locator('.life-obsidian-panel').evaluate((root) => Math.max(0, ...Array.from(root.querySelectorAll('*')).map((element) => {
    const style = getComputedStyle(element)
    return Math.max(Number.parseFloat(style.animationDuration) || 0, Number.parseFloat(style.transitionDuration) || 0)
  })))
  expect(maximumMotion).toBeLessThanOrEqual(0.001)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => scrollTo(0, 0))
  await page.screenshot({ path: resolve(evidenceDir, 'life-obsidian-conflict-390x844-reduced-motion.png'), fullPage: true })
})

test('Life Obsidian offline refresh stays unconnected and preserves a bounded diagnostic', async ({ page }) => {
  await installLifeApi(page, { failFreshExport: true })
  await installLifeDirectory(page)
  await page.goto('/app/life/data?section=obsidian')
  await page.getByRole('button', { name: '连接并扫描' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByText(/已连接/)).toHaveCount(0)
  await expect(page.getByText('降级状态 · 尚未连接')).toBeVisible()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => scrollTo(0, 0))
  await page.screenshot({ path: resolve(evidenceDir, 'life-obsidian-offline-1440x900.png'), fullPage: true })
})
