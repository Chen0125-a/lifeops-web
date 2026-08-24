import type {
  ChecklistItem,
  CreateTaskInput,
  ScheduleBlock,
  ScheduleConflict,
  Task,
  UpdateTaskInput,
} from '../domain/tasks'
import { http } from './httpClient'

const segment = (value: string) => encodeURIComponent(value)

function scheduleQuery(from?: string, to?: string) {
  const query = new URLSearchParams()
  if (from) query.set('from', from)
  if (to) query.set('to', to)
  const value = query.toString()
  return value ? `?${value}` : ''
}

export const tasksApi = {
  list: (signal?: AbortSignal) => http.request<Task[]>('/tasks', { signal }),
  get: (id: string, signal?: AbortSignal) => http.request<Task>(`/tasks/${segment(id)}`, { signal }),
  create: (input: CreateTaskInput, idempotencyKey: string, csrf?: string) => http.request<Task>('/tasks', {
    method: 'POST',
    body: input,
    csrf,
    idempotencyKey,
  }),
  update: (id: string, input: UpdateTaskInput, csrf?: string) => http.request<Task>(`/tasks/${segment(id)}`, {
    method: 'PATCH',
    body: input,
    csrf,
  }),
  remove: (id: string, version: number, csrf?: string) => http.request<void>(`/tasks/${segment(id)}`, {
    method: 'DELETE',
    body: { version },
    csrf,
  }),
  complete: (id: string, version: number, csrf?: string) => http.request<Task>(`/tasks/${segment(id)}/complete`, {
    method: 'POST',
    body: { version },
    csrf,
  }),
  undoCompletion: (id: string, version: number, csrf?: string) => http.request<Task>(`/tasks/${segment(id)}/complete`, {
    method: 'DELETE',
    body: { version },
    csrf,
  }),

  addChecklistItem: (taskId: string, input: { title: string; position?: number }, idempotencyKey: string, csrf?: string) => http.request<ChecklistItem>(`/tasks/${segment(taskId)}/checklist`, {
    method: 'POST',
    body: input,
    csrf,
    idempotencyKey,
  }),
  updateChecklistItem: (taskId: string, id: string, input: { title?: string; isCompleted?: boolean; position?: number; version: number }, csrf?: string) => http.request<ChecklistItem>(`/tasks/${segment(taskId)}/checklist/${segment(id)}`, {
    method: 'PATCH',
    body: input,
    csrf,
  }),
  removeChecklistItem: (taskId: string, id: string, version: number, csrf?: string) => http.request<void>(`/tasks/${segment(taskId)}/checklist/${segment(id)}`, {
    method: 'DELETE',
    body: { version },
    csrf,
  }),

  listScheduleBlocks: (filters: { from?: string; to?: string } = {}, signal?: AbortSignal) => http.request<ScheduleBlock[]>(`/schedule-blocks${scheduleQuery(filters.from, filters.to)}`, { signal }),
  createScheduleBlock: (input: { taskId: string; startsAt: string; endsAt: string }, idempotencyKey: string, csrf?: string) => http.request<ScheduleBlock>('/schedule-blocks', {
    method: 'POST',
    body: input,
    csrf,
    idempotencyKey,
  }),
  updateScheduleBlock: (id: string, input: { startsAt?: string; endsAt?: string; version: number }, csrf?: string) => http.request<ScheduleBlock>(`/schedule-blocks/${segment(id)}`, {
    method: 'PATCH',
    body: input,
    csrf,
  }),
  removeScheduleBlock: (id: string, version: number, csrf?: string) => http.request<void>(`/schedule-blocks/${segment(id)}`, {
    method: 'DELETE',
    body: { version },
    csrf,
  }),
  conflicts: (from: string, to: string, signal?: AbortSignal) => http.request<ScheduleConflict[]>(`/schedule/conflicts${scheduleQuery(from, to)}`, { signal }),
}
