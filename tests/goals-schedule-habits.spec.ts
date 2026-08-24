import { expect, test, type Page, type Route } from '@playwright/test'

const session = { mode: 'local-preview', account: 'p3-t7-core@lifeops.local' }

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function authenticate(page: Page) {
  await page.addInitScript((value) => sessionStorage.setItem('lifeops:session:v1', JSON.stringify(value)), session)
}

const baseGoal = {
  id: 'goal-core', title: '交付私人核心', description: '保留完整事实链。', status: 'active', priority: 1,
  startsOn: '2026-08-01', targetOn: '2026-09-30', progressMode: 'manual', manualProgress: 50, version: 1,
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z', deletedAt: null,
}
const baseProject = {
  id: 'project-core', goalId: baseGoal.id, title: '私人核心 E2E', description: '跨域行为验收。', riskNote: '证据必须新鲜',
  status: 'active', startsOn: '2026-08-01', targetOn: '2026-08-31', progress: 60, nextTaskId: null, version: 1,
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z', deletedAt: null,
}
const baseMilestone = {
  id: 'milestone-core', projectId: baseProject.id, title: '完成 P3-T7', dueOn: '2026-08-31',
  completedAt: null, position: 10, version: 1,
}

interface HierarchyCalls {
  writes: Array<{ method: string; path: string; body: Record<string, unknown> }>
}

async function routeHierarchy(page: Page): Promise<HierarchyCalls> {
  let goals = [structuredClone(baseGoal)]
  let projects = [structuredClone(baseProject)]
  let milestones = [structuredClone(baseMilestone)]
  const trash = new Map<string, Record<string, unknown>>()
  const calls: HierarchyCalls = { writes: [] }

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    if (method === 'GET' && path === '/api/v1/goals') return json(route, goals)
    const projectList = path.match(/^\/api\/v1\/goals\/([^/]+)\/projects$/)
    if (method === 'GET' && projectList) return json(route, projects.filter((item) => item.goalId === decodeURIComponent(projectList[1])))
    const milestoneList = path.match(/^\/api\/v1\/projects\/([^/]+)\/milestones$/)
    if (method === 'GET' && milestoneList) return json(route, milestones.filter((item) => item.projectId === decodeURIComponent(milestoneList[1])))
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>
    calls.writes.push({ method, path, body })

    if (method === 'POST' && path === '/api/v1/goals') {
      const created = { ...baseGoal, ...body, id: 'goal-created', version: 1 }
      goals.push(created)
      return json(route, created, 201)
    }
    const goalItem = path.match(/^\/api\/v1\/goals\/([^/]+)$/)
    if (goalItem && method === 'PATCH') {
      const id = decodeURIComponent(goalItem[1])
      const current = goals.find((item) => item.id === id)!
      const updated = { ...current, ...body, version: Number(body.version) + 1 }
      goals = goals.map((item) => item.id === id ? updated : item)
      return json(route, updated)
    }
    if (goalItem && method === 'DELETE') {
      const id = decodeURIComponent(goalItem[1])
      const current = goals.find((item) => item.id === id)!
      trash.set(`goal:${id}`, { ...current, version: Number(body.version) + 1, deletedAt: '2026-08-21T00:00:00.000Z' })
      goals = goals.filter((item) => item.id !== id)
      return route.fulfill({ status: 204 })
    }
    const goalRestore = path.match(/^\/api\/v1\/goals\/([^/]+)\/restore$/)
    if (goalRestore && method === 'POST') {
      const id = decodeURIComponent(goalRestore[1])
      const restored = { ...trash.get(`goal:${id}`), id, version: Number(body.version) + 1, deletedAt: null } as typeof baseGoal
      goals.push(restored)
      trash.delete(`goal:${id}`)
      return json(route, restored)
    }

    if (projectList && method === 'POST') {
      const created = { ...baseProject, ...body, id: 'project-created', goalId: decodeURIComponent(projectList[1]), version: 1 }
      projects.push(created)
      return json(route, created, 201)
    }
    const projectItem = path.match(/^\/api\/v1\/projects\/([^/]+)$/)
    if (projectItem && method === 'PATCH') {
      const id = decodeURIComponent(projectItem[1])
      const current = projects.find((item) => item.id === id)!
      const updated = { ...current, ...body, version: Number(body.version) + 1 }
      projects = projects.map((item) => item.id === id ? updated : item)
      return json(route, updated)
    }
    if (projectItem && method === 'DELETE') {
      const id = decodeURIComponent(projectItem[1])
      const current = projects.find((item) => item.id === id)!
      trash.set(`project:${id}`, { ...current, version: Number(body.version) + 1, deletedAt: '2026-08-21T00:00:00.000Z' })
      projects = projects.filter((item) => item.id !== id)
      return route.fulfill({ status: 204 })
    }
    const projectRestore = path.match(/^\/api\/v1\/projects\/([^/]+)\/restore$/)
    if (projectRestore && method === 'POST') {
      const id = decodeURIComponent(projectRestore[1])
      const restored = { ...trash.get(`project:${id}`), id, version: Number(body.version) + 1, deletedAt: null } as typeof baseProject
      projects.push(restored)
      trash.delete(`project:${id}`)
      return json(route, restored)
    }

    if (milestoneList && method === 'POST') {
      const created = { ...baseMilestone, ...body, id: 'milestone-created', projectId: decodeURIComponent(milestoneList[1]), version: 1 }
      milestones.push(created)
      return json(route, created, 201)
    }
    const milestoneItem = path.match(/^\/api\/v1\/milestones\/([^/]+)$/)
    if (milestoneItem && method === 'PATCH') {
      const id = decodeURIComponent(milestoneItem[1])
      const current = milestones.find((item) => item.id === id)!
      const updated = { ...current, ...body, version: Number(body.version) + 1 }
      milestones = milestones.map((item) => item.id === id ? updated : item)
      return json(route, updated)
    }
    if (milestoneItem && method === 'DELETE') {
      const id = decodeURIComponent(milestoneItem[1])
      const current = milestones.find((item) => item.id === id)!
      trash.set(`milestone:${id}`, { ...current, version: Number(body.version) + 1, deletedAt: '2026-08-21T00:00:00.000Z' })
      milestones = milestones.filter((item) => item.id !== id)
      return route.fulfill({ status: 204 })
    }
    const milestoneRestore = path.match(/^\/api\/v1\/milestones\/([^/]+)\/restore$/)
    if (milestoneRestore && method === 'POST') {
      const id = decodeURIComponent(milestoneRestore[1])
      const restored = { ...trash.get(`milestone:${id}`), id, version: Number(body.version) + 1, deletedAt: null } as typeof baseMilestone
      milestones.push(restored)
      trash.delete(`milestone:${id}`)
      return json(route, restored)
    }
    return json(route, {})
  })
  return calls
}

