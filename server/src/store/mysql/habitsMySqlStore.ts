import { createHash, randomUUID } from 'node:crypto'
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import {
  HabitsDomainError,
  assertDateOnly,
  createHabitEntity,
  createHabitEntryEntity,
  normalizeHabitIdempotencyKey,
  updateHabitEntity,
  updateHabitEntryEntity,
  type CreateHabitInput,
  type Habit,
  type HabitEntry,
  type HabitSchedule,
  type HabitsStore,
  type UpdateHabitInput,
  type UpsertHabitEntryInput,
} from '../../domain/habits.js'

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
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object') return value as T
  if (typeof value !== 'string') return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
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

async function queryRows<T>(executor: Executor, sql: string, values: unknown[] = []): Promise<T[]> {
  const [rows] = await executor.execute(sql, values as never[])
  return rows as unknown as T[]
}

export class HabitsMySqlStore implements HabitsStore {
  constructor(
    private readonly pool: Pool,
    private readonly options: { createId?: () => string; now?: () => string } = {},
  ) {}

  private createId = () => this.options.createId?.() ?? randomUUID()
  private now = () => this.options.now?.() ?? new Date().toISOString()

  async listHabits(userId: string) {
    const rows = await queryRows<SqlRow>(this.pool, `SELECT * FROM habits
      WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id`, [userId])
    return Promise.all(rows.map((row) => this.hydrateHabit(this.pool, userId, row)))
  }

  async getHabit(userId: string, id: string) {
    const rows = await queryRows<SqlRow>(this.pool, `SELECT * FROM habits
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`, [id, userId])
    return rows[0] ? this.hydrateHabit(this.pool, userId, rows[0]) : undefined
  }

  async createHabit(userId: string, input: CreateHabitInput, idempotencyKey: string) {
    const result = await this.createIdempotently<Habit>(userId, 'habits:create', idempotencyKey, input, async (connection) => {
      await this.validateLinks(connection, userId, input)
      const habit = createHabitEntity(this.createId(), this.now(), input)
      await connection.execute(`INSERT INTO habits
        (id, user_id, goal_id, project_id, title, description, measure, unit, target_value,
         status, paused_at, timezone, version, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL)`, [
        habit.id, userId, habit.goalId, habit.projectId, habit.title, habit.description, habit.measure,
        habit.unit, habit.targetValue, habit.status, habit.timezone, habit.version,
        toSqlDateTime(habit.createdAt!), toSqlDateTime(habit.updatedAt!),
      ])
      await this.insertSchedule(connection, userId, habit.id, habit.schedule, habit.createdAt!)
      return habit
    })
    return result.value
  }

  async updateHabit(userId: string, id: string, input: UpdateHabitInput) {
    return this.inTransaction(async (connection) => {
      const rows = await queryRows<SqlRow>(connection, `SELECT * FROM habits
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`, [id, userId])
      if (!rows[0]) return undefined
      const current = await this.hydrateHabit(connection, userId, rows[0])
      const next = updateHabitEntity(current, this.now(), input)
      if (input.goalId !== undefined || input.projectId !== undefined) {
        await this.validateLinks(connection, userId, next)
      }
      const [result] = await connection.execute<ResultSetHeader>(`UPDATE habits SET
        goal_id = ?, project_id = ?, title = ?, description = ?, measure = ?, unit = ?, target_value = ?,
        status = ?, paused_at = ?, timezone = ?, version = ?, updated_at = ?
        WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`, [
        next.goalId, next.projectId, next.title, next.description, next.measure, next.unit, next.targetValue,
        next.status, next.pausedAt ? toSqlDateTime(next.pausedAt) : null, next.timezone, next.version,
        toSqlDateTime(next.updatedAt!), id, userId, input.version,
      ])
      if (result.affectedRows !== 1) throw new HabitsDomainError('VERSION_CONFLICT', '习惯已被更新，请刷新后重试', 409)
      if (input.schedule !== undefined) await this.updateSchedule(connection, userId, id, next.schedule, next.updatedAt!)
      return next
    })
  }

  async listHabitEntries(userId: string, from?: string, to?: string) {
    if (from) assertDateOnly(from, '开始日期')
    if (to) assertDateOnly(to, '结束日期')
    if (from && to && from > to) throw new HabitsDomainError('INVALID_INPUT', '结束日期不能早于开始日期', 400)
    const conditions = ['e.user_id = ?', 'e.deleted_at IS NULL', 'h.deleted_at IS NULL']
    const values: unknown[] = [userId]
    if (from) { conditions.push('e.entry_date >= ?'); values.push(from) }
    if (to) { conditions.push('e.entry_date <= ?'); values.push(to) }
    const rows = await queryRows<SqlRow>(this.pool, `SELECT e.* FROM habit_entries e
      INNER JOIN habits h ON h.id = e.habit_id AND h.user_id = e.user_id
      WHERE ${conditions.join(' AND ')} ORDER BY e.entry_date, e.id`, values)
    return rows.map(mapEntry)
  }

