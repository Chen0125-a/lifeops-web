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

export interface PlanTemplate {
  id: string
  name: string
  mealSlots: MealSlot[]
  items: TemplatePlanItem[]
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

export interface UpdatePlanTemplateInput extends CreatePlanTemplateInput {
  entityVersion: number
}

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

export interface ReconciledDayPlanDraftItem {
  id?: string
  entityVersion?: number
  value: LifePlanItem
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

export type PlanningCompletionInput =
  | {
      source: { type: 'day-plan-item'; date: string; dayPlanItemId: string }
      completedAt: string
      actualMinutes?: number
      overrideEnergyKcal?: number
    }
  | {
      source: { type: 'medicine-occurrence'; id: string; entityVersion: number }
      completedAt: string
    }

export interface PlanningCompletionSnapshot extends PlanActualSnapshot {
  id: string
  dayPlanId: string | null
  dayPlanItemId: string | null
  kind: LifePlanItemKind
  completionSource: PlanningCompletionSource
}

export interface CalendarDaySummary {
  date: string
  state: 'planned' | 'complete' | 'past-incomplete' | 'conflicted'
  itemCount: number
  completedCount: number
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

export interface TemplateSyncPreview {
  writesApplied: false
  templateVersion: number
  dayPlanVersions: Record<string, number>
  affectedDates: string[]
  excludedCompletedDates: string[]
  changes: Array<{ date: string; before: LifePlanItem[]; after: LifePlanItem[] }>
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
  source: { type: 'catalog-item'; id: string }
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

export type MedicineOccurrenceTransitionInput =
  | { entityVersion: number; action: 'skip'; at: string }
  | { entityVersion: number; action: 'delay'; at: string; scheduledDate: string; scheduledTime: string }

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

export class LifePlanningDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'LifePlanningDomainError'
  }
}

const clone = <T>(value: T): T => structuredClone(value)
const dateOnly = /^\d{4}-\d{2}-\d{2}$/
const MAX_MEDICINE_RECURRENCE_DAYS = 366
const MAX_MEDICINE_RECURRENCE_OCCURRENCES = 10_000
const timeOnly = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const finiteNonNegative = (value: number, field: string) => {
  if (!Number.isFinite(value) || value < 0) throw new LifePlanningDomainError('INVALID_INPUT', `${field} must be non-negative.`)
  return value
}
const validDate = (value: string, field: string) => {
  if (!dateOnly.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new LifePlanningDomainError('INVALID_DATE', `${field} must be a real date-only value.`)
  }
  return value
}
const validTimestamp = (value: string, field: string) => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new LifePlanningDomainError('INVALID_DATE', `${field} must be a valid timestamp.`)
  return parsed.toISOString()
}
const validTime = (value: string, field: string) => {
  if (!timeOnly.test(value)) throw new LifePlanningDomainError('INVALID_TIME', `${field} must use HH:mm.`)
  return value
}
const round = (value: number) => Math.round((value + Number.EPSILON) * 1_000_000_000) / 1_000_000_000

function plannedFromTemplate(entry: TemplatePlanItem): LifePlanItem {
  return {
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    mealSlotId: entry.mealSlotId,
    scheduledTime: entry.scheduledTime,
    source: clone(entry.source),
    quantity: entry.quantity,
    unit: entry.unit,
    servings: entry.servings,
    durationMinutes: entry.durationMinutes,
    status: 'planned',
    completionId: null,
    actual: null,
    originTemplateItemId: entry.id,
    entityVersion: 1,
  }
}

function conflictCandidates(items: LifePlanItem[], incoming: TemplatePlanItem) {
  return items.filter((existing) => (
    existing.kind === incoming.kind
    && existing.mealSlotId === incoming.mealSlotId
    && existing.scheduledTime === incoming.scheduledTime
  ))
}

export function previewTemplateApplication(input: {
  dayPlan: DayPlan
  template: PlanTemplate
  resolution: TemplateConflictResolution
}): TemplateApplicationPreview {
  if (!['merge', 'replace', 'skip'].includes(input.resolution)) {
    throw new LifePlanningDomainError('INVALID_CONFLICT_RESOLUTION', 'An explicit merge, replace or skip choice is required.')
  }
  const result = clone(input.dayPlan)
  const slotIds = new Set(result.mealSlots.map((slot) => slot.id))
  for (const slot of input.template.mealSlots) {
    if (!slotIds.has(slot.id)) {
      result.mealSlots.push(clone(slot))
      slotIds.add(slot.id)
    }
  }
  result.mealSlots.sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
  const weekday = new Date(`${validDate(result.date, 'day plan date')}T00:00:00.000Z`).getUTCDay()
  const conflicts: TemplateConflict[] = []
  for (const incoming of input.template.items.filter((entry) => !entry.weekdays?.length || entry.weekdays.includes(weekday))) {
    const existing = conflictCandidates(result.items, incoming)
    if (existing.length) {
      conflicts.push({
        id: `${input.template.id}:${incoming.id}:${existing.map((entry) => entry.id).sort().join(',')}`,
        existingItemIds: existing.map((entry) => entry.id).sort(),
        incomingTemplateItemId: incoming.id,
        resolution: input.resolution,
      })
      if (input.resolution === 'skip') continue
      if (input.resolution === 'replace') {
        const ids = new Set(existing.filter((entry) => entry.status !== 'completed').map((entry) => entry.id))
        result.items = result.items.filter((entry) => !ids.has(entry.id))
      }
    }
    result.items.push(plannedFromTemplate(incoming))
  }
  return {
    writesApplied: false,
    templateVersion: input.template.entityVersion,
    dayPlanVersion: input.dayPlan.entityVersion,
    conflicts,
    result,
  }
}

export function copyPlannedDay(input: {
  source: DayPlan
  targetDate: string
  createId: () => string
}): DayPlan {
  const targetDate = validDate(input.targetDate, 'targetDate')
  return {
    id: `${input.source.id}:${targetDate}`,
    date: targetDate,
    mealSlots: clone(input.source.mealSlots),
    items: input.source.items.map((entry) => ({
      ...clone(entry),
      id: input.createId(),
      status: 'planned',
      completionId: null,
      actual: null,
      entityVersion: 1,
    })),
    entityVersion: 1,
  }
}

export function reconcileDayPlanDraft(input: {
  dayPlan: DayPlan
  entityVersion: number
  mealSlots: MealSlot[]
  items: ReconciledDayPlanDraftItem[]
}): DayPlan {
  if (input.dayPlan.entityVersion !== input.entityVersion) {
    throw new LifePlanningDomainError('VERSION_CONFLICT', 'The day plan changed since it was loaded.', 409)
  }
  const currentById = new Map(input.dayPlan.items.map((item) => [item.id, item]))
  const seen = new Set<string>()
  const editableFacts = (value: LifePlanItem) => ({
    kind: value.kind,
    title: value.title,
    mealSlotId: value.mealSlotId,
    scheduledTime: value.scheduledTime,
    source: value.source,
    quantity: value.quantity,
    unit: value.unit,
    servings: value.servings,
    durationMinutes: value.durationMinutes,
  })
  const sameEditableFacts = (left: LifePlanItem, right: LifePlanItem) => (
    JSON.stringify(editableFacts(left)) === JSON.stringify(editableFacts(right))
  )
  const items = input.items.map((entry) => {
    if (entry.id == null) {
      if (entry.entityVersion != null) {
        throw new LifePlanningDomainError('INVALID_INPUT', 'A new day-plan item cannot declare an entity version.')
      }
      return clone(entry.value)
    }
    if (seen.has(entry.id)) {
      throw new LifePlanningDomainError('DUPLICATE_DAY_PLAN_ITEM', 'A day-plan item can appear only once.', 409)
    }
    seen.add(entry.id)
    const current = currentById.get(entry.id)
    if (!current) {
      throw new LifePlanningDomainError('DAY_PLAN_ITEM_CONFLICT', 'The day-plan item is not part of the current plan.', 409)
    }
    if (entry.entityVersion == null || current.entityVersion !== entry.entityVersion) {
      throw new LifePlanningDomainError('VERSION_CONFLICT', 'A day-plan item changed since it was loaded.', 409)
    }
    const changed = !sameEditableFacts(current, entry.value)
    if (current.status === 'completed' && changed) {
      throw new LifePlanningDomainError('COMPLETED_ITEM_IMMUTABLE', 'Completed plan item facts are immutable.', 409)
    }
    return {
      ...clone(entry.value),
      id: current.id,
      status: current.status,
      completionId: current.completionId,
      actual: clone(current.actual),
      originTemplateItemId: current.originTemplateItemId,
      entityVersion: current.entityVersion + (changed ? 1 : 0),
    }
  })
  const omittedCompleted = input.dayPlan.items.find((item) => item.status === 'completed' && !seen.has(item.id))
  if (omittedCompleted) {
    throw new LifePlanningDomainError('COMPLETED_ITEM_IMMUTABLE', 'Completed plan items cannot be removed from a day plan.', 409)
  }
  return {
    ...clone(input.dayPlan),
    mealSlots: clone(input.mealSlots),
    items,
    entityVersion: input.dayPlan.entityVersion + 1,
  }
}

export function scheduleRelativeToMeal(mealTime: string, offsetMinutes: number): string {
  validTime(mealTime, 'mealTime')
  if (!Number.isInteger(offsetMinutes)) throw new LifePlanningDomainError('INVALID_INPUT', 'offsetMinutes must be an integer.')
  const [hour, minute] = mealTime.split(':').map(Number) as [number, number]
  const normalized = ((hour * 60 + minute + offsetMinutes) % 1_440 + 1_440) % 1_440
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}

export function normalizeMedicineRecurrence(input: MedicineRecurrence): MedicineRecurrence {
  const startDate = validDate(input.startDate, 'startDate')
  const endDate = validDate(input.endDate, 'endDate')
  if (endDate < startDate) throw new LifePlanningDomainError('INVALID_DATE_RANGE', 'endDate cannot precede startDate.')
  const inclusiveDays = Math.floor((Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)) / 86_400_000) + 1
  if (inclusiveDays > MAX_MEDICINE_RECURRENCE_DAYS) {
    throw new LifePlanningDomainError(
      'RECURRENCE_RANGE_TOO_LARGE',
      `Medicine recurrence cannot span more than ${MAX_MEDICINE_RECURRENCE_DAYS} inclusive days.`,
    )
  }
  const times = [...new Set(input.times.map((value) => validTime(value, 'medicine time')))].sort()
  if (!times.length) throw new LifePlanningDomainError('INVALID_INPUT', 'At least one user-authored medicine time is required.')
  if (input.mode === 'weekdays') {
    const weekdays = [...new Set(input.weekdays ?? [])].sort((left, right) => left - right)
    if (!weekdays.length || weekdays.some((value) => !Number.isInteger(value) || value < 0 || value > 6)) {
      throw new LifePlanningDomainError('INVALID_INPUT', 'Weekday recurrence requires weekday values from zero through six.')
    }
    return { mode: 'weekdays', times, weekdays, startDate, endDate }
  }
  if (input.mode === 'interval') {
    const everyDays = input.everyDays ?? 0
    if (!Number.isInteger(everyDays) || everyDays <= 0) {
      throw new LifePlanningDomainError('INVALID_INPUT', 'Interval recurrence requires a positive whole-day interval.')
    }
    return { mode: 'interval', times, everyDays, startDate, endDate }
  }
  throw new LifePlanningDomainError('INVALID_INPUT', 'Unsupported medicine recurrence mode.')
}

