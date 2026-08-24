import { describe, expect, it } from 'vitest'
import type { Goal, Project } from '../../domain/goals'
import type { Habit, HabitEntry } from '../../domain/habits'
import type { LifeRecord } from '../../domain/records'
import type { Review } from '../../domain/reviews'
import type { Task } from '../../domain/tasks'
import { buildOverviewModel, type OverviewKnowledge, type OverviewModelInput } from './overviewModel'

const now = new Date('2026-08-12T10:00:00.000Z')

const goal = (id: string, patch: Partial<Goal> = {}): Goal => ({
  id, title: id, description: '', status: 'active', priority: 2, startsOn: null, targetOn: null,
  progressMode: 'manual', manualProgress: 0, version: 1, createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z', deletedAt: null, ...patch,
})
const project = (id: string, patch: Partial<Project> = {}): Project => ({
  id, goalId: null, title: id, description: '', riskNote: '', status: 'active', startsOn: null, targetOn: null,
  progress: 0, nextTaskId: null, version: 1, createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z', deletedAt: null, ...patch,
})
const task = (id: string, patch: Partial<Task> = {}): Task => ({
  id, goalId: null, projectId: null, milestoneId: null, title: id, description: '', startsAt: null,
  endsAt: null, dueAt: null, estimateMinutes: null, priority: 2, tags: [], status: 'planned',
  checklist: [], recurrence: null, version: 1, createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z', completedAt: null, deletedAt: null, ...patch,
})
const habit = (id: string): Habit => ({
  id, goalId: null, projectId: null, title: id, description: '', measure: 'boolean', unit: null,
  targetValue: null, status: 'active', pausedAt: null, timezone: 'UTC',
  schedule: { scheduleType: 'daily', startsOn: '2026-08-01' }, version: 1,
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', deletedAt: null,
})
const entry = (id: string, date: string, status: HabitEntry['status']): HabitEntry => ({
  id, habitId: 'habit-1', entryDate: date, status, value: null, note: '', version: 1,
  createdAt: `${date}T08:00:00.000Z`, updatedAt: `${date}T08:00:00.000Z`, deletedAt: null,
})
const record = (id: string, occurredAt: string): LifeRecord => ({
  id, title: id, body: id, occurredAt, tags: [], pinned: false, archivedAt: null, links: [], mediaIds: [], coverMediaId: null,
  version: 1, createdAt: occurredAt, updatedAt: occurredAt, deletedAt: null,
})
const review = (id: string, to: string, insight: string): Review => ({
  id, type: 'weekly', period: { from: '2026-08-01', to }, status: 'draft', achievements: [], problems: [],
  causes: [], insights: [insight], nextChanges: [], evidence: { period: { from: '2026-08-01', to },
    goals: { active: 0, completed: 0 }, projects: { active: 0, completed: 0 },
    tasks: { total: 0, completed: 0, skipped: 0, cancelled: 0 },
    habits: { entries: 0, done: 0, partial: 0, intentionalSkips: 0 }, records: { total: 0, ids: [] },
    priorCommitments: [], hasFacts: true }, actions: [], version: 1, createdAt: `${to}T00:00:00.000Z`,
  updatedAt: `${to}T00:00:00.000Z`, deletedAt: null,
})
const knowledge = (id: string, reviewOn: string): OverviewKnowledge => ({
  id, source: { type: 'review', id: 'review-1' }, title: id, body: id, tags: [],
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', reviewOn,
})

const input = (patch: Partial<OverviewModelInput> = {}): OverviewModelInput => ({
  goals: [], projects: [], tasks: [], habits: [], entries: [], records: [], reviews: [], knowledge: [], now,
  ...patch,
})

describe('buildOverviewModel', () => {
  it('returns a deterministic actionable empty overview with a complete seven-day window', () => {
    const model = buildOverviewModel(input())
    expect(model.isEmpty).toBe(true)
    expect(model.todayTimeline).toEqual([])
    expect(model.topGoals).toEqual([])
    expect(model.habitWeek.days.map((day) => day.date)).toEqual([
      '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16',
    ])
    expect(model.statusStrip.week).toEqual({ completed: 0, total: 0 })
    expect(model.statusStrip.platformHealth).toBe('unknown')
  })

  it('orders the current timeline and limits priority goals to three active facts', () => {
    const model = buildOverviewModel(input({
      goals: [
        goal('goal-low', { priority: 3, targetOn: '2026-08-20' }),
        goal('goal-first', { priority: 1, targetOn: '2026-08-30' }),
        goal('goal-second', { priority: 1, targetOn: '2026-09-10' }),
        goal('goal-paused', { priority: 1, status: 'paused' }),
        goal('goal-third', { priority: 2, targetOn: '2026-08-15' }),
      ],
      projects: [project('project-1', { goalId: 'goal-first', progress: 40 })],
      tasks: [
        task('later', { startsAt: '2026-08-12T15:00:00.000Z' }),
        task('tomorrow', { startsAt: '2026-08-13T08:00:00.000Z' }),
        task('earlier', { startsAt: '2026-08-12T08:30:00.000Z' }),
        task('done', { startsAt: '2026-08-12T07:00:00.000Z', status: 'done', completedAt: '2026-08-12T07:30:00.000Z' }),
      ],
    }))

    expect(model.todayTimeline.map((item) => item.id)).toEqual(['done', 'earlier', 'later'])
    expect(model.topGoals.map((item) => item.id)).toEqual(['goal-first', 'goal-second', 'goal-third'])
    expect(model.statusStrip.week).toEqual({ completed: 1, total: 4 })
    expect(model.activeProjects.map((item) => item.id)).toEqual(['project-1'])
  })

  it('builds seven habit cells and deterministic weekly status totals', () => {
    const model = buildOverviewModel(input({
      habits: [habit('habit-1')],
      entries: [
        entry('entry-done', '2026-08-10', 'done'),
        entry('entry-partial', '2026-08-11', 'partial'),
        entry('entry-skip', '2026-08-12', 'intentional-skip'),
        entry('entry-missed', '2026-08-13', 'missed'),
      ],
    }))

    expect(model.habitWeek.rows).toHaveLength(1)
    expect(model.habitWeek.rows[0]?.cells).toHaveLength(7)
    expect(model.habitWeek.totals).toEqual({ done: 1, partial: 1, intentionalSkip: 1, missed: 1, pending: 3 })
  })

  it('selects recent records, the latest prior insight and overdue knowledge in due order', () => {
    const model = buildOverviewModel(input({
      records: [record('older-record', '2026-08-10T09:00:00.000Z'), record('newer-record', '2026-08-12T09:00:00.000Z')],
      reviews: [review('older-review', '2026-08-07', '先完成重要的事'), review('latest-review', '2026-08-11', '给下午保留空档')],
      knowledge: [knowledge('due-later', '2026-08-10'), knowledge('future', '2026-08-20'), knowledge('due-first', '2026-08-05')],
    }))

    expect(model.recentRecords.map((item) => item.id)).toEqual(['newer-record', 'older-record'])
    expect(model.priorInsight).toEqual({ reviewId: 'latest-review', text: '给下午保留空档' })
    expect(model.resurfacedKnowledge.map((item) => item.id)).toEqual(['due-first', 'due-later'])
  })
})
