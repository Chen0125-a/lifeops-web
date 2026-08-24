import { mkdir } from 'node:fs/promises'
import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test'

const fixtureId = 'p3-t10-recipes-cooking-golden-slice-2026-08-22-v1'
const evidenceDir = 'outputs/evidence/p3-t10-life-recipes-browser-gate'
const now = '2026-08-22T08:00:00.000Z'
const session = { mode: 'local-preview', account: 'p3-t10-browser@lifeops.local', fixtureId }
const nutrition = { energyKcal: 640, proteinGrams: 24, fatGrams: 18, carbohydrateGrams: 92, custom: {} }

const items = [
  { id: 'rice', kind: 'ingredient', name: '米饭', aliases: [], status: 'active', categoryId: null, tagIds: [], locationId: null, baseUnit: 'g', availableUnits: ['g'], itemConversions: [], pricePoints: [], isCookingOil: false, attachments: [], notes: '', customOrder: 0, version: 1, createdAt: now, updatedAt: now, deletedAt: null },
  { id: 'egg', kind: 'ingredient', name: '鸡蛋', aliases: [], status: 'active', categoryId: null, tagIds: [], locationId: null, baseUnit: 'each', availableUnits: ['each'], itemConversions: [], pricePoints: [], isCookingOil: false, attachments: [], notes: '', customOrder: 1, version: 1, createdAt: now, updatedAt: now, deletedAt: null },
  { id: 'milk', kind: 'ingredient', name: '牛奶', aliases: [], status: 'active', categoryId: null, tagIds: [], locationId: null, baseUnit: 'ml', availableUnits: ['ml'], itemConversions: [], pricePoints: [], isCookingOil: false, attachments: [], notes: '', customOrder: 2, version: 1, createdAt: now, updatedAt: now, deletedAt: null },
  { id: 'spinach', kind: 'ingredient', name: '菠菜', aliases: [], status: 'active', categoryId: null, tagIds: [], locationId: null, baseUnit: 'g', availableUnits: ['g'], itemConversions: [], pricePoints: [], isCookingOil: false, attachments: [], notes: '', customOrder: 3, version: 1, createdAt: now, updatedAt: now, deletedAt: null },
]

const units = [
  { id: 'g', code: 'g', name: '克', symbol: 'g', dimension: 'mass', baseCode: 'g', toBaseFactor: 1, version: 1, createdAt: now, updatedAt: now, deletedAt: null, builtIn: true },
  { id: 'ml', code: 'ml', name: '毫升', symbol: 'ml', dimension: 'volume', baseCode: 'ml', toBaseFactor: 1, version: 1, createdAt: now, updatedAt: now, deletedAt: null, builtIn: true },
  { id: 'each', code: 'each', name: '个', symbol: '个', dimension: 'count', baseCode: 'each', toBaseFactor: 1, version: 1, createdAt: now, updatedAt: now, deletedAt: null, builtIn: true },
]

const version1 = {
  id: 'version-1', recipeId: 'recipe-1', number: 1, servings: 4, yieldQuantity: 4, yieldUnit: 'portion',
  components: [
    { id: 'component-rice-v1', itemId: 'rice', quantity: 200, unit: 'g', role: 'ingredient', position: 0 },
    { id: 'component-egg-v1', itemId: 'egg', quantity: 2, unit: 'each', role: 'ingredient', position: 1 },
  ],
  steps: [
    { id: 'step-chop-v1', instruction: '切好配料', ingredientItemIds: ['egg'], durationSeconds: 60, imageMediaId: null, caution: '', position: 0 },
    { id: 'step-cook-v1', instruction: '小火翻炒', ingredientItemIds: ['rice', 'egg'], durationSeconds: 180, imageMediaId: null, caution: '注意热锅', position: 1 },
  ],
  promotedNote: null, createdAt: '2026-08-01T08:00:00.000Z',
}
const version2 = {
  ...version1, id: 'version-2', number: 2, promotedNote: '小火更均匀', createdAt: now,
  components: version1.components.map((component) => ({ ...component, id: `${component.id}-v2` })),
  steps: version1.steps.map((step) => ({ ...step, id: `${step.id}-v2` })),
}
const recipe = { id: 'recipe-1', name: '番茄鸡蛋饭', description: '工作日晚餐', coverMediaId: null, prepMinutes: 8, cookMinutes: 12, difficulty: 'easy', categoryId: null, tagIds: ['weekday'], storageNotes: '冷藏两天', entityVersion: 2, currentVersion: version2, createdAt: '2026-08-01T08:00:00.000Z', updatedAt: now, deletedAt: null }
const incompleteRecipe = { ...recipe, id: 'recipe-incomplete', name: '单位待补全汤', entityVersion: 1, currentVersion: { ...version1, id: 'version-incomplete', recipeId: 'recipe-incomplete', components: [{ ...version1.components[0], id: 'component-milk', itemId: 'milk', quantity: 1, unit: 'g' }] } }
const recipes = [recipe, incompleteRecipe]

