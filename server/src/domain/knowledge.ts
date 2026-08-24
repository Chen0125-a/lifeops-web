export type KnowledgeSourceType = 'record' | 'review' | 'goal' | 'project'

export interface KnowledgeSourceLink {
  type: KnowledgeSourceType
  id: string
}

export interface KnowledgeNote {
  id: string
  title: string
  body: string
  tags: string[]
  collectionIds: string[]
  sourceLinks: KnowledgeSourceLink[]
  relatedIds: string[]
  pinned: boolean
  favorite: boolean
  reviewOn: string | null
  version: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  deletedAt: string | null
  /** Compatibility projection for the pre-P4 state endpoint. */
  source?: { type: 'record' | 'review'; id: string }
}

export interface KnowledgeCollection {
  id: string
  name: string
  color: string
  position: number
  version: number
}

export class KnowledgeDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'KnowledgeDomainError'
  }
}

export interface CreateKnowledgeInput {
  title: string
  body: string
  tags?: string[]
  collectionIds?: string[]
  sourceLinks?: KnowledgeSourceLink[]
  relatedIds?: string[]
  pinned?: boolean
  favorite?: boolean
  reviewOn?: string | null
}

export interface UpdateKnowledgeInput extends Partial<CreateKnowledgeInput> {
  version: number
}

export interface KnowledgeFilters {
  q?: string
  tag?: string
  source?: KnowledgeSourceType
  collectionId?: string
  includeArchived?: boolean
  includeDeleted?: boolean
}

export interface KnowledgeStore {
  listKnowledge(userId: string, filters?: KnowledgeFilters): Promise<{ items: KnowledgeNote[] }>
  getKnowledgeNote(userId: string, id: string, includeDeleted?: boolean): Promise<KnowledgeNote | undefined>
  createKnowledgeNote(userId: string, input: CreateKnowledgeInput): Promise<KnowledgeNote>
  updateKnowledgeNote(userId: string, id: string, input: UpdateKnowledgeInput): Promise<KnowledgeNote | undefined>
  archiveKnowledgeNote(userId: string, id: string, version: number): Promise<KnowledgeNote | undefined>
  deleteKnowledgeNote(userId: string, id: string, version: number): Promise<boolean>
  restoreKnowledgeNote(userId: string, id: string, version: number): Promise<KnowledgeNote | undefined>
  addKnowledgeRelation(userId: string, id: string, relatedId: string, version: number): Promise<KnowledgeNote | undefined>
  removeKnowledgeRelation(userId: string, id: string, relatedId: string, version: number): Promise<KnowledgeNote | undefined>
  listKnowledgeCollections(userId: string): Promise<KnowledgeCollection[]>
  createKnowledgeCollection(userId: string, input: { name: string; color: string; position?: number }): Promise<KnowledgeCollection>
  updateKnowledgeCollection(userId: string, id: string, input: { name?: string; color?: string; position?: number; version: number }): Promise<KnowledgeCollection | undefined>
  deleteKnowledgeCollection(userId: string, id: string, version: number): Promise<boolean>
  resurfaceKnowledge(userId: string, now: string): Promise<KnowledgeNote[]>
}

const sourceTypes = new Set<KnowledgeSourceType>(['record', 'review', 'goal', 'project'])
const dateOnly = /^\d{4}-\d{2}-\d{2}$/

function clean(value: string, field: string, max: number) {
  const result = value.trim()
  if (!result || result.length > max) throw new KnowledgeDomainError('INVALID_INPUT', `${field}无效`, 400)
  return result
}

function list(values: string[] | undefined, field: string, maxItems = 100) {
  const result = [...new Set((values ?? []).map((value) => clean(value, field, 120)))]
  if (result.length > maxItems) throw new KnowledgeDomainError('INVALID_INPUT', `${field}过多`, 400)
  return result
}

function reviewDate(value: string | null | undefined) {
  if (value == null || value === '') return null
  if (!dateOnly.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) {
    throw new KnowledgeDomainError('INVALID_INPUT', '复习日期无效', 400)
  }
  return value
}

export function validateKnowledgeSourceLinks(links: KnowledgeSourceLink[]): KnowledgeSourceLink[] {
  if (!Array.isArray(links) || links.length > 40) throw new KnowledgeDomainError('INVALID_INPUT', '知识来源无效', 400)
  const seen = new Set<string>()
  return links.map((link) => {
    const type = link?.type
    const id = typeof link?.id === 'string' ? link.id.trim() : ''
    const key = `${type}:${id}`
    if (!sourceTypes.has(type) || !id || id.length > 80 || seen.has(key)) {
      throw new KnowledgeDomainError('INVALID_INPUT', '知识来源必须是唯一且有效的事实链接', 400)
    }
    seen.add(key)
    return { type, id }
  })
}

export function assertKnowledgeVersion(current: number, expected: number) {
  if (!Number.isSafeInteger(expected) || expected < 1 || current !== expected) {
    throw new KnowledgeDomainError('VERSION_CONFLICT', '知识已被更新，请刷新后重试', 409)
  }
}

