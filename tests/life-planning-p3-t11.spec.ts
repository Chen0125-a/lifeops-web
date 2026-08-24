import { mkdir } from 'node:fs/promises'
import { expect, test, type Page, type Route } from '@playwright/test'

const fixtureId = 'p3-t11-planning-fitness-golden-slice-2026-08-22-v1'
const evidenceDir = 'outputs/evidence/p3-t11-life-planning-browser-gate'
const now = '2026-08-18T08:00:00.000Z'
const session = { mode: 'local-preview', account: 'p3-t11-browser@lifeops.local', fixtureId }
const weekDates = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23']
const mealSlots = [
  { id: 'breakfast', name: '早餐', position: 10, hidden: false },
  { id: 'after-breakfast', name: '早餐后', position: 20, hidden: false },
  { id: 'dinner', name: '晚餐', position: 30, hidden: false },
]
const planItems = [
  {
    id: 'meal-1', kind: 'meal', title: '燕麦早餐', mealSlotId: 'breakfast', scheduledTime: '07:30',
    source: { type: 'recipe-version', id: 'recipe-oats', versionId: 'version-2' }, quantity: null, unit: null,
    servings: 1, durationMinutes: null, status: 'planned', completionId: null, actual: null,
    originTemplateItemId: null, entityVersion: 1,
  },
  {
    id: 'supplement-1', kind: 'supplement', title: '用户记录的补剂', mealSlotId: 'breakfast', scheduledTime: '07:45',
    source: { type: 'catalog-item', id: 'supplement-user' }, quantity: 1, unit: '份', servings: null,
    durationMinutes: null, status: 'planned', completionId: null, actual: null,
    originTemplateItemId: 'tpl-supplement', entityVersion: 1,
  },
  {
    id: 'medicine-plan', kind: 'medicine', title: '用户记录的晚间用药', mealSlotId: null, scheduledTime: '21:00',
    source: { type: 'catalog-item', id: 'medicine-user' }, quantity: 1, unit: '片', servings: null,
    durationMinutes: null, status: 'planned', completionId: null, actual: null,
    originTemplateItemId: null, entityVersion: 2,
  },
  {
    id: 'unplaced-stretch', kind: 'custom', title: '未安排的拉伸', mealSlotId: null, scheduledTime: null,
    source: null, quantity: null, unit: null, servings: null, durationMinutes: 10, status: 'planned',
    completionId: null, actual: null, originTemplateItemId: null, entityVersion: 1,
  },
]
const fitnessItems = [{
  id: 'fitness-plan', kind: 'fitness', title: '晚间组合训练', mealSlotId: null, scheduledTime: '18:30',
  source: { type: 'fitness-activity', id: 'strength' }, quantity: null, unit: null, servings: null,
  durationMinutes: 50, status: 'planned', completionId: null, actual: null, originTemplateItemId: null, entityVersion: 1,
}]
const template = {
  id: 'template-weekday', name: '工作日模板', mealSlots,
  items: [{
    id: 'tpl-breakfast', kind: 'meal', title: '模板早餐', mealSlotId: 'breakfast', scheduledTime: '07:30', weekdays: [1, 2, 3, 4, 5],
    source: { type: 'recipe-version', id: 'recipe-template', versionId: 'version-1' }, quantity: null, unit: null,
    servings: 1, durationMinutes: null,
  }],
  entityVersion: 4,
}
const activities = [
  { id: 'strength', name: '力量训练', defaultMinutes: 30, kcalPerHour: 360, intensity: '中等', steps: ['深蹲', '推举'], equipment: ['哑铃'], entityVersion: 1, createdAt: now, updatedAt: now },
  { id: 'cycle', name: '室内单车', defaultMinutes: 20, kcalPerHour: 480, intensity: '较高', steps: ['骑行'], equipment: ['单车'], entityVersion: 1, createdAt: now, updatedAt: now },
]
const occurrence = {
  id: 'occurrence-1', ruleId: 'rule-1', entityVersion: 3, kind: 'medicine', title: '用户记录的早间用药',
  source: { type: 'catalog-item', id: 'medicine-user' }, quantity: 1, unit: '片', originalDate: '2026-08-18', originalTime: '08:00',
  scheduledDate: '2026-08-18', scheduledTime: '08:00', status: 'planned', completionId: null, createdAt: now, updatedAt: now,
}
const projection = {
  date: '2026-08-18', status: 'complete', plannedNutrition: { energyKcal: 420 }, actualNutrition: {},
  plannedCostMinor: 680, actualCostMinor: 0, plannedEnergyKcal: 340, actualEnergyKcal: 0,
  sourceIds: ['recipe-oats', 'strength'], inventory: [], items: [],
}

