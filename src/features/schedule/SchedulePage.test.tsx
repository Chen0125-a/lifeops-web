import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduleBlock, ScheduleConflict, Task } from '../../domain/tasks'
import { SchedulePage } from './SchedulePage'

const { useScheduleMock } = vi.hoisted(() => ({ useScheduleMock: vi.fn() }))
vi.mock('./useSchedule', () => ({ useSchedule: useScheduleMock }))

const task = (id: string, patch: Partial<Task> = {}): Task => ({
  id,
  goalId: null,
  projectId: 'project-alpha',
  milestoneId: null,
  title: id,
  description: '',
  startsAt: null,
  endsAt: null,
  dueAt: null,
  estimateMinutes: 45,
  priority: 2,
  tags: [],
  status: 'planned',
  checklist: [],
  recurrence: null,
  version: 4,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-12T00:00:00.000Z',
  completedAt: null,
  deletedAt: null,
  ...patch,
})

const tasks: Task[] = [
  task('今日深度工作', {
    startsAt: '2026-08-12T09:00:00.000Z',
    endsAt: '2026-08-12T18:15:00.000Z',
  }),
  task('撰写周报'),
  task('临期整理', { dueAt: '2026-08-14T10:00:00.000Z' }),
  task('已逾期复盘', { dueAt: '2026-08-11T10:00:00.000Z' }),
]

const blocks: ScheduleBlock[] = [
  { id: 'block-a', taskId: '今日深度工作', startsAt: '2026-08-12T09:00:00.000Z', endsAt: '2026-08-12T18:15:00.000Z', version: 1 },
  { id: 'block-b', taskId: '临期整理', startsAt: '2026-08-12T10:00:00.000Z', endsAt: '2026-08-12T11:00:00.000Z', version: 1 },
]

const conflicts: ScheduleConflict[] = [{ leftId: 'block-a', rightId: 'block-b', overlapMinutes: 60 }]

function readyState(patch: Record<string, unknown> = {}) {
  return {
    tasks,
    blocks,
    conflicts,
    status: 'ready',
    error: null,
    scheduleTask: vi.fn().mockResolvedValue({
      token: 'undo-1',
      taskId: '撰写周报',
      previous: null,
      version: 4,
    }),
    undoSchedule: vi.fn().mockResolvedValue(undefined),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    retry: vi.fn(),
    ...patch,
  }
}

function LocationProbe() {
  return <output aria-label="当前日程查询">{useLocation().search}</output>
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/app/schedule']}>
      <SchedulePage now={new Date('2026-08-12T08:00:00.000Z')} />
      <LocationProbe />
    </MemoryRouter>,
  )
}

describe('SchedulePage', () => {
  beforeEach(() => useScheduleMock.mockReturnValue(readyState()))

  it('defaults to the week canvas and exposes view, filters, pools and truthful warnings', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByRole('heading', { level: 1, name: '日程' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '周视图' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('combobox', { name: '项目筛选' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '状态筛选' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '今天' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '临期' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '未排期' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '已逾期' })).toBeInTheDocument()
    expect(screen.getByText(/今日安排超过 8 小时/)).toBeInTheDocument()
    expect(screen.getByText(/1 组时间冲突/)).toBeInTheDocument()

    await waitFor(() => expect(screen.getByLabelText('当前日程查询')).toHaveTextContent('?view=week&date=2026-08-12'))
    await user.click(screen.getByRole('button', { name: '月视图' }))
    expect(screen.getByRole('button', { name: '月视图' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('当前日程查询')).toHaveTextContent('view=month')
    await user.click(screen.getByRole('button', { name: '回到今天' }))
    expect(screen.getByLabelText('当前日程查询')).toHaveTextContent('date=2026-08-12')
  })

  it('offers all three approved empty-state actions', () => {
    useScheduleMock.mockReturnValue(readyState({ tasks: [], blocks: [], conflicts: [], status: 'empty' }))
    renderPage()

    expect(screen.getByText('还没有可安排的任务')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '创建任务' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '从目标拆解' })).toHaveAttribute('href', '/app/goals')
    expect(screen.getByRole('button', { name: '创建重复项' })).toBeInTheDocument()
  })

  it('schedules a focused task with Enter, arrow keys and an explicit confirmation', async () => {
    const state = readyState()
    useScheduleMock.mockReturnValue(state)
    const user = userEvent.setup()
    renderPage()

    const unscheduled = screen.getByRole('button', { name: '排期：撰写周报' })
    unscheduled.focus()
    await user.keyboard('{Enter}')
    const planner = screen.getByRole('group', { name: '键盘排期' })
    expect(planner).toHaveFocus()

    await user.keyboard('{ArrowRight}{ArrowDown}')
    await user.click(screen.getByRole('button', { name: '确认排期' }))

    expect(state.scheduleTask).toHaveBeenCalledTimes(1)
    expect(state.scheduleTask).toHaveBeenCalledWith(
      '撰写周报',
      '2026-08-13T09:15:00',
      '2026-08-13T10:00:00',
      4,
    )
    expect(await screen.findByRole('button', { name: '撤销排期' })).toBeInTheDocument()
  })
})