export function createKnowledgeNoteEntity(id: string, now: string, input: CreateKnowledgeInput): KnowledgeNote {
  const sourceLinks = validateKnowledgeSourceLinks(input.sourceLinks ?? [])
  const legacy = sourceLinks.find((link): link is KnowledgeSourceLink & { type: 'record' | 'review' } => (
    link.type === 'record' || link.type === 'review'
  ))
  return {
    id,
    title: clean(input.title, '知识标题', 240),
    body: clean(input.body, '知识内容', 100_000),
    tags: list(input.tags, '标签', 50),
    collectionIds: list(input.collectionIds, '集合', 50),
    sourceLinks,
    relatedIds: list(input.relatedIds, '关联知识', 100).filter((relatedId) => relatedId !== id),
    pinned: input.pinned ?? false,
    favorite: input.favorite ?? false,
    reviewOn: reviewDate(input.reviewOn),
    version: 1,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
    ...(legacy ? { source: { type: legacy.type, id: legacy.id } } : {}),
  }
}

export function updateKnowledgeNoteEntity(current: KnowledgeNote, now: string, input: UpdateKnowledgeInput): KnowledgeNote {
  assertKnowledgeVersion(current.version, input.version)
  const sourceLinks = input.sourceLinks === undefined
    ? current.sourceLinks.map((link) => ({ ...link }))
    : validateKnowledgeSourceLinks(input.sourceLinks)
  const legacy = sourceLinks.find((link): link is KnowledgeSourceLink & { type: 'record' | 'review' } => (
    link.type === 'record' || link.type === 'review'
  ))
  return {
    ...current,
    title: input.title === undefined ? current.title : clean(input.title, '知识标题', 240),
    body: input.body === undefined ? current.body : clean(input.body, '知识内容', 100_000),
    tags: input.tags === undefined ? [...current.tags] : list(input.tags, '标签', 50),
    collectionIds: input.collectionIds === undefined ? [...current.collectionIds] : list(input.collectionIds, '集合', 50),
    sourceLinks,
    relatedIds: input.relatedIds === undefined ? [...current.relatedIds] : list(input.relatedIds, '关联知识', 100).filter((id) => id !== current.id),
    pinned: input.pinned ?? current.pinned,
    favorite: input.favorite ?? current.favorite,
    reviewOn: input.reviewOn === undefined ? current.reviewOn : reviewDate(input.reviewOn),
    version: current.version + 1,
    updatedAt: now,
    source: legacy ? { type: legacy.type, id: legacy.id } : undefined,
  }
}

export function createKnowledgeCollectionEntity(id: string, input: { name: string; color: string; position?: number }): KnowledgeCollection {
  const position = input.position ?? 0
  if (!Number.isSafeInteger(position) || position < 0) throw new KnowledgeDomainError('INVALID_INPUT', '集合顺序无效', 400)
  return { id, name: clean(input.name, '集合名称', 120), color: clean(input.color, '集合颜色', 32), position, version: 1 }
}

export function updateKnowledgeCollectionEntity(current: KnowledgeCollection, input: { name?: string; color?: string; position?: number; version: number }): KnowledgeCollection {
  assertKnowledgeVersion(current.version, input.version)
  const position = input.position ?? current.position
  if (!Number.isSafeInteger(position) || position < 0) throw new KnowledgeDomainError('INVALID_INPUT', '集合顺序无效', 400)
  return {
    ...current,
    name: input.name === undefined ? current.name : clean(input.name, '集合名称', 120),
    color: input.color === undefined ? current.color : clean(input.color, '集合颜色', 32),
    position,
    version: current.version + 1,
  }
}

export function rankResurfacedKnowledge(notes: KnowledgeNote[], now: string): KnowledgeNote[] {
  const today = now.slice(0, 10)
  return notes.filter((note) => note.archivedAt == null && note.deletedAt == null)
    .map((note) => ({ note, band: note.reviewOn && note.reviewOn <= today ? 2 : note.pinned ? 1 : 0 }))
    .sort((left, right) => (
      right.band - left.band
      || Number(right.note.pinned) - Number(left.note.pinned)
      || (left.band === 2 ? (left.note.reviewOn ?? '').localeCompare(right.note.reviewOn ?? '') : 0)
      || right.note.updatedAt.localeCompare(left.note.updatedAt)
      || left.note.id.localeCompare(right.note.id)
    ))
    .map(({ note }) => ({ ...note }))
}

export function walkRelatedKnowledge(notes: KnowledgeNote[], startId: string): KnowledgeNote[] {
  const byId = new Map(notes.map((note) => [note.id, note]))
  const queue = [startId]
  const seen = new Set<string>()
  const result: KnowledgeNote[] = []
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    const note = byId.get(id)
    if (!note) continue
    result.push({ ...note })
    queue.push(...note.relatedIds.filter((relatedId) => !seen.has(relatedId)))
  }
  return result
}
