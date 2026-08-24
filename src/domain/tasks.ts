import type { PlanItem } from './types'

export type TaskStatus = 'inbox' | 'planned' | 'doing' | 'done' | 'skipped' | 'cancelled'

export interface RecurrenceRule {
  frequency: 'daily' | 'weekly' | 'monthly'
  interval: number
  weekdays?: number[]
  monthDay?: number
  until?: string | null
}

export interface ChecklistItem {
  id: string
  taskId: string
  title: string
  isCompleted: boolean
  completedAt: string | null
  position: number
  version: number
}

export interface Task {
  id: string
  goalId: string | null
  projectId: string | null
  milestoneId: string | null
  title: string
  description: string
  startsAt: string | null
  endsAt: string | null
  dueAt: string | null
  estimateMinutes: number | null
  priority: 1 | 2 | 3
  tags: string[]
  status: TaskStatus
  checklist: ChecklistItem[]
  recurrence: RecurrenceRule | null
  version: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
  deletedAt: string | null
}

export interface ScheduleBlock {
  id: string
  taskId: string
  startsAt: string
  endsAt: string
  version: number
}

export interface ScheduleConflict {
  leftId: string
  rightId: string
  overlapMinutes: number
}

export interface CreateTaskInput {
  goalId?: string | null
  projectId?: string | null
  milestoneId?: string | null
  title: string
  description?: string
  startsAt?: string | null
  endsAt?: string | null
  dueAt?: string | null
  estimateMinutes?: number | null
  priority?: 1 | 2 | 3
  tags?: string[]
  status?: TaskStatus
  recurrence?: RecurrenceRule | null
}

export interface UpdateTaskInput extends Partial<CreateTaskInput> {
  version: number
}

export function toLegacyPlanItem(task: Task): Readonly<PlanItem> {
  const status: PlanItem['status'] = task.status === 'done'
    ? 'done'
    : task.status === 'skipped' || task.status === 'cancelled'
      ? 'skipped'
      : 'planned'
  const scheduledAt = task.startsAt ?? task.dueAt
  return Object.freeze({
    id: task.id,
    title: task.title,
    ...(scheduledAt ? { scheduledFor: scheduledAt.slice(0, 10) } : {}),
    status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(task.completedAt ? { completedAt: task.completedAt } : {}),
  })
}
