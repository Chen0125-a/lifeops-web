import type {
  CorrectHabitEntryInput,
  CreateHabitEntryInput,
  CreateHabitInput,
  Habit,
  HabitEntry,
  HabitWindow,
  UpdateHabitInput,
} from '../domain/habits'
import { http } from './httpClient'

const segment = (value: string) => encodeURIComponent(value)

function windowQuery(filters: { from?: string; to?: string }) {
  const query = new URLSearchParams()
  if (filters.from) query.set('from', filters.from)
  if (filters.to) query.set('to', filters.to)
  const value = query.toString()
  return value ? `?${value}` : ''
}

function entryPath(habitId: string, entryDate: string) {
  return `/habits/${segment(habitId)}/entries/${segment(entryDate)}`
}

export const habitsApi = {
  list: (filters: { from?: string; to?: string } = {}, signal?: AbortSignal) =>
    http.request<HabitWindow>(`/habits${windowQuery(filters)}`, { signal }),
  get: (id: string, signal?: AbortSignal) =>
    http.request<Habit>(`/habits/${segment(id)}`, { signal }),
  create: (input: CreateHabitInput, idempotencyKey: string, csrf?: string) =>
    http.request<Habit>('/habits', { method: 'POST', body: input, csrf, idempotencyKey }),
  update: (id: string, input: UpdateHabitInput, csrf?: string) =>
    http.request<Habit>(`/habits/${segment(id)}`, { method: 'PATCH', body: input, csrf }),
  createEntry: (
    habitId: string,
    entryDate: string,
    input: CreateHabitEntryInput,
    idempotencyKey: string,
    csrf?: string,
  ) => http.request<HabitEntry>(entryPath(habitId, entryDate), {
    method: 'PUT', body: input, csrf, idempotencyKey,
  }),
  correctEntry: (
    habitId: string,
    entryDate: string,
    input: CorrectHabitEntryInput,
    csrf?: string,
  ) => http.request<HabitEntry>(entryPath(habitId, entryDate), {
    method: 'PUT', body: input, csrf,
  }),
}