export function expandMedicineRecurrence(input: MedicineRecurrence): Array<{
  date: string
  time: string
  factual: true
}> {
  const normalized = normalizeMedicineRecurrence(input)
  const start = normalized.startDate
  const end = normalized.endDate
  const weekdays = new Set(normalized.weekdays ?? [])
  const everyDays = normalized.everyDays ?? 0
  const startMs = Date.parse(`${start}T00:00:00.000Z`)
  const endMs = Date.parse(`${end}T00:00:00.000Z`)
  const result: Array<{ date: string; time: string; factual: true }> = []
  for (let current = startMs, offset = 0; current <= endMs; current += 86_400_000, offset += 1) {
    const day = new Date(current)
    const included = normalized.mode === 'weekdays' ? weekdays.has(day.getUTCDay()) : offset % everyDays === 0
    if (!included) continue
    const date = day.toISOString().slice(0, 10)
    for (const time of normalized.times) {
      if (result.length >= MAX_MEDICINE_RECURRENCE_OCCURRENCES) {
        throw new LifePlanningDomainError(
          'RECURRENCE_OCCURRENCE_LIMIT',
          `Medicine recurrence cannot produce more than ${MAX_MEDICINE_RECURRENCE_OCCURRENCES} occurrences.`,
        )
      }
      result.push({ date, time, factual: true })
    }
  }
  return result
}

