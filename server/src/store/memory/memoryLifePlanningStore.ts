import { createHash, randomUUID } from 'node:crypto'
import { convertUnit, selectEffectivePrice, type CatalogItem, type LifeUnit, type NutritionValues } from '../../domain/life/catalog.js'
import type { InventoryForecast, InventoryTransaction } from '../../domain/life/inventory.js'
import type { PreparedFoodConsumption, PreparedFoodStock, RecipeCalculation } from '../../domain/life/recipes.js'
import {
  LifePlanningDomainError,
  calculateFitnessActual,
  copyPlannedDay,
  expandMedicineRecurrence,
  hasPlanningConflicts,
  normalizeMedicineRecurrence,
  previewTemplateApplication,
  reconcileDayPlanDraft,
  scheduleRelativeToMeal,
  summarizeCalendarDay,
  transitionPlanItem,
  type CreateDayPlanInput,
  type CreateMedicineRecurrenceRuleInput,
  type CreatePlanTemplateInput,
  type DayPlan,
  type FitnessActivity,
  type LifePlanItem,
  type MealSlot,
  type MedicineRecurrenceOccurrence,
  type MedicineRecurrenceRule,
  type MedicineOccurrenceTransitionInput,
  type PlanItemInput,
  type PlanTemplate,
  type PlanningCompletionInput,
  type PlanningCompletionSnapshot,
  type PlanningTimeline,
  type TemplatePlanItem,
  type UpdatePlanTemplateInput,
  type UpdateDayPlanInput,
  type UpdateMedicineRecurrenceRuleInput,
} from '../../domain/life/planning.js'
import type { LifePlanningStore } from '../lifePlanningStore.js'
import { buildPlanningProjection, buildPlanningProjections } from '../planningProjection.js'
import type { MemoryOwnerTransactionParticipant } from './memoryOwnerTransactionCoordinator.js'

