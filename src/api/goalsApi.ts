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
} from '../domain/goals'
import { http } from './httpClient'

const segment = (value: string) => encodeURIComponent(value)

export const goalsApi = {
  list: (signal?: AbortSignal) => http.request<Goal[]>('/goals', { signal }),
  get: (id: string, signal?: AbortSignal) => http.request<Goal>(`/goals/${segment(id)}`, { signal }),
  create: (input: CreateGoalInput, idempotencyKey: string, csrf?: string) => http.request<Goal>('/goals', {
    method: 'POST',
    body: input,
    csrf,
    idempotencyKey,
  }),
  update: (id: string, input: UpdateGoalInput, csrf?: string) => http.request<Goal>(`/goals/${segment(id)}`, {
    method: 'PATCH',
    body: input,
    csrf,
  }),
  remove: (id: string, version: number, csrf?: string) => http.request<void>(`/goals/${segment(id)}`, {
    method: 'DELETE',
    body: { version },
    csrf,
  }),
  restore: (id: string, version: number, csrf?: string) => http.request<Goal>(`/goals/${segment(id)}/restore`, {
    method: 'POST',
    body: { version },
    csrf,
  }),

  listProjects: (goalId: string, signal?: AbortSignal) => http.request<Project[]>(`/goals/${segment(goalId)}/projects`, { signal }),
  getProject: (id: string, signal?: AbortSignal) => http.request<Project>(`/projects/${segment(id)}`, { signal }),
  createProject: (goalId: string, input: CreateProjectInput, idempotencyKey: string, csrf?: string) => http.request<Project>(`/goals/${segment(goalId)}/projects`, {
    method: 'POST',
    body: input,
    csrf,
    idempotencyKey,
  }),
  updateProject: (id: string, input: UpdateProjectInput, csrf?: string) => http.request<Project>(`/projects/${segment(id)}`, {
    method: 'PATCH',
    body: input,
    csrf,
  }),
  removeProject: (id: string, version: number, csrf?: string) => http.request<void>(`/projects/${segment(id)}`, {
    method: 'DELETE',
    body: { version },
    csrf,
  }),
  restoreProject: (id: string, version: number, csrf?: string) => http.request<Project>(`/projects/${segment(id)}/restore`, {
    method: 'POST',
    body: { version },
    csrf,
  }),

  listMilestones: (projectId: string, signal?: AbortSignal) => http.request<Milestone[]>(`/projects/${segment(projectId)}/milestones`, { signal }),
  getMilestone: (id: string, signal?: AbortSignal) => http.request<Milestone>(`/milestones/${segment(id)}`, { signal }),
  createMilestone: (projectId: string, input: CreateMilestoneInput, idempotencyKey: string, csrf?: string) => http.request<Milestone>(`/projects/${segment(projectId)}/milestones`, {
    method: 'POST',
    body: input,
    csrf,
    idempotencyKey,
  }),
  updateMilestone: (id: string, input: UpdateMilestoneInput, csrf?: string) => http.request<Milestone>(`/milestones/${segment(id)}`, {
    method: 'PATCH',
    body: input,
    csrf,
  }),
  removeMilestone: (id: string, version: number, csrf?: string) => http.request<void>(`/milestones/${segment(id)}`, {
    method: 'DELETE',
    body: { version },
    csrf,
  }),
  restoreMilestone: (id: string, version: number, csrf?: string) => http.request<Milestone>(`/milestones/${segment(id)}/restore`, {
    method: 'POST',
    body: { version },
    csrf,
  }),
}
