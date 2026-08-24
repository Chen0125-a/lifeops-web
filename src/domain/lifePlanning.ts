export type LifePlanItemKind = 'meal' | 'supplement' | 'medicine' | 'fitness' | 'custom'
export type LifePlanItemStatus = 'planned' | 'in_progress' | 'completed' | 'skipped' | 'delayed'
export type TemplateConflictResolution = 'merge' | 'replace' | 'skip'

export interface MealSlot {
  id: string
  name: string
  position: number
  hidden: boolean
}

export interface PlanSourceReference {
  type: 'recipe-version' | 'catalog-item' | 'fitness-activity'
  id: string
  versionId?: string | null
}

export interface PlanActualSnapshot {
  source: PlanSourceReference | null
  quantity: number | null
  unit: string | null
  servings: number | null
  completedAt: string
  nutrition: Record<string, number> | null
  costMinor: number | null
  inventoryTransactionIds: string[]
  preparedFoodEventIds?: string[]
  actualMinutes: number | null
  estimatedEnergyKcal: number | null
  energyIsEstimate: boolean
}

export interface LifePlanItem {
  id: string
  kind: LifePlanItemKind
  title: string
  mealSlotId: string | null
  scheduledTime: string | null
  source: PlanSourceReference | null
  quantity: number | null
  unit: string | null
  servings: number | null
  durationMinutes: number | null
  status: LifePlanItemStatus
  completionId: string | null
  actual: PlanActualSnapshot | null
  originTemplateItemId: string | null
  entityVersion: number
}

export interface DayPlan {
  id: string
  date: string
  mealSlots: MealSlot[]
  items: LifePlanItem[]
  entityVersion: number
}

export interface TemplatePlanItem {
  id: string
  kind: LifePlanItemKind
  title: string
  mealSlotId: string | null
  scheduledTime: string | null
  weekdays?: number[]
  source: PlanSourceReference | null
  quantity: number | null
  unit: string | null
  servings: number | null
  durationMinutes: number | null
}

export interface PlanTemplate {
  id: string
  name: string
  mealSlots: MealSlot[]
  items: TemplatePlanItem[]
  entityVersion: number
}

export interface PlanItemInput {
  kind: LifePlanItemKind
  title: string
  mealSlotId?: string | null
  scheduledTime?: string | null
  weekdays?: number[]
  source?: PlanSourceReference | null
  quantity?: number | null
  unit?: string | null
  servings?: number | null
  durationMinutes?: number | null
  relativeToItemIndex?: number
  offsetMinutes?: number
}

export interface CreatePlanTemplateInput {
  name: string
  mealSlots: MealSlot[]
  items: PlanItemInput[]
}

export interface UpdatePlanTemplateInput extends CreatePlanTemplateInput { entityVersion: number }

export interface CreateDayPlanInput {
  date: string
  mealSlots: MealSlot[]
  items: PlanItemInput[]
}

export interface UpdateDayPlanItemInput extends PlanItemInput {
  id?: string
  entityVersion?: number
}

export interface UpdateDayPlanInput {
  entityVersion: number
  mealSlots: MealSlot[]
  items: UpdateDayPlanItemInput[]
}

export interface FitnessActivity {
  id: string
  name: string
  defaultMinutes: number
  kcalPerHour: number
  intensity: string
  steps: string[]
  equipment: string[]
  entityVersion: number
  createdAt: string
  updatedAt: string
}

export interface CreateFitnessActivityInput {
  name: string
  defaultMinutes: number
  kcalPerHour: number
  intensity: string
  steps: string[]
  equipment: string[]
}

export interface PlanningCompletionSnapshot extends PlanActualSnapshot {
  id: string
  dayPlanId: string | null
  dayPlanItemId: string | null
  kind: LifePlanItemKind
  completionSource: PlanningCompletionSource
}

export type PlanningCompletionSource =
  | { type: 'day-plan-item'; dayPlanId: string; dayPlanItemId: string }
  | {
      type: 'medicine-occurrence'
      id: string
      ruleId: string
      originalDate: string
      originalTime: string
      scheduledDate: string
      scheduledTime: string
    }

export interface CalendarDaySummary {
  date: string
  state: 'planned' | 'complete' | 'past-incomplete' | 'conflicted'
  itemCount: number
  completedCount: number
}

export interface TemplateConflict {
  id: string
  existingItemIds: string[]
  incomingTemplateItemId: string
  resolution: TemplateConflictResolution
}

export interface TemplateApplicationPreview {
  writesApplied: false
  templateVersion: number
  dayPlanVersion: number
  conflicts: TemplateConflict[]
  result: DayPlan
}