const completeCalculation = {
  recipeVersionId: 'version-2', recipeVersionNumber: 2, status: 'complete', servings: 4, scaleFactor: 1,
  ingredients: [
    { itemId: 'rice', quantity: 200, unit: 'g', baseQuantity: 200, costMinor: 240, nutrition: { ...nutrition, energyKcal: 520 }, onHand: 600, shortage: 0 },
    { itemId: 'egg', quantity: 2, unit: 'each', baseQuantity: 2, costMinor: 300, nutrition: { ...nutrition, energyKcal: 120 }, onHand: 6, shortage: 0 },
  ],
  totalCostMinor: 540, perServingCostMinor: 135, totalNutrition: nutrition,
  perServingNutrition: { energyKcal: 160, proteinGrams: 6, fatGrams: 4.5, carbohydrateGrams: 23, custom: {} },
  cookingOilGrams: 8, perServingCookingOilGrams: 2, missing: [],
}
const incompleteCalculation = { recipeVersionId: 'version-incomplete', recipeVersionNumber: 1, status: 'incomplete', servings: 4, scaleFactor: 1, ingredients: [{ itemId: 'milk', quantity: 1, unit: 'g', baseQuantity: null, costMinor: null, nutrition: null, onHand: null, shortage: null }], totalCostMinor: null, perServingCostMinor: null, totalNutrition: null, perServingNutrition: null, cookingOilGrams: null, perServingCookingOilGrams: null, missing: [{ itemId: 'milk', facts: ['conversion'] }] }
const impact = { writesApplied: false, createsVersion: true, nextVersionNumber: 3, futurePlansAffected: 2, diff: { servings: { before: 4, after: 6 }, yield: null, components: [{ itemId: 'rice', change: 'changed', beforeQuantity: 200, afterQuantity: 300, unit: 'g' }], stepsChanged: false, promotedNoteChanged: false }, calculation: { ...completeCalculation, servings: 6, scaleFactor: 1.5, totalCostMinor: 810 } }
const relations = [
  { recipeId: recipe.id, recipeName: recipe.name, recipeVersionId: version2.id, itemId: 'rice', quantity: 200, unit: 'g' },
  { recipeId: recipe.id, recipeName: recipe.name, recipeVersionId: version2.id, itemId: 'egg', quantity: 2, unit: 'each' },
  { recipeId: 'recipe-missing-one', recipeName: '牛奶燕麦', recipeVersionId: 'version-missing-one', itemId: 'rice', quantity: 100, unit: 'g' },
  { recipeId: 'recipe-missing-one', recipeName: '牛奶燕麦', recipeVersionId: 'version-missing-one', itemId: 'milk', quantity: 300, unit: 'ml' },
  { recipeId: 'recipe-expiring', recipeName: '临期菠菜饭', recipeVersionId: 'version-expiring', itemId: 'rice', quantity: 100, unit: 'g' },
  { recipeId: 'recipe-expiring', recipeName: '临期菠菜饭', recipeVersionId: 'version-expiring', itemId: 'spinach', quantity: 100, unit: 'g' },
]
const balances = [
  { itemId: 'rice', baseUnit: 'g', onHand: 600, warnings: [] },
  { itemId: 'egg', baseUnit: 'each', onHand: 6, warnings: [] },
  { itemId: 'milk', baseUnit: 'ml', onHand: 0, warnings: [] },
  { itemId: 'spinach', baseUnit: 'g', onHand: 180, warnings: [] },
]
const transactions = [{ id: 'purchase-spinach', itemId: 'spinach', kind: 'purchase', quantity: 180, unit: 'g', baseQuantity: 180, deltaBaseQuantity: 180, batchId: 'spinach-batch', occurredAt: now, reversesTransactionId: null, reversedByTransactionId: null, warning: null, note: '', allocations: [{ batchId: 'spinach-batch', quantity: 180, expiresOn: '2026-08-24' }], createdAt: now }]
const baseSession = { id: 'session-1', recipeId: recipe.id, recipeVersionId: version2.id, plannedServings: 4, note: '本次少放盐', entityVersion: 1, status: 'active', createdAt: now, completedAt: null, progress: { currentStepIndex: 0, completedStepIds: [], actualIngredients: [{ itemId: 'rice', quantity: 200, unit: 'g', replacesItemId: null }, { itemId: 'egg', quantity: 2, unit: 'each', replacesItemId: null }], timers: [{ stepId: 'step-chop-v1-v2', elapsedSeconds: 0, running: false, startedAt: null }] } }
const completion = { snapshot: { id: 'snapshot-1', cookingSessionId: baseSession.id, recipeId: recipe.id, recipeVersionId: version2.id, madeServings: 4, eatenServings: 1, ingredients: completeCalculation.ingredients.map((ingredient) => ({ ...ingredient, replacesItemId: null })), totalCostMinor: 540, totalNutrition: nutrition, intakeNutrition: { energyKcal: 160, proteinGrams: 6, fatGrams: 4.5, carbohydrateGrams: 23, custom: {} }, cookingOilGrams: 8, intakeCookingOilGrams: 2, completedAt: now }, preparedFood: { id: 'prepared-1', cookingSnapshotId: 'snapshot-1', recipeId: recipe.id, recipeVersionId: version2.id, portionsCreated: 3, portionsRemaining: 3, nutritionRemaining: { energyKcal: 480, proteinGrams: 18, fatGrams: 13.5, carbohydrateGrams: 69, custom: {} }, cookingOilGramsRemaining: 6, costRemainingMinor: 405, createdAt: now }, intake: { servings: 1, nutrition: { energyKcal: 160, proteinGrams: 6, fatGrams: 4.5, carbohydrateGrams: 23, custom: {} }, cookingOilGrams: 2, costMinor: 135 } }

