import type {
  CalendarDaySummary,
  CreateDayPlanInput,
  CreateFitnessActivityInput,
  CreateMedicineRecurrenceRuleInput,
  CreatePlanTemplateInput,
  DayPlan,
  DayPlanProjection,
  FitnessActivity,
  LifePlanItem,
  MedicineRecurrence,
  MedicineOccurrenceTransitionInput,
  MedicineRecurrenceOccurrence,
  MedicineRecurrenceRule,
  PlanningCompletionInput,
  PlanTemplate,
  PlanningCompletionSnapshot,
  PlanningTimeline,
  TemplateApplicationPreview,
  TemplateConflictResolution,
  TemplateSyncPreview,
  UpdatePlanTemplateInput,
  UpdateDayPlanInput,
  UpdateMedicineRecurrenceRuleInput,
} from '../domain/life/planning.js'

export interface LifePlanningStore {
  getPlanningCatalogReferences(userId: string, itemId: string): Promise<{ templateIds: string[]; futurePlanIds: string[] }>
  listPlanTemplates(userId: string): Promise<PlanTemplate[]>
  getPlanTemplate(userId: string, id: string): Promise<PlanTemplate | undefined>
  createPlanTemplate(userId: string, input: CreatePlanTemplateInput, idempotencyKey: string): Promise<PlanTemplate>
  updatePlanTemplate(userId: string, id: string, input: UpdatePlanTemplateInput): Promise<PlanTemplate | undefined>

  getDayPlan(userId: string, date: string): Promise<DayPlan | undefined>
  getDayPlanProjection(userId: string, date: string): Promise<DayPlanProjection | undefined>
  listDayPlanProjections(userId: string, from: string, through: string): Promise<DayPlanProjection[]>
  createDayPlan(userId: string, input: CreateDayPlanInput, idempotencyKey: string): Promise<DayPlan>
  updateDayPlan(userId: string, date: string, input: UpdateDayPlanInput): Promise<DayPlan | undefined>
  previewTemplateApplication(userId: string, date: string, templateId: string, resolution: TemplateConflictResolution): Promise<TemplateApplicationPreview | undefined>
  applyTemplateToDayPlan(userId: string, date: string, input: { templateId: string; resolution: TemplateConflictResolution; entityVersion: number; templateVersion: number }, idempotencyKey: string): Promise<DayPlan | undefined>
  copyDayPlan(userId: string, date: string, targetDate: string, idempotencyKey: string): Promise<DayPlan | undefined>
  previewTemplateSync(userId: string, templateId: string, input: { fromDate: string; target: 'future-incomplete' | 'selected'; dates?: string[] }): Promise<TemplateSyncPreview | undefined>
  syncPlanTemplate(userId: string, templateId: string, input: { fromDate: string; target: 'future-incomplete' | 'selected'; dates?: string[]; templateVersion: number; dayPlanVersions: Record<string, number> }, idempotencyKey: string): Promise<{ affectedDates: string[]; excludedCompletedDates: string[] } | undefined>
  previewMedicineRecurrence(userId: string, sourceId: string, recurrence: MedicineRecurrence): Promise<{ writesApplied: false; occurrences: Array<{ date: string; time: string; factual: true }> }>
  listMedicineRecurrenceRules(userId: string): Promise<MedicineRecurrenceRule[]>
  createMedicineRecurrenceRule(userId: string, input: CreateMedicineRecurrenceRuleInput, idempotencyKey: string): Promise<MedicineRecurrenceRule>
  updateMedicineRecurrenceRule(userId: string, id: string, input: UpdateMedicineRecurrenceRuleInput): Promise<MedicineRecurrenceRule | undefined>
  deleteMedicineRecurrenceRule(userId: string, id: string, entityVersion: number): Promise<boolean>
  transitionMedicineOccurrence(userId: string, id: string, input: MedicineOccurrenceTransitionInput, idempotencyKey: string): Promise<MedicineRecurrenceOccurrence | undefined>
  listCalendar(userId: string, from: string, to: string, today: string): Promise<CalendarDaySummary[]>
  getPlanningTimeline(userId: string, date: string): Promise<PlanningTimeline>

  listFitnessActivities(userId: string): Promise<FitnessActivity[]>
  createFitnessActivity(userId: string, input: CreateFitnessActivityInput, idempotencyKey: string): Promise<FitnessActivity>
  transitionDayPlanItem(userId: string, date: string, itemId: string, input: { entityVersion: number; action: 'complete' | 'skip' | 'delay' | 'backfill'; at: string; delayedUntil?: string }): Promise<LifePlanItem | undefined>
  createPlanningCompletion(userId: string, input: { date: string; dayPlanItemId: string; completedAt: string; actualMinutes?: number; overrideEnergyKcal?: number }, idempotencyKey: string): Promise<PlanningCompletionSnapshot>
  createPlanningCompletionFromSource(userId: string, input: PlanningCompletionInput, idempotencyKey: string): Promise<PlanningCompletionSnapshot>
  undoPlanningCompletion(userId: string, completionId: string, idempotencyKey: string): Promise<{ completionId: string; reversedInventoryTransactionIds: string[]; restoredPreparedFoodEventIds?: string[]; status: 'planned' | 'cancelled' } | undefined>
}
