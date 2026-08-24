export type TaskStatus = 'inbox' | 'planned' | 'doing' | 'done' | 'skipped' | 'cancelled'

export interface RecurrenceRule {
  frequency: 'daily' | 'weekly' | 'monthly'
  interval: number
  weekdays?: number[]
  monthDay?: number
  until?: string | null
}

export interface RecurrenceWindow {
  from: string
  to: string
  anchor?: string
}

export interface Occurrence {
  date: string
}

export interface ChecklistItem {
  id: string
  taskId: string
  title: string
  isCompleted: boolean
  completedAt: string | null
  position: number
  version: number
}

export interface Task {
  id: string
  goalId: string | null
  projectId: string | null
  milestoneId: string | null
  title: string
  description: string
  startsAt: string | null
  endsAt: string | null
  dueAt: string | null
  estimateMinutes: number | null
  priority: 1 | 2 | 3
  tags: string[]
  status: TaskStatus
  checklist: ChecklistItem[]
  recurrence: RecurrenceRule | null
  version: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
  deletedAt: string | null
}

export interface ScheduleBlock {
  id: string
  taskId: string
  startsAt: string
  endsAt: string
  version: number
}

export interface ScheduleConflict {
  leftId: string
  rightId: string
  overlapMinutes: number
}

export interface CreateTaskInput {
  goalId?: string | null
  projectId?: string | null
  milestoneId?: string | null
  title: string
  description?: string
  startsAt?: string | null
  endsAt?: string | null
  dueAt?: string | null
  estimateMinutes?: number | null
  priority?: 1 | 2 | 3
  tags?: string[]
  status?: TaskStatus
  recurrence?: RecurrenceRule | null
}

export interface UpdateTaskInput extends Partial<CreateTaskInput> {
  version: number
}

export interface TasksStore {
  listTasks(userId: string): Promise<Task[]>
  getTask(userId: string, id: string): Promise<Task | undefined>
  createTask(userId: string, input: CreateTaskInput, idempotencyKey: string): Promise<Task>
  updateTask(userId: string, id: string, input: UpdateTaskInput): Promise<Task | undefined>
  deleteTask(userId: string, id: string, version: number): Promise<boolean>
  setTaskCompletion(userId: string, id: string, version: number, completed: boolean): Promise<Task | undefined>
  addChecklistItem(userId: string, taskId: string, input: { title: string; position?: number }, idempotencyKey: string): Promise<ChecklistItem>
  updateChecklistItem(userId: string, taskId: string, id: string, input: { title?: string; isCompleted?: boolean; position?: number; version: number }): Promise<ChecklistItem | undefined>
  deleteChecklistItem(userId: string, taskId: string, id: string, version: number): Promise<boolean>
  listScheduleBlocks(userId: string, from?: string, to?: string): Promise<ScheduleBlock[]>
  createScheduleBlock(userId: string, input: { taskId: string; startsAt: string; endsAt: string }, idempotencyKey: string): Promise<ScheduleBlock>
  updateScheduleBlock(userId: string, id: string, input: { startsAt?: string; endsAt?: string; version: number }): Promise<ScheduleBlock | undefined>
  deleteScheduleBlock(userId: string, id: string, version: number): Promise<boolean>
}

export type TasksErrorCode = 'INVALID_INPUT' | 'NOT_FOUND' | 'VERSION_CONFLICT' | 'IDEMPOTENCY_CONFLICT'

export class TasksDomainError extends Error {
  readonly name = 'TasksDomainError'

  constructor(
    public readonly code: TasksErrorCode,
    message: string,
    public readonly status: 400 | 404 | 409,
  ) {
    super(message)
  }
}

const taskStatuses = new Set<TaskStatus>(['inbox', 'planned', 'doing', 'done', 'skipped', 'cancelled'])

function invalid(message: string): never {
  throw new TasksDomainError('INVALID_INPUT', message, 400)
}

function requiredText(value: unknown, field: string, maxLength: number) {
  if (typeof value !== 'string') invalid(`${field}不能为空`)
  const result = value.trim()
  if (!result) invalid(`${field}不能为空`)
  if (result.length > maxLength) invalid(`${field}不能超过 ${maxLength} 个字符`)
  return result
}

