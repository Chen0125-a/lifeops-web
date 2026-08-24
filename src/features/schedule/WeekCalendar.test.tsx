import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ScheduleBlock, Task } from '../../domain/tasks'
import { WeekCalendar } from './WeekCalendar'

const scheduledTask: Task = {
  id: 'task-focus', goalId: null, projectId: null, milestoneId: null, title: '准备发布', description: '',
  startsAt: '2026-08-12T09:00:00', endsAt: '2026-08-12T10:00:00', dueAt: null,
  estimateMinutes: 60, priority: 1, tags: [], status: 'planned', checklist: [], recurrence: null,
  version: 2, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-12T00:00:00.000Z',
  completedAt: null, deletedAt: null,
}
const block: ScheduleBlock = {
  id: 'block-focus', taskId: 'task-focus', startsAt: '2026-08-12T09:00:00',
  endsAt: '2026-08-12T10:00:00', version: 2,
}

describe('WeekCalendar', () => {
  it('uses a keyboard-readable grid and names scheduled blocks without color-only meaning', () => {
    render(
      <WeekCalendar
        view="week"
        selectedDate="2026-08-12"
        todayDate="2026-08-12"
        tasks={[scheduledTask]}
        blocks={[block]}
        conflicts={[]}
        onMove={vi.fn()}
        onResize={vi.fn()}
      />,
    )

    expect(screen.getByRole('grid', { name: '2026年8月10日至16日周历' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /8月12日.*今天/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /准备发布.*09:00.*10:00.*无冲突/ })).toBeInTheDocument()
  })
})