test('goal, project and milestone journeys create, edit, archive and restore the same identities', async ({ page }) => {
  await authenticate(page)
  const calls = await routeHierarchy(page)
  await page.goto('/app/goals?goal=goal-core')

  await page.getByRole('button', { name: '新建目标' }).click()
  await page.getByRole('dialog', { name: '新建目标' }).getByLabel('标题', { exact: true }).fill('新增季度目标')
  await page.getByRole('dialog', { name: '新建目标' }).getByRole('button', { name: '保存', exact: true }).click()
  await expect.poll(() => calls.writes.some((call) => call.method === 'POST' && call.path === '/api/v1/goals')).toBe(true)
  await expect(page.getByRole('button', { name: /选择目标 新增季度目标/ })).toBeVisible()

  await page.getByRole('button', { name: '编辑目标', exact: true }).click()
  const goalEditor = page.getByRole('dialog', { name: '编辑目标' })
  await goalEditor.getByLabel('标题', { exact: true }).fill('交付私人核心 · 已编辑')
  await goalEditor.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('region', { name: '对象检查器' })).toContainText('交付私人核心 · 已编辑')

  await page.getByRole('button', { name: '添加项目' }).click()
  const newProject = page.getByRole('dialog', { name: '新建项目' })
  await newProject.getByLabel('标题', { exact: true }).fill('新增验收项目')
  await newProject.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('button', { name: /选择项目 新增验收项目/ })).toBeVisible()

  await page.getByRole('button', { name: `选择项目 ${baseProject.title}` }).click()
  const inspector = page.getByRole('region', { name: '对象检查器' })
  await inspector.getByRole('button', { name: '编辑项目', exact: true }).click()
  const projectEditor = page.getByRole('dialog', { name: '编辑项目' })
  await projectEditor.getByLabel('标题', { exact: true }).fill('私人核心 E2E · 已编辑')
  await projectEditor.getByRole('button', { name: '保存', exact: true }).click()
  await inspector.getByRole('button', { name: '添加里程碑' }).click()
  const newMilestone = page.getByRole('dialog', { name: '新建里程碑' })
  await newMilestone.getByLabel('标题', { exact: true }).fill('新增验收里程碑')
  await newMilestone.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('button', { name: /选择里程碑 新增验收里程碑/ })).toBeVisible()

  await page.getByRole('button', { name: `选择里程碑 ${baseMilestone.title}` }).click()
  await inspector.getByRole('button', { name: '编辑里程碑', exact: true }).click()
  const milestoneEditor = page.getByRole('dialog', { name: '编辑里程碑' })
  await milestoneEditor.getByLabel('标题', { exact: true }).fill('完成 P3-T7 · 已编辑')
  await milestoneEditor.getByRole('button', { name: '保存', exact: true }).click()
  await inspector.getByRole('button', { name: '标记完成' }).click()
  await expect(page.getByRole('region', { name: '对象检查器' })).toContainText('已完成')

  for (const lifecycle of [
    { type: 'milestone', select: /选择里程碑 完成 P3-T7 · 已编辑/, archive: '归档里程碑', id: 'milestone-core' },
    { type: 'project', select: /选择项目 私人核心 E2E · 已编辑/, archive: '归档项目', id: 'project-core' },
    { type: 'goal', select: /选择目标 交付私人核心 · 已编辑/, archive: '归档目标', id: 'goal-core' },
  ] as const) {
    await page.getByRole('button', { name: lifecycle.select }).click()
    await inspector.getByRole('button', { name: lifecycle.archive }).click()
    await expect(page.locator('.goals-undo')).toContainText('已归档')
    await page.getByRole('button', { name: '撤销归档' }).click()
    await expect.poll(() => calls.writes.some((call) => call.path === `/api/v1/${lifecycle.type === 'milestone' ? 'milestones' : lifecycle.type === 'project' ? 'projects' : 'goals'}/${lifecycle.id}/restore`)).toBe(true)
    await expect(page.getByRole('region', { name: '对象检查器' })).toContainText('已编辑')
  }
})

