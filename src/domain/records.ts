export type RecordLinkType = 'goal' | 'project' | 'task' | 'habit'
export type UploadStatus = 'queued' | 'uploading' | 'stored' | 'failed'

export interface RecordLink {
  type: RecordLinkType
  id: string
}

export interface LifeRecord {
  id: string
  planId?: string
  title: string
  body: string
  occurredAt: string
  tags: string[]
  pinned: boolean
  archivedAt: string | null
  links: RecordLink[]
  mediaIds: string[]
  coverMediaId: string | null
  version: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface MediaAsset {
  id: string
  visibility: 'private' | 'public'
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
  originalName: string
  sizeBytes: number
  checksum: string
  width: number | null
  height: number | null
  version: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
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

export interface UpdateRecordInput extends Partial<CreateRecordInput> {
  archived?: boolean
  version: number
}
