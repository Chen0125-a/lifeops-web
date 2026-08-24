export type HabitMeasure = 'boolean' | 'count' | 'duration' | 'quantity'
export type HabitEntryStatus = 'done' | 'partial' | 'intentional-skip' | 'missed'
export type WritableHabitEntryStatus = Exclude<HabitEntryStatus, 'missed'>
export type HabitScheduleType = 'daily' | 'weekdays' | 'times-per-week' | 'interval'
export type HabitStatus = 'active' | 'paused' | 'archived'

export interface HabitSchedule {
  scheduleType: HabitScheduleType
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
  createdAt?: string
  updatedAt?: string
  deletedAt?: string | null
}

export interface HabitEntry {
  id: string
  habitId: string
  entryDate: string
  status: HabitEntryStatus
  value: number | null
  note: string
  version: number
  createdAt?: string
  updatedAt?: string
  deletedAt?: string | null
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

export interface UpdateHabitInput {
  goalId?: string | null
  projectId?: string | null
  title?: string
  description?: string
  measure?: HabitMeasure
  unit?: string | null
  targetValue?: number | null
  timezone?: string
  schedule?: HabitSchedule
  status?: HabitStatus
  version: number
}

export interface UpsertHabitEntryInput {
  status: WritableHabitEntryStatus
  value?: number | null
  note?: string
  version?: number
}

export interface HabitEntryWriteResult {
  entry: HabitEntry
  created: boolean
  replayed: boolean
}

export interface HabitsStore {
  listHabits(userId: string): Promise<Habit[]>
  getHabit(userId: string, id: string): Promise<Habit | undefined>
  createHabit(userId: string, input: CreateHabitInput, idempotencyKey: string): Promise<Habit>
  updateHabit(userId: string, id: string, input: UpdateHabitInput): Promise<Habit | undefined>
  listHabitEntries(userId: string, from?: string, to?: string): Promise<HabitEntry[]>
  upsertHabitEntry(
    userId: string,
    habitId: string,
    entryDate: string,
    input: UpsertHabitEntryInput,
    idempotencyKey?: string,
  ): Promise<HabitEntryWriteResult | undefined>
}

export type HabitsDomainErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'

export class HabitsDomainError extends Error {
  constructor(
    readonly code: HabitsDomainErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'HabitsDomainError'
  }
}

export interface HabitExpectation {
  date: string
  expected: boolean
  reason: 'scheduled' | 'weekly-quota' | 'not-scheduled' | 'before-start' | 'after-end' | 'paused' | 'archived'
  weeklyTarget?: number
}

export interface HabitWindowExpectation {
  dates: HabitExpectation[]
  today: string
}

export interface HabitWindowSummary {
  expected: number
  done: number
  partial: number
  intentionalSkip: number
  missed: number
  pending: number
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

function invalid(message: string): never {
  throw new HabitsDomainError('INVALID_INPUT', message, 400)
}

function cleanRequired(value: string, field: string, maxLength: number) {
  const result = value.trim()
  if (!result) invalid(`${field}不能为空`)
  if (result.length > maxLength) invalid(`${field}过长`)
  return result
}

function cleanOptional(value: string | undefined, maxLength: number) {
  const result = (value ?? '').trim()
  if (result.length > maxLength) invalid('文本过长')
  return result
}

function optionalId(value: string | null | undefined, field: string) {
  if (value == null) return null
  return cleanRequired(value, field, 80)
}

export function assertDateOnly(value: string, field = '日期') {
  if (!DATE_ONLY.test(value)) invalid(`${field}格式无效`)
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid(`${field}格式无效`)
  return value
}

export function normalizeHabitIdempotencyKey(value: string) {
  const result = value.trim()
  if (!result || result.length > 200) invalid('幂等键无效')
  return result
}

export function normalizeHabitSchedule(schedule: HabitSchedule): HabitSchedule {
  if (!['daily', 'weekdays', 'times-per-week', 'interval'].includes(schedule.scheduleType)) invalid('习惯排程类型无效')
  const startsOn = assertDateOnly(schedule.startsOn, '开始日期')
  const endsOn = schedule.endsOn == null ? null : assertDateOnly(schedule.endsOn, '结束日期')
  if (endsOn && endsOn < startsOn) invalid('结束日期不能早于开始日期')

  if (schedule.scheduleType === 'weekdays') {
    const weekdays = [...new Set(schedule.weekdays ?? [])].sort((left, right) => left - right)
    if (!weekdays.length || weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) invalid('每周日期无效')
    return { scheduleType: 'weekdays', weekdays, startsOn, endsOn }
  }
  if (schedule.scheduleType === 'times-per-week') {
    if (!Number.isInteger(schedule.timesPerWeek) || (schedule.timesPerWeek ?? 0) < 1 || (schedule.timesPerWeek ?? 0) > 7) invalid('每周次数必须在 1 到 7 之间')
    return { scheduleType: 'times-per-week', timesPerWeek: schedule.timesPerWeek, startsOn, endsOn }
  }
  if (schedule.scheduleType === 'interval') {
    if (!Number.isInteger(schedule.intervalDays) || (schedule.intervalDays ?? 0) < 1) invalid('间隔天数必须是正整数')
    return { scheduleType: 'interval', intervalDays: schedule.intervalDays, startsOn, endsOn }
  }
  return { scheduleType: 'daily', startsOn, endsOn }
}

function normalizeTimezone(value: string) {
  const timezone = cleanRequired(value, '时区', 64)
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date(0))
  } catch {
    invalid('时区无效')
  }
  return timezone
}

