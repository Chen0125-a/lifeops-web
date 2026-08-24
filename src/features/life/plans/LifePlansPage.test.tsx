import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appRoutes } from '../../../App'
import { queryClient } from '../../../api/queryClient'
import type {
  DayPlan,
  DayPlanProjection,
  FitnessActivity,
  MedicineRecurrenceOccurrence,
  PlanTemplate,
  PlanningTimeline,
  TemplateApplicationPreview,
  TemplateSyncPreview,
} from '../../../domain/lifePlanning'
import { LOCAL_SESSION_KEY } from '../../../state/AuthContext'

const { planningApi } = vi.hoisted(() => ({
  planningApi: {
    listTemplates: vi.fn(),
    getDayPlan: vi.fn(),
    getDayProjection: vi.fn(),
    getTimeline: vi.fn(),
    listFitness: vi.fn(),
    createDayPlan: vi.fn(),
    updateDayPlan: vi.fn(),
    previewTemplate: vi.fn(),
    applyTemplate: vi.fn(),
    copyDayPlan: vi.fn(),
    transitionItem: vi.fn(),
    previewSync: vi.fn(),
    syncTemplate: vi.fn(),
    transitionMedicineOccurrence: vi.fn(),
    createCompletion: vi.fn(),
    undoCompletion: vi.fn(),
  },
}))

vi.mock('../../../api/lifePlanningApi', () => ({ lifePlanningApi: planningApi }))

const now = '2026-08-18T08:00:00.000Z'
const mealSlots = [
  { id: 'breakfast', name: '早餐', position: 10, hidden: false },
  { id: 'after-breakfast', name: '早餐后', position: 20, hidden: false },
  { id: 'dinner', name: '晚餐', position: 30, hidden: false },
]

function plan(date: string): DayPlan {
  return {
    id: `plan-${date}`,
    date,
    mealSlots,
    items: date === '2026-08-18' ? [
      {
        id: 'meal-1', kind: 'meal', title: '燕麦早餐', mealSlotId: 'breakfast', scheduledTime: '07:30',
        source: { type: 'recipe-version', id: 'recipe-oats', versionId: 'version-2' },
        quantity: null, unit: null, servings: 1, durationMinutes: null, status: 'planned',
        completionId: null, actual: null, originTemplateItemId: null, entityVersion: 1,
      },
      {
        id: 'supplement-1', kind: 'supplement', title: '用户记录的补剂', mealSlotId: 'breakfast', scheduledTime: '07:45',
        source: { type: 'catalog-item', id: 'supplement-user' },
        quantity: 1, unit: '份', servings: null, durationMinutes: null, status: 'planned',
        completionId: null, actual: null, originTemplateItemId: 'tpl-supplement', entityVersion: 1,
      },
      {
        id: 'medicine-plan', kind: 'medicine', title: '用户记录的晚间用药', mealSlotId: null, scheduledTime: '21:00',
        source: { type: 'catalog-item', id: 'medicine-user' },
        quantity: 1, unit: '片', servings: null, durationMinutes: null, status: 'planned',
        completionId: null, actual: null, originTemplateItemId: null, entityVersion: 2,
      },
      {
        id: 'unplaced-1', kind: 'custom', title: '未安排的拉伸', mealSlotId: null, scheduledTime: null,
        source: null, quantity: null, unit: null, servings: null, durationMinutes: 10, status: 'planned',
        completionId: null, actual: null, originTemplateItemId: null, entityVersion: 1,
      },
    ] : [],
    entityVersion: 3,
  }
}

const template: PlanTemplate = {
  id: 'template-weekday',
  name: '工作日模板',
  mealSlots,
  items: [
    {
      id: 'tpl-breakfast', kind: 'meal', title: '模板早餐', mealSlotId: 'breakfast', scheduledTime: '07:30',
      source: { type: 'recipe-version', id: 'recipe-oats', versionId: 'version-2' },
      quantity: null, unit: null, servings: 1, durationMinutes: null,
    },
  ],
  entityVersion: 4,
}

const fitness: FitnessActivity[] = [{
  id: 'fitness-cycle', name: '室内单车', defaultMinutes: 30, kcalPerHour: 420, intensity: '中等',
  steps: ['热身', '骑行'], equipment: ['单车'], entityVersion: 1, createdAt: now, updatedAt: now,
}]