  async upsertHabitEntry(
    userId: string,
    habitId: string,
    entryDate: string,
    input: UpsertHabitEntryInput,
    idempotencyKey?: string,
  ) {
    assertDateOnly(entryDate, '记录日期')
    if (input.version !== undefined) {
      const expectedVersion = input.version
      return this.inTransaction(async (connection) => {
        const rows = await queryRows<SqlRow>(connection, `SELECT e.* FROM habit_entries e
          INNER JOIN habits h ON h.id = e.habit_id AND h.user_id = e.user_id AND h.deleted_at IS NULL
          WHERE e.user_id = ? AND e.habit_id = ? AND e.entry_date = ? AND e.deleted_at IS NULL
          LIMIT 1 FOR UPDATE`, [userId, habitId, entryDate])
        if (!rows[0]) return undefined
        const entry = updateHabitEntryEntity(mapEntry(rows[0]), this.now(), input)
        const [result] = await connection.execute<ResultSetHeader>(`UPDATE habit_entries SET
          status = ?, value = ?, note = ?, version = ?, updated_at = ?
          WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`, [
          entry.status, entry.value, entry.note, entry.version, toSqlDateTime(entry.updatedAt!),
          entry.id, userId, expectedVersion,
        ])
        if (result.affectedRows !== 1) throw new HabitsDomainError('VERSION_CONFLICT', '习惯记录已被更新，请刷新后重试', 409)
        return { entry, created: false, replayed: false }
      })
    }
    if (!idempotencyKey) throw new HabitsDomainError('INVALID_INPUT', '创建记录需要幂等键', 400)
    const result = await this.createIdempotently<HabitEntry>(
      userId,
      `habits:${habitId}:entries:${entryDate}:create`,
      idempotencyKey,
      input,
      async (connection) => {
        const habits = await queryRows<SqlRow>(connection, `SELECT id FROM habits
          WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`, [habitId, userId])
        if (!habits[0]) throw new HabitsDomainError('NOT_FOUND', '找不到习惯', 404)
        const entry = createHabitEntryEntity(this.createId(), habitId, entryDate, this.now(), input)
        try {
          await connection.execute(`INSERT INTO habit_entries
            (id, user_id, habit_id, entry_date, status, value, note, version, created_at, updated_at, deleted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`, [
            entry.id, userId, habitId, entry.entryDate, entry.status, entry.value, entry.note, entry.version,
            toSqlDateTime(entry.createdAt!), toSqlDateTime(entry.updatedAt!),
          ])
        } catch (error) {
          if (duplicateEntry(error)) throw new HabitsDomainError('VERSION_CONFLICT', '该日期已有记录，请携带版本号修正', 409)
          throw error
        }
        return entry
      },
    )
    return { entry: result.value, created: true, replayed: result.replayed }
  }

  private async hydrateHabit(executor: Executor, userId: string, row: SqlRow): Promise<Habit> {
    const schedules = await queryRows<SqlRow>(executor, `SELECT * FROM habit_schedules
      WHERE user_id = ? AND habit_id = ? AND deleted_at IS NULL LIMIT 1`, [userId, String(row.id)])
    if (!schedules[0]) throw new Error(`HABIT_SCHEDULE_MISSING:${String(row.id)}`)
    return mapHabit(row, mapSchedule(schedules[0]))
  }

  private async validateLinks(executor: Executor, userId: string, links: Pick<CreateHabitInput, 'goalId' | 'projectId'>) {
    const [goals, projects] = await Promise.all([
      links.goalId ? queryRows<SqlRow>(executor, `SELECT id FROM goals
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`, [links.goalId, userId]) : [],
      links.projectId ? queryRows<SqlRow>(executor, `SELECT id, goal_id FROM projects
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`, [links.projectId, userId]) : [],
    ])
    if (links.goalId && !goals[0]) throw new HabitsDomainError('NOT_FOUND', '找不到目标', 404)
    if (links.projectId && !projects[0]) throw new HabitsDomainError('NOT_FOUND', '找不到项目', 404)
    if (links.goalId && projects[0] && String(projects[0].goal_id) !== links.goalId) {
      throw new HabitsDomainError('INVALID_INPUT', '项目不属于所选目标', 400)
    }
  }

  private async insertSchedule(connection: PoolConnection, userId: string, habitId: string, schedule: HabitSchedule, now: string) {
    await connection.execute(`INSERT INTO habit_schedules
      (id, user_id, habit_id, schedule_type, weekdays, times_per_week, interval_days,
       starts_on, ends_on, version, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)`, [
      this.createId(), userId, habitId, schedule.scheduleType,
      schedule.weekdays ? JSON.stringify(schedule.weekdays) : null,
      schedule.timesPerWeek ?? null, schedule.intervalDays ?? null, schedule.startsOn, schedule.endsOn ?? null,
      toSqlDateTime(now), toSqlDateTime(now),
    ])
  }

