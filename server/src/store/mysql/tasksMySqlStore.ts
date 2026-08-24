import { createHash, randomUUID } from 'node:crypto'
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
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
  type RecurrenceRule,
  type ScheduleBlock,
  type Task,
  type TasksStore,
  type UpdateTaskInput,
} from '../../domain/tasks.js'

type Executor = Pool | PoolConnection
type SqlRow = RowDataPacket & Record<string, unknown>

function toSqlDateTime(value: string) {
  return new Date(value).toISOString().slice(0, 23).replace('T', ' ')
}

function iso(value: unknown) {
  if (value instanceof Date) return value.toISOString()
  const result = String(value)
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(result) ? `${result.replace(' ', 'T')}Z` : result
}

function optionalIso(value: unknown) {
  return value == null ? null : iso(value)
}

function dateOnly(value: unknown) {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object') return value as T
  if (typeof value !== 'string') return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

async function queryRows<T>(executor: Executor, sql: string, values: unknown[] = []): Promise<T[]> {
  const [rows] = await executor.execute(sql, values as never[])
  return rows as unknown as T[]
}

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

function duplicateEntry(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ER_DUP_ENTRY')
}

export class TasksMySqlStore implements TasksStore {
  constructor(
    private readonly pool: Pool,
    private readonly options: { createId?: () => string; now?: () => string } = {},
  ) {}

  private createId = () => this.options.createId?.() ?? randomUUID()
  private now = () => this.options.now?.() ?? new Date().toISOString()

  async listTasks(userId: string) {
    const rows = await queryRows<SqlRow>(this.pool, 'SELECT * FROM tasks WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id', [userId])
    return Promise.all(rows.map((row) => this.hydrateTask(this.pool, userId, row)))
  }

  async getTask(userId: string, id: string) {
    const rows = await queryRows<SqlRow>(this.pool, 'SELECT * FROM tasks WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1', [id, userId])
    return rows[0] ? this.hydrateTask(this.pool, userId, rows[0]) : undefined
  }

  async createTask(userId: string, input: CreateTaskInput, idempotencyKey: string) {
    return this.createIdempotently<Task>(userId, 'tasks:create', idempotencyKey, input, async (connection) => {
      await this.validateLinks(connection, userId, input)
      const task = createTaskEntity(this.createId(), this.now(), input)
      await connection.execute(`INSERT INTO tasks
        (id, user_id, goal_id, project_id, milestone_id, legacy_plan_id, legacy_scheduled_for, title, description,
         starts_at, ends_at, due_at, estimate_minutes, priority, tags, status, completed_at, version, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`, [
        task.id, userId, task.goalId, task.projectId, task.milestoneId, task.title, task.description,
        task.startsAt ? toSqlDateTime(task.startsAt) : null, task.endsAt ? toSqlDateTime(task.endsAt) : null,
        task.dueAt ? toSqlDateTime(task.dueAt) : null, task.estimateMinutes, task.priority, JSON.stringify(task.tags), task.status,
        task.completedAt ? toSqlDateTime(task.completedAt) : null, task.version, toSqlDateTime(task.createdAt), toSqlDateTime(task.updatedAt),
      ])
      if (task.recurrence) await this.syncRecurrence(connection, userId, task.id, task.recurrence)
      return task
    })
  }

  async updateTask(userId: string, id: string, input: UpdateTaskInput) {
    return this.inTransaction(async (connection) => {
      const rows = await queryRows<SqlRow>(connection, 'SELECT * FROM tasks WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE', [id, userId])
      if (!rows[0]) return undefined
      const current = await this.hydrateTask(connection, userId, rows[0])
      const next = updateTaskEntity(current, this.now(), input)
      if (input.goalId !== undefined || input.projectId !== undefined || input.milestoneId !== undefined) {
        await this.validateLinks(connection, userId, next)
      }
      await this.writeTaskUpdate(connection, userId, id, input.version, next)
      if (input.recurrence !== undefined) await this.syncRecurrence(connection, userId, id, next.recurrence)
      return next
    })
  }

  async deleteTask(userId: string, id: string, version: number) {
    return this.inTransaction(async (connection) => {
      const rows = await queryRows<SqlRow>(connection, 'SELECT version FROM tasks WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE', [id, userId])
      if (!rows[0]) return false
      assertTaskVersion(Number(rows[0].version), version)
      const timestamp = toSqlDateTime(this.now())
      const [result] = await connection.execute<ResultSetHeader>(`UPDATE tasks SET deleted_at = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`, [timestamp, timestamp, id, userId, version])
      return result.affectedRows === 1
    })
  }

  async setTaskCompletion(userId: string, id: string, version: number, completed: boolean) {
    return this.inTransaction(async (connection) => {
      const rows = await queryRows<SqlRow>(connection, 'SELECT * FROM tasks WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE', [id, userId])
      if (!rows[0]) return undefined
      const current = await this.hydrateTask(connection, userId, rows[0])
      const next = updateTaskEntity(current, this.now(), { status: completed ? 'done' : 'planned', version })
      await this.writeTaskUpdate(connection, userId, id, version, next)
      return next
    })
  }

  async addChecklistItem(userId: string, taskId: string, input: { title: string; position?: number }, idempotencyKey: string) {
    return this.createIdempotently<ChecklistItem>(userId, `tasks:${taskId}:checklist:create`, idempotencyKey, input, async (connection) => {
      const tasks = await queryRows<SqlRow>(connection, 'SELECT id FROM tasks WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE', [taskId, userId])
      if (!tasks[0]) throw new TasksDomainError('NOT_FOUND', '找不到任务', 404)
      const now = this.now()
      const item = createChecklistItemEntity(this.createId(), taskId, now, input)
      await connection.execute(`INSERT INTO task_checklist_items
        (id, user_id, task_id, title, is_completed, completed_at, position, version, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL)`, [
        item.id, userId, taskId, item.title, item.isCompleted, item.position, item.version, toSqlDateTime(now), toSqlDateTime(now),
      ])
      return item
    })
  }

  async updateChecklistItem(userId: string, taskId: string, id: string, input: { title?: string; isCompleted?: boolean; position?: number; version: number }) {
    return this.inTransaction(async (connection) => {
      const rows = await queryRows<SqlRow>(connection, `SELECT c.* FROM task_checklist_items c
        INNER JOIN tasks t ON t.id = c.task_id AND t.user_id = c.user_id AND t.deleted_at IS NULL
        WHERE c.id = ? AND c.task_id = ? AND c.user_id = ? AND c.deleted_at IS NULL LIMIT 1 FOR UPDATE`, [id, taskId, userId])
      if (!rows[0]) return undefined
      const next = updateChecklistItemEntity(mapChecklist(rows[0]), this.now(), input)
      await connection.execute(`UPDATE task_checklist_items SET title = ?, is_completed = ?, completed_at = ?, position = ?, version = ?, updated_at = ?
        WHERE id = ? AND task_id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`, [
        next.title, next.isCompleted, next.completedAt ? toSqlDateTime(next.completedAt) : null, next.position, next.version,
        toSqlDateTime(this.now()), id, taskId, userId, input.version,
      ])
      return next
    })
  }

  async deleteChecklistItem(userId: string, taskId: string, id: string, version: number) {
    return this.inTransaction(async (connection) => {
      const rows = await queryRows<SqlRow>(connection, `SELECT c.version FROM task_checklist_items c
        INNER JOIN tasks t ON t.id = c.task_id AND t.user_id = c.user_id AND t.deleted_at IS NULL
        WHERE c.id = ? AND c.task_id = ? AND c.user_id = ? AND c.deleted_at IS NULL LIMIT 1 FOR UPDATE`, [id, taskId, userId])
      if (!rows[0]) return false
      assertTaskVersion(Number(rows[0].version), version)
      const timestamp = toSqlDateTime(this.now())
      const [result] = await connection.execute<ResultSetHeader>(`UPDATE task_checklist_items SET deleted_at = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND task_id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`, [timestamp, timestamp, id, taskId, userId, version])
      return result.affectedRows === 1
    })
  }

  async listScheduleBlocks(userId: string, from?: string, to?: string) {
    const fromTime = from ? Date.parse(from) : Number.NEGATIVE_INFINITY
    const toTime = to ? Date.parse(to) : Number.POSITIVE_INFINITY
    if (Number.isNaN(fromTime) || Number.isNaN(toTime) || toTime <= fromTime) throw new TasksDomainError('INVALID_INPUT', '日程查询时间范围无效', 400)
    const conditions = ['b.user_id = ?', 'b.deleted_at IS NULL', 't.deleted_at IS NULL']
    const values: unknown[] = [userId]
    if (to) { conditions.push('b.starts_at < ?'); values.push(toSqlDateTime(to)) }
    if (from) { conditions.push('b.ends_at > ?'); values.push(toSqlDateTime(from)) }
    const rows = await queryRows<SqlRow>(this.pool, `SELECT b.* FROM schedule_blocks b
      INNER JOIN tasks t ON t.id = b.task_id AND t.user_id = b.user_id
      WHERE ${conditions.join(' AND ')} ORDER BY b.starts_at, b.id`, values)
    return rows.map(mapScheduleBlock)
  }

  async createScheduleBlock(userId: string, input: { taskId: string; startsAt: string; endsAt: string }, idempotencyKey: string) {
    return this.createIdempotently<ScheduleBlock>(userId, 'schedule-blocks:create', idempotencyKey, input, async (connection) => {
      const tasks = await queryRows<SqlRow>(connection, 'SELECT id FROM tasks WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE', [input.taskId, userId])
      if (!tasks[0]) throw new TasksDomainError('NOT_FOUND', '找不到任务', 404)
      const block = createScheduleBlockEntity(this.createId(), input)
      const now = toSqlDateTime(this.now())
      await connection.execute(`INSERT INTO schedule_blocks
        (id, user_id, task_id, starts_at, ends_at, version, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`, [
        block.id, userId, block.taskId, toSqlDateTime(block.startsAt), toSqlDateTime(block.endsAt), block.version, now, now,
      ])
      return block
    })
  }

  async updateScheduleBlock(userId: string, id: string, input: { startsAt?: string; endsAt?: string; version: number }) {
    return this.inTransaction(async (connection) => {
      const rows = await queryRows<SqlRow>(connection, `SELECT b.* FROM schedule_blocks b
        INNER JOIN tasks t ON t.id = b.task_id AND t.user_id = b.user_id AND t.deleted_at IS NULL
        WHERE b.id = ? AND b.user_id = ? AND b.deleted_at IS NULL LIMIT 1 FOR UPDATE`, [id, userId])
      if (!rows[0]) return undefined
      const next = updateScheduleBlockEntity(mapScheduleBlock(rows[0]), input)
      await connection.execute(`UPDATE schedule_blocks SET starts_at = ?, ends_at = ?, version = ?, updated_at = ?
        WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`, [
        toSqlDateTime(next.startsAt), toSqlDateTime(next.endsAt), next.version, toSqlDateTime(this.now()), id, userId, input.version,
      ])
      return next
    })
  }

  async deleteScheduleBlock(userId: string, id: string, version: number) {
    return this.inTransaction(async (connection) => {
      const rows = await queryRows<SqlRow>(connection, `SELECT b.version FROM schedule_blocks b
        INNER JOIN tasks t ON t.id = b.task_id AND t.user_id = b.user_id AND t.deleted_at IS NULL
        WHERE b.id = ? AND b.user_id = ? AND b.deleted_at IS NULL LIMIT 1 FOR UPDATE`, [id, userId])
      if (!rows[0]) return false
      assertTaskVersion(Number(rows[0].version), version)
      const timestamp = toSqlDateTime(this.now())
      const [result] = await connection.execute<ResultSetHeader>(`UPDATE schedule_blocks SET deleted_at = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`, [timestamp, timestamp, id, userId, version])
      return result.affectedRows === 1
    })
  }

  private async hydrateTask(executor: Executor, userId: string, row: SqlRow): Promise<Task> {
    const [checklistRows, recurrenceRows] = await Promise.all([
      queryRows<SqlRow>(executor, `SELECT * FROM task_checklist_items
        WHERE user_id = ? AND task_id = ? AND deleted_at IS NULL ORDER BY position, id`, [userId, String(row.id)]),
      queryRows<SqlRow>(executor, `SELECT * FROM task_recurrence_rules
        WHERE user_id = ? AND task_id = ? AND deleted_at IS NULL LIMIT 1`, [userId, String(row.id)]),
    ])
    return { ...mapTask(row), checklist: checklistRows.map(mapChecklist), recurrence: recurrenceRows[0] ? mapRecurrence(recurrenceRows[0]) : null }
  }

  private async validateLinks(executor: Executor, userId: string, links: Pick<CreateTaskInput, 'goalId' | 'projectId' | 'milestoneId'>) {
    const [goals, projects, milestones] = await Promise.all([
      links.goalId ? queryRows<SqlRow>(executor, 'SELECT id FROM goals WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1', [links.goalId, userId]) : [],
      links.projectId ? queryRows<SqlRow>(executor, 'SELECT id, goal_id FROM projects WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1', [links.projectId, userId]) : [],
      links.milestoneId ? queryRows<SqlRow>(executor, 'SELECT id, project_id FROM milestones WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1', [links.milestoneId, userId]) : [],
    ])
    if (links.goalId && !goals[0]) throw new TasksDomainError('NOT_FOUND', '找不到目标', 404)
    if (links.projectId && !projects[0]) throw new TasksDomainError('NOT_FOUND', '找不到项目', 404)
    if (links.milestoneId && !milestones[0]) throw new TasksDomainError('NOT_FOUND', '找不到里程碑', 404)
    if (links.goalId && projects[0] && String(projects[0].goal_id) !== links.goalId) throw new TasksDomainError('INVALID_INPUT', '项目不属于所选目标', 400)
    if (links.projectId && milestones[0] && String(milestones[0].project_id) !== links.projectId) throw new TasksDomainError('INVALID_INPUT', '里程碑不属于所选项目', 400)
  }

  private async writeTaskUpdate(connection: PoolConnection, userId: string, id: string, expectedVersion: number, next: Task) {
    await connection.execute(`UPDATE tasks SET goal_id = ?, project_id = ?, milestone_id = ?, title = ?, description = ?, starts_at = ?, ends_at = ?, due_at = ?,
      estimate_minutes = ?, priority = ?, tags = ?, status = ?, completed_at = ?, version = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`, [
      next.goalId, next.projectId, next.milestoneId, next.title, next.description,
      next.startsAt ? toSqlDateTime(next.startsAt) : null, next.endsAt ? toSqlDateTime(next.endsAt) : null,
      next.dueAt ? toSqlDateTime(next.dueAt) : null, next.estimateMinutes, next.priority, JSON.stringify(next.tags), next.status,
      next.completedAt ? toSqlDateTime(next.completedAt) : null, next.version, toSqlDateTime(next.updatedAt), id, userId, expectedVersion,
    ])
  }

  private async syncRecurrence(connection: PoolConnection, userId: string, taskId: string, rule: RecurrenceRule | null) {
    const now = toSqlDateTime(this.now())
    if (!rule) {
      await connection.execute(`UPDATE task_recurrence_rules SET deleted_at = ?, updated_at = ?, version = version + 1
        WHERE user_id = ? AND task_id = ? AND deleted_at IS NULL`, [now, now, userId, taskId])
      return
    }
    await connection.execute(`INSERT INTO task_recurrence_rules
      (id, user_id, task_id, frequency, interval_value, weekdays, month_day, until_on, timezone, version, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Asia/Shanghai', 1, ?, ?, NULL) AS incoming
      ON DUPLICATE KEY UPDATE frequency = incoming.frequency, interval_value = incoming.interval_value,
        weekdays = incoming.weekdays, month_day = incoming.month_day, until_on = incoming.until_on,
        version = task_recurrence_rules.version + 1, updated_at = incoming.updated_at, deleted_at = NULL`, [
      this.createId(), userId, taskId, rule.frequency, rule.interval, rule.weekdays ? JSON.stringify(rule.weekdays) : null,
      rule.monthDay ?? null, rule.until ?? null, now, now,
    ])
  }

  private async createIdempotently<T>(
    userId: string,
    scope: string,
    key: string,
    input: unknown,
    create: (connection: PoolConnection) => Promise<T>,
  ): Promise<T> {
    const normalizedKey = normalizeTaskIdempotencyKey(key)
    const hash = requestHash(input)
    const connection = await this.pool.getConnection()
    let transactionOpen = false
    try {
      await connection.beginTransaction()
      transactionOpen = true
      const existing = await this.idempotencyRows(connection, userId, scope, normalizedKey, true)
      if (existing[0]) {
        const result = this.replay<T>(existing[0], hash)
        await connection.commit()
        transactionOpen = false
        return result
      }
      const timestamp = this.now()
      try {
        await connection.execute(`INSERT INTO idempotency_keys
          (id, user_id, scope, idempotency_key, request_hash, response_status, response_body, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`, [
          this.createId(), userId, scope, normalizedKey, hash, toSqlDateTime(timestamp),
          toSqlDateTime(new Date(Date.parse(timestamp) + 24 * 60 * 60 * 1000).toISOString()),
        ])
      } catch (error) {
        if (!duplicateEntry(error)) throw error
        await connection.rollback()
        transactionOpen = false
        const raced = await this.idempotencyRows(this.pool, userId, scope, normalizedKey, false)
        if (!raced[0]) throw error
        return this.replay<T>(raced[0], hash)
      }
      const value = await create(connection)
      await connection.execute(`UPDATE idempotency_keys SET response_status = 201, response_body = ?
        WHERE user_id = ? AND scope = ? AND idempotency_key = ?`, [JSON.stringify(value), userId, scope, normalizedKey])
      await connection.commit()
      transactionOpen = false
      return value
    } catch (error) {
      if (transactionOpen) await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  private async idempotencyRows(executor: Executor, userId: string, scope: string, key: string, lock: boolean) {
    return queryRows<SqlRow>(executor, `SELECT request_hash, response_body FROM idempotency_keys
      WHERE user_id = ? AND scope = ? AND idempotency_key = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`, [userId, scope, key])
  }

  private replay<T>(row: SqlRow, hash: string): T {
    if (String(row.request_hash) !== hash) throw new TasksDomainError('IDEMPOTENCY_CONFLICT', '同一个幂等键不能用于不同请求', 409)
    const value = parseJson<T | undefined>(row.response_body, undefined)
    if (value === undefined) throw new Error('幂等请求结果不完整')
    return value
  }

  private async inTransaction<T>(work: (connection: PoolConnection) => Promise<T>) {
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const result = await work(connection)
      await connection.commit()
      return result
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }
}

function mapTask(row: SqlRow): Task {
  return {
    id: String(row.id),
    goalId: row.goal_id == null ? null : String(row.goal_id),
    projectId: row.project_id == null ? null : String(row.project_id),
    milestoneId: row.milestone_id == null ? null : String(row.milestone_id),
    title: String(row.title),
    description: String(row.description),
    startsAt: optionalIso(row.starts_at),
    endsAt: optionalIso(row.ends_at),
    dueAt: optionalIso(row.due_at),
    estimateMinutes: row.estimate_minutes == null ? null : Number(row.estimate_minutes),
    priority: Number(row.priority) as Task['priority'],
    tags: parseJson<string[]>(row.tags, []),
    status: row.status as Task['status'],
    checklist: [],
    recurrence: null,
    version: Number(row.version),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    completedAt: optionalIso(row.completed_at),
    deletedAt: optionalIso(row.deleted_at),
  }
}

function mapChecklist(row: SqlRow): ChecklistItem {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    title: String(row.title),
    isCompleted: Boolean(row.is_completed),
    completedAt: optionalIso(row.completed_at),
    position: Number(row.position),
    version: Number(row.version),
  }
}

function mapRecurrence(row: SqlRow): RecurrenceRule {
  return {
    frequency: row.frequency as RecurrenceRule['frequency'],
    interval: Number(row.interval_value),
    ...(row.weekdays == null ? {} : { weekdays: parseJson<number[]>(row.weekdays, []) }),
    ...(row.month_day == null ? {} : { monthDay: Number(row.month_day) }),
    ...(row.until_on == null ? {} : { until: dateOnly(row.until_on) }),
  }
}

function mapScheduleBlock(row: SqlRow): ScheduleBlock {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    version: Number(row.version),
  }
}
