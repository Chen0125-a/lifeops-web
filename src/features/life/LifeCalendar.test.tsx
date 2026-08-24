import { createRef } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { CalendarDaySummary, DayPlanProjection, PlanningTimeline } from '../../domain/lifePlanning'
import { LifeCalendarOverlay, type LifeCalendarSelection } from './LifeCalendarOverlay'
import { LifeCalendarPage } from './LifeCalendarPage'
import { LifeLayout } from './LifeLayout'
import { LifeTodayPage } from './LifeTodayPage'
import type { LifeDayViewModel } from './useLifeDay'

const days: CalendarDaySummary[] = [
  { date: '2026-08-19', state: 'planned', itemCount: 3, completedCount: 0 },
  { date: '2026-08-20', state: 'complete', itemCount: 4, completedCount: 4 },
  { date: '2026-08-21', state: 'past-incomplete', itemCount: 4, completedCount: 1 },
  { date: '2026-08-22', state: 'conflicted', itemCount: 2, completedCount: 0 },
]

const timeline: PlanningTimeline = { date: '2026-08-21', timelineItems: [] }
const projection: DayPlanProjection = {
  date: '2026-08-21', status: 'incomplete', plannedNutrition: { energyKcal: 2180 }, actualNutrition: {},
  plannedCostMinor: 4250, actualCostMinor: 0, plannedEnergyKcal: 300, actualEnergyKcal: 0,
  sourceIds: [], inventory: [{ status: 'incomplete', itemId: '牛奶', baseUnit: null, onHand: null, plannedDemand: null, projectedBalance: null, shortage: null, reason: 'missing_conversion' }], items: [],
}
const selection: LifeCalendarSelection = { date: '2026-08-21', timeline, projection }

function overlayProps(overrides: Partial<React.ComponentProps<typeof LifeCalendarOverlay>> = {}): React.ComponentProps<typeof LifeCalendarOverlay> {
  return {
    open: true, monthLabel: '2026年8月', days, today: '2026-08-21', selectedDate: '2026-08-21', selection,
    onSelectDate: vi.fn(), onClose: vi.fn(), onOpenDay: vi.fn(), onCopyPlan: vi.fn(), onApplyTemplate: vi.fn(),
    ...overrides,
  }
}

