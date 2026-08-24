import type { Goal, Project } from './goals.js'
import type { Habit, HabitEntry } from './habits.js'
import type { Task } from './tasks.js'
import type { LifeRecord } from './types.js'

export type ReviewType = 'weekly' | 'monthly' | 'custom'
export type ReviewStatus = 'draft' | 'archived'
export type ReviewActionTarget = 'task' | 'goal-update' | 'knowledge' | 'public-draft'
export type ReviewActionStatus = 'pending' | 'converted' | 'dismissed'

export interface ReviewPeriod {
  from: string
  to: string
}

export interface ReviewCommitment {
  reviewId: string
  text: string
  status: ReviewActionStatus
}

export interface ReviewEvidenceState {
  goals: Array<Pick<Goal, 'status' | 'updatedAt' | 'deletedAt'>>
  projects: Array<Pick<Project, 'status' | 'updatedAt' | 'deletedAt'>>
  tasks: Array<Pick<Task, 'id' | 'status' | 'completedAt' | 'updatedAt' | 'deletedAt'>>
  habits: Array<Pick<Habit, 'id'>>
  habitEntries: Array<Pick<HabitEntry, 'habitId' | 'entryDate' | 'status'>>
  records: Array<Pick<LifeRecord, 'id' | 'occurredAt' | 'deletedAt'>>
  priorCommitments: ReviewCommitment[]
}

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

export interface UpdateReviewInput {
  type?: ReviewType
  period?: ReviewPeriod
  status?: ReviewStatus
  achievements?: string[]
  problems?: string[]
  causes?: string[]
  insights?: string[]
  nextChanges?: string[]
  actions?: Array<{ id?: string; text: string }>
  version: number
}

export interface ReviewFilters {
  includeArchived?: boolean
}

export interface ConvertReviewActionInput {
  target: ReviewActionTarget
  goalId?: string
}

export interface ConvertedReviewTarget {
  type: ReviewActionTarget
  id: string
  title: string
}

export interface ReviewActionConversion {
  review: Review
  action: ReviewAction
  target: ConvertedReviewTarget
}

export interface ReviewsStore {
  listReviews(userId: string, filters?: ReviewFilters): Promise<Review[]>
  getReview(userId: string, id: string): Promise<Review | undefined>
  createReview(userId: string, input: CreateReviewInput, idempotencyKey: string): Promise<Review>
  updateReview(userId: string, id: string, input: UpdateReviewInput): Promise<Review | undefined>
  deleteReview(userId: string, id: string, version: number): Promise<boolean>
  restoreReview(userId: string, id: string, version: number): Promise<Review | undefined>
  refreshReviewEvidence(userId: string, id: string, version: number): Promise<Review | undefined>
  convertReviewAction(userId: string, reviewId: string, actionId: string, input: ConvertReviewActionInput, idempotencyKey: string): Promise<ReviewActionConversion | undefined>
}

export class ReviewsDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'ReviewsDomainError'
  }
}

const dateOnly = /^\d{4}-\d{2}-\d{2}$/

function validDateOnly(value: string) {
  if (!dateOnly.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day!))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
}

export function assertReviewPeriod(period: ReviewPeriod): ReviewPeriod {
  if (!validDateOnly(period.from) || !validDateOnly(period.to) || period.from > period.to) {
    throw new ReviewsDomainError('INVALID_INPUT', '回顾周期必须是有效且顺序正确的日期', 400)
  }
  return { from: period.from, to: period.to }
}

function dateInPeriod(value: string | null | undefined, period: ReviewPeriod) {
  if (!value) return false
  const date = value.slice(0, 10)
  return validDateOnly(date) && date >= period.from && date <= period.to
}

function narrative(values: string[] | undefined, field: string) {
  const cleaned = (values ?? []).map((value) => value.trim()).filter(Boolean)
  if (cleaned.some((value) => value.length > 4_000)) {
    throw new ReviewsDomainError('INVALID_INPUT', `${field}单项不能超过 4000 字`, 400)
  }
  if (cleaned.length > 100) throw new ReviewsDomainError('INVALID_INPUT', `${field}不能超过 100 项`, 400)
  return cleaned
}

export function buildReviewEvidence(state: ReviewEvidenceState, rawPeriod: ReviewPeriod): ReviewEvidence {
  const period = assertReviewPeriod(rawPeriod)
  const goals = state.goals.filter((goal) => goal.deletedAt == null)
  const projects = state.projects.filter((project) => project.deletedAt == null)
  const tasks = state.tasks.filter((task) => task.deletedAt == null)
    .filter((task) => dateInPeriod(task.status === 'done' ? task.completedAt ?? task.updatedAt : task.updatedAt, period))
  const habitIds = new Set(state.habits.map((habit) => habit.id))
  const habitEntries = state.habitEntries.filter((entry) => habitIds.has(entry.habitId) && dateInPeriod(entry.entryDate, period))
  const records = state.records.filter((record) => record.deletedAt == null && dateInPeriod(record.occurredAt, period))
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id))
  const priorCommitments = state.priorCommitments.filter((item) => item.status === 'pending')
    .map((item) => ({ ...item }))

  const evidence: ReviewEvidence = {
    period,
    goals: {
      active: goals.filter((goal) => goal.status === 'active').length,
      completed: goals.filter((goal) => goal.status === 'completed' && dateInPeriod(goal.updatedAt, period)).length,
    },
    projects: {
      active: projects.filter((project) => project.status === 'active').length,
      completed: projects.filter((project) => project.status === 'completed' && dateInPeriod(project.updatedAt, period)).length,
    },
    tasks: {
      total: tasks.length,
      completed: tasks.filter((task) => task.status === 'done').length,
      skipped: tasks.filter((task) => task.status === 'skipped').length,
      cancelled: tasks.filter((task) => task.status === 'cancelled').length,
    },
    habits: {
      entries: habitEntries.length,
      done: habitEntries.filter((entry) => entry.status === 'done').length,
      partial: habitEntries.filter((entry) => entry.status === 'partial').length,
      intentionalSkips: habitEntries.filter((entry) => entry.status === 'intentional-skip').length,
    },
    records: { total: records.length, ids: records.map((record) => record.id) },
    priorCommitments,
    hasFacts: false,
  }
  evidence.hasFacts = evidence.goals.active + evidence.goals.completed
    + evidence.projects.active + evidence.projects.completed
    + evidence.tasks.total + evidence.habits.entries + evidence.records.total + evidence.priorCommitments.length > 0
  return evidence
}

