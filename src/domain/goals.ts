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
