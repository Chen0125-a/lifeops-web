import { createHash, randomUUID } from 'node:crypto'
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import {
  GoalsDomainError,
  assertExpectedVersion,
  createGoalEntity,
  createMilestoneEntity,
  createProjectEntity,
  normalizeIdempotencyKey,
  updateGoalEntity,
  updateMilestoneEntity,
  updateProjectEntity,
  type CreateGoalInput,
  type CreateMilestoneInput,
  type CreateProjectInput,
  type Goal,
  type GoalRecoveryAuditEvent,
  type GoalRecoveryEntityType,
  type GoalsStore,
  type Milestone,
  type Project,
  type UpdateGoalInput,
  type UpdateMilestoneInput,
  type UpdateProjectInput,
} from '../../domain/goals.js'

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

function parseJson<T>(value: unknown): T | undefined {
  if (value && typeof value === 'object') return value as T
  if (typeof value !== 'string') return undefined
  try { return JSON.parse(value) as T } catch { return undefined }
}

export class GoalsMySqlStore implements GoalsStore {
  constructor(
    private readonly pool: Pool,
    private readonly options: { createId?: () => string; now?: () => string } = {},
  ) {}

  private createId = () => this.options.createId?.() ?? randomUUID()
  private now = () => this.options.now?.() ?? new Date().toISOString()

  async listGoals(userId: string) {
    const rows = await queryRows<SqlRow>(this.pool, 'SELECT * FROM goals WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id', [userId])
    return rows.map(mapGoal)
  }

  async getGoal(userId: string, id: string) {
    const rows = await queryRows<SqlRow>(this.pool, 'SELECT * FROM goals WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1', [id, userId])
    return rows[0] ? mapGoal(rows[0]) : undefined
  }

  async createGoal(userId: string, input: CreateGoalInput, idempotencyKey: string) {
    return this.createIdempotently<Goal>(userId, 'goals:create', idempotencyKey, input, async (connection) => {
      const goal = createGoalEntity(this.createId(), this.now(), input)
      await connection.execute(`INSERT INTO goals
        (id, user_id, title, description, status, priority, starts_on, target_on, progress_mode, manual_progress, version, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`, [
        goal.id, userId, goal.title, goal.description, goal.status, goal.priority, goal.startsOn, goal.targetOn,
        goal.progressMode, goal.manualProgress, goal.version, toSqlDateTime(goal.createdAt), toSqlDateTime(goal.updatedAt),
      ])
      return goal
    })
  }

  async updateGoal(userId: string, id: string, input: UpdateGoalInput) {
    return this.inTransaction(async (connection) => {
      const rows = await queryRows<SqlRow>(connection, 'SELECT * FROM goals WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE', [id, userId])
      if (!rows[0]) return undefined
      const next = updateGoalEntity(mapGoal(rows[0]), this.now(), input)
      await connection.execute(`UPDATE goals SET title = ?, description = ?, status = ?, priority = ?, starts_on = ?, target_on = ?,
        progress_mode = ?, manual_progress = ?, version = ?, updated_at = ? WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`, [
        next.title, next.description, next.status, next.priority, next.startsOn, next.targetOn, next.progressMode,
        next.manualProgress, next.version, toSqlDateTime(next.updatedAt), id, userId, input.version,
      ])
      return next
    })
  }

  async deleteGoal(userId: string, id: string, version: number) {
    return this.softDelete('goals', 'goal', userId, id, version)
  }

  async restoreGoal(userId: string, id: string, version: number) {
    return this.restore('goals', 'goal', userId, id, version, mapGoal)
  }

  async listProjects(userId: string, goalId: string) {
    const rows = await queryRows<SqlRow>(this.pool, `SELECT p.* FROM projects p
      INNER JOIN goals g ON g.id = p.goal_id AND g.user_id = p.user_id AND g.deleted_at IS NULL
      WHERE p.user_id = ? AND p.goal_id = ? AND p.deleted_at IS NULL ORDER BY p.created_at, p.id`, [userId, goalId])
    return rows.map(mapProject)
  }

  async getProject(userId: string, id: string) {
    const rows = await queryRows<SqlRow>(this.pool, 'SELECT * FROM projects WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1', [id, userId])
    return rows[0] ? mapProject(rows[0]) : undefined
  }

