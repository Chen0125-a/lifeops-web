export type HabitMeasure = 'boolean' | 'count' | 'duration' | 'quantity'
export type HabitStatus = 'active' | 'paused' | 'archived'
export type HabitEntryStatus = 'done' | 'partial' | 'intentional-skip' | 'missed'
export type WritableHabitEntryStatus = Exclude<HabitEntryStatus, 'missed'>

export interface HabitSchedule {
  scheduleType: 'daily' | 'weekdays' | 'times-per-week' | 'interval'
  weekdays?: number[]
  timesPerWeek?: number
  intervalDays?: number
  startsOn: string
  endsOn?: string | null
}

export interface Habit {
  id: string
  goalId: string | null
  projectId: string | null
  title: string
  description: string
  measure: HabitMeasure
  unit: string | null
  targetValue: number | null
  status: HabitStatus
  pausedAt: string | null
  timezone: string
  schedule: HabitSchedule
  version: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface HabitEntry {
  id: string
  habitId: string
  entryDate: string
  status: HabitEntryStatus
  value: number | null
  note: string
  version: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface HabitWindow {
  from: string | null
  to: string | null
  habits: Habit[]
  entries: HabitEntry[]
}

export interface CreateHabitInput {
  goalId?: string | null
  projectId?: string | null
  title: string
  description?: string
  measure: HabitMeasure
  unit?: string | null
  targetValue?: number | null
  timezone: string
  schedule: HabitSchedule
}

export interface UpdateHabitInput extends Partial<CreateHabitInput> {
  status?: HabitStatus
  version: number
}

export interface CreateHabitEntryInput {
  status: WritableHabitEntryStatus
  value?: number | null
  note?: string
}

export interface CorrectHabitEntryInput extends CreateHabitEntryInput {
  version: number
}