type FailureMode = 'none' | 'conflict' | 'forbidden' | 'server' | 'offline'
interface FixtureState { read: FailureMode; mutation: FailureMode; delayMs: number; activeSession: typeof baseSession }

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function installFixture(page: Page, state: FixtureState) {
  await page.clock.setFixedTime(new Date('2026-08-22T12:00:00+08:00'))
  await page.addInitScript((value) => sessionStorage.setItem('lifeops:session:v1', JSON.stringify(value)), session)
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    if (path === '/api/v1/auth/session') return json(route, { user: { id: 'p3-t10-browser', account: session.account, displayName: 'P3-T10 Browser' }, csrfToken: 'csrf-p3-t10-browser' })
    if (path === '/api/v1/state') return json(route, { schemaVersion: 1, plans: [], records: [], reviews: [], knowledge: [], snapshots: [] })
    if (path === '/api/v1/goals' || path === '/api/v1/tasks' || path === '/api/v1/records' || path === '/api/v1/reviews') return json(route, [])
    if (path === '/api/v1/habits') return json(route, { from: url.searchParams.get('from'), to: url.searchParams.get('to'), habits: [], entries: [] })
    if (/^\/api\/v1\/goals\/[^/]+\/projects$/.test(path)) return json(route, [])
    if (method === 'GET' && path === '/api/v1/life/recipes') {
      if (state.delayMs) await new Promise((resolve) => setTimeout(resolve, state.delayMs))
      if (state.read !== 'none') return json(route, { error: { code: state.read.toUpperCase(), message: 'fixture failure' } }, state.read === 'forbidden' ? 403 : 500)
      return json(route, recipes)
    }
    if (method !== 'GET' && state.mutation === 'conflict') return json(route, { error: { code: 'VERSION_CONFLICT', message: 'fixture conflict' } }, 409)
    if (method !== 'GET' && state.mutation === 'offline') return route.abort('internetdisconnected')
    if (method === 'GET' && path === '/api/v1/life/catalog') return json(route, items)
    if (method === 'GET' && path === '/api/v1/life/units') return json(route, units)
    if (method === 'GET' && path === '/api/v1/life/inventory/balances') return json(route, balances)
    if (method === 'GET' && path === '/api/v1/life/inventory/transactions') return json(route, transactions)
    if (method === 'GET' && path === '/api/v1/life/recipes/relations') return json(route, relations)
    if (method === 'GET' && path === '/api/v1/life/prepared-food') return json(route, [])
    if (method === 'GET' && path === '/api/v1/life/recipes/recipe-1') return json(route, recipe)
    if (method === 'GET' && path === '/api/v1/life/recipes/recipe-incomplete') return json(route, incompleteRecipe)
    if (method === 'GET' && path.endsWith('/versions')) return json(route, [version2, version1])
    if (method === 'GET' && path.endsWith('/calculation')) return json(route, path.includes('recipe-incomplete') ? incompleteCalculation : completeCalculation)
    if (method === 'POST' && path.endsWith('/impact-preview')) return json(route, impact)
    if (method === 'PATCH' && path === '/api/v1/life/recipes/recipe-1') return json(route, { ...recipe, entityVersion: 3, currentVersion: { ...version2, id: 'version-3', number: 3, servings: 6 } })
    if (method === 'POST' && path === '/api/v1/life/cooking-sessions') {
      state.activeSession = { ...baseSession, progress: { ...baseSession.progress, actualIngredients: baseSession.progress.actualIngredients.map((entry) => ({ ...entry })), timers: baseSession.progress.timers.map((entry) => ({ ...entry })) } }
      return json(route, state.activeSession, 201)
    }
    if (method === 'GET' && path === '/api/v1/life/cooking-sessions/session-1') return json(route, state.activeSession)
    if (method === 'PATCH' && path === '/api/v1/life/cooking-sessions/session-1') {
      state.activeSession = { ...state.activeSession, entityVersion: state.activeSession.entityVersion + 1, progress: request.postDataJSON() }
      return json(route, state.activeSession)
    }
    if (method === 'POST' && path.endsWith('/promote-note')) return json(route, { ...version2, id: 'version-3', number: 3, promotedNote: state.activeSession.note })
    if (method === 'POST' && path.endsWith('/complete')) return json(route, completion)
    if (method === 'POST' && path === '/api/v1/life/recipes') return json(route, recipe, 201)
    return json(route, { error: { code: 'UNHANDLED_FIXTURE_ROUTE', message: `${method} ${path}` } }, 404)
  })
}