const task = (id: string, title: string, patch: Record<string, unknown> = {}) => ({
  id, goalId: null, projectId: 'project-core', milestoneId: null, title, description: '', startsAt: null, endsAt: null,
  dueAt: null, estimateMinutes: 45, priority: 2, tags: [], status: 'planned', checklist: [], recurrence: null,
  version: 1, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z', completedAt: null, deletedAt: null, ...patch,
})

async function routeSchedule(page: Page) {
  let tasks = [
    task('task-drag', '拖动任务', { startsAt: '2026-08-21T09:00:00', endsAt: '2026-08-21T10:00:00' }),
    task('task-keyboard', '键盘任务'),
  ]
  let blocks = [{ id: 'block-drag', taskId: 'task-drag', startsAt: '2026-08-21T09:00:00', endsAt: '2026-08-21T10:00:00', version: 1 }]
  const calls: Array<{ method: string; path: string; body: Record<string, unknown> }> = []
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    if (method === 'GET' && path === '/api/v1/tasks') return json(route, tasks)
    if (method === 'GET' && path === '/api/v1/schedule-blocks') return json(route, blocks)
    if (method === 'GET' && path === '/api/v1/schedule/conflicts') return json(route, [])
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>
    calls.push({ method, path, body })
    if (method === 'POST' && path === '/api/v1/tasks') {
      const created = task('task-created', String(body.title), { ...body, version: 1 })
      tasks.push(created)
      return json(route, created, 201)
    }
    const taskItem = path.match(/^\/api\/v1\/tasks\/([^/]+)$/)
    if (taskItem && method === 'PATCH') {
      const id = decodeURIComponent(taskItem[1])
      const current = tasks.find((item) => item.id === id)!
      const updated = { ...current, ...body, version: Number(body.version) + 1 }
      tasks = tasks.map((item) => item.id === id ? updated : item)
      return json(route, updated)
    }
    if (method === 'POST' && path === '/api/v1/schedule-blocks') {
      const created = { id: 'block-keyboard', ...body, version: 1 } as typeof blocks[number]
      blocks.push(created)
      return json(route, created, 201)
    }
    const blockItem = path.match(/^\/api\/v1\/schedule-blocks\/([^/]+)$/)
    if (blockItem && method === 'PATCH') {
      const id = decodeURIComponent(blockItem[1])
      const current = blocks.find((item) => item.id === id)!
      const updated = { ...current, ...body, version: Number(body.version) + 1 }
      blocks = blocks.map((item) => item.id === id ? updated : item)
      return json(route, updated)
    }
    if (blockItem && method === 'DELETE') {
      const id = decodeURIComponent(blockItem[1])
      blocks = blocks.filter((item) => item.id !== id)
      return route.fulfill({ status: 204 })
    }
    return json(route, {})
  })
  return calls
}

