export type PublicCategory = 'now' | 'doing' | 'learning' | 'moments' | 'archive'
export type PublicDraftStatus = 'draft' | 'scheduled' | 'published' | 'revoked'
export type PublicSourceType = 'plan' | 'record' | 'review' | 'knowledge'

export interface PublicSourceReference { type: PublicSourceType; id: string }
export interface PublicSourceCopy extends PublicSourceReference { version: number }
export interface PublicSeo { title: string; description: string }

export interface PublicDraft {
  id: string
  category: PublicCategory
  source: PublicSourceCopy | null
  title: string
  excerpt: string
  body: string
  coverUrl: string | null
  tags: string[]
  slug: string
  scheduledAt: string | null
  featured: boolean
  seo: PublicSeo
  status: PublicDraftStatus
  version: number
  createdAt: string
  updatedAt: string
}

export interface PublicRevision {
  id: string
  draftId: string
  sourceVersion: number
  revision: number
  category: PublicCategory
  slug: string
  title: string
  excerpt: string
  body: string
  coverUrl: string | null
  tags: string[]
  featured: boolean
  seo: PublicSeo
  publishedAt: string
  updatedAt: string
}

type PublicDraftInputFields = Omit<PublicDraft, 'id' | 'source' | 'scheduledAt' | 'status' | 'version' | 'createdAt' | 'updatedAt'>
export type CreatePublicDraftInput =
  | (PublicDraftInputFields & { source?: null })
  | (Pick<PublicDraftInputFields, 'category' | 'slug'> & Partial<Omit<PublicDraftInputFields, 'category' | 'slug'>> & { source: PublicSourceReference })
export type UpdatePublicDraftInput = Partial<Omit<CreatePublicDraftInput, 'source'>> & { version: number }
export interface PublicationResult { draftId: string; revisionId: string; revision: number }
export interface PublicRevisionDiff { from: number; to: number; changed: Array<{ field: string; before: unknown; after: unknown }> }

export type PublicRevisionView = Pick<PublicRevision,
  'body' | 'category' | 'coverUrl' | 'excerpt' | 'featured' | 'publishedAt' | 'revision' | 'slug' | 'tags' | 'title' | 'updatedAt'>