function fixtureState(): FixtureState {
  return { read: 'none', mutation: 'none', delayMs: 0, activeSession: structuredClone(baseSession) }
}

async function assertNoHorizontalOverflow(page: Page, width: number) {
  expect(await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))).toEqual({ client: width, scroll: width })
}

async function assertOfflinePreview(page: Page, context: BrowserContext, state: FixtureState) {
  state.mutation = 'offline'
  await context.setOffline(true)
  await page.getByRole('button', { name: '预览版本影响' }).click()
  await expect(page.getByRole('alert')).toContainText('当前设备离线')
  await context.setOffline(false)
  state.mutation = 'none'
}

test.beforeAll(async () => mkdir(evidenceDir, { recursive: true }))

test('P3-T10 visual gate covers four standard viewports, 320 CSS px, 200% zoom and reduced motion', async ({ page }) => {
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
    await page.goto('/app/life/recipes?recipe=recipe-1')
    await expect(page.getByRole('heading', { name: '食谱与做菜', level: 1 })).toBeVisible()
    await expect(page.getByRole('region', { name: '番茄鸡蛋饭详情' })).toBeVisible()
    await assertNoHorizontalOverflow(page, viewport.width)
    if (viewport.width <= 1040) {
      expect(await page.locator('.recipe-inspector').evaluate((element) => getComputedStyle(element).position)).toBe('fixed')
      const [headerBox, inspectorBox] = await Promise.all([page.locator('.workspace-header').boundingBox(), page.locator('.recipe-inspector').boundingBox()])
      expect(Math.abs((headerBox!.y + headerBox!.height) - inspectorBox!.y), JSON.stringify({ viewport, headerBox, inspectorBox })).toBeLessThanOrEqual(1)
    }
    await page.screenshot({ path: `${evidenceDir}/recipes-${viewport.name}.png`, fullPage: viewport.width > 1040 })
    if (viewport.width <= 768) {
      await page.getByRole('button', { name: '返回食谱列表' }).click()
      await page.screenshot({ path: `${evidenceDir}/recipe-list-${viewport.name}-full-page.png`, fullPage: true })
    }
  }

  await page.setViewportSize({ width: 640, height: 900 })
  await page.goto('/app/life/recipes?recipe=recipe-1')
  await page.evaluate(() => { document.documentElement.style.zoom = '2' })
  await expect(page.getByRole('region', { name: '番茄鸡蛋饭详情' })).toBeVisible()
  await page.screenshot({ path: `${evidenceDir}/recipes-200-percent-zoom.png` })

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/app/life/recipes?recipe=recipe-incomplete')
  await expect(page.getByText('牛奶：缺少单位换算')).toBeVisible()
  await expect(page.getByRole('button', { name: '开始做菜' })).toBeDisabled()
  await page.screenshot({ path: `${evidenceDir}/recipe-incomplete-390x844-reduced-motion.png` })
})

