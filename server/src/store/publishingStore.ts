import type {
  CreatePublicDraftInput,
  PublicDraft,
  PublicRevision,
  PublicRevisionDiff,
  UpdatePublicDraftInput,
} from '../domain/publishing.js'
import type { PublicationResult } from '../services/publicationScheduler.js'

export interface PublishingStore {
  listPublicDrafts(userId: string): Promise<PublicDraft[]>
  getPublicDraft(userId: string, id: string): Promise<PublicDraft | undefined>
  createPublicDraft(userId: string, input: CreatePublicDraftInput): Promise<PublicDraft>
  updatePublicDraft(userId: string, id: string, input: UpdatePublicDraftInput): Promise<PublicDraft | undefined>
  deletePublicDraft(userId: string, id: string, version: number): Promise<boolean>
  previewPublicDraft(userId: string, id: string): Promise<PublicRevision | undefined>
  publishPublicDraft(userId: string, id: string, version: number, publishedAt?: string): Promise<PublicationResult | undefined>
  schedulePublicDraft(userId: string, id: string, version: number, scheduledAt: string): Promise<PublicDraft | undefined>
  revokePublicDraft(userId: string, id: string, version: number): Promise<PublicDraft | undefined>
  listPublicRevisions(userId: string, draftId: string): Promise<PublicRevision[]>
  diffPublicRevisionHistory(userId: string, draftId: string, from: number, to: number): Promise<PublicRevisionDiff | undefined>
  listPublishedRevisions(): Promise<PublicRevision[]>
  getPublishedRevision(slug: string): Promise<PublicRevision | undefined>
  listDuePublicDraftIds(now: string): Promise<string[]>
  publishDuePublicDraft(id: string, now: string): Promise<PublicationResult | undefined>
}
