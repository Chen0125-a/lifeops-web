import { createHash, randomUUID } from 'node:crypto'
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import {
  RecordsDomainError,
  createMediaAssetEntity,
  createRecordEntity,
  normalizeRecordIdempotencyKey,
  updateRecordEntity,
  type CreateMediaAssetInput,
  type CreateRecordInput,
  type RecordFilters,
  type RecordsStore,
  type UpdateRecordInput,
} from '../../domain/records.js'
import type { LifeRecord, MediaAsset, RecordLink, RecordLinkType } from '../../domain/types.js'

type Executor = Pool | PoolConnection
type SqlRow = RowDataPacket & Record<string, unknown>

const toSqlDateTime = (value: string) => new Date(value).toISOString().slice(0, 23).replace('T', ' ')
const iso = (value: unknown) => {
  if (value instanceof Date) return value.toISOString()
  const result = String(value)
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(result) ? `${result.replace(' ', 'T')}Z` : result
}
const optionalIso = (value: unknown) => value == null ? null : iso(value)
const parseArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value !== 'string') return []
  try {
    const result = JSON.parse(value) as unknown
    return Array.isArray(result) ? result.map(String) : []
  } catch {
    return []
  }
}
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

export class RecordsMySqlStore implements RecordsStore {
  constructor(
    private readonly pool: Pool,
    private readonly options: { createId?: () => string; now?: () => string } = {},
  ) {}

  private createId = () => this.options.createId?.() ?? randomUUID()
  private now = () => this.options.now?.() ?? new Date().toISOString()

  async listRecords(userId: string, filters: RecordFilters = {}) {
    if ((filters.linkType && !filters.linkId) || (!filters.linkType && filters.linkId)) {
      throw new RecordsDomainError('INVALID_INPUT', '关联类型和关联 ID 必须同时提供', 400)
    }
    const where = ['r.user_id = ?', 'r.deleted_at IS NULL']
    const values: unknown[] = [userId]
    if (!filters.includeArchived) where.push('r.archived_at IS NULL')
    if (filters.from) { where.push('DATE(r.occurred_at) >= ?'); values.push(filters.from) }
    if (filters.to) { where.push('DATE(r.occurred_at) <= ?'); values.push(filters.to) }
    if (filters.tag) { where.push('JSON_CONTAINS(r.tags, JSON_QUOTE(?))'); values.push(filters.tag) }
    if (filters.q?.trim()) { where.push("CONCAT(r.title, '\n', r.body) LIKE ?"); values.push(`%${filters.q.trim().replace(/[\\%_]/g, '\\$&')}%`) }
    if (filters.linkType && filters.linkId) {
      where.push(`EXISTS (SELECT 1 FROM record_links filter_link
        WHERE filter_link.record_id = r.id AND filter_link.user_id = r.user_id
          AND filter_link.link_type = ? AND filter_link.link_id = ?)`)
      values.push(filters.linkType, filters.linkId)
    }
    const rows = await queryRows<SqlRow>(this.pool, `SELECT r.* FROM life_records r
      WHERE ${where.join(' AND ')} ORDER BY r.occurred_at DESC, r.id ASC`, values)
    return this.hydrateRecords(this.pool, userId, rows)
  }

  async listRecordsForDataTransfer(userId: string) {
    const rows = await queryRows<SqlRow>(this.pool, 'SELECT * FROM life_records WHERE user_id=? ORDER BY occurred_at DESC,id ASC', [userId])
    return this.hydrateRecords(this.pool, userId, rows)
  }

  async getRecord(userId: string, id: string) {
    const rows = await queryRows<SqlRow>(this.pool, `SELECT * FROM life_records
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`, [id, userId])
    return rows[0] ? (await this.hydrateRecords(this.pool, userId, rows))[0] : undefined
  }

  async createRecord(userId: string, input: CreateRecordInput, idempotencyKey?: string) {
    const create = async (connection: PoolConnection) => {
      const record = createRecordEntity(this.createId(), this.now(), input)
      await this.validatePlan(connection, userId, record.planId)
      await this.validateLinks(connection, userId, record.links)
      await this.validateMedia(connection, userId, record.mediaIds)
      await connection.execute(`INSERT INTO life_records
        (id, user_id, plan_id, title, body, occurred_at, tags, pinned, archived_at, cover_media_id,
         version, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, ?, ?, NULL)`, [
        record.id, userId, record.planId ?? null, record.title, record.body, toSqlDateTime(record.occurredAt),
        JSON.stringify(record.tags), record.pinned, record.coverMediaId,
        toSqlDateTime(record.createdAt), toSqlDateTime(record.updatedAt),
      ])
      await this.replaceRelations(connection, userId, record)
      return record
    }
    if (!idempotencyKey) return this.inTransaction(create)
    return (await this.createIdempotently(userId, 'records:create', idempotencyKey, input, create)).value
  }

