import type {
  CalendarDaySummary,
  CreateDayPlanInput,
  CreateFitnessActivityInput,
  CreateMedicineRecurrenceRuleInput,
  CreatePlanningCompletionInput,
  CreatePlanTemplateInput,
  DayPlan,
  DayPlanProjection,
  FitnessActivity,
  LifePlanItem,
  MedicineRecurrence,
  MedicineOccurrenceTransitionInput,
  MedicineRecurrenceOccurrence,
  MedicineRecurrenceRule,
  MedicineRecurrencePreview,
  PlanSourceReference,
  PlanTemplate,
  PlanningCompletionSnapshot,
  PlanningTimeline,
  TemplateApplicationPreview,
  TemplateConflictResolution,
  TemplateSyncInput,
  TemplateSyncConfirmationInput,
  TemplateSyncPreview,
  TransitionDayPlanItemInput,
  UndoPlanningCompletionResult,
  UpdateDayPlanInput,
  UpdatePlanTemplateInput,
  UpdateMedicineRecurrenceRuleInput,
} from '../domain/lifePlanning'
import { http } from './httpClient'
import { queryClient } from './queryClient'
import { queryKeys } from './queryKeys'

const segment = (value: string) => encodeURIComponent(value)

async function mutation<T>(request: Promise<T>) {
  const result = await request
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.lifePlanning.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.lifeInventory.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.lifeCatalog.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.lifeRecipes.all }),
  ])
  return result
}

