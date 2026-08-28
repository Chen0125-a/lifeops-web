import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { screenshotToPath } from './helpers/screenshotToPath'

const overviewEvidenceDir = resolve('outputs/evidence/browser/p3-t1')

test('login crosses into the daylight workspace and preserves the scheduled-task to private-record slice', async ({ page }) => {
  let scheduleCreates = 0
  const recordCreates: Array<Record<string, unknown>> = []
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'GET' && path === '/api/v1/tasks') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
      id: 'task-loop', goalId: null, projectId: null, milestoneId: null, title: '完成 LifeOps 闭环验收', description: '',
      startsAt: null, endsAt: null, dueAt: null, estimateMinutes: 30, priority: 1, tags: ['验收'], status: 'planned',
      checklist: [], recurrence: null, version: 1, createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z',
      completedAt: null, deletedAt: null,
    }]) })
    if (request.method() === 'GET' && path === '/api/v1/schedule-blocks') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    if (request.method() === 'GET' && path === '/api/v1/schedule/conflicts') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    if (request.method() === 'POST' && path === '/api/v1/schedule-blocks') {
      scheduleCreates += 1
      const body = request.postDataJSON()
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'block-loop', ...body, version: 1 }) })
    }
    if (request.method() === 'GET' && path === '/api/v1/records') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    }
    if (request.method() === 'POST' && path === '/api/v1/records') {
      const body = request.postDataJSON() as Record<string, unknown>
      recordCreates.push(body)
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({
        id: 'record-loop', ...body, occurredAt: '2026-08-15T12:00:00.000Z', coverMediaId: body.coverMediaId ?? null, pinned: false, archivedAt: null,
        version: 1, createdAt: '2026-08-15T12:00:00.000Z', updatedAt: '2026-08-15T12:00:00.000Z', deletedAt: null,
      }) })
    }
    return route.fallback()
  })
  await page.addInitScript(() => {
    if (sessionStorage.getItem('lifeops:e2e-private-loop-initialized') === 'true') return
    localStorage.clear()
    sessionStorage.clear()
    sessionStorage.setItem('lifeops:e2e-private-loop-initialized', 'true')
    localStorage.setItem('lifeops:theme-override', JSON.stringify({ theme: 'night', expiresAt: Date.now() + 86_400_000 }))
    localStorage.setItem('lifeops:data:v1', JSON.stringify({
      schemaVersion: 1,
      plans: [{
        id: 'legacy-loop-plan', title: '完成 LifeOps 闭环验收', scheduledFor: '10:30', status: 'done',
        createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:30:00.000Z', completedAt: '2026-08-15T00:30:00.000Z',
      }],
      records: [], reviews: [], knowledge: [], snapshots: [],
    }))
  })
  await page.goto('/')
  await page.getByRole('button', { name: '登录 LifeOps' }).click()
  await expect(page.getByLabel('账号')).toBeFocused()
  await page.getByLabel('账号').fill('preview@lifeops.local')
  await page.getByRole('textbox', { name: '密码', exact: true }).fill('local-preview')
  await page.getByRole('button', { name: '进入 LifeOps' }).click()

  await expect(page).toHaveURL(/\/app\/overview$/)
  await expect(page.locator('[data-private-shell]')).toHaveAttribute('data-workspace-theme', 'daylight')
  await expect(page.locator('.private-orrery')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '总览', level: 1 })).toBeVisible()

  await page.getByRole('link', { name: '日程', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/schedule(?:\?|$)/)
  const task = page.getByRole('button', { name: '排期：完成 LifeOps 闭环验收' })
  await task.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('group', { name: '键盘排期' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await page.getByRole('button', { name: '确认排期' }).click()
  await expect(page.getByText('排期已保存')).toBeVisible()
  expect(scheduleCreates).toBe(1)
  await page.goto('/app/records?create=record&source=task:task-loop')
  const recordEditor = page.getByRole('region', { name: '记录编辑器' })
  await recordEditor.getByLabel('标题').fill('完成 LifeOps 闭环验收')
  await recordEditor.getByLabel('Markdown 正文').fill('计划完成后留下可追溯的真实记录。')
  await recordEditor.getByLabel('标签').fill('LifeOps, 验收')
  await recordEditor.getByRole('button', { name: '创建记录' }).click()
  await expect.poll(() => recordCreates.length).toBe(1)
  expect(recordCreates[0]).toMatchObject({
    title: '完成 LifeOps 闭环验收',
    body: '计划完成后留下可追溯的真实记录。',
    tags: ['LifeOps', '验收'],
    links: [{ type: 'task', id: 'task-loop' }],
    mediaIds: [],
    coverMediaId: null,
  })
  await expect(page).toHaveURL(/record=record-loop/)
  await expect(page.getByText('仅自己可见')).toBeVisible()
})

test('workspace route changes are animated and global search stays keyboard-accessible', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('lifeops:session:v1', JSON.stringify({ mode: 'local-preview', account: 'keyboard@lifeops.local' })))
  await page.goto('/app')
  await expect(page).toHaveURL(/\/app\/overview$/)
  await page.getByRole('link', { name: '知识', exact: true }).click()
  await expect(page.locator('[data-workspace-route="/app/knowledge"]')).toBeVisible()
  await expect(page.locator('[data-route-stage]')).toHaveAttribute('data-route-direction', 'forward')
  await expect(page.getByRole('heading', { name: '知识', level: 1 })).toBeFocused()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
  await expect(page.getByRole('dialog', { name: '全局搜索' })).toBeVisible()
  await expect(page.getByRole('searchbox', { name: '搜索 LifeOps' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '全局搜索' })).toHaveCount(0)

  mkdirSync(overviewEvidenceDir, { recursive: true })
  await page.goto('/app/overview')
  await expect(page.getByRole('heading', { name: '总览', level: 1 })).toBeVisible()
  for (const viewport of [
    { width: 1440, height: 900, name: 'overview-1440x900-full.jpg' },
    { width: 1024, height: 768, name: 'overview-1024x768.jpg' },
    { width: 768, height: 1024, name: 'overview-768x1024.jpg' },
    { width: 390, height: 844, name: 'overview-390x844.jpg' },
    { width: 320, height: 900, name: 'overview-320x900-reflow.jpg' },
  ]) {
    await page.setViewportSize(viewport)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${viewport.width} CSS px`).toBe(true)
    await screenshotToPath(page, { path: resolve(overviewEvidenceDir, viewport.name), fullPage: true, type: 'jpeg', quality: 90 })
  }
})