describe('LifeCalendar', () => {
  it('shows every calendar state with semantic copy and updates the selected-date summary', async () => {
    const user = userEvent.setup()
    const onSelectDate = vi.fn()
    render(<LifeCalendarOverlay {...overlayProps({ onSelectDate })} />)

    const dialog = screen.getByRole('dialog', { name: '生活日历' })
    expect(dialog).toHaveAttribute('data-layout', 'month/summary')
    expect(within(dialog).getByRole('gridcell', { name: /8月19日.*有计划/ })).toHaveAttribute('data-state', 'planned')
    expect(within(dialog).getByRole('gridcell', { name: /8月20日.*全部完成/ })).toHaveAttribute('data-state', 'complete')
    expect(within(dialog).getByRole('gridcell', { name: /8月21日.*今天.*已选中.*过去未完成/ })).toHaveAttribute('aria-selected', 'true')
    expect(within(dialog).getByRole('gridcell', { name: /8月22日.*有冲突/ })).toHaveAttribute('data-state', 'conflicted')

    await user.click(within(dialog).getByRole('gridcell', { name: /8月22日/ }))
    expect(onSelectDate).toHaveBeenCalledWith('2026-08-22')
    const summary = within(dialog).getByRole('region', { name: '2026年8月21日摘要' })
    expect(summary).toHaveTextContent('实际营养：数据不完整')
    expect(summary).toHaveTextContent('实际消耗成本：数据不完整')
    expect(summary).not.toHaveTextContent('实际营养 0')
  })

  it('copies only plan facts after explicit target confirmation', async () => {
    const user = userEvent.setup()
    const onCopyPlan = vi.fn()
    render(<LifeCalendarOverlay {...overlayProps({ onCopyPlan })} />)

    await user.click(screen.getByRole('button', { name: '复制计划' }))
    const confirmation = screen.getByRole('dialog', { name: '复制 2026年8月21日的计划' })
    expect(confirmation).toHaveTextContent('只复制计划，不复制完成状态、实际记录、历史快照或库存事务')
    await user.clear(within(confirmation).getByLabelText('目标日期'))
    await user.type(within(confirmation).getByLabelText('目标日期'), '2026-08-24')
    await user.click(within(confirmation).getByRole('button', { name: '确认复制计划' }))
    expect(onCopyPlan).toHaveBeenCalledWith('2026-08-21', '2026-08-24')
  })

  it('uses a roving-focus calendar grid with arrow navigation and Enter selection', async () => {
    const user = userEvent.setup()
    const onSelectDate = vi.fn()
    render(<LifeCalendarOverlay {...overlayProps({ onSelectDate })} />)

    const selected = screen.getByRole('gridcell', { name: /8月21日.*已选中/ })
    const next = screen.getByRole('gridcell', { name: /8月22日/ })
    await waitFor(() => expect(screen.getByRole('button', { name: '关闭生活日历' })).toHaveFocus())
    selected.focus()
    await user.keyboard('{ArrowRight}')
    expect(next).toHaveFocus()
    expect(next).toHaveAttribute('tabindex', '0')
    expect(selected).toHaveAttribute('tabindex', '-1')
    await user.keyboard('{Enter}')
    expect(onSelectDate).toHaveBeenCalledWith('2026-08-22')
  })

  it('traps focus, closes with Escape and restores the invoking control', async () => {
    const user = userEvent.setup()
    const triggerRef = createRef<HTMLButtonElement>()
    const onClose = vi.fn()
    const { rerender } = render(<><button ref={triggerRef}>打开生活日历</button><LifeCalendarOverlay {...overlayProps({ returnFocusRef: triggerRef, onClose })} /></>)

    const dialog = screen.getByRole('dialog', { name: '生活日历' })
    expect(within(dialog).getByRole('button', { name: '关闭生活日历' })).toHaveFocus()
    within(dialog).getByRole('button', { name: '应用模板' }).focus()
    await user.tab()
    expect(within(dialog).getByRole('button', { name: '关闭生活日历' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    rerender(<><button ref={triggerRef}>打开生活日历</button><LifeCalendarOverlay {...overlayProps({ open: false, returnFocusRef: triggerRef, onClose })} /></>)
    expect(triggerRef.current).toHaveFocus()
  })

  it('keeps a calendar network failure local and exposes a real retry', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<LifeCalendarOverlay {...overlayProps({ status: 'error', error: '网络不可用，日历事实尚未加载。', onRetry })} />)

    expect(screen.getByRole('alert')).toHaveTextContent('网络不可用，日历事实尚未加载。')
    await user.click(screen.getByRole('button', { name: '重试生活日历' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog', { name: '生活日历' })).toBeVisible()
  })

  it('keeps the life shell mounted and restores the exact day after browser Back', async () => {
    const user = userEvent.setup()
    const locationSnapshots: string[] = []
    function LocationProbe() {
      const location = useLocation()
      locationSnapshots.push(`${location.pathname}${location.search}`)
      return <output aria-label="当前位置">{`${location.pathname}${location.search}`}</output>
    }
    const emptyModel: LifeDayViewModel = { status: 'ready', date: '2026-08-20', dayPlan: null, timeline: { date: '2026-08-20', timelineItems: [] }, projection: null, budgets: [], shopping: { suggestions: [], formalItems: [] }, error: null }
    const calendarProps = overlayProps({ selectedDate: '2026-08-20', selection: { date: '2026-08-20', timeline: emptyModel.timeline, projection: null } })
    const router = createMemoryRouter([{
      path: '/app/life',
      element: <><LifeLayout /><LocationProbe /></>,
      children: [
        { index: true, element: <LifeTodayPage model={emptyModel} /> },
        { path: 'calendar', element: <LifeCalendarPage {...calendarProps} /> },
      ],
    }, { path: '*', element: <Outlet /> }], { initialEntries: ['/app/life?date=2026-08-20'] })
    render(<RouterProvider router={router} />)

    const shell = screen.getByTestId('life-shell')
    await user.click(screen.getByRole('link', { name: '打开生活日历' }))
    expect(screen.getByRole('heading', { name: '生活日历' })).toBeVisible()
    expect(screen.getByLabelText('当前位置')).toHaveTextContent('/app/life/calendar?date=2026-08-20')

    await router.navigate(-1)
    await waitFor(() => expect(screen.getByLabelText('当前位置')).toHaveTextContent('/app/life?date=2026-08-20'))
    expect(screen.getByTestId('life-shell')).toBe(shell)
    expect(locationSnapshots).toContain('/app/life?date=2026-08-20')
  })
})
