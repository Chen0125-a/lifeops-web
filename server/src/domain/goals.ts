export type GoalStatus = 'active' | 'paused' | 'completed' | 'cancelled'
export type GoalPriority = 1 | 2 | 3
export type GoalProgressMode = 'manual' | 'task-ratio' | 'milestone-ratio'

export interface Goal {
  id: string
  title: string
  description: string
  status: GoalStatus
  priority: GoalPriority
  startsOn: string | null
  targetOn: string | null
  progressMode: GoalProgressMode
  manualProgress: number
  version: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface Project {
  id: string
  goalId: string | null
  title: string
  description: string
  riskNote: string
  status: GoalStatus
  startsOn: string | null
  targetOn: string | null
  progress: number
  nextTaskId: string | null
  version: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface Milestone {
  id: string
  projectId: string
  title: string
  dueOn: string | null
  completedAt: string | null
  position: number
  version: number
  deletedAt?: string | null
}

export interface CreateGoalInput {
  title: string
  description?: string
  priority?: GoalPriority
  startsOn?: string | null
  targetOn?: string | null
  progressMode?: GoalProgressMode
  manualProgress?: number
}

export interface UpdateGoalInput extends Partial<Omit<CreateGoalInput, 'title'>> {
  title?: string
  status?: GoalStatus
  version: number
}

export interface CreateProjectInput {
  title: string
  description?: string
  riskNote?: string
  status?: GoalStatus
  startsOn?: string | null
  targetOn?: string | null
  progress?: number
  nextTaskId?: string | null
}

export interface UpdateProjectInput extends Partial<CreateProjectInput> {
  version: number
}

export interface CreateMilestoneInput {
  title: string
  dueOn?: string | null
  completedAt?: string | null
  position?: number
}

export interface UpdateMilestoneInput extends Partial<CreateMilestoneInput> {
  version: number
}

export interface GoalsStore {
  listGoals(userId: string): Promise<Goal[]>
  getGoal(userId: string, id: string): Promise<Goal | undefined>
  createGoal(userId: string, input: CreateGoalInput, idempotencyKey: string): Promise<Goal>
  updateGoal(userId: string, id: string, input: UpdateGoalInput): Promise<Goal | undefined>
  deleteGoal(userId: string, id: string, version: number): Promise<boolean>
  restoreGoal(userId: string, id: string, version: number): Promise<Goal | undefined>

  listProjects(userId: string, goalId: string): Promise<Project[]>
  getProject(userId: string, id: string): Promise<Project | undefined>
  createProject(userId: string, goalId: string, input: CreateProjectInput, idempotencyKey: string): Promise<Project>
  updateProject(userId: string, id: string, input: UpdateProjectInput): Promise<Project | undefined>
  deleteProject(userId: string, id: string, version: number): Promise<boolean>
  restoreProject(userId: string, id: string, version: number): Promise<Project | undefined>

  listMilestones(userId: string, projectId: string): Promise<Milestone[]>
  getMilestone(userId: string, id: string): Promise<Milestone | undefined>
  createMilestone(userId: string, projectId: string, input: CreateMilestoneInput, idempotencyKey: string): Promise<Milestone>
  updateMilestone(userId: string, id: string, input: UpdateMilestoneInput): Promise<Milestone | undefined>
  deleteMilestone(userId: string, id: string, version: number): Promise<boolean>
  restoreMilestone(userId: string, id: string, version: number): Promise<Milestone | undefined>
  listGoalRecoveryAuditEvents(userId: string, entityType: GoalRecoveryEntityType, entityId: string): Promise<GoalRecoveryAuditEvent[]>
}

export type GoalRecoveryEntityType = 'goal' | 'project' | 'milestone'
export type GoalRecoveryAction = `${GoalRecoveryEntityType}.archive` | `${GoalRecoveryEntityType}.restore`

export interface GoalRecoveryAuditEvent {
  id: string
  action: GoalRecoveryAction
  entityType: GoalRecoveryEntityType
  entityId: string
  details: {
    versionBefore: number
    versionAfter: number
    reversesEventId: string | null
  }
  occurredAt: string
}

export type GoalsErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'GOAL_COMPLETED'
  | 'IDEMPOTENCY_CONFLICT'

export class GoalsDomainError extends Error {
  readonly name = 'GoalsDomainError'

  constructor(
    public readonly code: GoalsErrorCode,
    message: string,
    public readonly status: 400 | 404 | 409,
  ) {
    super(message)
  }
}

const statuses = new Set<GoalStatus>(['active', 'paused', 'completed', 'cancelled'])
const progressModes = new Set<GoalProgressMode>(['manual', 'task-ratio', 'milestone-ratio'])

function invalid(message: string): never {
  throw new GoalsDomainError('INVALID_INPUT', message, 400)
}

function requiredText(value: unknown, field: string, maxLength: number) {
  if (typeof value !== 'string') invalid(`${field}不能为空`)
  const result = value.trim()
  if (!result) invalid(`${field}不能为空`)
  if (result.length > maxLength) invalid(`${field}不能超过 ${maxLength} 个字符`)
  return result
}

function optionalText(value: unknown, field: string, maxLength: number) {
  if (value === undefined) return undefined
  if (typeof value !== 'string') invalid(`${field}格式无效`)
  const result = value.trim()
  if (result.length > maxLength) invalid(`${field}不能超过 ${maxLength} 个字符`)
  return result
}

function dateOnly(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(`${field}必须是 YYYY-MM-DD`)
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid(`${field}不是有效日期`)
  return value
}

function nullableId(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  return requiredText(value, field, 80)
}

function progress(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) invalid(`${field}必须在 0 到 100 之间`)
  return Math.round(value * 100) / 100
}

function priority(value: unknown): GoalPriority | undefined {
  if (value === undefined) return undefined
  if (value !== 1 && value !== 2 && value !== 3) invalid('优先级必须是 1、2 或 3')
  return value
}

function status(value: unknown): GoalStatus | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !statuses.has(value as GoalStatus)) invalid('状态无效')
  return value as GoalStatus
}

