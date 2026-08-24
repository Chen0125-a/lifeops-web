import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Goal, Milestone, Project } from '../../domain/goals'
import { GoalsPage } from './GoalsPage'

const { useGoalsMock } = vi.hoisted(() => ({ useGoalsMock: vi.fn() }))
vi.mock('./useGoals', () => ({ useGoals: useGoalsMock }))

const goals: Goal[] = [
  ['goal-1', '完成 LifeOps', 1, 60],
  ['goal-2', '建立稳定节奏', 2, 45],
  ['goal-3', '整理长期知识', 3, 30],
  ['goal-4', '以后再做', 3, 10],
].map(([id, title, priority, manualProgress], index) => ({
  id: String(id), title: String(title), description: `${title}的说明`, status: 'active' as const,
  priority: priority as 1 | 2 | 3, startsOn: '2026-07-01', targetOn: `2026-09-${20 + index}`,
  progressMode: 'manual' as const, manualProgress: Number(manualProgress), version: 1,
  createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z', deletedAt: null,
}))

const projects: Project[] = [
  {
    id: 'project-stalled', goalId: 'goal-1', title: '停滞项目', description: '两周没有进展', riskNote: '推进停滞', status: 'active',
    startsOn: '2026-07-01', targetOn: '2026-09-01', progress: 20, nextTaskId: 'task-old', version: 1,
    createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z', deletedAt: null,
  },
  {
    id: 'project-overdue', goalId: 'goal-1', title: '逾期项目', description: '需要重新排期', riskNote: '已经逾期', status: 'active',
    startsOn: '2026-07-01', targetOn: '2026-08-10', progress: 70, nextTaskId: 'task-next', version: 1,
    createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z', deletedAt: null,
  },
  {
    id: 'project-no-next', goalId: 'goal-2', title: '无下一步项目', description: '需要补行动', riskNote: '缺少下一步', status: 'active',
    startsOn: '2026-08-01', targetOn: '2026-09-20', progress: 35, nextTaskId: null, version: 1,
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z', deletedAt: null,
  },
]

const milestones: Milestone[] = [{
  id: 'milestone-1', projectId: 'project-stalled', title: '私人黄金切片', dueOn: '2026-08-20',
  completedAt: null, position: 10, version: 1,
}]

function readyState() {
  return {
    goals,
    projects,
    milestones,
    status: 'ready',
    error: null,
    createGoal: vi.fn(),
    updateGoal: vi.fn(),
    archiveGoal: vi.fn(),
    restoreGoal: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    archiveProject: vi.fn(),
    restoreProject: vi.fn(),
    createMilestone: vi.fn(),
    updateMilestone: vi.fn(),
    completeMilestone: vi.fn(),
    archiveMilestone: vi.fn(),
    restoreMilestone: vi.fn(),
    retry: vi.fn(),
  }
}

