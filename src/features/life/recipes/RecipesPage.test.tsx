import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appRoutes } from '../../../App'
import { queryClient } from '../../../api/queryClient'
import type { CatalogItem, LifeUnit } from '../../../domain/lifeCatalog'
import type { InventoryBalance, InventoryTransaction } from '../../../domain/lifeInventory'
import type { CookingCompletionResult, CookingSession, Recipe, RecipeImpactPreview, RecipeRelation, StoredRecipeCalculation } from '../../../domain/lifeRecipes'
import { LOCAL_SESSION_KEY } from '../../../state/AuthContext'

const { recipesApi, catalogApi, inventoryApi } = vi.hoisted(() => ({
  recipesApi: {
    list: vi.fn(),
    get: vi.fn(),
    listVersions: vi.fn(),
    calculate: vi.fn(),
    listRelations: vi.fn(),
    listPreparedFood: vi.fn(),
    getCookingSession: vi.fn(),
    create: vi.fn(),
    previewImpact: vi.fn(),
    update: vi.fn(),
    createCookingSession: vi.fn(),
    updateCookingSession: vi.fn(),
    promoteCookingNote: vi.fn(),
    completeCookingSession: vi.fn(),
  },
  catalogApi: { list: vi.fn(), listUnits: vi.fn() },
  inventoryApi: { listBalances: vi.fn(), listTransactions: vi.fn() },
}))

vi.mock('../../../api/lifeRecipesApi', () => ({ lifeRecipesApi: recipesApi }))
vi.mock('../../../api/lifeCatalogApi', () => ({ lifeCatalogApi: catalogApi }))
vi.mock('../../../api/lifeInventoryApi', () => ({ lifeInventoryApi: inventoryApi }))

const now = '2026-08-22T08:00:00.000Z'
const nutrition = { energyKcal: 640, proteinGrams: 24, fatGrams: 18, carbohydrateGrams: 92, custom: {} }

function catalogItem(input: Pick<CatalogItem, 'id' | 'name' | 'baseUnit'> & Partial<CatalogItem>): CatalogItem {
  return {
    kind: 'ingredient', aliases: [], status: 'active', categoryId: null, tagIds: [], locationId: null,
    availableUnits: [input.baseUnit], itemConversions: [], pricePoints: [], isCookingOil: false,
    attachments: [], notes: '', customOrder: 0, version: 1, createdAt: now, updatedAt: now, deletedAt: null,
    ...input,
  }
}

const items: CatalogItem[] = [
  catalogItem({ id: 'rice', name: '米饭', baseUnit: 'g', availableUnits: ['g'] }),
  catalogItem({ id: 'egg', name: '鸡蛋', baseUnit: 'each', availableUnits: ['each'] }),
  catalogItem({ id: 'milk', name: '牛奶', baseUnit: 'ml', availableUnits: ['ml'] }),
  catalogItem({ id: 'spinach', name: '菠菜', baseUnit: 'g', availableUnits: ['g'] }),
]

const units: LifeUnit[] = [
  { id: 'g', code: 'g', name: '克', symbol: 'g', dimension: 'mass', baseCode: 'g', toBaseFactor: 1, version: 1, createdAt: now, updatedAt: now, deletedAt: null, builtIn: true },
  { id: 'ml', code: 'ml', name: '毫升', symbol: 'ml', dimension: 'volume', baseCode: 'ml', toBaseFactor: 1, version: 1, createdAt: now, updatedAt: now, deletedAt: null, builtIn: true },
  { id: 'each', code: 'each', name: '个', symbol: '个', dimension: 'count', baseCode: 'each', toBaseFactor: 1, version: 1, createdAt: now, updatedAt: now, deletedAt: null, builtIn: true },
]

const version1 = {
  id: 'version-1', recipeId: 'recipe-1', number: 1, servings: 4, yieldQuantity: 4, yieldUnit: 'portion',
  components: [
    { id: 'component-rice-v1', itemId: 'rice', quantity: 200, unit: 'g', role: 'ingredient' as const, position: 0 },
    { id: 'component-egg-v1', itemId: 'egg', quantity: 2, unit: 'each', role: 'ingredient' as const, position: 1 },
  ],
  steps: [
    { id: 'step-chop-v1', instruction: '切好配料', ingredientItemIds: ['egg'], durationSeconds: 60, imageMediaId: null, caution: '', position: 0 },
    { id: 'step-cook-v1', instruction: '小火翻炒', ingredientItemIds: ['rice', 'egg'], durationSeconds: 180, imageMediaId: null, caution: '注意热锅', position: 1 },
  ],
  promotedNote: null, createdAt: '2026-08-01T08:00:00.000Z',
}

