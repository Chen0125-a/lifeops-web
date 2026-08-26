import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page, type Route } from '@playwright/test'
import { traceToPath } from './helpers/traceToPath'

const evidenceDir = resolve('outputs/evidence/browser/p3-t3')
const session = { mode: 'local-preview', account: 'schedule-e2e@lifeops.local' }

const task = (id: string, patch: Record<string, unknown> = {}) => ({
  id, goalId: null, projectId: 'project-alpha', milestoneId: null, title: id, description: '',
  startsAt: null, endsAt: null, dueAt: null, estimateMinutes: 45, priority: 2, tags: [], status: 'planned',
  checklist: [], recurrence: null, version: 4, createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z', completedAt: null, deletedAt: null, ...patch,
})

const tasks = [
  task('深度工作', { startsAt: '2026-08-15T09:00:00', endsAt: '2026-08-15T18:15:00' }),
  task('未排期任务'),
  task('临期整理', { dueAt: '2026-08-17T10:00:00' }),
  task('逾期复盘', { dueAt: '2026-08-14T10:00:00' }),
]
const blocks = [
  { id: 'block-deep', taskId: '深度工作', startsAt: '2026-08-15T09:00:00', endsAt: '2026-08-15T18:15:00', version: 2 },
  { id: 'block-due', taskId: '临期整理', startsAt: '2026-08-15T10:00:00', endsAt: '2026-08-15T11:00:00', version: 1 },
]
const conflicts = [{ leftId: 'block-deep', rightId: 'block-due', overlapMinutes: 60 }]

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function authenticatePreview(page: Page) {
  await page.addInitScript((value) => sessionStorage.setItem('lifeops:session:v1', JSON.stringify(value)), session)
}

interface ScheduleRoutes {
  createBodies: Array<Record<string, unknown>>
  patchBodies: Array<Record<string, unknown>>
  deletes: string[]
}

async function routeSchedule(page: Page, mode: 'ok' | 'conflict' | 'forbidden' = 'ok'): Promise<ScheduleRoutes> {
  const calls: ScheduleRoutes = { createBodies: [], patchBodies: [], deletes: [] }
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (mode === 'forbidden') return json(route, { error: { code: 'FORBIDDEN', message: 'Forbidden' } }, 403)
    if (request.method() === 'GET' && url.pathname === '/api/v1/tasks') return json(route, tasks)
    if (request.method() === 'GET' && url.pathname === '/api/v1/schedule-blocks') return json(route, blocks)
    if (request.method() === 'GET' && url.pathname === '/api/v1/schedule/conflicts') return json(route, conflicts)
    if (request.method() === 'POST' && url.pathname === '/api/v1/schedule-blocks') {
      const body = request.postDataJSON() as Record<string, unknown>
      calls.createBodies.push(body)
      if (mode === 'conflict') return json(route, { error: { code: 'VERSION_CONFLICT', message: '数据已经在另一处更新' } }, 409)
      return json(route, { id: 'block-new', ...body, version: 1 }, 201)
    }
    if (request.method() === 'PATCH' && url.pathname.startsWith('/api/v1/schedule-blocks/')) {
      const body = request.postDataJSON() as Record<string, unknown>
      calls.patchBodies.push(body)
      if (mode === 'conflict') return json(route, { error: { code: 'VERSION_CONFLICT', message: '数据已经在另一处更新' } }, 409)
      const original = blocks.find((block) => url.pathname.endsWith(block.id))!
      return json(route, { ...original, ...body, version: original.version + 1 })
    }
    if (request.method() === 'DELETE' && url.pathname.startsWith('/api/v1/schedule-blocks/')) {
      calls.deletes.push(url.pathname)
      return route.fulfill({ status: 204 })
    }
    return json(route, {})
  })
  return calls
}

test.use({ trace: 'off' })