function optionalText(value: unknown, field: string, maxLength: number) {
  if (value === undefined) return undefined
  if (typeof value !== 'string') invalid(`${field}格式无效`)
  const result = value.trim()
  if (result.length > maxLength) invalid(`${field}不能超过 ${maxLength} 个字符`)
  return result
}

function nullableId(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  return requiredText(value, field, 80)
}

function instant(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') invalid(`${field}格式无效`)
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) invalid(`${field}格式无效`)
  return parsed.toISOString()
}

function positiveInteger(value: unknown, field: string, maximum: number): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) invalid(`${field}无效`)
  return value as number
}

function taskPriority(value: unknown): 1 | 2 | 3 | undefined {
  if (value === undefined) return undefined
  if (value !== 1 && value !== 2 && value !== 3) invalid('优先级必须是 1、2 或 3')
  return value
}

function taskStatus(value: unknown): TaskStatus | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !taskStatuses.has(value as TaskStatus)) invalid('任务状态无效')
  return value as TaskStatus
}

function tags(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 50) invalid('标签格式无效')
  const normalized = value.map((item) => requiredText(item, '标签', 80))
  return [...new Set(normalized)]
}

function recurrence(value: unknown): RecurrenceRule | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (!value || typeof value !== 'object') invalid('重复规则格式无效')
  const input = value as Partial<RecurrenceRule>
  if (input.frequency !== 'daily' && input.frequency !== 'weekly' && input.frequency !== 'monthly') invalid('重复频率无效')
  if (!Number.isSafeInteger(input.interval) || (input.interval as number) < 1) invalid('重复间隔必须是正整数')
  let weekdays: number[] | undefined
  if (input.weekdays !== undefined) {
    if (!Array.isArray(input.weekdays) || input.weekdays.length > 7 || input.weekdays.some((item) => !Number.isSafeInteger(item) || item < 1 || item > 7)) invalid('星期必须在 1 到 7 之间')
    weekdays = [...new Set(input.weekdays)].sort((left, right) => left - right)
  }
  if (input.frequency === 'weekly' && (!weekdays || weekdays.length === 0)) invalid('每周重复至少需要一个星期')
  if (input.monthDay !== undefined && (!Number.isSafeInteger(input.monthDay) || input.monthDay < 1 || input.monthDay > 31)) invalid('每月日期必须在 1 到 31 之间')
  if (input.frequency === 'monthly' && input.monthDay === undefined) invalid('每月重复需要日期')
  let until: string | null | undefined
  if (input.until !== undefined && input.until !== null) {
    if (typeof input.until !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.until)) invalid('重复结束日期必须是 YYYY-MM-DD')
    const parsed = new Date(`${input.until}T00:00:00.000Z`)
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== input.until) invalid('重复结束日期无效')
    until = input.until
  } else {
    until = input.until
  }
  return { frequency: input.frequency, interval: input.interval as number, ...(weekdays ? { weekdays } : {}), ...(input.monthDay === undefined ? {} : { monthDay: input.monthDay }), ...(until === undefined ? {} : { until }) }
}

function assertTimeRange(startsAt: string | null, endsAt: string | null) {
  if (startsAt && endsAt && Date.parse(endsAt) < Date.parse(startsAt)) invalid('结束时间不能早于开始时间')
}

function requirePatch(input: Record<string, unknown>) {
  if (!Object.keys(input).some((key) => key !== 'version' && input[key] !== undefined)) invalid('至少需要修改一个字段')
}

export function assertTaskVersion(actual: number, expected: unknown) {
  if (!Number.isSafeInteger(expected) || (expected as number) < 0) invalid('版本号无效')
  if (actual !== expected) throw new TasksDomainError('VERSION_CONFLICT', '数据已经在另一处更新', 409)
}

export function normalizeTaskIdempotencyKey(value: string) {
  return requiredText(value, '幂等键', 190)
}

export function createTaskEntity(id: string, now: string, input: CreateTaskInput): Task {
  const startsAt = instant(input.startsAt, '开始时间') ?? null
  const endsAt = instant(input.endsAt, '结束时间') ?? null
  assertTimeRange(startsAt, endsAt)
  const status = taskStatus(input.status) ?? 'inbox'
  return {
    id,
    goalId: nullableId(input.goalId, '目标') ?? null,
    projectId: nullableId(input.projectId, '项目') ?? null,
    milestoneId: nullableId(input.milestoneId, '里程碑') ?? null,
    title: requiredText(input.title, '任务标题', 240),
    description: optionalText(input.description, '任务描述', 20_000) ?? '',
    startsAt,
    endsAt,
    dueAt: instant(input.dueAt, '截止时间') ?? null,
    estimateMinutes: positiveInteger(input.estimateMinutes, '预计分钟数', 525_600) ?? null,
    priority: taskPriority(input.priority) ?? 2,
    tags: tags(input.tags) ?? [],
    status,
    checklist: [],
    recurrence: recurrence(input.recurrence) ?? null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    completedAt: status === 'done' ? now : null,
    deletedAt: null,
  }
}

