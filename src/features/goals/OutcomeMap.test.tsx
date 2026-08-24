import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Goal, Milestone, Project } from '../../domain/goals'
import { OutcomeMap } from './OutcomeMap'

const goals: Goal[] = [{
  id: 'goal-1', title: '完成 LifeOps', description: '持续交付', status: 'active', priority: 1,
  startsOn: '2026-07-01', targetOn: '2026-09-30', progressMode: 'manual', manualProgress: 42,
  version: 1, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z', deletedAt: null,
}]
const projects: Project[] = [{
  id: 'project-1', goalId: 'goal-1', title: 'LifeOps Web', description: '私人复杂操作', riskNote: '发布证据待刷新', status: 'active',
  startsOn: '2026-08-01', targetOn: '2026-08-31', progress: 55, nextTaskId: null, version: 1,
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z', deletedAt: null,
}]
const milestones: Milestone[] = [{
  id: 'milestone-1', projectId: 'project-1', title: '私人黄金切片', dueOn: '2026-08-20',
  completedAt: null, position: 10, version: 1,
}]

describe('OutcomeMap', () => {
  it('renders date-derived goal bands, project bars, milestones and a current-date marker', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <OutcomeMap
        goals={goals}
        projects={projects}
        milestones={milestones}
        range={{ from: '2026-07-01', to: '2026-09-30' }}
        now="2026-08-15"
        selected={{ type: 'goal', id: 'goal-1' }}
        onSelect={onSelect}
        onEdit={vi.fn()}
      />,
    )

    const map = screen.getByTestId('outcome-map')
    expect(map).toHaveAttribute('data-layout', 'timeline')
    expect(map).toHaveAttribute('data-range', '2026-07-01/2026-09-30')
    expect(map).toHaveAttribute('data-motion-layout-scope', 'goals-outcomes')
    const layoutIdentity = map.querySelector('[data-layout-identity="goals-selected-object"]')
    expect(layoutIdentity).toBeInTheDocument()
    expect(layoutIdentity?.closest('li')).toHaveAttribute('data-selected', 'true')
    expect(screen.getByRole('img', { name: '目标、项目与里程碑成果地图' })).toBeInTheDocument()
    expect(screen.getByText('今天')).toHaveAttribute('data-date', '2026-08-15')
    expect(screen.getByText('完成 LifeOps')).toHaveAttribute('data-kind', 'goal')
    expect(screen.getByText('LifeOps Web')).toHaveAttribute('data-kind', 'project')
    expect(screen.getByText('私人黄金切片')).toHaveAttribute('data-kind', 'milestone')

    await user.click(screen.getByRole('button', { name: '选择项目 LifeOps Web' }))
    expect(onSelect).toHaveBeenCalledWith({ type: 'project', id: 'project-1' })
  })
})