export const lifePlanningApi = {
  listTemplates: (signal?: AbortSignal): Promise<PlanTemplate[]> =>
    http.request('/life/templates', { signal }),
  getDayPlan: (date: string, signal?: AbortSignal): Promise<DayPlan> =>
    http.request(`/life/day-plans/${segment(date)}`, { signal }),
  getDayProjection: (date: string, signal?: AbortSignal): Promise<DayPlanProjection> =>
    http.request(`/life/day-plans/${segment(date)}/projection`, { signal }),
  getTimeline: (date: string, signal?: AbortSignal): Promise<PlanningTimeline> =>
    http.request(`/life/timeline/${segment(date)}`, { signal }),
  listCalendar: (
    input: { from: string; to: string; today?: string },
    signal?: AbortSignal,
  ): Promise<CalendarDaySummary[]> => {
    const query = new URLSearchParams({ from: input.from, to: input.to })
    if (input.today) query.set('today', input.today)
    return http.request(`/life/calendar?${query}`, { signal })
  },
  listMedicineRecurrenceRules: (signal?: AbortSignal): Promise<MedicineRecurrenceRule[]> =>
    http.request('/life/day-plans/recurrence-rules', { signal }),
  listFitness: (signal?: AbortSignal): Promise<FitnessActivity[]> =>
    http.request('/life/fitness', { signal }),

  createTemplate: (
    input: CreatePlanTemplateInput,
    idempotencyKey: string,
    csrf?: string,
  ): Promise<PlanTemplate> => mutation(
    http.request('/life/templates', { method: 'POST', body: input, csrf, idempotencyKey }),
  ),
  updateTemplate: (
    id: string,
    input: UpdatePlanTemplateInput,
    csrf?: string,
  ): Promise<PlanTemplate> => mutation(
    http.request(`/life/templates/${segment(id)}`, { method: 'PATCH', body: input, csrf }),
  ),
  createDayPlan: (
    input: CreateDayPlanInput,
    idempotencyKey: string,
    csrf?: string,
  ): Promise<DayPlan> => mutation(
    http.request('/life/day-plans', { method: 'POST', body: input, csrf, idempotencyKey }),
  ),
  updateDayPlan: (
    date: string,
    input: UpdateDayPlanInput,
    csrf?: string,
  ): Promise<DayPlan> => mutation(
    http.request(`/life/day-plans/${segment(date)}`, { method: 'PATCH', body: input, csrf }),
  ),
  previewTemplate: (
    date: string,
    input: { templateId: string; resolution: TemplateConflictResolution },
    csrf?: string,
  ): Promise<TemplateApplicationPreview> => http.request(
    `/life/day-plans/${segment(date)}/template-preview`,
    { method: 'POST', body: input, csrf },
  ),
  applyTemplate: (
    date: string,
    input: { templateId: string; resolution: TemplateConflictResolution; entityVersion: number; templateVersion: number },
    idempotencyKey: string,
    csrf?: string,
  ): Promise<DayPlan> => mutation(
    http.request(`/life/day-plans/${segment(date)}/apply-template`, {
      method: 'POST', body: input, csrf, idempotencyKey,
    }),
  ),
  copyDayPlan: (
    date: string,
    targetDate: string,
    idempotencyKey: string,
    csrf?: string,
  ): Promise<DayPlan> => mutation(
    http.request(`/life/day-plans/${segment(date)}/copy`, {
      method: 'POST', body: { targetDate }, csrf, idempotencyKey,
    }),
  ),
  transitionItem: (
    date: string,
    itemId: string,
    input: TransitionDayPlanItemInput,
    csrf?: string,
  ): Promise<LifePlanItem> => mutation(
    http.request(`/life/day-plans/${segment(date)}/items/${segment(itemId)}`, {
      method: 'PATCH', body: input, csrf,
    }),
  ),
  previewSync: (
    templateId: string,
    input: TemplateSyncInput,
    csrf?: string,
  ): Promise<TemplateSyncPreview> => http.request(
    `/life/templates/${segment(templateId)}/sync-preview`,
    { method: 'POST', body: input, csrf },
  ),
  syncTemplate: (
    templateId: string,
    input: TemplateSyncConfirmationInput,
    idempotencyKey: string,
    csrf?: string,
  ): Promise<{ affectedDates: string[]; excludedCompletedDates: string[] }> => mutation(
    http.request(`/life/templates/${segment(templateId)}/sync`, {
      method: 'POST', body: input, csrf, idempotencyKey,
    }),
  ),
  previewMedicineRecurrence: (
    input: { kind: 'medicine'; source: PlanSourceReference; recurrence: MedicineRecurrence },
    csrf?: string,
  ): Promise<MedicineRecurrencePreview> => http.request(
    '/life/day-plans/recurrence-preview',
    { method: 'POST', body: input, csrf },
  ),
  createMedicineRecurrenceRule: (
    input: CreateMedicineRecurrenceRuleInput,
    idempotencyKey: string,
    csrf?: string,
  ): Promise<MedicineRecurrenceRule> => mutation(
    http.request('/life/day-plans/recurrence-rules', { method: 'POST', body: input, csrf, idempotencyKey }),
  ),
  updateMedicineRecurrenceRule: (
    id: string,
    input: UpdateMedicineRecurrenceRuleInput,
    csrf?: string,
  ): Promise<MedicineRecurrenceRule> => mutation(
    http.request(`/life/day-plans/recurrence-rules/${segment(id)}`, { method: 'PATCH', body: input, csrf }),
  ),
  deleteMedicineRecurrenceRule: (
    id: string,
    entityVersion: number,
    csrf?: string,
  ): Promise<void> => mutation(
    http.request(`/life/day-plans/recurrence-rules/${segment(id)}`, { method: 'DELETE', body: { entityVersion }, csrf }),
  ),
  transitionMedicineOccurrence: (
    id: string,
    input: MedicineOccurrenceTransitionInput,
    idempotencyKey: string,
    csrf?: string,
  ): Promise<MedicineRecurrenceOccurrence> => mutation(
    http.request(`/life/day-plans/medicine-occurrences/${segment(id)}`, {
      method: 'PATCH', body: input, csrf, idempotencyKey,
    }),
  ),
  createFitness: (
    input: CreateFitnessActivityInput,
    idempotencyKey: string,
    csrf?: string,
  ): Promise<FitnessActivity> => mutation(
    http.request('/life/fitness', { method: 'POST', body: input, csrf, idempotencyKey }),
  ),
  createCompletion: (
    input: CreatePlanningCompletionInput,
    idempotencyKey: string,
    csrf?: string,
  ): Promise<PlanningCompletionSnapshot> => mutation(
    http.request('/life/completions', { method: 'POST', body: input, csrf, idempotencyKey }),
  ),
  undoCompletion: (
    id: string,
    idempotencyKey: string,
    csrf?: string,
  ): Promise<UndoPlanningCompletionResult> => mutation(
    http.request(`/life/completions/${segment(id)}/undo`, {
      method: 'POST', body: {}, csrf, idempotencyKey,
    }),
  ),
}