type FailureMode = 'none' | 'forbidden' | 'server' | 'conflict' | 'offline'
interface FixtureState {
  read: FailureMode
  mutation: FailureMode
  delayMs: number
  plans: Record<string, any>
  occurrence: typeof occurrence
  writes: string[]
  completionCalls: number
}

function fixtureState(): FixtureState {
  return {
    read: 'none', mutation: 'none', delayMs: 0, occurrence: structuredClone(occurrence), writes: [], completionCalls: 0,
    plans: Object.fromEntries(weekDates.map((date) => [date, {
      id: `plan-${date}`, date, mealSlots: structuredClone(mealSlots),
      items: date === '2026-08-18' ? structuredClone(planItems) : [], entityVersion: date === '2026-08-18' ? 3 : 1,
    }])),
  }
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

function mutationFailure(route: Route, state: FixtureState) {
  if (state.mutation === 'conflict') return json(route, { error: { code: 'VERSION_CONFLICT', message: 'fixture conflict' } }, 409)
  if (state.mutation === 'forbidden') return json(route, { error: { code: 'FORBIDDEN', message: 'fixture forbidden' } }, 403)
  if (state.mutation === 'server') return json(route, { error: { code: 'SERVER_ERROR', message: 'fixture server error' } }, 500)
  if (state.mutation === 'offline') return route.abort('internetdisconnected')
  return null
}

async function installFixture(page: Page, state: FixtureState) {
  await page.clock.setFixedTime(new Date('2026-08-18T12:00:00+08:00'))
  await page.addInitScript((value) => sessionStorage.setItem('lifeops:session:v1', JSON.stringify(value)), session)
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    if (path === '/api/v1/auth/session') return json(route, { user: { id: 'p3-t11-browser', account: session.account, displayName: 'P3-T11 Browser' }, csrfToken: 'csrf-p3-t11' })
    if (path === '/api/v1/state') return json(route, { schemaVersion: 1, plans: [], records: [], reviews: [], knowledge: [], snapshots: [] })
    if (path === '/api/v1/goals' || path === '/api/v1/tasks' || path === '/api/v1/records' || path === '/api/v1/reviews') return json(route, [])
    if (path === '/api/v1/habits') return json(route, { from: url.searchParams.get('from'), to: url.searchParams.get('to'), habits: [], entries: [] })
    if (/^\/api\/v1\/goals\/[^/]+\/projects$/.test(path)) return json(route, [])
    if (method === 'GET' && path.startsWith('/api/v1/life/day-plans/')) {
      if (state.delayMs) await new Promise((resolve) => setTimeout(resolve, state.delayMs))
      if (state.read !== 'none') return json(route, { error: { code: state.read.toUpperCase(), message: 'fixture read failure' } }, state.read === 'forbidden' ? 403 : 500)
      const date = decodeURIComponent(path.split('/')[5] ?? '')
      if (path.endsWith('/projection')) return json(route, { ...projection, date: path.split('/')[5] })
      return json(route, state.plans[date] ?? { ...state.plans['2026-08-18'], id: `plan-${date}`, date, items: [] })
    }
    if (method === 'GET' && path === '/api/v1/life/timeline/2026-08-18') return json(route, {
      date: '2026-08-18',
      timelineItems: [
        ...state.plans['2026-08-18'].items.map((item: any) => ({ ...item, sourceType: 'day-plan-item' })),
        { ...state.occurrence, sourceType: 'medicine-occurrence' },
      ],
    })
    if (method === 'GET' && path.startsWith('/api/v1/life/timeline/')) return json(route, { date: path.split('/').at(-1), timelineItems: [] })
    if (method === 'GET' && path === '/api/v1/life/templates') return json(route, [template])
    if (method === 'GET' && path === '/api/v1/life/fitness') return json(route, activities)
    if (method !== 'GET') {
      const failed = mutationFailure(route, state)
      if (failed) return failed
      state.writes.push(`${method} ${path}`)
    }
    if (method === 'PATCH' && /^\/api\/v1\/life\/day-plans\/\d{4}-\d{2}-\d{2}$/.test(path)) {
      const date = path.split('/').at(-1)!
      const body = request.postDataJSON() as { mealSlots: unknown[]; items: any[] }
      const current = state.plans[date]
      const existing = new Map(current.items.map((item: any) => [item.id, item]))
      current.mealSlots = structuredClone(body.mealSlots)
      current.items = body.items.map((item, index) => {
        const prior = item.id ? existing.get(item.id) as any : undefined
        return {
          ...(prior ?? {}), ...item, id: prior?.id ?? `fixture-new-${index}`, entityVersion: prior ? prior.entityVersion + 1 : 1,
          status: prior?.status ?? 'planned', completionId: prior?.completionId ?? null, actual: prior?.actual ?? null,
          originTemplateItemId: prior?.originTemplateItemId ?? null,
        }
      })
      current.entityVersion += 1
      return json(route, current)
    }
    if (method === 'POST' && path.endsWith('/template-preview')) return json(route, {
      writesApplied: false, templateVersion: 4, dayPlanVersion: state.plans['2026-08-18'].entityVersion,
      conflicts: [{ id: 'conflict-breakfast', existingItemIds: ['meal-1'], incomingTemplateItemId: 'tpl-breakfast', resolution: 'merge' }],
      result: state.plans['2026-08-18'],
    })
    if (method === 'POST' && path.endsWith('/apply-template')) {
      state.plans['2026-08-18'].entityVersion += 1
      return json(route, state.plans['2026-08-18'])
    }
    if (method === 'POST' && path.endsWith('/copy')) return json(route, { ...structuredClone(state.plans['2026-08-18']), id: 'plan-copy', date: request.postDataJSON().targetDate, entityVersion: 1 }, 201)
    if (method === 'POST' && path.endsWith('/sync-preview')) return json(route, {
      writesApplied: false, templateVersion: 4, dayPlanVersions: { '2026-08-19': 1 }, affectedDates: ['2026-08-19'],
      excludedCompletedDates: ['2026-08-20'], changes: [{ date: '2026-08-19', before: [], after: template.items }],
    })
    if (method === 'POST' && path.endsWith('/sync')) return json(route, { affectedDates: ['2026-08-19'], excludedCompletedDates: ['2026-08-20'] })
    if (method === 'PATCH' && path.includes('/medicine-occurrences/')) {
      const body = request.postDataJSON()
      state.occurrence = { ...state.occurrence, entityVersion: state.occurrence.entityVersion + 1, status: body.action === 'skip' ? 'skipped' : 'planned', ...(body.delayedUntil ? { scheduledDate: body.delayedUntil.date, scheduledTime: body.delayedUntil.time } : {}) }
      return json(route, state.occurrence)
    }
    if (method === 'PATCH' && path.includes('/items/')) return json(route, { ...state.plans['2026-08-18'].items.find((item: any) => path.endsWith(item.id)), status: 'completed' })
    if (method === 'POST' && path === '/api/v1/life/completions') {
      state.completionCalls += 1
      await new Promise((resolve) => setTimeout(resolve, 500))
      return json(route, {
        id: 'completion-fitness', dayPlanId: 'plan-2026-08-18', dayPlanItemId: 'fitness-plan', kind: 'fitness',
        completionSource: { type: 'day-plan-item', dayPlanId: 'plan-2026-08-18', dayPlanItemId: 'fitness-plan' },
        source: { type: 'fitness-activity', id: 'strength' }, quantity: null, unit: null, servings: null,
        completedAt: now, nutrition: null, costMinor: null, inventoryTransactionIds: [], actualMinutes: 45,
        estimatedEnergyKcal: 270, energyIsEstimate: true,
      }, 201)
    }
    if (method === 'POST' && path.endsWith('/undo')) return json(route, { completionId: 'completion-fitness', reversedInventoryTransactionIds: [], status: 'planned' })
    return json(route, { error: { code: 'UNHANDLED_FIXTURE_ROUTE', message: `${method} ${path}` } }, 404)
  })
}

