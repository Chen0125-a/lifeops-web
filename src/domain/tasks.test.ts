import { describe, expect, it } from 'vitest'
import { toLegacyPlanItem, type Task, type TaskStatus } from './tasks'

function task(status: TaskStatus): Task {
  return {
    id: 'task-1',
    goalId: null,
    projectId: null,
    milestoneId: null,
    title: '兼容旧计划',
    description: '',
    startsAt: '2026-08-11T09:00:00.000Z',
    endsAt: null,
    dueAt: '2026-08-12T09:00:00.000Z',
    estimateMinutes: null,
    priority: 2,
    tags: [],
    status,
    checklist: [],
    recurrence: null,
    version: 3,
    createdAt: '2026-08-10T09:00:00.000Z',
    updatedAt: '2026-08-11T09:00:00.000Z',
    completedAt: status === 'done' ? '2026-08-11T10:00:00.000Z' : null,
    deletedAt: null,
  }
}

describe('legacy task projection', () => {
  it.each([
    ['inbox', 'planned'],
    ['planned', 'planned'],
    ['doing', 'planned'],
    ['done', 'done'],
    ['skipped', 'skipped'],
    ['cancelled', 'skipped'],
  ] as const)('maps %s without allowing legacy writes', (status, expected) => {
    const projected = toLegacyPlanItem(task(status))
    expect(projected).toMatchObject({ id: 'task-1', title: '兼容旧计划', status: expected, scheduledFor: '2026-08-11' })
    expect(Object.isFrozen(projected)).toBe(true)
  })
})
