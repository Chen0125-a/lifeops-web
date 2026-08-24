import { createHash, randomUUID } from 'node:crypto'
import {
  GoalsDomainError,
  assertExpectedVersion,
  createGoalEntity,
  createMilestoneEntity,
  createProjectEntity,
  normalizeIdempotencyKey,
  updateGoalEntity,
  updateMilestoneEntity,
  updateProjectEntity,
  type CreateGoalInput,
  type CreateMilestoneInput,
  type CreateProjectInput,
  type Goal,
  type GoalRecoveryAuditEvent,
  type GoalRecoveryEntityType,
  type GoalsStore,
  type Milestone,
  type Project,
  type UpdateGoalInput,
  type UpdateMilestoneInput,
  type UpdateProjectInput,
} from '../../domain/goals.js'

interface Owned<T> {
  userId: string
  value: T
}

interface OwnedMilestone extends Owned<Milestone> {
  deletedAt: string | null
}

interface IdempotentResult<T> {
  requestHash: string
  value: T
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function requestHash(value: unknown) {
  return createHash('sha256').update(stableJson(value)).digest('hex').toUpperCase()
}

function copy<T>(value: T): T {
  return structuredClone(value)
}

export class GoalsMemoryStore implements GoalsStore {
  private readonly createId: () => string
  private readonly now: () => string
  private readonly goals: Array<Owned<Goal>> = []
  private readonly projects: Array<Owned<Project>> = []
  private readonly milestones: OwnedMilestone[] = []
  private readonly recoveryAuditEvents: Array<Owned<GoalRecoveryAuditEvent>> = []
  private readonly idempotency = new Map<string, IdempotentResult<Goal | Project | Milestone>>()