test('task editor plus pointer and keyboard scheduling share auditable create, edit and undo journeys', async ({ page }) => {
  await authenticate(page)
  const calls = await routeSchedule(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/app/schedule?view=week&date=2026-08-21')

  await page.getByRole('button', { name: '新建任务' }).click()
  const create = page.getByRole('dialog')
  await create.getByLabel('标题').fill('新增排期任务')
  await create.getByLabel('状态').selectOption('planned')
  await create.getByRole('button', { name: '保存任务' }).click()
  await expect(page.getByRole('button', { name: '排期：新增排期任务' })).toBeVisible()

  await page.getByRole('button', { name: '编辑：键盘任务' }).click()
  const edit = page.getByRole('dialog')
  await edit.getByLabel('标题').fill('键盘任务 · 已编辑')
  await edit.getByRole('button', { name: '保存任务' }).click()
  await expect(page.getByRole('button', { name: '排期：键盘任务 · 已编辑' })).toBeVisible()

  const keyboardTask = page.getByRole('button', { name: '排期：键盘任务 · 已编辑' })
  await keyboardTask.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect.poll(() => calls.some((call) => call.method === 'POST' && call.path === '/api/v1/schedule-blocks')).toBe(true)
  await page.getByRole('button', { name: '撤销排期' }).click()
  await expect.poll(() => calls.some((call) => call.method === 'DELETE' && call.path === '/api/v1/schedule-blocks/block-keyboard')).toBe(true)

  const draggable = page.getByRole('button', { name: /拖动任务.*09:00.*10:00/ })
  const box = await draggable.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 20)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 44, { steps: 4 })
  await page.mouse.up()
  await expect.poll(() => calls.some((call) => call.method === 'PATCH' && call.path === '/api/v1/schedule-blocks/block-drag')).toBe(true)
})

const habit = (id: string, title: string, patch: Record<string, unknown> = {}) => ({
  id, goalId: 'goal-core', projectId: 'project-core', title, description: '', measure: 'duration', unit: '分钟',
  targetValue: 30, status: 'active', pausedAt: null, timezone: 'Asia/Shanghai',
  schedule: { scheduleType: 'daily', startsOn: '2026-08-01', endsOn: null }, version: 1,
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z', deletedAt: null, ...patch,
})

