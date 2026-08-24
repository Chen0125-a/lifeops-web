import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appRoutes } from '../../../App'
import { queryClient } from '../../../api/queryClient'
import type { CatalogItem, LifeUnit, TaxonomyEntity } from '../../../domain/lifeCatalog'
import type { InventoryBalance, InventoryForecast, InventoryTransaction } from '../../../domain/lifeInventory'
import { LOCAL_SESSION_KEY } from '../../../state/AuthContext'

const { catalogApi, inventoryApi } = vi.hoisted(() => ({
  catalogApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    batchUpdate: vi.fn(),
    deleteImpact: vi.fn(),
    remove: vi.fn(),
    listTrash: vi.fn(),
    restore: vi.fn(),
    listTaxonomy: vi.fn(),
    createTaxonomy: vi.fn(),
    updateTaxonomy: vi.fn(),
    removeTaxonomy: vi.fn(),
    restoreTaxonomy: vi.fn(),
    listUnits: vi.fn(),
    createUnit: vi.fn(),
    updateUnit: vi.fn(),
    removeUnit: vi.fn(),
    restoreUnit: vi.fn(),
  },
  inventoryApi: {
    listBalances: vi.fn(),
    listTransactions: vi.fn(),
    listForecasts: vi.fn(),
    createTransaction: vi.fn(),
    reverseTransaction: vi.fn(),
  },
}))

vi.mock('../../../api/lifeCatalogApi', () => ({ lifeCatalogApi: catalogApi }))
vi.mock('../../../api/lifeInventoryApi', () => ({ lifeInventoryApi: inventoryApi }))

const timestamp = '2026-08-21T09:00:00.000Z'

function item(input: Partial<CatalogItem> & Pick<CatalogItem, 'id' | 'kind' | 'name' | 'baseUnit'>): CatalogItem {
  return {
    aliases: [],
    status: 'active',
    categoryId: null,
    tagIds: [],
    locationId: null,
    availableUnits: [input.baseUnit],
    itemConversions: [],
    pricePoints: [],
    isCookingOil: false,
    attachments: [],
    notes: '',
    customOrder: 10,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    ...input,
  }
}

const catalog: CatalogItem[] = [
  item({
    id: 'oat',
    kind: 'ingredient',
    name: '燕麦',
    baseUnit: 'g',
    categoryId: 'dry-goods',
    locationId: 'pantry',
    availableUnits: ['g', 'box'],
    itemConversions: [{ itemId: 'oat', fromUnit: 'box', toUnit: 'g', factor: 500 }],
    pricePoints: [{ id: 'price-oat', amountMinor: 1890, currency: 'CNY', purchaseQuantity: 1, purchaseUnit: 'box', effectiveFrom: '2026-08-01' }],
    nutrition: {
      basisQuantity: 100,
      basisUnit: 'g',
      values: { energyKcal: 367, proteinGrams: 15, fatGrams: 7, carbohydrateGrams: 61, custom: { 膳食纤维: 10 } },
    },
  }),
  item({ id: 'milk', kind: 'ingredient', name: '牛奶', baseUnit: 'ml', categoryId: 'fresh', locationId: 'fridge', availableUnits: ['ml', 'carton'] }),
  item({
    id: 'vitamin-d',
    kind: 'supplement',
    name: '维生素 D',
    baseUnit: 'tablet',
    categoryId: 'supplements',
    profile: {
      kind: 'supplement',
      servingQuantity: 1,
      servingUnit: 'tablet',
      ingredients: ['维生素 D3'],
      defaultFrequency: '每日一次',
      userInstructions: '这是我自己记录的随早餐服用说明',
      reminder: { enabled: true, localTimes: ['08:00'], note: '用户自定义提醒' },
    },
  }),
  item({
    id: 'cold-tablet',
    kind: 'medicine',
    name: '用户记录的感冒片',
    baseUnit: 'tablet',
    categoryId: 'medicine',
    medicine: {
      tradeName: '家庭药箱记录',
      genericName: '用户录入通用名',
      specification: '12 片/盒',
      dosageForm: '片剂',
      packageDescription: '铝塑板',
      userInstructions: '仅记录包装上的原文，不代表医疗建议',
      userScheduleText: '用户自定义：需要时查看记录',
      asNeeded: true,
    },
  }),
  item({
    id: 'detergent',
    kind: 'household_consumable',
    name: '洗衣液',
    baseUnit: 'ml',
    categoryId: 'cleaning',
    profile: { kind: 'household_consumable', defaultPurchaseQuantity: 2, defaultPurchaseUnit: 'bottle', consumptionCycleDays: 45, estimatedDepletionDate: '2026-09-15' },
  }),
  item({
    id: 'vacuum',
    kind: 'household_durable',
    name: '吸尘器',
    baseUnit: 'each',
    categoryId: 'appliance',
    profile: {
      kind: 'household_durable',
      valueMinor: 229900,
      currency: 'CNY',
      valueAsOfDate: '2026-08-01',
      lifecycleStatus: 'maintenance',
      acquiredOn: '2025-03-01',
      warrantyExpiresOn: '2027-03-01',
      maintenanceRecords: [{ id: 'maintenance-1', performedOn: '2026-07-18', summary: '更换滤芯', costMinor: 12900, currency: 'CNY' }],
      setItemIds: ['filter'],
    },
  }),
]