interface Owned<T> { userId: string; value: T }
interface PlanningOwnerTransactionState {
  templates: Array<Owned<PlanTemplate>>
  dayPlans: Array<Owned<DayPlan>>
  fitness: Array<Owned<FitnessActivity>>
  recurrenceRules: Array<Owned<MedicineRecurrenceRule>>
  medicineOccurrences: Array<Owned<MedicineRecurrenceOccurrence>>
  completions: Array<Owned<PlanningCompletionSnapshot>>
  preparedFoodEvents: Array<[string, PreparedFoodConsumption[]]>
  completionUndos: Array<[string, { reversedInventoryTransactionIds: string[]; createdAt: string }]>
  templateApplications: Array<Owned<{ templateId: string; dayPlanId: string; date: string; appliedVersion: number }>>
  idempotency: Array<[string, { hash: string; promise: Promise<unknown> }]>
}
const clone = <T>(value: T): T => structuredClone(value)
const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => `${JSON.stringify(name)}:${stable(item)}`).join(',')}}`
    : JSON.stringify(value)
const hash = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex').toUpperCase()
const round = (value: number) => Math.round((value + Number.EPSILON) * 1_000_000_000) / 1_000_000_000
const flattenNutrition = (value: NutritionValues): Record<string, number> => ({
  energyKcal: value.energyKcal, proteinGrams: value.proteinGrams, fatGrams: value.fatGrams,
  carbohydrateGrams: value.carbohydrateGrams, ...value.custom,
})
const scaleFacts = (value: Record<string, number>, factor: number) => Object.fromEntries(
  Object.entries(value).map(([name, amount]) => [name, round(amount * factor)]),
)
const addFacts = (left: Record<string, number>, right: Record<string, number>) => {
  for (const [name, amount] of Object.entries(right)) left[name] = round((left[name] ?? 0) + amount)
  return left
}

export class MemoryLifePlanningStore implements LifePlanningStore, MemoryOwnerTransactionParticipant<PlanningOwnerTransactionState> {
  private readonly templates: Array<Owned<PlanTemplate>> = []
  private readonly dayPlans: Array<Owned<DayPlan>> = []
  private readonly fitness: Array<Owned<FitnessActivity>> = []
  private readonly recurrenceRules: Array<Owned<MedicineRecurrenceRule>> = []
  private readonly medicineOccurrences: Array<Owned<MedicineRecurrenceOccurrence>> = []
  private readonly completions: Array<Owned<PlanningCompletionSnapshot>> = []
  private readonly preparedFoodEvents = new Map<string, PreparedFoodConsumption[]>()
  private readonly completionUndos = new Map<string, { reversedInventoryTransactionIds: string[]; createdAt: string }>()
  private readonly templateApplications: Array<Owned<{ templateId: string; dayPlanId: string; date: string; appliedVersion: number }>> = []
  private readonly idempotency = new Map<string, { hash: string; promise: Promise<unknown> }>()
  private readonly medicineMutationLocks = new Map<string, Promise<void>>()

  constructor(private readonly options: {
    createId?: () => string
    now?: () => string
    getCatalogItem: (userId: string, itemId: string) => Promise<CatalogItem | undefined>
    listUnits: (userId: string) => Promise<LifeUnit[]>
    listInventoryForecasts: (userId: string) => Promise<InventoryForecast[]>
    calculateStoredRecipe: (userId: string, recipeId: string, input: { mode: 'latest' | 'pinned'; versionId?: string; asOf: string }) => Promise<(RecipeCalculation & { recipeVersionId: string; recipeVersionNumber: number }) | undefined>
    listPreparedFood: (userId: string) => Promise<PreparedFoodStock[]>
    consumePreparedFood: (userId: string, recipeId: string, recipeVersionId: string, portions: number) => { events: PreparedFoodConsumption[]; remaining: number }
    restorePreparedFood: (userId: string, events: PreparedFoodConsumption[]) => void
    createInventoryTransaction: (userId: string, input: { itemId: string; kind: 'consume'; quantity: number; unit: string; occurredAt: string; note: string }, key: string) => Promise<InventoryTransaction>
    getInventoryTransactionActualCost: (userId: string, transactionId: string) => number | null
    reverseInventoryTransaction: (userId: string, id: string, input: { note: string }, key: string) => Promise<InventoryTransaction | undefined>
    onMedicineCompletionInventoryEffect?: (userId: string) => Promise<void> | void
  }) {}

  private createId = () => this.options.createId?.() ?? randomUUID()
  private now = () => this.options.now?.() ?? new Date().toISOString()

  async getPlanningCatalogReferences(userId: string, itemId: string) {
    return {
      templateIds: this.templates.filter((entry) => entry.userId === userId && entry.value.items.some((item) => item.source?.type === 'catalog-item' && item.source.id === itemId)).map((entry) => entry.value.id).sort(),
      futurePlanIds: this.dayPlans.filter((entry) => entry.userId === userId && entry.value.items.some((item) => item.status !== 'completed' && item.source?.type === 'catalog-item' && item.source.id === itemId)).map((entry) => entry.value.id).sort(),
    }
  }

  async listActiveCompletionSnapshotsForAnalytics(userId: string, from: string, to: string) {
    return this.completions
      .filter((entry) => entry.userId === userId)
      .filter((entry) => entry.value.completedAt.slice(0, 10) >= from && entry.value.completedAt.slice(0, 10) <= to)
      .filter((entry) => {
        const source = entry.value.completionSource
        if (source.type === 'medicine-occurrence') {
          return this.medicineOccurrences.some((occurrence) => occurrence.userId === userId
            && occurrence.value.id === source.id
            && occurrence.value.completionId === entry.value.id
            && occurrence.value.status === 'completed')
        }
        return this.dayPlans.some((plan) => plan.userId === userId
          && plan.value.id === source.dayPlanId
          && plan.value.items.some((item) => item.id === source.dayPlanItemId
            && item.completionId === entry.value.id
            && item.status === 'completed'))
      })
      .map((entry) => clone(entry.value))
      .sort((left, right) => left.completedAt.localeCompare(right.completedAt) || left.id.localeCompare(right.id))
  }

  exportOwnerPortableData(userId: string) {
    return {
      planTemplates: clone(this.templates.filter((entry) => entry.userId === userId).map((entry) => entry.value)),
      dayPlans: clone(this.dayPlans.filter((entry) => entry.userId === userId).map((entry) => entry.value)),
      fitnessActivities: clone(this.fitness.filter((entry) => entry.userId === userId).map((entry) => entry.value)),
      medicineRecurrenceRules: clone(this.recurrenceRules.filter((entry) => entry.userId === userId).map((entry) => entry.value)),
      medicineOccurrences: clone(this.medicineOccurrences.filter((entry) => entry.userId === userId).map((entry) => entry.value)),
      completionSnapshots: clone(this.completions.filter((entry) => entry.userId === userId).map((entry) => entry.value)),
      completionReversals: [...this.completionUndos.entries()]
        .filter(([key]) => key.startsWith(`${userId}\0`))
        .map(([key, value]) => ({ completionId: key.slice(userId.length + 1), ...clone(value) })),
      completionPreparedFoodEvents: [...this.preparedFoodEvents.entries()]
        .filter(([key]) => key.startsWith(`${userId}\0`))
        .map(([key, events]) => ({ completionId: key.slice(userId.length + 1), events: clone(events) })),
      templateApplications: clone(this.templateApplications.filter((entry) => entry.userId === userId).map((entry) => entry.value)),
    }
  }

  replaceOwnerPortableData(userId: string, payload: Record<string, unknown>) {
    const values = <T>(key: string) => clone((Array.isArray(payload[key]) ? payload[key] : []) as T[])
    const replace = <T>(current: Array<Owned<T>>, imported: T[]) => {
      current.splice(0, current.length,
        ...current.filter((entry) => entry.userId !== userId),
        ...imported.map((value) => ({ userId, value })))
    }
    replace(this.templates, values<PlanTemplate>('planTemplates'))
    replace(this.dayPlans, values<DayPlan>('dayPlans'))
    replace(this.fitness, values<FitnessActivity>('fitnessActivities'))
    replace(this.recurrenceRules, values<MedicineRecurrenceRule>('medicineRecurrenceRules'))
    replace(this.medicineOccurrences, values<MedicineRecurrenceOccurrence>('medicineOccurrences'))
    replace(this.completions, values<PlanningCompletionSnapshot>('completionSnapshots'))
    replace(this.templateApplications, values<{ templateId: string; dayPlanId: string; date: string; appliedVersion: number }>('templateApplications'))
    const prefix = `${userId}\0`
    for (const key of [...this.preparedFoodEvents.keys()]) if (key.startsWith(prefix)) this.preparedFoodEvents.delete(key)
    for (const entry of values<{ completionId: string; events: PreparedFoodConsumption[] }>('completionPreparedFoodEvents')) {
      this.preparedFoodEvents.set(`${userId}\0${entry.completionId}`, clone(entry.events))
    }
    for (const key of [...this.completionUndos.keys()]) if (key.startsWith(prefix)) this.completionUndos.delete(key)
    for (const entry of values<{ completionId: string; reversedInventoryTransactionIds: string[]; createdAt: string }>('completionReversals')) {
      this.completionUndos.set(`${userId}\0${entry.completionId}`, {
        reversedInventoryTransactionIds: clone(entry.reversedInventoryTransactionIds), createdAt: entry.createdAt,
      })
    }
  }

  captureOwnerTransactionState(userId: string): PlanningOwnerTransactionState {
    const prefix = `${userId}\0`
    return {
      templates: clone(this.templates.filter((entry) => entry.userId === userId)),
      dayPlans: clone(this.dayPlans.filter((entry) => entry.userId === userId)),
      fitness: clone(this.fitness.filter((entry) => entry.userId === userId)),
      recurrenceRules: clone(this.recurrenceRules.filter((entry) => entry.userId === userId)),
      medicineOccurrences: clone(this.medicineOccurrences.filter((entry) => entry.userId === userId)),
      completions: clone(this.completions.filter((entry) => entry.userId === userId)),
      preparedFoodEvents: [...this.preparedFoodEvents.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => [key, clone(value)]),
      completionUndos: [...this.completionUndos.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => [key, clone(value)]),
      templateApplications: clone(this.templateApplications.filter((entry) => entry.userId === userId)),
      idempotency: [...this.idempotency.entries()].filter(([key]) => key.startsWith(prefix)),
    }
  }

  restoreOwnerTransactionState(userId: string, state: PlanningOwnerTransactionState) {
    const prefix = `${userId}\0`
    this.templates.splice(0, this.templates.length,
      ...this.templates.filter((entry) => entry.userId !== userId), ...clone(state.templates))
    this.dayPlans.splice(0, this.dayPlans.length,
      ...this.dayPlans.filter((entry) => entry.userId !== userId), ...clone(state.dayPlans))
    this.fitness.splice(0, this.fitness.length,
      ...this.fitness.filter((entry) => entry.userId !== userId), ...clone(state.fitness))
    this.recurrenceRules.splice(0, this.recurrenceRules.length,
      ...this.recurrenceRules.filter((entry) => entry.userId !== userId),
      ...clone(state.recurrenceRules))
    this.medicineOccurrences.splice(0, this.medicineOccurrences.length,
      ...this.medicineOccurrences.filter((entry) => entry.userId !== userId),
      ...clone(state.medicineOccurrences))
    this.completions.splice(0, this.completions.length,
      ...this.completions.filter((entry) => entry.userId !== userId),
      ...clone(state.completions))
    for (const key of [...this.preparedFoodEvents.keys()]) {
      if (key.startsWith(prefix)) this.preparedFoodEvents.delete(key)
    }
    for (const [key, value] of state.preparedFoodEvents) this.preparedFoodEvents.set(key, clone(value))
    for (const key of [...this.completionUndos.keys()]) {
      if (key.startsWith(prefix)) this.completionUndos.delete(key)
    }
    for (const [key, value] of state.completionUndos) this.completionUndos.set(key, clone(value))
    this.templateApplications.splice(0, this.templateApplications.length,
      ...this.templateApplications.filter((entry) => entry.userId !== userId), ...clone(state.templateApplications))
    for (const key of [...this.idempotency.keys()]) {
      if (key.startsWith(prefix)) this.idempotency.delete(key)
    }
    for (const [key, value] of state.idempotency) this.idempotency.set(key, value)
  }

  isMedicineOccurrenceCompletion(userId: string, completionId: string) {
    return this.completions.some((entry) => (
      entry.userId === userId
      && entry.value.id === completionId
      && entry.value.completionSource.type === 'medicine-occurrence'
    ))
  }

  async listPlanTemplates(userId: string) {
    return clone(this.templates.filter((entry) => entry.userId === userId).map((entry) => entry.value).sort((a, b) => a.name.localeCompare(b.name)))
  }

  async getPlanTemplate(userId: string, id: string) {
    const value = this.template(userId, id)
    return value ? clone(value) : undefined
  }

  async createPlanTemplate(userId: string, input: CreatePlanTemplateInput, key: string) {
    return this.idempotently(userId, 'planning:create-template', key, input, async () => {
      const value = await this.buildTemplate(userId, input, 1)
      this.templates.push({ userId, value })
      return value
    })
  }

  async updatePlanTemplate(userId: string, id: string, input: UpdatePlanTemplateInput) {
    const current = this.template(userId, id)
    if (!current) return undefined
    if (current.entityVersion !== input.entityVersion) throw new LifePlanningDomainError('VERSION_CONFLICT', 'The plan template changed since it was loaded.', 409)
    const next = await this.buildTemplate(userId, input, current.entityVersion + 1, current)
    Object.assign(current, next)
    return clone(current)
  }

  async getDayPlan(userId: string, date: string) {
    this.validDate(date, 'date')
    const value = this.dayPlan(userId, date)
    return value ? this.hydrateDayPlan(userId, value) : undefined
  }

  async getDayPlanProjection(userId: string, date: string) {
    const plan = this.dayPlan(userId, date)
    if (!plan) return undefined
    return buildPlanningProjection(userId, this.hydrateDayPlan(userId, plan), {
      getCatalogItem: this.options.getCatalogItem,
      listUnits: this.options.listUnits,
      listInventoryForecasts: this.options.listInventoryForecasts,
      calculateStoredRecipe: this.options.calculateStoredRecipe,
      listPreparedFood: this.options.listPreparedFood,
      getFitnessActivity: async (ownerId, id) => clone(this.fitness.find((entry) => entry.userId === ownerId && entry.value.id === id)?.value),
    })
  }

  async listDayPlanProjections(userId: string, from: string, through: string) {
    this.validDate(from, 'from')
    this.validDate(through, 'through')
    if (through < from) throw new LifePlanningDomainError('INVALID_RANGE', 'through cannot precede from.', 400)
    const plans = this.dayPlans
      .filter((entry) => entry.userId === userId && entry.value.date >= from && entry.value.date <= through)
      .map((entry) => this.hydrateDayPlan(userId, entry.value))
    return buildPlanningProjections(userId, plans, {
      getCatalogItem: this.options.getCatalogItem,
      listUnits: this.options.listUnits,
      listInventoryForecasts: this.options.listInventoryForecasts,
      calculateStoredRecipe: this.options.calculateStoredRecipe,
      listPreparedFood: this.options.listPreparedFood,
      getFitnessActivity: async (ownerId, id) => clone(this.fitness.find((entry) => entry.userId === ownerId && entry.value.id === id)?.value),
    })
  }

  async createDayPlan(userId: string, input: CreateDayPlanInput, key: string) {
    return this.idempotently(userId, 'planning:create-day', key, input, async () => {
      this.validDate(input.date, 'date')
      if (this.dayPlan(userId, input.date)) throw new LifePlanningDomainError('DAY_PLAN_EXISTS', 'A day plan already exists for this date.', 409)
      const mealSlots = this.validateMealSlots(input.mealSlots)
      const items = await this.buildItems(userId, input.items, mealSlots)
      const value: DayPlan = { id: this.createId(), date: input.date, mealSlots, items, entityVersion: 1 }
      this.dayPlans.push({ userId, value })
      return value
    })
  }

  async updateDayPlan(userId: string, date: string, input: UpdateDayPlanInput) {
    this.validDate(date, 'date')
    const current = this.dayPlan(userId, date)
    if (!current) return undefined
    const mealSlots = this.validateMealSlots(input.mealSlots)
    const built = await this.buildItems(userId, input.items, mealSlots)
    const next = reconcileDayPlanDraft({
      dayPlan: current,
      entityVersion: input.entityVersion,
      mealSlots,
      items: built.map((value, index) => ({
        id: input.items[index]!.id,
        entityVersion: input.items[index]!.entityVersion,
        value,
      })),
    })
    Object.assign(current, next)
    return clone(current)
  }

  async previewTemplateApplication(userId: string, date: string, templateId: string, resolution: 'merge' | 'replace' | 'skip') {
    const dayPlan = this.dayPlan(userId, date)
    const template = this.template(userId, templateId)
    if (!dayPlan || !template) return undefined
    return previewTemplateApplication({ dayPlan, template, resolution })
  }

  async applyTemplateToDayPlan(userId: string, date: string, input: { templateId: string; resolution: 'merge' | 'replace' | 'skip'; entityVersion: number; templateVersion: number }, key: string) {
    const exists = this.dayPlan(userId, date)
    if (!exists || !this.template(userId, input.templateId)) return undefined
    return this.idempotently(userId, `planning:apply-template:${date}`, key, input, async () => {
      const dayPlan = this.dayPlan(userId, date)!
      if (dayPlan.entityVersion !== input.entityVersion) throw new LifePlanningDomainError('VERSION_CONFLICT', 'The day plan changed since it was loaded.', 409)
      const template = this.template(userId, input.templateId)!
      if (template.entityVersion !== input.templateVersion) throw new LifePlanningDomainError('TEMPLATE_VERSION_CONFLICT', 'The template changed after preview. Preview again before applying.', 409)
      const preview = await this.previewTemplateApplication(userId, date, input.templateId, input.resolution)
      if (!preview) throw new LifePlanningDomainError('NOT_FOUND', 'The plan or template does not exist.', 404)
      const existingIds = new Set(dayPlan.items.map((entry) => entry.id))
      const result = clone(preview.result)
      result.items = result.items.map((entry) => existingIds.has(entry.id) ? entry : { ...entry, id: this.createId() })
      result.entityVersion = dayPlan.entityVersion + 1
      Object.assign(dayPlan, result)
      this.templateApplications.push({ userId, value: { templateId: template.id, dayPlanId: dayPlan.id, date, appliedVersion: template.entityVersion } })
      return dayPlan
    })
  }

  async copyDayPlan(userId: string, date: string, targetDate: string, key: string) {
    const source = this.dayPlan(userId, date)
    if (!source) return undefined
    return this.idempotently(userId, `planning:copy-day:${date}`, key, { targetDate }, async () => {
      if (this.dayPlan(userId, targetDate)) throw new LifePlanningDomainError('DAY_PLAN_EXISTS', 'The target date already has a day plan.', 409)
      const copied = copyPlannedDay({ source, targetDate, createId: this.createId })
      copied.id = this.createId()
      this.dayPlans.push({ userId, value: copied })
      return copied
    })
  }

  async previewTemplateSync(userId: string, templateId: string, input: { fromDate: string; target: 'future-incomplete' | 'selected'; dates?: string[] }) {
    const template = this.template(userId, templateId)
    if (!template) return undefined
    this.validDate(input.fromDate, 'fromDate')
    const selected = new Set(input.dates ?? [])
    const applications = this.templateApplications.filter((entry) => entry.userId === userId && entry.value.templateId === templateId)
    const candidates = applications
      .map((entry) => this.dayPlans.find((plan) => plan.userId === userId && plan.value.id === entry.value.dayPlanId)?.value)
      .filter((plan): plan is DayPlan => plan != null && plan.date >= input.fromDate)
      .filter((plan) => input.target === 'future-incomplete' || selected.has(plan.date))
      .sort((a, b) => a.date.localeCompare(b.date))
    const templateItemIds = new Set(template.items.map((entry) => entry.id))
    const excludedCompletedDates: string[] = []
    const changes: Array<{ date: string; before: LifePlanItem[]; after: LifePlanItem[] }> = []
    for (const plan of candidates) {
      const templateItems = plan.items.filter((entry) => entry.originTemplateItemId && templateItemIds.has(entry.originTemplateItemId))
      if (templateItems.some((entry) => entry.status === 'completed')) {
        excludedCompletedDates.push(plan.date)
        continue
      }
      const base = clone(plan)
      base.items = base.items.filter((entry) => entry.originTemplateItemId == null || !templateItemIds.has(entry.originTemplateItemId))
      const preview = previewTemplateApplication({ dayPlan: base, template, resolution: 'merge' })
      const existingIds = new Set(base.items.map((entry) => entry.id))
      const after = preview.result.items.map((entry) => existingIds.has(entry.id) ? entry : { ...entry, id: `sync-preview:${plan.date}:${entry.originTemplateItemId ?? entry.id}` })
      changes.push({ date: plan.date, before: clone(plan.items), after })
    }
    return {
      writesApplied: false as const,
      templateVersion: template.entityVersion,
      dayPlanVersions: Object.fromEntries(changes.map((entry) => [entry.date, this.dayPlan(userId, entry.date)!.entityVersion])),
      affectedDates: changes.map((entry) => entry.date), excludedCompletedDates, changes,
    }
  }

  async syncPlanTemplate(userId: string, templateId: string, input: { fromDate: string; target: 'future-incomplete' | 'selected'; dates?: string[]; templateVersion: number; dayPlanVersions: Record<string, number> }, key: string) {
    const template = this.template(userId, templateId)
    if (!template) return undefined
    return this.idempotently(userId, `planning:sync-template:${templateId}`, key, input, async () => {
      const currentTemplate = this.template(userId, templateId)!
      if (currentTemplate.entityVersion !== input.templateVersion) throw new LifePlanningDomainError('TEMPLATE_VERSION_CONFLICT', 'The template changed after sync preview. Preview again before syncing.', 409)
      const preview = await this.previewTemplateSync(userId, templateId, input)
      if (!preview) throw new LifePlanningDomainError('NOT_FOUND', 'The plan template does not exist.', 404)
      const expectedDates = Object.keys(input.dayPlanVersions).sort()
      if (JSON.stringify(expectedDates) !== JSON.stringify([...preview.affectedDates].sort())) throw new LifePlanningDomainError('DAY_PLAN_VERSION_CONFLICT', 'The sync preview scope changed. Preview again before syncing.', 409)
      for (const change of preview.changes) {
        const plan = this.dayPlan(userId, change.date)!
        if (plan.entityVersion !== input.dayPlanVersions[change.date]) throw new LifePlanningDomainError('DAY_PLAN_VERSION_CONFLICT', `Day plan ${change.date} changed after sync preview.`, 409)
        plan.items = change.after.map((entry) => entry.id.startsWith('sync-preview:') ? { ...clone(entry), id: this.createId() } : clone(entry))
        plan.entityVersion += 1
      }
      return { affectedDates: preview.affectedDates, excludedCompletedDates: preview.excludedCompletedDates }
    })
  }

  async previewMedicineRecurrence(userId: string, sourceId: string, recurrence: import('../../domain/life/planning.js').MedicineRecurrence) {
    const item = await this.options.getCatalogItem(userId, sourceId)
    if (!item || item.kind !== 'medicine' || item.deletedAt != null || item.status !== 'active') {
      throw new LifePlanningDomainError('NOT_FOUND', 'The medicine fact does not exist.', 404)
    }
    return { writesApplied: false as const, occurrences: expandMedicineRecurrence(recurrence) }
  }

  async listMedicineRecurrenceRules(userId: string) {
    return clone(this.recurrenceRules
      .filter((entry) => entry.userId === userId && entry.value.deletedAt == null)
      .map((entry) => entry.value)
      .sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id)))
  }

  async createMedicineRecurrenceRule(userId: string, input: CreateMedicineRecurrenceRuleInput, key: string) {
    return this.idempotently(userId, 'planning:create-medicine-recurrence', key, input, () => this.withMedicineMutation(userId, async () => {
      const timestamp = this.now()
      const value = await this.buildMedicineRecurrenceRule(userId, input, {
        id: this.createId(), entityVersion: 1, createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
      })
      const occurrences = this.buildMedicineOccurrences(value, timestamp)
      this.recurrenceRules.push({ userId, value })
      this.medicineOccurrences.push(...occurrences.map((occurrence) => ({ userId, value: occurrence })))
      return value
    }))
  }

  async updateMedicineRecurrenceRule(userId: string, id: string, input: UpdateMedicineRecurrenceRuleInput) {
    return this.withMedicineMutation(userId, async () => {
      const current = this.recurrenceRules.find((entry) => entry.userId === userId && entry.value.id === id && entry.value.deletedAt == null)?.value
      if (!current) return undefined
      if (current.entityVersion !== input.entityVersion) {
        throw new LifePlanningDomainError(
          'VERSION_CONFLICT',
          'The medicine recurrence rule changed since it was loaded.',
          409,
          { current: clone(current) },
        )
      }
      const next = await this.buildMedicineRecurrenceRule(userId, input, {
        id: current.id, entityVersion: current.entityVersion + 1, createdAt: current.createdAt, updatedAt: this.now(), deletedAt: null,
      })
      this.reconcileMedicineOccurrences(userId, current, next)
      Object.assign(current, next)
      return clone(current)
    })
  }

  async deleteMedicineRecurrenceRule(userId: string, id: string, entityVersion: number) {
    return this.withMedicineMutation(userId, async () => {
      const current = this.recurrenceRules.find((entry) => entry.userId === userId && entry.value.id === id && entry.value.deletedAt == null)?.value
      if (!current) return false
      if (current.entityVersion !== entityVersion) {
        throw new LifePlanningDomainError(
          'VERSION_CONFLICT',
          'The medicine recurrence rule changed since it was loaded.',
          409,
          { current: clone(current) },
        )
      }
      const timestamp = this.now()
      for (const occurrence of this.medicineOccurrences.filter((entry) => (
        entry.userId === userId
        && entry.value.ruleId === current.id
        && entry.value.status === 'planned'
        && this.isFutureOccurrence(entry.value, timestamp)
      ))) {
        occurrence.value.status = 'cancelled'
        occurrence.value.entityVersion += 1
        occurrence.value.updatedAt = timestamp
      }
      current.deletedAt = timestamp
      current.updatedAt = timestamp
      current.entityVersion += 1
      return true
    })
  }

  async transitionMedicineOccurrence(
    userId: string,
    id: string,
    input: MedicineOccurrenceTransitionInput,
    idempotencyKey: string,
  ) {
    const owned = this.medicineOccurrences.some((entry) => entry.userId === userId && entry.value.id === id)
    if (!owned) return undefined
    return this.idempotently(userId, `planning:transition-medicine-occurrence:${id}`, idempotencyKey, input, () => (
      this.withMedicineMutation(userId, async () => {
        const current = this.medicineOccurrences.find((entry) => entry.userId === userId && entry.value.id === id)?.value
        if (!current) return undefined
        if (current.entityVersion !== input.entityVersion) {
          throw new LifePlanningDomainError(
            'VERSION_CONFLICT',
            'The medicine occurrence changed since it was loaded.',
            409,
            { current: clone(current) },
          )
        }
        if (current.status !== 'planned') {
          throw new LifePlanningDomainError(
            'OCCURRENCE_NOT_TRANSITIONABLE',
            'Only a planned medicine occurrence can be skipped or delayed.',
            409,
            { current: clone(current) },
          )
        }
        const transitionedAt = this.validTimestamp(input.at, 'at')
        if (input.action === 'delay') {
          current.scheduledDate = this.validDate(input.scheduledDate, 'scheduledDate')
          current.scheduledTime = this.validTime(input.scheduledTime, 'scheduledTime')
        } else {
          current.status = 'skipped'
        }
        current.entityVersion += 1
        current.updatedAt = current.updatedAt >= transitionedAt ? current.updatedAt : transitionedAt
        return clone(current)
      })
    ))
  }

  async listCalendar(userId: string, from: string, to: string, today: string) {
    this.validDate(from, 'from')
    this.validDate(to, 'to')
    this.validDate(today, 'today')
    if (to < from) throw new LifePlanningDomainError('INVALID_DATE_RANGE', 'to cannot precede from.')
    const dates = new Set(this.dayPlans
      .filter((entry) => entry.userId === userId && entry.value.date >= from && entry.value.date <= to)
      .map((entry) => entry.value.date))
    for (const occurrence of this.medicineOccurrences) {
      if (occurrence.userId === userId && occurrence.value.status !== 'cancelled'
        && occurrence.value.scheduledDate >= from && occurrence.value.scheduledDate <= to) {
        dates.add(occurrence.value.scheduledDate)
      }
    }
    return [...dates].sort().map((calendarDate) => {
      const plan = this.dayPlan(userId, calendarDate)
      const occurrences = this.medicineOccurrences
        .filter((entry) => entry.userId === userId && entry.value.scheduledDate === calendarDate && entry.value.status !== 'cancelled')
        .map((entry) => entry.value)
      const dayItems = plan?.items ?? []
      const itemCount = dayItems.length + occurrences.length
      const completedCount = dayItems.filter((item) => item.status === 'completed').length
        + occurrences.filter((item) => item.status === 'completed').length
      const allComplete = itemCount > 0
        && dayItems.every((item) => item.status === 'completed' || item.status === 'skipped')
        && occurrences.every((item) => item.status === 'completed' || item.status === 'skipped')
      const state = plan && hasPlanningConflicts(plan) ? 'conflicted' as const
        : allComplete ? 'complete' as const
          : calendarDate < today ? 'past-incomplete' as const
            : 'planned' as const
      return { date: calendarDate, state, itemCount, completedCount }
    })
  }

  async getPlanningTimeline(userId: string, date: string): Promise<PlanningTimeline> {
    this.validDate(date, 'date')
    const planItems = (this.dayPlan(userId, date)?.items ?? []).map((item) => ({
      ...clone(item),
      sourceType: 'day-plan-item' as const,
    }))
    const occurrences = this.medicineOccurrences
      .filter((entry) => entry.userId === userId && entry.value.scheduledDate === date && entry.value.status !== 'cancelled')
      .map((entry) => ({ ...clone(entry.value), sourceType: 'medicine-occurrence' as const }))
    return {
      date,
      timelineItems: [...planItems, ...occurrences].sort((left, right) => (
        (left.scheduledTime ?? '').localeCompare(right.scheduledTime ?? '')
        || left.sourceType.localeCompare(right.sourceType)
        || left.id.localeCompare(right.id)
      )),
    }
  }

  async listFitnessActivities(userId: string) {
    return clone(this.fitness.filter((entry) => entry.userId === userId).map((entry) => entry.value).sort((a, b) => a.name.localeCompare(b.name)))
  }

  async createFitnessActivity(userId: string, input: import('../../domain/life/planning.js').CreateFitnessActivityInput, key: string) {
    return this.idempotently(userId, 'planning:create-fitness', key, input, async () => {
      const timestamp = this.now()
      const value: FitnessActivity = {
        id: this.createId(),
        name: this.text(input.name, 'name'),
        defaultMinutes: this.nonNegative(input.defaultMinutes, 'defaultMinutes'),
        kcalPerHour: this.nonNegative(input.kcalPerHour, 'kcalPerHour'),
        intensity: this.text(input.intensity, 'intensity'),
        steps: input.steps.map((entry) => this.text(entry, 'step')),
        equipment: input.equipment.map((entry) => this.text(entry, 'equipment')),
        entityVersion: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      this.fitness.push({ userId, value })
      return value
    })
  }

  async transitionDayPlanItem(userId: string, date: string, itemId: string, input: { entityVersion: number; action: 'complete' | 'skip' | 'delay' | 'backfill'; at: string; delayedUntil?: string }) {
    const plan = this.dayPlan(userId, date)
    const item = plan?.items.find((entry) => entry.id === itemId)
    if (!plan || !item) return undefined
    if (item.entityVersion !== input.entityVersion) throw new LifePlanningDomainError('VERSION_CONFLICT', 'The plan item changed since it was loaded.', 409)
    if (input.action === 'complete' || input.action === 'backfill') throw new LifePlanningDomainError('COMPLETION_ROUTE_REQUIRED', 'Completed and backfilled items must use the immutable completion route.', 409)
    const next = transitionPlanItem({ item, ...input })
    Object.assign(item, next)
    plan.entityVersion += 1
    return clone(item)
  }

  async createPlanningCompletion(userId: string, input: { date: string; dayPlanItemId: string; completedAt: string; actualMinutes?: number; overrideEnergyKcal?: number }, key: string) {
    return this.createPlanningCompletionFromSource(userId, {
      source: { type: 'day-plan-item', date: input.date, dayPlanItemId: input.dayPlanItemId },
      completedAt: input.completedAt,
      ...(input.actualMinutes === undefined ? {} : { actualMinutes: input.actualMinutes }),
      ...(input.overrideEnergyKcal === undefined ? {} : { overrideEnergyKcal: input.overrideEnergyKcal }),
    }, key)
  }

  async createPlanningCompletionFromSource(userId: string, input: PlanningCompletionInput, key: string) {
    return this.idempotently(userId, 'planning:create-completion', key, input, async () => {
      if (input.source.type === 'medicine-occurrence') {
        const occurrenceInput = input as Extract<PlanningCompletionInput, { source: { type: 'medicine-occurrence' } }>
        return this.withMedicineMutation(userId, () => this.completeMedicineOccurrence(userId, occurrenceInput))
      }
      const dayPlanInput = input as Extract<PlanningCompletionInput, { source: { type: 'day-plan-item' } }>
      const plan = this.dayPlan(userId, dayPlanInput.source.date)
      const item = plan?.items.find((entry) => entry.id === dayPlanInput.source.dayPlanItemId)
      if (!plan || !item) throw new LifePlanningDomainError('NOT_FOUND', 'The day plan item does not exist.', 404)
      if (item.status === 'completed') throw new LifePlanningDomainError('ITEM_ALREADY_COMPLETED', 'The plan item is already completed.', 409)
      const completedAt = this.validTimestamp(input.completedAt, 'completedAt')
      const completionId = this.createId()
      const snapshotFacts = await this.completionFacts(userId, item, completedAt, dayPlanInput, completionId)
      const snapshot: PlanningCompletionSnapshot = {
        id: completionId,
        dayPlanId: plan.id,
        dayPlanItemId: item.id,
        kind: item.kind,
        completionSource: { type: 'day-plan-item', dayPlanId: plan.id, dayPlanItemId: item.id },
        source: clone(snapshotFacts.source),
        quantity: item.quantity,
        unit: item.unit,
        servings: item.servings,
        completedAt,
        nutrition: snapshotFacts.nutrition,
        costMinor: snapshotFacts.costMinor,
        inventoryTransactionIds: snapshotFacts.inventoryTransactionIds,
        preparedFoodEventIds: snapshotFacts.preparedFoodEvents.map((entry) => entry.id),
        actualMinutes: snapshotFacts.actualMinutes,
        estimatedEnergyKcal: snapshotFacts.estimatedEnergyKcal,
        energyIsEstimate: snapshotFacts.energyIsEstimate,
      }
      this.completions.push({ userId, value: clone(snapshot) })
      this.preparedFoodEvents.set(`${userId}\0${snapshot.id}`, clone(snapshotFacts.preparedFoodEvents))
      item.status = 'completed'
      item.completionId = snapshot.id
      item.actual = {
        source: clone(snapshot.source), quantity: snapshot.quantity, unit: snapshot.unit, servings: snapshot.servings,
        completedAt, nutrition: clone(snapshot.nutrition), costMinor: snapshot.costMinor,
        inventoryTransactionIds: [...snapshot.inventoryTransactionIds], actualMinutes: snapshot.actualMinutes,
        preparedFoodEventIds: [...(snapshot.preparedFoodEventIds ?? [])],
        estimatedEnergyKcal: snapshot.estimatedEnergyKcal,
        energyIsEstimate: snapshot.energyIsEstimate,
      }
      item.entityVersion += 1
      plan.entityVersion += 1
      return snapshot
    })
  }

  async undoPlanningCompletion(userId: string, completionId: string, key: string) {
    const completion = this.completions.find((entry) => entry.userId === userId && entry.value.id === completionId)?.value
    if (!completion) return undefined
    return this.idempotently(userId, `planning:undo-completion:${completionId}`, key, {}, async () => {
      const operation = async () => {
        if (this.completionUndos.has(`${userId}\0${completionId}`)) throw new LifePlanningDomainError('COMPLETION_ALREADY_UNDONE', 'The completion already has a reversal.', 409)
        const completionSource = completion.completionSource
        const occurrence = completionSource.type === 'medicine-occurrence'
          ? this.medicineOccurrences.find((entry) => entry.userId === userId && entry.value.id === completionSource.id)?.value
          : undefined
        const plan = completionSource.type === 'medicine-occurrence'
          ? undefined
          : this.dayPlans.find((entry) => entry.userId === userId && entry.value.id === completion.dayPlanId)?.value
        const item = plan?.items.find((entry) => entry.id === completion.dayPlanItemId)
        if (completionSource.type === 'medicine-occurrence') {
          if (!occurrence || occurrence.status !== 'completed' || occurrence.completionId !== completionId) {
            throw new LifePlanningDomainError('COMPLETION_STATE_CONFLICT', 'The completion is no longer attached to its medicine occurrence.', 409)
          }
        } else if (!plan || !item || item.completionId !== completionId) {
          throw new LifePlanningDomainError('COMPLETION_STATE_CONFLICT', 'The completion is no longer attached to its plan item.', 409)
        }

        const reversedInventoryTransactionIds: string[] = []
        for (const transactionId of completion.inventoryTransactionIds) {
          const reversal = await this.options.reverseInventoryTransaction(
            userId,
            transactionId,
            { note: `Undo planning completion ${completionId}` },
            `planning-undo:${completionId}:${transactionId}`,
          )
          if (!reversal) throw new LifePlanningDomainError('INVENTORY_TRANSACTION_NOT_FOUND', 'A completion inventory event no longer exists.', 409)
          reversedInventoryTransactionIds.push(reversal.id)
        }
        const preparedFoodEvents = this.preparedFoodEvents.get(`${userId}\0${completionId}`) ?? []
        this.options.restorePreparedFood(userId, preparedFoodEvents)
        let status: 'planned' | 'cancelled' = 'planned'
        if (occurrence) {
          status = this.activeRuleIncludesOccurrence(userId, occurrence) ? 'planned' : 'cancelled'
          occurrence.status = status
          occurrence.completionId = null
          occurrence.entityVersion += 1
          occurrence.updatedAt = this.now()
        } else {
          item!.status = 'planned'
          item!.completionId = null
          item!.actual = null
          item!.entityVersion += 1
          plan!.entityVersion += 1
        }
        this.completionUndos.set(`${userId}\0${completionId}`, { reversedInventoryTransactionIds, createdAt: this.now() })
        return { completionId, reversedInventoryTransactionIds, restoredPreparedFoodEventIds: preparedFoodEvents.map((entry) => entry.id), status }
      }
      return completion.completionSource.type === 'medicine-occurrence'
        ? this.withMedicineMutation(userId, operation)
        : operation()
    })
  }

  private async completeMedicineOccurrence(
    userId: string,
    input: Extract<PlanningCompletionInput, { source: { type: 'medicine-occurrence' } }>,
  ) {
    const occurrence = this.medicineOccurrences.find((entry) => entry.userId === userId && entry.value.id === input.source.id)?.value
    if (!occurrence) throw new LifePlanningDomainError('NOT_FOUND', 'The medicine occurrence does not exist.', 404)
    if (occurrence.entityVersion !== input.source.entityVersion) {
      throw new LifePlanningDomainError(
        'VERSION_CONFLICT',
        'The medicine occurrence changed since it was loaded.',
        409,
        { current: clone(occurrence) },
      )
    }
    if (occurrence.status !== 'planned') {
      throw new LifePlanningDomainError(
        'OCCURRENCE_NOT_COMPLETABLE',
        'Only a planned medicine occurrence can be completed.',
        409,
        { current: clone(occurrence) },
      )
    }
    const completedAt = this.validTimestamp(input.completedAt, 'completedAt')
    const completionId = this.createId()
    const planItem: LifePlanItem = {
      id: occurrence.id,
      kind: 'medicine',
      title: occurrence.title,
      mealSlotId: null,
      scheduledTime: occurrence.scheduledTime,
      source: clone(occurrence.source),
      quantity: occurrence.quantity,
      unit: occurrence.unit,
      servings: null,
      durationMinutes: null,
      status: 'planned',
      completionId: null,
      actual: null,
      originTemplateItemId: null,
      entityVersion: occurrence.entityVersion,
    }
    const snapshotFacts = await this.completionFacts(userId, planItem, completedAt, {}, completionId)
    await this.options.onMedicineCompletionInventoryEffect?.(userId)
    const snapshot: PlanningCompletionSnapshot = {
      id: completionId,
      dayPlanId: null,
      dayPlanItemId: null,
      kind: 'medicine',
      completionSource: {
        type: 'medicine-occurrence',
        id: occurrence.id,
        ruleId: occurrence.ruleId,
        originalDate: occurrence.originalDate,
        originalTime: occurrence.originalTime,
        scheduledDate: occurrence.scheduledDate,
        scheduledTime: occurrence.scheduledTime,
      },
      source: clone(snapshotFacts.source),
      quantity: occurrence.quantity,
      unit: occurrence.unit,
      servings: null,
      completedAt,
      nutrition: snapshotFacts.nutrition,
      costMinor: snapshotFacts.costMinor,
      inventoryTransactionIds: snapshotFacts.inventoryTransactionIds,
      preparedFoodEventIds: [],
      actualMinutes: null,
      estimatedEnergyKcal: null,
      energyIsEstimate: false,
    }
    this.completions.push({ userId, value: clone(snapshot) })
    occurrence.status = 'completed'
    occurrence.completionId = completionId
    occurrence.entityVersion += 1
    occurrence.updatedAt = this.now()
    return snapshot
  }

  private buildMedicineOccurrences(rule: MedicineRecurrenceRule, timestamp: string): MedicineRecurrenceOccurrence[] {
    return expandMedicineRecurrence(rule.recurrence).map(({ date, time }) => ({
      id: this.createId(),
      ruleId: rule.id,
      entityVersion: 1,
      kind: 'medicine',
      title: rule.title,
      source: { type: 'catalog-item', id: rule.sourceId },
      quantity: rule.quantity,
      unit: rule.unit,
      originalDate: date,
      originalTime: time,
      scheduledDate: date,
      scheduledTime: time,
      status: 'planned',
      completionId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }))
  }

  private reconcileMedicineOccurrences(userId: string, current: MedicineRecurrenceRule, next: MedicineRecurrenceRule) {
    const timestamp = next.updatedAt
    const desired = new Map(expandMedicineRecurrence(next.recurrence).map(({ date, time }) => [`${date}\0${time}`, { date, time }]))
    const existing = this.medicineOccurrences.filter((entry) => entry.userId === userId && entry.value.ruleId === current.id)
    const existingIdentities = new Set(existing.map((entry) => `${entry.value.originalDate}\0${entry.value.originalTime}`))
    for (const entry of existing) {
      const occurrence = entry.value
      if (occurrence.status !== 'planned' || !this.isFutureOccurrence(occurrence, timestamp)) continue
      const identity = `${occurrence.originalDate}\0${occurrence.originalTime}`
      if (!desired.has(identity)) {
        occurrence.status = 'cancelled'
        occurrence.entityVersion += 1
        occurrence.updatedAt = timestamp
        continue
      }
      if (occurrence.title === next.title && occurrence.source.id === next.sourceId
        && occurrence.quantity === next.quantity && occurrence.unit === next.unit) continue
      occurrence.title = next.title
      occurrence.source = { type: 'catalog-item', id: next.sourceId }
      occurrence.quantity = next.quantity
      occurrence.unit = next.unit
      occurrence.entityVersion += 1
      occurrence.updatedAt = timestamp
    }
    for (const [identity, value] of desired) {
      if (existingIdentities.has(identity)
        || Date.parse(`${value.date}T${value.time}:00.000Z`) <= Date.parse(timestamp)) continue
      this.medicineOccurrences.push({
        userId,
        value: {
          id: this.createId(),
          ruleId: next.id,
          entityVersion: 1,
          kind: 'medicine',
          title: next.title,
          source: { type: 'catalog-item', id: next.sourceId },
          quantity: next.quantity,
          unit: next.unit,
          originalDate: value.date,
          originalTime: value.time,
          scheduledDate: value.date,
          scheduledTime: value.time,
          status: 'planned',
          completionId: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      })
    }
  }

  private isFutureOccurrence(occurrence: MedicineRecurrenceOccurrence, timestamp: string) {
    return Date.parse(`${occurrence.scheduledDate}T${occurrence.scheduledTime}:00.000Z`) > Date.parse(timestamp)
  }

  private activeRuleIncludesOccurrence(userId: string, occurrence: MedicineRecurrenceOccurrence) {
    const rule = this.recurrenceRules.find((entry) => (
      entry.userId === userId && entry.value.id === occurrence.ruleId && entry.value.deletedAt == null
    ))?.value
    return rule != null && expandMedicineRecurrence(rule.recurrence).some(({ date, time }) => (
      date === occurrence.originalDate && time === occurrence.originalTime
    ))
  }

  private async withMedicineMutation<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.medicineMutationLocks.get(userId) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const queued = previous.then(() => gate)
    this.medicineMutationLocks.set(userId, queued)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (this.medicineMutationLocks.get(userId) === queued) this.medicineMutationLocks.delete(userId)
    }
  }

  private async buildTemplate(userId: string, input: CreatePlanTemplateInput, entityVersion: number, current?: PlanTemplate): Promise<PlanTemplate> {
    const mealSlots = this.validateMealSlots(input.mealSlots)
    const templateItems: TemplatePlanItem[] = []
    for (const [index, entry] of input.items.entries()) {
      const built = await this.buildItem(userId, entry, mealSlots, templateItems.map((value) => ({ ...value, status: 'planned', completionId: null, actual: null, originTemplateItemId: value.id, entityVersion: 1 })))
      const weekdays = entry.weekdays == null ? [] : [...new Set(entry.weekdays)].sort((a, b) => a - b)
      if (weekdays.some((value) => !Number.isInteger(value) || value < 0 || value > 6)) throw new LifePlanningDomainError('INVALID_INPUT', 'Template weekdays must be zero through six.')
      templateItems.push({
        id: current?.items[index]?.id ?? this.createId(),
        kind: built.kind, title: built.title, mealSlotId: built.mealSlotId, scheduledTime: built.scheduledTime,
        weekdays, source: built.source, quantity: built.quantity, unit: built.unit, servings: built.servings, durationMinutes: built.durationMinutes,
      })
    }
    return { id: current?.id ?? this.createId(), name: this.text(input.name, 'name'), mealSlots, items: templateItems, entityVersion }
  }

  private validateMealSlots(input: MealSlot[]) {
    const ids = new Set<string>()
    const positions = new Set<number>()
    return clone(input).map((slot) => {
      const id = this.text(slot.id, 'meal slot id')
      const name = this.text(slot.name, 'meal slot name')
      if (ids.has(id) || positions.has(slot.position) || !Number.isInteger(slot.position) || slot.position < 0) {
        throw new LifePlanningDomainError('INVALID_MEAL_SLOTS', 'Meal slot IDs and positions must be unique non-negative values.', 409)
      }
      ids.add(id); positions.add(slot.position)
      return { id, name, position: slot.position, hidden: Boolean(slot.hidden) }
    }).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
  }

  private async buildItems(userId: string, input: PlanItemInput[], mealSlots: MealSlot[]) {
    const result: LifePlanItem[] = []
    for (const entry of input) result.push(await this.buildItem(userId, entry, mealSlots, result))
    return result
  }

  private async buildItem(userId: string, input: PlanItemInput, mealSlots: MealSlot[], prior: LifePlanItem[]): Promise<LifePlanItem> {
    if (!['meal', 'supplement', 'medicine', 'fitness', 'custom'].includes(input.kind)) throw new LifePlanningDomainError('INVALID_INPUT', 'Unknown plan item kind.')
    const mealSlotId = input.mealSlotId ?? null
    if (mealSlotId && !mealSlots.some((slot) => slot.id === mealSlotId)) throw new LifePlanningDomainError('NOT_FOUND', 'The meal slot does not exist.', 404)
    let scheduledTime = input.scheduledTime ?? null
    if (input.relativeToItemIndex != null) {
      const meal = prior[input.relativeToItemIndex]
      if (!meal || meal.kind !== 'meal' || !meal.scheduledTime) throw new LifePlanningDomainError('INVALID_RELATIVE_SCHEDULE', 'A relative supplement must reference an earlier scheduled meal.', 409)
      scheduledTime = scheduleRelativeToMeal(meal.scheduledTime, input.offsetMinutes ?? 0)
    } else if (scheduledTime != null) {
      scheduleRelativeToMeal(scheduledTime, 0)
    }
    const source = input.source ?? null
    if ((input.kind === 'supplement' || input.kind === 'medicine')) {
      if (source?.type !== 'catalog-item') throw new LifePlanningDomainError('INVALID_SOURCE', 'Supplement and medicine plans require a catalog item source.', 409)
      const item = await this.options.getCatalogItem(userId, source.id)
      if (!item || item.kind !== input.kind || item.deletedAt != null || item.status !== 'active') throw new LifePlanningDomainError('NOT_FOUND', `The ${input.kind} source does not exist.`, 404)
    }
    if (input.kind === 'fitness') {
      if (source?.type !== 'fitness-activity' || !this.fitness.some((entry) => entry.userId === userId && entry.value.id === source.id)) {
        throw new LifePlanningDomainError('NOT_FOUND', 'The fitness activity does not exist.', 404)
      }
    }
    if (input.kind === 'custom' && source != null) throw new LifePlanningDomainError('INVALID_SOURCE', 'Custom plan items cannot attach an implicit source.', 409)
    if (input.quantity != null && (!Number.isFinite(input.quantity) || input.quantity <= 0)) throw new LifePlanningDomainError('INVALID_INPUT', 'Plan quantity must be positive.')
    if (input.servings != null && (!Number.isFinite(input.servings) || input.servings <= 0)) throw new LifePlanningDomainError('INVALID_INPUT', 'Plan servings must be positive.')
    if (input.durationMinutes != null) this.nonNegative(input.durationMinutes, 'durationMinutes')
    return {
      id: this.createId(), kind: input.kind, title: this.text(input.title, 'title'), mealSlotId, scheduledTime,
      source: clone(source), quantity: input.quantity ?? null, unit: input.unit?.trim().toLowerCase() || null,
      servings: input.servings ?? null, durationMinutes: input.durationMinutes ?? null, status: 'planned', completionId: null,
      actual: null, originTemplateItemId: null, entityVersion: 1,
    }
  }

  private async completionFacts(userId: string, item: LifePlanItem, completedAt: string, input: { actualMinutes?: number; overrideEnergyKcal?: number }, completionId: string) {
    if (item.kind === 'fitness') {
      const activity = this.fitness.find((entry) => entry.userId === userId && entry.value.id === item.source?.id)?.value
      if (!activity) throw new LifePlanningDomainError('NOT_FOUND', 'The fitness activity does not exist.', 404)
      const result = calculateFitnessActual({
        kcalPerHour: activity.kcalPerHour,
        actualMinutes: input.actualMinutes ?? item.durationMinutes ?? activity.defaultMinutes,
        overrideEnergyKcal: input.overrideEnergyKcal,
      })
      return { source: clone(item.source), nutrition: null, costMinor: null, inventoryTransactionIds: [] as string[], preparedFoodEvents: [] as PreparedFoodConsumption[], actualMinutes: result.actualMinutes, estimatedEnergyKcal: result.estimatedEnergyKcal, energyIsEstimate: true }
    }
    if (item.kind === 'supplement' || item.kind === 'medicine') {
      if (!item.source || item.source.type !== 'catalog-item' || item.quantity == null || !item.unit) {
        throw new LifePlanningDomainError('INCOMPLETE_PLAN_ITEM', 'Inventory-backed completion requires an item, quantity and unit.', 409)
      }
      const catalog = await this.options.getCatalogItem(userId, item.source.id)
      if (!catalog || catalog.kind !== item.kind) throw new LifePlanningDomainError('NOT_FOUND', 'The inventory-backed source does not exist.', 404)
      const facts = await this.catalogFacts(userId, catalog, item.quantity, item.unit, completedAt.slice(0, 10))
      const inventory = await this.options.createInventoryTransaction(userId, {
        itemId: catalog.id, kind: 'consume', quantity: item.quantity, unit: item.unit, occurredAt: completedAt,
        note: `Planning completion ${item.id}`,
      }, `planning-completion:${completionId}`)
      return { source: clone(item.source), ...facts, costMinor: this.options.getInventoryTransactionActualCost(userId, inventory.id), inventoryTransactionIds: [inventory.id], preparedFoodEvents: [] as PreparedFoodConsumption[], actualMinutes: null, estimatedEnergyKcal: null, energyIsEstimate: false }
    }
    if (item.kind === 'meal') {
      if (!item.source || item.source.type !== 'recipe-version' || item.servings == null || item.servings <= 0) {
        throw new LifePlanningDomainError('INCOMPLETE_PLAN_ITEM', 'Meal completion requires a recipe version and positive servings.', 409)
      }
      let calculation: Awaited<ReturnType<typeof this.options.calculateStoredRecipe>>
      let recipeVersionId = item.source.versionId ?? null
      if (recipeVersionId == null) {
        calculation = await this.options.calculateStoredRecipe(userId, item.source.id, {
          mode: 'latest', asOf: completedAt.slice(0, 10),
        })
        if (!calculation) throw new LifePlanningDomainError('NOT_FOUND', 'The meal recipe does not exist.', 404)
        recipeVersionId = calculation.recipeVersionId
      }
      const availablePrepared = (await this.options.listPreparedFood(userId))
        .filter((stock) => stock.recipeId === item.source!.id && stock.recipeVersionId === recipeVersionId)
        .reduce((total, stock) => total + stock.portionsRemaining, 0)
      if (availablePrepared < item.servings) {
        calculation ??= await this.options.calculateStoredRecipe(userId, item.source.id, {
          mode: 'pinned', versionId: recipeVersionId, asOf: completedAt.slice(0, 10),
        })
        if (!calculation || calculation.status !== 'complete' || !calculation.perServingNutrition
          || calculation.perServingCostMinor == null || calculation.servings <= 0) {
          throw new LifePlanningDomainError('INCOMPLETE_RECIPE', 'Unprepared meal portions require complete recipe nutrition, price and conversion facts.', 409)
        }
      }
      const prepared = this.options.consumePreparedFood(userId, item.source.id, recipeVersionId, item.servings)
      const inventoryTransactionIds: string[] = []
      let uncoveredActualCost = 0
      let uncoveredCostComplete = true
      const factor = prepared.remaining > 0 ? prepared.remaining / calculation!.servings : 0
      if (prepared.remaining > 0) {
        for (const [position, ingredient] of calculation!.ingredients.entries()) {
          const inventory = await this.options.createInventoryTransaction(userId, {
            itemId: ingredient.itemId, kind: 'consume', quantity: round(ingredient.quantity * factor), unit: ingredient.unit,
            occurredAt: completedAt, note: `Planning meal completion ${item.id}`,
          }, `planning-completion:${completionId}:ingredient:${position}`)
          inventoryTransactionIds.push(inventory.id)
          const actualCost = this.options.getInventoryTransactionActualCost(userId, inventory.id)
          if (actualCost == null) uncoveredCostComplete = false
          else uncoveredActualCost = round(uncoveredActualCost + actualCost)
        }
      }
      const nutrition = prepared.events.reduce((total, event) => addFacts(total, flattenNutrition(event.nutrition)), {} as Record<string, number>)
      if (prepared.remaining > 0) addFacts(nutrition, scaleFacts(flattenNutrition(calculation!.perServingNutrition!), prepared.remaining))
      const preparedCost = round(prepared.events.reduce((total, event) => total + event.costMinor, 0))
      const costMinor = prepared.remaining > 0 && !uncoveredCostComplete ? null : round(preparedCost + uncoveredActualCost)
      return { source: { type: 'recipe-version' as const, id: item.source.id, versionId: recipeVersionId }, nutrition, costMinor, inventoryTransactionIds, preparedFoodEvents: prepared.events, actualMinutes: null, estimatedEnergyKcal: null, energyIsEstimate: false }
    }
    return { source: clone(item.source), nutrition: null, costMinor: null, inventoryTransactionIds: [] as string[], preparedFoodEvents: [] as PreparedFoodConsumption[], actualMinutes: null, estimatedEnergyKcal: null, energyIsEstimate: false }
  }

  private hydrateDayPlan(userId: string, source: DayPlan) {
    const plan = clone(source)
    const active = this.completions
      .filter((entry) => entry.userId === userId && entry.value.dayPlanId === plan.id
        && !this.completionUndos.has(`${userId}\0${entry.value.id}`))
      .map((entry) => entry.value)
      .sort((left, right) => left.completedAt.localeCompare(right.completedAt) || left.id.localeCompare(right.id))
    for (const completion of active) {
      const item = plan.items.find((entry) => entry.id === completion.dayPlanItemId)
      if (!item) continue
      item.status = 'completed'
      item.completionId = completion.id
      item.actual = {
        source: clone(completion.source),
        quantity: completion.quantity,
        unit: completion.unit,
        servings: completion.servings,
        completedAt: completion.completedAt,
        nutrition: clone(completion.nutrition),
        costMinor: completion.costMinor,
        inventoryTransactionIds: [...completion.inventoryTransactionIds],
        preparedFoodEventIds: [...(completion.preparedFoodEventIds ?? [])],
        actualMinutes: completion.actualMinutes,
        estimatedEnergyKcal: completion.estimatedEnergyKcal,
        energyIsEstimate: completion.energyIsEstimate,
      }
    }
    return plan
  }

  private async catalogFacts(userId: string, item: CatalogItem, quantity: number, unit: string, asOf: string) {
    const units = await this.options.listUnits(userId)
    const conversions = units.map((value) => ({ code: value.code, dimension: value.dimension, baseCode: value.baseCode, toBaseFactor: value.toBaseFactor }))
    let nutrition: Record<string, number> | null = null
    if (item.nutrition) {
      const converted = convertUnit({ itemId: item.id, quantity, fromUnit: unit, toBaseUnit: item.nutrition.basisUnit, itemConversions: item.itemConversions, units: conversions })
      if (converted.status === 'complete') {
        const factor = converted.baseQuantity / item.nutrition.basisQuantity
        const values = item.nutrition.values
        nutrition = {
          energyKcal: round(values.energyKcal * factor), proteinGrams: round(values.proteinGrams * factor),
          fatGrams: round(values.fatGrams * factor), carbohydrateGrams: round(values.carbohydrateGrams * factor),
          ...Object.fromEntries(Object.entries(values.custom ?? {}).map(([name, value]) => [name, round(value * factor)])),
        }
      }
    }
    let costMinor: number | null = null
    const price = selectEffectivePrice(item.pricePoints, asOf)
    if (price) {
      const converted = convertUnit({ itemId: item.id, quantity, fromUnit: unit, toBaseUnit: price.purchaseUnit, itemConversions: item.itemConversions, units: conversions })
      if (converted.status === 'complete') costMinor = round(price.amountMinor * converted.baseQuantity / price.purchaseQuantity)
    }
    return { nutrition, costMinor }
  }

  private async buildMedicineRecurrenceRule(
    userId: string,
    input: CreateMedicineRecurrenceRuleInput,
    identity: Pick<MedicineRecurrenceRule, 'id' | 'entityVersion' | 'createdAt' | 'updatedAt' | 'deletedAt'>,
  ): Promise<MedicineRecurrenceRule> {
    const item = await this.options.getCatalogItem(userId, input.sourceId)
    if (!item || item.kind !== 'medicine' || item.deletedAt != null || item.status !== 'active') {
      throw new LifePlanningDomainError('NOT_FOUND', 'The medicine fact does not exist.', 404)
    }
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
      throw new LifePlanningDomainError('INVALID_INPUT', 'Medicine recurrence quantity must be positive.')
    }
    const unit = this.text(input.unit, 'unit').toLocaleLowerCase()
    if (!new Set([item.baseUnit, ...item.availableUnits].map((value) => value.toLocaleLowerCase())).has(unit)) {
      throw new LifePlanningDomainError('INVALID_UNIT', 'The medicine recurrence unit is not available for this catalog item.', 409)
    }
    return {
      ...identity,
      title: this.text(input.title, 'title'),
      sourceId: item.id,
      quantity: input.quantity,
      unit,
      recurrence: normalizeMedicineRecurrence(input.recurrence),
    }
  }

  private template(userId: string, id: string) { return this.templates.find((entry) => entry.userId === userId && entry.value.id === id)?.value }
  private dayPlan(userId: string, date: string) { return this.dayPlans.find((entry) => entry.userId === userId && entry.value.date === date)?.value }
  private text(value: string, field: string) { const result = value?.trim(); if (!result) throw new LifePlanningDomainError('INVALID_INPUT', `${field} is required.`); return result }
  private nonNegative(value: number, field: string) { if (!Number.isFinite(value) || value < 0) throw new LifePlanningDomainError('INVALID_INPUT', `${field} must be non-negative.`); return value }
  private validDate(value: string, field: string) { const parsed = new Date(`${value}T00:00:00.000Z`); if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new LifePlanningDomainError('INVALID_DATE', `${field} must be a real date-only value.`); return value }
  private validTime(value: string, field: string) { if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new LifePlanningDomainError('INVALID_TIME', `${field} must use HH:mm.`); return value }
  private validTimestamp(value: string, field: string) { const parsed = new Date(value); if (Number.isNaN(parsed.getTime())) throw new LifePlanningDomainError('INVALID_DATE', `${field} must be a valid timestamp.`); return parsed.toISOString() }

  private async idempotently<T>(userId: string, operation: string, rawKey: string, input: unknown, create: () => Promise<T>): Promise<T> {
    const key = rawKey.trim()
    if (!key || key.length > 190) throw new LifePlanningDomainError('INVALID_IDEMPOTENCY_KEY', 'A valid idempotency key is required.')
    const mapKey = `${userId}\0${operation}\0${key}`
    const inputHash = hash(input)
    const existing = this.idempotency.get(mapKey)
    if (existing) {
      if (existing.hash !== inputHash) throw new LifePlanningDomainError('IDEMPOTENCY_CONFLICT', 'The idempotency key belongs to another planning request.', 409)
      return clone(await existing.promise) as T
    }
    const promise = Promise.resolve().then(create)
    this.idempotency.set(mapKey, { hash: inputHash, promise })
    try { return clone(await promise) } catch (error) { this.idempotency.delete(mapKey); throw error }
  }
}
