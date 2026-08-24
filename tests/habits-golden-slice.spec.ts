import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page, type Route } from '@playwright/test'

const evidenceDir = resolve('outputs/evidence/browser/p3-t4')
const session = { mode: 'local-preview', account: 'habits-e2e@lifeops.local' }

const habit = (id: string, patch: Record<string, unknown> = {}) => ({
  id, goalId: 'goal-reading', projectId: 'project-lifeops', title: id, description: '', measure: 'duration',
  unit: '分钟', targetValue: 30, status: 'active', pausedAt: null, timezone: 'Asia/Shanghai',
  schedule: { scheduleType: 'daily', startsOn: '2026-08-01', endsOn: null }, version: 2,
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z', deletedAt: null, ...patch,
})

const habits = [
  habit('habit-reading', { title: '阅读' }),
  habit('habit-meditation', { title: '冥想', measure: 'boolean', unit: null, targetValue: 1 }),
  habit('habit-pushups', { title: '俯卧撑', measure: 'count', unit: '次', targetValue: 20 }),
  habit('habit-water', { title: '饮水', measure: 'quantity', unit: '毫升', targetValue: 2000 }),
  habit('habit-strength', { title: '力量训练', measure: 'boolean', unit: null, targetValue: 1, schedule: { scheduleType: 'weekdays', weekdays: [1, 3, 5], startsOn: '2026-08-01', endsOn: null } }),
]
const entries = [
  { id: 'entry-done', habitId: 'habit-reading', entryDate: '2026-08-09', status: 'done', value: 30, note: '', version: 1, createdAt: '2026-08-09T12:00:00.000Z', updatedAt: '2026-08-09T12:00:00.000Z', deletedAt: null },
  { id: 'entry-partial', habitId: 'habit-reading', entryDate: '2026-08-10', status: 'partial', value: 20, note: '', version: 1, createdAt: '2026-08-10T12:00:00.000Z', updatedAt: '2026-08-10T12:00:00.000Z', deletedAt: null },
  { id: 'entry-skip', habitId: 'habit-reading', entryDate: '2026-08-11', status: 'intentional-skip', value: null, note: '主动恢复', version: 1, createdAt: '2026-08-11T12:00:00.000Z', updatedAt: '2026-08-11T12:00:00.000Z', deletedAt: null },
]

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function authenticatePreview(page: Page) {
  await page.addInitScript((value) => sessionStorage.setItem('lifeops:session:v1', JSON.stringify(value)), session)
}

interface HabitCalls {
  entryWrites: Array<{ path: string; body: Record<string, unknown> }>
  habitWrites: Array<{ path: string; body: Record<string, unknown> }>
}

async function routeHabits(page: Page, mode: 'ok' | 'forbidden' | 'conflict' = 'ok'): Promise<HabitCalls> {
  const calls: HabitCalls = { entryWrites: [], habitWrites: [] }
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname === '/api/v1/habits') {
      if (mode === 'forbidden') return json(route, { error: { code: 'FORBIDDEN', message: 'Forbidden' } }, 403)
      return json(route, { from: url.searchParams.get('from'), to: url.searchParams.get('to'), habits, entries })
    }
    if (request.method() === 'PUT' && /\/api\/v1\/habits\/[^/]+\/entries\/.+/.test(url.pathname)) {
      const body = request.postDataJSON() as Record<string, unknown>
      calls.entryWrites.push({ path: url.pathname, body })
      if (mode === 'conflict') return json(route, { error: { code: 'VERSION_CONFLICT', message: '习惯记录已更新' } }, 409)
      const segments = url.pathname.split('/')
      const habitId = decodeURIComponent(segments[4])
      const entryDate = decodeURIComponent(segments[6])
      return json(route, { id: `entry-${habitId}-${entryDate}`, habitId, entryDate, ...body, value: body.value ?? null, note: body.note ?? '', version: Number(body.version ?? 0) + 1, createdAt: `${entryDate}T12:00:00.000Z`, updatedAt: `${entryDate}T12:00:00.000Z`, deletedAt: null })
    }
    if (request.method() === 'PATCH' && url.pathname.startsWith('/api/v1/habits/')) {
      const body = request.postDataJSON() as Record<string, unknown>
      calls.habitWrites.push({ path: url.pathname, body })
      const id = decodeURIComponent(url.pathname.split('/').at(-1) ?? '')
      const original = habits.find((item) => item.id === id) ?? habits[0]
      return json(route, { ...original, ...body, version: Number(body.version) + 1 })
    }
    return json(route, {})
  })
  return calls
}

test.use({ trace: 'off' })
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-08-15T12:00:00.000Z'))
})