async function routeHabits(page: Page) {
  let habits = [
    habit('habit-reading', '阅读'),
    habit('habit-boolean', '冥想', { measure: 'boolean', unit: null, targetValue: 1 }),
    habit('habit-weekdays', '力量训练', { measure: 'count', unit: '次', targetValue: 20, schedule: { scheduleType: 'weekdays', weekdays: [1, 3, 5], startsOn: '2026-08-01', endsOn: null } }),
  ]
  let entries = [
    { id: 'entry-done', habitId: 'habit-reading', entryDate: '2026-08-18', status: 'done', value: 30, note: '', version: 1, createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z', deletedAt: null },
    { id: 'entry-partial', habitId: 'habit-reading', entryDate: '2026-08-19', status: 'partial', value: 15, note: '', version: 1, createdAt: '2026-08-19T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z', deletedAt: null },
    { id: 'entry-skip', habitId: 'habit-reading', entryDate: '2026-08-20', status: 'intentional-skip', value: null, note: '主动恢复', version: 1, createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z', deletedAt: null },
  ]
  const calls: Array<{ method: string; path: string; body: Record<string, unknown> }> = []
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    if (method === 'GET' && url.pathname === '/api/v1/habits') return json(route, { from: url.searchParams.get('from'), to: url.searchParams.get('to'), habits, entries })
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>
    calls.push({ method, path: url.pathname, body })
    if (method === 'POST' && url.pathname === '/api/v1/habits') {
      const created = habit('habit-created', String(body.title), { ...body, version: 1 })
      habits.push(created)
      return json(route, created, 201)
    }
    const entryMatch = url.pathname.match(/^\/api\/v1\/habits\/([^/]+)\/entries\/([^/]+)$/)
    if (method === 'PUT' && entryMatch) {
      const habitId = decodeURIComponent(entryMatch[1])
      const entryDate = decodeURIComponent(entryMatch[2])
      const current = entries.find((item) => item.habitId === habitId && item.entryDate === entryDate)
      const updated = { id: current?.id ?? `entry-${habitId}-${entryDate}`, habitId, entryDate, ...body, value: body.value ?? null, note: body.note ?? '', version: Number(body.version ?? 0) + 1, createdAt: current?.createdAt ?? `${entryDate}T00:00:00.000Z`, updatedAt: `${entryDate}T01:00:00.000Z`, deletedAt: null }
      entries = current ? entries.map((item) => item === current ? updated : item) : [...entries, updated]
      return json(route, updated)
    }
    const habitItem = url.pathname.match(/^\/api\/v1\/habits\/([^/]+)$/)
    if (method === 'PATCH' && habitItem) {
      const id = decodeURIComponent(habitItem[1])
      const current = habits.find((item) => item.id === id)!
      const updated = { ...current, ...body, version: Number(body.version) + 1 }
      habits = habits.map((item) => item.id === id ? updated : item)
      return json(route, updated)
    }
    return json(route, {})
  })
  return calls
}

test('habit journey exposes all six rhythm states and preserves create, edit, entry, pause and archive writes', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-08-21T12:00:00+08:00'))
  await authenticate(page)
  const calls = await routeHabits(page)
  await page.goto('/app/habits?habit=habit-reading')

  const matrix = page.getByRole('grid', { name: '28 日习惯节奏' })
  await expect(matrix.locator('[data-state]').first()).toBeAttached()
  const stateCounts = await matrix.locator('[data-state]').evaluateAll((nodes) => nodes.reduce<Record<string, number>>((counts, node) => {
    const state = (node as HTMLElement).dataset.state ?? 'missing'
    counts[state] = (counts[state] ?? 0) + 1
    return counts
  }, {}))
  expect(Object.keys(stateCounts).sort()).toEqual(['done', 'future', 'intentional-skip', 'missed', 'not-expected', 'partial'])

  await page.getByRole('button', { name: '新建习惯' }).click()
  const create = page.getByRole('dialog', { name: '新建习惯' })
  await create.getByLabel('标题').fill('写作')
  await create.getByRole('button', { name: '保存习惯' }).click()
  await expect(page.getByRole('button', { name: /写作/ }).first()).toBeVisible()

  await page.getByRole('button', { name: '编辑习惯' }).click()
  const edit = page.getByRole('dialog', { name: '编辑习惯' })
  await edit.getByLabel('标题').fill('写作 · 已编辑')
  await edit.getByRole('button', { name: '保存习惯' }).click()
  await expect(page.getByRole('region', { name: '习惯检查器' })).toContainText('写作 · 已编辑')

  await page.getByRole('button', { name: '部分完成', exact: true }).click()
  await expect.poll(() => calls.some((call) => call.method === 'PUT' && call.body.status === 'partial')).toBe(true)
  await page.getByRole('button', { name: '有意跳过', exact: true }).click()
  await page.getByLabel('跳过原因').fill('有意识地休息')
  await page.getByRole('button', { name: '确认有意跳过' }).click()
  await expect.poll(() => calls.some((call) => call.method === 'PUT' && call.body.status === 'intentional-skip')).toBe(true)

  await page.getByRole('button', { name: '暂停习惯' }).click()
  await expect.poll(() => calls.some((call) => call.method === 'PATCH' && call.body.status === 'paused')).toBe(true)
  await page.getByRole('button', { name: '归档习惯' }).click()
  await expect.poll(() => calls.some((call) => call.method === 'PATCH' && call.body.status === 'archived')).toBe(true)
  await expect(page.getByRole('region', { name: '习惯检查器' })).not.toContainText('写作 · 已编辑')
})

