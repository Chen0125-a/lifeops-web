import { describe, expect, it } from 'vitest'
import {
  getHabitExpectation,
  summarizeHabitWindow,
  type Habit,
  type HabitEntry,
  type HabitSchedule,
} from './habits.js'

function habit(schedule: HabitSchedule, patch: Partial<Habit> = {}): Habit {
  return {
    id: 'habit-1',
    goalId: null,
    projectId: null,
    title: '稳定节律',
    description: '',
    measure: 'boolean',
    unit: null,
    targetValue: 1,
    status: 'active',
    pausedAt: null,
    timezone: 'Asia/Shanghai',
    schedule,
    version: 1,
    ...patch,
  }
}

describe('habit expectations', () => {
  it('handles daily schedule boundaries', () => {
    const subject = habit({ scheduleType: 'daily', startsOn: '2026-08-10', endsOn: '2026-08-12' })
    expect(getHabitExpectation(subject, '2026-08-09')).toMatchObject({ date: '2026-08-09', expected: false, reason: 'before-start' })
    expect(getHabitExpectation(subject, '2026-08-10')).toMatchObject({ expected: true, reason: 'scheduled' })
    expect(getHabitExpectation(subject, '2026-08-12')).toMatchObject({ expected: true, reason: 'scheduled' })
    expect(getHabitExpectation(subject, '2026-08-13')).toMatchObject({ expected: false, reason: 'after-end' })
  })

  it('uses the habit timezone before evaluating selected weekdays', () => {
    const subject = habit({ scheduleType: 'weekdays', weekdays: [1], startsOn: '2026-08-01' })
    expect(getHabitExpectation(subject, '2026-08-09T15:30:00.000Z')).toMatchObject({ date: '2026-08-09', expected: false, reason: 'not-scheduled' })
    expect(getHabitExpectation(subject, '2026-08-09T16:30:00.000Z')).toMatchObject({ date: '2026-08-10', expected: true, reason: 'scheduled' })
  })

  it('anchors custom intervals to the schedule start date', () => {
    const subject = habit({ scheduleType: 'interval', intervalDays: 3, startsOn: '2026-08-01' })
    expect(getHabitExpectation(subject, '2026-08-01').expected).toBe(true)
    expect(getHabitExpectation(subject, '2026-08-03').expected).toBe(false)
    expect(getHabitExpectation(subject, '2026-08-04').expected).toBe(true)
  })

  it('represents times-per-week as a weekly quota without inventing fixed weekdays', () => {
    const subject = habit({ scheduleType: 'times-per-week', timesPerWeek: 3, startsOn: '2026-08-01' })
    expect(getHabitExpectation(subject, '2026-08-11')).toEqual({
      date: '2026-08-11',
      expected: true,
      reason: 'weekly-quota',
      weeklyTarget: 3,
    })
  })

  it('keeps dates before a pause eligible and suppresses the pause interval', () => {
    const subject = habit(
      { scheduleType: 'daily', startsOn: '2026-08-01' },
      { status: 'paused', pausedAt: '2026-08-10T16:30:00.000Z' },
    )
    expect(getHabitExpectation(subject, '2026-08-10')).toMatchObject({ expected: true, reason: 'scheduled' })
    expect(getHabitExpectation(subject, '2026-08-11')).toMatchObject({ expected: false, reason: 'paused' })
  })
})

describe('habit window statistics', () => {
  it('keeps done, partial, intentional skip, derived missed and pending separate', () => {
    const subject = habit({ scheduleType: 'daily', startsOn: '2026-08-01' })
    const dates = ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05']
      .map((date) => getHabitExpectation(subject, date))
    const entries: HabitEntry[] = [
      { id: 'entry-1', habitId: subject.id, entryDate: '2026-08-01', status: 'done', value: 1, note: '', version: 1 },
      { id: 'entry-2', habitId: subject.id, entryDate: '2026-08-02', status: 'partial', value: 0.5, note: '', version: 1 },
      { id: 'entry-3', habitId: subject.id, entryDate: '2026-08-03', status: 'intentional-skip', value: null, note: '主动休息', version: 1 },
    ]

    expect(summarizeHabitWindow(entries, { dates, today: '2026-08-05' })).toEqual({
      expected: 5,
      done: 1,
      partial: 1,
      intentionalSkip: 1,
      missed: 1,
      pending: 1,
    })
  })
})