async function assertNoHorizontalOverflow(page: Page, width: number) {
  expect(await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))).toEqual({ client: width, scroll: width })
}

test.beforeAll(async () => mkdir(evidenceDir, { recursive: true }))

test('P3-T11 visual gate covers standard viewports, 320 CSS px, 200% zoom and reduced motion', async ({ page }) => {
  test.slow()
  await installFixture(page, fixtureState())
  const viewports = [
    { name: '1440x900', width: 1440, height: 900 },
    { name: '1024x768', width: 1024, height: 768 },
    { name: '768x1024', width: 768, height: 1024 },
    { name: '390x844', width: 390, height: 844 },
    { name: '320x844', width: 320, height: 844 },
  ]
  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    await page.goto('/app/life/plans?week=2026-08-17&day=2026-08-18')
    await expect(page.getByRole('heading', { name: '周生活计划', level: 1 })).toBeVisible()
    await expect(page.getByRole('region', { name: '周计划画布' })).toBeVisible()
    await assertNoHorizontalOverflow(page, viewport.width)
    const visibleColumns = await page.locator('.life-week-canvas > article:visible').count()
    expect(visibleColumns).toBe(viewport.width <= 820 ? 1 : 7)
    if (viewport.width > 820) {
      const rowPositions = await page.locator('.life-week-canvas > article').evaluateAll((elements) => (
        [...new Set(elements.map((element) => Math.round(element.getBoundingClientRect().top)))]
      ))
      expect(rowPositions, `desktop week columns wrapped at ${viewport.name}`).toHaveLength(1)
    }
    await page.screenshot({ path: `${evidenceDir}/plans-${viewport.name}-full-page.png`, fullPage: true })
  }

  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    await page.goto('/app/life/fitness?date=2026-08-18')
    await expect(page.getByRole('heading', { name: '健身计划', level: 1 })).toBeVisible()
    await expect(page.locator('.fitness-workspace__today')).toBeVisible()
    await assertNoHorizontalOverflow(page, viewport.width)
    await page.screenshot({ path: `${evidenceDir}/fitness-${viewport.name}-full-page.png`, fullPage: true })
  }

  await page.setViewportSize({ width: 640, height: 900 })
  await page.goto('/app/life/plans?week=2026-08-17&day=2026-08-18')
  await page.evaluate(() => { document.documentElement.style.zoom = '2' })
  await expect(page.getByRole('heading', { name: '周生活计划', level: 1 })).toBeVisible()
  await page.screenshot({ path: `${evidenceDir}/plans-200-percent-zoom.png`, fullPage: true })

  await page.goto('/app/life/fitness?date=2026-08-18')
  await expect(page.getByRole('heading', { name: '健身计划', level: 1 })).toBeVisible()
  await page.screenshot({ path: `${evidenceDir}/fitness-200-percent-zoom.png`, fullPage: true })

  await page.evaluate(() => { document.documentElement.style.zoom = '1' })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/app/life/plans?week=2026-08-17&day=2026-08-18')
  await expect(page.getByRole('heading', { name: '周生活计划', level: 1 })).toBeVisible()
  await assertNoHorizontalOverflow(page, 390)
  await page.screenshot({ path: `${evidenceDir}/plans-390x844-reduced-motion.png`, fullPage: true })

  await page.goto('/app/life/fitness?date=2026-08-18')
  await expect(page.getByRole('heading', { name: '健身计划', level: 1 })).toBeVisible()
  await assertNoHorizontalOverflow(page, 390)
  await page.screenshot({ path: `${evidenceDir}/fitness-390x844-reduced-motion.png`, fullPage: true })
})

