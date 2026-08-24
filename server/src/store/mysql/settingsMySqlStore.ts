import { createHash, randomUUID } from 'node:crypto'
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { SafeAuditEvent, UserSettings, UserSettingsDocument } from '../../domain/types.js'
import type { DataExportResult, DataTransferRestorePoint } from '../../services/dataTransfer.js'
import { DEFAULT_USER_SETTINGS } from '../settingsStore.js'

type SqlRow = RowDataPacket & Record<string, unknown>
type Executor = Pool | PoolConnection

const toSqlDateTime = (value: string) => new Date(value).toISOString().slice(0, 23).replace('T', ' ')
const iso = (value: unknown) => value instanceof Date
  ? value.toISOString()
  : /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(String(value))
    ? `${String(value).replace(' ', 'T')}Z`
    : String(value)

function parseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch { return {} }
}

function mergeSettings(current: UserSettings, input: Partial<UserSettings>): UserSettings {
  return {
    appearance: { ...current.appearance, ...input.appearance },
    locale: { ...current.locale, ...input.locale },
    defaults: { ...current.defaults, ...input.defaults },
    life: { ...current.life, ...input.life },
    publicSite: { ...current.publicSite, ...input.publicSite },
  }
}

function safeMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeMetadata)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !/(?:password|token|cookie|csrf|secret|canonicalJson|requestBody)/i.test(key))
    .map(([key, item]) => [key, safeMetadata(item)]))
}

export class SettingsMySqlStore {
  constructor(
    private readonly pool: Pool,
    private readonly options: { createId?: () => string; now?: () => string } = {},
  ) {}

  private createId = () => this.options.createId?.() ?? randomUUID()
  private now = () => this.options.now?.() ?? new Date().toISOString()

  async getUserSettings(userId: string): Promise<UserSettingsDocument> {
    const [result] = await this.pool.execute<SqlRow[]>('SELECT settings_json, version, updated_at FROM user_settings WHERE user_id=? LIMIT 1', [userId])
    const row = result[0]
    if (!row) return { ...structuredClone(DEFAULT_USER_SETTINGS), version: 1, updatedAt: this.now() }
    const value = mergeSettings(structuredClone(DEFAULT_USER_SETTINGS), parseObject(row.settings_json) as Partial<UserSettings>)
    return { ...value, version: Number(row.version), updatedAt: iso(row.updated_at) }
  }

  async updateUserSettings(userId: string, input: Partial<UserSettings> & { version: number }) {
    const current = await this.getUserSettings(userId)
    if (current.version !== input.version) throw Object.assign(new Error('设置已在其他会话更新，请刷新后重试'), { code: 'SETTINGS_VERSION_CONFLICT', statusCode: 409 })
    const { version: _version, ...changes } = input
    const next = mergeSettings(current, changes)
    const now = this.now()
    const [result] = await this.pool.execute<ResultSetHeader>(`INSERT INTO user_settings (user_id,settings_json,version,created_at,updated_at)
      VALUES (?,?,2,?,?)
      ON DUPLICATE KEY UPDATE settings_json=VALUES(settings_json),version=version+1,updated_at=VALUES(updated_at)`, [
      userId, JSON.stringify(next), toSqlDateTime(now), toSqlDateTime(now),
    ])
    if (!result.affectedRows) throw new Error('SETTINGS_UPDATE_FAILED')
    return this.getUserSettings(userId)
  }

  async updateUserPassword(userId: string, passwordHash: string) {
    await this.pool.execute('UPDATE users SET password_hash=? WHERE id=?', [passwordHash, userId])
  }

  async listUserSessions(userId: string, currentSessionId: string) {
    const [rows] = await this.pool.execute<SqlRow[]>('SELECT id,created_at,expires_at FROM sessions WHERE user_id=? ORDER BY created_at DESC,id ASC', [userId])
    return rows.map((row) => ({ id: String(row.id), current: String(row.id) === currentSessionId, createdAt: iso(row.created_at), expiresAt: iso(row.expires_at) }))
  }