test('P3-T10 keyboard, focus, Back, scaling, pinned versions, version impact and relations stay reversible', async ({ page }) => {
  await installFixture(page, fixtureState())
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/app/life/recipes')
  const open = page.getByRole('button', { name: '打开食谱 番茄鸡蛋饭' })
  await open.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/recipe=recipe-1/)
  const inspector = page.getByRole('region', { name: '番茄鸡蛋饭详情' })
  await inspector.getByLabel('查看份数').fill('2')
  await expect(inspector.getByRole('link', { name: '米饭' }).locator('..')).toContainText('100 g')
  await inspector.getByRole('button', { name: '查看版本 1' }).click()
  await expect(inspector.getByText('固定版本 1')).toBeVisible()
  await page.screenshot({ path: `${evidenceDir}/filmstrip-01-pinned-version.png`, fullPage: true })

  await inspector.getByRole('button', { name: '编辑食谱' }).click()
  const editor = page.getByRole('dialog', { name: '编辑番茄鸡蛋饭' })
  await expect(editor).toBeVisible()
  expect(await editor.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  await editor.getByLabel('份数').fill('6')
  await editor.getByRole('button', { name: '预览版本影响' }).click()
  const preview = page.getByRole('dialog', { name: '版本影响预览' })
  await expect(preview.getByText('将创建版本 3')).toBeVisible()
  await expect(preview.getByText('影响 2 个未来计划')).toBeVisible()
  await page.screenshot({ path: `${evidenceDir}/filmstrip-02-version-impact.png` })
  await preview.getByRole('button', { name: '返回编辑' }).click()
  await editor.getByRole('button', { name: '关闭编辑器' }).click()

  await inspector.getByRole('button', { name: '查看食谱与食材关系' }).click()
  const relationView = page.getByRole('region', { name: '食谱与食材关系' })
  await relationView.getByRole('button', { name: '查看使用 米饭 的食谱' }).click()
  await relationView.getByRole('button', { name: '只差一项' }).click()
  await expect(relationView.getByRole('button', { name: '打开食谱 牛奶燕麦' })).toBeVisible()
  await relationView.getByRole('button', { name: '优先消耗临期' }).click()
  await expect(relationView.getByRole('button', { name: '打开食谱 临期菠菜饭' })).toBeVisible()
  await relationView.getByRole('button', { name: '关系图' }).click()
  await expect(relationView.getByRole('button', { name: '关系节点 米饭' })).toBeVisible()
  await expect(relationView.getByText('关系列表始终保留为完整入口', { exact: false })).toBeVisible()
  await relationView.getByRole('button', { name: '关系列表' }).click()
  await expect(relationView.getByRole('table', { name: '食谱与食材关系列表' })).toBeVisible()
  await page.screenshot({ path: `${evidenceDir}/filmstrip-03-relations-list.png`, fullPage: true })
  await relationView.getByRole('button', { name: '返回食谱' }).click()
  await expect(page.getByRole('region', { name: '番茄鸡蛋饭详情' })).toBeVisible()
  await page.getByRole('button', { name: '返回食谱列表' }).click()
  await expect(page.getByRole('button', { name: '打开食谱 番茄鸡蛋饭' })).toBeFocused()
  await page.goBack()
  await expect(page).toHaveURL(/recipe=recipe-1/)
})