test('P3-T11 scheduling, template, medicine, keyboard, focus and Back flows remain explicit and reversible', async ({ page }) => {
  const state = fixtureState()
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await installFixture(page, state)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/app/life/plans?week=2026-08-17&day=2026-08-18')
  const heading = page.getByRole('heading', { name: '周生活计划', level: 1 })
  await expect(heading).toBeVisible()
  await expect(heading).toBeFocused()

  await page.getByRole('button', { name: '安排未安排的拉伸' }).focus()
  await page.keyboard.press('Enter')
  const placement = page.getByRole('dialog', { name: '安排未安排的拉伸' })
  await expect(placement.getByRole('button', { name: '关闭' })).toBeFocused()
  await placement.getByLabel('餐次').selectOption('dinner')
  await placement.getByLabel('时间').fill('19:10')
  await placement.getByLabel('时长（分钟）').fill('18')
  await placement.getByRole('button', { name: '确认安排' }).click()

  await page.getByRole('button', { name: '编辑燕麦早餐' }).click()
  const mealEditor = page.getByRole('dialog', { name: '编辑燕麦早餐' })
  await mealEditor.getByLabel('份数').fill('1.5')
  await mealEditor.getByLabel('时间').fill('07:40')
  await page.keyboard.press('Escape')
  await expect(mealEditor).toBeHidden()
  await page.getByRole('button', { name: '编辑燕麦早餐' }).click()
  await page.getByRole('dialog', { name: '编辑燕麦早餐' }).getByLabel('份数').fill('1.5')
  await page.getByRole('dialog', { name: '编辑燕麦早餐' }).getByRole('button', { name: '保存本地编辑' }).click()
  await page.getByRole('button', { name: '编辑用户记录的补剂' }).click()
  const supplementEditor = page.getByRole('dialog', { name: '编辑用户记录的补剂' })
  await supplementEditor.getByLabel('关联餐次').selectOption('breakfast')
  await supplementEditor.getByLabel('相对分钟').fill('15')
  await expect(supplementEditor.getByText('早餐后 15 分钟 · 07:45')).toBeVisible()
  await supplementEditor.getByRole('button', { name: '保存本地编辑' }).click()
  await page.getByRole('button', { name: '保存当天计划' }).click()
  await expect.poll(() => state.writes.filter((entry) => entry === 'PATCH /api/v1/life/day-plans/2026-08-18').length).toBe(1)
  await page.screenshot({ path: `${evidenceDir}/filmstrip-01-scheduled-day.png`, fullPage: true })

  await page.getByRole('button', { name: '模板与同步', exact: true }).click()
  const library = page.getByRole('dialog', { name: '模板与同步' })
  await expect(library.getByRole('button', { name: '关闭' })).toBeFocused()
  await library.getByRole('button', { name: '预览工作日模板' }).click()
  const conflict = page.getByRole('dialog', { name: '模板冲突预览' })
  await expect(conflict.getByText('写入尚未发生')).toBeVisible()
  await conflict.getByRole('radio', { name: '合并两边' }).check()
  await page.screenshot({ path: `${evidenceDir}/filmstrip-02-template-conflict.png` })
  await conflict.getByRole('button', { name: '确认应用模板' }).click()
  await page.getByRole('button', { name: '模板与同步', exact: true }).click()
  await page.getByRole('dialog', { name: '模板与同步' }).getByRole('button', { name: '同步工作日模板' }).click()
  const sync = page.getByRole('dialog', { name: '显式同步范围' })
  await sync.getByLabel('同步目标').selectOption('selected')
  await sync.getByLabel('起始日期').fill('2026-08-19')
  await sync.getByLabel('2026-08-19').check()
  await sync.getByRole('button', { name: '预览同步' }).click()
  await expect(sync.getByText('将更新 1 天')).toBeVisible()
  await expect(sync.getByText('已完成而排除：2026-08-20')).toBeVisible()
  await page.screenshot({ path: `${evidenceDir}/filmstrip-03-explicit-sync.png` })
  await sync.getByRole('button', { name: '确认显式同步' }).click()

  await page.getByRole('button', { name: '复制当天计划' }).click()
  const copy = page.getByRole('dialog', { name: '复制当天计划' })
  await expect(copy.getByText('只复制计划字段；不会复制实际完成、历史或库存流水。')).toBeVisible()
  await copy.getByLabel('目标日期').fill('2026-08-24')
  await copy.getByRole('button', { name: '确认复制' }).click()
  await page.getByRole('button', { name: '推迟用户记录的早间用药' }).click()
  const delay = page.getByRole('dialog', { name: '推迟用户记录的早间用药' })
  await delay.getByLabel('新日期').fill('2026-08-19')
  await delay.getByLabel('新时间').fill('09:30')
  await delay.getByRole('button', { name: '确认推迟' }).click()
  await page.getByRole('button', { name: '跳过用户记录的早间用药' }).click()
  await page.getByRole('button', { name: '补记用户记录的晚间用药' }).click()
  await expect(page.getByText('仅记录你提供的时间与状态，不提供诊断、剂量或停药建议。')).toBeVisible()

  await page.goto('/app/life/fitness?date=2026-08-18')
  await expect(page.getByRole('heading', { name: '健身计划', level: 1 })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { name: '周生活计划', level: 1 })).toBeVisible()
  expect(pageErrors).toEqual([])
})