  async updateRecord(userId: string, id: string, input: UpdateRecordInput) {
    return this.inTransaction(async (connection) => {
      const rows = await queryRows<SqlRow>(connection, `SELECT * FROM life_records
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`, [id, userId])
      if (!rows[0]) return undefined
      const current = (await this.hydrateRecords(connection, userId, rows))[0]!
      const next = updateRecordEntity(current, this.now(), input)
      await this.validatePlan(connection, userId, next.planId)
      await this.validateLinks(connection, userId, next.links)
      await this.validateMedia(connection, userId, next.mediaIds)
      const [result] = await connection.execute<ResultSetHeader>(`UPDATE life_records SET
        plan_id = ?, title = ?, body = ?, occurred_at = ?, tags = ?, pinned = ?, archived_at = ?, cover_media_id = ?,
        version = ?, updated_at = ?
        WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`, [
        next.planId ?? null, next.title, next.body, toSqlDateTime(next.occurredAt), JSON.stringify(next.tags),
        next.pinned, next.archivedAt ? toSqlDateTime(next.archivedAt) : null, next.coverMediaId, next.version,
        toSqlDateTime(next.updatedAt), id, userId, input.version,
      ])
      if (result.affectedRows !== 1) throw this.versionConflict()
      await this.replaceRelations(connection, userId, next)
      return next
    })
  }

  async deleteRecord(userId: string, id: string, version: number) {
    const now = this.now()
    const [result] = await this.pool.execute<ResultSetHeader>(`UPDATE life_records SET
      version = version + 1, updated_at = ?, deleted_at = ?
      WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`, [
      toSqlDateTime(now), toSqlDateTime(now), id, userId, version,
    ])
    if (result.affectedRows === 1) return true
    const existing = await queryRows<SqlRow>(this.pool, `SELECT version FROM life_records
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`, [id, userId])
    if (existing[0]) throw this.versionConflict()
    return false
  }

  async restoreRecord(userId: string, id: string, version: number) {
    return this.inTransaction(async (connection) => {
      const rows = await queryRows<SqlRow>(connection, `SELECT version FROM life_records
        WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL LIMIT 1 FOR UPDATE`, [id, userId])
      if (!rows[0]) return undefined
      if (Number(rows[0].version) !== version) throw this.versionConflict()
      const now = this.now()
      await connection.execute(`UPDATE life_records SET version = version + 1, updated_at = ?, deleted_at = NULL
        WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NOT NULL`, [toSqlDateTime(now), id, userId, version])
      const restored = await queryRows<SqlRow>(connection, `SELECT * FROM life_records
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`, [id, userId])
      return restored[0] ? (await this.hydrateRecords(connection, userId, restored))[0] : undefined
    })
  }

  async createMediaAsset(userId: string, input: CreateMediaAssetInput, idempotencyKey: string) {
    const request = { ...input, storageKey: undefined }
    return (await this.createIdempotently(userId, 'media:create', idempotencyKey, request, async (connection) => {
      const asset = createMediaAssetEntity(this.createId(), this.now(), input)
      await connection.execute(`INSERT INTO media_assets
        (id, user_id, visibility, mime_type, original_name, size_bytes, storage_key, checksum,
         width, height, version, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)`, [
        asset.id, userId, asset.visibility, asset.mimeType, asset.originalName, asset.sizeBytes,
        asset.storageKey, asset.checksum, asset.width, asset.height,
        toSqlDateTime(asset.createdAt), toSqlDateTime(asset.updatedAt),
      ])
      return asset
    })).value
  }

  async getMediaAsset(userId: string, id: string) {
    return this.getMediaAssetFrom(this.pool, userId, id)
  }

  async getMediaAssetFrom(executor: Executor, userId: string, id: string) {
    const rows = await queryRows<SqlRow>(executor, `SELECT * FROM media_assets
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`, [id, userId])
    return rows[0] ? this.mapMedia(rows[0]) : undefined
  }

  async getPublicMediaAsset(id: string) {
    const rows = await queryRows<SqlRow>(this.pool, `SELECT DISTINCT media.* FROM media_assets media
      INNER JOIN record_media relation ON relation.media_id = media.id AND relation.user_id = media.user_id
      INNER JOIN life_records record ON record.id = relation.record_id AND record.user_id = relation.user_id
      INNER JOIN public_snapshots snapshot ON snapshot.user_id = record.user_id
        AND snapshot.source_type = 'record' AND snapshot.source_id = record.id
      WHERE media.id = ? AND media.visibility = 'public' AND media.deleted_at IS NULL
        AND record.deleted_at IS NULL AND snapshot.visibility = 'public'
      LIMIT 1`, [id])
    return rows[0] ? this.mapMedia(rows[0]) : undefined
  }

