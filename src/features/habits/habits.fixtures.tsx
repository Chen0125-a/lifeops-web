import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Habit, HabitEntry, HabitWindow } from '../../domain/habits'
import { HabitsPage } from './HabitsPage'

export const habit = (id: string, patch: Partial<Habit> = {}): Habit => ({
  id,
  goalId: 'goal-reading',
  projectId: 'project-lifeops',
  title: id,
  description: '',
  measure: 'duration',
  unit: '分钟',
  targetValue: 30,
  status: 'active',
  pausedAt: null,
  timezone: 'Asia/Shanghai',
  schedule: { scheduleType: 'daily', startsOn: '2026-08-01', endsOn: null },
  version: 2,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-14T00:00:00.000Z',
  deletedAt: null,
  ...patch,
})

export const entry = (id: string, habitId: string, entryDate: string, patch: Partial<HabitEntry> = {}): HabitEntry => ({
  id,
  habitId,
  entryDate,
  status: 'done',
  value: 30,
  note: '',
  version: 1,
  createdAt: `${entryDate}T12:00:00.000Z`,
  updatedAt: `${entryDate}T12:00:00.000Z`,
  deletedAt: null,
  ...patch,
})

export const habits: Habit[] = [
  habit('habit-reading', { title: '阅读' }),
  habit('habit-meditation', { title: '冥想', measure: 'boolean', unit: null, targetValue: 1 }),
  habit('habit-pushups', { title: '俯卧撑', measure: 'count', unit: '次', targetValue: 20 }),
  habit('habit-water', { title: '饮水', measure: 'quantity', unit: '毫升', targetValue: 2000 }),
  habit('habit-strength', {
    title: '力量训练',
    measure: 'boolean',
    unit: null,
    targetValue: 1,
    schedule: { scheduleType: 'weekdays', weekdays: [1, 3, 5], startsOn: '2026-08-01', endsOn: null },
  }),
]

export const entries: HabitEntry[] = [
  entry('entry-done', 'habit-reading', '2026-08-09'),
  entry('entry-partial', 'habit-reading', '2026-08-10', { status: 'partial', value: 20 }),
  entry('entry-skip', 'habit-reading', '2026-08-11', { status: 'intentional-skip', value: null, note: '生病休息' }),
]

export const windowFixture: HabitWindow = {
  from: '2026-07-19',
  to: '2026-08-16',
  habits,
  entries,
}

export function renderHabitsRoute(initialEntry = '/app/habits?habit=habit-reading') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <HabitsPage now={new Date('2026-08-15T12:00:00+08:00')} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
