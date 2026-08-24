import { randomUUID } from 'node:crypto'
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import {
  KnowledgeDomainError,
  assertKnowledgeVersion,
  createKnowledgeCollectionEntity,
  createKnowledgeNoteEntity,
  rankResurfacedKnowledge,
  updateKnowledgeCollectionEntity,
  updateKnowledgeNoteEntity,
  type CreateKnowledgeInput,
  type KnowledgeCollection,
  type KnowledgeFilters,
  type KnowledgeNote,
  type KnowledgeStore,
  type UpdateKnowledgeInput,
} from '../../domain/knowledge.js'

interface SqlRow extends RowDataPacket { [key: string]: unknown }

const toSqlDateTime = (value: string) => value.slice(0, 23).replace('T', ' ')
const iso = (value: unknown) => new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z')).toISOString()
const optionalIso = (value: unknown) => value == null ? null : iso(value)
const parseArray = <T = string>(value: unknown): T[] => {
  if (Array.isArray(value)) return value as T[]
  if (typeof value !== 'string') return []
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed as T[] : [] } catch { return [] }
}

export class KnowledgeMySqlStore implements KnowledgeStore {
  private readonly createId: () => string
  private readonly now: () => string

  constructor(
    private readonly pool: Pool,
    options: { createId?: () => string; now?: () => string } = {},
  ) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date().toISOString())
  }

  async listKnowledge(userId: string, filters: KnowledgeFilters = {}) {
    const [rows] = await this.pool.query<SqlRow[]>('SELECT * FROM knowledge_notes WHERE user_id=? ORDER BY updated_at DESC,id ASC', [userId])
    const query = filters.q?.trim().toLocaleLowerCase('zh-CN') ?? ''
    const items = rows.map((row) => this.mapNote(row))
      .filter((note) => filters.includeDeleted || note.deletedAt == null)
      .filter((note) => filters.includeArchived || note.archivedAt == null)
      .filter((note) => !filters.tag || note.tags.includes(filters.tag))
      .filter((note) => !filters.source || note.sourceLinks.some((link) => link.type === filters.source))
      .filter((note) => !filters.collectionId || note.collectionIds.includes(filters.collectionId))
      .filter((note) => !query || `${note.title} ${note.body} ${note.tags.join(' ')}`.toLocaleLowerCase('zh-CN').includes(query))
    return { items }
  }

  async getKnowledgeNote(userId: string, id: string, includeDeleted = false) {
    const [rows] = await this.pool.query<SqlRow[]>('SELECT * FROM knowledge_notes WHERE user_id=? AND id=? LIMIT 1', [userId, id])
    const note = rows[0] ? this.mapNote(rows[0]) : undefined
    return note && (includeDeleted || note.deletedAt == null) ? note : undefined
  }

  async createKnowledgeNote(userId: string, input: CreateKnowledgeInput) {
    await this.validateInput(userId, input)
    const note = createKnowledgeNoteEntity(this.createId(), this.now(), input)
    await this.pool.execute(
      `INSERT INTO knowledge_notes
       (id,user_id,source_type,source_id,title,body,tags,collection_ids,source_links,related_ids,pinned,favorite,review_on,version,created_at,updated_at,archived_at,deleted_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      this.noteValues(userId, note),
    )
    return note
  }

  async updateKnowledgeNote(userId: string, id: string, input: UpdateKnowledgeInput) {
    const current = await this.getKnowledgeNote(userId, id)
    if (!current) return undefined
    await this.validateInput(userId, input, id)
    const next = updateKnowledgeNoteEntity(current, this.now(), input)
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE knowledge_notes SET source_type=?,source_id=?,title=?,body=?,tags=?,collection_ids=?,source_links=?,related_ids=?,pinned=?,favorite=?,review_on=?,version=?,updated_at=?,archived_at=?,deleted_at=?
       WHERE user_id=? AND id=? AND version=?`,
      [...this.noteUpdateValues(next), userId, id, input.version],
    )
    if (!result.affectedRows) throw new KnowledgeDomainError('VERSION_CONFLICT', '知识已被更新，请刷新后重试', 409)
    return next
  }

  async archiveKnowledgeNote(userId: string, id: string, version: number) {
    const current = await this.getKnowledgeNote(userId, id)
    if (!current) return undefined
    assertKnowledgeVersion(current.version, version)
    const now = this.now()
    const archivedAt = current.archivedAt ? null : now
    const [result] = await this.pool.execute<ResultSetHeader>(
      'UPDATE knowledge_notes SET archived_at=?,updated_at=?,version=version+1 WHERE user_id=? AND id=? AND version=? AND deleted_at IS NULL',
      [archivedAt ? toSqlDateTime(archivedAt) : null, toSqlDateTime(now), userId, id, version],
    )
    if (!result.affectedRows) throw new KnowledgeDomainError('VERSION_CONFLICT', '知识已被更新，请刷新后重试', 409)
    return { ...current, archivedAt, updatedAt: now, version: version + 1 }
  }

  async deleteKnowledgeNote(userId: string, id: string, version: number) {
    const now = this.now()
    const [result] = await this.pool.execute<ResultSetHeader>(
      'UPDATE knowledge_notes SET deleted_at=?,updated_at=?,version=version+1 WHERE user_id=? AND id=? AND version=? AND deleted_at IS NULL',
      [toSqlDateTime(now), toSqlDateTime(now), userId, id, version],
    )
    if (!result.affectedRows) {
      if (!await this.getKnowledgeNote(userId, id, true)) return false
      throw new KnowledgeDomainError('VERSION_CONFLICT', '知识已被更新，请刷新后重试', 409)
    }
    return true
  }

  async restoreKnowledgeNote(userId: string, id: string, version: number) {
    const current = await this.getKnowledgeNote(userId, id, true)
    if (!current?.deletedAt) return undefined
    assertKnowledgeVersion(current.version, version)
    const now = this.now()
    const [result] = await this.pool.execute<ResultSetHeader>(
      'UPDATE knowledge_notes SET deleted_at=NULL,archived_at=NULL,updated_at=?,version=version+1 WHERE user_id=? AND id=? AND version=? AND deleted_at IS NOT NULL',
      [toSqlDateTime(now), userId, id, version],
    )
    if (!result.affectedRows) throw new KnowledgeDomainError('VERSION_CONFLICT', '知识已被更新，请刷新后重试', 409)
    return { ...current, deletedAt: null, archivedAt: null, updatedAt: now, version: version + 1 }
  }

  async addKnowledgeRelation(userId: string, id: string, relatedId: string, version: number) {
    return this.changeRelation(userId, id, relatedId, version, true)
  }

  async removeKnowledgeRelation(userId: string, id: string, relatedId: string, version: number) {
    return this.changeRelation(userId, id, relatedId, version, false)
  }

  async listKnowledgeCollections(userId: string) {
    const [rows] = await this.pool.query<SqlRow[]>('SELECT * FROM knowledge_collections WHERE user_id=? ORDER BY position,id', [userId])
    return rows.map((row) => this.mapCollection(row))
  }

  async createKnowledgeCollection(userId: string, input: { name: string; color: string; position?: number }) {
    const collection = createKnowledgeCollectionEntity(this.createId(), input)
    await this.pool.execute('INSERT INTO knowledge_collections (id,user_id,name,color,position,version) VALUES (?,?,?,?,?,?)', [collection.id, userId, collection.name, collection.color, collection.position, collection.version])
    return collection
  }

  async updateKnowledgeCollection(userId: string, id: string, input: { name?: string; color?: string; position?: number; version: number }) {
    const [rows] = await this.pool.query<SqlRow[]>('SELECT * FROM knowledge_collections WHERE user_id=? AND id=? LIMIT 1', [userId, id])
    if (!rows[0]) return undefined
    const next = updateKnowledgeCollectionEntity(this.mapCollection(rows[0]), input)
    const [result] = await this.pool.execute<ResultSetHeader>('UPDATE knowledge_collections SET name=?,color=?,position=?,version=? WHERE user_id=? AND id=? AND version=?', [next.name, next.color, next.position, next.version, userId, id, input.version])
    if (!result.affectedRows) throw new KnowledgeDomainError('VERSION_CONFLICT', '知识集合已被更新', 409)
    return next
  }

  async deleteKnowledgeCollection(userId: string, id: string, version: number) {
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const [result] = await connection.execute<ResultSetHeader>('DELETE FROM knowledge_collections WHERE user_id=? AND id=? AND version=?', [userId, id, version])
      if (!result.affectedRows) {
        const [exists] = await connection.query<SqlRow[]>('SELECT id FROM knowledge_collections WHERE user_id=? AND id=?', [userId, id])
        if (exists[0]) throw new KnowledgeDomainError('VERSION_CONFLICT', '知识集合已被更新', 409)
        await connection.rollback()
        return false
      }
      const [notes] = await connection.query<SqlRow[]>('SELECT id,collection_ids FROM knowledge_notes WHERE user_id=? FOR UPDATE', [userId])
      for (const row of notes) {
        const ids = parseArray<string>(row.collection_ids).filter((value) => value !== id)
        await connection.execute('UPDATE knowledge_notes SET collection_ids=? WHERE user_id=? AND id=?', [JSON.stringify(ids), userId, String(row.id)])
      }
      await connection.commit()
      return true
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  async resurfaceKnowledge(userId: string, now: string) {
    const { items } = await this.listKnowledge(userId)
    return rankResurfacedKnowledge(items, now)
  }

  private async changeRelation(userId: string, id: string, relatedId: string, version: number, add: boolean) {
    const [current, related] = await Promise.all([
      this.getKnowledgeNote(userId, id),
      this.getKnowledgeNote(userId, relatedId),
    ])
    if (!current) return undefined
    if (!related || id === relatedId) throw new KnowledgeDomainError('NOT_FOUND', '找不到关联知识', 404)
    const ids = new Set(current.relatedIds)
    if (add) ids.add(relatedId)
    else ids.delete(relatedId)
    return this.updateKnowledgeNote(userId, id, { relatedIds: [...ids], version })
  }

  private async validateInput(userId: string, input: Partial<CreateKnowledgeInput>, currentId?: string) {
    for (const collectionId of input.collectionIds ?? []) {
      const [rows] = await this.pool.query<SqlRow[]>('SELECT id FROM knowledge_collections WHERE user_id=? AND id=? LIMIT 1', [userId, collectionId])
      if (!rows[0]) throw new KnowledgeDomainError('NOT_FOUND', '找不到知识集合', 404)
    }
    for (const relatedId of input.relatedIds ?? []) {
      if (relatedId === currentId || !await this.getKnowledgeNote(userId, relatedId)) throw new KnowledgeDomainError('NOT_FOUND', '找不到关联知识', 404)
    }
    const tableByType = { record: 'life_records', review: 'period_reviews', goal: 'goals', project: 'projects' } as const
    for (const source of input.sourceLinks ?? []) {
      const table = tableByType[source.type]
      if (!table) throw new KnowledgeDomainError('INVALID_INPUT', '知识来源无效', 400)
      const [rows] = await this.pool.query<SqlRow[]>(`SELECT id FROM ${table} WHERE user_id=? AND id=? LIMIT 1`, [userId, source.id])
      if (!rows[0]) throw new KnowledgeDomainError('NOT_FOUND', '找不到知识来源', 404)
    }
  }

  private noteValues(userId: string, note: KnowledgeNote) {
    return [
      note.id, userId, note.source?.type ?? null, note.source?.id ?? null, note.title, note.body,
      JSON.stringify(note.tags), JSON.stringify(note.collectionIds), JSON.stringify(note.sourceLinks), JSON.stringify(note.relatedIds),
      note.pinned, note.favorite, note.reviewOn, note.version, toSqlDateTime(note.createdAt), toSqlDateTime(note.updatedAt),
      note.archivedAt ? toSqlDateTime(note.archivedAt) : null, note.deletedAt ? toSqlDateTime(note.deletedAt) : null,
    ]
  }

  private noteUpdateValues(note: KnowledgeNote) {
    return [
      note.source?.type ?? null, note.source?.id ?? null, note.title, note.body,
      JSON.stringify(note.tags), JSON.stringify(note.collectionIds), JSON.stringify(note.sourceLinks), JSON.stringify(note.relatedIds),
      note.pinned, note.favorite, note.reviewOn, note.version, toSqlDateTime(note.updatedAt),
      note.archivedAt ? toSqlDateTime(note.archivedAt) : null, note.deletedAt ? toSqlDateTime(note.deletedAt) : null,
    ]
  }

  private mapNote(row: SqlRow): KnowledgeNote {
    const sourceLinks = parseArray<KnowledgeNote['sourceLinks'][number]>(row.source_links)
    const legacy = sourceLinks.find((link) => link.type === 'record' || link.type === 'review')
    return {
      id: String(row.id), title: String(row.title), body: String(row.body), tags: parseArray(row.tags),
      collectionIds: parseArray(row.collection_ids), sourceLinks, relatedIds: parseArray(row.related_ids),
      pinned: Boolean(row.pinned), favorite: Boolean(row.favorite), reviewOn: row.review_on == null ? null : String(row.review_on).slice(0, 10),
      version: Number(row.version), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
      archivedAt: optionalIso(row.archived_at), deletedAt: optionalIso(row.deleted_at),
      ...(legacy ? { source: { type: legacy.type as 'record' | 'review', id: legacy.id } } : {}),
    }
  }

  private mapCollection(row: SqlRow): KnowledgeCollection {
    return { id: String(row.id), name: String(row.name), color: String(row.color), position: Number(row.position), version: Number(row.version) }
  }
}