const version2 = {
  ...version1,
  id: 'version-2', number: 2, servings: 4, promotedNote: '小火更均匀', createdAt: now,
  components: version1.components.map((component) => ({ ...component, id: `${component.id}-v2` })),
  steps: version1.steps.map((step) => ({ ...step, id: `${step.id}-v2` })),
}

const recipe: Recipe = {
  id: 'recipe-1', name: '番茄鸡蛋饭', description: '工作日晚餐', coverMediaId: null,
  prepMinutes: 8, cookMinutes: 12, difficulty: 'easy', categoryId: null, tagIds: ['weekday'], storageNotes: '冷藏两天',
  entityVersion: 2, currentVersion: version2, createdAt: '2026-08-01T08:00:00.000Z', updatedAt: now, deletedAt: null,
}

const incompleteRecipe: Recipe = {
  ...recipe, id: 'recipe-incomplete', name: '单位待补全汤', entityVersion: 1,
  currentVersion: { ...version1, id: 'version-incomplete', recipeId: 'recipe-incomplete', components: [{ ...version1.components[0], id: 'component-milk', itemId: 'milk', quantity: 1, unit: 'g' }] },
}

const completeCalculation: StoredRecipeCalculation = {
  recipeVersionId: 'version-2', recipeVersionNumber: 2, status: 'complete', servings: 4, scaleFactor: 1,
  ingredients: [
    { itemId: 'rice', quantity: 200, unit: 'g', baseQuantity: 200, costMinor: 240, nutrition: { ...nutrition, energyKcal: 520 }, onHand: 600, shortage: 0 },
    { itemId: 'egg', quantity: 2, unit: 'each', baseQuantity: 2, costMinor: 300, nutrition: { ...nutrition, energyKcal: 120 }, onHand: 6, shortage: 0 },
  ],
  totalCostMinor: 540, perServingCostMinor: 135, totalNutrition: nutrition,
  perServingNutrition: { energyKcal: 160, proteinGrams: 6, fatGrams: 4.5, carbohydrateGrams: 23, custom: {} },
  cookingOilGrams: 8, perServingCookingOilGrams: 2, missing: [],
}

const incompleteCalculation: StoredRecipeCalculation = {
  recipeVersionId: 'version-incomplete', recipeVersionNumber: 1, status: 'incomplete', servings: 4, scaleFactor: 1,
  ingredients: [{ itemId: 'milk', quantity: 1, unit: 'g', baseQuantity: null, costMinor: null, nutrition: null, onHand: null, shortage: null }],
  totalCostMinor: null, perServingCostMinor: null, totalNutrition: null, perServingNutrition: null,
  cookingOilGrams: null, perServingCookingOilGrams: null, missing: [{ itemId: 'milk', facts: ['conversion'] }],
}

const impact: RecipeImpactPreview = {
  writesApplied: false, createsVersion: true, nextVersionNumber: 3, futurePlansAffected: 2,
  diff: {
    servings: { before: 4, after: 6 }, yield: null,
    components: [{ itemId: 'rice', change: 'changed', beforeQuantity: 200, afterQuantity: 300, unit: 'g' }],
    stepsChanged: false, promotedNoteChanged: false,
  },
  calculation: { ...completeCalculation, servings: 6, scaleFactor: 1.5, totalCostMinor: 810 },
}

const activeSession: CookingSession = {
  id: 'session-1', recipeId: recipe.id, recipeVersionId: version2.id, plannedServings: 4,
  note: '本次少放盐', entityVersion: 1, status: 'active', createdAt: now, completedAt: null,
  progress: {
    currentStepIndex: 0, completedStepIds: [],
    actualIngredients: [
      { itemId: 'rice', quantity: 200, unit: 'g', replacesItemId: null },
      { itemId: 'egg', quantity: 2, unit: 'each', replacesItemId: null },
    ],
    timers: [{ stepId: 'step-chop-v1-v2', elapsedSeconds: 0, running: false, startedAt: null }],
  },
}