describe('GoalsPage', () => {
  beforeEach(() => useGoalsMock.mockReturnValue(readyState()))

  it('uses the approved priority, quarterly progress, 8/4 map and attention hierarchy', () => {
    render(<MemoryRouter initialEntries={['/app/goals?goal=goal-1']}><GoalsPage now={new Date('2026-08-15T12:00:00+08:00')} /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: '目标与项目', level: 1 })).toBeVisible()
    const priorities = screen.getByRole('region', { name: '当前优先目标' })
    expect(priorities).toHaveTextContent('完成 LifeOps')
    expect(priorities).toHaveTextContent('建立稳定节奏')
    expect(priorities).toHaveTextContent('整理长期知识')
    expect(priorities).not.toHaveTextContent('以后再做')
    expect(screen.getByRole('progressbar', { name: '本季度进度' })).toHaveAttribute('aria-valuenow', '45')

    expect(screen.getByTestId('outcome-map')).toHaveAttribute('data-layout', 'timeline')
    expect(screen.getByTestId('goals-map-column')).toHaveAttribute('data-grid-span', '8')
    expect(screen.getByRole('region', { name: '对象检查器' })).toHaveAttribute('data-grid-span', '4')
    expect(screen.getByText('今天')).toHaveAttribute('data-date', '2026-08-15')

    const attention = screen.getByRole('region', { name: '需要处理的项目' })
    expect(within(attention).getByText('停滞项目')).toBeVisible()
    expect(within(attention).getByText('逾期项目')).toBeVisible()
    expect(within(attention).getByText('无下一步项目')).toBeVisible()
    expect(attention).toHaveTextContent('停滞')
    expect(attention).toHaveTextContent('逾期')
    expect(attention).toHaveTextContent('缺少下一步')
  })

  it('exposes the complete goal, project and milestone editor fields', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/app/goals?goal=goal-1']}><GoalsPage now={new Date('2026-08-15T12:00:00+08:00')} /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: '编辑目标' }))
    let editor = screen.getByRole('dialog', { name: '编辑目标' })
    for (const label of ['标题', '描述', '优先级', '开始日期', '目标日期', '状态', '进度方式']) {
      expect(within(editor).getByLabelText(label)).toBeInTheDocument()
    }
    await user.click(within(editor).getByRole('button', { name: '取消' }))

    await user.click(screen.getByRole('button', { name: '选择项目 停滞项目' }))
    await user.click(screen.getByRole('button', { name: '编辑项目' }))
    editor = screen.getByRole('dialog', { name: '编辑项目' })
    for (const label of ['标题', '描述', '目标', '开始日期', '目标日期', '状态', '下一任务', '风险备注']) {
      expect(within(editor).getByLabelText(label)).toBeInTheDocument()
    }
    await user.click(within(editor).getByRole('button', { name: '取消' }))

    await user.click(screen.getByRole('button', { name: '选择里程碑 私人黄金切片' }))
    await user.click(screen.getByRole('button', { name: '编辑里程碑' }))
    editor = screen.getByRole('dialog', { name: '编辑里程碑' })
    for (const label of ['标题', '项目', '到期日', '排序']) {
      expect(within(editor).getByLabelText(label)).toBeInTheDocument()
    }
  })

  it('does not offer a create-time goal status that the API cannot persist', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/app/goals']}><GoalsPage now={new Date('2026-08-15T12:00:00+08:00')} /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: '新建目标' }))
    const editor = screen.getByRole('dialog', { name: '新建目标' })
    expect(within(editor).getByRole('combobox', { name: /^状态/ })).toBeDisabled()
    expect(within(editor).getByText('新目标创建后为进行中，可在保存后编辑状态。')).toBeVisible()
  })

  it('traps editor focus and restores it to the invoking control', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/app/goals?goal=goal-1']}><GoalsPage now={new Date('2026-08-15T12:00:00+08:00')} /></MemoryRouter>)
    const trigger = screen.getByRole('button', { name: '编辑目标' })

    await user.click(trigger)
    const editor = screen.getByRole('dialog', { name: '编辑目标' })
    expect(within(editor).getByLabelText('标题')).toHaveFocus()

    within(editor).getByRole('button', { name: '保存' }).focus()
    await user.tab()
    expect(within(editor).getByRole('button', { name: '关闭编辑目标' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '编辑目标' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('keeps the inspector synchronized with browser history', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter([
      { path: '/app/goals', element: <GoalsPage now={new Date('2026-08-15T12:00:00+08:00')} /> },
    ], { initialEntries: ['/app/goals'] })
    render(<RouterProvider router={router} />)

    await user.click(screen.getByRole('button', { name: '选择项目 停滞项目' }))
    await user.click(screen.getByRole('button', { name: '选择里程碑 私人黄金切片' }))
    expect(within(screen.getByRole('region', { name: '对象检查器' })).getByRole('heading')).toHaveTextContent('私人黄金切片')

    await router.navigate(-1)
    await waitFor(() => expect(within(screen.getByRole('region', { name: '对象检查器' })).getByRole('heading')).toHaveTextContent('停滞项目'))
  })
})