test('P3-T11 fitness composition, duplicate-submit protection, completion facts and undo are durable', async ({ page }) => {
  const state = fixtureState()
  state.plans['2026-08-18'].items = structuredClone(fitnessItems)
  state.plans['2026-08-18'].entityVersion = 2
  await installFixture(page, state)
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto('/app/life/fitness?date=2026-08-18')
  await page.getByRole('checkbox', { name: '选择力量训练' }).check()
  await page.getByRole('checkbox', { name: '选择室内单车' }).check()
  await page.getByRole('button', { name: '加入组合训练' }).click()
  const builder = page.getByRole('dialog', { name: '组合训练' })
  await expect(builder.getByText('计划 50 分钟')).toBeVisible()
  await expect(builder.getByText('预计消耗 340 kcal · 用户估算')).toBeVisible()
  await page.screenshot({ path: `${evidenceDir}/filmstrip-04-fitness-combination.png` })
  await builder.getByRole('button', { name: '加入 2026-08-18' }).click()
  await expect(page.getByText('组合训练已加入当天计划。')).toBeVisible()

  await page.getByRole('button', { name: '完成晚间组合训练' }).click()
  const completionDialog = page.getByRole('dialog', { name: '完成晚间组合训练' })
  await completionDialog.getByLabel('实际时长（分钟）').fill('45')
  await expect(completionDialog.getByText('按用户维护的 360 kcal/小时估算：270 kcal')).toBeVisible()
  const submit = completionDialog.getByRole('button', { name: '确认实际完成' })
  await submit.click()
  const pendingSubmit = completionDialog.getByRole('button', { name: '正在记录…' })
  await expect(pendingSubmit).toBeDisabled()
  await pendingSubmit.evaluate((button: HTMLButtonElement) => button.click())
  await expect.poll(() => state.completionCalls).toBe(1)
  const completed = page.getByRole('status', { name: '健身完成事实' })
  await expect(completed).toContainText('实际 45 分钟')
  await expect(completed).toContainText('270 kcal（用户估算）')
  await completed.screenshot({ path: `${evidenceDir}/filmstrip-05-fitness-completed.png` })
  await completed.getByRole('button', { name: '撤销本次完成' }).click()
  await expect(page.getByText('已撤销完成；计划恢复为未完成。')).toBeVisible()
})

