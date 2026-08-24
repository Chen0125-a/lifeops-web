import { render, screen, within } from '@testing-library/react'
import { type ComponentType } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { workspaceRoutes } from '../../components/private/WorkspaceHeader'
import type { BudgetSummary, ShoppingSuggestion } from '../../domain/lifeCommerce'
import type { DayPlan, DayPlanProjection, PlanningTimeline } from '../../domain/lifePlanning'
import { OverviewPage, type OverviewPageProps } from '../overview/OverviewPage'
import { LifeLayout } from './LifeLayout'
import { LifeSubnav } from './LifeSubnav'
import { LifeTodayPage } from './LifeTodayPage'
import type { LifeDayViewModel } from './useLifeDay'

const dayPlan: DayPlan = {
  id: 'day-2026-08-21',
  date: '2026-08-21',
  mealSlots: [{ id: 'breakfast', name: '早餐', position: 10, hidden: false }],
  items: [],
  entityVersion: 3,
}

const timeline: PlanningTimeline = {
  date: '2026-08-21',
  timelineItems: [
    { id: 'meal-1', sourceType: 'day-plan-item', kind: 'meal', title: '燕麦早餐', mealSlotId: 'breakfast', scheduledTime: '07:30', source: null, quantity: 1, unit: '份', servings: 1, durationMinutes: null, status: 'completed', completionId: 'completion-1', actual: null, originTemplateItemId: null, entityVersion: 2 },
    { id: 'medicine-1', sourceType: 'day-plan-item', kind: 'medicine', title: '用户记录的维生素', mealSlotId: null, scheduledTime: '08:00', source: null, quantity: 1, unit: '片', servings: null, durationMinutes: null, status: 'in_progress', completionId: null, actual: null, originTemplateItemId: null, entityVersion: 1 },
    { id: 'fitness-1', sourceType: 'day-plan-item', kind: 'fitness', title: '力量训练', mealSlotId: null, scheduledTime: '18:30', source: null, quantity: null, unit: null, servings: null, durationMinutes: 45, status: 'planned', completionId: null, actual: null, originTemplateItemId: null, entityVersion: 1 },
    { id: 'custom-1', sourceType: 'day-plan-item', kind: 'custom', title: '晚间拉伸', mealSlotId: null, scheduledTime: '21:30', source: null, quantity: null, unit: null, servings: null, durationMinutes: 15, status: 'skipped', completionId: null, actual: null, originTemplateItemId: null, entityVersion: 1 },
  ],
}

const projection: DayPlanProjection = {
  date: '2026-08-21',
  status: 'incomplete',
  plannedNutrition: { energyKcal: 2180, proteinG: 128, fatG: 62, carbohydrateG: 250, cookingOilG: 18, netEnergyKcal: 1880 },
  actualNutrition: { energyKcal: 640, proteinG: 31, fatG: 16, carbohydrateG: 82, cookingOilG: 6, netEnergyKcal: 640 },
  plannedCostMinor: 4250,
  actualCostMinor: 1280,
  plannedEnergyKcal: 300,
  actualEnergyKcal: 0,
  sourceIds: ['recipe-breakfast-v2'],
  inventory: [
    { status: 'complete', itemId: '燕麦', baseUnit: 'g', onHand: 40, plannedDemand: 80, projectedBalance: -40, shortage: 40 },
    { status: 'incomplete', itemId: '牛奶', baseUnit: null, onHand: null, plannedDemand: null, projectedBalance: null, shortage: null, reason: 'missing_conversion' },
  ],
  items: [],
}

const budget: BudgetSummary = {
  id: 'budget-august', name: '八月生活预算', scope: { kind: 'all-life' },
  period: { kind: 'monthly', startsOn: '2026-08-01', endsOn: '2026-08-31' },
  limitMinor: 120000, thresholds: [0.7, 0.9, 1], rolloverMinor: 0,
  version: 1, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z',
  spentMinor: 68400, remainingMinor: 51600, thresholdStatus: 'warning',
  forecast: { status: 'complete', projectedMinor: 108000 },
}

