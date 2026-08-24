import { createHash, randomUUID } from 'node:crypto'
import {
  TasksDomainError,
  assertTaskVersion,
  createChecklistItemEntity,
  createScheduleBlockEntity,
  createTaskEntity,
  normalizeTaskIdempotencyKey,
  updateChecklistItemEntity,
  updateScheduleBlockEntity,
  updateTaskEntity,
  type ChecklistItem,
  type CreateTaskInput,
  type ScheduleBlock,
  type Task,
  type TasksStore,
  type UpdateTaskInput,
} from '../../domain/tasks.js'

interface Owned<T> {
  userId: string
  value: T
  deletedAt: string | null
}

interface IdempotentResult {
  requestHash: string
  value: Promise<Task | ChecklistItem | ScheduleBlock>
}

type LinkValidator = (userId: string, links: Pick<CreateTaskInput, 'goalId' | 'projectId' | 'milestoneId'>) => Promise<void>

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function requestHash(value: unknown) {
  return createHash('sha256').update(stableJson(value)).digest('hex').toUpperCase()
}

function copy<T>(value: T): T {
  return structuredClone(value)
}

export class TasksMemoryStore implements TasksStore {
  private readonly createId: () => string
  private readonly now: () => string
  private readonly tasks: Array<Owned<Task>> = []
  private readonly checklist: Array<Owned<ChecklistItem>> = []
  private readonly blocks: Array<Owned<ScheduleBlock>> = []
  private readonly idempotency = new Map<string, IdempotentResult>()