export function createReviewEntity(
  id: string,
  now: string,
  input: CreateReviewInput,
  evidence: ReviewEvidence,
  createActionId: () => string,
): Review {
  const actionIds = new Set<string>()
  const actions = (input.actions ?? []).map((item) => {
    const actionId = item.id?.trim() || createActionId()
    const text = item.text.trim()
    if (!actionId || actionId.length > 80 || !text || text.length > 1_000 || actionIds.has(actionId)) {
      throw new ReviewsDomainError('INVALID_INPUT', '行动必须有唯一 ID 和有效内容', 400)
    }
    actionIds.add(actionId)
    return {
      id: actionId,
      text,
      status: 'pending' as const,
      convertedTarget: null,
      convertedId: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
  })
  return {
    id,
    type: input.type,
    period: assertReviewPeriod(input.period),
    status: 'draft',
    achievements: narrative(input.achievements, '成果'),
    problems: narrative(input.problems, '问题'),
    causes: narrative(input.causes, '原因'),
    insights: narrative(input.insights, '洞察'),
    nextChanges: narrative(input.nextChanges, '下一步变化'),
    evidence,
    actions,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
}

export function assertReviewVersion(current: number, expected: number) {
  if (!Number.isSafeInteger(expected) || expected < 1 || current !== expected) {
    throw new ReviewsDomainError('VERSION_CONFLICT', '回顾已被更新，请刷新后重试', 409)
  }
}

export function updateReviewEntity(
  current: Review,
  now: string,
  input: UpdateReviewInput,
  createActionId: () => string,
): Review {
  assertReviewVersion(current.version, input.version)
  const base: CreateReviewInput = {
    type: input.type ?? current.type,
    period: input.period ?? current.period,
    achievements: input.achievements ?? current.achievements,
    problems: input.problems ?? current.problems,
    causes: input.causes ?? current.causes,
    insights: input.insights ?? current.insights,
    nextChanges: input.nextChanges ?? current.nextChanges,
  }
  const nextActions = input.actions === undefined
    ? current.actions.map((action) => ({ ...action }))
    : mergeReviewActions(current.actions, input.actions, now, createActionId)
  return {
    ...current,
    type: base.type,
    period: assertReviewPeriod(base.period),
    status: input.status ?? current.status,
    achievements: narrative(base.achievements, '成果'),
    problems: narrative(base.problems, '问题'),
    causes: narrative(base.causes, '原因'),
    insights: narrative(base.insights, '洞察'),
    nextChanges: narrative(base.nextChanges, '下一步变化'),
    actions: nextActions,
    version: current.version + 1,
    updatedAt: now,
  }
}

function mergeReviewActions(
  current: ReviewAction[],
  input: Array<{ id?: string; text: string }>,
  now: string,
  createActionId: () => string,
) {
  const byId = new Map(current.map((action) => [action.id, action]))
  const ids = new Set<string>()
  const merged = input.map((item) => {
    const id = item.id?.trim() || createActionId()
    const text = item.text.trim()
    if (!id || id.length > 80 || !text || text.length > 1_000 || ids.has(id)) {
      throw new ReviewsDomainError('INVALID_INPUT', '行动必须有唯一 ID 和有效内容', 400)
    }
    ids.add(id)
    const existing = byId.get(id)
    if (existing?.status === 'converted' && existing.text !== text) {
      throw new ReviewsDomainError('ACTION_ALREADY_CONVERTED', '已转换的行动不能改写', 409)
    }
    return existing
      ? { ...existing, text, version: existing.text === text ? existing.version : existing.version + 1, updatedAt: existing.text === text ? existing.updatedAt : now }
      : { id, text, status: 'pending' as const, convertedTarget: null, convertedId: null, version: 1, createdAt: now, updatedAt: now }
  })
  if (current.some((action) => action.status === 'converted' && !ids.has(action.id))) {
    throw new ReviewsDomainError('ACTION_ALREADY_CONVERTED', '已转换的行动不能从回顾中移除', 409)
  }
  return merged
}

export function normalizeReviewIdempotencyKey(value: string) {
  const key = value.trim()
  if (!key || key.length > 190) throw new ReviewsDomainError('INVALID_INPUT', '需要有效的 Idempotency-Key', 400)
  return key
}