const suggestion: ShoppingSuggestion = {
  id: 'suggestion-oats', kind: 'suggestion', origin: 'derived', through: '2026-08-23', itemId: '燕麦',
  requiredQuantity: 40, suggestedQuantity: 500, unit: 'g', packageQuantity: 500,
  reasons: [{ id: 'reason-oats', kind: 'planned_shortage', sourceType: 'day-plan', sourceId: 'day-2026-08-21', requiredQuantity: 40, sourceQuantity: 80, sourceUnit: 'g', conversionFactor: 1, requiredOn: '2026-08-21', createdAt: '2026-08-21T00:00:00.000Z' }],
  createdAt: '2026-08-21T00:00:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z',
}

const model: LifeDayViewModel = {
  status: 'ready', date: '2026-08-21', dayPlan, timeline, projection,
  budgets: [budget], shopping: { suggestions: [suggestion], formalItems: [] }, error: null,
}

describe('LifeTodayPage', () => {
  afterEach(() => vi.useRealTimers())

  it('keeps the approved main and life navigation orders and maps inventory to ingredients', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T09:00:00+08:00'))
    expect(workspaceRoutes.map((route) => route.label)).toEqual(['总览', '目标与项目', '日程', '习惯', '记录', '回顾', '知识', '生活', '发布', '平台'])

    render(<MemoryRouter initialEntries={['/app/life']}><LifeLayout><LifeTodayPage model={model} /></LifeLayout></MemoryRouter>)
    const navigation = screen.getByRole('navigation', { name: '生活工作台导航' })
    expect(within(navigation).getAllByRole('link').map((link) => link.textContent)).toEqual(['今日', '计划', '食谱', '库存', '健身', '采购', '分析', '数据'])
    expect(within(navigation).getByRole('link', { name: '库存' })).toHaveAttribute('href', '/app/life/ingredients')
    expect(screen.getByRole('link', { name: '打开生活日历' })).toHaveAttribute('href', '/app/life/calendar?date=2026-08-21')
  })

  it('keeps the current life route visible inside the narrow horizontal subnav', () => {
    const scrollTo = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo })
    render(<MemoryRouter initialEntries={['/app/life/data']}><LifeSubnav /></MemoryRouter>)
    expect(screen.getByRole('link', { name: '数据' })).toHaveAttribute('aria-current', 'page')
    expect(scrollTo).toHaveBeenCalledWith({ behavior: 'auto', left: expect.any(Number) })
    window.dispatchEvent(new Event('resize'))
    expect(scrollTo).toHaveBeenCalledTimes(2)
  })

  it('renders the asymmetric today canvas with explicit states and planned-versus-actual facts', () => {
    render(<MemoryRouter><LifeTodayPage model={model} /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: '今日生活', level: 1 })).toBeVisible()
    const canvas = screen.getByTestId('life-today-canvas')
    expect(canvas).toHaveAttribute('data-layout', 'timeline/insights')
    expect(screen.getByRole('region', { name: '今日时间线' })).toHaveAttribute('data-primary', 'true')
    expect(screen.getByRole('region', { name: '营养与预算' })).toHaveAttribute('data-secondary', 'true')

    const statuses = within(screen.getByRole('region', { name: '今日时间线' })).getAllByTestId('life-item-status').map((node) => node.textContent)
    expect(statuses).toEqual(['已完成', '进行中', '未开始', '已跳过'])
    expect(screen.getByRole('region', { name: '下一行动' })).toHaveTextContent('用户记录的维生素')

    const nutrition = screen.getByRole('region', { name: '营养事实' })
    expect(nutrition).toHaveTextContent('计划')
    expect(nutrition).toHaveTextContent('实际')
    for (const label of ['能量', '蛋白质', '脂肪', '碳水', '烹调油', '训练消耗', '净能量']) expect(nutrition).toHaveTextContent(label)
    expect(screen.getByRole('region', { name: '成本与预算' })).toHaveTextContent('计划消耗成本 ¥42.50')
    expect(screen.getByRole('region', { name: '成本与预算' })).toHaveTextContent('实际消耗成本 ¥12.80')
    expect(screen.getByRole('region', { name: '成本与预算' })).toHaveTextContent('现金支出 ¥684.00')
  })

  it('surfaces actionable shortages and incomplete evidence without inventing zeroes', () => {
    render(<MemoryRouter><LifeTodayPage model={model} /></MemoryRouter>)

    const inventory = screen.getByRole('region', { name: '库存与采购提醒' })
    expect(inventory).toHaveTextContent('燕麦预计短缺 40 g')
    expect(inventory).toHaveTextContent('建议采购 500 g')
    expect(within(inventory).getByRole('link', { name: '处理燕麦采购' })).toHaveAttribute('href', '/app/life/shopping?item=%E7%87%95%E9%BA%A6')
    expect(inventory).toHaveTextContent('牛奶：数据不完整，缺少单位换算')
    expect(inventory).not.toHaveTextContent('牛奶预计短缺 0')
    expect(screen.getByRole('status', { name: '生活数据完整性' })).toHaveTextContent('部分计划或实际数据不完整')
  })

  it('adds a compact life summary to Overview without turning it into another card wall', () => {
    const OverviewWithLife = OverviewPage as ComponentType<OverviewPageProps & { lifeSummary: { nextAction: string; plannedCount: number; completedCount: number; incomplete: boolean } }>
    const overviewModel = {
      isEmpty: false,
      statusStrip: { dateLabel: '8月21日 星期五', greeting: '下午好', week: { completed: 2, total: 5 }, platformHealth: 'unknown' as const },
      todayTimeline: [], topGoals: [], activeProjects: [],
      habitWeek: { days: [], rows: [], totals: { done: 0, partial: 0, intentionalSkip: 0, missed: 0, pending: 0 } },
      trends: { completedTasks: 2, habitCompletions: 0, recordCount: 0 }, recentRecords: [], priorInsight: null, resurfacedKnowledge: [],
    }
    render(<MemoryRouter><OverviewWithLife model={overviewModel} lifeSummary={{ nextAction: '用户记录的维生素', plannedCount: 4, completedCount: 1, incomplete: true }} /></MemoryRouter>)

    const summary = screen.getByRole('region', { name: '今日生活摘要' })
    expect(summary).toHaveTextContent('1 / 4 已完成')
    expect(summary).toHaveTextContent('下一步：用户记录的维生素')
    expect(summary).toHaveTextContent('数据不完整')
    expect(within(summary).getByRole('link', { name: '打开今日生活' })).toHaveAttribute('href', '/app/life')
  })

  it('turns a genuinely empty day into explicit next steps without sample facts', () => {
    const emptyModel: LifeDayViewModel = {
      status: 'ready', date: '2026-08-21', dayPlan: null,
      timeline: { date: '2026-08-21', timelineItems: [] }, projection: null,
      budgets: [], shopping: { suggestions: [], formalItems: [] }, error: null,
    }
    render(<MemoryRouter><LifeTodayPage model={emptyModel} /></MemoryRouter>)

    expect(screen.getByRole('region', { name: '下一行动' })).toHaveTextContent('为今天放入第一条生活计划')
    expect(screen.getByRole('region', { name: '今日时间线' })).toHaveTextContent('今天还没有计划')
    expect(screen.getByRole('region', { name: '库存与采购提醒' })).toHaveTextContent('补全库存资料')
    expect(screen.getByRole('region', { name: '成本与预算' })).toHaveTextContent('预算 尚未设置')
    expect(screen.queryByText('燕麦与鸡蛋早餐')).not.toBeInTheDocument()
  })
})
