import { describe, expect, it } from 'vitest'
import { detectScheduleConflicts, expandRecurrence, type ScheduleBlock } from './tasks.js'

describe('expandRecurrence', () => {
  it('expands selected weekdays within an inclusive weekly window', () => {
    expect(expandRecurrence(
      { frequency: 'weekly', interval: 1, weekdays: [1, 3] },
      { from: '2026-08-10', to: '2026-08-16' },
    )).toEqual([{ date: '2026-08-10' }, { date: '2026-08-12' }])
  })

  it('clamps a monthly day to each actual month end', () => {
    expect(expandRecurrence(
      { frequency: 'monthly', interval: 1, monthDay: 31 },
      { from: '2026-02-01', to: '2026-04-30' },
    )).toEqual([{ date: '2026-02-28' }, { date: '2026-03-31' }, { date: '2026-04-30' }])
  })

  it('includes the recurrence end date and excludes later dates', () => {
    expect(expandRecurrence(
      { frequency: 'daily', interval: 1, until: '2026-08-12' },
      { from: '2026-08-10', to: '2026-08-15' },
    )).toEqual([{ date: '2026-08-10' }, { date: '2026-08-11' }, { date: '2026-08-12' }])
  })
})

describe('detectScheduleConflicts', () => {
  const block = (id: string, startsAt: string, endsAt: string): ScheduleBlock => ({ id, taskId: `task-${id}`, startsAt, endsAt, version: 1 })

  it('reports overlapping blocks once with exact overlap minutes', () => {
    expect(detectScheduleConflicts([
      block('a', '2026-08-11T09:00:00.000Z', '2026-08-11T10:00:00.000Z'),
      block('b', '2026-08-11T09:30:00.000Z', '2026-08-11T10:30:00.000Z'),
    ])).toEqual([{ leftId: 'a', rightId: 'b', overlapMinutes: 30 }])
  })

  it('does not treat an exact end/start boundary as a conflict', () => {
    expect(detectScheduleConflicts([
      block('a', '2026-08-11T09:00:00.000Z', '2026-08-11T10:00:00.000Z'),
      block('b', '2026-08-11T10:00:00.000Z', '2026-08-11T11:00:00.000Z'),
    ])).toEqual([])
  })
})
