import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { goalsApi } from '../../api/goalsApi'
import { HttpError } from '../../api/httpClient'
import { queryKeys } from '../../api/queryKeys'
import type {
  CreateGoalInput,
  CreateMilestoneInput,
  CreateProjectInput,
  Goal,
  Milestone,
  Project,
  UpdateGoalInput,
  UpdateMilestoneInput,
  UpdateProjectInput,
} from '../../domain/goals'
import { useAuth } from '../../state/AuthContext'

export type GoalsStatus = 'loading' | 'ready' | 'empty' | 'network-error' | 'forbidden' | 'conflict' | 'disconnected'

export interface UseGoalsResult {
  goals: Goal[]
  projects: Project[]
  milestones: Milestone[]
  status: GoalsStatus
  error: HttpError | null
  createGoal(input: CreateGoalInput): Promise<Goal>
  updateGoal(id: string, input: UpdateGoalInput): Promise<Goal>
  archiveGoal(id: string, version: number): Promise<void>
  restoreGoal(id: string, version: number): Promise<Goal>
  createProject(goalId: string, input: CreateProjectInput): Promise<Project>
  updateProject(id: string, input: UpdateProjectInput): Promise<Project>
  archiveProject(id: string, version: number): Promise<void>
  restoreProject(id: string, version: number): Promise<Project>
  createMilestone(projectId: string, input: CreateMilestoneInput): Promise<Milestone>
  updateMilestone(id: string, input: UpdateMilestoneInput): Promise<Milestone>
  completeMilestone(id: string, version: number): Promise<Milestone>
  archiveMilestone(id: string, version: number): Promise<void>
  restoreMilestone(id: string, version: number): Promise<Milestone>
  retry(): void
}

interface GoalHierarchy {
  goals: Goal[]
  projects: Project[]
  milestones: Milestone[]
}

const emptyHierarchy: GoalHierarchy = { goals: [], projects: [], milestones: [] }

function idempotencyKey(scope: string) {
  return `${scope}:${globalThis.crypto.randomUUID()}`
}

function typedError(error: unknown) {
  return error instanceof HttpError ? error : null
}

function errorStatus(error: HttpError | null): GoalsStatus {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'disconnected'
  if (error?.status === 401 || error?.status === 403) return 'forbidden'
  if (error?.status === 409) return 'conflict'
  return 'network-error'
}

async function loadHierarchy(signal: AbortSignal): Promise<GoalHierarchy> {
  const goals = await goalsApi.list(signal)
  const projects = (await Promise.all(goals.map((goal) => goalsApi.listProjects(goal.id, signal)))).flat()
  const milestones = (await Promise.all(projects.map((project) => goalsApi.listMilestones(project.id, signal)))).flat()
  return { goals, projects, milestones }
}