export interface TemplateSyncPreview {
  writesApplied: false
  templateVersion: number
  dayPlanVersions: Record<string, number>
  affectedDates: string[]
  excludedCompletedDates: string[]
  changes: Array<{ date: string; before: LifePlanItem[]; after: LifePlanItem[] }>
}

export interface TemplateSyncInput {
  fromDate: string
  target: 'future-incomplete' | 'selected'
  dates?: string[]
}

export interface TemplateSyncConfirmationInput extends TemplateSyncInput {
  templateVersion: number
  dayPlanVersions: Record<string, number>
}

export interface MedicineRecurrence {
  mode: 'weekdays' | 'interval'
  times: string[]
  weekdays?: number[]
  everyDays?: number
  startDate: string
  endDate: string
}

export interface MedicineRecurrenceRule {
  id: string
  title: string
  sourceId: string
  quantity: number
  unit: string
  recurrence: MedicineRecurrence
  entityVersion: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface MedicineRecurrenceOccurrence {
  id: string
  ruleId: string
  entityVersion: number
  kind: 'medicine'
  title: string
  source: PlanSourceReference & { type: 'catalog-item' }
  quantity: number
  unit: string
  originalDate: string
  originalTime: string
  scheduledDate: string
  scheduledTime: string
  status: 'planned' | 'completed' | 'skipped' | 'cancelled'
  completionId: string | null
  createdAt: string
  updatedAt: string
}

export type PlanningTimelineItem =
  | (LifePlanItem & { sourceType: 'day-plan-item' })
  | (MedicineRecurrenceOccurrence & { sourceType: 'medicine-occurrence' })

export interface PlanningTimeline {
  date: string
  timelineItems: PlanningTimelineItem[]
}

export interface CreateMedicineRecurrenceRuleInput {
  title: string
  sourceId: string
  quantity: number
  unit: string
  recurrence: MedicineRecurrence
}

export interface UpdateMedicineRecurrenceRuleInput extends CreateMedicineRecurrenceRuleInput {
  entityVersion: number
}

export interface MedicineRecurrencePreview {
  writesApplied: false
  occurrences: Array<{ date: string; time: string; factual: true }>
}

export type PlanningInventoryProjection =
  | {
      status: 'complete'
      itemId: string
      baseUnit: string
      onHand: number
      plannedDemand: number
      projectedBalance: number
      shortage: number
    }
  | {
      status: 'incomplete'
      itemId: string
      baseUnit: string | null
      onHand: number | null
      plannedDemand: null
      projectedBalance: null
      shortage: null
      reason: 'missing_conversion'
    }

export interface PreparedFoodPlanProjection {
  stockIds: string[]
  portionsAvailable: number
  portionsAllocated: number
  portionsRemainingAfterPlan: number
}

export interface DayPlanItemProjection {
  dayPlanItemId: string
  kind: LifePlanItemKind
  mode: 'planned' | 'actual'
  status: 'complete' | 'incomplete' | 'not-applicable'
  source: PlanSourceReference | null
  nutrition: Record<string, number> | null
  costMinor: number | null
  estimatedEnergyKcal: number | null
  inventory: PlanningInventoryProjection[]
  preparedFood: PreparedFoodPlanProjection | null
  missing: string[]
}

export interface DayPlanProjection {
  date: string
  status: 'complete' | 'incomplete'
  plannedNutrition: Record<string, number> | null
  actualNutrition: Record<string, number>
  plannedCostMinor: number | null
  actualCostMinor: number
  plannedEnergyKcal: number
  actualEnergyKcal: number
  sourceIds: string[]
  inventory: PlanningInventoryProjection[]
  items: DayPlanItemProjection[]
}

export interface TransitionDayPlanItemInput {
  entityVersion: number
  action: 'complete' | 'skip' | 'delay' | 'backfill'
  at: string
  delayedUntil?: string
}

export type MedicineOccurrenceTransitionInput =
  | { entityVersion: number; action: 'skip'; at: string; delayedUntil?: never }
  | { entityVersion: number; action: 'delay'; at: string; delayedUntil: { date: string; time: string } }

export type CreatePlanningCompletionInput =
  | {
      date: string
      dayPlanItemId: string
      medicineOccurrenceId?: never
      medicineOccurrenceVersion?: never
      completedAt: string
      actualMinutes?: number
      overrideEnergyKcal?: number
    }
  | {
      date?: never
      dayPlanItemId?: never
      medicineOccurrenceId: string
      medicineOccurrenceVersion: number
      completedAt: string
      actualMinutes?: never
      overrideEnergyKcal?: never
    }

export interface UndoPlanningCompletionResult {
  completionId: string
  reversedInventoryTransactionIds: string[]
  restoredPreparedFoodEventIds?: string[]
  status: 'planned' | 'cancelled'
}
