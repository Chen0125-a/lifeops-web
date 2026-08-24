import type { Pool, RowDataPacket } from 'mysql2/promise'
import { parseSearchTypes, searchDocuments, type SearchDocument, type SearchInput, type SearchStore } from '../../domain/search.js'

interface SearchRow extends RowDataPacket {
  user_id: string
  document_type: string
  source_id: string
  title: string
  body_text: string
  tags_text: string
  source_text: string
  updated_at: string | Date
  deleted_at: string | Date | null
}

const iso = (value: string | Date) => value instanceof Date
  ? value.toISOString()
  : `${value.replace(' ', 'T')}${value.includes('Z') ? '' : 'Z'}`
const escapeLike = (value: string) => value.replace(/=/gu, '==').replace(/%/gu, '=%').replace(/_/gu, '=_')

export class SearchMySqlStore implements SearchStore {
  constructor(private readonly pool: Pool) {}

  async search(userId: string, input: SearchInput) {
    const types = input.types ? parseSearchTypes(input.types) : undefined
    const normalized = input.query.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')
    if (!normalized) return []
    const pattern = `%${escapeLike(normalized)}%`
    const typeClause = types?.length ? ` AND document_type IN (${types.map(() => '?').join(',')})` : ''
    const values: unknown[] = [userId, pattern, pattern, pattern, pattern, ...(types ?? []), normalized, pattern, pattern]
    const [rows] = await this.pool.execute<SearchRow[]>(
      `SELECT user_id,document_type,source_id,title,body_text,tags_text,source_text,updated_at,deleted_at
       FROM search_documents
       WHERE user_id=? AND deleted_at IS NULL
         AND (LOWER(title) LIKE ? ESCAPE '=' OR LOWER(body_text) LIKE ? ESCAPE '=' OR LOWER(tags_text) LIKE ? ESCAPE '=' OR LOWER(source_text) LIKE ? ESCAPE '=')
         ${typeClause}
       ORDER BY CASE WHEN LOWER(title)=? THEN 4 WHEN LOWER(title) LIKE ? ESCAPE '=' THEN 3 WHEN LOWER(tags_text) LIKE ? ESCAPE '=' THEN 2 ELSE 1 END DESC,
         updated_at DESC,source_id ASC
       LIMIT 50`,
      values as never[],
    )
    const documents: SearchDocument[] = rows.map((row) => ({
      userId: String(row.user_id), type: parseSearchTypes([String(row.document_type)])[0]!, sourceId: String(row.source_id),
      title: String(row.title), bodyText: String(row.body_text), tagsText: String(row.tags_text), sourceText: String(row.source_text),
      updatedAt: iso(row.updated_at), deletedAt: row.deleted_at == null ? null : iso(row.deleted_at),
    }))
    return searchDocuments(documents, { ...input, userId })
  }
}