const completion: CookingCompletionResult = {
  snapshot: {
    id: 'snapshot-1', cookingSessionId: activeSession.id, recipeId: recipe.id, recipeVersionId: version2.id,
    madeServings: 4, eatenServings: 1,
    ingredients: completeCalculation.ingredients.map((ingredient) => ({ ...ingredient, replacesItemId: null })),
    totalCostMinor: 540, totalNutrition: nutrition,
    intakeNutrition: { energyKcal: 160, proteinGrams: 6, fatGrams: 4.5, carbohydrateGrams: 23, custom: {} },
    cookingOilGrams: 8, intakeCookingOilGrams: 2, completedAt: now,
  },
  preparedFood: {
    id: 'prepared-1', cookingSnapshotId: 'snapshot-1', recipeId: recipe.id, recipeVersionId: version2.id,
    portionsCreated: 3, portionsRemaining: 3,
    nutritionRemaining: { energyKcal: 480, proteinGrams: 18, fatGrams: 13.5, carbohydrateGrams: 69, custom: {} },
    cookingOilGramsRemaining: 6, costRemainingMinor: 405, createdAt: now,
  },
  intake: { servings: 1, nutrition: { energyKcal: 160, proteinGrams: 6, fatGrams: 4.5, carbohydrateGrams: 23, custom: {} }, cookingOilGrams: 2, costMinor: 135 },
}

const relations: RecipeRelation[] = [
  { recipeId: recipe.id, recipeName: recipe.name, recipeVersionId: version2.id, itemId: 'rice', quantity: 200, unit: 'g' },
  { recipeId: recipe.id, recipeName: recipe.name, recipeVersionId: version2.id, itemId: 'egg', quantity: 2, unit: 'each' },
  { recipeId: 'recipe-missing-one', recipeName: '牛奶燕麦', recipeVersionId: 'version-missing-one', itemId: 'rice', quantity: 100, unit: 'g' },
  { recipeId: 'recipe-missing-one', recipeName: '牛奶燕麦', recipeVersionId: 'version-missing-one', itemId: 'milk', quantity: 300, unit: 'ml' },
  { recipeId: 'recipe-expiring', recipeName: '临期菠菜饭', recipeVersionId: 'version-expiring', itemId: 'rice', quantity: 100, unit: 'g' },
  { recipeId: 'recipe-expiring', recipeName: '临期菠菜饭', recipeVersionId: 'version-expiring', itemId: 'spinach', quantity: 100, unit: 'g' },
]

const balances: InventoryBalance[] = [
  { itemId: 'rice', baseUnit: 'g', onHand: 600, warnings: [] },
  { itemId: 'egg', baseUnit: 'each', onHand: 6, warnings: [] },
  { itemId: 'milk', baseUnit: 'ml', onHand: 0, warnings: [] },
  { itemId: 'spinach', baseUnit: 'g', onHand: 180, warnings: [] },
]

const transactions: InventoryTransaction[] = [{
  id: 'purchase-spinach', itemId: 'spinach', kind: 'purchase', quantity: 180, unit: 'g', baseQuantity: 180,
  deltaBaseQuantity: 180, batchId: 'spinach-batch', occurredAt: now, reversesTransactionId: null, reversedByTransactionId: null,
  warning: null, note: '', allocations: [{ batchId: 'spinach-batch', quantity: 180, expiresOn: '2026-08-24' }], createdAt: now,
}]

function renderRoute(path = '/app/life/recipes') {
  sessionStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ mode: 'local-preview', account: 'owner@example.com' }))
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  return { router, ...render(<RouterProvider router={router} />) }
}