function progressMode(value: unknown): GoalProgressMode | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !progressModes.has(value as GoalProgressMode)) invalid('进度模式无效')
  return value as GoalProgressMode
}

function version(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid('版本号无效')
  return value as number
}

function position(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 4_294_967_295) invalid('里程碑位置无效')
  return value as number
}

function instant(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') invalid(`${field}格式无效`)
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) invalid(`${field}格式无效`)
  return parsed.toISOString()
}

function assertDateRange(startsOn: string | null, targetOn: string | null) {
  if (startsOn && targetOn && targetOn < startsOn) invalid('目标日期不能早于开始日期')
}

function requirePatch(input: Record<string, unknown>) {
  if (!Object.keys(input).some((key) => key !== 'version' && input[key] !== undefined)) invalid('至少需要修改一个字段')
}

export function assertExpectedVersion(actual: number, expected: unknown) {
  const normalized = version(expected)
  if (actual !== normalized) throw new GoalsDomainError('VERSION_CONFLICT', '数据已经在另一处更新', 409)
}

export function normalizeIdempotencyKey(value: string) {
  const result = requiredText(value, '幂等键', 190)
  return result
}

export function createGoalEntity(id: string, now: string, input: CreateGoalInput): Goal {
  const startsOn = dateOnly(input.startsOn, '开始日期') ?? null
  const targetOn = dateOnly(input.targetOn, '目标日期') ?? null
  assertDateRange(startsOn, targetOn)
  return {
    id,
    title: requiredText(input.title, '目标标题', 240),
    description: optionalText(input.description, '目标描述', 20_000) ?? '',
    status: 'active',
    priority: priority(input.priority) ?? 2,
    startsOn,
    targetOn,
    progressMode: progressMode(input.progressMode) ?? 'manual',
    manualProgress: progress(input.manualProgress, '手动进度') ?? 0,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
}

export function updateGoalEntity(current: Goal, now: string, input: UpdateGoalInput): Goal {
  assertExpectedVersion(current.version, input.version)
  requirePatch(input as unknown as Record<string, unknown>)
  const startsOn = dateOnly(input.startsOn, '开始日期')
  const targetOn = dateOnly(input.targetOn, '目标日期')
  const next: Goal = {
    ...current,
    title: input.title === undefined ? current.title : requiredText(input.title, '目标标题', 240),
    description: optionalText(input.description, '目标描述', 20_000) ?? current.description,
    status: status(input.status) ?? current.status,
    priority: priority(input.priority) ?? current.priority,
    startsOn: startsOn === undefined ? current.startsOn : startsOn,
    targetOn: targetOn === undefined ? current.targetOn : targetOn,
    progressMode: progressMode(input.progressMode) ?? current.progressMode,
    manualProgress: progress(input.manualProgress, '手动进度') ?? current.manualProgress,
    version: current.version + 1,
    updatedAt: now,
  }
  assertDateRange(next.startsOn, next.targetOn)
  return next
}

export function createProjectEntity(id: string, goalId: string, now: string, input: CreateProjectInput): Project {
  const startsOn = dateOnly(input.startsOn, '开始日期') ?? null
  const targetOn = dateOnly(input.targetOn, '目标日期') ?? null
  assertDateRange(startsOn, targetOn)
  return {
    id,
    goalId,
    title: requiredText(input.title, '项目标题', 240),
    description: optionalText(input.description, '项目描述', 20_000) ?? '',
    riskNote: optionalText(input.riskNote, '风险备注', 20_000) ?? '',
    status: status(input.status) ?? 'active',
    startsOn,
    targetOn,
    progress: progress(input.progress, '项目进度') ?? 0,
    nextTaskId: nullableId(input.nextTaskId, '下一任务') ?? null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
}

export function updateProjectEntity(current: Project, now: string, input: UpdateProjectInput, goalStatus?: GoalStatus): Project {
  assertExpectedVersion(current.version, input.version)
  requirePatch(input as unknown as Record<string, unknown>)
  const startsOn = dateOnly(input.startsOn, '开始日期')
  const targetOn = dateOnly(input.targetOn, '目标日期')
  const nextTaskId = nullableId(input.nextTaskId, '下一任务')
  const nextStatus = status(input.status) ?? current.status
  if (goalStatus === 'completed' && nextStatus === 'active' && current.status !== 'active') {
    throw new GoalsDomainError('GOAL_COMPLETED', '完成的目标需要先重新打开，才能激活项目', 409)
  }
  const next: Project = {
    ...current,
    title: input.title === undefined ? current.title : requiredText(input.title, '项目标题', 240),
    description: optionalText(input.description, '项目描述', 20_000) ?? current.description,
    riskNote: optionalText(input.riskNote, '风险备注', 20_000) ?? current.riskNote,
    status: nextStatus,
    startsOn: startsOn === undefined ? current.startsOn : startsOn,
    targetOn: targetOn === undefined ? current.targetOn : targetOn,
    progress: progress(input.progress, '项目进度') ?? current.progress,
    nextTaskId: nextTaskId === undefined ? current.nextTaskId : nextTaskId,
    version: current.version + 1,
    updatedAt: now,
  }
  assertDateRange(next.startsOn, next.targetOn)
  return next
}

export function createMilestoneEntity(id: string, projectId: string, input: CreateMilestoneInput): Milestone {
  return {
    id,
    projectId,
    title: requiredText(input.title, '里程碑标题', 240),
    dueOn: dateOnly(input.dueOn, '到期日期') ?? null,
    completedAt: instant(input.completedAt, '完成时间') ?? null,
    position: position(input.position) ?? 0,
    version: 1,
  }
}

export function updateMilestoneEntity(current: Milestone, input: UpdateMilestoneInput): Milestone {
  assertExpectedVersion(current.version, input.version)
  requirePatch(input as unknown as Record<string, unknown>)
  const dueOn = dateOnly(input.dueOn, '到期日期')
  const completedAt = instant(input.completedAt, '完成时间')
  return {
    ...current,
    title: input.title === undefined ? current.title : requiredText(input.title, '里程碑标题', 240),
    dueOn: dueOn === undefined ? current.dueOn : dueOn,
    completedAt: completedAt === undefined ? current.completedAt : completedAt,
    position: position(input.position) ?? current.position,
    version: current.version + 1,
  }
}
