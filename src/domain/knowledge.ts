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
}

export interface KnowledgeCollection {
  id: string
  name: string
  color: string
  position: number
  version: number
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

export interface CreateKnowledgeCollectionInput {
  name: string
  color: string
  position?: number
}

export interface UpdateKnowledgeCollectionInput extends Partial<CreateKnowledgeCollectionInput> {
  version: number
}