  async createProject(userId: string, goalId: string, input: CreateProjectInput, idempotencyKey: string) {
    return this.createIdempotently<Project>(userId, `goals:${goalId}:projects:create`, idempotencyKey, input, async (connection) => {
      const goals = await queryRows<SqlRow>(connection, 'SELECT status FROM goals WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE', [goalId, userId])
      if (!goals[0]) throw new GoalsDomainError('NOT_FOUND', '找不到目标', 404)
      if (goals[0].status === 'completed' && (input.status ?? 'active') === 'active') {
        throw new GoalsDomainError('GOAL_COMPLETED', '完成的目标需要先重新打开，才能新增活动项目', 409)
      }
      const project = createProjectEntity(this.createId(), goalId, this.now(), input)
      await connection.execute(`INSERT INTO projects
        (id, user_id, goal_id, title, description, risk_note, status, starts_on, target_on, progress, next_task_id, version, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`, [
        project.id, userId, project.goalId, project.title, project.description, project.riskNote, project.status, project.startsOn,
        project.targetOn, project.progress, project.nextTaskId, project.version, toSqlDateTime(project.createdAt), toSqlDateTime(project.updatedAt),
      ])
      return project
    })
  }

  async updateProject(userId: string, id: string, input: UpdateProjectInput) {
    return this.inTransaction(async (connection) => {
      const rows = await queryRows<SqlRow>(connection, 'SELECT * FROM projects WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE', [id, userId])
      if (!rows[0]) return undefined
      const current = mapProject(rows[0])
      const goalRows = current.goalId
        ? await queryRows<SqlRow>(connection, 'SELECT status FROM goals WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1', [current.goalId, userId])
        : []
      const next = updateProjectEntity(current, this.now(), input, goalRows[0]?.status as Goal['status'] | undefined)
      await connection.execute(`UPDATE projects SET title = ?, description = ?, risk_note = ?, status = ?, starts_on = ?, target_on = ?, progress = ?,
        next_task_id = ?, version = ?, updated_at = ? WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`, [
        next.title, next.description, next.riskNote, next.status, next.startsOn, next.targetOn, next.progress, next.nextTaskId,
        next.version, toSqlDateTime(next.updatedAt), id, userId, input.version,
      ])
      return next
    })
  }

  async deleteProject(userId: string, id: string, version: number) {
    return this.softDelete('projects', 'project', userId, id, version)
  }

  async restoreProject(userId: string, id: string, version: number) {
    return this.restore('projects', 'project', userId, id, version, mapProject)
  }

  async listMilestones(userId: string, projectId: string) {
    const rows = await queryRows<SqlRow>(this.pool, `SELECT m.* FROM milestones m
      INNER JOIN projects p ON p.id = m.project_id AND p.user_id = m.user_id AND p.deleted_at IS NULL
      WHERE m.user_id = ? AND m.project_id = ? AND m.deleted_at IS NULL ORDER BY m.position, m.id`, [userId, projectId])
    return rows.map(mapMilestone)
  }

  async getMilestone(userId: string, id: string) {
    const rows = await queryRows<SqlRow>(this.pool, `SELECT m.* FROM milestones m
      INNER JOIN projects p ON p.id = m.project_id AND p.user_id = m.user_id AND p.deleted_at IS NULL
      WHERE m.id = ? AND m.user_id = ? AND m.deleted_at IS NULL LIMIT 1`, [id, userId])
    return rows[0] ? mapMilestone(rows[0]) : undefined
  }

  async createMilestone(userId: string, projectId: string, input: CreateMilestoneInput, idempotencyKey: string) {
    return this.createIdempotently<Milestone>(userId, `projects:${projectId}:milestones:create`, idempotencyKey, input, async (connection) => {
      const projects = await queryRows<SqlRow>(connection, 'SELECT id FROM projects WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE', [projectId, userId])
      if (!projects[0]) throw new GoalsDomainError('NOT_FOUND', '找不到项目', 404)
      const timestamp = this.now()
      const milestone = createMilestoneEntity(this.createId(), projectId, input)
      await connection.execute(`INSERT INTO milestones
        (id, user_id, project_id, title, due_on, completed_at, position, version, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`, [
        milestone.id, userId, projectId, milestone.title, milestone.dueOn,
        milestone.completedAt ? toSqlDateTime(milestone.completedAt) : null, milestone.position, milestone.version,
        toSqlDateTime(timestamp), toSqlDateTime(timestamp),
      ])
      return milestone
    })
  }