const taxonomy: TaxonomyEntity[] = [
  { id: 'fresh', kind: 'category', name: '生鲜', parentId: null, status: 'active', position: 10, version: 1, createdAt: timestamp, updatedAt: timestamp, deletedAt: null },
  { id: 'protein', kind: 'category', name: '蛋白质', parentId: 'fresh', status: 'active', position: 20, version: 1, createdAt: timestamp, updatedAt: timestamp, deletedAt: null },
  { id: 'dry-goods', kind: 'category', name: '干货', parentId: null, status: 'active', position: 30, version: 1, createdAt: timestamp, updatedAt: timestamp, deletedAt: null },
  { id: 'fridge', kind: 'location', name: '冷藏层', parentId: null, status: 'active', position: 10, version: 1, createdAt: timestamp, updatedAt: timestamp, deletedAt: null },
  { id: 'pantry', kind: 'location', name: '食品柜', parentId: null, status: 'active', position: 20, version: 1, createdAt: timestamp, updatedAt: timestamp, deletedAt: null },
  { id: 'breakfast', kind: 'tag', name: '早餐', parentId: null, status: 'active', position: 10, version: 1, createdAt: timestamp, updatedAt: timestamp, deletedAt: null },
]

const units: LifeUnit[] = [
  { id: 'g', code: 'g', name: '克', symbol: 'g', dimension: 'mass', baseCode: 'g', toBaseFactor: 1, version: 1, createdAt: timestamp, updatedAt: timestamp, deletedAt: null, builtIn: true },
  { id: 'box', code: 'box', name: '盒', symbol: '盒', dimension: 'package', baseCode: 'each', toBaseFactor: null, version: 1, createdAt: timestamp, updatedAt: timestamp, deletedAt: null, builtIn: false },
]

const balances: InventoryBalance[] = [
  { itemId: 'oat', baseUnit: 'g', onHand: 860, warnings: [] },
  { itemId: 'milk', baseUnit: 'ml', onHand: 250, warnings: [] },
  { itemId: 'cold-tablet', baseUnit: 'tablet', onHand: 8, warnings: [] },
]

const transactions: InventoryTransaction[] = [
  {
    id: 'purchase-oat', itemId: 'oat', kind: 'purchase', quantity: 2, unit: 'box', baseQuantity: 1000,
    deltaBaseQuantity: 1000, batchId: 'batch-oat-aug', occurredAt: '2026-08-01T10:00:00.000Z',
    reversesTransactionId: null, reversedByTransactionId: null, warning: null, note: '八月采购', allocations: [], createdAt: timestamp,
  },
  {
    id: 'consume-oat', itemId: 'oat', kind: 'consume', quantity: 140, unit: 'g', baseQuantity: 140,
    deltaBaseQuantity: -140, batchId: null, occurredAt: '2026-08-20T07:30:00.000Z',
    reversesTransactionId: null, reversedByTransactionId: null, warning: null, note: '早餐',
    allocations: [{ batchId: 'batch-oat-aug', quantity: 140, expiresOn: '2026-10-01' }], createdAt: timestamp,
  },
]