  async revokeUserSession(userId: string, sessionId: string) {
    const [result] = await this.pool.execute<ResultSetHeader>('DELETE FROM sessions WHERE user_id=? AND id=?', [userId, sessionId])
    return result.affectedRows > 0
  }

  async revokeOtherUserSessions(userId: string, currentSessionId: string) {
    await this.pool.execute('DELETE FROM sessions WHERE user_id=? AND id<>?', [userId, currentSessionId])
  }

  async appendSafeAuditEvent(userId: string, input: { action: string; targetType: string; targetId?: string | null; metadata?: Record<string, unknown> }): Promise<SafeAuditEvent> {
    return this.appendSafeAuditEventFrom(this.pool, userId, input)
  }

  async appendSafeAuditEventFrom(executor: Executor, userId: string, input: { action: string; targetType: string; targetId?: string | null; metadata?: Record<string, unknown> }): Promise<SafeAuditEvent> {
    const event: SafeAuditEvent = {
      id: this.createId(), actorId: userId, action: input.action, targetType: input.targetType,
      targetId: input.targetId ?? null, metadata: safeMetadata(input.metadata ?? {}) as Record<string, unknown>, occurredAt: this.now(),
    }
    await executor.execute(`INSERT INTO audit_events
      (id,user_id,action,entity_type,entity_id,request_id,details,occurred_at,created_at)
      VALUES (?,?,?,?,?,NULL,?,?,?)`, [
      event.id, userId, event.action, event.targetType, event.targetId, JSON.stringify(event.metadata),
      toSqlDateTime(event.occurredAt), toSqlDateTime(event.occurredAt),
    ])
    return event
  }

  async persistDataTransferRestorePoint(userId: string, snapshot: DataExportResult): Promise<DataTransferRestorePoint> {
    if (createHash('sha256').update(snapshot.canonicalJson).digest('hex') !== snapshot.checksumSha256) {
      throw new Error('DATA_TRANSFER_RESTORE_CHECKSUM_MISMATCH')
    }
    const restorePoint = { id: this.createId(), checksumSha256: snapshot.checksumSha256, createdAt: this.now() }
    await this.pool.execute(`INSERT INTO data_transfer_restore_points
      (id,user_id,schema_version,checksum_sha256,record_counts_json,canonical_json,created_at)
      VALUES (?,?,?,?,?,?,?)`, [
      restorePoint.id, userId, snapshot.schemaVersion, snapshot.checksumSha256,
      JSON.stringify(snapshot.counts), snapshot.canonicalJson, toSqlDateTime(restorePoint.createdAt),
    ])
    const [rows] = await this.pool.execute<SqlRow[]>(`SELECT checksum_sha256,canonical_json
      FROM data_transfer_restore_points WHERE user_id=? AND id=? LIMIT 1`, [userId, restorePoint.id])
    const saved = rows[0]
    if (!saved || String(saved.checksum_sha256) !== restorePoint.checksumSha256
      || createHash('sha256').update(String(saved.canonical_json)).digest('hex') !== restorePoint.checksumSha256) {
      throw new Error('DATA_TRANSFER_RESTORE_VERIFICATION_FAILED')
    }
    return restorePoint
  }

  async listSafeAuditEvents(userId: string, limit = 100) {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)))
    const [rows] = await this.pool.execute<SqlRow[]>(`SELECT id,user_id,action,entity_type,entity_id,details,occurred_at
      FROM audit_events WHERE user_id=? ORDER BY occurred_at DESC,id ASC LIMIT ${safeLimit}`, [userId])
    return rows.map((row): SafeAuditEvent => ({
      id: String(row.id), actorId: String(row.user_id), action: String(row.action), targetType: String(row.entity_type),
      targetId: row.entity_id == null ? null : String(row.entity_id), metadata: safeMetadata(parseObject(row.details)) as Record<string, unknown>, occurredAt: iso(row.occurred_at),
    }))
  }
}