  async updateMilestone(userId: string, id: string, input: UpdateMilestoneInput) {
    return this.inTransaction(async (connection) => {
      const rows = await queryRows<SqlRow>(connection, `SELECT m.* FROM milestones m
        INNER JOIN projects p ON p.id = m.project_id AND p.user_id = m.user_id AND p.deleted_at IS NULL
        WHERE m.id = ? AND m.user_id = ? AND m.deleted_at IS NULL LIMIT 1 FOR UPDATE`, [id, userId])
      if (!rows[0]) return undefined
      const next = updateMilestoneEntity(mapMilestone(rows[0]), input)
      await connection.execute(`UPDATE milestones SET title = ?, due_on = ?, completed_at = ?, position = ?, version = ?, updated_at = ?
        WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`, [
        next.title, next.dueOn, next.completedAt ? toSqlDateTime(next.completedAt) : null, next.position, next.version,
        toSqlDateTime(this.now()), id, userId, input.version,
      ])
      return next
    })
  }

  async deleteMilestone(userId: string, id: string, version: number) {
    return this.inTransaction(async (connection) => {
      const rows = await queryRows<SqlRow>(connection, `SELECT m.version FROM milestones m
        INNER JOIN projects p ON p.id = m.project_id AND p.user_id = m.user_id AND p.deleted_at IS NULL
        WHERE m.id = ? AND m.user_id = ? AND m.deleted_at IS NULL LIMIT 1 FOR UPDATE`, [id, userId])
      if (!rows[0]) return false
      assertExpectedVersion(Number(rows[0].version), version)
      const now = this.now()
      const timestamp = toSqlDateTime(now)
      const [result] = await connection.execute<ResultSetHeader>(`UPDATE milestones
        SET deleted_at = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`, [timestamp, timestamp, id, userId, version])
      if (result.affectedRows === 1) {
        await this.insertRecoveryAudit(connection, userId, 'milestone', 'archive', id, version, version + 1, null, now)
      }
      return result.affectedRows === 1
    })
  }

  async restoreMilestone(userId: string, id: string, version: number) {
    return this.restore('milestones', 'milestone', userId, id, version, mapMilestone)
  }

  async listGoalRecoveryAuditEvents(userId: string, entityType: GoalRecoveryEntityType, entityId: string) {
    const rows = await queryRows<SqlRow>(this.pool, `SELECT id, action, entity_type, entity_id, details, occurred_at
      FROM audit_events
      WHERE user_id = ? AND entity_type = ? AND entity_id = ?
        AND action IN (?, ?)
      ORDER BY occurred_at, created_at, id`, [userId, entityType, entityId, `${entityType}.archive`, `${entityType}.restore`])
    return rows.map((row): GoalRecoveryAuditEvent => {
      const details = parseJson<GoalRecoveryAuditEvent['details']>(row.details)
      if (!details) throw new Error('目标层级恢复审计详情无效')
      return {
        id: String(row.id),
        action: row.action as GoalRecoveryAuditEvent['action'],
        entityType: row.entity_type as GoalRecoveryEntityType,
        entityId: String(row.entity_id),
        details,
        occurredAt: iso(row.occurred_at),
      }
    })
  }