export function useGoals(): UseGoalsResult {
  const queryClient = useQueryClient()
  const { csrfToken } = useAuth()
  const [mutationError, setMutationError] = useState<HttpError | null>(null)
  const query = useQuery({
    queryKey: queryKeys.goals.all,
    queryFn: ({ signal }) => loadHierarchy(signal),
  })
  const hierarchy = query.data ?? emptyHierarchy

  const setHierarchy = useCallback((update: (current: GoalHierarchy) => GoalHierarchy) => {
    queryClient.setQueryData<GoalHierarchy>(queryKeys.goals.all, (current) => update(current ?? emptyHierarchy))
  }, [queryClient])

  const invalidateHierarchy = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.goals.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.milestones.all }),
    ])
  }, [queryClient])

  const captureFailure = useCallback((error: unknown) => {
    setMutationError(typedError(error))
  }, [])

  const createGoal = useCallback(async (input: CreateGoalInput) => {
    setMutationError(null)
    try {
      const created = await goalsApi.create(input, idempotencyKey('goal'), csrfToken)
      setHierarchy((current) => ({ ...current, goals: [...current.goals, created] }))
      return created
    } catch (error) {
      captureFailure(error)
      throw error
    }
  }, [captureFailure, csrfToken, setHierarchy])

  const updateGoal = useCallback(async (id: string, input: UpdateGoalInput) => {
    setMutationError(null)
    const previous = queryClient.getQueryData<GoalHierarchy>(queryKeys.goals.all) ?? emptyHierarchy
    setHierarchy((current) => ({
      ...current,
      goals: current.goals.map((goal) => goal.id === id ? { ...goal, ...input, version: goal.version } : goal),
    }))
    try {
      const updated = await goalsApi.update(id, input, csrfToken)
      setHierarchy((current) => ({
        ...current,
        goals: current.goals.map((goal) => goal.id === id ? updated : goal),
      }))
      return updated
    } catch (error) {
      queryClient.setQueryData(queryKeys.goals.all, previous)
      captureFailure(error)
      throw error
    }
  }, [captureFailure, csrfToken, queryClient, setHierarchy])

  const archiveGoal = useCallback(async (id: string, version: number) => {
    setMutationError(null)
    try {
      await goalsApi.remove(id, version, csrfToken)
      await invalidateHierarchy()
    } catch (error) {
      captureFailure(error)
      throw error
    }
  }, [captureFailure, csrfToken, invalidateHierarchy])

  const restoreGoal = useCallback(async (id: string, version: number) => {
    setMutationError(null)
    try {
      const restored = await goalsApi.restore(id, version, csrfToken)
      await invalidateHierarchy()
      setHierarchy((current) => ({
        ...current,
        goals: current.goals.some((goal) => goal.id === id)
          ? current.goals.map((goal) => goal.id === id ? restored : goal)
          : [...current.goals, restored],
      }))
      return restored
    } catch (error) {
      captureFailure(error)
      throw error
    }
  }, [captureFailure, csrfToken, invalidateHierarchy, setHierarchy])

  const createProject = useCallback(async (goalId: string, input: CreateProjectInput) => {
    setMutationError(null)
    try {
      const created = await goalsApi.createProject(goalId, input, idempotencyKey('project'), csrfToken)
      setHierarchy((current) => ({ ...current, projects: [...current.projects, created] }))
      return created
    } catch (error) {
      captureFailure(error)
      throw error
    }
  }, [captureFailure, csrfToken, setHierarchy])

  const updateProject = useCallback(async (id: string, input: UpdateProjectInput) => {
    setMutationError(null)
    try {
      const updated = await goalsApi.updateProject(id, input, csrfToken)
      setHierarchy((current) => ({
        ...current,
        projects: current.projects.map((project) => project.id === id ? updated : project),
      }))
      return updated
    } catch (error) {
      captureFailure(error)
      throw error
    }
  }, [captureFailure, csrfToken, setHierarchy])

  const archiveProject = useCallback(async (id: string, version: number) => {
    setMutationError(null)
    try {
      await goalsApi.removeProject(id, version, csrfToken)
      await invalidateHierarchy()
    } catch (error) {
      captureFailure(error)
      throw error
    }
  }, [captureFailure, csrfToken, invalidateHierarchy])

  const restoreProject = useCallback(async (id: string, version: number) => {
    setMutationError(null)
    try {
      const restored = await goalsApi.restoreProject(id, version, csrfToken)
      await invalidateHierarchy()
      setHierarchy((current) => ({
        ...current,
        projects: current.projects.some((project) => project.id === id)
          ? current.projects.map((project) => project.id === id ? restored : project)
          : [...current.projects, restored],
      }))
      return restored
    } catch (error) {
      captureFailure(error)
      throw error
    }
  }, [captureFailure, csrfToken, invalidateHierarchy, setHierarchy])

  const createMilestone = useCallback(async (projectId: string, input: CreateMilestoneInput) => {
    setMutationError(null)
    try {
      const created = await goalsApi.createMilestone(projectId, input, idempotencyKey('milestone'), csrfToken)
      setHierarchy((current) => ({ ...current, milestones: [...current.milestones, created] }))
      return created
    } catch (error) {
      captureFailure(error)
      throw error
    }
  }, [captureFailure, csrfToken, setHierarchy])

  const completeMilestone = useCallback(async (id: string, version: number) => {
    setMutationError(null)
    try {
      const completed = await goalsApi.updateMilestone(id, { completedAt: new Date().toISOString(), version }, csrfToken)
      setHierarchy((current) => ({
        ...current,
        milestones: current.milestones.map((milestone) => milestone.id === id ? completed : milestone),
      }))
      return completed
    } catch (error) {
      captureFailure(error)
      throw error
    }
  }, [captureFailure, csrfToken, setHierarchy])

  const updateMilestone = useCallback(async (id: string, input: UpdateMilestoneInput) => {
    setMutationError(null)
    try {
      const updated = await goalsApi.updateMilestone(id, input, csrfToken)
      setHierarchy((current) => ({
        ...current,
        milestones: current.milestones.map((milestone) => milestone.id === id ? updated : milestone),
      }))
      return updated
    } catch (error) {
      captureFailure(error)
      throw error
    }
  }, [captureFailure, csrfToken, setHierarchy])

  const archiveMilestone = useCallback(async (id: string, version: number) => {
    setMutationError(null)
    try {
      await goalsApi.removeMilestone(id, version, csrfToken)
      await invalidateHierarchy()
    } catch (error) {
      captureFailure(error)
      throw error
    }
  }, [captureFailure, csrfToken, invalidateHierarchy])

  const restoreMilestone = useCallback(async (id: string, version: number) => {
    setMutationError(null)
    try {
      const restored = await goalsApi.restoreMilestone(id, version, csrfToken)
      await invalidateHierarchy()
      setHierarchy((current) => ({
        ...current,
        milestones: current.milestones.some((milestone) => milestone.id === id)
          ? current.milestones.map((milestone) => milestone.id === id ? restored : milestone)
          : [...current.milestones, restored],
      }))
      return restored
    } catch (error) {
      captureFailure(error)
      throw error
    }
  }, [captureFailure, csrfToken, invalidateHierarchy, setHierarchy])

  const queryError = typedError(query.error)
  const error = mutationError ?? queryError
  const status: GoalsStatus = query.isPending
    ? 'loading'
    : error
      ? errorStatus(error)
      : hierarchy.goals.length === 0
        ? 'empty'
        : 'ready'

  return {
    ...hierarchy,
    status,
    error,
    createGoal,
    updateGoal,
    archiveGoal,
    restoreGoal,
    createProject,
    updateProject,
    archiveProject,
    restoreProject,
    createMilestone,
    updateMilestone,
    completeMilestone,
    archiveMilestone,
    restoreMilestone,
    retry: () => {
      setMutationError(null)
      void query.refetch()
    },
  }
}