  private async hydrateRecords(executor: Executor, userId: string, rows: SqlRow[]): Promise<LifeRecord[]> {
    if (!rows.length) return []
    const ids = rows.map((row) => String(row.id))
    const placeholders = ids.map(() => '?').join(', ')
    const [linkRows, mediaRows] = await Promise.all([
      queryRows<SqlRow>(executor, `SELECT record_id, link_type, link_id FROM record_links
        WHERE user_id = ? AND record_id IN (${placeholders}) ORDER BY record_id, position, link_type, link_id`, [userId, ...ids]),
      queryRows<SqlRow>(executor, `SELECT record_id, media_id FROM record_media
        WHERE user_id = ? AND record_id IN (${placeholders}) ORDER BY record_id, position, media_id`, [userId, ...ids]),
    ])
    const links = new Map<string, RecordLink[]>()
    for (const row of linkRows) {
      const recordId = String(row.record_id)
      const items = links.get(recordId) ?? []
      items.push({ type: row.link_type as RecordLinkType, id: String(row.link_id) })
      links.set(recordId, items)
    }
    const media = new Map<string, string[]>()
    for (const row of mediaRows) {
      const recordId = String(row.record_id)
      const items = media.get(recordId) ?? []
      items.push(String(row.media_id))
      media.set(recordId, items)
    }
    return rows.map((row) => this.mapRecord(row, links.get(String(row.id)) ?? [], media.get(String(row.id)) ?? []))
  }

  private mapRecord(row: SqlRow, links: RecordLink[], mediaIds: string[]): LifeRecord {
    return {
      id: String(row.id),
      ...(row.plan_id == null ? {} : { planId: String(row.plan_id) }),
      title: String(row.title),
      body: String(row.body),
      occurredAt: iso(row.occurred_at),
      tags: parseArray(row.tags),
      pinned: Boolean(row.pinned),
      archivedAt: optionalIso(row.archived_at),
      links,
      mediaIds,
      coverMediaId: row.cover_media_id == null ? null : String(row.cover_media_id),
      version: Number(row.version),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      deletedAt: optionalIso(row.deleted_at),
    }
  }

  private mapMedia(row: SqlRow): MediaAsset {
    return {
      id: String(row.id),
      visibility: row.visibility as MediaAsset['visibility'],
      mimeType: row.mime_type as MediaAsset['mimeType'],
      originalName: String(row.original_name),
      sizeBytes: Number(row.size_bytes),
      storageKey: String(row.storage_key),
      checksum: String(row.checksum ?? ''),
      width: row.width == null ? null : Number(row.width),
      height: row.height == null ? null : Number(row.height),
      version: Number(row.version),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      deletedAt: optionalIso(row.deleted_at),
    }
  }

  private async validatePlan(executor: Executor, userId: string, planId: string | undefined) {
    if (!planId) return
    const rows = await queryRows<SqlRow>(executor, 'SELECT id FROM plans WHERE id = ? AND user_id = ? LIMIT 1', [planId, userId])
    if (!rows[0]) throw new RecordsDomainError('NOT_FOUND', '找不到来源计划', 404)
  }

  private async validateLinks(executor: Executor, userId: string, links: RecordLink[]) {
    const tables: Record<RecordLinkType, string> = { goal: 'goals', project: 'projects', task: 'tasks', habit: 'habits' }
    for (const link of links) {
      const rows = await queryRows<SqlRow>(executor, `SELECT id FROM ${tables[link.type]}
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`, [link.id, userId])
      if (!rows[0]) throw new RecordsDomainError('NOT_FOUND', '找不到记录关联对象', 404)
    }
  }

  private async validateMedia(executor: Executor, userId: string, mediaIds: string[]) {
    for (const id of mediaIds) {
      const rows = await queryRows<SqlRow>(executor, `SELECT id FROM media_assets
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`, [id, userId])
      if (!rows[0]) throw new RecordsDomainError('NOT_FOUND', '找不到媒体', 404)
    }
  }

  private async replaceRelations(connection: PoolConnection, userId: string, record: LifeRecord) {
    await connection.execute('DELETE FROM record_links WHERE record_id = ? AND user_id = ?', [record.id, userId])
    for (const [position, link] of record.links.entries()) {
      await connection.execute(`INSERT INTO record_links
        (record_id, user_id, link_type, link_id, position, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [
        record.id, userId, link.type, link.id, position, toSqlDateTime(record.updatedAt),
      ])
    }
    await connection.execute('DELETE FROM record_media WHERE record_id = ? AND user_id = ?', [record.id, userId])
    for (const [position, mediaId] of record.mediaIds.entries()) {
      await connection.execute(`INSERT INTO record_media
        (record_id, user_id, media_id, position, created_at) VALUES (?, ?, ?, ?, ?)`, [
        record.id, userId, mediaId, position, toSqlDateTime(record.updatedAt),
      ])
    }
  }

  private async createIdempotently<T>(
    userId: string,
    scope: string,
    rawKey: string,
    input: unknown,
    create: (connection: PoolConnection) => Promise<T>,
  ): Promise<{ value: T; replayed: boolean }> {
    const key = normalizeRecordIdempotencyKey(rawKey)
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
      throw new RecordsDomainError('IDEMPOTENCY_CONFLICT', '幂等键已用于不同请求', 409)
    }
    if (row.response_body == null) throw new RecordsDomainError('IDEMPOTENCY_CONFLICT', '幂等请求仍在处理中', 409)
    return parseJson<T>(row.response_body, undefined as T)
  }

  private duplicateEntry(error: unknown) {
    return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ER_DUP_ENTRY')
  }

  private versionConflict() {
    return new RecordsDomainError('VERSION_CONFLICT', '记录已被更新，请刷新后重试', 409)
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