export function calculateFitnessActual(input: {
  kcalPerHour: number
  actualMinutes: number
  overrideEnergyKcal?: number | null
}): { actualMinutes: number; estimatedEnergyKcal: number; userOverride: boolean } {
  finiteNonNegative(input.kcalPerHour, 'kcalPerHour')
  finiteNonNegative(input.actualMinutes, 'actualMinutes')
  if (input.overrideEnergyKcal != null) {
    return {
      actualMinutes: input.actualMinutes,
      estimatedEnergyKcal: round(finiteNonNegative(input.overrideEnergyKcal, 'overrideEnergyKcal')),
      userOverride: true,
    }
  }
  return {
    actualMinutes: input.actualMinutes,
    estimatedEnergyKcal: round(input.kcalPerHour * input.actualMinutes / 60),
    userOverride: false,
  }
}

export function transitionPlanItem(input: {
  item: LifePlanItem
  action: 'complete' | 'skip' | 'delay' | 'backfill'
  at: string
  delayedUntil?: string
}): LifePlanItem {
  if (input.item.status === 'completed') throw new LifePlanningDomainError('ITEM_ALREADY_COMPLETED', 'Completed plan items are immutable.', 409)
  const at = validTimestamp(input.at, 'at')
  const result = clone(input.item)
  result.entityVersion += 1
  if (input.action === 'skip') {
    result.status = 'skipped'
    result.completionId = null
    result.actual = null
    return result
  }
  if (input.action === 'delay') {
    if (!input.delayedUntil) throw new LifePlanningDomainError('INVALID_INPUT', 'delayedUntil is required for delay.')
    result.status = 'delayed'
    result.scheduledTime = validTime(input.delayedUntil, 'delayedUntil')
    result.completionId = null
    result.actual = null
    return result
  }
  result.status = 'completed'
  result.actual = {
    source: clone(result.source),
    quantity: result.quantity,
    unit: result.unit,
    servings: result.servings,
    completedAt: at,
    nutrition: null,
    costMinor: null,
    inventoryTransactionIds: [],
    actualMinutes: null,
    estimatedEnergyKcal: null,
    energyIsEstimate: false,
  }
  return result
}