test('habit rhythm passes responsive, keyboard, entry and history acceptance', async ({ page, context }) => {
  mkdirSync(evidenceDir, { recursive: true })
  await authenticatePreview(page)
  const calls = await routeHabits(page)
  await context.tracing.start({ screenshots: true, snapshots: true })
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/app/habits?habit=habit-reading')
    await expect(page.getByRole('heading', { name: '习惯', level: 1 })).toBeVisible()
    await expect(page.getByRole('grid', { name: '28 日习惯节奏' })).toHaveAttribute('data-days', '28')
    await expect(page.getByRole('button', { name: '阅读，8月10日，部分完成 20/30 分钟' })).toBeVisible()
    await expect(page.getByRole('button', { name: '力量训练，8月15日，非计划日' })).toBeVisible()
    await expect(page.locator('body')).not.toContainText(/徽章|火焰|金币|badge|flame|coin/i)

    for (const viewport of [
      { width: 1440, height: 900, name: 'habits-1440x900.png' },
      { width: 1024, height: 768, name: 'habits-1024x768.png' },
      { width: 768, height: 1024, name: 'habits-768x1024.png' },
      { width: 390, height: 844, name: 'habits-390x844.png' },
      { width: 320, height: 900, name: 'habits-320x900-reflow.png' },
    ]) {
      await page.setViewportSize(viewport)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${viewport.width} CSS px`).toBe(true)
      await page.screenshot({ path: resolve(evidenceDir, viewport.name), fullPage: true })
    }

    await page.setViewportSize({ width: 390, height: 844 })
    const grid = page.getByRole('grid', { name: '28 日习惯节奏' })
    expect(await grid.locator('button:visible').count()).toBe(35)
    const compactGeometry = await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('.habit-matrix-scroll')
      const create = document.querySelector<HTMLButtonElement>('.habits-page__create')
      const firstDate = document.querySelector<HTMLElement>(".habit-matrix__date[data-mobile-visible='true']")
      const firstCell = document.querySelector<HTMLElement>(".habit-matrix__cell[data-mobile-visible='true']")
      if (!scroller || !create || !firstDate || !firstCell || !create.firstChild) return null
      const scrollerRect = scroller.getBoundingClientRect()
      const createRect = create.getBoundingClientRect()
      const textRange = document.createRange()
      textRange.selectNodeContents(create.firstChild)
      const textRect = textRange.getBoundingClientRect()
      const firstDateRect = firstDate.getBoundingClientRect()
      const firstCellRect = firstCell.getBoundingClientRect()
      const visibleInlinePixels = (item: DOMRect) => Math.max(0, Math.min(item.right, scrollerRect.right) - Math.max(item.left, scrollerRect.left))
      return {
        visibleDates: Array.from(document.querySelectorAll<HTMLElement>(".habit-matrix__date[data-mobile-visible='true']")).filter((element) => getComputedStyle(element).display !== 'none').length,
        firstDateFullyReadable: visibleInlinePixels(firstDateRect) >= 40,
        firstCellFullyReachable: visibleInlinePixels(firstCellRect) >= 40,
        createContained: createRect.left >= 0 && createRect.right <= window.innerWidth,
        createTextCentered: Math.abs((textRect.left + textRect.right) / 2 - (createRect.left + createRect.right) / 2) <= 2,
      }
    })
    expect(compactGeometry).toEqual({ visibleDates: 7, firstDateFullyReadable: true, firstCellFullyReachable: true, createContained: true, createTextCentered: true })
    await page.getByRole('button', { name: '查看完整 28 日' }).click()
    expect(await grid.locator('button:visible').count()).toBe(140)

    await page.setViewportSize({ width: 1440, height: 900 })
    const meditation = page.getByRole('button', { name: '冥想，8月15日，未完成' })
    await meditation.focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => calls.entryWrites.some((call) => call.path.endsWith('/habit-meditation/entries/2026-08-15'))).toBe(true)

    await page.getByRole('button', { name: '饮水，8月15日，未完成' }).click()
    await expect(page).toHaveURL(/habit=habit-water/)
    await page.goBack()
    await expect(page).toHaveURL(/habit=habit-meditation/)
    await page.goBack()
    await expect(page).toHaveURL(/habit=habit-reading/)

    const edit = page.getByRole('button', { name: '编辑习惯' })
    await edit.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: '编辑习惯' }).getByLabel('标题')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(edit).toBeFocused()
  } finally {
    await context.tracing.stop({ path: resolve(evidenceDir, 'habits-responsive-keyboard-trace.zip') })
  }
})

test('habit permission failure is scoped and retryable', async ({ page }) => {
  await authenticatePreview(page)
  await routeHabits(page, 'forbidden')
  await page.goto('/app/habits')
  await expect(page.getByRole('alert')).toContainText('你没有访问这些习惯的权限')
  await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '习惯', level: 1 })).toBeVisible()
})

test('habit 409 stays local, preserves the matrix and exposes retry', async ({ page }) => {
  mkdirSync(evidenceDir, { recursive: true })
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))
  await authenticatePreview(page)
  await routeHabits(page, 'conflict')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/app/habits?habit=habit-meditation')
  await page.getByRole('button', { name: '冥想，8月15日，未完成' }).click()
  await expect(page.getByRole('alert')).toContainText('习惯已在其他位置更新')
  await expect(page.getByRole('grid', { name: '28 日习惯节奏' })).toBeVisible()
  await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
  expect(pageErrors).toEqual([])
  await page.screenshot({ path: resolve(evidenceDir, 'habits-1440x900-conflict.png'), fullPage: true })
})

test('habit reduced motion keeps controls immediate and semantics unchanged', async ({ page }) => {
  await authenticatePreview(page)
  await routeHabits(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/app/habits?habit=habit-reading')
  await expect(page.getByRole('grid', { name: '28 日习惯节奏' })).toBeVisible()
  const maximumTransition = await page.locator('.habits-page').evaluate((root) => Math.max(...Array.from(root.querySelectorAll('*')).map((element) => Number.parseFloat(getComputedStyle(element).transitionDuration) || 0)))
  expect(maximumTransition).toBeLessThanOrEqual(.001)
})
