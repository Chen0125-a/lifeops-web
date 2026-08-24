export type PlanStatus = 'planned' | 'done' | 'skipped'
export type SourceType = 'plan' | 'record' | 'review' | 'knowledge'

export interface User {
  id: string
  account: string
  displayName: string
  passwordHash: string
  createdAt: string
}

export interface Session {
  id: string
  userId: string
  tokenHash: string
  csrfToken: string
  expiresAt: string
  createdAt: string
}

export type SettingsTheme = 'system' | 'light' | 'dark'
export type SettingsMotion = 'system' | 'reduce' | 'full'

export interface UserSettings {
  appearance: { theme: SettingsTheme; motion: SettingsMotion }
  locale: { locale: string; timezone: string; weekStartsOn: 0 | 1 | 6 }
  defaults: { startRoute: string; quickCreateType: string }
  life: { lowStockDays: number; expiryWarningDays: number; remindersEnabled: boolean }
  publicSite: { defaultVisibility: 'private' | 'public'; rssEnabled: boolean }
}

export interface UserSettingsDocument extends UserSettings {
  version: number
  updatedAt: string
}

export interface AccountSession {
  id: string
  current: boolean
  createdAt: string
  expiresAt: string
}

export interface SafeAuditEvent {
  id: string
  actorId: string
  action: string
  targetType: string
  targetId: string | null
  metadata: Record<string, unknown>
  occurredAt: string
}

export interface PlanItem {
  id: string
  title: string
  scheduledFor?: string
  status: PlanStatus
  createdAt: string
  updatedAt: string
  completedAt?: string
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

export type RecordLinkType = 'goal' | 'project' | 'task' | 'habit'

export interface RecordLink {
  type: RecordLinkType
  id: string
}

export interface MediaAsset {
  id: string
  visibility: 'private' | 'public'
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
  originalName: string
  sizeBytes: number
  storageKey: string
  checksum: string
  width: number | null
  height: number | null
  version: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface ReviewEvidence {
  type: 'plan' | 'record'
  sourceId: string
  title: string
  excerpt: string
}

export interface PeriodReview {
  id: string
  periodStart: string
  periodEnd: string
  summary: string
  insights: string[]
  evidence: ReviewEvidence[]
  createdAt: string
}
import type { KnowledgeNote } from './knowledge.js'
export type { KnowledgeNote } from './knowledge.js'

export interface PublicSnapshot {
  id: string
  slug: string
  source: { type: SourceType; id: string }
  title: string
  excerpt: string
  visibility: 'private' | 'public'
  createdAt: string
  publishedAt?: string
  revokedAt?: string
}

export interface LifeState {
  schemaVersion: 1
  plans: PlanItem[]
  records: LifeRecord[]
  reviews: PeriodReview[]
  knowledge: KnowledgeNote[]
  snapshots: PublicSnapshot[]
}