test('schedule golden slice keeps responsive geometry and a complete keyboard schedule/undo path', async ({ page, context }) => {
  mkdirSync(evidenceDir, { recursive: true })
  await authenticatePreview(page)
  const calls = await routeSchedule(page)
  await context.tracing.start({ screenshots: true, snapshots: true })
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/app/schedule?view=week&date=2026-08-15')
    await expect(page.getByRole('heading', { name: '日程', level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: '周视图' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(/今日安排超过 8 小时/)).toBeVisible()
    await expect(page.getByText('1 组时间冲突')).toBeVisible()

    for (const viewport of [
      { width: 1440, height: 900, name: 'schedule-1440x900.png' },
      { width: 1024, height: 768, name: 'schedule-1024x768.png' },
      { width: 768, height: 1024, name: 'schedule-768x1024.png' },
      { width: 390, height: 844, name: 'schedule-390x844.png' },
      { width: 320, height: 900, name: 'schedule-320x900-reflow.png' },
    ]) {
      await page.setViewportSize(viewport)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${viewport.width} CSS px`).toBe(true)
      await page.screenshot({ path: resolve(evidenceDir, viewport.name), fullPage: true })
    }

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/app/schedule?date=2026-08-15')
    await expect(page.getByRole('button', { name: '日视图' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page).toHaveURL(/view=day/)

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/app/schedule?view=week&date=2026-08-15')
    const unscheduled = page.getByRole('button', { name: '排期：未排期任务' })
    await unscheduled.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('group', { name: '键盘排期' })).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowDown')
    await page.getByRole('button', { name: '确认排期' }).click()
    await expect(page.getByRole('button', { name: '撤销排期' })).toBeVisible()
    expect(calls.createBodies).toEqual([{ taskId: '未排期任务', startsAt: '2026-08-16T09:15:00', endsAt: '2026-08-16T10:00:00' }])
    await page.getByRole('button', { name: '撤销排期' }).click()
    await expect.poll(() => calls.deletes).toEqual(['/api/v1/schedule-blocks/block-new'])
  } finally {
    await traceToPath(context, resolve(evidenceDir, 'schedule-responsive-keyboard-trace.zip'))
  }
})

test('pointer scheduling commits once and a 409 keeps the preview recoverable', async ({ page }) => {
  await authenticatePreview(page)
  const calls = await routeSchedule(page, 'conflict')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/app/schedule?view=week&date=2026-08-15')

  const block = page.getByRole('button', { name: /深度工作.*09:00.*18:15.*存在冲突/ })
  const box = await block.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 24)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 40, { steps: 3 })
  await page.mouse.up()

  await expect.poll(() => calls.patchBodies.length).toBe(1)
  await expect(page.getByRole('alert').filter({ hasText: '预览没有丢失' })).toBeVisible()
  await expect(page.getByRole('button', { name: '恢复原时间' })).toBeVisible()
  await expect(page.getByRole('button', { name: '选择新时间' })).toBeVisible()
  await page.screenshot({ path: resolve(evidenceDir, 'schedule-1440x900-conflict.png'), fullPage: true })
})

test('schedule permission failure stays scoped and retry remains available', async ({ page }) => {
  await authenticatePreview(page)
  await routeSchedule(page, 'forbidden')
  await page.goto('/app/schedule?view=week&date=2026-08-15')
  await expect(page.getByRole('alert')).toContainText('你没有查看或修改日程的权限')
  await expect(page.getByRole('button', { name: '重新加载' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '日程', level: 1 })).toBeVisible()
})

test('schedule restores query state, editor focus and reduced-motion orientation', async ({ page }) => {
  await authenticatePreview(page)
  await routeSchedule(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/app/schedule?view=week&date=2026-08-15&project=project-alpha&status=planned')

  await expect(page.getByRole('combobox', { name: '项目筛选' })).toHaveValue('project-alpha')
  await expect(page.getByRole('combobox', { name: '状态筛选' })).toHaveValue('planned')
  const edit = page.getByRole('button', { name: '编辑：未排期任务' })
  await edit.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('button', { name: '关闭' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(edit).toBeFocused()

  await page.getByRole('button', { name: '月视图' }).click()
  await expect(page).toHaveURL(/view=month/)
  await page.goBack()
  await expect(page.getByRole('button', { name: '周视图' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('combobox', { name: '项目筛选' })).toHaveValue('project-alpha')
  await expect(page.getByRole('combobox', { name: '状态筛选' })).toHaveValue('planned')

  const transitionSeconds = await page.locator('.schedule-block').first().evaluate((element) => Number.parseFloat(getComputedStyle(element).transitionDuration))
  expect(transitionSeconds).toBeLessThanOrEqual(.001)
})