export function updateTaskEntity(current: Task, now: string, input: UpdateTaskInput): Task {
  assertTaskVersion(current.version, input.version)
  requirePatch(input as unknown as Record<string, unknown>)
  const startsAt = instant(input.startsAt, '开始时间')
  const endsAt = instant(input.endsAt, '结束时间')
  const nextStatus = taskStatus(input.status) ?? current.status
  const next: Task = {
    ...current,
    goalId: nullableId(input.goalId, '目标') ?? (input.goalId === null ? null : current.goalId),
    projectId: nullableId(input.projectId, '项目') ?? (input.projectId === null ? null : current.projectId),
    milestoneId: nullableId(input.milestoneId, '里程碑') ?? (input.milestoneId === null ? null : current.milestoneId),
    title: input.title === undefined ? current.title : requiredText(input.title, '任务标题', 240),
    description: optionalText(input.description, '任务描述', 20_000) ?? current.description,
    startsAt: startsAt === undefined ? current.startsAt : startsAt,
    endsAt: endsAt === undefined ? current.endsAt : endsAt,
    dueAt: instant(input.dueAt, '截止时间') ?? (input.dueAt === null ? null : current.dueAt),
    estimateMinutes: positiveInteger(input.estimateMinutes, '预计分钟数', 525_600) ?? (input.estimateMinutes === null ? null : current.estimateMinutes),
    priority: taskPriority(input.priority) ?? current.priority,
    tags: tags(input.tags) ?? current.tags,
    status: nextStatus,
    recurrence: recurrence(input.recurrence) ?? (input.recurrence === null ? null : current.recurrence),
    completedAt: nextStatus === 'done' ? (current.completedAt ?? now) : null,
    version: current.version + 1,
    updatedAt: now,
  }
  assertTimeRange(next.startsAt, next.endsAt)
  return next
}

export function createChecklistItemEntity(id: string, taskId: string, now: string, input: { title: string; position?: number }): ChecklistItem {
  return {
    id,
    taskId,
    title: requiredText(input.title, '清单项', 500),
    isCompleted: false,
    completedAt: null,
    position: positiveInteger(input.position, '清单位置', 4_294_967_295) ?? 0,
    version: 1,
  }
}

export function updateChecklistItemEntity(current: ChecklistItem, now: string, input: { title?: string; isCompleted?: boolean; position?: number; version: number }): ChecklistItem {
  assertTaskVersion(current.version, input.version)
  requirePatch(input as unknown as Record<string, unknown>)
  if (input.isCompleted !== undefined && typeof input.isCompleted !== 'boolean') invalid('清单完成状态无效')
  const isCompleted = input.isCompleted ?? current.isCompleted
  return {
    ...current,
    title: input.title === undefined ? current.title : requiredText(input.title, '清单项', 500),
    isCompleted,
    completedAt: isCompleted ? (current.completedAt ?? now) : null,
    position: positiveInteger(input.position, '清单位置', 4_294_967_295) ?? current.position,
    version: current.version + 1,
  }
}

export function createScheduleBlockEntity(id: string, input: { taskId: string; startsAt: string; endsAt: string }): ScheduleBlock {
  const startsAt = instant(input.startsAt, '日程开始时间')
  const endsAt = instant(input.endsAt, '日程结束时间')
  if (!startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt)) invalid('日程结束时间必须晚于开始时间')
  return { id, taskId: requiredText(input.taskId, '任务', 80), startsAt, endsAt, version: 1 }
}

export function updateScheduleBlockEntity(current: ScheduleBlock, input: { startsAt?: string; endsAt?: string; version: number }): ScheduleBlock {
  assertTaskVersion(current.version, input.version)
  requirePatch(input as unknown as Record<string, unknown>)
  const startsAt = instant(input.startsAt, '日程开始时间') ?? current.startsAt
  const endsAt = instant(input.endsAt, '日程结束时间') ?? current.endsAt
  if (Date.parse(endsAt) <= Date.parse(startsAt)) invalid('日程结束时间必须晚于开始时间')
  return { ...current, startsAt, endsAt, version: current.version + 1 }
}

