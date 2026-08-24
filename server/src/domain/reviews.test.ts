import { describe, expect, it } from 'vitest'
import type { Habit, HabitEntry } from './habits.js'
import type { Task } from './tasks.js'
import type { LifeRecord } from './types.js'
import { buildReviewEvidence, type ReviewEvidenceState } from './reviews.js'

const task = (patch: Partial<Task>): Task => ({
  id: patch.id ?? 'task-1', goalId: null, projectId: null, milestoneId: null,
  title: patch.title ?? '任务', description: '', startsAt: null, endsAt: null, dueAt: null,
  estimateMinutes: null, priority: 2, tags: [], status: patch.status ?? 'planned', checklist: [],
  recurrence: null, version: 1, createdAt: patch.createdAt ?? '2026-08-01T00:00:00.000Z',
  updatedAt: patch.updatedAt ?? '2026-08-01T00:00:00.000Z', completedAt: patch.completedAt ?? null,
  deletedAt: patch.deletedAt ?? null,
})

const habit: Habit = {
  id: 'habit-1', goalId: null, projectId: null, title: '训练', description: '', measure: 'boolean',
  unit: null, targetValue: null, status: 'active', pausedAt: null, timezone: 'Asia/Shanghai',
  schedule: { scheduleType: 'daily', startsOn: '2026-08-01' }, version: 1,
}

const entry = (id: string, entryDate: string, status: HabitEntry['status']): HabitEntry => ({
  id, habitId: habit.id, entryDate, status, value: null, note: '', version: 1,
})

const record = (id: string, occurredAt: string): LifeRecord => ({
  id, title: id, body: '正文', occurredAt, tags: [], pinned: false, archivedAt: null, links: [], mediaIds: [],
  version: 1, createdAt: occurredAt, updatedAt: occurredAt, deletedAt: null,
})

const emptyState = (): ReviewEvidenceState => ({
  goals: [], projects: [], tasks: [], habits: [], habitEntries: [], records: [], priorCommitments: [],
})

describe('buildReviewEvidence', () => {
  it('uses inclusive period boundaries for task completion and records', () => {
    const state = emptyState()
    state.tasks = [
      task({ id: 'before', status: 'done', completedAt: '2026-08-03T23:59:59.999Z' }),
      task({ id: 'from', status: 'done', completedAt: '2026-08-04T00:00:00.000Z' }),
      task({ id: 'to', status: 'done', completedAt: '2026-08-10T23:59:59.999Z' }),
      task({ id: 'after', status: 'done', completedAt: '2026-08-11T00:00:00.000Z' }),
    ]
    state.records = [
      record('from-record', '2026-08-04T00:00:00.000Z'),
      record('to-record', '2026-08-10T23:59:59.999Z'),
      record('after-record', '2026-08-11T00:00:00.000Z'),
    ]

    const evidence = buildReviewEvidence(state, { from: '2026-08-04', to: '2026-08-10' })

    expect(evidence.tasks).toMatchObject({ total: 2, completed: 2 })
    expect(evidence.records).toEqual({ total: 2, ids: ['from-record', 'to-record'] })
  })

  it('counts real task, habit and record facts while keeping intentional skips separate', () => {
    const state = emptyState()
    state.tasks = [
      task({ id: 'done', status: 'done', completedAt: '2026-08-06T12:00:00.000Z' }),
      task({ id: 'skipped', status: 'skipped', updatedAt: '2026-08-07T12:00:00.000Z' }),
      task({ id: 'cancelled', status: 'cancelled', updatedAt: '2026-08-08T12:00:00.000Z' }),
      task({ id: 'open', status: 'planned', updatedAt: '2026-08-09T12:00:00.000Z' }),
    ]
    state.habits = [habit]
    state.habitEntries = [
      entry('done-entry', '2026-08-05', 'done'),
      entry('partial-entry', '2026-08-06', 'partial'),
      entry('skip-entry', '2026-08-07', 'intentional-skip'),
      entry('outside-entry', '2026-08-11', 'done'),
    ]
    state.records = [record('record-1', '2026-08-08T09:00:00.000Z')]

    const evidence = buildReviewEvidence(state, { from: '2026-08-04', to: '2026-08-10' })

    expect(evidence.tasks).toEqual({ total: 4, completed: 1, skipped: 1, cancelled: 1 })
    expect(evidence.habits).toEqual({ entries: 3, done: 1, partial: 1, intentionalSkips: 1 })
    expect(evidence.records.total).toBe(1)
    expect(evidence.hasFacts).toBe(true)
  })

  it('returns only pending prior commitments without inventing narrative insights', () => {
    const state = emptyState()
    state.priorCommitments = [
      { reviewId: 'review-1', text: '每天完成一次收尾', status: 'pending' },
      { reviewId: 'review-1', text: '已转成任务', status: 'converted' },
      { reviewId: 'review-2', text: '主动放弃', status: 'dismissed' },
    ]

    const evidence = buildReviewEvidence(state, { from: '2026-08-04', to: '2026-08-10' })

    expect(evidence.priorCommitments).toEqual([
      { reviewId: 'review-1', text: '每天完成一次收尾', status: 'pending' },
    ])
    expect(evidence).not.toHaveProperty('insights')
    expect(evidence).not.toHaveProperty('achievements')
  })

  it('represents a zero-data period explicitly with stable zero totals', () => {
    expect(buildReviewEvidence(emptyState(), { from: '2026-08-04', to: '2026-08-10' })).toEqual({
      period: { from: '2026-08-04', to: '2026-08-10' },
      goals: { active: 0, completed: 0 },
      projects: { active: 0, completed: 0 },
      tasks: { total: 0, completed: 0, skipped: 0, cancelled: 0 },
      habits: { entries: 0, done: 0, partial: 0, intentionalSkips: 0 },
      records: { total: 0, ids: [] },
      priorCommitments: [],
      hasFacts: false,
    })
  })

  it('rejects invalid or reversed date-only periods', () => {
    expect(() => buildReviewEvidence(emptyState(), { from: '2026-8-4', to: '2026-08-10' }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_INPUT', status: 400 }))
    expect(() => buildReviewEvidence(emptyState(), { from: '2026-08-11', to: '2026-08-10' }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_INPUT', status: 400 }))
  })
})
