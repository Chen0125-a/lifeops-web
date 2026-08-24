import { createHash, randomUUID } from 'node:crypto'
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import {
  ReviewsDomainError,
  assertReviewVersion,
  buildReviewEvidence,
  createReviewEntity,
  normalizeReviewIdempotencyKey,
  updateReviewEntity,
  type ConvertReviewActionInput,
  type CreateReviewInput,
  type Review,
  type ReviewAction,
  type ReviewActionConversion,
  type ReviewEvidence,
  type ReviewEvidenceState,
  type ReviewFilters,
  type ReviewPeriod,
  type ReviewsStore,
  type UpdateReviewInput,
} from '../../domain/reviews.js'

type Executor = Pool | PoolConnection
type SqlRow = RowDataPacket & Record<string, unknown>

const toSqlDateTime = (value: string) => new Date(value).toISOString().slice(0, 23).replace('T', ' ')
const iso = (value: unknown) => {
  if (value instanceof Date) return value.toISOString()
  const result = String(value)
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(result) ? `${result.replace(' ', 'T')}Z` : result
}
const optionalIso = (value: unknown) => value == null ? null : iso(value)
const parseJson = <T>(value: unknown, fallback: T): T => {
  if (value && typeof value === 'object') return value as T
  if (typeof value !== 'string') return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}
