import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appRoutes } from '../../../App'
import { queryClient } from '../../../api/queryClient'
import type { DayPlan, DayPlanProjection, FitnessActivity, PlanningCompletionSnapshot, PlanningTimeline } from '../../../domain/lifePlanning'
import { LOCAL_SESSION_KEY } from '../../../state/AuthContext'

const { planningApi } = vi.hoisted(() => ({
  planningApi: {
    listTemplates: vi.fn(), getDayPlan: vi.fn(), getDayProjection: vi.fn(), getTimeline: vi.fn(), listFitness: vi.fn(),
    createDayPlan: vi.fn(), updateDayPlan: vi.fn(), previewTemplate: vi.fn(), applyTemplate: vi.fn(), copyDayPlan: vi.fn(), transitionItem: vi.fn(),
    previewSync: vi.fn(), syncTemplate: vi.fn(), transitionMedicineOccurrence: vi.fn(), createFitness: vi.fn(),
    createCompletion: vi.fn(), undoCompletion: vi.fn(),
  },
}))

vi.mock('../../../api/lifePlanningApi', () => ({ lifePlanningApi: planningApi }))

const now = '2026-08-18T18:00:00.000Z'
const activities: FitnessActivity[] = [
  { id: 'strength', name: '力量训练', defaultMinutes: 30, kcalPerHour: 360, intensity: '中等', steps: ['深蹲', '推举'], equipment: ['哑铃'], entityVersion: 1, createdAt: now, updatedAt: now },
  { id: 'cycle', name: '室内单车', defaultMinutes: 20, kcalPerHour: 480, intensity: '较高', steps: ['骑行'], equipment: ['单车'], entityVersion: 1, createdAt: now, updatedAt: now },
]

const plan: DayPlan = {
  id: 'plan-fitness', date: '2026-08-18', mealSlots: [],
  items: [{
    id: 'fitness-plan', kind: 'fitness', title: '晚间组合训练', mealSlotId: null, scheduledTime: '18:30',
    source: { type: 'fitness-activity', id: 'strength' }, quantity: null, unit: null, servings: null,
    durationMinutes: 50, status: 'planned', completionId: null, actual: null, originTemplateItemId: null, entityVersion: 1,
  }],
  entityVersion: 2,
}

const projection: DayPlanProjection = {
  date: plan.date, status: 'complete', plannedNutrition: {}, actualNutrition: {}, plannedCostMinor: 0, actualCostMinor: 0,
  plannedEnergyKcal: 340, actualEnergyKcal: 0, sourceIds: ['strength'], inventory: [], items: [],
}

const completion: PlanningCompletionSnapshot = {
  id: 'completion-fitness', dayPlanId: plan.id, dayPlanItemId: 'fitness-plan', kind: 'fitness',
  completionSource: { type: 'day-plan-item', dayPlanId: plan.id, dayPlanItemId: 'fitness-plan' },
  source: { type: 'fitness-activity', id: 'strength' }, quantity: null, unit: null, servings: null,
  completedAt: now, nutrition: null, costMinor: null, inventoryTransactionIds: [], actualMinutes: 45,
  estimatedEnergyKcal: 270, energyIsEstimate: true,
}

function renderRoute() {
  sessionStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ mode: 'local-preview', account: 'owner@example.com' }))
  const router = createMemoryRouter(appRoutes, { initialEntries: ['/app/life/fitness?date=2026-08-18'] })
  return render(<RouterProvider router={router} />)
}

