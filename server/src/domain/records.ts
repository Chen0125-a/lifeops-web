import type { LifeRecord, MediaAsset, RecordLink, RecordLinkType } from './types.js'

export interface CreateRecordInput {
  planId?: string
  title: string
  body: string
  occurredAt?: string
  tags?: string[]
  pinned?: boolean
  links?: RecordLink[]
  mediaIds?: string[]
  coverMediaId?: string | null
}

export interface UpdateRecordInput {
  title?: string
  body?: string
  occurredAt?: string
  tags?: string[]
  pinned?: boolean
  archived?: boolean
  links?: RecordLink[]
  mediaIds?: string[]
  coverMediaId?: string | null
  version: number
}

export interface RecordFilters {
  from?: string
  to?: string
  tag?: string
  linkType?: RecordLinkType
  linkId?: string
  q?: string
  includeArchived?: boolean
}

export interface CreateMediaAssetInput {
  originalName: string
  mimeType: MediaAsset['mimeType']
  sizeBytes: number
  storageKey: string
  checksum: string
  width?: number | null
  height?: number | null
}

export interface RecordsStore {
  listRecords(userId: string, filters?: RecordFilters): Promise<LifeRecord[]>
  getRecord(userId: string, id: string): Promise<LifeRecord | undefined>
  createRecord(userId: string, input: CreateRecordInput, idempotencyKey?: string): Promise<LifeRecord>
  updateRecord(userId: string, id: string, input: UpdateRecordInput): Promise<LifeRecord | undefined>
  deleteRecord(userId: string, id: string, version: number): Promise<boolean>
  restoreRecord(userId: string, id: string, version: number): Promise<LifeRecord | undefined>
  createMediaAsset(userId: string, input: CreateMediaAssetInput, idempotencyKey: string): Promise<MediaAsset>
  getMediaAsset(userId: string, id: string): Promise<MediaAsset | undefined>
  getPublicMediaAsset(id: string): Promise<MediaAsset | undefined>
}

export type RecordsDomainErrorCode = 'INVALID_INPUT' | 'VERSION_CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'NOT_FOUND'

export class RecordsDomainError extends Error {
  constructor(readonly code: RecordsDomainErrorCode, message: string, readonly status: number) {
    super(message)
    this.name = 'RecordsDomainError'
  }
}

function invalid(message: string): never {
  throw new RecordsDomainError('INVALID_INPUT', message, 400)
}

function clean(value: string, field: string, maxLength: number) {
  const result = value.trim()
  if (!result) invalid(`${field}不能为空`)
  if (result.length > maxLength) invalid(`${field}过长`)
  return result
}

function instant(value: string, field: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) invalid(`${field}无效`)
  return parsed.toISOString()
}

function normalizeTags(tags: string[] | undefined) {
  const result = [...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))]
  if (result.length > 50 || result.some((tag) => tag.length > 80)) invalid('标签无效')
  return result
}

function normalizeIds(ids: string[] | undefined) {
  const result = [...new Set(ids ?? [])]
  if (result.length > 50 || result.some((id) => !id.trim() || id.length > 80)) invalid('媒体引用无效')
  return result
}

function normalizeCoverMediaId(coverMediaId: string | null | undefined, mediaIds: string[]) {
  if (coverMediaId == null) return null
  const normalized = coverMediaId.trim()
  if (!normalized || normalized.length > 80 || !mediaIds.includes(normalized)) {
    invalid('封面必须是当前记录已附着的图片')
  }
  return normalized
}

export function normalizeRecordLinks(links: RecordLink[] | undefined) {
  const seen = new Set<string>()
  const result: RecordLink[] = []
  for (const link of links ?? []) {
    if (!['goal', 'project', 'task', 'habit'].includes(link.type) || !link.id.trim() || link.id.length > 80) invalid('记录关联无效')
    const key = `${link.type}:${link.id}`
    if (!seen.has(key)) result.push({ type: link.type, id: link.id })
    seen.add(key)
  }
  if (result.length > 50) invalid('记录关联过多')
  return result
}

export function normalizeRecordIdempotencyKey(value: string) {
  const result = value.trim()
  if (!result || result.length > 190) invalid('幂等键无效')
  return result
}

export function assertRecordVersion(actual: number, expected: number) {
  if (!Number.isInteger(expected) || expected < 1 || actual !== expected) {
    throw new RecordsDomainError('VERSION_CONFLICT', '记录已被更新，请刷新后重试', 409)
  }
}

export function createRecordEntity(id: string, now: string, input: CreateRecordInput): LifeRecord {
  const mediaIds = normalizeIds(input.mediaIds)
  return {
    id,
    ...(input.planId ? { planId: clean(input.planId, '计划 ID', 80) } : {}),
    title: clean(input.title, '记录标题', 240),
    body: clean(input.body, '记录正文', 200_000),
    occurredAt: input.occurredAt ? instant(input.occurredAt, '发生时间') : now,
    tags: normalizeTags(input.tags),
    pinned: input.pinned ?? false,
    archivedAt: null,
    links: normalizeRecordLinks(input.links),
    mediaIds,
    coverMediaId: normalizeCoverMediaId(input.coverMediaId, mediaIds),
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
}

export function updateRecordEntity(current: LifeRecord, now: string, input: UpdateRecordInput): LifeRecord {
  assertRecordVersion(current.version, input.version)
  const mediaIds = input.mediaIds === undefined ? current.mediaIds : normalizeIds(input.mediaIds)
  const coverMediaId = input.coverMediaId === undefined
    ? normalizeCoverMediaId(current.coverMediaId, mediaIds)
    : normalizeCoverMediaId(input.coverMediaId, mediaIds)
  return {
    ...current,
    title: input.title === undefined ? current.title : clean(input.title, '记录标题', 240),
    body: input.body === undefined ? current.body : clean(input.body, '记录正文', 200_000),
    occurredAt: input.occurredAt === undefined ? current.occurredAt : instant(input.occurredAt, '发生时间'),
    tags: input.tags === undefined ? current.tags : normalizeTags(input.tags),
    pinned: input.pinned ?? current.pinned,
    archivedAt: input.archived === undefined ? current.archivedAt : input.archived ? now : null,
    links: input.links === undefined ? current.links : normalizeRecordLinks(input.links),
    mediaIds,
    coverMediaId,
    version: current.version + 1,
    updatedAt: now,
  }
}

export function createMediaAssetEntity(id: string, now: string, input: CreateMediaAssetInput): MediaAsset {
  if (!input.originalName.trim() || input.originalName.length > 500) invalid('文件名无效')
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 0) invalid('文件大小无效')
  return {
    id,
    visibility: 'private',
    mimeType: input.mimeType,
    originalName: input.originalName,
    sizeBytes: input.sizeBytes,
    storageKey: input.storageKey,
    checksum: input.checksum,
    width: input.width ?? null,
    height: input.height ?? null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
}