test('P3-T11 loading, 403, 500 retry, conflict and offline failures stay scoped without page errors', async ({ page }) => {
  const state = fixtureState()
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  state.delayMs = 250
  await installFixture(page, state)
  await page.goto('/app/life/plans?week=2026-08-17&day=2026-08-18')
  await expect(page.getByText('正在展开这一周…')).toBeVisible()
  await expect(page.getByRole('heading', { name: '周生活计划', level: 1 })).toBeVisible()

  state.read = 'forbidden'
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('当前账户没有权限')
  state.read = 'server'
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('计划事实暂时无法加载')
  state.read = 'none'
  await page.getByRole('button', { name: '重试周计划' }).click()
  await expect(page.getByRole('heading', { name: '周生活计划', level: 1 })).toBeVisible()

  state.mutation = 'conflict'
  await page.getByRole('button', { name: '保存当天计划' }).click()
  await expect(page.getByRole('alert')).toContainText('计划已在另一处更新')
  await page.locator('.life-plan-write-error').getByRole('button', { name: '关闭', exact: true }).click()
  state.mutation = 'offline'
  await page.getByRole('button', { name: '保存当天计划' }).click()
  await expect(page.getByRole('alert')).toContainText('当前设备离线')
  expect(pageErrors).toEqual([])
})