test('P3-T10 cooking mode persists progress, resumes and previews one factual completion', async ({ page }) => {
  const state = fixtureState()
  await installFixture(page, state)
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto('/app/life/recipes?recipe=recipe-1')
  await page.getByRole('button', { name: '开始做菜' }).click()
  const cooking = page.getByRole('dialog', { name: '做菜模式：番茄鸡蛋饭' })
  await expect(cooking.getByText('第 1 / 2 步')).toBeVisible()
  await page.screenshot({ path: `${evidenceDir}/filmstrip-04-cooking-start.png` })
  await cooking.getByRole('button', { name: '启动计时 切好配料' }).click()
  await cooking.getByRole('spinbutton', { name: /实际用量 米饭/ }).fill('180')
  await cooking.getByRole('button', { name: '保存做菜进度' }).click()
  await cooking.getByRole('button', { name: '退出做菜模式' }).click()
  await page.getByRole('button', { name: '继续做菜' }).click()
  const resumed = page.getByRole('dialog', { name: '做菜模式：番茄鸡蛋饭' })
  await expect(resumed.getByRole('spinbutton', { name: /实际用量 米饭/ })).toHaveValue('180')
  await page.screenshot({ path: `${evidenceDir}/filmstrip-05-cooking-resumed.png` })
  await resumed.getByRole('button', { name: '提升为新版本' }).click()
  await expect(resumed.getByText('已提升为食谱版本 3')).toBeVisible()
  await resumed.getByRole('button', { name: '准备完成' }).click()
  const preview = page.getByRole('dialog', { name: '完成做菜预览' })
  await expect(preview.getByText('将消耗：米饭 180 g；鸡蛋 2 个')).toBeVisible()
  await expect(preview.getByText('剩余成品 3 份')).toBeVisible()
  await expect(preview.getByText('总营养 640 kcal · 总成本 ¥5.40')).toBeVisible()
  await page.screenshot({ path: `${evidenceDir}/filmstrip-06-completion-preview.png` })
  await preview.getByRole('button', { name: '确认完成' }).click()
  await expect(page.getByText('已记录吃掉 1 份，并保存 3 份成品库存。')).toBeVisible()
})

test('P3-T10 loading, 403, 500 retry, conflict and offline failures remain explicit and scoped', async ({ page, context }) => {
  const state = fixtureState()
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  state.delayMs = 250
  await installFixture(page, state)
  await page.goto('/app/life/recipes')
  await expect(page.getByText('正在汇总食谱、库存与关系事实…')).toBeVisible()
  await expect(page.getByRole('button', { name: '打开食谱 番茄鸡蛋饭' })).toBeVisible()

  state.read = 'forbidden'
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('没有查看或修改这个食谱库的权限')
  state.read = 'server'
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('食谱事实暂时无法加载')
  state.read = 'none'
  await page.getByRole('button', { name: '重新加载食谱事实' }).click()
  await expect(page.getByRole('button', { name: '打开食谱 番茄鸡蛋饭' })).toBeVisible()

  await page.getByRole('button', { name: '打开食谱 番茄鸡蛋饭' }).click()
  await page.getByRole('button', { name: '编辑食谱' }).click()
  const editor = page.getByRole('dialog', { name: '编辑番茄鸡蛋饭' })
  state.mutation = 'conflict'
  await editor.getByRole('button', { name: '预览版本影响' }).click()
  await expect(page.getByRole('alert')).toContainText('食谱已在另一处更新')
  await page.getByRole('button', { name: '关闭错误' }).click()
  state.mutation = 'none'
  await assertOfflinePreview(page, context, state)
  expect(pageErrors).toEqual([])
})