const medicineOccurrence: MedicineRecurrenceOccurrence = {
  id: 'occurrence-1', ruleId: 'rule-1', entityVersion: 3, kind: 'medicine', title: '用户记录的早间用药',
  source: { type: 'catalog-item', id: 'medicine-user' }, quantity: 1, unit: '片',
  originalDate: '2026-08-18', originalTime: '08:00', scheduledDate: '2026-08-18', scheduledTime: '08:00',
  status: 'planned', completionId: null, createdAt: now, updatedAt: now,
}

const projection: DayPlanProjection = {
  date: '2026-08-18', status: 'complete', plannedNutrition: { energyKcal: 420 }, actualNutrition: {},
  plannedCostMinor: 680, actualCostMinor: 0, plannedEnergyKcal: 0, actualEnergyKcal: 0,
  sourceIds: ['recipe-oats'], inventory: [], items: [],
}

const preview: TemplateApplicationPreview = {
  writesApplied: false,
  templateVersion: 4,
  dayPlanVersion: 3,
  conflicts: [{ id: 'conflict-breakfast', existingItemIds: ['meal-1'], incomingTemplateItemId: 'tpl-breakfast', resolution: 'merge' }],
  result: plan('2026-08-18'),
}

const syncPreview: TemplateSyncPreview = {
  writesApplied: false,
  templateVersion: 4,
  dayPlanVersions: { '2026-08-19': 1 },
  affectedDates: ['2026-08-19'],
  excludedCompletedDates: ['2026-08-20'],
  changes: [{ date: '2026-08-19', before: [], after: preview.result.items }],
}

function renderRoute(path = '/app/life/plans?week=2026-08-17&day=2026-08-18') {
  sessionStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ mode: 'local-preview', account: 'owner@example.com' }))
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  return { router, ...render(<RouterProvider router={router} />) }
}