const DAY_MS = 24 * 60 * 60 * 1000

function day(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field}必须是 YYYY-MM-DD`)
  const result = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0, 10) !== value) throw new Error(`${field}不是有效日期`)
  return result
}

function dateString(value: Date) {
  return value.toISOString().slice(0, 10)
}

function validInterval(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('重复间隔必须是正整数')
  return value
}

function mondayIndex(value: Date) {
  return (value.getUTCDay() + 6) % 7
}

export function expandRecurrence(rule: RecurrenceRule, window: RecurrenceWindow): Occurrence[] {
  const from = day(window.from, '窗口开始日期')
  const to = day(window.to, '窗口结束日期')
  if (to < from) throw new Error('窗口结束日期不能早于开始日期')
  const anchor = day(window.anchor ?? window.from, '重复锚点')
  const until = rule.until ? day(rule.until, '重复结束日期') : undefined
  const end = until && until < to ? until : to
  if (end < from) return []
  const interval = validInterval(rule.interval)
  const occurrences: Occurrence[] = []

  if (rule.frequency === 'daily') {
    for (let cursor = new Date(from); cursor <= end; cursor = new Date(cursor.getTime() + DAY_MS)) {
      const distance = Math.floor((cursor.getTime() - anchor.getTime()) / DAY_MS)
      if (distance >= 0 && distance % interval === 0) occurrences.push({ date: dateString(cursor) })
    }
    return occurrences
  }

  if (rule.frequency === 'weekly') {
    const weekdays = [...new Set(rule.weekdays ?? [mondayIndex(anchor) + 1])]
    if (weekdays.some((value) => !Number.isSafeInteger(value) || value < 1 || value > 7)) throw new Error('星期必须在 1 到 7 之间')
    const anchorWeek = new Date(anchor.getTime() - mondayIndex(anchor) * DAY_MS)
    for (let cursor = new Date(from); cursor <= end; cursor = new Date(cursor.getTime() + DAY_MS)) {
      const week = Math.floor((cursor.getTime() - anchorWeek.getTime()) / (7 * DAY_MS))
      if (week >= 0 && week % interval === 0 && weekdays.includes(mondayIndex(cursor) + 1)) {
        occurrences.push({ date: dateString(cursor) })
      }
    }
    return occurrences
  }

  const monthDay = rule.monthDay ?? anchor.getUTCDate()
  if (!Number.isSafeInteger(monthDay) || monthDay < 1 || monthDay > 31) throw new Error('每月日期必须在 1 到 31 之间')
  const anchorMonth = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth()
  const firstMonth = from.getUTCFullYear() * 12 + from.getUTCMonth()
  const lastMonth = end.getUTCFullYear() * 12 + end.getUTCMonth()
  for (let monthIndex = firstMonth; monthIndex <= lastMonth; monthIndex += 1) {
    const distance = monthIndex - anchorMonth
    if (distance < 0 || distance % interval !== 0) continue
    const year = Math.floor(monthIndex / 12)
    const month = monthIndex % 12
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    const occurrence = new Date(Date.UTC(year, month, Math.min(monthDay, lastDay)))
    if (occurrence >= from && occurrence <= end) occurrences.push({ date: dateString(occurrence) })
  }
  return occurrences
}

export function detectScheduleConflicts(blocks: ScheduleBlock[]): ScheduleConflict[] {
  const ranges = blocks.map((block) => {
    const start = Date.parse(block.startsAt)
    const end = Date.parse(block.endsAt)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('日程区块时间范围无效')
    return { block, start, end }
  })
  const conflicts: ScheduleConflict[] = []
  for (let left = 0; left < ranges.length; left += 1) {
    for (let right = left + 1; right < ranges.length; right += 1) {
      const overlap = Math.min(ranges[left].end, ranges[right].end) - Math.max(ranges[left].start, ranges[right].start)
      if (overlap > 0) {
        conflicts.push({ leftId: ranges[left].block.id, rightId: ranges[right].block.id, overlapMinutes: overlap / 60_000 })
      }
    }
  }
  return conflicts
}