describe('fitness combinations and actual completion', () => {
  beforeEach(() => {
    queryClient.clear()
    planningApi.listFitness.mockReset().mockResolvedValue(activities)
    planningApi.getDayPlan.mockReset().mockResolvedValue(plan)
    planningApi.getDayProjection.mockReset().mockResolvedValue(projection)
    planningApi.getTimeline.mockReset().mockResolvedValue({
      date: plan.date,
      timelineItems: plan.items.map((item) => ({ ...item, sourceType: 'day-plan-item' as const })),
    } satisfies PlanningTimeline)
    planningApi.createDayPlan.mockReset().mockResolvedValue(plan)
    planningApi.updateDayPlan.mockReset().mockResolvedValue(plan)
    planningApi.createCompletion.mockReset().mockResolvedValue(completion)
    planningApi.undoCompletion.mockReset().mockResolvedValue({
      completionId: completion.id, reversedInventoryTransactionIds: [], status: 'planned',
    })
  })

  it('builds a combination from user-authored activities and labels planned burn as an estimate', async () => {
    const user = userEvent.setup()
    renderRoute()

    expect(await screen.findByRole('heading', { name: '健身计划', level: 1 })).toBeVisible()
    await user.click(screen.getByRole('checkbox', { name: '选择力量训练' }))
    await user.click(screen.getByRole('checkbox', { name: '选择室内单车' }))
    await user.click(screen.getByRole('button', { name: '加入组合训练' }))
    const builder = screen.getByRole('dialog', { name: '组合训练' })
    expect(within(builder).getByText('力量训练 · 30 分钟')).toBeVisible()
    expect(within(builder).getByText('室内单车 · 20 分钟')).toBeVisible()
    expect(within(builder).getByText('计划 50 分钟')).toBeVisible()
    expect(within(builder).getByText('预计消耗 340 kcal · 用户估算')).toBeVisible()
    await user.click(within(builder).getByRole('button', { name: '加入 2026-08-18' }))
    await waitFor(() => expect(planningApi.updateDayPlan).toHaveBeenCalledWith('2026-08-18', expect.objectContaining({
      entityVersion: 2,
      items: expect.arrayContaining([
        expect.objectContaining({ id: 'fitness-plan', entityVersion: 1 }),
        expect.objectContaining({ kind: 'fitness', title: '力量训练 + 室内单车', durationMinutes: 50 }),
      ]),
    }), undefined))
  })

  it('records actual duration once, distinguishes the estimate and can undo the immutable completion', async () => {
    let resolveCompletion: ((value: PlanningCompletionSnapshot) => void) | undefined
    planningApi.createCompletion.mockImplementationOnce(() => new Promise((resolve) => { resolveCompletion = resolve }))
    const user = userEvent.setup()
    renderRoute()

    await screen.findByRole('heading', { name: '健身计划' })
    await user.click(screen.getByRole('button', { name: '完成晚间组合训练' }))
    const dialog = screen.getByRole('dialog', { name: '完成晚间组合训练' })
    await user.clear(within(dialog).getByLabelText('实际时长（分钟）'))
    await user.type(within(dialog).getByLabelText('实际时长（分钟）'), '45')
    expect(within(dialog).getByText('按用户维护的 360 kcal/小时估算：270 kcal')).toBeVisible()
    const submit = within(dialog).getByRole('button', { name: '确认实际完成' })
    await user.click(submit)
    expect(submit).toBeDisabled()
    await user.click(submit)
    expect(planningApi.createCompletion).toHaveBeenCalledTimes(1)
    expect(planningApi.createCompletion).toHaveBeenCalledWith({
      date: '2026-08-18', dayPlanItemId: 'fitness-plan', completedAt: expect.any(String), actualMinutes: 45,
    }, expect.any(String), undefined)

    resolveCompletion?.(completion)
    const completed = await screen.findByRole('status', { name: '健身完成事实' })
    expect(completed).toHaveTextContent('实际 45 分钟')
    expect(completed).toHaveTextContent('270 kcal（用户估算）')
    await user.click(within(completed).getByRole('button', { name: '撤销本次完成' }))
    await waitFor(() => expect(planningApi.undoCompletion).toHaveBeenCalledWith('completion-fitness', expect.any(String), undefined))
    expect(await screen.findByText('已撤销完成；计划恢复为未完成。')).toBeVisible()
  })
})
