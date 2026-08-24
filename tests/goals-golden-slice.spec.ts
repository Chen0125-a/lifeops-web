import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page, type Route } from '@playwright/test'

const evidenceDir = resolve('outputs/evidence/browser/p3-t2')
const session = { mode: 'local-preview', account: 'goals-e2e@lifeops.local' }

const goal = {
  id: 'goal-e2e', title: '完成 LifeOps 高质量交付', description: '可验证、可恢复、可持续演进。',
  status: 'active', priority: 1, startsOn: '2026-08-01', targetOn: '2026-09-30',
  progressMode: 'manual', manualProgress: 42, version: 1,
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z', deletedAt: null,
}
const project = {
  id: 'project-e2e', goalId: goal.id, title: 'P3 私人黄金切片', description: '完整目标层级。',
  riskNote: '浏览器证据必须保持新鲜', status: 'active', startsOn: '2026-08-01', targetOn: '2026-08-10',
  progress: 68, nextTaskId: null, version: 1,
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z', deletedAt: null,
}
const milestone = {
  id: 'milestone-e2e', projectId: project.id, title: 'P3-T2 浏览器验收', dueOn: '2026-08-15',
  completedAt: null, position: 10, version: 1,
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function authenticatePreview(page: Page) {
  await page.addInitScript((value) => {
    sessionStorage.setItem('lifeops:session:v1', JSON.stringify(value))
  }, session)
}

async function routeHierarchy(page: Page, writeMode: 'ok' | 'conflict' | 'network' = 'ok') {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'GET' && path === '/api/v1/goals') return json(route, [goal])
    if (request.method() === 'GET' && path === `/api/v1/goals/${goal.id}/projects`) return json(route, [project])
    if (request.method() === 'GET' && path === `/api/v1/projects/${project.id}/milestones`) return json(route, [milestone])
    if (writeMode === 'network') return route.abort('internetdisconnected')
    if (writeMode === 'conflict') return json(route, {
      error: { code: 'VERSION_CONFLICT', message: '数据已经在另一处更新', requestId: 'goals-e2e-409' },
    }, 409)
    return json(route, { ...goal, version: goal.version + 1 })
  })
}

test.use({ trace: 'off' })

test('goals golden slice preserves hierarchy, keyboard, history and responsive task layers', async ({ page, context }) => {
  mkdirSync(evidenceDir, { recursive: true })
  await authenticatePreview(page)
  await routeHierarchy(page)
  await context.tracing.start({ screenshots: true, snapshots: true })
  try {
    await page.goto('/app/goals')
    await expect(page.getByRole('heading', { name: '目标与项目', level: 1 })).toBeVisible()
    await expect(page.getByRole('img', { name: '目标、项目与里程碑成果地图' })).toBeVisible()

    for (const viewport of [
      { width: 1440, height: 900, name: 'goals-1440x900-viewport.png' },
      { width: 1024, height: 768, name: 'goals-1024x768.png' },
      { width: 768, height: 1024, name: 'goals-768x1024.png' },
      { width: 390, height: 844, name: 'goals-390x844-e2e-map.png' },
      { width: 320, height: 900, name: 'goals-320x900-reflow.png' },
    ]) {
      await page.setViewportSize(viewport)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${viewport.width} CSS px`).toBe(true)
      await page.screenshot({ path: resolve(evidenceDir, viewport.name), fullPage: true })
    }

    await page.setViewportSize({ width: 1440, height: 900 })
    const editGoal = page.getByRole('button', { name: '编辑目标', exact: true })
    await editGoal.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: '编辑目标' }).getByLabel('标题', { exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(editGoal).toBeFocused()

    await page.screenshot({ path: resolve(evidenceDir, 'filmstrip-goals-000-map.png') })
    await page.getByRole('button', { name: `选择项目 ${project.title}` }).click()
    await page.screenshot({ path: resolve(evidenceDir, 'filmstrip-goals-120-project.png') })
    await page.getByRole('button', { name: `选择里程碑 ${milestone.title}` }).click()
    await page.goBack()
    await expect(page.getByRole('region', { name: '对象检查器' }).getByRole('heading')).toHaveText(project.title)
    await page.screenshot({ path: resolve(evidenceDir, 'filmstrip-goals-240-back.png') })

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByRole('button', { name: '返回成果地图' })).toBeVisible()
    await expect(page.getByRole('region', { name: '对象检查器' })).toHaveCSS('position', 'fixed')
    await page.screenshot({ path: resolve(evidenceDir, 'goals-390x844-e2e-inspector.png') })
    await page.getByRole('button', { name: '返回成果地图' }).click()
    await expect(page.getByRole('heading', { name: '成果地图' })).toBeVisible()
    await page.screenshot({ path: resolve(evidenceDir, 'goals-390x844-e2e-map.png') })
  } finally {
    await context.tracing.stop({ path: resolve(evidenceDir, 'goals-route-inspector-trace.zip') })
  }
})

test('goals page renders loading, empty and recoverable transport states honestly', async ({ page, context }) => {
  await authenticatePreview(page)
  let mode: 'loading' | 'empty' | 'network' | 'forbidden' = 'loading'
  let releaseLoading!: () => void
  const loadingGate = new Promise<void>((resolveLoading) => { releaseLoading = resolveLoading })
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path !== '/api/v1/goals') return json(route, [])
    if (mode === 'loading') {
      await loadingGate
      return json(route, [])
    }
    if (mode === 'empty') return json(route, [])
    if (mode === 'forbidden') return json(route, { error: { code: 'FORBIDDEN', message: 'Forbidden' } }, 403)
    return route.abort('failed')
  })

  await page.goto('/app/goals')
  await expect(page.getByText('正在整理成果地图…', { exact: true })).toBeVisible()
  releaseLoading()
  await expect(page.getByRole('heading', { name: '先确定一个值得持续投入的方向' })).toBeVisible()

  mode = 'network'
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('目标与项目暂时无法加载')

  mode = 'forbidden'
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('你没有查看或修改这些目标的权限')

  mode = 'empty'
  await page.reload()
  await expect(page.getByRole('heading', { name: '先确定一个值得持续投入的方向' })).toBeVisible()
  await routeHierarchy(page, 'network')
  await page.reload()
  await page.getByRole('button', { name: '编辑目标', exact: true }).click()
  const offlineEditor = page.getByRole('dialog', { name: '编辑目标' })
  await offlineEditor.getByLabel('标题', { exact: true }).fill('离线修改')
  await context.setOffline(true)
  try {
    await offlineEditor.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: '当前设备离线' })).toBeVisible()
  } finally {
    await context.setOffline(false)
  }
})

test('goals page surfaces version conflict and removes continuous motion for reduced-motion users', async ({ page }) => {
  await authenticatePreview(page)
  await routeHierarchy(page, 'conflict')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/app/goals')

  await page.getByRole('button', { name: '编辑目标', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '编辑目标' })
  await editor.getByLabel('标题', { exact: true }).fill('陈旧标题')
  await editor.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '这份内容已在另一处更新' })).toBeVisible()
  await expect(editor.getByRole('alert')).toContainText('数据已经在另一处更新')
  expect(await page.locator('[data-layout-identity="goals-selected-object"]').evaluate((element) => getComputedStyle(element).animationName)).toBe('none')
})