function normalizeMeasure(value: HabitMeasure) {
  if (!['boolean', 'count', 'duration', 'quantity'].includes(value)) invalid('计量方式无效')
  return value
}

function normalizeNumber(value: number | null | undefined, field: string) {
  if (value == null) return null
  if (!Number.isFinite(value) || value < 0) invalid(`${field}必须是非负数`)
  return value
}

export function createHabitEntity(id: string, now: string, input: CreateHabitInput): Habit {
  const measure = normalizeMeasure(input.measure)
  return {
    id,
    goalId: optionalId(input.goalId, '目标 ID'),
    projectId: optionalId(input.projectId, '项目 ID'),
    title: cleanRequired(input.title, '习惯标题', 240),
    description: cleanOptional(input.description, 20_000),
    measure,
    unit: input.unit == null ? null : cleanRequired(input.unit, '单位', 40),
    targetValue: input.targetValue === undefined && measure === 'boolean' ? 1 : normalizeNumber(input.targetValue, '目标值'),
    status: 'active',
    pausedAt: null,
    timezone: normalizeTimezone(input.timezone),
    schedule: normalizeHabitSchedule(input.schedule),
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
}

export function assertHabitVersion(actual: number, expected: number) {
  if (!Number.isInteger(expected) || expected < 1 || actual !== expected) {
    throw new HabitsDomainError('VERSION_CONFLICT', '习惯已被更新，请刷新后重试', 409)
  }
}

export function updateHabitEntity(current: Habit, now: string, input: UpdateHabitInput): Habit {
  assertHabitVersion(current.version, input.version)
  const nextStatus = input.status ?? current.status
  if (!['active', 'paused', 'archived'].includes(nextStatus)) invalid('习惯状态无效')
  return {
    ...current,
    goalId: input.goalId === undefined ? current.goalId : optionalId(input.goalId, '目标 ID'),
    projectId: input.projectId === undefined ? current.projectId : optionalId(input.projectId, '项目 ID'),
    title: input.title === undefined ? current.title : cleanRequired(input.title, '习惯标题', 240),
    description: input.description === undefined ? current.description : cleanOptional(input.description, 20_000),
    measure: input.measure === undefined ? current.measure : normalizeMeasure(input.measure),
    unit: input.unit === undefined ? current.unit : input.unit == null ? null : cleanRequired(input.unit, '单位', 40),
    targetValue: input.targetValue === undefined ? current.targetValue : normalizeNumber(input.targetValue, '目标值'),
    status: nextStatus,
    pausedAt: nextStatus === 'paused' ? (current.status === 'paused' ? current.pausedAt : now) : null,
    timezone: input.timezone === undefined ? current.timezone : normalizeTimezone(input.timezone),
    schedule: input.schedule === undefined ? current.schedule : normalizeHabitSchedule(input.schedule),
    version: current.version + 1,
    updatedAt: now,
  }
}

export function createHabitEntryEntity(id: string, habitId: string, entryDate: string, now: string, input: UpsertHabitEntryInput): HabitEntry {
  if (input.version !== undefined) invalid('新记录不能携带版本号')
  return {
    id,
    habitId,
    entryDate: assertDateOnly(entryDate, '记录日期'),
    status: normalizeEntryStatus(input.status),
    value: normalizeNumber(input.value, '记录值'),
    note: cleanOptional(input.note, 2_000),
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
}

export function updateHabitEntryEntity(current: HabitEntry, now: string, input: UpsertHabitEntryInput): HabitEntry {
  if (input.version === undefined) invalid('修正记录需要版本号')
  assertHabitVersion(current.version, input.version)
  return {
    ...current,
    status: normalizeEntryStatus(input.status),
    value: normalizeNumber(input.value, '记录值'),
    note: cleanOptional(input.note, 2_000),
    version: current.version + 1,
    updatedAt: now,
  }
}

function normalizeEntryStatus(value: WritableHabitEntryStatus) {
  if (!['done', 'partial', 'intentional-skip'].includes(value)) invalid('记录状态无效')
  return value
}

function localDate(value: string, timezone: string) {
  if (DATE_ONLY.test(value)) return assertDateOnly(value)
  const instant = new Date(value)
  if (Number.isNaN(instant.getTime())) invalid('日期格式无效')
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function dayNumber(value: string) {
  return Math.floor(Date.parse(`${value}T00:00:00.000Z`) / 86_400_000)
}

function isoWeekday(value: string) {
  const day = new Date(`${value}T00:00:00.000Z`).getUTCDay()
  return day === 0 ? 7 : day
}

export function getHabitExpectation(habit: Habit, value: string): HabitExpectation {
  const date = localDate(value, habit.timezone)
  if (date < habit.schedule.startsOn) return { date, expected: false, reason: 'before-start' }
  if (habit.schedule.endsOn && date > habit.schedule.endsOn) return { date, expected: false, reason: 'after-end' }
  if (habit.status === 'archived') return { date, expected: false, reason: 'archived' }
  if (habit.status === 'paused' && habit.pausedAt && date >= localDate(habit.pausedAt, habit.timezone)) {
    return { date, expected: false, reason: 'paused' }
  }

  switch (habit.schedule.scheduleType) {
    case 'daily':
      return { date, expected: true, reason: 'scheduled' }
    case 'weekdays':
      return habit.schedule.weekdays?.includes(isoWeekday(date))
        ? { date, expected: true, reason: 'scheduled' }
        : { date, expected: false, reason: 'not-scheduled' }
    case 'times-per-week':
      return { date, expected: true, reason: 'weekly-quota', weeklyTarget: habit.schedule.timesPerWeek }
    case 'interval':
      return (dayNumber(date) - dayNumber(habit.schedule.startsOn)) % (habit.schedule.intervalDays ?? 1) === 0
        ? { date, expected: true, reason: 'scheduled' }
        : { date, expected: false, reason: 'not-scheduled' }
  }
}

export function summarizeHabitWindow(entries: HabitEntry[], expectation: HabitWindowExpectation): HabitWindowSummary {
  const summary: HabitWindowSummary = { expected: 0, done: 0, partial: 0, intentionalSkip: 0, missed: 0, pending: 0 }
  const byDate = new Map(entries.map((entry) => [entry.entryDate, entry]))
  for (const date of expectation.dates) {
    if (!date.expected) continue
    summary.expected += 1
    const entry = byDate.get(date.date)
    if (entry?.status === 'done') summary.done += 1
    else if (entry?.status === 'partial') summary.partial += 1
    else if (entry?.status === 'intentional-skip') summary.intentionalSkip += 1
    else if (entry?.status === 'missed' || date.date < expectation.today) summary.missed += 1
    else summary.pending += 1
  }
  return summary
}