describe('recipe library, relations and cooking mode', () => {
  beforeEach(() => {
    queryClient.clear()
    recipesApi.list.mockReset().mockResolvedValue([recipe, incompleteRecipe])
    recipesApi.get.mockReset().mockImplementation((id: string) => Promise.resolve(id === incompleteRecipe.id ? incompleteRecipe : recipe))
    recipesApi.listVersions.mockReset().mockResolvedValue([version2, version1])
    recipesApi.calculate.mockReset().mockImplementation((id: string, input: { mode: string; versionId?: string }) => {
      if (id === incompleteRecipe.id) return Promise.resolve(incompleteCalculation)
      return Promise.resolve({ ...completeCalculation, recipeVersionId: input.versionId ?? version2.id, recipeVersionNumber: input.versionId === version1.id ? 1 : 2 })
    })
    recipesApi.listRelations.mockReset().mockResolvedValue(relations)
    recipesApi.listPreparedFood.mockReset().mockResolvedValue([])
    recipesApi.getCookingSession.mockReset().mockResolvedValue(activeSession)
    recipesApi.create.mockReset().mockResolvedValue(recipe)
    recipesApi.previewImpact.mockReset().mockResolvedValue(impact)
    recipesApi.update.mockReset().mockResolvedValue({ ...recipe, entityVersion: 3 })
    recipesApi.createCookingSession.mockReset().mockResolvedValue(activeSession)
    recipesApi.updateCookingSession.mockReset().mockImplementation((_id: string, input: CookingSession['progress'] & { entityVersion: number }) => Promise.resolve({ ...activeSession, entityVersion: input.entityVersion + 1, progress: input }))
    recipesApi.promoteCookingNote.mockReset().mockResolvedValue({ ...version2, id: 'version-3', number: 3, promotedNote: activeSession.note })
    recipesApi.completeCookingSession.mockReset().mockResolvedValue(completion)
    catalogApi.list.mockReset().mockResolvedValue(items)
    catalogApi.listUnits.mockReset().mockResolvedValue(units)
    inventoryApi.listBalances.mockReset().mockResolvedValue(balances)
    inventoryApi.listTransactions.mockReset().mockResolvedValue(transactions)
  })

  it('creates a multi-ingredient draft, refuses incompatible units and exposes keyboard step ordering', async () => {
    const user = userEvent.setup()
    renderRoute()

    expect(await screen.findByRole('heading', { name: '食谱与做菜', level: 1 })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '新建食谱' }))
    const editor = screen.getByRole('dialog', { name: '新建食谱' })
    await user.type(within(editor).getByLabelText('食谱名称'), '周末双拼饭')
    await user.clear(within(editor).getByLabelText('份数'))
    await user.type(within(editor).getByLabelText('份数'), '4')
    await user.selectOptions(within(editor).getByLabelText('食材 1'), 'rice')
    await user.clear(within(editor).getByLabelText('数量 1'))
    await user.type(within(editor).getByLabelText('数量 1'), '200')
    await user.selectOptions(within(editor).getByLabelText('单位 1'), 'g')
    await user.click(within(editor).getByRole('button', { name: '再加一种食材' }))
    await user.selectOptions(within(editor).getByLabelText('食材 2'), 'milk')
    await user.selectOptions(within(editor).getByLabelText('单位 2'), 'g')
    expect(within(editor).getByRole('alert')).toHaveTextContent('牛奶不支持 g 换算')
    expect(within(editor).getByRole('button', { name: '创建草稿' })).toBeDisabled()

    await user.selectOptions(within(editor).getByLabelText('食材 2'), 'egg')
    await user.selectOptions(within(editor).getByLabelText('单位 2'), 'each')
    await user.clear(within(editor).getByLabelText('数量 2'))
    await user.type(within(editor).getByLabelText('数量 2'), '2')
    await user.type(within(editor).getByLabelText('步骤 1'), '先处理米饭')
    await user.click(within(editor).getByRole('button', { name: '添加步骤' }))
    await user.type(within(editor).getByLabelText('步骤 2'), '再加入鸡蛋')
    await user.click(within(editor).getByRole('button', { name: '上移步骤 2' }))
    expect(within(editor).getAllByRole('textbox', { name: /^步骤 \d$/ }).map((field) => (field as HTMLTextAreaElement).value)).toEqual(['再加入鸡蛋', '先处理米饭'])
    await user.click(within(editor).getByRole('button', { name: '创建草稿' }))

    await waitFor(() => expect(recipesApi.create).toHaveBeenCalledWith(expect.objectContaining({
      name: '周末双拼饭', servings: 4,
      components: [
        expect.objectContaining({ itemId: 'rice', quantity: 200, unit: 'g', position: 0 }),
        expect.objectContaining({ itemId: 'egg', quantity: 2, unit: 'each', position: 1 }),
      ],
      steps: [
        expect.objectContaining({ instruction: '再加入鸡蛋', position: 0 }),
        expect.objectContaining({ instruction: '先处理米饭', position: 1 }),
      ],
    }), expect.any(String), undefined))
  }, 20_000)

  it('scales the selected version, opens pinned history and previews version impact before saving', async () => {
    const user = userEvent.setup()
    renderRoute('/app/life/recipes?recipe=recipe-1')

    const inspector = await screen.findByRole('region', { name: '番茄鸡蛋饭详情' })
    expect(within(inspector).getByText('版本 2')).toBeVisible()
    await user.clear(within(inspector).getByLabelText('查看份数'))
    await user.type(within(inspector).getByLabelText('查看份数'), '2')
    expect(within(inspector).getByRole('link', { name: '米饭' }).closest('li')).toHaveTextContent('米饭100 g')
    expect(within(inspector).getByRole('link', { name: '鸡蛋' }).closest('li')).toHaveTextContent('鸡蛋1 个')

    await user.click(within(inspector).getByRole('button', { name: '查看版本 1' }))
    await waitFor(() => expect(recipesApi.calculate).toHaveBeenCalledWith(recipe.id, expect.objectContaining({ mode: 'pinned', versionId: version1.id }), expect.anything()))
    expect(within(inspector).getByText('固定版本 1')).toBeVisible()

    await user.click(within(inspector).getByRole('button', { name: '编辑食谱' }))
    const editor = screen.getByRole('dialog', { name: '编辑番茄鸡蛋饭' })
    await user.clear(within(editor).getByLabelText('份数'))
    await user.type(within(editor).getByLabelText('份数'), '6')
    await user.click(within(editor).getByRole('button', { name: '预览版本影响' }))
    const preview = await screen.findByRole('dialog', { name: '版本影响预览' })
    expect(within(preview).getByText('将创建版本 3')).toBeVisible()
    expect(within(preview).getByText('影响 2 个未来计划')).toBeVisible()
    expect(within(preview).getByText('米饭：200 → 300 g')).toBeVisible()
    expect(recipesApi.update).not.toHaveBeenCalled()
    await user.click(within(preview).getByRole('button', { name: '保存新版本' }))
    await waitFor(() => expect(recipesApi.update).toHaveBeenCalledWith(recipe.id, expect.objectContaining({ servings: 6, entityVersion: 2 }), undefined))
  })

  it('keeps incomplete conversion, nutrition or price facts visible and blocks cooking', async () => {
    const user = userEvent.setup()
    const { router } = renderRoute('/app/life/recipes?recipe=recipe-incomplete')

    const inspector = await screen.findByRole('region', { name: '单位待补全汤详情' })
    expect(within(inspector).getByText('计算尚不完整')).toBeVisible()
    expect(within(inspector).getByText('牛奶：缺少单位换算')).toBeVisible()
    expect(within(inspector).getByRole('button', { name: '开始做菜' })).toBeDisabled()
    await user.click(within(inspector).getByRole('link', { name: '补全牛奶资料' }))
    expect(`${router.state.location.pathname}${router.state.location.search}`).toBe('/app/life/ingredients?item=milk')
  })

  it('persists cooking progress and timers, confirms actual quantities, then previews leftovers before one completion', async () => {
    const user = userEvent.setup()
    renderRoute('/app/life/recipes?recipe=recipe-1')
    const inspector = await screen.findByRole('region', { name: '番茄鸡蛋饭详情' })
    await user.click(within(inspector).getByRole('button', { name: '开始做菜' }))

    const cooking = await screen.findByRole('dialog', { name: '做菜模式：番茄鸡蛋饭' })
    expect(within(cooking).getByRole('button', { name: '退出做菜模式' })).toBeVisible()
    expect(within(cooking).getByText('第 1 / 2 步')).toBeVisible()
    await user.click(within(cooking).getByRole('button', { name: '启动计时 切好配料' }))
    await user.clear(within(cooking).getByRole('spinbutton', { name: /实际用量 米饭/ }))
    await user.type(within(cooking).getByRole('spinbutton', { name: /实际用量 米饭/ }), '180')
    await user.click(within(cooking).getByRole('button', { name: '保存做菜进度' }))
    await waitFor(() => expect(recipesApi.updateCookingSession).toHaveBeenCalledWith(activeSession.id, expect.objectContaining({
      actualIngredients: expect.arrayContaining([expect.objectContaining({ itemId: 'rice', quantity: 180 })]),
      timers: expect.arrayContaining([expect.objectContaining({ running: true })]),
    }), undefined))

    await user.click(within(cooking).getByRole('button', { name: '退出做菜模式' }))
    await user.click(screen.getByRole('button', { name: '继续做菜' }))
    await waitFor(() => expect(recipesApi.getCookingSession).toHaveBeenCalledWith(activeSession.id, expect.anything()))
    expect(await screen.findByDisplayValue('200')).toBeVisible()

    const resumed = screen.getByRole('dialog', { name: '做菜模式：番茄鸡蛋饭' })
    await user.click(within(resumed).getByRole('button', { name: '准备完成' }))
    const preview = screen.getByRole('dialog', { name: '完成做菜预览' })
    await user.clear(within(preview).getByLabelText('实际做成份数'))
    await user.type(within(preview).getByLabelText('实际做成份数'), '4')
    await user.clear(within(preview).getByLabelText('已吃份数'))
    await user.type(within(preview).getByLabelText('已吃份数'), '1')
    expect(within(preview).getByText('将消耗：米饭 200 g；鸡蛋 2 个')).toBeVisible()
    expect(within(preview).getByText('剩余成品 3 份')).toBeVisible()
    expect(within(preview).getByText('总营养 640 kcal · 总成本 ¥5.40')).toBeVisible()
    await user.click(within(preview).getByRole('button', { name: '确认完成' }))
    await waitFor(() => expect(recipesApi.completeCookingSession).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('已记录吃掉 1 份，并保存 3 份成品库存。')).toBeVisible()
  })

  it('keeps the cooking note session-only until the user explicitly promotes it', async () => {
    const user = userEvent.setup()
    renderRoute('/app/life/recipes?recipe=recipe-1')
    await user.click(within(await screen.findByRole('region', { name: '番茄鸡蛋饭详情' })).getByRole('button', { name: '开始做菜' }))
    const cooking = await screen.findByRole('dialog', { name: '做菜模式：番茄鸡蛋饭' })
    expect(within(cooking).getByText('本次心得：本次少放盐')).toBeVisible()
    expect(within(cooking).getByText('仅本次做菜可见，尚未改变食谱版本。')).toBeVisible()
    expect(recipesApi.promoteCookingNote).not.toHaveBeenCalled()
    await user.click(within(cooking).getByRole('button', { name: '提升为新版本' }))
    await waitFor(() => expect(recipesApi.promoteCookingNote).toHaveBeenCalledWith(activeSession.id, recipe.entityVersion, expect.any(String), undefined))
    expect(await within(cooking).findByText('已提升为食谱版本 3')).toBeVisible()
  })

  it('supports recipe-to-ingredient and ingredient-to-recipe navigation with factual feasibility filters and a list fallback', async () => {
    const user = userEvent.setup()
    renderRoute('/app/life/recipes?recipe=recipe-1')
    const inspector = await screen.findByRole('region', { name: '番茄鸡蛋饭详情' })
    await user.click(within(inspector).getByRole('button', { name: '查看食谱与食材关系' }))
    const relationsView = await screen.findByRole('region', { name: '食谱与食材关系' })
    expect(within(relationsView).getByRole('link', { name: '打开食材 米饭' })).toHaveAttribute('href', '/app/life/ingredients?item=rice')
    await user.click(within(relationsView).getByRole('button', { name: '查看使用 米饭 的食谱' }))
    expect(await within(relationsView).findByRole('button', { name: '打开食谱 番茄鸡蛋饭' })).toBeVisible()

    await user.click(within(relationsView).getByRole('button', { name: '现在能做' }))
    expect(within(relationsView).getByRole('button', { name: '打开食谱 番茄鸡蛋饭' })).toBeVisible()
    expect(within(relationsView).queryByText('牛奶燕麦')).not.toBeInTheDocument()
    await user.click(within(relationsView).getByRole('button', { name: '只差一项' }))
    expect(within(relationsView).getByText('牛奶燕麦')).toBeVisible()
    await user.click(within(relationsView).getByRole('button', { name: '优先消耗临期' }))
    expect(within(relationsView).getByText('临期菠菜饭')).toBeVisible()

    await user.click(within(relationsView).getByRole('button', { name: '关系图' }))
    expect(within(relationsView).getByRole('button', { name: '关系节点 米饭' })).toBeVisible()
    expect(within(relationsView).getByText('关系较密，关系列表始终保留为完整入口。')).toBeVisible()
    await user.click(within(relationsView).getByRole('button', { name: '关系列表' }))
    expect(within(relationsView).getByRole('table', { name: '食谱与食材关系列表' })).toBeVisible()
  })

  it('keeps the inspector route-addressable and restores focus to the originating list row on return', async () => {
    const user = userEvent.setup()
    const { router } = renderRoute()
    const open = await screen.findByRole('button', { name: '打开食谱 番茄鸡蛋饭' })
    open.focus()
    await user.click(open)
    await waitFor(() => expect(router.state.location.search).toContain('recipe=recipe-1'))
    const inspector = screen.getByRole('region', { name: '番茄鸡蛋饭详情' })
    await user.click(within(inspector).getByRole('button', { name: '返回食谱列表' }))
    await waitFor(() => expect(router.state.location.search).not.toContain('recipe='))
    await waitFor(() => expect(screen.getByRole('button', { name: '打开食谱 番茄鸡蛋饭' })).toHaveFocus())
  })
})
