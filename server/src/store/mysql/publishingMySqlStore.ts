import { randomUUID } from 'node:crypto'
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import {
  PublishingDomainError,
  assertPublicSlugAvailable,
  createPublicDraftEntity,
  createPublicRevisionEntity,
  diffPublicRevisions,
  schedulePublicDraftEntity,
  updatePublicDraftEntity,
  type CreatePublicDraftInput,
  type PublicDraft,
  type PublicRevision,
  type UpdatePublicDraftInput,
} from '../../domain/publishing.js'
import type { PublicationResult } from '../../services/publicationScheduler.js'
import type { PublishingStore } from '../publishingStore.js'

interface SqlRow extends RowDataPacket { [key: string]: unknown }
type Executor = Pool | PoolConnection

const toSqlDateTime = (value: string) => value.slice(0, 23).replace('T', ' ')
const iso = (value: unknown) => new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z')).toISOString()
const optionalIso = (value: unknown) => value == null ? null : iso(value)
const parseArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value !== 'string') return []
  try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed.map(String) : [] } catch { return [] }
}

export class PublishingMySqlStore implements PublishingStore {
  private readonly createId: () => string
  private readonly now: () => string

  constructor(
    private readonly pool: Pool,
    options: { createId?: () => string; now?: () => string } = {},
  ) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date().toISOString())
  }

  async listPublicDrafts(userId: string) {
    const [rows] = await this.pool.query<SqlRow[]>('SELECT * FROM public_drafts WHERE user_id=? ORDER BY updated_at DESC,id ASC', [userId])
    return rows.map((row) => this.mapDraft(row))
  }

  async getPublicDraft(userId: string, id: string) {
    const rows = await this.queryDrafts(this.pool, 'WHERE user_id=? AND id=? LIMIT 1', [userId, id])
    return rows[0]
  }

  async createPublicDraft(userId: string, input: CreatePublicDraftInput) {
    const existing = await this.listSlugDrafts()
    assertPublicSlugAvailable(input.slug, existing)
    const draft = createPublicDraftEntity(this.createId(), this.now(), input)
    try {
      await this.pool.execute(
        `INSERT INTO public_drafts
         (id,user_id,category,source_type,source_id,source_version,title,excerpt,body,cover_url,tags,slug,scheduled_at,featured,seo_title,seo_description,status,version,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        this.draftValues(userId, draft),
      )
    } catch (error) { this.rethrowSlugConflict(error) }
    return draft
  }

  async updatePublicDraft(userId: string, id: string, input: UpdatePublicDraftInput) {
    const current = await this.getPublicDraft(userId, id)
    if (!current) return undefined
    if (input.slug !== undefined) assertPublicSlugAvailable(input.slug, await this.listSlugDrafts(), id)
    const next = updatePublicDraftEntity(current, this.now(), input)
    try {
      const [result] = await this.pool.execute<ResultSetHeader>(
        `UPDATE public_drafts SET category=?,title=?,excerpt=?,body=?,cover_url=?,tags=?,slug=?,scheduled_at=?,featured=?,seo_title=?,seo_description=?,status=?,version=?,updated_at=?
         WHERE user_id=? AND id=? AND version=?`,
        [...this.mutableDraftValues(next), userId, id, input.version],
      )
      if (!result.affectedRows) throw this.versionConflict()
    } catch (error) { this.rethrowSlugConflict(error) }
    return next
  }

  async deletePublicDraft(userId: string, id: string, version: number) {
    const current = await this.getPublicDraft(userId, id)
    if (!current) return false
    if (current.version !== version) throw this.versionConflict()
    const [revisionRows] = await this.pool.query<SqlRow[]>('SELECT id FROM public_revisions WHERE draft_id=? LIMIT 1', [id])
    if (revisionRows[0]) throw new PublishingDomainError('DRAFT_HAS_REVISIONS', '已有公开 revision 的草稿只能撤回，不能删除', 409)
    const [result] = await this.pool.execute<ResultSetHeader>('DELETE FROM public_drafts WHERE user_id=? AND id=? AND version=?', [userId, id, version])
    if (!result.affectedRows) throw this.versionConflict()
    return true
  }

  async previewPublicDraft(userId: string, id: string) {
    const draft = await this.getPublicDraft(userId, id)
    if (!draft) return undefined
    const revisions = await this.listPublicRevisions(userId, id)
    return createPublicRevisionEntity(`preview-${id}-${draft.version}`, draft, revisions.length + 1, this.now())
  }

  async publishPublicDraft(userId: string, id: string, version: number, publishedAt = this.now()) {
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const draft = (await this.queryDrafts(connection, 'WHERE user_id=? AND id=? LIMIT 1 FOR UPDATE', [userId, id]))[0]
      if (!draft) { await connection.rollback(); return undefined }
      if (draft.version !== version) throw this.versionConflict()
      const result = await this.publishLocked(connection, userId, draft, publishedAt)
      await connection.commit()
      return result
    } catch (error) {
      await connection.rollback()
      throw error
    } finally { connection.release() }
  }

  async schedulePublicDraft(userId: string, id: string, version: number, scheduledAt: string) {
    const current = await this.getPublicDraft(userId, id)
    if (!current) return undefined
    const next = schedulePublicDraftEntity(current, this.now(), scheduledAt, version)
    const [result] = await this.pool.execute<ResultSetHeader>(
      'UPDATE public_drafts SET status=?,scheduled_at=?,version=?,updated_at=? WHERE user_id=? AND id=? AND version=?',
      [next.status, toSqlDateTime(scheduledAt), next.version, toSqlDateTime(next.updatedAt), userId, id, version],
    )
    if (!result.affectedRows) throw this.versionConflict()
    return next
  }

  async revokePublicDraft(userId: string, id: string, version: number) {
    const current = await this.getPublicDraft(userId, id)
    if (!current) return undefined
    if (current.version !== version) throw this.versionConflict()
    const now = this.now()
    const [result] = await this.pool.execute<ResultSetHeader>(
      "UPDATE public_drafts SET status='revoked',scheduled_at=NULL,version=version+1,updated_at=? WHERE user_id=? AND id=? AND version=?",
      [toSqlDateTime(now), userId, id, version],
    )
    if (!result.affectedRows) throw this.versionConflict()
    return { ...current, status: 'revoked' as const, scheduledAt: null, version: version + 1, updatedAt: now }
  }

  async listPublicRevisions(userId: string, draftId: string) {
    const [rows] = await this.pool.query<SqlRow[]>(
      `SELECT r.* FROM public_revisions r JOIN public_drafts d ON d.id=r.draft_id
       WHERE d.user_id=? AND r.draft_id=? ORDER BY r.revision DESC`, [userId, draftId],
    )
    return rows.map((row) => this.mapRevision(row))
  }

  async diffPublicRevisionHistory(userId: string, draftId: string, from: number, to: number) {
    const revisions = await this.listPublicRevisions(userId, draftId)
    const first = revisions.find((item) => item.revision === from)
    const second = revisions.find((item) => item.revision === to)
    return first && second ? diffPublicRevisions(first, second) : undefined
  }

  async listPublishedRevisions() {
    const [rows] = await this.pool.query<SqlRow[]>(this.latestPublishedSql('') + ' ORDER BY r.published_at DESC,r.id DESC')
    return rows.map((row) => this.mapRevision(row))
  }

  async getPublishedRevision(slug: string) {
    const [rows] = await this.pool.query<SqlRow[]>(this.latestPublishedSql('AND r.slug=?') + ' LIMIT 1', [slug])
    return rows[0] ? this.mapRevision(rows[0]) : undefined
  }

  async listDuePublicDraftIds(now: string) {
    const [rows] = await this.pool.query<SqlRow[]>(
      "SELECT id FROM public_drafts WHERE status='scheduled' AND scheduled_at IS NOT NULL AND scheduled_at<=? ORDER BY scheduled_at,id",
      [toSqlDateTime(now)],
    )
    return rows.map((row) => String(row.id))
  }

  async publishDuePublicDraft(id: string, now: string) {
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const draft = (await this.queryDrafts(connection, 'WHERE id=? LIMIT 1 FOR UPDATE', [id]))[0]
      if (!draft || draft.status !== 'scheduled' || !draft.scheduledAt || draft.scheduledAt > now) {
        await connection.rollback()
        return undefined
      }
      const [owner] = await connection.query<SqlRow[]>('SELECT user_id FROM public_drafts WHERE id=? LIMIT 1', [id])
      const result = await this.publishLocked(connection, String(owner[0]!.user_id), draft, now)
      await connection.commit()
      return result
    } catch (error) {
      await connection.rollback()
      throw error
    } finally { connection.release() }
  }

  private async publishLocked(connection: PoolConnection, userId: string, draft: PublicDraft, publishedAt: string): Promise<PublicationResult> {
    const [priorRows] = await connection.query<SqlRow[]>('SELECT * FROM public_revisions WHERE draft_id=? ORDER BY revision DESC', [draft.id])
    const existing = priorRows.find((row) => Number(row.source_version) === draft.version)
    if (existing) {
      const revision = this.mapRevision(existing)
      return { draftId: draft.id, revisionId: revision.id, revision: revision.revision }
    }
    const revision = createPublicRevisionEntity(this.createId(), draft, priorRows.length + 1, publishedAt)
    const [updated] = await connection.execute<ResultSetHeader>(
      "UPDATE public_drafts SET status='published',scheduled_at=NULL,version=version+1,updated_at=? WHERE id=? AND user_id=? AND version=?",
      [toSqlDateTime(publishedAt), draft.id, userId, draft.version],
    )
    if (!updated.affectedRows) throw this.versionConflict()
    await connection.execute(
      `INSERT INTO public_revisions
       (id,draft_id,source_version,revision,category,slug,title,excerpt,body,cover_url,tags,featured,seo_title,seo_description,published_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [revision.id, revision.draftId, revision.sourceVersion, revision.revision, revision.category, revision.slug,
        revision.title, revision.excerpt, revision.body, revision.coverUrl, JSON.stringify(revision.tags), revision.featured,
        revision.seo.title, revision.seo.description, toSqlDateTime(revision.publishedAt), toSqlDateTime(revision.updatedAt)],
    )
    return { draftId: draft.id, revisionId: revision.id, revision: revision.revision }
  }

  private latestPublishedSql(filter: string) {
    return `SELECT r.* FROM public_revisions r
      JOIN public_drafts d ON d.id=r.draft_id
      JOIN (SELECT draft_id,MAX(revision) revision FROM public_revisions GROUP BY draft_id) latest
        ON latest.draft_id=r.draft_id AND latest.revision=r.revision
      WHERE d.status<>'revoked' ${filter}`
  }

  private async queryDrafts(executor: Executor, suffix: string, values: unknown[]) {
    const [rows] = await executor.query<SqlRow[]>(`SELECT * FROM public_drafts ${suffix}`, values)
    return rows.map((row) => this.mapDraft(row))
  }

  private async listSlugDrafts() {
    const [rows] = await this.pool.query<SqlRow[]>('SELECT id,slug FROM public_drafts')
    return rows.map((row) => ({ id: String(row.id), slug: String(row.slug) }))
  }

  private draftValues(userId: string, draft: PublicDraft) {
    return [draft.id, userId, draft.category, draft.source?.type ?? null, draft.source?.id ?? null, draft.source?.version ?? null,
      draft.title, draft.excerpt, draft.body, draft.coverUrl, JSON.stringify(draft.tags), draft.slug,
      draft.scheduledAt ? toSqlDateTime(draft.scheduledAt) : null, draft.featured, draft.seo.title, draft.seo.description,
      draft.status, draft.version, toSqlDateTime(draft.createdAt), toSqlDateTime(draft.updatedAt)]
  }

  private mutableDraftValues(draft: PublicDraft) {
    return [draft.category, draft.title, draft.excerpt, draft.body, draft.coverUrl, JSON.stringify(draft.tags), draft.slug,
      draft.scheduledAt ? toSqlDateTime(draft.scheduledAt) : null, draft.featured, draft.seo.title, draft.seo.description,
      draft.status, draft.version, toSqlDateTime(draft.updatedAt)]
  }

  private mapDraft(row: SqlRow): PublicDraft {
    return {
      id: String(row.id), category: row.category as PublicDraft['category'],
      source: row.source_type == null ? null : { type: row.source_type as NonNullable<PublicDraft['source']>['type'], id: String(row.source_id), version: Number(row.source_version) },
      title: String(row.title), excerpt: String(row.excerpt), body: String(row.body), coverUrl: row.cover_url == null ? null : String(row.cover_url),
      tags: parseArray(row.tags), slug: String(row.slug), scheduledAt: optionalIso(row.scheduled_at), featured: Boolean(row.featured),
      seo: { title: String(row.seo_title), description: String(row.seo_description) }, status: row.status as PublicDraft['status'],
      version: Number(row.version), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    }
  }

  private mapRevision(row: SqlRow): PublicRevision {
    return {
      id: String(row.id), draftId: String(row.draft_id), sourceVersion: Number(row.source_version), revision: Number(row.revision),
      category: row.category as PublicRevision['category'], slug: String(row.slug), title: String(row.title), excerpt: String(row.excerpt), body: String(row.body),
      coverUrl: row.cover_url == null ? null : String(row.cover_url), tags: parseArray(row.tags), featured: Boolean(row.featured),
      seo: { title: String(row.seo_title), description: String(row.seo_description) }, publishedAt: iso(row.published_at), updatedAt: iso(row.updated_at),
    }
  }

  private versionConflict() { return new PublishingDomainError('VERSION_CONFLICT', '发布草稿已更新，请刷新后重试', 409) }

  private rethrowSlugConflict(error: unknown): never {
    if (error instanceof PublishingDomainError) throw error
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY') {
      throw new PublishingDomainError('SLUG_CONFLICT', '公开 slug 已存在', 409)
    }
    throw error
  }
}