  private async createIdempotently<T>(
    userId: string,
    scope: string,
    key: string,
    input: unknown,
    create: (connection: PoolConnection) => Promise<T>,
  ): Promise<T> {
    const normalizedKey = normalizeIdempotencyKey(key)
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
    if (String(row.request_hash) !== hash) {
      throw new GoalsDomainError('IDEMPOTENCY_CONFLICT', '同一个幂等键不能用于不同请求', 409)
    }
    const value = parseJson<T>(row.response_body)
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

  private async softDelete(
    table: 'goals' | 'projects',
    entityType: 'goal' | 'project',
    userId: string,
    id: string,
    expectedVersion: number,
  ) {
    return this.inTransaction(async (connection) => {
      const rows = await queryRows<SqlRow>(connection, `SELECT version FROM ${table}
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`, [id, userId])
      if (!rows[0]) return false
      assertExpectedVersion(Number(rows[0].version), expectedVersion)
      const now = this.now()
      const timestamp = toSqlDateTime(now)
      const [result] = await connection.execute<ResultSetHeader>(`UPDATE ${table}
        SET deleted_at = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`, [
        timestamp, timestamp, id, userId, expectedVersion,
      ])
      if (result.affectedRows === 1) {
        await this.insertRecoveryAudit(connection, userId, entityType, 'archive', id, expectedVersion, expectedVersion + 1, null, now)
      }
      return result.affectedRows === 1
    })
  }

  private async restore<T>(
    table: 'goals' | 'projects' | 'milestones',
    entityType: GoalRecoveryEntityType,
    userId: string,
    id: string,
    expectedVersion: number,
    map: (row: SqlRow) => T,
  ) {
    return this.inTransaction(async (connection) => {
      const rows = await queryRows<SqlRow>(connection, `SELECT * FROM ${table}
        WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL LIMIT 1 FOR UPDATE`, [id, userId])
      if (!rows[0]) return undefined
      assertExpectedVersion(Number(rows[0].version), expectedVersion)
      const archiveRows = await queryRows<SqlRow>(connection, `SELECT archive.id FROM audit_events archive
        WHERE archive.user_id = ? AND archive.entity_type = ? AND archive.entity_id = ? AND archive.action = ?
          AND NOT EXISTS (
            SELECT 1 FROM audit_events reversal
            WHERE reversal.user_id = archive.user_id
              AND reversal.entity_type = archive.entity_type
              AND reversal.entity_id = archive.entity_id
              AND reversal.action = ?
              AND JSON_UNQUOTE(JSON_EXTRACT(reversal.details, '$.reversesEventId')) = archive.id
          )
        ORDER BY archive.occurred_at DESC, archive.created_at DESC, archive.id DESC
        LIMIT 1 FOR UPDATE`, [userId, entityType, id, `${entityType}.archive`, `${entityType}.restore`])
      if (!archiveRows[0]) throw new GoalsDomainError('NOT_FOUND', '找不到当前归档审计事件', 404)
      const now = this.now()
      const timestamp = toSqlDateTime(now)
      const [result] = await connection.execute<ResultSetHeader>(`UPDATE ${table}
        SET deleted_at = NULL, updated_at = ?, version = version + 1
        WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NOT NULL`, [timestamp, id, userId, expectedVersion])
      if (result.affectedRows !== 1) throw new GoalsDomainError('VERSION_CONFLICT', '数据已经在另一处更新', 409)
      await this.insertRecoveryAudit(
        connection,
        userId,
        entityType,
        'restore',
        id,
        expectedVersion,
        expectedVersion + 1,
        String(archiveRows[0].id),
        now,
      )
      const restored = await queryRows<SqlRow>(connection, `SELECT * FROM ${table}
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`, [id, userId])
      return restored[0] ? map(restored[0]) : undefined
    })
  }

  private async insertRecoveryAudit(
    connection: PoolConnection,
    userId: string,
    entityType: GoalRecoveryEntityType,
    operation: 'archive' | 'restore',
    entityId: string,
    versionBefore: number,
    versionAfter: number,
    reversesEventId: string | null,
    occurredAt: string,
  ) {
    await connection.execute(`INSERT INTO audit_events
      (id, user_id, action, entity_type, entity_id, request_id, details, occurred_at, created_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`, [
      this.createId(),
      userId,
      `${entityType}.${operation}`,
      entityType,
      entityId,
      JSON.stringify({ versionBefore, versionAfter, reversesEventId }),
      toSqlDateTime(occurredAt),
      toSqlDateTime(occurredAt),
    ])
  }
}

function mapGoal(row: SqlRow): Goal {
  return {
    id: String(row.id),
    title: String(row.title),
    description: String(row.description),
    status: row.status as Goal['status'],
    priority: Number(row.priority) as Goal['priority'],
    startsOn: dateOnly(row.starts_on),
    targetOn: dateOnly(row.target_on),
    progressMode: row.progress_mode as Goal['progressMode'],
    manualProgress: Number(row.manual_progress),
    version: Number(row.version),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    deletedAt: optionalIso(row.deleted_at),
  }
}

function mapProject(row: SqlRow): Project {
  return {
    id: String(row.id),
    goalId: row.goal_id == null ? null : String(row.goal_id),
    title: String(row.title),
    description: String(row.description),
    riskNote: row.risk_note == null ? '' : String(row.risk_note),
    status: row.status as Project['status'],
    startsOn: dateOnly(row.starts_on),
    targetOn: dateOnly(row.target_on),
    progress: Number(row.progress),
    nextTaskId: row.next_task_id == null ? null : String(row.next_task_id),
    version: Number(row.version),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    deletedAt: optionalIso(row.deleted_at),
  }
}

function mapMilestone(row: SqlRow): Milestone {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    title: String(row.title),
    dueOn: dateOnly(row.due_on),
    completedAt: optionalIso(row.completed_at),
    position: Number(row.position),
    version: Number(row.version),
    deletedAt: optionalIso(row.deleted_at),
  }
}