  private async updateSchedule(connection: PoolConnection, userId: string, habitId: string, schedule: HabitSchedule, now: string) {
    const [result] = await connection.execute<ResultSetHeader>(`UPDATE habit_schedules SET
      schedule_type = ?, weekdays = ?, times_per_week = ?, interval_days = ?, starts_on = ?, ends_on = ?,
      version = version + 1, updated_at = ?
      WHERE user_id = ? AND habit_id = ? AND deleted_at IS NULL`, [
      schedule.scheduleType, schedule.weekdays ? JSON.stringify(schedule.weekdays) : null,
      schedule.timesPerWeek ?? null, schedule.intervalDays ?? null, schedule.startsOn, schedule.endsOn ?? null,
      toSqlDateTime(now), userId, habitId,
    ])
    if (result.affectedRows !== 1) throw new Error(`HABIT_SCHEDULE_MISSING:${habitId}`)
  }

  private async createIdempotently<T>(
    userId: string,
    scope: string,
    rawKey: string,
    input: unknown,
    create: (connection: PoolConnection) => Promise<T>,
  ): Promise<{ value: T; replayed: boolean }> {
    const key = normalizeHabitIdempotencyKey(rawKey)
    const hash = requestHash(input)
    const connection = await this.pool.getConnection()
    let transactionOpen = false
    try {
      await connection.beginTransaction()
      transactionOpen = true
      const existing = await this.idempotencyRows(connection, userId, scope, key, true)
      if (existing[0]) {
        const value = this.replay<T>(existing[0], hash)
        await connection.commit()
        transactionOpen = false
        return { value, replayed: true }
      }
      const timestamp = this.now()
      try {
        await connection.execute(`INSERT INTO idempotency_keys
          (id, user_id, scope, idempotency_key, request_hash, response_status, response_body, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`, [
          this.createId(), userId, scope, key, hash, toSqlDateTime(timestamp),
          toSqlDateTime(new Date(Date.parse(timestamp) + 24 * 60 * 60 * 1000).toISOString()),
        ])
      } catch (error) {
        if (!duplicateEntry(error)) throw error
        await connection.rollback()
        transactionOpen = false
        const raced = await this.idempotencyRows(this.pool, userId, scope, key, false)
        if (!raced[0]) throw error
        return { value: this.replay<T>(raced[0], hash), replayed: true }
      }
      const value = await create(connection)
      await connection.execute(`UPDATE idempotency_keys SET response_status = 201, response_body = ?
        WHERE user_id = ? AND scope = ? AND idempotency_key = ?`, [JSON.stringify(value), userId, scope, key])
      await connection.commit()
      transactionOpen = false
      return { value, replayed: false }
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
    if (String(row.request_hash).toUpperCase() !== hash) {
      throw new HabitsDomainError('IDEMPOTENCY_CONFLICT', '幂等键已用于不同请求', 409)
    }
    if (row.response_body == null) throw new HabitsDomainError('IDEMPOTENCY_CONFLICT', '幂等请求仍在处理中', 409)
    return parseJson<T>(row.response_body, undefined as T)
  }

  private async inTransaction<T>(operation: (connection: PoolConnection) => Promise<T>) {
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const value = await operation(connection)
      await connection.commit()
      return value
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }
}

function mapHabit(row: SqlRow, schedule: HabitSchedule): Habit {
  return {
    id: String(row.id),
    goalId: row.goal_id == null ? null : String(row.goal_id),
    projectId: row.project_id == null ? null : String(row.project_id),
    title: String(row.title),
    description: String(row.description),
    measure: row.measure as Habit['measure'],
    unit: row.unit == null ? null : String(row.unit),
    targetValue: row.target_value == null ? null : Number(row.target_value),
    status: row.status as Habit['status'],
    pausedAt: optionalIso(row.paused_at),
    timezone: String(row.timezone),
    schedule,
    version: Number(row.version),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    deletedAt: optionalIso(row.deleted_at),
  }
}

function mapSchedule(row: SqlRow): HabitSchedule {
  const schedule: HabitSchedule = {
    scheduleType: row.schedule_type as HabitSchedule['scheduleType'],
    startsOn: dateOnly(row.starts_on),
    endsOn: row.ends_on == null ? null : dateOnly(row.ends_on),
  }
  const weekdays = parseJson<number[]>(row.weekdays, [])
  if (weekdays.length) schedule.weekdays = weekdays.map(Number)
  if (row.times_per_week != null) schedule.timesPerWeek = Number(row.times_per_week)
  if (row.interval_days != null) schedule.intervalDays = Number(row.interval_days)
  return schedule
}

function mapEntry(row: SqlRow): HabitEntry {
  return {
    id: String(row.id),
    habitId: String(row.habit_id),
    entryDate: dateOnly(row.entry_date),
    status: row.status as HabitEntry['status'],
    value: row.value == null ? null : Number(row.value),
    note: String(row.note),
    version: Number(row.version),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    deletedAt: optionalIso(row.deleted_at),
  }
}