  constructor(options: { createId?: () => string; now?: () => string } = {}) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date().toISOString())
  }

  captureOwnerTransactionState(userId: string) {
    return {
      goals: copy(this.goals.filter((entry) => entry.userId === userId)),
      projects: copy(this.projects.filter((entry) => entry.userId === userId)),
      milestones: copy(this.milestones.filter((entry) => entry.userId === userId)),
      recoveryAuditEvents: copy(this.recoveryAuditEvents.filter((entry) => entry.userId === userId)),
      idempotency: [...this.idempotency.entries()].filter(([key]) => key.startsWith(`${userId}\0`)).map(([key, value]) => [key, copy(value)] as const),
    }
  }

  restoreOwnerTransactionState(userId: string, state: ReturnType<GoalsMemoryStore['captureOwnerTransactionState']>) {
    this.replaceOwnerRows(this.goals, userId, state.goals)
    this.replaceOwnerRows(this.projects, userId, state.projects)
    this.replaceOwnerRows(this.milestones, userId, state.milestones)
    this.replaceOwnerRows(this.recoveryAuditEvents, userId, state.recoveryAuditEvents)
    for (const key of [...this.idempotency.keys()]) if (key.startsWith(`${userId}\0`)) this.idempotency.delete(key)
    for (const [key, value] of state.idempotency) this.idempotency.set(key, copy(value))
  }

  replaceOwnerPortableData(userId: string, data: { goals: Goal[]; projects: Project[]; milestones: Milestone[] }) {
    this.replaceOwnerRows(this.goals, userId, data.goals.map((value) => ({ userId, value: copy(value) })))
    this.replaceOwnerRows(this.projects, userId, data.projects.map((value) => ({ userId, value: copy(value) })))
    this.replaceOwnerRows(this.milestones, userId, data.milestones.map((value) => ({ userId, value: copy(value), deletedAt: value.deletedAt })))
    this.replaceOwnerRows(this.recoveryAuditEvents, userId, [])
    for (const key of [...this.idempotency.keys()]) if (key.startsWith(`${userId}\0`)) this.idempotency.delete(key)
  }

  private replaceOwnerRows<T extends { userId: string }>(target: T[], userId: string, rows: T[]) {
    target.splice(0, target.length, ...target.filter((entry) => entry.userId !== userId), ...copy(rows))
  }

  async listGoals(userId: string) {
    return this.goals
      .filter((item) => item.userId === userId && item.value.deletedAt === null)
      .map((item) => copy(item.value))
  }

  async getGoal(userId: string, id: string) {
    const item = this.goalRecord(userId, id)
    return item ? copy(item.value) : undefined
  }

  async createGoal(userId: string, input: CreateGoalInput, idempotencyKey: string) {
    return this.createIdempotently(userId, 'goals:create', idempotencyKey, input, () => {
      const value = createGoalEntity(this.createId(), this.now(), input)
      this.goals.push({ userId, value })
      return value
    })
  }

  async updateGoal(userId: string, id: string, input: UpdateGoalInput) {
    const item = this.goalRecord(userId, id)
    if (!item) return undefined
    item.value = updateGoalEntity(item.value, this.now(), input)
    return copy(item.value)
  }

  async deleteGoal(userId: string, id: string, version: number) {
    const item = this.goalRecord(userId, id)
    if (!item) return false
    assertExpectedVersion(item.value.version, version)
    const timestamp = this.now()
    const audit = this.recoveryAuditEvent(userId, 'goal', 'archive', id, version, version + 1, null, timestamp)
    item.value = { ...item.value, deletedAt: timestamp, updatedAt: timestamp, version: item.value.version + 1 }
    this.recoveryAuditEvents.push(audit)
    return true
  }

  async restoreGoal(userId: string, id: string, version: number) {
    const item = this.goals.find((entry) => entry.userId === userId && entry.value.id === id && entry.value.deletedAt !== null)
    if (!item) return undefined
    assertExpectedVersion(item.value.version, version)
    const timestamp = this.now()
    const archive = this.currentArchiveEvent(userId, 'goal', id)
    const audit = this.recoveryAuditEvent(userId, 'goal', 'restore', id, version, version + 1, archive.id, timestamp)
    item.value = { ...item.value, deletedAt: null, updatedAt: timestamp, version: item.value.version + 1 }
    this.recoveryAuditEvents.push(audit)
    return copy(item.value)
  }

  async listProjects(userId: string, goalId: string) {
    if (!this.goalRecord(userId, goalId)) return []
    return this.projects
      .filter((item) => item.userId === userId && item.value.goalId === goalId && item.value.deletedAt === null)
      .map((item) => copy(item.value))
  }

  async getProject(userId: string, id: string) {
    const item = this.projectRecord(userId, id)
    return item ? copy(item.value) : undefined
  }

  async createProject(userId: string, goalId: string, input: CreateProjectInput, idempotencyKey: string) {
    return this.createIdempotently(userId, `goals:${goalId}:projects:create`, idempotencyKey, input, () => {
      const goal = this.goalRecord(userId, goalId)?.value
      if (!goal) throw new GoalsDomainError('NOT_FOUND', '找不到目标', 404)
      if (goal.status === 'completed' && (input.status ?? 'active') === 'active') {
        throw new GoalsDomainError('GOAL_COMPLETED', '完成的目标需要先重新打开，才能新增活动项目', 409)
      }
      const value = createProjectEntity(this.createId(), goalId, this.now(), input)
      this.projects.push({ userId, value })
      return value
    })
  }

  async updateProject(userId: string, id: string, input: UpdateProjectInput) {
    const item = this.projectRecord(userId, id)
    if (!item) return undefined
    const goal = item.value.goalId ? this.goalRecord(userId, item.value.goalId)?.value : undefined
    item.value = updateProjectEntity(item.value, this.now(), input, goal?.status)
    return copy(item.value)
  }

  async deleteProject(userId: string, id: string, version: number) {
    const item = this.projectRecord(userId, id)
    if (!item) return false
    assertExpectedVersion(item.value.version, version)
    const timestamp = this.now()
    const audit = this.recoveryAuditEvent(userId, 'project', 'archive', id, version, version + 1, null, timestamp)
    item.value = { ...item.value, deletedAt: timestamp, updatedAt: timestamp, version: item.value.version + 1 }
    this.recoveryAuditEvents.push(audit)
    return true
  }

  async restoreProject(userId: string, id: string, version: number) {
    const item = this.projects.find((entry) => entry.userId === userId && entry.value.id === id && entry.value.deletedAt !== null)
    if (!item) return undefined
    assertExpectedVersion(item.value.version, version)
    const timestamp = this.now()
    const archive = this.currentArchiveEvent(userId, 'project', id)
    const audit = this.recoveryAuditEvent(userId, 'project', 'restore', id, version, version + 1, archive.id, timestamp)
    item.value = { ...item.value, deletedAt: null, updatedAt: timestamp, version: item.value.version + 1 }
    this.recoveryAuditEvents.push(audit)
    return copy(item.value)
  }

  async listMilestones(userId: string, projectId: string) {
    if (!this.projectRecord(userId, projectId)) return []
    return this.milestones
      .filter((item) => item.userId === userId && item.value.projectId === projectId && item.deletedAt === null)
      .sort((left, right) => left.value.position - right.value.position || left.value.id.localeCompare(right.value.id))
      .map((item) => copy(item.value))
  }

  async getMilestone(userId: string, id: string) {
    const item = this.milestoneRecord(userId, id)
    return item ? copy(item.value) : undefined
  }

  async createMilestone(userId: string, projectId: string, input: CreateMilestoneInput, idempotencyKey: string) {
    return this.createIdempotently(userId, `projects:${projectId}:milestones:create`, idempotencyKey, input, () => {
      if (!this.projectRecord(userId, projectId)) throw new GoalsDomainError('NOT_FOUND', '找不到项目', 404)
      const value = createMilestoneEntity(this.createId(), projectId, input)
      this.milestones.push({ userId, value, deletedAt: null })
      return value
    })
  }

  async updateMilestone(userId: string, id: string, input: UpdateMilestoneInput) {
    const item = this.milestoneRecord(userId, id)
    if (!item) return undefined
    item.value = updateMilestoneEntity(item.value, input)
    return copy(item.value)
  }

  async deleteMilestone(userId: string, id: string, version: number) {
    const item = this.milestoneRecord(userId, id)
    if (!item) return false
    assertExpectedVersion(item.value.version, version)
    const timestamp = this.now()
    const audit = this.recoveryAuditEvent(userId, 'milestone', 'archive', id, version, version + 1, null, timestamp)
    item.value = { ...item.value, version: item.value.version + 1 }
    item.deletedAt = timestamp
    this.recoveryAuditEvents.push(audit)
    return true
  }

  async restoreMilestone(userId: string, id: string, version: number) {
    const item = this.milestones.find((entry) => entry.userId === userId && entry.value.id === id && entry.deletedAt !== null)
    if (!item) return undefined
    assertExpectedVersion(item.value.version, version)
    const timestamp = this.now()
    const archive = this.currentArchiveEvent(userId, 'milestone', id)
    const audit = this.recoveryAuditEvent(userId, 'milestone', 'restore', id, version, version + 1, archive.id, timestamp)
    item.value = { ...item.value, version: item.value.version + 1 }
    item.deletedAt = null
    this.recoveryAuditEvents.push(audit)
    return { ...copy(item.value), deletedAt: null }
  }

  async listGoalRecoveryAuditEvents(userId: string, entityType: GoalRecoveryEntityType, entityId: string) {
    return this.recoveryAuditEvents
      .filter((entry) => entry.userId === userId && entry.value.entityType === entityType && entry.value.entityId === entityId)
      .map((entry) => copy(entry.value))
  }

  private goalRecord(userId: string, id: string) {
    return this.goals.find((item) => item.userId === userId && item.value.id === id && item.value.deletedAt === null)
  }

  private projectRecord(userId: string, id: string) {
    return this.projects.find((item) => item.userId === userId && item.value.id === id && item.value.deletedAt === null)
  }

  private milestoneRecord(userId: string, id: string) {
    return this.milestones.find((item) => item.userId === userId && item.value.id === id && item.deletedAt === null && this.projectRecord(userId, item.value.projectId))
  }

  private currentArchiveEvent(userId: string, entityType: GoalRecoveryEntityType, entityId: string) {
    const reversed = new Set(this.recoveryAuditEvents
      .filter((entry) => entry.userId === userId && entry.value.entityType === entityType && entry.value.entityId === entityId)
      .map((entry) => entry.value.details.reversesEventId)
      .filter((id): id is string => id !== null))
    const archive = [...this.recoveryAuditEvents].reverse().find((entry) => entry.userId === userId
      && entry.value.entityType === entityType
      && entry.value.entityId === entityId
      && entry.value.action === `${entityType}.archive`
      && !reversed.has(entry.value.id))?.value
    if (!archive) throw new GoalsDomainError('NOT_FOUND', '找不到当前归档审计事件', 404)
    return archive
  }

  private recoveryAuditEvent(
    userId: string,
    entityType: GoalRecoveryEntityType,
    operation: 'archive' | 'restore',
    entityId: string,
    versionBefore: number,
    versionAfter: number,
    reversesEventId: string | null,
    occurredAt: string,
  ): Owned<GoalRecoveryAuditEvent> {
    return {
      userId,
      value: {
        id: this.createId(),
        action: `${entityType}.${operation}`,
        entityType,
        entityId,
        details: { versionBefore, versionAfter, reversesEventId },
        occurredAt,
      },
    }
  }

  private createIdempotently<T extends Goal | Project | Milestone>(
    userId: string,
    scope: string,
    key: string,
    input: unknown,
    create: () => T,
  ): T {
    const normalizedKey = normalizeIdempotencyKey(key)
    const mapKey = `${userId}\u0000${scope}\u0000${normalizedKey}`
    const hash = requestHash(input)
    const existing = this.idempotency.get(mapKey)
    if (existing) {
      if (existing.requestHash !== hash) {
        throw new GoalsDomainError('IDEMPOTENCY_CONFLICT', '同一个幂等键不能用于不同请求', 409)
      }
      return copy(existing.value) as T
    }
    const value = create()
    this.idempotency.set(mapKey, { requestHash: hash, value: copy(value) })
    return copy(value)
  }
}
