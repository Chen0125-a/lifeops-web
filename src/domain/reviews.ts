export type ReviewType = 'weekly' | 'monthly' | 'custom'
export type ReviewStatus = 'draft' | 'archived'
export type ReviewActionTarget = 'task' | 'goal-update' | 'knowledge' | 'public-draft'
export type ReviewActionStatus = 'pending' | 'converted' | 'dismissed'

export interface ReviewPeriod { from: string; to: string }
export interface ReviewCommitment { reviewId: string; text: string; status: ReviewActionStatus }
export interface ReviewEvidence {
  period: ReviewPeriod
  goals: { active: number; completed: number }
  projects: { active: number; completed: number }
  tasks: { total: number; completed: number; skipped: number; cancelled: number }
  habits: { entries: number; done: number; partial: number; intentionalSkips: number }
  records: { total: number; ids: string[] }
  priorCommitments: ReviewCommitment[]
  hasFacts: boolean
}
export interface ReviewAction {
  id: string
  text: string
  status: ReviewActionStatus
  convertedTarget: ReviewActionTarget | null
  convertedId: string | null
  version: number
  createdAt: string
  updatedAt: string
}
export interface Review {
  id: string
  type: ReviewType
  period: ReviewPeriod
  status: ReviewStatus
  achievements: string[]
  problems: string[]
  causes: string[]
  insights: string[]
  nextChanges: string[]
  evidence: ReviewEvidence
  actions: ReviewAction[]
  version: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}
export interface CreateReviewInput {
  type: ReviewType
  period: ReviewPeriod
  achievements?: string[]
  problems?: string[]
  causes?: string[]
  insights?: string[]
  nextChanges?: string[]
  actions?: Array<{ id?: string; text: string }>
}
export interface UpdateReviewInput extends Partial<Omit<CreateReviewInput, 'actions'>> {
  status?: ReviewStatus
  actions?: Array<{ id?: string; text: string }>
  version: number
}
export interface ReviewFilters { includeArchived?: boolean }
export interface ConvertReviewActionInput { target: ReviewActionTarget; goalId?: string }
export interface ReviewActionConversion {
  review: Review
  action: ReviewAction
  target: { type: ReviewActionTarget; id: string; title: string }
}