  constructor(options: { createId?: () => string; now?: () => string; validateLinks?: LinkValidator } = {}) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date().toISOString())
    this.validateLinks = options.validateLinks
  }

  private readonly validateLinks?: LinkValidator

  captureOwnerTransactionState(userId: string) {
    return {
      tasks: copy(this.tasks.filter((entry) => entry.userId === userId)),
      checklist: copy(this.checklist.filter((entry) => entry.userId === userId)),
      blocks: copy(this.blocks.filter((entry) => entry.userId === userId)),
      idempotency: [...this.idempotency.entries()].filter(([key]) => key.startsWith(`${userId}\0`)),
    }
  }

  restoreOwnerTransactionState(userId: string, state: ReturnType<TasksMemoryStore['captureOwnerTransactionState']>) {
    this.replaceOwnerRows(this.tasks, userId, state.tasks)
    this.replaceOwnerRows(this.checklist, userId, state.checklist)
    this.replaceOwnerRows(this.blocks, userId, state.blocks)
    for (const key of [...this.idempotency.keys()]) if (key.startsWith(`${userId}\0`)) this.idempotency.delete(key)
    for (const [key, value] of state.idempotency) this.idempotency.set(key, value)
  }

  replaceOwnerPortableData(userId: string, tasks: Task[], blocks: ScheduleBlock[]) {
    this.replaceOwnerRows(this.tasks, userId, tasks.map((task) => ({
      userId,
      value: copy({ ...task, checklist: [] }),
      deletedAt: task.deletedAt,
    })))
    this.replaceOwnerRows(this.checklist, userId, tasks.flatMap((task) => task.checklist.map((value) => ({ userId, value: copy(value), deletedAt: null }))))
    this.replaceOwnerRows(this.blocks, userId, blocks.map((value) => ({ userId, value: copy(value), deletedAt: null })))
    for (const key of [...this.idempotency.keys()]) if (key.startsWith(`${userId}\0`)) this.idempotency.delete(key)
  }

  private replaceOwnerRows<T extends { userId: string }>(target: T[], userId: string, rows: T[]) {
    target.splice(0, target.length, ...target.filter((entry) => entry.userId !== userId), ...copy(rows))
  }

  async listTasks(userId: string) {
    return this.tasks
      .filter((item) => item.userId === userId && item.deletedAt === null)
      .sort((left, right) => right.value.updatedAt.localeCompare(left.value.updatedAt) || left.value.id.localeCompare(right.value.id))
      .map((item) => this.hydrateTask(userId, item.value))
  }

  async getTask(userId: string, id: string) {
    const item = this.taskRecord(userId, id)
    return item ? this.hydrateTask(userId, item.value) : undefined
  }

  async createTask(userId: string, input: CreateTaskInput, idempotencyKey: string) {
    return this.createIdempotently<Task>(userId, 'tasks:create', idempotencyKey, input, async () => {
      await this.validateLinks?.(userId, input)
      const value = createTaskEntity(this.createId(), this.now(), input)
      this.tasks.push({ userId, value, deletedAt: null })
      return value
    })
  }

  async updateTask(userId: string, id: string, input: UpdateTaskInput) {
    const item = this.taskRecord(userId, id)
    if (!item) return undefined
    await this.validateLinks?.(userId, input)
    item.value = updateTaskEntity(this.hydrateTask(userId, item.value), this.now(), input)
    return this.hydrateTask(userId, item.value)
  }

  async deleteTask(userId: string, id: string, version: number) {
    const item = this.taskRecord(userId, id)
    if (!item) return false
    assertTaskVersion(item.value.version, version)
    const timestamp = this.now()
    item.value = { ...item.value, version: item.value.version + 1, updatedAt: timestamp, deletedAt: timestamp }
    item.deletedAt = timestamp
    return true
  }

  async setTaskCompletion(userId: string, id: string, version: number, completed: boolean) {
    const item = this.taskRecord(userId, id)
    if (!item) return undefined
    item.value = updateTaskEntity(this.hydrateTask(userId, item.value), this.now(), { status: completed ? 'done' : 'planned', version })
    return this.hydrateTask(userId, item.value)
  }

  async addChecklistItem(userId: string, taskId: string, input: { title: string; position?: number }, idempotencyKey: string) {
    return this.createIdempotently<ChecklistItem>(userId, `tasks:${taskId}:checklist:create`, idempotencyKey, input, async () => {
      if (!this.taskRecord(userId, taskId)) throw new TasksDomainError('NOT_FOUND', '找不到任务', 404)
      const value = createChecklistItemEntity(this.createId(), taskId, this.now(), input)
      this.checklist.push({ userId, value, deletedAt: null })
      return value
    })
  }

  async updateChecklistItem(userId: string, taskId: string, id: string, input: { title?: string; isCompleted?: boolean; position?: number; version: number }) {
    const item = this.checklistRecord(userId, taskId, id)
    if (!item) return undefined
    item.value = updateChecklistItemEntity(item.value, this.now(), input)
    return copy(item.value)
  }

  async deleteChecklistItem(userId: string, taskId: string, id: string, version: number) {
    const item = this.checklistRecord(userId, taskId, id)
    if (!item) return false
    assertTaskVersion(item.value.version, version)
    item.value = { ...item.value, version: item.value.version + 1 }
    item.deletedAt = this.now()
    return true
  }

  async listScheduleBlocks(userId: string, from?: string, to?: string) {
    const fromTime = from ? Date.parse(from) : Number.NEGATIVE_INFINITY
    const toTime = to ? Date.parse(to) : Number.POSITIVE_INFINITY
    if (Number.isNaN(fromTime) || Number.isNaN(toTime) || toTime <= fromTime) throw new TasksDomainError('INVALID_INPUT', '日程查询时间范围无效', 400)
    return this.blocks
      .filter((item) => item.userId === userId && item.deletedAt === null && this.taskRecord(userId, item.value.taskId))
      .filter((item) => Date.parse(item.value.startsAt) < toTime && Date.parse(item.value.endsAt) > fromTime)
      .sort((left, right) => left.value.startsAt.localeCompare(right.value.startsAt) || left.value.id.localeCompare(right.value.id))
      .map((item) => copy(item.value))
  }

  async createScheduleBlock(userId: string, input: { taskId: string; startsAt: string; endsAt: string }, idempotencyKey: string) {
    return this.createIdempotently<ScheduleBlock>(userId, 'schedule-blocks:create', idempotencyKey, input, async () => {
      if (!this.taskRecord(userId, input.taskId)) throw new TasksDomainError('NOT_FOUND', '找不到任务', 404)
      const value = createScheduleBlockEntity(this.createId(), input)
      this.blocks.push({ userId, value, deletedAt: null })
      return value
    })
  }

  async updateScheduleBlock(userId: string, id: string, input: { startsAt?: string; endsAt?: string; version: number }) {
    const item = this.blockRecord(userId, id)
    if (!item) return undefined
    item.value = updateScheduleBlockEntity(item.value, input)
    return copy(item.value)
  }

  async deleteScheduleBlock(userId: string, id: string, version: number) {
    const item = this.blockRecord(userId, id)
    if (!item) return false
    assertTaskVersion(item.value.version, version)
    item.value = { ...item.value, version: item.value.version + 1 }
    item.deletedAt = this.now()
    return true
  }

  private taskRecord(userId: string, id: string) {
    return this.tasks.find((item) => item.userId === userId && item.value.id === id && item.deletedAt === null)
  }

  private checklistRecord(userId: string, taskId: string, id: string) {
    if (!this.taskRecord(userId, taskId)) return undefined
    return this.checklist.find((item) => item.userId === userId && item.value.taskId === taskId && item.value.id === id && item.deletedAt === null)
  }

  private blockRecord(userId: string, id: string) {
    return this.blocks.find((item) => item.userId === userId && item.value.id === id && item.deletedAt === null && this.taskRecord(userId, item.value.taskId))
  }

  private hydrateTask(userId: string, task: Task): Task {
    const checklist = this.checklist
      .filter((item) => item.userId === userId && item.value.taskId === task.id && item.deletedAt === null)
      .sort((left, right) => left.value.position - right.value.position || left.value.id.localeCompare(right.value.id))
      .map((item) => copy(item.value))
    return copy({ ...task, checklist })
  }

  private async createIdempotently<T extends Task | ChecklistItem | ScheduleBlock>(
    userId: string,
    scope: string,
    key: string,
    input: unknown,
    create: () => Promise<T>,
  ): Promise<T> {
    const normalizedKey = normalizeTaskIdempotencyKey(key)
    const mapKey = `${userId}\u0000${scope}\u0000${normalizedKey}`
    const hash = requestHash(input)
    const existing = this.idempotency.get(mapKey)
    if (existing) {
      if (existing.requestHash !== hash) throw new TasksDomainError('IDEMPOTENCY_CONFLICT', '同一个幂等键不能用于不同请求', 409)
      return copy(await existing.value) as T
    }
    const pending = (async () => copy(await create()))()
    this.idempotency.set(mapKey, { requestHash: hash, value: pending })
    try {
      return copy(await pending)
    } catch (error) {
      if (this.idempotency.get(mapKey)?.value === pending) this.idempotency.delete(mapKey)
      throw error
    }
  }
}