const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, item]) => `${JSON.stringify(name)}:${stable(item)}`).join(',')}}`
    : JSON.stringify(value)
const requestHash = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex').toUpperCase()

async function queryRows<T>(executor: Executor, sql: string, values: unknown[] = []): Promise<T[]> {
  const [rows] = await executor.execute(sql, values as never[])
  return rows as unknown as T[]
}

export class ReviewsMySqlStore implements ReviewsStore {
  constructor(
    private readonly pool: Pool,
    private readonly options: { createId?: () => string; now?: () => string } = {},
  ) {}

  private createId = () => this.options.createId?.() ?? randomUUID()
  private now = () => this.options.now?.() ?? new Date().toISOString()

  async listReviews(userId: string, filters: ReviewFilters = {}) {
    const rows = await queryRows<SqlRow>(this.pool, `SELECT * FROM period_reviews
      WHERE user_id = ? AND deleted_at IS NULL ${filters.includeArchived ? '' : "AND status <> 'archived'"}
      ORDER BY period_end DESC, id ASC`, [userId])
    return this.hydrateReviews(this.pool, userId, rows)
  }

  async listReviewsForDataTransfer(userId: string) {
    const rows = await queryRows<SqlRow>(this.pool, 'SELECT * FROM period_reviews WHERE user_id=? ORDER BY period_end DESC,id ASC', [userId])
    return this.hydrateReviews(this.pool, userId, rows)
  }

  async getReview(userId: string, id: string) {
    const rows = await queryRows<SqlRow>(this.pool, `SELECT * FROM period_reviews
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`, [id, userId])
    return rows[0] ? (await this.hydrateReviews(this.pool, userId, rows))[0] : undefined
  }

  async createReview(userId: string, input: CreateReviewInput, idempotencyKey: string) {
    return (await this.createIdempotently(userId, 'reviews:create', idempotencyKey, input, async (connection) => {
      const evidence = buildReviewEvidence(await this.evidenceState(connection, userId, input.period), input.period)
      const review = createReviewEntity(this.createId(), this.now(), input, evidence, this.createId)
      await this.insertReview(connection, userId, review)
      await this.audit(connection, userId, 'review.create', review.id, { type: review.type, period: review.period })
      return review
    })).value
  }

  async updateReview(userId: string, id: string, input: UpdateReviewInput) {
    return this.inTransaction(async (connection) => {
      const current = await this.lockReview(connection, userId, id, false)
      if (!current) return undefined
      const updated = updateReviewEntity(current, this.now(), input, this.createId)
      const next = input.period
        ? { ...updated, evidence: buildReviewEvidence(await this.evidenceState(connection, userId, updated.period, id), updated.period) }
        : updated
      const [result] = await connection.execute<ResultSetHeader>(`UPDATE period_reviews SET
        review_type = ?, period_start = ?, period_end = ?, status = ?, summary = ?, achievements = ?, problems = ?,
        causes = ?, insights = ?, next_changes = ?, evidence_json = ?, version = ?, updated_at = ?
        WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`, [
        next.type, next.period.from, next.period.to, next.status, this.legacySummary(next),
        JSON.stringify(next.achievements), JSON.stringify(next.problems), JSON.stringify(next.causes),
        JSON.stringify(next.insights), JSON.stringify(next.nextChanges), JSON.stringify(next.evidence), next.version, toSqlDateTime(next.updatedAt),
        id, userId, input.version,
      ])
      if (result.affectedRows !== 1) throw this.versionConflict()
      await this.replaceActions(connection, userId, next)
      await this.audit(connection, userId, 'review.update', id, { version: next.version })
      return next
    })
  }

  async deleteReview(userId: string, id: string, version: number) {
    return this.inTransaction(async (connection) => {
      const current = await this.lockReview(connection, userId, id, false)
      if (!current) return false
      assertReviewVersion(current.version, version)
      const now = this.now()
      await connection.execute(`UPDATE period_reviews SET version = version + 1, updated_at = ?, deleted_at = ?
        WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`, [toSqlDateTime(now), toSqlDateTime(now), id, userId, version])
      await this.audit(connection, userId, 'review.delete', id, { previousVersion: version, nextVersion: version + 1 })
      return true
    })
  }

  async restoreReview(userId: string, id: string, version: number) {
    return this.inTransaction(async (connection) => {
      const current = await this.lockReview(connection, userId, id, true)
      if (!current) return undefined
      assertReviewVersion(current.version, version)
      const now = this.now()
      await connection.execute(`UPDATE period_reviews SET version = version + 1, updated_at = ?, deleted_at = NULL
        WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NOT NULL`, [toSqlDateTime(now), id, userId, version])
      await this.audit(connection, userId, 'review.restore', id, { previousVersion: version, nextVersion: version + 1 })
      return { ...current, version: version + 1, updatedAt: now, deletedAt: null }
    })
  }

  async refreshReviewEvidence(userId: string, id: string, version: number) {
    return this.inTransaction(async (connection) => {
      const current = await this.lockReview(connection, userId, id, false)
      if (!current) return undefined
      assertReviewVersion(current.version, version)
      const evidence = buildReviewEvidence(await this.evidenceState(connection, userId, current.period, id), current.period)
      const now = this.now()
      const [result] = await connection.execute<ResultSetHeader>(`UPDATE period_reviews SET evidence_json = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`, [JSON.stringify(evidence), toSqlDateTime(now), id, userId, version])
      if (result.affectedRows !== 1) throw this.versionConflict()
      await this.audit(connection, userId, 'review.evidence.refresh', id, { previousVersion: version, nextVersion: version + 1 })
      return { ...current, evidence, version: version + 1, updatedAt: now }
    })
  }

  async convertReviewAction(userId: string, reviewId: string, actionId: string, input: ConvertReviewActionInput, idempotencyKey: string) {
    const scopeHash = createHash('sha256').update(`${reviewId}\u0000${actionId}`).digest('hex').slice(0, 64)
    return (await this.createIdempotently(userId, `reviews:convert:${scopeHash}`, idempotencyKey, input, async (connection) => {
      const review = await this.lockReview(connection, userId, reviewId, false)
      if (!review) throw new ReviewsDomainError('NOT_FOUND', '找不到回顾', 404)
      const actionRows = await queryRows<SqlRow>(connection, `SELECT * FROM review_actions
        WHERE review_id = ? AND id = ? AND user_id = ? LIMIT 1 FOR UPDATE`, [reviewId, actionId, userId])
      if (!actionRows[0]) throw new ReviewsDomainError('NOT_FOUND', '找不到回顾行动', 404)
      const action = this.mapAction(actionRows[0])
      if (action.status !== 'pending') throw new ReviewsDomainError('ACTION_ALREADY_CONVERTED', '该行动已经处理，不能重复产生效果', 409)

      const target = await this.createConversionTarget(connection, userId, review, action, input)
      const now = this.now()
      await connection.execute(`UPDATE review_actions SET status = 'converted', converted_target = ?, converted_id = ?,
        version = version + 1, updated_at = ? WHERE review_id = ? AND id = ? AND user_id = ? AND status = 'pending'`, [
        input.target, target.id, toSqlDateTime(now), reviewId, actionId, userId,
      ])
      await connection.execute(`UPDATE period_reviews SET version = version + 1, updated_at = ?
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL`, [toSqlDateTime(now), reviewId, userId])
      await this.audit(connection, userId, 'review.action.convert', reviewId, { actionId, target: input.target, targetId: target.id })

      const converted: ReviewAction = {
        ...action,
        status: 'converted',
        convertedTarget: input.target,
        convertedId: target.id,
        version: action.version + 1,
        updatedAt: now,
      }
      const nextReview: Review = {
        ...review,
        actions: review.actions.map((item) => item.id === actionId ? converted : item),
        version: review.version + 1,
        updatedAt: now,
      }
      return { review: nextReview, action: converted, target } satisfies ReviewActionConversion
    })).value
  }

  private async insertReview(connection: PoolConnection, userId: string, review: Review) {
    await connection.execute(`INSERT INTO period_reviews
      (id, user_id, review_type, period_start, period_end, status, summary, achievements, problems, causes, insights,
       next_changes, evidence_json, version, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)`, [
      review.id, userId, review.type, review.period.from, review.period.to, review.status, this.legacySummary(review),
      JSON.stringify(review.achievements), JSON.stringify(review.problems), JSON.stringify(review.causes),
      JSON.stringify(review.insights), JSON.stringify(review.nextChanges), JSON.stringify(review.evidence),
      toSqlDateTime(review.createdAt), toSqlDateTime(review.updatedAt),
    ])
    for (const action of review.actions) await this.insertAction(connection, userId, review.id, action)
  }

  private async replaceActions(connection: PoolConnection, userId: string, review: Review) {
    const rows = await queryRows<SqlRow>(connection, 'SELECT * FROM review_actions WHERE review_id = ? AND user_id = ? FOR UPDATE', [review.id, userId])
    const existing = new Map(rows.map((row) => [String(row.id), this.mapAction(row)]))
    const keep = new Set(review.actions.map((action) => action.id))
    for (const current of existing.values()) {
      if (!keep.has(current.id)) {
        if (current.status !== 'pending') throw new ReviewsDomainError('ACTION_ALREADY_CONVERTED', '已转换的行动不能从回顾中移除', 409)
        await connection.execute('DELETE FROM review_actions WHERE review_id = ? AND id = ? AND user_id = ?', [review.id, current.id, userId])
      }
    }
    for (const action of review.actions) {
      const current = existing.get(action.id)
      if (!current) await this.insertAction(connection, userId, review.id, action)
      else if (current.text !== action.text) {
        await connection.execute(`UPDATE review_actions SET action_text = ?, version = ?, updated_at = ?
          WHERE review_id = ? AND id = ? AND user_id = ? AND status = 'pending'`, [
          action.text, action.version, toSqlDateTime(action.updatedAt), review.id, action.id, userId,
        ])
      }
    }
  }

  private async insertAction(connection: PoolConnection, userId: string, reviewId: string, action: ReviewAction) {
    await connection.execute(`INSERT INTO review_actions
      (id, user_id, review_id, action_text, status, converted_target, converted_id, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      action.id, userId, reviewId, action.text, action.status, action.convertedTarget, action.convertedId,
      action.version, toSqlDateTime(action.createdAt), toSqlDateTime(action.updatedAt),
    ])
  }

  private async lockReview(connection: PoolConnection, userId: string, id: string, deleted: boolean) {
    const rows = await queryRows<SqlRow>(connection, `SELECT * FROM period_reviews
      WHERE id = ? AND user_id = ? AND deleted_at IS ${deleted ? 'NOT ' : ''}NULL LIMIT 1 FOR UPDATE`, [id, userId])
    return rows[0] ? (await this.hydrateReviews(connection, userId, rows))[0] : undefined
  }

  private async hydrateReviews(executor: Executor, userId: string, rows: SqlRow[]): Promise<Review[]> {
    if (!rows.length) return []
    const ids = rows.map((row) => String(row.id))
    const placeholders = ids.map(() => '?').join(', ')
    const actionRows = await queryRows<SqlRow>(executor, `SELECT * FROM review_actions
      WHERE user_id = ? AND review_id IN (${placeholders}) ORDER BY review_id, created_at, id`, [userId, ...ids])
    const actions = new Map<string, ReviewAction[]>()
    for (const row of actionRows) {
      const reviewId = String(row.review_id)
      const items = actions.get(reviewId) ?? []
      items.push(this.mapAction(row))
      actions.set(reviewId, items)
    }
    return rows.map((row) => this.mapReview(row, actions.get(String(row.id)) ?? []))
  }

  private mapReview(row: SqlRow, actions: ReviewAction[]): Review {
    const period = { from: String(row.period_start).slice(0, 10), to: String(row.period_end).slice(0, 10) }
    return {
      id: String(row.id),
      type: row.review_type as Review['type'],
      period,
      status: row.status as Review['status'],
      achievements: parseJson<string[]>(row.achievements, []),
      problems: parseJson<string[]>(row.problems, []),
      causes: parseJson<string[]>(row.causes, []),
      insights: parseJson<string[]>(row.insights, []),
      nextChanges: parseJson<string[]>(row.next_changes, []),
      evidence: parseJson<ReviewEvidence>(row.evidence_json, this.emptyEvidence(period)),
      actions,
      version: Number(row.version),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      deletedAt: optionalIso(row.deleted_at),
    }
  }

  private mapAction(row: SqlRow): ReviewAction {
    return {
      id: String(row.id),
      text: String(row.action_text),
      status: row.status as ReviewAction['status'],
      convertedTarget: row.converted_target == null ? null : row.converted_target as ReviewAction['convertedTarget'],
      convertedId: row.converted_id == null ? null : String(row.converted_id),
      version: Number(row.version),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    }
  }

  private async evidenceState(executor: Executor, userId: string, period: ReviewPeriod, currentReviewId?: string): Promise<ReviewEvidenceState> {
    const [goalRows, projectRows, taskRows, habitRows, entryRows, recordRows, commitmentRows] = await Promise.all([
      queryRows<SqlRow>(executor, `SELECT status, updated_at, deleted_at FROM goals WHERE user_id = ? AND deleted_at IS NULL`, [userId]),
      queryRows<SqlRow>(executor, `SELECT status, updated_at, deleted_at FROM projects WHERE user_id = ? AND deleted_at IS NULL`, [userId]),
      queryRows<SqlRow>(executor, `SELECT id, status, completed_at, updated_at, deleted_at FROM tasks WHERE user_id = ? AND deleted_at IS NULL`, [userId]),
      queryRows<SqlRow>(executor, `SELECT id FROM habits WHERE user_id = ? AND deleted_at IS NULL`, [userId]),
      queryRows<SqlRow>(executor, `SELECT habit_id, entry_date, status FROM habit_entries
        WHERE user_id = ? AND deleted_at IS NULL AND entry_date BETWEEN ? AND ?`, [userId, period.from, period.to]),
      queryRows<SqlRow>(executor, `SELECT id, occurred_at, deleted_at FROM life_records
        WHERE user_id = ? AND deleted_at IS NULL AND DATE(occurred_at) BETWEEN ? AND ?`, [userId, period.from, period.to]),
      queryRows<SqlRow>(executor, `SELECT action.review_id, action.action_text, action.status FROM review_actions action
        INNER JOIN period_reviews review ON review.id = action.review_id AND review.user_id = action.user_id
        WHERE action.user_id = ? AND action.status = 'pending' AND review.deleted_at IS NULL
          AND review.period_end < ? ${currentReviewId ? 'AND review.id <> ?' : ''}
        ORDER BY review.period_end, action.created_at, action.id`, currentReviewId ? [userId, period.from, currentReviewId] : [userId, period.from]),
    ])
    return {
      goals: goalRows.map((row) => ({ status: row.status as 'active', updatedAt: iso(row.updated_at), deletedAt: optionalIso(row.deleted_at) })),
      projects: projectRows.map((row) => ({ status: row.status as 'active', updatedAt: iso(row.updated_at), deletedAt: optionalIso(row.deleted_at) })),
      tasks: taskRows.map((row) => ({ id: String(row.id), status: row.status as 'planned', completedAt: optionalIso(row.completed_at), updatedAt: iso(row.updated_at), deletedAt: optionalIso(row.deleted_at) })),
      habits: habitRows.map((row) => ({ id: String(row.id) })),
      habitEntries: entryRows.map((row) => ({ habitId: String(row.habit_id), entryDate: String(row.entry_date).slice(0, 10), status: row.status as 'done' })),
      records: recordRows.map((row) => ({ id: String(row.id), occurredAt: iso(row.occurred_at), deletedAt: optionalIso(row.deleted_at) })),
      priorCommitments: commitmentRows.map((row) => ({ reviewId: String(row.review_id), text: String(row.action_text), status: row.status as 'pending' })),
    }
  }

  private async createConversionTarget(
    connection: PoolConnection,
    userId: string,
    review: Review,
    action: ReviewAction,
    input: ConvertReviewActionInput,
  ): Promise<ReviewActionConversion['target']> {
    const id = this.createId()
    const now = this.now()
    if (input.target === 'task') {
      await connection.execute(`INSERT INTO tasks
        (id, user_id, title, description, tags, status, version, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, '', JSON_ARRAY(), 'inbox', 1, ?, ?, NULL)`, [id, userId, action.text, toSqlDateTime(now), toSqlDateTime(now)])
      return { type: 'task', id, title: action.text }
    }
    if (input.target === 'knowledge') {
      await connection.execute(`INSERT INTO knowledge_notes
        (id, user_id, source_type, source_id, title, body, tags, collection_ids, source_links, related_ids,
         pinned, favorite, review_on, version, created_at, updated_at, archived_at, deleted_at)
        VALUES (?, ?, 'review', ?, ?, ?, JSON_ARRAY('review-action'), JSON_ARRAY(),
          JSON_ARRAY(JSON_OBJECT('type', 'review', 'id', ?)), JSON_ARRAY(), FALSE, FALSE, NULL, 1, ?, ?, NULL, NULL)`,
      [id, userId, review.id, action.text, action.text, review.id, toSqlDateTime(now), toSqlDateTime(now)])
      return { type: 'knowledge', id, title: action.text }
    }
    if (input.target === 'public-draft') {
      await connection.execute(`INSERT INTO public_snapshots
        (id, user_id, slug, source_type, source_id, title, excerpt, visibility, created_at)
        VALUES (?, ?, ?, 'review', ?, ?, ?, 'private', ?)`, [id, userId, `review-${this.createId()}`, review.id, action.text, action.text, toSqlDateTime(now)])
      return { type: 'public-draft', id, title: action.text }
    }
    if (!input.goalId) throw new ReviewsDomainError('INVALID_INPUT', '转换为目标更新时必须选择目标', 400)
    const goals = await queryRows<SqlRow>(connection, `SELECT id FROM goals
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`, [input.goalId, userId])
    if (!goals[0]) throw new ReviewsDomainError('NOT_FOUND', '找不到目标', 404)
    await connection.execute(`INSERT INTO goal_updates
      (id, user_id, goal_id, review_id, action_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
      id, userId, input.goalId, review.id, action.id, action.text, toSqlDateTime(now),
    ])
    return { type: 'goal-update', id, title: action.text }
  }

  private legacySummary(review: Review) {
    return review.achievements.join('\n') || review.insights.join('\n') || '回顾草稿'
  }

  private emptyEvidence(period: ReviewPeriod): ReviewEvidence {
    return {
      period,
      goals: { active: 0, completed: 0 },
      projects: { active: 0, completed: 0 },
      tasks: { total: 0, completed: 0, skipped: 0, cancelled: 0 },
      habits: { entries: 0, done: 0, partial: 0, intentionalSkips: 0 },
      records: { total: 0, ids: [] },
      priorCommitments: [],
      hasFacts: false,
    }
  }

  private async audit(connection: PoolConnection, userId: string, action: string, entityId: string, details: unknown) {
    const now = this.now()
    await connection.execute(`INSERT INTO audit_events
      (id, user_id, action, entity_type, entity_id, request_id, details, occurred_at, created_at)
      VALUES (?, ?, ?, 'review', ?, NULL, ?, ?, ?)`, [
      this.createId(), userId, action, entityId, JSON.stringify(details), toSqlDateTime(now), toSqlDateTime(now),
    ])
  }

  private async createIdempotently<T>(
    userId: string,
    scope: string,
    rawKey: string,
    input: unknown,
    create: (connection: PoolConnection) => Promise<T>,
  ): Promise<{ value: T; replayed: boolean }> {
    const key = normalizeReviewIdempotencyKey(rawKey)
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
        if (!this.duplicateEntry(error)) throw error
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
    } finally { connection.release() }
  }

  private async idempotencyRows(executor: Executor, userId: string, scope: string, key: string, lock: boolean) {
    return queryRows<SqlRow>(executor, `SELECT request_hash, response_body FROM idempotency_keys
      WHERE user_id = ? AND scope = ? AND idempotency_key = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`, [userId, scope, key])
  }

  private replay<T>(row: SqlRow, hash: string): T {
    if (String(row.request_hash).toUpperCase() !== hash) throw new ReviewsDomainError('IDEMPOTENCY_CONFLICT', '幂等键已用于不同回顾请求', 409)
    if (row.response_body == null) throw new ReviewsDomainError('IDEMPOTENCY_CONFLICT', '幂等回顾请求仍在处理中', 409)
    return parseJson<T>(row.response_body, undefined as T)
  }

  private duplicateEntry(error: unknown) {
    return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ER_DUP_ENTRY')
  }

  private versionConflict() {
    return new ReviewsDomainError('VERSION_CONFLICT', '回顾已被更新，请刷新后重试', 409)
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
    } finally { connection.release() }
  }
}