describe('weekly life planning and factual completion flows', () => {
  beforeEach(() => {
    queryClient.clear()
    planningApi.listTemplates.mockReset().mockResolvedValue([template])
    planningApi.getDayPlan.mockReset().mockImplementation((date: string) => Promise.resolve(plan(date)))
    planningApi.getDayProjection.mockReset().mockResolvedValue(projection)
    planningApi.getTimeline.mockReset().mockImplementation((date: string): Promise<PlanningTimeline> => Promise.resolve({
      date,
      timelineItems: date === '2026-08-18' ? [
        ...plan(date).items.map((item) => ({ ...item, sourceType: 'day-plan-item' as const })),
        { ...medicineOccurrence, sourceType: 'medicine-occurrence' as const },
      ] : [],
    }))
    planningApi.listFitness.mockReset().mockResolvedValue(fitness)
    planningApi.createDayPlan.mockReset().mockImplementation((input: DayPlan) => Promise.resolve(plan(input.date)))
    planningApi.updateDayPlan.mockReset().mockResolvedValue(plan('2026-08-18'))
    planningApi.previewTemplate.mockReset().mockResolvedValue(preview)
    planningApi.applyTemplate.mockReset().mockResolvedValue(preview.result)
    planningApi.copyDayPlan.mockReset().mockImplementation((_date: string, targetDate: string) => Promise.resolve(plan(targetDate)))
    planningApi.transitionItem.mockReset().mockResolvedValue({ ...plan('2026-08-18').items[2], status: 'completed' })
    planningApi.previewSync.mockReset().mockResolvedValue(syncPreview)
    planningApi.syncTemplate.mockReset().mockResolvedValue({ affectedDates: ['2026-08-19'], excludedCompletedDates: ['2026-08-20'] })
    planningApi.transitionMedicineOccurrence.mockReset().mockResolvedValue({ ...medicineOccurrence, status: 'skipped', entityVersion: 4 })
    planningApi.createCompletion.mockReset()
    planningApi.undoCompletion.mockReset()
  })

  it('shows a seven-day desktop canvas plus day-first controls, custom meal slots and drag/menu-equivalent placement edits', async () => {
    const user = userEvent.setup()
    renderRoute()

    expect(await screen.findByRole('heading', { name: '周生活计划', level: 1 })).toBeVisible()
    expect(screen.getByRole('navigation', { name: '本周日期' })).toBeVisible()
    expect(screen.getByRole('region', { name: '周计划画布' })).toBeVisible()
    expect(screen.getAllByRole('button', { name: /8月1[7-9]日/ })).toHaveLength(3)
    expect(screen.getByRole('heading', { name: '早餐后' })).toBeVisible()
    expect(screen.getByText('周概览')).toBeVisible()

    const unplaced = screen.getByRole('button', { name: '安排未安排的拉伸' })
    const target = screen.getByTestId('meal-slot-after-breakfast')
    fireEvent.dragStart(unplaced)
    fireEvent.dragOver(target)
    fireEvent.drop(target)
    expect(within(target).getByText('未安排的拉伸')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '重新安排未安排的拉伸' }))
    const placement = screen.getByRole('dialog', { name: '安排未安排的拉伸' })
    await user.selectOptions(within(placement).getByLabelText('餐次'), 'dinner')
    await user.clear(within(placement).getByLabelText('时间'))
    await user.type(within(placement).getByLabelText('时间'), '19:10')
    await user.clear(within(placement).getByLabelText('时长（分钟）'))
    await user.type(within(placement).getByLabelText('时长（分钟）'), '18')
    await user.click(within(placement).getByRole('button', { name: '确认安排' }))
    expect(screen.getByTestId('meal-slot-dinner')).toHaveTextContent('未安排的拉伸19:10')
  })

  it('edits portion/time and links a supplement to a meal offset before an explicit day-plan save', async () => {
    const user = userEvent.setup()
    renderRoute()

    await screen.findByRole('heading', { name: '周生活计划' })
    await user.click(screen.getByRole('button', { name: '编辑燕麦早餐' }))
    const mealEditor = screen.getByRole('dialog', { name: '编辑燕麦早餐' })
    await user.clear(within(mealEditor).getByLabelText('份数'))
    await user.type(within(mealEditor).getByLabelText('份数'), '1.5')
    await user.clear(within(mealEditor).getByLabelText('时间'))
    await user.type(within(mealEditor).getByLabelText('时间'), '07:40')
    await user.click(within(mealEditor).getByRole('button', { name: '保存本地编辑' }))

    await user.click(screen.getByRole('button', { name: '编辑用户记录的补剂' }))
    const supplementEditor = screen.getByRole('dialog', { name: '编辑用户记录的补剂' })
    await user.selectOptions(within(supplementEditor).getByLabelText('关联餐次'), 'breakfast')
    await user.clear(within(supplementEditor).getByLabelText('相对分钟'))
    await user.type(within(supplementEditor).getByLabelText('相对分钟'), '15')
    expect(within(supplementEditor).getByText('早餐后 15 分钟 · 07:45')).toBeVisible()
    await user.click(within(supplementEditor).getByRole('button', { name: '保存本地编辑' }))
    await user.click(screen.getByRole('button', { name: '保存当天计划' }))

    await waitFor(() => expect(planningApi.updateDayPlan).toHaveBeenCalledWith('2026-08-18', expect.objectContaining({
      entityVersion: 3,
      items: expect.arrayContaining([
        expect.objectContaining({ id: 'meal-1', entityVersion: 1, title: '燕麦早餐', servings: 1.5, scheduledTime: '07:40' }),
        expect.objectContaining({ id: 'supplement-1', entityVersion: 1, title: '用户记录的补剂', mealSlotId: 'breakfast', relativeToItemIndex: 0, offsetMinutes: 15 }),
      ]),
    }), undefined))
  })

  it('previews keep/merge/replace/skip conflicts, applies a chosen result and syncs only an explicit range', async () => {
    const user = userEvent.setup()
    renderRoute()
    await screen.findByRole('heading', { name: '周生活计划' })

    await user.click(screen.getByRole('button', { name: '模板与同步' }))
    const library = screen.getByRole('dialog', { name: '模板与同步' })
    await user.click(within(library).getByRole('button', { name: '预览工作日模板' }))
    const conflict = await screen.findByRole('dialog', { name: '模板冲突预览' })
    expect(within(conflict).getByText('当前：燕麦早餐')).toBeVisible()
    expect(within(conflict).getByText('模板：模板早餐')).toBeVisible()
    expect(within(conflict).getByRole('radio', { name: '保留当前' })).toBeVisible()
    expect(within(conflict).getByRole('radio', { name: '合并两边' })).toBeVisible()
    expect(within(conflict).getByRole('radio', { name: '替换当前' })).toBeVisible()
    expect(within(conflict).getByRole('radio', { name: '跳过本日' })).toBeVisible()
    await user.click(within(conflict).getByRole('radio', { name: '合并两边' }))
    await user.click(within(conflict).getByRole('button', { name: '确认应用模板' }))
    await waitFor(() => expect(planningApi.applyTemplate).toHaveBeenCalledWith('2026-08-18', {
      templateId: 'template-weekday', resolution: 'merge', entityVersion: 3, templateVersion: 4,
    }, expect.any(String), undefined))

    await user.click(screen.getByRole('button', { name: '模板与同步' }))
    await user.click(screen.getByRole('button', { name: '同步工作日模板' }))
    const sync = screen.getByRole('dialog', { name: '显式同步范围' })
    await user.selectOptions(within(sync).getByLabelText('同步目标'), 'selected')
    await user.clear(within(sync).getByLabelText('起始日期'))
    await user.type(within(sync).getByLabelText('起始日期'), '2026-08-19')
    await user.click(within(sync).getByLabelText('2026-08-19'))
    await user.click(within(sync).getByRole('button', { name: '预览同步' }))
    expect(await within(sync).findByText('将更新 1 天')).toBeVisible()
    expect(within(sync).getByText('已完成而排除：2026-08-20')).toBeVisible()
    await user.click(within(sync).getByRole('button', { name: '确认显式同步' }))
    await waitFor(() => expect(planningApi.syncTemplate).toHaveBeenCalledWith('template-weekday', expect.objectContaining({
      fromDate: '2026-08-19', target: 'selected', dates: ['2026-08-19'],
      templateVersion: 4, dayPlanVersions: { '2026-08-19': 1 },
    }), expect.any(String), undefined))
  })

  it('copies only plan fields and keeps medicine delay, skip and backfill factual and explicit', async () => {
    const user = userEvent.setup()
    renderRoute()
    await screen.findByRole('heading', { name: '周生活计划' })

    await user.click(screen.getByRole('button', { name: '复制当天计划' }))
    const copy = screen.getByRole('dialog', { name: '复制当天计划' })
    expect(within(copy).getByText('只复制计划字段；不会复制实际完成、历史或库存流水。')).toBeVisible()
    await user.clear(within(copy).getByLabelText('目标日期'))
    await user.type(within(copy).getByLabelText('目标日期'), '2026-08-24')
    await user.click(within(copy).getByRole('button', { name: '确认复制' }))
    await waitFor(() => expect(planningApi.copyDayPlan).toHaveBeenCalledWith('2026-08-18', '2026-08-24', expect.any(String), undefined))

    await user.click(screen.getByRole('button', { name: '推迟用户记录的早间用药' }))
    const delay = screen.getByRole('dialog', { name: '推迟用户记录的早间用药' })
    await user.clear(within(delay).getByLabelText('新日期'))
    await user.type(within(delay).getByLabelText('新日期'), '2026-08-19')
    await user.clear(within(delay).getByLabelText('新时间'))
    await user.type(within(delay).getByLabelText('新时间'), '09:30')
    await user.click(within(delay).getByRole('button', { name: '确认推迟' }))
    await waitFor(() => expect(planningApi.transitionMedicineOccurrence).toHaveBeenCalledWith('occurrence-1', expect.objectContaining({
      entityVersion: 3, action: 'delay', delayedUntil: { date: '2026-08-19', time: '09:30' },
    }), expect.any(String), undefined))

    await user.click(screen.getByRole('button', { name: '跳过用户记录的早间用药' }))
    await waitFor(() => expect(planningApi.transitionMedicineOccurrence).toHaveBeenCalledWith('occurrence-1', expect.objectContaining({
      entityVersion: 3, action: 'skip',
    }), expect.any(String), undefined))
    await user.click(screen.getByRole('button', { name: '补记用户记录的晚间用药' }))
    await waitFor(() => expect(planningApi.transitionItem).toHaveBeenCalledWith('2026-08-18', 'medicine-plan', expect.objectContaining({
      entityVersion: 2, action: 'backfill',
    }), undefined))
    expect(screen.getByText('仅记录你提供的时间与状态，不提供诊断、剂量或停药建议。')).toBeVisible()
  })

  it('contains an offline load failure locally and offers a scoped retry', async () => {
    planningApi.getDayPlan.mockRejectedValueOnce(new Error('offline')).mockImplementation((date: string) => Promise.resolve(plan(date)))
    const user = userEvent.setup()
    renderRoute()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('计划暂时无法载入')
    await user.click(within(alert).getByRole('button', { name: '重试周计划' }))
    expect(await screen.findByRole('heading', { name: '周生活计划' })).toBeVisible()
  })
})
