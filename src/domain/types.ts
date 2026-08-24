export type PlanStatus = 'planned' | 'done' | 'skipped'
export type SourceType = 'plan' | 'record' | 'review' | 'knowledge'
import type { LifeRecord } from './records'
export type { LifeRecord } from './records'

export interface PlanItem {
  id: string
  title: string
  scheduledFor?: string
  status: PlanStatus
  createdAt: string
  updatedAt: string
  completedAt?: string
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

export interface KnowledgeNote {
  id: string
  source: { type: 'record' | 'review'; id: string }
  title: string
  body: string
  tags: string[]
  createdAt: string
}

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