export function summarizeCalendarDay(input: {
  plan: DayPlan
  today: string
  conflicted: boolean
}): 'planned' | 'complete' | 'past-incomplete' | 'conflicted' {
  validDate(input.plan.date, 'plan date')
  validDate(input.today, 'today')
  if (input.conflicted) return 'conflicted'
  if (input.plan.items.length && input.plan.items.every((entry) => entry.status === 'completed' || entry.status === 'skipped')) return 'complete'
  if (input.plan.date < input.today) return 'past-incomplete'
  return 'planned'
}

export function hasPlanningConflicts(plan: DayPlan) {
  const seen = new Set<string>()
  for (const item of plan.items) {
    if (item.status === 'completed' || item.status === 'skipped') continue
    if (item.scheduledTime == null && item.mealSlotId == null) continue
    const sourceIdentity = item.source == null
      ? 'unbound'
      : `${item.source.type}:${item.source.id}:${item.source.versionId ?? ''}`
    const key = `${item.kind}\0${item.mealSlotId ?? ''}\0${item.scheduledTime ?? ''}\0${sourceIdentity}`
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}

export function summarizeDayProjection(input: {
  planned: Array<{ nutrition: Record<string, number> | null; costMinor: number | null; sourceId: string }>
  completed: PlanActualSnapshot[]
}): {
  status: 'complete' | 'incomplete'
  plannedNutrition: Record<string, number> | null
  actualNutrition: Record<string, number>
  plannedCostMinor: number | null
  actualCostMinor: number
  sourceIds: string[]
} {
  const add = (target: Record<string, number>, values: Record<string, number>) => {
    for (const [name, value] of Object.entries(values)) {
      if (!Number.isFinite(value)) throw new LifePlanningDomainError('INVALID_INPUT', `Nutrition field ${name} must be finite.`)
      target[name] = round((target[name] ?? 0) + value)
    }
    return target
  }
  const plannedComplete = input.planned.every((entry) => entry.nutrition != null && entry.costMinor != null)
  const plannedNutrition = plannedComplete
    ? input.planned.reduce((total, entry) => add(total, entry.nutrition!), {} as Record<string, number>)
    : null
  const actualNutrition = input.completed.reduce((total, entry) => entry.nutrition ? add(total, entry.nutrition) : total, {} as Record<string, number>)
  return {
    status: plannedComplete ? 'complete' : 'incomplete',
    plannedNutrition,
    actualNutrition,
    plannedCostMinor: plannedComplete ? round(input.planned.reduce((total, entry) => total + entry.costMinor!, 0)) : null,
    actualCostMinor: round(input.completed.reduce((total, entry) => total + (entry.costMinor ?? 0), 0)),
    sourceIds: [...new Set(input.planned.map((entry) => entry.sourceId))],
  }
}