const forecasts: InventoryForecast[] = [
  { status: 'complete', itemId: 'oat', baseUnit: 'g', onHand: 860, plannedDemand: 400, projectedBalance: 460, minimumStock: 200, shortage: 0, outstandingShopping: 0, packageQuantity: 500, suggestedPurchase: 0 },
  { status: 'incomplete', itemId: 'milk', baseUnit: 'ml', onHand: 250, reason: 'missing_conversion' },
]

function renderRoute(path: string) {
  sessionStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ mode: 'local-preview', account: 'owner@example.com' }))
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  return { router, ...render(<RouterProvider router={router} />) }
}

describe('Life catalog workspaces', () => {
  beforeEach(() => {
    queryClient.clear()
    catalogApi.list.mockReset().mockResolvedValue(catalog)
    catalogApi.get.mockReset().mockImplementation((id: string) => Promise.resolve(catalog.find((candidate) => candidate.id === id)))
    catalogApi.create.mockReset().mockImplementation((input: Partial<CatalogItem>) => Promise.resolve(item({ id: 'created-item', kind: input.kind ?? 'ingredient', name: input.name ?? '新物品', baseUnit: input.baseUnit ?? 'each', ...input })))
    catalogApi.update.mockReset().mockImplementation((id: string, input: Partial<CatalogItem>) => Promise.resolve({ ...catalog.find((candidate) => candidate.id === id), ...input, version: Number(input.version ?? 1) + 1 }))
    catalogApi.batchUpdate.mockReset().mockImplementation((input: { items: Array<{ id: string }>; patch: Partial<CatalogItem> }) => Promise.resolve(catalog.filter((candidate) => input.items.some((selected) => selected.id === candidate.id)).map((candidate) => ({ ...candidate, ...input.patch, version: candidate.version + 1 }))))
    catalogApi.deleteImpact.mockReset().mockResolvedValue({ recipeIds: ['recipe-breakfast'], templateIds: ['template-weekday'], futurePlanIds: ['plan-2026-08-25'] })
    catalogApi.remove.mockReset().mockResolvedValue(undefined)
    catalogApi.listTrash.mockReset().mockResolvedValue([{ ...catalog[0], deletedAt: timestamp, version: 2 }])
    catalogApi.restore.mockReset().mockResolvedValue({ ...catalog[0], version: 3, deletedAt: null })
    catalogApi.listTaxonomy.mockReset().mockImplementation((kind: 'category' | 'tag' | 'location') => Promise.resolve(taxonomy.filter((entry) => entry.kind === kind)))
    catalogApi.createTaxonomy.mockReset().mockResolvedValue(taxonomy[0])
    catalogApi.updateTaxonomy.mockReset().mockResolvedValue(taxonomy[0])
    catalogApi.removeTaxonomy.mockReset().mockResolvedValue(undefined)
    catalogApi.restoreTaxonomy.mockReset().mockResolvedValue(taxonomy[0])
    catalogApi.listUnits.mockReset().mockResolvedValue(units)
    catalogApi.createUnit.mockReset().mockResolvedValue(units[1])
    catalogApi.updateUnit.mockReset().mockResolvedValue(units[1])
    catalogApi.removeUnit.mockReset().mockResolvedValue(undefined)
    catalogApi.restoreUnit.mockReset().mockResolvedValue(units[1])
    inventoryApi.listBalances.mockReset().mockResolvedValue(balances)
    inventoryApi.listTransactions.mockReset().mockResolvedValue(transactions)
    inventoryApi.listForecasts.mockReset().mockResolvedValue(forecasts)
    inventoryApi.createTransaction.mockReset().mockResolvedValue(transactions[0])
    inventoryApi.reverseTransaction.mockReset().mockResolvedValue({ ...transactions[1], id: 'reverse-consume-oat', kind: 'reversal' })
  })

  it('shows ingredient and supplement facts, custom nutrition, conversions, price history and missing conversion state', async () => {
    const user = userEvent.setup()
    renderRoute('/app/life/ingredients')

    expect(await screen.findByRole('heading', { name: '物品与库存', level: 1 })).toBeVisible()
    expect(screen.getByRole('tab', { name: '食材' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '补充剂' })).toBeVisible()
    expect(await screen.findByText('牛奶')).toBeVisible()
    expect(screen.getByText('缺少 carton → ml 换算，预测不会猜测数量')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '查看 燕麦' }))
    const inspector = screen.getByRole('region', { name: '燕麦详情' })
    expect(within(inspector).getByText('膳食纤维')).toBeVisible()
    expect(within(inspector).getByText('10')).toBeVisible()
    expect(within(inspector).getByText('盒 → g')).toBeVisible()
    expect(within(inspector).getByText('× 500')).toBeVisible()
    expect(within(inspector).getByText('2026-08-01 · ¥18.90 / 1 盒')).toBeVisible()

    await user.click(screen.getByRole('tab', { name: '补充剂' }))
    await user.click(screen.getByRole('button', { name: '查看 维生素 D' }))
    expect(screen.getByText('维生素 D3')).toBeVisible()
    expect(screen.getByText('08:00')).toBeVisible()
    expect(screen.getByText('这是用户自行记录的用量、频率与提醒事实。')).toBeVisible()
  })

  it('supports taxonomy drag metadata, a keyboard move alternative and rejects a category cycle before mutation', async () => {
    const user = userEvent.setup()
    renderRoute('/app/life/ingredients')

    const taxonomyTools = await screen.findByRole('complementary', { name: '分类、标签与位置工具' })
    expect(await within(taxonomyTools).findByRole('listitem', { name: '生鲜' })).toHaveAttribute('draggable', 'true')
    expect(within(taxonomyTools).getByRole('button', { name: '上移 生鲜' })).toBeVisible()
    expect(within(taxonomyTools).getByRole('button', { name: '下移 生鲜' })).toBeVisible()

    await user.click(within(taxonomyTools).getByRole('button', { name: '编辑 生鲜' }))
    await user.selectOptions(screen.getByLabelText('父级分类'), 'protein')
    await user.click(screen.getByRole('button', { name: '保存分类' }))
    expect(screen.getByRole('alert')).toHaveTextContent('父级关系会形成循环')
    expect(catalogApi.updateTaxonomy).not.toHaveBeenCalled()
  })

  it('keeps simple balance and batch ledger facts together and exposes server-selected FEFO allocations', async () => {
    const user = userEvent.setup()
    renderRoute('/app/life/ingredients?item=oat')

    const ledger = await screen.findByRole('region', { name: '燕麦库存流水' })
    expect(within(ledger).getByText('当前结余 860 g')).toBeVisible()
    expect(within(ledger).getByText('批次 batch-oat-aug')).toBeVisible()
    expect(within(ledger).getByText('优先消耗 batch-oat-aug · 140 g · 2026-10-01 到期')).toBeVisible()

    await user.click(within(ledger).getByRole('button', { name: '记录库存变化' }))
    await user.selectOptions(screen.getByLabelText('流水类型'), 'purchase')
    await user.clear(screen.getByLabelText('数量'))
    await user.type(screen.getByLabelText('数量'), '2')
    await user.selectOptions(screen.getByLabelText('单位'), 'box')
    await user.click(screen.getByLabelText('记录采购批次'))
    await user.type(screen.getByLabelText('批次到期日'), '2026-10-01')
    await user.click(screen.getByRole('button', { name: '写入不可变流水' }))

    await waitFor(() => expect(inventoryApi.createTransaction).toHaveBeenCalledWith(expect.objectContaining({
      itemId: 'oat', kind: 'purchase', quantity: 2, unit: 'box', batch: expect.objectContaining({ expiresOn: '2026-10-01' }),
    }), expect.stringMatching(/^inventory:/), undefined))
  })

  it('keeps medicine pages factual and identifies every instruction or schedule as user-authored', async () => {
    renderRoute('/app/life/medicines')

    expect(await screen.findByRole('heading', { name: '药品事实库', level: 1 })).toBeVisible()
    expect(screen.getByText('只保存你录入的包装、库存、有效期、时间计划与使用记录。这里不生成诊断、剂量、停药或相互作用建议。')).toBeVisible()
    expect(await screen.findByText('用户录入通用名')).toBeVisible()
    expect(screen.getByText('用户说明：仅记录包装上的原文，不代表医疗建议')).toBeVisible()
    expect(screen.getByText('用户计划：用户自定义：需要时查看记录')).toBeVisible()
    expect(screen.queryByRole('button', { name: /推荐剂量|诊断|停药/ })).not.toBeInTheDocument()
  })

  it('renders discriminated consumable and durable household facts with honest value labels', async () => {
    const user = userEvent.setup()
    renderRoute('/app/life/household')

    expect(await screen.findByRole('heading', { name: '家庭物品', level: 1 })).toBeVisible()
    await user.click(screen.getByRole('tab', { name: '消耗品' }))
    await user.click(screen.getByRole('button', { name: '查看 洗衣液' }))
    expect(screen.getByText('默认采购 2 bottle')).toBeVisible()
    expect(screen.getByText('预计 45 天消耗周期')).toBeVisible()
    expect(screen.getByText('预计用尽日 2026-09-15')).toBeVisible()

    await user.click(screen.getByRole('tab', { name: '耐用品' }))
    await user.click(screen.getByRole('button', { name: '查看 吸尘器' }))
    expect(screen.getByText('用户记录价值 ¥2,299.00 · 截至 2026-08-01')).toBeVisible()
    expect(screen.getByText('维护中')).toBeVisible()
    expect(screen.getByText('2026-07-18 · 更换滤芯 · ¥129.00')).toBeVisible()
    expect(screen.getByText('组成物品 filter')).toBeVisible()
  })

  it('persists supplement reminder facts through the discriminated editor contract', async () => {
    const user = userEvent.setup()
    renderRoute('/app/life/ingredients?kind=supplement&item=vitamin-d')

    await user.click(await screen.findByRole('button', { name: '编辑' }))
    const editor = screen.getByRole('dialog', { name: '编辑 维生素 D' })
    await user.clear(within(editor).getByLabelText('每次用量'))
    await user.type(within(editor).getByLabelText('每次用量'), '2')
    await user.clear(within(editor).getByLabelText('用户记录频率'))
    await user.type(within(editor).getByLabelText('用户记录频率'), '每周一')
    await user.clear(within(editor).getByLabelText('用户提醒说明'))
    await user.type(within(editor).getByLabelText('用户提醒说明'), '只提醒，不推断用量')
    await user.click(within(editor).getByRole('button', { name: '保存物品' }))

    await waitFor(() => expect(catalogApi.update).toHaveBeenCalledWith('vitamin-d', expect.objectContaining({
      profile: expect.objectContaining({
        kind: 'supplement',
        servingQuantity: 2,
        servingUnit: 'tablet',
        defaultFrequency: '每周一',
        reminder: { enabled: true, localTimes: ['08:00'], note: '只提醒，不推断用量' },
      }),
    }), undefined))
  })

  it('persists durable retirement and maintenance facts without inventing depreciation', async () => {
    const user = userEvent.setup()
    renderRoute('/app/life/household?kind=household_durable&item=vacuum')

    await user.click(await screen.findByRole('button', { name: '编辑' }))
    const editor = screen.getByRole('dialog', { name: '编辑 吸尘器' })
    await user.selectOptions(within(editor).getByLabelText('生命周期'), 'retired')
    await user.type(within(editor).getByLabelText('退役日期'), '2026-08-21')
    await user.type(within(editor).getByLabelText('退役原因'), '用户记录：无法继续维修')
    await user.type(within(editor).getByLabelText('维护日期'), '2026-08-20')
    await user.type(within(editor).getByLabelText('维护摘要'), '最终检测')
    await user.type(within(editor).getByLabelText('维护成本（元）'), '50')
    await user.click(within(editor).getByRole('button', { name: '添加维护记录' }))
    expect(within(editor).queryByText(/折旧/)).not.toBeInTheDocument()
    await user.click(within(editor).getByRole('button', { name: '保存物品' }))

    await waitFor(() => expect(catalogApi.update).toHaveBeenCalledWith('vacuum', expect.objectContaining({
      profile: expect.objectContaining({
        kind: 'household_durable',
        lifecycleStatus: 'retired',
        retiredOn: '2026-08-21',
        retirementReason: '用户记录：无法继续维修',
        maintenanceRecords: expect.arrayContaining([
          expect.objectContaining({ id: 'maintenance-1', summary: '更换滤芯' }),
          expect.objectContaining({ performedOn: '2026-08-20', summary: '最终检测', costMinor: 5000, currency: 'CNY' }),
        ]),
      }),
    }), undefined))
  })

  it('previews bulk changes with category value labels instead of opaque ids', async () => {
    const user = userEvent.setup()
    renderRoute('/app/life/ingredients')

    await screen.findByRole('heading', { name: '物品与库存' })
    await user.click(await screen.findByLabelText('选择 燕麦'))
    await user.click(screen.getByLabelText('选择 牛奶'))
    await user.click(screen.getByRole('button', { name: '批量修改 2 项' }))
    await user.selectOptions(screen.getByLabelText('批量分类'), 'fresh')
    expect(screen.getByRole('region', { name: '批量变更预览' })).toHaveTextContent('2 项：燕麦、牛奶')
    expect(screen.getByRole('region', { name: '批量变更预览' })).toHaveTextContent('分类将改为“生鲜”')
    await user.click(screen.getByRole('button', { name: '确认批量修改' }))
    expect(catalogApi.batchUpdate).toHaveBeenCalledWith({
      items: [{ id: 'oat', version: 1 }, { id: 'milk', version: 1 }], patch: { categoryId: 'fresh' },
    }, undefined)
  })

  it('batch-edits stable category, location, tag and status facts with a versioned undo', async () => {
    const user = userEvent.setup()
    renderRoute('/app/life/ingredients')

    await user.click(await screen.findByLabelText('选择 燕麦'))
    await user.click(screen.getByLabelText('选择 牛奶'))
    await user.click(screen.getByRole('button', { name: '批量修改 2 项' }))
    const preview = screen.getByRole('region', { name: '批量变更预览' })
    await user.selectOptions(within(preview).getByLabelText('批量分类'), 'fresh')
    await user.selectOptions(within(preview).getByLabelText('批量位置'), 'pantry')
    await user.selectOptions(within(preview).getByLabelText('添加标签'), 'breakfast')
    await user.selectOptions(within(preview).getByLabelText('批量状态'), 'disabled')
    expect(preview).toHaveTextContent('位置将改为“食品柜”')
    expect(preview).toHaveTextContent('将添加标签“早餐”')
    await user.click(within(preview).getByRole('button', { name: '确认批量修改' }))

    expect(catalogApi.batchUpdate).toHaveBeenCalledWith({
      items: [{ id: 'oat', version: 1 }, { id: 'milk', version: 1 }],
      patch: { categoryId: 'fresh', locationId: 'pantry', addTagIds: ['breakfast'], status: 'disabled' },
    }, undefined)
    await user.click(await screen.findByRole('button', { name: '撤销上次批量修改' }))
    expect(catalogApi.update).toHaveBeenCalledWith('oat', expect.objectContaining({ version: 2, categoryId: 'dry-goods', locationId: 'pantry', tagIds: [], status: 'active' }), undefined)
    expect(catalogApi.update).toHaveBeenCalledWith('milk', expect.objectContaining({ version: 2, categoryId: 'fresh', locationId: 'fridge', tagIds: [], status: 'active' }), undefined)
  })

  it('filters by name or alias and keeps the query in route state', async () => {
    const user = userEvent.setup()
    const { router } = renderRoute('/app/life/ingredients')

    const search = await screen.findByRole('searchbox', { name: '搜索当前列表' })
    await user.type(search, '燕麦')

    expect(screen.getByRole('button', { name: '查看 燕麦' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '查看 牛奶' })).not.toBeInTheDocument()
    expect(router.state.location.search).toContain('q=%E7%87%95%E9%BA%A6')
  })

  it('edits shared catalog facts without dropping stable tags, oil identity, order or attachments', async () => {
    const user = userEvent.setup()
    renderRoute('/app/life/ingredients?item=oat')

    await user.click(await screen.findByRole('button', { name: '编辑' }))
    const editor = screen.getByRole('dialog', { name: '编辑 燕麦' })
    await user.click(within(editor).getByRole('checkbox', { name: '早餐' }))
    await user.click(within(editor).getByRole('checkbox', { name: '标记为烹调用油' }))
    await user.clear(within(editor).getByLabelText('自定义顺序'))
    await user.type(within(editor).getByLabelText('自定义顺序'), '25')
    await user.type(within(editor).getByLabelText('附件媒体 ID'), 'media-oat-label')
    await user.type(within(editor).getByLabelText('附件说明'), '燕麦包装营养表')
    await user.click(within(editor).getByRole('button', { name: '添加附件' }))
    await user.click(within(editor).getByRole('button', { name: '保存物品' }))

    await waitFor(() => expect(catalogApi.update).toHaveBeenCalledWith('oat', expect.objectContaining({
      version: 1,
      tagIds: ['breakfast'],
      isCookingOil: true,
      customOrder: 25,
      attachments: [{ mediaId: 'media-oat-label', caption: '燕麦包装营养表' }],
    }), undefined))
  })

  it('moves focus into an existing-item editor and restores the invoking control after Escape', async () => {
    const user = userEvent.setup()
    renderRoute('/app/life/ingredients?item=oat')

    const trigger = await screen.findByRole('button', { name: '编辑' })
    await user.click(trigger)
    const editor = screen.getByRole('dialog', { name: '编辑 燕麦' })
    expect(editor).toContainElement(document.activeElement as HTMLElement)
    expect(document.activeElement).toBeEnabled()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '编辑 燕麦' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('creates and soft-deletes user taxonomy and custom units while protecting built-ins', async () => {
    const user = userEvent.setup()
    renderRoute('/app/life/ingredients')
    const taxonomyTools = await screen.findByRole('complementary', { name: '分类、标签与位置工具' })

    await user.click(within(taxonomyTools).getByRole('button', { name: '新建分类' }))
    await user.type(screen.getByLabelText('分类名称'), '早餐食材')
    await user.click(screen.getByRole('button', { name: '创建分类' }))
    expect(catalogApi.createTaxonomy).toHaveBeenCalledWith('category', expect.objectContaining({ name: '早餐食材' }), undefined)

    await user.click(within(taxonomyTools).getByRole('button', { name: '删除 蛋白质' }))
    await user.click(screen.getByRole('button', { name: '确认停用分类 蛋白质' }))
    expect(catalogApi.removeTaxonomy).toHaveBeenCalledWith('category', 'protein', 1, undefined)

    await user.click(screen.getByRole('button', { name: '管理单位' }))
    const unitsDialog = screen.getByRole('dialog', { name: '单位管理' })
    expect(within(unitsDialog).getByText('克')).toBeVisible()
    expect(within(unitsDialog).queryByRole('button', { name: '删除 克' })).not.toBeInTheDocument()
    await user.click(within(unitsDialog).getByRole('button', { name: '新建自定义单位' }))
    await user.type(within(unitsDialog).getByLabelText('单位代码'), 'bag')
    await user.type(within(unitsDialog).getByLabelText('单位名称'), '袋')
    await user.type(within(unitsDialog).getByLabelText('单位符号'), '袋')
    await user.selectOptions(within(unitsDialog).getByLabelText('单位量纲'), 'package')
    await user.type(within(unitsDialog).getByLabelText('基础单位代码'), 'each')
    await user.click(within(unitsDialog).getByRole('button', { name: '创建单位' }))
    expect(catalogApi.createUnit).toHaveBeenCalledWith(expect.objectContaining({ code: 'bag', name: '袋', symbol: '袋', dimension: 'package', baseCode: 'each' }), undefined)
    await user.click(within(unitsDialog).getByRole('button', { name: '删除 盒' }))
    expect(catalogApi.removeUnit).toHaveBeenCalledWith('box', 1, undefined)
  })

  it('names relationship impact before soft delete and restores only through the reference-safe API', async () => {
    const user = userEvent.setup()
    const { router } = renderRoute('/app/life/ingredients?item=oat')

    await user.click(await screen.findByRole('button', { name: '移入回收站 燕麦' }))
    const impact = await screen.findByRole('dialog', { name: '确认移入回收站' })
    expect(impact).toHaveTextContent('食谱 recipe-breakfast')
    expect(impact).toHaveTextContent('模板 template-weekday')
    expect(impact).toHaveTextContent('未来计划 plan-2026-08-25')
    expect(within(impact).queryByRole('button', { name: '永久删除' })).not.toBeInTheDocument()
    await user.click(within(impact).getByRole('button', { name: '确认移入回收站' }))
    expect(catalogApi.remove).toHaveBeenCalledWith('oat', 1, undefined)

    await router.navigate('/app/life/data?section=trash')
    const trash = await screen.findByRole('region', { name: '生活数据回收站' })
    await user.click(await within(trash).findByRole('button', { name: '恢复 燕麦' }))
    expect(catalogApi.restore).toHaveBeenCalledWith('oat', 2, undefined)
    expect(await screen.findByText('燕麦已恢复，原有关系由服务端完成安全校验')).toHaveAttribute('role', 'status')
  })
})