test('delayed, 403, 409, 500 and offline failures stay inside the affected goal module with retry', async ({ page, context }) => {
  await authenticate(page)
  let mode: 'delayed' | 'ok' | 'forbidden' | 'conflict' | 'server-error' | 'offline' = 'delayed'
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'GET' && path === '/api/v1/goals') {
      if (mode === 'delayed') await new Promise((resolve) => setTimeout(resolve, 1_000))
      if (mode === 'forbidden') return json(route, { error: { code: 'FORBIDDEN', message: 'Forbidden' } }, 403)
      if (mode === 'server-error') return json(route, { error: { code: 'INTERNAL_ERROR', message: 'Internal error' } }, 500)
      return json(route, [baseGoal])
    }
    if (request.method() === 'GET' && path === `/api/v1/goals/${baseGoal.id}/projects`) return json(route, [baseProject])
    if (request.method() === 'GET' && path === `/api/v1/projects/${baseProject.id}/milestones`) return json(route, [baseMilestone])
    if (request.method() === 'PATCH' && path === `/api/v1/goals/${baseGoal.id}`) {
      if (mode === 'conflict') return json(route, { error: { code: 'VERSION_CONFLICT', message: '目标已被另一会话更新' } }, 409)
      if (mode === 'offline') return route.abort('internetdisconnected')
      return json(route, { ...baseGoal, ...request.postDataJSON(), version: baseGoal.version + 1 })
    }
    return json(route, {})
  })

  const navigation = page.goto('/app/goals?goal=goal-core')
  await expect(page.getByRole('status').filter({ hasText: '正在整理成果地图' })).toBeVisible()
  await navigation
  await expect(page.getByRole('img', { name: '目标、项目与里程碑成果地图' })).toBeVisible()

  mode = 'forbidden'
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('你没有查看或修改这些目标的权限')
  await expect(page.getByRole('button', { name: '重新加载' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '目标与项目', level: 1 })).toBeVisible()
  await expect(page.locator('.workspace-header')).toBeVisible()

  mode = 'server-error'
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('目标与项目暂时无法加载')
  await expect(page.getByRole('button', { name: '重新加载' })).toBeVisible()
  await expect(page.locator('[data-private-shell]')).toBeVisible()

  mode = 'ok'
  await page.reload()
  await expect(page.getByRole('img', { name: '目标、项目与里程碑成果地图' })).toBeVisible()
  mode = 'conflict'
  await page.getByRole('button', { name: '编辑目标', exact: true }).click()
  const conflictEditor = page.getByRole('dialog', { name: '编辑目标' })
  await conflictEditor.getByLabel('标题', { exact: true }).fill('不会覆盖服务器的修改')
  await conflictEditor.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '这份内容已在另一处更新' })).toBeVisible()
  await expect(conflictEditor.getByRole('alert')).toContainText('目标已被另一会话更新')
  await expect(page.getByRole('img', { name: '目标、项目与里程碑成果地图' })).toBeVisible()

  mode = 'ok'
  await page.reload()
  await page.getByRole('button', { name: '编辑目标', exact: true }).click()
  const offlineEditor = page.getByRole('dialog', { name: '编辑目标' })
  await offlineEditor.getByLabel('标题', { exact: true }).fill('离线修改保留在局部编辑器')
  mode = 'offline'
  await context.setOffline(true)
  try {
    await offlineEditor.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: '当前设备离线' })).toBeVisible()
    await expect(offlineEditor.getByLabel('标题', { exact: true })).toHaveValue('离线修改保留在局部编辑器')
  } finally {
    await context.setOffline(false)
  }
})
