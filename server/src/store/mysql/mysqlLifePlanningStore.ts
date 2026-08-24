import { createHash, randomUUID } from 'node:crypto'
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'
import { convertUnit, selectEffectivePrice, type CatalogItem, type LifeUnit, type NutritionValues } from '../../domain/life/catalog.js'
import { allocateEarliestExpiry, type InventoryBatch, type InventoryForecast } from '../../domain/life/inventory.js'
import type { PreparedFoodConsumption, PreparedFoodStock, RecipeCalculation } from '../../domain/life/recipes.js'
import {
  LifePlanningDomainError,
  calculateFitnessActual,
  copyPlannedDay,
  expandMedicineRecurrence,
  hasPlanningConflicts,
  normalizeMedicineRecurrence,
  reconcileDayPlanDraft,
  previewTemplateApplication,
  scheduleRelativeToMeal,
  transitionPlanItem,
  type CreateDayPlanInput,
  type CreateFitnessActivityInput,
  type CreateMedicineRecurrenceRuleInput,
  type CreatePlanTemplateInput,
  type DayPlan,
  type FitnessActivity,
  type LifePlanItem,
  type MealSlot,
  type MedicineOccurrenceTransitionInput,
  type MedicineRecurrence,
  type MedicineRecurrenceOccurrence,
  type MedicineRecurrenceRule,
  type PlanItemInput,
  type PlanTemplate,
  type PlanningCompletionInput,
  type PlanningCompletionSource,
  type PlanningCompletionSnapshot,
  type PlanningTimeline,
  type TemplatePlanItem,
  type UpdatePlanTemplateInput,
  type UpdateDayPlanInput,
  type UpdateMedicineRecurrenceRuleInput,
} from '../../domain/life/planning.js'
import type { LifePlanningStore } from '../lifePlanningStore.js'
import { buildPlanningProjection, buildPlanningProjections } from '../planningProjection.js'

type Executor = Pool | PoolConnection
type SqlRow = RowDataPacket & Record<string, unknown>
const clone = <T>(value: T): T => structuredClone(value)
const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => `${JSON.stringify(name)}:${stable(item)}`).join(',')}}`
    : JSON.stringify(value)
const requestHash = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex').toUpperCase()
const sqlDate = (value: string) => new Date(value).toISOString().slice(0, 23).replace('T', ' ')
const iso = (value: unknown) => {
  if (value instanceof Date) return value.toISOString()
  const raw = String(value)
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? normalized : parsed.toISOString()
}
const parse = <T>(value: unknown): T => typeof value === 'string' ? JSON.parse(value) as T : clone(value) as T
const round = (value: number) => Math.round((value + Number.EPSILON) * 1_000_000_000) / 1_000_000_000
const scaleNutrition = (value: NutritionValues, factor: number): NutritionValues => ({
  energyKcal: round(value.energyKcal * factor), proteinGrams: round(value.proteinGrams * factor),
  fatGrams: round(value.fatGrams * factor), carbohydrateGrams: round(value.carbohydrateGrams * factor),
  ...(value.custom ? { custom: Object.fromEntries(Object.entries(value.custom).map(([name, amount]) => [name, round(amount * factor)])) } : {}),
})
const flattenNutrition = (value: NutritionValues): Record<string, number> => ({
  energyKcal: value.energyKcal, proteinGrams: value.proteinGrams, fatGrams: value.fatGrams,
  carbohydrateGrams: value.carbohydrateGrams, ...value.custom,
})
const addFacts = (left: Record<string, number>, right: Record<string, number>) => {
  for (const [name, amount] of Object.entries(right)) left[name] = round((left[name] ?? 0) + amount)
  return left
}

async function rows<T>(executor: Executor, sql: string, values: unknown[] = []): Promise<T[]> {
  const [result] = await executor.execute(sql, values as never[])
  return result as unknown as T[]
}

export class MySqlLifePlanningStore implements LifePlanningStore {
  constructor(private readonly pool: Pool, private readonly options: {
    createId?: () => string
    now?: () => string
    getCatalogItem: (userId: string, itemId: string) => Promise<CatalogItem | undefined>
    getCatalogItemFrom: (executor: Executor, userId: string, itemId: string) => Promise<CatalogItem | undefined>
    listUnits: (userId: string) => Promise<LifeUnit[]>
    listUnitsFrom: (executor: Executor, userId: string) => Promise<LifeUnit[]>
    listInventoryForecasts: (userId: string) => Promise<InventoryForecast[]>
    calculateStoredRecipe: (userId: string, recipeId: string, input: { mode: 'latest' | 'pinned'; versionId?: string; asOf: string }) => Promise<(RecipeCalculation & { recipeVersionId: string; recipeVersionNumber: number }) | undefined>
    calculateStoredRecipeFrom: (executor: Executor, userId: string, recipeId: string, input: { mode: 'latest' | 'pinned'; versionId?: string; asOf: string }) => Promise<(RecipeCalculation & { recipeVersionId: string; recipeVersionNumber: number }) | undefined>
    listPreparedFood: (userId: string) => Promise<PreparedFoodStock[]>
  }) {}

  private createId = () => this.options.createId?.() ?? randomUUID()
  private now = () => this.options.now?.() ?? new Date().toISOString()

  async getPlanningCatalogReferences(userId: string, itemId: string) {
    const templateRows = await rows<SqlRow>(this.pool, 'SELECT id, items_json FROM life_plan_templates WHERE user_id = ?', [userId])
    const dayRows = await rows<SqlRow>(this.pool, 'SELECT id, items_json FROM life_day_plans WHERE user_id = ?', [userId])
    const references = (row: SqlRow, onlyFuture: boolean) => parse<LifePlanItem[] | TemplatePlanItem[]>(row.items_json).some((entry) => {
      const item = entry as LifePlanItem
      return item.source?.type === 'catalog-item' && item.source.id === itemId && (!onlyFuture || item.status !== 'completed')
    })
    return {
      templateIds: templateRows.filter((row) => references(row, false)).map((row) => String(row.id)).sort(),
      futurePlanIds: dayRows.filter((row) => references(row, true)).map((row) => String(row.id)).sort(),
    }
  }

  async exportOwnerPortableDataFrom(executor:Executor,userId:string){
    const templateRows=await rows<SqlRow>(executor,'SELECT * FROM life_plan_templates WHERE user_id=? ORDER BY created_at,id',[userId])
    const dayRows=await rows<SqlRow>(executor,'SELECT * FROM life_day_plans WHERE user_id=? ORDER BY plan_date,id',[userId])
    const fitnessRows=await rows<SqlRow>(executor,'SELECT * FROM fitness_activities WHERE user_id=? ORDER BY created_at,id',[userId])
    const ruleRows=await rows<SqlRow>(executor,'SELECT * FROM life_medicine_recurrence_rules WHERE user_id=? ORDER BY created_at,id',[userId])
    const occurrenceRows=await rows<SqlRow>(executor,'SELECT * FROM life_medicine_recurrence_occurrences WHERE user_id=? ORDER BY original_date,original_time,id',[userId])
    const completionRows=await rows<SqlRow>(executor,'SELECT * FROM life_completion_snapshots WHERE user_id=? ORDER BY completed_at,id',[userId])
    const completionIds=completionRows.map((row)=>String(row.id))
    const inventoryLinks=completionIds.length?await rows<SqlRow>(executor,`SELECT completion_id,transaction_id FROM life_completion_inventory_events
      WHERE user_id=? AND completion_id IN (${completionIds.map(()=>'?').join(',')}) ORDER BY completion_id,position`,[userId,...completionIds]):[]
    const preparedLinks=completionIds.length?await rows<SqlRow>(executor,`SELECT * FROM life_completion_prepared_food_events
      WHERE user_id=? AND completion_id IN (${completionIds.map(()=>'?').join(',')}) ORDER BY completion_id,position`,[userId,...completionIds]):[]
    const reversalRows=await rows<SqlRow>(executor,'SELECT * FROM life_completion_reversals WHERE user_id=? ORDER BY created_at,id',[userId])
    const applicationRows=await rows<SqlRow>(executor,`SELECT application.*,plan.plan_date FROM life_template_applications application
      JOIN life_day_plans plan ON plan.user_id=application.user_id AND plan.id=application.day_plan_id
      WHERE application.user_id=? ORDER BY application.applied_at,application.id`,[userId])
    return{
      planTemplates:templateRows.map((row)=>this.mapTemplate(row)),
      dayPlans:await Promise.all(dayRows.map((row)=>this.hydrateDayPlan(executor,userId,this.mapDayPlan(row)))),
      fitnessActivities:fitnessRows.map((row)=>this.mapFitness(row)),
      medicineRecurrenceRules:ruleRows.map((row)=>this.mapMedicineRecurrenceRule(row)),
      medicineOccurrences:occurrenceRows.map((row)=>this.mapMedicineOccurrence(row)),
      completionSnapshots:completionRows.map((row):PlanningCompletionSnapshot=>({
        id:String(row.id),dayPlanId:row.day_plan_id==null?null:String(row.day_plan_id),
        dayPlanItemId:row.day_plan_item_id==null?null:String(row.day_plan_item_id),kind:row.item_kind as PlanningCompletionSnapshot['kind'],
        completionSource:parse(row.completion_source_json),source:row.source_json==null?null:parse(row.source_json),
        quantity:row.actual_quantity==null?null:Number(row.actual_quantity),unit:row.actual_unit==null?null:String(row.actual_unit),
        servings:row.actual_servings==null?null:Number(row.actual_servings),completedAt:iso(row.completed_at),
        nutrition:row.nutrition_json==null?null:parse(row.nutrition_json),costMinor:row.cost_minor==null?null:Number(row.cost_minor),
        inventoryTransactionIds:inventoryLinks.filter((link)=>String(link.completion_id)===String(row.id)).map((link)=>String(link.transaction_id)),
        preparedFoodEventIds:preparedLinks.filter((link)=>String(link.completion_id)===String(row.id)).map((link)=>String(link.id)),
        actualMinutes:row.actual_minutes==null?null:Number(row.actual_minutes),
        estimatedEnergyKcal:row.estimated_energy_kcal==null?null:Number(row.estimated_energy_kcal),
        energyIsEstimate:Boolean(row.energy_is_estimate),
      })),
      completionReversals:reversalRows.map((row)=>({
        completionId:String(row.completion_id),reversedInventoryTransactionIds:parse<string[]>(row.reversed_inventory_transaction_ids),
        restoredPreparedFoodEventIds:parse<string[]>(row.restored_prepared_food_event_ids),createdAt:iso(row.created_at),
      })),
      completionPreparedFoodEvents:completionIds.map((completionId)=>({
        completionId,
        events:preparedLinks.filter((row)=>String(row.completion_id)===completionId).map((row)=>({
          id:String(row.id),stockId:String(row.prepared_food_stock_id),portions:Number(row.portions),
          nutrition:parse(row.nutrition_json),cookingOilGrams:Number(row.cooking_oil_grams),costMinor:Number(row.cost_minor),
        })),
      })).filter((entry)=>entry.events.length>0),
      templateApplications:applicationRows.map((row)=>({
        id:String(row.id),templateId:String(row.template_id),dayPlanId:String(row.day_plan_id),date:String(row.plan_date).slice(0,10),
        appliedVersion:Number(row.applied_template_version),resolution:String(row.resolution),appliedAt:iso(row.applied_at),
      })),
    }
  }

  async listPlanTemplates(userId: string) {
    const found = await rows<SqlRow>(this.pool, 'SELECT * FROM life_plan_templates WHERE user_id = ? ORDER BY name, id', [userId])
    return found.map((row) => this.mapTemplate(row))
  }

  async getPlanTemplate(userId: string, id: string) {
    const found = await rows<SqlRow>(this.pool, 'SELECT * FROM life_plan_templates WHERE user_id = ? AND id = ? LIMIT 1', [userId, id])
    return found[0] ? this.mapTemplate(found[0]) : undefined
  }

  async createPlanTemplate(userId: string, input: CreatePlanTemplateInput, key: string) {
    return this.idempotently(userId, 'planning:create-template', key, input, async (connection) => {
      const value = await this.buildTemplate(connection, userId, input, 1)
      const timestamp = this.now()
      await connection.execute(`INSERT INTO life_plan_templates
        (id,user_id,name,meal_slots_json,items_json,entity_version,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)`,
      [value.id, userId, value.name, JSON.stringify(value.mealSlots), JSON.stringify(value.items), sqlDate(timestamp), sqlDate(timestamp)])
      return value
    })
  }

  async updatePlanTemplate(userId: string, id: string, input: UpdatePlanTemplateInput) {
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const found = await rows<SqlRow>(connection, 'SELECT * FROM life_plan_templates WHERE user_id = ? AND id = ? LIMIT 1 FOR UPDATE', [userId, id])
      if (!found[0]) { await connection.rollback(); return undefined }
      const current = this.mapTemplate(found[0])
      if (current.entityVersion !== input.entityVersion) throw new LifePlanningDomainError('VERSION_CONFLICT', 'The plan template changed since it was loaded.', 409)
      const next = await this.buildTemplate(connection, userId, input, current.entityVersion + 1, current)
      await connection.execute('UPDATE life_plan_templates SET name=?,meal_slots_json=?,items_json=?,entity_version=entity_version+1,updated_at=? WHERE user_id=? AND id=?',
        [next.name, JSON.stringify(next.mealSlots), JSON.stringify(next.items), sqlDate(this.now()), userId, id])
      await connection.commit()
      return next
    } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
  }

  async getDayPlan(userId: string, date: string) {
    this.validDate(date, 'date')
    const found = await rows<SqlRow>(this.pool, 'SELECT * FROM life_day_plans WHERE user_id = ? AND plan_date = ? LIMIT 1', [userId, date])
    return found[0] ? this.hydrateDayPlan(this.pool, userId, this.mapDayPlan(found[0])) : undefined
  }

  async getDayPlanProjection(userId: string, date: string) {
    const plan = await this.getDayPlan(userId, date)
    if (!plan) return undefined
    return buildPlanningProjection(userId, plan, {
      getCatalogItem: this.options.getCatalogItem,
      listUnits: this.options.listUnits,
      listInventoryForecasts: this.options.listInventoryForecasts,
      calculateStoredRecipe: this.options.calculateStoredRecipe,
      listPreparedFood: this.options.listPreparedFood,
      getFitnessActivity: async (ownerId, id) => {
        const found = await rows<SqlRow>(this.pool, 'SELECT * FROM fitness_activities WHERE user_id=? AND id=? LIMIT 1', [ownerId, id])
        return found[0] ? this.mapFitness(found[0]) : undefined
      },
    })
  }

  async listDayPlanProjections(userId: string, from: string, through: string) {
    return this.listDayPlanProjectionsFrom(this.pool, userId, from, through)
  }

  async listDayPlanProjectionsFrom(executor: Executor, userId: string, from: string, through: string) {
    this.validDate(from, 'from')
    this.validDate(through, 'through')
    if (through < from) throw new LifePlanningDomainError('INVALID_RANGE', 'through cannot precede from.', 400)
    const found = await rows<SqlRow>(executor, 'SELECT * FROM life_day_plans WHERE user_id=? AND plan_date>=? AND plan_date<=? ORDER BY plan_date,id', [userId, from, through])
    const plans = await Promise.all(found.map((row) => this.hydrateDayPlan(executor, userId, this.mapDayPlan(row))))
    return buildPlanningProjections(userId, plans, {
      getCatalogItem: (ownerId, itemId) => this.options.getCatalogItemFrom(executor, ownerId, itemId),
      listUnits: (ownerId) => this.options.listUnitsFrom(executor, ownerId),
      listInventoryForecasts: async () => [],
      calculateStoredRecipe: (ownerId, recipeId, input) => this.options.calculateStoredRecipeFrom(executor, ownerId, recipeId, input),
      listPreparedFood: async (ownerId) => {
        const prepared = await rows<SqlRow>(executor, 'SELECT * FROM life_prepared_food_stock WHERE user_id=? ORDER BY created_at,id', [ownerId])
        return prepared.map((row) => ({
          id: String(row.id), cookingSnapshotId: String(row.cooking_snapshot_id), recipeId: String(row.recipe_id),
          recipeVersionId: String(row.recipe_version_id), portionsCreated: Number(row.portions_created),
          portionsRemaining: Number(row.portions_remaining), nutritionRemaining: parse(row.nutrition_remaining),
          cookingOilGramsRemaining: Number(row.cooking_oil_grams_remaining), costRemainingMinor: Number(row.cost_remaining_minor),
          createdAt: iso(row.created_at),
        }))
      },
      getFitnessActivity: async (ownerId, id) => {
        const activity = await rows<SqlRow>(executor, 'SELECT * FROM fitness_activities WHERE user_id=? AND id=? LIMIT 1', [ownerId, id])
        return activity[0] ? this.mapFitness(activity[0]) : undefined
      },
    })
  }

  async createDayPlan(userId: string, input: CreateDayPlanInput, key: string) {
    return this.idempotently(userId, 'planning:create-day', key, input, async (connection) => {
      this.validDate(input.date, 'date')
      const duplicate = await rows<SqlRow>(connection, 'SELECT id FROM life_day_plans WHERE user_id=? AND plan_date=? LIMIT 1 FOR UPDATE', [userId, input.date])
      if (duplicate[0]) throw new LifePlanningDomainError('DAY_PLAN_EXISTS', 'A day plan already exists for this date.', 409)
      const mealSlots = this.validateMealSlots(input.mealSlots)
      const items = await this.buildItems(connection, userId, input.items, mealSlots)
      const value: DayPlan = { id: this.createId(), date: input.date, mealSlots, items, entityVersion: 1 }
      const timestamp = this.now()
      await connection.execute(`INSERT INTO life_day_plans
        (id,user_id,plan_date,meal_slots_json,items_json,entity_version,conflicted,created_at,updated_at) VALUES (?,?,?,?,?,1,FALSE,?,?)`,
      [value.id, userId, value.date, JSON.stringify(value.mealSlots), JSON.stringify(value.items), sqlDate(timestamp), sqlDate(timestamp)])
      return value
    })
  }

  async updateDayPlan(userId: string, date: string, input: UpdateDayPlanInput) {
    this.validDate(date, 'date')
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const found = await rows<SqlRow>(connection, 'SELECT * FROM life_day_plans WHERE user_id=? AND plan_date=? LIMIT 1 FOR UPDATE', [userId, date])
      if (!found[0]) {
        await connection.rollback()
        return undefined
      }
      const current = this.mapDayPlan(found[0])
      const mealSlots = this.validateMealSlots(input.mealSlots)
      const built = await this.buildItems(connection, userId, input.items, mealSlots)
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
      await this.persistDayPlan(connection, userId, next)
      await connection.commit()
      return clone(next)
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  async previewTemplateApplication(userId: string, date: string, templateId: string, resolution: 'merge' | 'replace' | 'skip') {
    const [dayPlan, template] = await Promise.all([this.getDayPlan(userId, date), this.getPlanTemplate(userId, templateId)])
    if (!dayPlan || !template) return undefined
    return previewTemplateApplication({ dayPlan, template, resolution })
  }

  async applyTemplateToDayPlan(userId: string, date: string, input: { templateId: string; resolution: 'merge' | 'replace' | 'skip'; entityVersion: number; templateVersion: number }, key: string) {
    const found = await rows<SqlRow>(this.pool, 'SELECT id FROM life_day_plans WHERE user_id=? AND plan_date=? LIMIT 1', [userId, date])
    const templateExists = await rows<SqlRow>(this.pool, 'SELECT id FROM life_plan_templates WHERE user_id=? AND id=? LIMIT 1', [userId, input.templateId])
    if (!found[0] || !templateExists[0]) return undefined
    return this.idempotently(userId, `planning:apply-template:${date}`, key, input, async (connection) => {
      const templateRows = await rows<SqlRow>(connection, 'SELECT * FROM life_plan_templates WHERE user_id=? AND id=? LIMIT 1 FOR UPDATE', [userId, input.templateId])
      const dayRows = await rows<SqlRow>(connection, 'SELECT * FROM life_day_plans WHERE user_id=? AND plan_date=? LIMIT 1 FOR UPDATE', [userId, date])
      if (!dayRows[0] || !templateRows[0]) throw new LifePlanningDomainError('NOT_FOUND', 'The plan or template does not exist.', 404)
      const dayPlan = this.mapDayPlan(dayRows[0]); const template = this.mapTemplate(templateRows[0])
      if (dayPlan.entityVersion !== input.entityVersion) throw new LifePlanningDomainError('VERSION_CONFLICT', 'The day plan changed since it was loaded.', 409)
      if (template.entityVersion !== input.templateVersion) throw new LifePlanningDomainError('TEMPLATE_VERSION_CONFLICT', 'The template changed after preview. Preview again before applying.', 409)
      const preview = previewTemplateApplication({ dayPlan, template, resolution: input.resolution })
      const existingIds = new Set(dayPlan.items.map((entry) => entry.id))
      const result = clone(preview.result)
      result.items = result.items.map((entry) => existingIds.has(entry.id) ? entry : { ...entry, id: this.createId() })
      result.entityVersion = dayPlan.entityVersion + 1
      await this.persistDayPlan(connection, userId, result)
      await connection.execute(`INSERT INTO life_template_applications
        (id,user_id,template_id,day_plan_id,applied_template_version,resolution,applied_at) VALUES (?,?,?,?,?,?,?)`,
      [this.createId(), userId, template.id, result.id, template.entityVersion, input.resolution, sqlDate(this.now())])
      return result
    })
  }

  async copyDayPlan(userId: string, date: string, targetDate: string, key: string) {
    const source = await this.getDayPlan(userId, date)
    if (!source) return undefined
    return this.idempotently(userId, `planning:copy-day:${date}`, key, { targetDate }, async (connection) => {
      const duplicate = await rows<SqlRow>(connection, 'SELECT id FROM life_day_plans WHERE user_id=? AND plan_date=? LIMIT 1 FOR UPDATE', [userId, targetDate])
      if (duplicate[0]) throw new LifePlanningDomainError('DAY_PLAN_EXISTS', 'The target date already has a day plan.', 409)
      const copied = copyPlannedDay({ source, targetDate, createId: this.createId }); copied.id = this.createId()
      const timestamp = this.now()
      await connection.execute(`INSERT INTO life_day_plans
        (id,user_id,plan_date,meal_slots_json,items_json,entity_version,conflicted,created_at,updated_at) VALUES (?,?,?,?,?,1,FALSE,?,?)`,
      [copied.id, userId, copied.date, JSON.stringify(copied.mealSlots), JSON.stringify(copied.items), sqlDate(timestamp), sqlDate(timestamp)])
      return copied
    })
  }

  async previewTemplateSync(userId: string, templateId: string, input: { fromDate: string; target: 'future-incomplete' | 'selected'; dates?: string[] }) {
    return this.buildSyncPreview(this.pool, userId, templateId, input)
  }

  async syncPlanTemplate(userId: string, templateId: string, input: { fromDate: string; target: 'future-incomplete' | 'selected'; dates?: string[]; templateVersion: number; dayPlanVersions: Record<string, number> }, key: string) {
    const exists = await this.getPlanTemplate(userId, templateId)
    if (!exists) return undefined
    return this.idempotently(userId, `planning:sync-template:${templateId}`, key, input, async (connection) => {
      const lockedTemplates = await rows<SqlRow>(connection, 'SELECT entity_version FROM life_plan_templates WHERE user_id=? AND id=? LIMIT 1 FOR UPDATE', [userId, templateId])
      if (!lockedTemplates[0]) throw new LifePlanningDomainError('NOT_FOUND', 'The plan template does not exist.', 404)
      if (Number(lockedTemplates[0].entity_version) !== input.templateVersion) throw new LifePlanningDomainError('TEMPLATE_VERSION_CONFLICT', 'The template changed after sync preview. Preview again before syncing.', 409)
      const preview = await this.buildSyncPreview(connection, userId, templateId, input)
      if (!preview) throw new LifePlanningDomainError('NOT_FOUND', 'The plan template does not exist.', 404)
      const expectedDates = Object.keys(input.dayPlanVersions).sort()
      if (JSON.stringify(expectedDates) !== JSON.stringify([...preview.affectedDates].sort())) throw new LifePlanningDomainError('DAY_PLAN_VERSION_CONFLICT', 'The sync preview scope changed. Preview again before syncing.', 409)
      for (const change of preview.changes) {
        const found = await rows<SqlRow>(connection, 'SELECT * FROM life_day_plans WHERE user_id=? AND plan_date=? LIMIT 1 FOR UPDATE', [userId, change.date])
        if (!found[0]) throw new LifePlanningDomainError('NOT_FOUND', 'A selected day plan disappeared during sync.', 409)
        const plan = this.mapDayPlan(found[0])
        if (plan.entityVersion !== input.dayPlanVersions[change.date]) throw new LifePlanningDomainError('DAY_PLAN_VERSION_CONFLICT', `Day plan ${change.date} changed after sync preview.`, 409)
        plan.items = change.after.map((entry) => entry.id.startsWith('sync-preview:') ? { ...entry, id: this.createId() } : entry)
        plan.entityVersion += 1
        await this.persistDayPlan(connection, userId, plan)
      }
      return { affectedDates: preview.affectedDates, excludedCompletedDates: preview.excludedCompletedDates }
    })
  }

  async previewMedicineRecurrence(userId: string, sourceId: string, recurrence: MedicineRecurrence) {
    const item = await this.options.getCatalogItem(userId, sourceId)
    if (!item || item.kind !== 'medicine' || item.deletedAt != null || item.status !== 'active') throw new LifePlanningDomainError('NOT_FOUND', 'The medicine fact does not exist.', 404)
    return { writesApplied: false as const, occurrences: expandMedicineRecurrence(recurrence) }
  }

  async listMedicineRecurrenceRules(userId: string) {
    const found = await rows<SqlRow>(this.pool, `SELECT * FROM life_medicine_recurrence_rules
      WHERE user_id=? AND deleted_at IS NULL ORDER BY title,id`, [userId])
    return found.map((row) => this.mapMedicineRecurrenceRule(row))
  }

  async createMedicineRecurrenceRule(userId: string, input: CreateMedicineRecurrenceRuleInput, key: string) {
    return this.idempotently(userId, 'planning:create-medicine-recurrence', key, input, async (connection) => {
      const timestamp = this.now()
      const value = await this.buildMedicineRecurrenceRule(connection, userId, input, {
        id: this.createId(), entityVersion: 1, createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
      })
      await connection.execute(`INSERT INTO life_medicine_recurrence_rules
        (id,user_id,title,source_item_id,quantity,unit,recurrence_json,entity_version,created_at,updated_at,deleted_at)
        VALUES (?,?,?,?,?,?,?,1,?,?,NULL)`, [
        value.id, userId, value.title, value.sourceId, value.quantity, value.unit,
        JSON.stringify(value.recurrence), sqlDate(value.createdAt), sqlDate(value.updatedAt),
      ])
      await this.insertMedicineOccurrences(connection, userId, this.buildMedicineOccurrences(value, timestamp))
      return value
    })
  }

  async updateMedicineRecurrenceRule(userId: string, id: string, input: UpdateMedicineRecurrenceRuleInput) {
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const found = await rows<SqlRow>(connection, `SELECT * FROM life_medicine_recurrence_rules
        WHERE user_id=? AND id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`, [userId, id])
      if (!found[0]) { await connection.rollback(); return undefined }
      const current = this.mapMedicineRecurrenceRule(found[0])
      if (current.entityVersion !== input.entityVersion) {
        throw new LifePlanningDomainError(
          'VERSION_CONFLICT',
          'The medicine recurrence rule changed since it was loaded.',
          409,
          { current: clone(current) },
        )
      }
      const occurrenceRows = await rows<SqlRow>(connection, `SELECT * FROM life_medicine_recurrence_occurrences
        WHERE user_id=? AND rule_id=? ORDER BY original_date,original_time,id FOR UPDATE`, [userId, id])
      const next = await this.buildMedicineRecurrenceRule(connection, userId, input, {
        id: current.id, entityVersion: current.entityVersion + 1, createdAt: current.createdAt,
        updatedAt: this.maxTimestamp(current.updatedAt, this.now()), deletedAt: null,
      })
      await this.reconcileMedicineOccurrences(connection, userId, occurrenceRows.map((row) => this.mapMedicineOccurrence(row)), next)
      await connection.execute(`UPDATE life_medicine_recurrence_rules
        SET title=?,source_item_id=?,quantity=?,unit=?,recurrence_json=?,entity_version=entity_version+1,updated_at=GREATEST(updated_at,?)
        WHERE user_id=? AND id=? AND deleted_at IS NULL`, [
        next.title, next.sourceId, next.quantity, next.unit, JSON.stringify(next.recurrence),
        sqlDate(next.updatedAt), userId, id,
      ])
      await connection.commit()
      return next
    } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
  }

  async deleteMedicineRecurrenceRule(userId: string, id: string, entityVersion: number) {
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const found = await rows<SqlRow>(connection, `SELECT * FROM life_medicine_recurrence_rules
        WHERE user_id=? AND id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`, [userId, id])
      if (!found[0]) { await connection.rollback(); return false }
      const current = this.mapMedicineRecurrenceRule(found[0])
      if (current.entityVersion !== entityVersion) {
        throw new LifePlanningDomainError(
          'VERSION_CONFLICT',
          'The medicine recurrence rule changed since it was loaded.',
          409,
          { current: clone(current) },
        )
      }
      const timestamp = this.now()
      await rows<SqlRow>(connection, `SELECT id FROM life_medicine_recurrence_occurrences
        WHERE user_id=? AND rule_id=? ORDER BY original_date,original_time,id FOR UPDATE`, [userId, id])
      await connection.execute(`UPDATE life_medicine_recurrence_occurrences
        SET status='cancelled',completion_id=NULL,entity_version=entity_version+1,updated_at=GREATEST(updated_at,?)
        WHERE user_id=? AND rule_id=? AND status='planned' AND TIMESTAMP(scheduled_date,scheduled_time)>?`,
      [sqlDate(timestamp), userId, id, sqlDate(timestamp)])
      await connection.execute(`UPDATE life_medicine_recurrence_rules
        SET deleted_at=?,updated_at=GREATEST(updated_at,?),entity_version=entity_version+1 WHERE user_id=? AND id=? AND deleted_at IS NULL`,
      [sqlDate(timestamp), sqlDate(timestamp), userId, id])
      await connection.commit()
      return true
    } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
  }

  async listCalendar(userId: string, from: string, to: string, today: string) {
    this.validDate(from, 'from'); this.validDate(to, 'to'); this.validDate(today, 'today')
    if (to < from) throw new LifePlanningDomainError('INVALID_DATE_RANGE', 'to cannot precede from.')
    const [dayRows, occurrenceRows] = await Promise.all([
      rows<SqlRow>(this.pool, 'SELECT * FROM life_day_plans WHERE user_id=? AND plan_date>=? AND plan_date<=? ORDER BY plan_date', [userId, from, to]),
      rows<SqlRow>(this.pool, `SELECT * FROM life_medicine_recurrence_occurrences
        WHERE user_id=? AND scheduled_date>=? AND scheduled_date<=? AND status<>'cancelled'
        ORDER BY scheduled_date,scheduled_time,id`, [userId, from, to]),
    ])
    const days = new Map(dayRows.map((row) => [String(row.plan_date).slice(0, 10), { row, plan: this.mapDayPlan(row) }]))
    const occurrences = new Map<string, MedicineRecurrenceOccurrence[]>()
    for (const row of occurrenceRows) {
      const occurrence = this.mapMedicineOccurrence(row)
      const values = occurrences.get(occurrence.scheduledDate) ?? []
      values.push(occurrence)
      occurrences.set(occurrence.scheduledDate, values)
    }
    const dates = new Set([...days.keys(), ...occurrences.keys()])
    return [...dates].sort().map((date) => {
      const day = days.get(date)
      const planItems = day?.plan.items ?? []
      const medicineItems = occurrences.get(date) ?? []
      const itemCount = planItems.length + medicineItems.length
      const completedCount = planItems.filter((item) => item.status === 'completed').length
        + medicineItems.filter((item) => item.status === 'completed').length
      const allComplete = itemCount > 0
        && planItems.every((item) => item.status === 'completed' || item.status === 'skipped')
        && medicineItems.every((item) => item.status === 'completed' || item.status === 'skipped')
      const conflicted = day != null && (Boolean(day.row.conflicted) || hasPlanningConflicts(day.plan))
      const state = conflicted ? 'conflicted' as const
        : allComplete ? 'complete' as const
          : date < today ? 'past-incomplete' as const
            : 'planned' as const
      return { date, state, itemCount, completedCount }
    })
  }

  async getPlanningTimeline(userId: string, date: string): Promise<PlanningTimeline> {
    this.validDate(date, 'date')
    const [plan, occurrenceRows] = await Promise.all([
      this.getDayPlan(userId, date),
      rows<SqlRow>(this.pool, `SELECT * FROM life_medicine_recurrence_occurrences
        WHERE user_id=? AND scheduled_date=? AND status<>'cancelled' ORDER BY scheduled_time,id`, [userId, date]),
    ])
    const planItems = (plan?.items ?? []).map((item) => ({ ...clone(item), sourceType: 'day-plan-item' as const }))
    const occurrences = occurrenceRows.map((row) => ({ ...this.mapMedicineOccurrence(row), sourceType: 'medicine-occurrence' as const }))
    return {
      date,
      timelineItems: [...planItems, ...occurrences].sort((left, right) => (
        (left.scheduledTime ?? '').localeCompare(right.scheduledTime ?? '')
        || left.sourceType.localeCompare(right.sourceType)
        || left.id.localeCompare(right.id)
      )),
    }
  }

  async transitionMedicineOccurrence(
    userId: string,
    id: string,
    input: MedicineOccurrenceTransitionInput,
    idempotencyKey: string,
  ) {
    const owned = await rows<SqlRow>(this.pool, `SELECT id FROM life_medicine_recurrence_occurrences
      WHERE user_id=? AND id=? LIMIT 1`, [userId, id])
    if (!owned[0]) return undefined
    return this.idempotently(userId, `planning:transition-medicine-occurrence:${id}`, idempotencyKey, input, async (connection) => {
      const found = await rows<SqlRow>(connection, `SELECT * FROM life_medicine_recurrence_occurrences
        WHERE user_id=? AND id=? LIMIT 1 FOR UPDATE`, [userId, id])
      if (!found[0]) return undefined
      const current = this.mapMedicineOccurrence(found[0])
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
      current.updatedAt = this.maxTimestamp(current.updatedAt, transitionedAt)
      await connection.execute(`UPDATE life_medicine_recurrence_occurrences
        SET scheduled_date=?,scheduled_time=?,status=?,completion_id=NULL,entity_version=?,updated_at=GREATEST(updated_at,?)
        WHERE user_id=? AND id=?`, [
        current.scheduledDate, current.scheduledTime, current.status, current.entityVersion,
        sqlDate(current.updatedAt), userId, current.id,
      ])
      return current
    })
  }

  async listFitnessActivities(userId: string) {
    const found = await rows<SqlRow>(this.pool, 'SELECT * FROM fitness_activities WHERE user_id=? ORDER BY name,id', [userId])
    return found.map((row) => this.mapFitness(row))
  }

  async createFitnessActivity(userId: string, input: CreateFitnessActivityInput, key: string) {
    return this.idempotently(userId, 'planning:create-fitness', key, input, async (connection) => {
      const timestamp = this.now()
      const value: FitnessActivity = {
        id: this.createId(), name: this.text(input.name, 'name'), defaultMinutes: this.nonNegative(input.defaultMinutes, 'defaultMinutes'),
        kcalPerHour: this.nonNegative(input.kcalPerHour, 'kcalPerHour'), intensity: this.text(input.intensity, 'intensity'),
        steps: input.steps.map((entry) => this.text(entry, 'step')), equipment: input.equipment.map((entry) => this.text(entry, 'equipment')),
        entityVersion: 1, createdAt: timestamp, updatedAt: timestamp,
      }
      await connection.execute(`INSERT INTO fitness_activities
        (id,user_id,name,default_minutes,kcal_per_hour,intensity,steps_json,equipment_json,entity_version,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,1,?,?)`, [value.id,userId,value.name,value.defaultMinutes,value.kcalPerHour,value.intensity,JSON.stringify(value.steps),JSON.stringify(value.equipment),sqlDate(timestamp),sqlDate(timestamp)])
      return value
    })
  }

  async transitionDayPlanItem(userId: string, date: string, itemId: string, input: { entityVersion: number; action: 'complete' | 'skip' | 'delay' | 'backfill'; at: string; delayedUntil?: string }) {
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const found = await rows<SqlRow>(connection, 'SELECT * FROM life_day_plans WHERE user_id=? AND plan_date=? LIMIT 1 FOR UPDATE', [userId, date])
      if (!found[0]) { await connection.rollback(); return undefined }
      const plan = this.mapDayPlan(found[0]); const item = plan.items.find((entry) => entry.id === itemId)
      if (!item) { await connection.rollback(); return undefined }
      if (item.entityVersion !== input.entityVersion) throw new LifePlanningDomainError('VERSION_CONFLICT', 'The plan item changed since it was loaded.', 409)
      if (input.action === 'complete' || input.action === 'backfill') throw new LifePlanningDomainError('COMPLETION_ROUTE_REQUIRED', 'Completed and backfilled items must use the immutable completion route.', 409)
      const next = transitionPlanItem({ item, ...input }); Object.assign(item, next); plan.entityVersion += 1
      await this.persistDayPlan(connection,userId,plan); await connection.commit(); return clone(item)
    } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
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
    return this.idempotently(userId, 'planning:create-completion', key, input, async (connection) => {
      if (!input?.source || !['day-plan-item', 'medicine-occurrence'].includes(input.source.type)) {
        throw new LifePlanningDomainError('INVALID_SOURCE', 'A single supported planning completion source is required.')
      }
      const completedAt = this.validTimestamp(input.completedAt, 'completedAt')
      let plan:DayPlan|null=null
      let occurrence:MedicineRecurrenceOccurrence|null=null
      let item:LifePlanItem
      let completionSource:PlanningCompletionSource
      let actualInput:{actualMinutes?:number;overrideEnergyKcal?:number}={}
      if(input.source.type==='day-plan-item'){
        const dayInput=input as Extract<PlanningCompletionInput,{source:{type:'day-plan-item'}}>
        const source=dayInput.source
        this.validDate(source.date,'date')
        const found=await rows<SqlRow>(connection,'SELECT * FROM life_day_plans WHERE user_id=? AND plan_date=? LIMIT 1 FOR UPDATE',[userId,source.date])
        if(!found[0])throw new LifePlanningDomainError('NOT_FOUND','The day plan item does not exist.',404)
        plan=this.mapDayPlan(found[0])
        const planItem=plan.items.find((entry)=>entry.id===source.dayPlanItemId)
        if(!planItem)throw new LifePlanningDomainError('NOT_FOUND','The day plan item does not exist.',404)
        if(planItem.status==='completed')throw new LifePlanningDomainError('ITEM_ALREADY_COMPLETED','The plan item is already completed.',409)
        item=planItem
        completionSource={type:'day-plan-item',dayPlanId:plan.id,dayPlanItemId:item.id}
        actualInput={
          ...(dayInput.actualMinutes===undefined?{}:{actualMinutes:dayInput.actualMinutes}),
          ...(dayInput.overrideEnergyKcal===undefined?{}:{overrideEnergyKcal:dayInput.overrideEnergyKcal}),
        }
      }else{
        const found=await rows<SqlRow>(connection,`SELECT * FROM life_medicine_recurrence_occurrences
          WHERE user_id=? AND id=? LIMIT 1 FOR UPDATE`,[userId,input.source.id])
        if(!found[0])throw new LifePlanningDomainError('NOT_FOUND','The medicine occurrence does not exist.',404)
        occurrence=this.mapMedicineOccurrence(found[0])
        if(occurrence.entityVersion!==input.source.entityVersion){
          throw new LifePlanningDomainError(
            'VERSION_CONFLICT','The medicine occurrence changed since it was loaded.',409,{current:clone(occurrence)},
          )
        }
        if(occurrence.status!=='planned')throw new LifePlanningDomainError(
          'OCCURRENCE_NOT_COMPLETABLE','Only a planned medicine occurrence can be completed.',409,{current:clone(occurrence)},
        )
        item={
          id:occurrence.id,kind:'medicine',title:occurrence.title,mealSlotId:null,scheduledTime:occurrence.scheduledTime,
          source:clone(occurrence.source),quantity:occurrence.quantity,unit:occurrence.unit,servings:null,durationMinutes:null,
          status:'planned',completionId:null,actual:null,originTemplateItemId:null,entityVersion:occurrence.entityVersion,
        }
        completionSource={
          type:'medicine-occurrence',id:occurrence.id,ruleId:occurrence.ruleId,
          originalDate:occurrence.originalDate,originalTime:occurrence.originalTime,
          scheduledDate:occurrence.scheduledDate,scheduledTime:occurrence.scheduledTime,
        }
      }
      const completionId=this.createId()
      const facts=await this.completionFacts(connection,userId,item,completedAt,actualInput,completionId)
      const snapshot:PlanningCompletionSnapshot={
        id:completionId,dayPlanId:plan?.id??null,dayPlanItemId:plan?item.id:null,kind:item.kind,
        completionSource,source:clone(facts.source),quantity:item.quantity,unit:item.unit,servings:item.servings,completedAt,
        nutrition:facts.nutrition,costMinor:facts.costMinor,inventoryTransactionIds:facts.inventoryTransactionIds,
        preparedFoodEventIds:facts.preparedFoodEvents.map((entry)=>entry.id),actualMinutes:facts.actualMinutes,
        estimatedEnergyKcal:facts.estimatedEnergyKcal,energyIsEstimate:facts.energyIsEstimate,
      }
      await connection.execute(`INSERT INTO life_completion_snapshots
        (id,user_id,day_plan_id,day_plan_item_id,medicine_occurrence_id,completion_source_json,item_kind,source_json,actual_quantity,actual_unit,actual_servings,completed_at,nutrition_json,cost_minor,actual_minutes,estimated_energy_kcal,energy_is_estimate,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
        snapshot.id,userId,snapshot.dayPlanId,snapshot.dayPlanItemId,occurrence?.id??null,JSON.stringify(completionSource),
        item.kind,snapshot.source?JSON.stringify(snapshot.source):null,snapshot.quantity,snapshot.unit,snapshot.servings,
        sqlDate(completedAt),snapshot.nutrition?JSON.stringify(snapshot.nutrition):null,snapshot.costMinor,snapshot.actualMinutes,
        snapshot.estimatedEnergyKcal,snapshot.energyIsEstimate,sqlDate(this.now()),
      ])
      for(const [position,transactionId] of snapshot.inventoryTransactionIds.entries())await connection.execute(`INSERT INTO life_completion_inventory_events
        (user_id,completion_id,transaction_id,position,created_at) VALUES (?,?,?,?,?)`,[userId,snapshot.id,transactionId,position,sqlDate(this.now())])
      for(const [position,event] of facts.preparedFoodEvents.entries())await connection.execute(`INSERT INTO life_completion_prepared_food_events
        (id,user_id,completion_id,prepared_food_stock_id,portions,nutrition_json,cooking_oil_grams,cost_minor,position,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,[event.id,userId,snapshot.id,event.stockId,event.portions,JSON.stringify(event.nutrition),event.cookingOilGrams,event.costMinor,position,sqlDate(this.now())])
      if(occurrence){
        await connection.execute(`UPDATE life_medicine_recurrence_occurrences
          SET status='completed',completion_id=?,entity_version=entity_version+1,updated_at=GREATEST(updated_at,?) WHERE user_id=? AND id=?`,
        [snapshot.id,sqlDate(this.now()),userId,occurrence.id])
      }else{
        item.status='completed';item.completionId=snapshot.id;item.actual={source:clone(snapshot.source),quantity:snapshot.quantity,unit:snapshot.unit,servings:snapshot.servings,completedAt,nutrition:clone(snapshot.nutrition),costMinor:snapshot.costMinor,inventoryTransactionIds:[...snapshot.inventoryTransactionIds],preparedFoodEventIds:[...(snapshot.preparedFoodEventIds??[])],actualMinutes:snapshot.actualMinutes,estimatedEnergyKcal:snapshot.estimatedEnergyKcal,energyIsEstimate:snapshot.energyIsEstimate};item.entityVersion+=1;plan!.entityVersion+=1
        await this.persistDayPlan(connection,userId,plan!)
      }
      return snapshot
    })
  }

  async undoPlanningCompletion(userId: string, completionId: string, key: string) {
    const exists = await rows<SqlRow>(this.pool,'SELECT id FROM life_completion_snapshots WHERE user_id=? AND id=? LIMIT 1',[userId,completionId]);if(!exists[0])return undefined
    return this.idempotently(userId,`planning:undo-completion:${completionId}`,key,{},async(connection)=>{
      const completionRows=await rows<SqlRow>(connection,'SELECT * FROM life_completion_snapshots WHERE user_id=? AND id=? LIMIT 1 FOR UPDATE',[userId,completionId]);const completion=completionRows[0]
      if(!completion)throw new LifePlanningDomainError('NOT_FOUND','The completion does not exist.',404)
      const prior=await rows<SqlRow>(connection,'SELECT id FROM life_completion_reversals WHERE user_id=? AND completion_id=? LIMIT 1 FOR UPDATE',[userId,completionId]);if(prior[0])throw new LifePlanningDomainError('COMPLETION_ALREADY_UNDONE','The completion already has a reversal.',409)
      const completionSource=parse<PlanningCompletionSource>(completion.completion_source_json)
      let plan:DayPlan|null=null
      let item:LifePlanItem|null=null
      let occurrence:MedicineRecurrenceOccurrence|null=null
      let occurrenceUndoStatus:'planned'|'cancelled'='planned'
      if(completionSource.type==='medicine-occurrence'){
        const ruleRows=await rows<SqlRow>(connection,`SELECT * FROM life_medicine_recurrence_rules
          WHERE user_id=? AND id=? LIMIT 1 FOR UPDATE`,[userId,completionSource.ruleId])
        const occurrenceRows=await rows<SqlRow>(connection,`SELECT * FROM life_medicine_recurrence_occurrences
          WHERE user_id=? AND id=? LIMIT 1 FOR UPDATE`,[userId,completionSource.id])
        if(!occurrenceRows[0])throw new LifePlanningDomainError('COMPLETION_STATE_CONFLICT','The completion medicine occurrence no longer exists.',409)
        occurrence=this.mapMedicineOccurrence(occurrenceRows[0])
        if(occurrence.status!=='completed'||occurrence.completionId!==completionId){
          throw new LifePlanningDomainError('COMPLETION_STATE_CONFLICT','The completion is no longer attached to its medicine occurrence.',409)
        }
        const activeRule=ruleRows[0]&&ruleRows[0].deleted_at==null?this.mapMedicineRecurrenceRule(ruleRows[0]):null
        occurrenceUndoStatus=activeRule&&expandMedicineRecurrence(activeRule.recurrence).some(({date,time})=>(
          date===occurrence!.originalDate&&time===occurrence!.originalTime
        ))?'planned':'cancelled'
      }else{
        const planRows=await rows<SqlRow>(connection,'SELECT * FROM life_day_plans WHERE user_id=? AND id=? LIMIT 1 FOR UPDATE',[userId,completionSource.dayPlanId])
        if(!planRows[0])throw new LifePlanningDomainError('COMPLETION_STATE_CONFLICT','The completion day plan no longer exists.',409)
        plan=this.mapDayPlan(planRows[0]);item=plan.items.find((entry)=>entry.id===completionSource.dayPlanItemId)??null
        if(!item||item.completionId!==completionId)throw new LifePlanningDomainError('COMPLETION_STATE_CONFLICT','The completion is no longer attached to its plan item.',409)
      }
      const links=await rows<SqlRow>(connection,'SELECT transaction_id FROM life_completion_inventory_events WHERE user_id=? AND completion_id=? ORDER BY position',[userId,completionId]);const reversedInventoryTransactionIds:string[]=[]
      for(const link of links)reversedInventoryTransactionIds.push(await this.reverseInventoryEvent(connection,userId,String(link.transaction_id),completionId))
      const preparedRows=await rows<SqlRow>(connection,'SELECT * FROM life_completion_prepared_food_events WHERE user_id=? AND completion_id=? ORDER BY position FOR UPDATE',[userId,completionId])
      const restoredPreparedFoodEventIds:string[]=[]
      for(const event of preparedRows){await this.restorePreparedFood(connection,userId,event);restoredPreparedFoodEventIds.push(String(event.id))}
      await connection.execute('INSERT INTO life_completion_reversals (id,user_id,completion_id,reversed_inventory_transaction_ids,restored_prepared_food_event_ids,created_at) VALUES (?,?,?,?,?,?)',[this.createId(),userId,completionId,JSON.stringify(reversedInventoryTransactionIds),JSON.stringify(restoredPreparedFoodEventIds),sqlDate(this.now())])
      if(occurrence){
        await connection.execute(`UPDATE life_medicine_recurrence_occurrences
          SET status=?,completion_id=NULL,entity_version=entity_version+1,updated_at=GREATEST(updated_at,?) WHERE user_id=? AND id=?`,
        [occurrenceUndoStatus,sqlDate(this.now()),userId,occurrence.id])
      }else{
        item!.status='planned';item!.completionId=null;item!.actual=null;item!.entityVersion+=1;plan!.entityVersion+=1;await this.persistDayPlan(connection,userId,plan!)
      }
      return{completionId,reversedInventoryTransactionIds,restoredPreparedFoodEventIds,status:occurrence?occurrenceUndoStatus:'planned' as const}
    })
  }

  private async buildSyncPreview(executor:Executor,userId:string,templateId:string,input:{fromDate:string;target:'future-incomplete'|'selected';dates?:string[]}){
    this.validDate(input.fromDate,'fromDate');const templateRows=await rows<SqlRow>(executor,'SELECT * FROM life_plan_templates WHERE user_id=? AND id=? LIMIT 1',[userId,templateId]);if(!templateRows[0])return undefined;const template=this.mapTemplate(templateRows[0]);const selected=new Set(input.dates??[])
    const found=await rows<SqlRow>(executor,`SELECT DISTINCT d.* FROM life_template_applications a JOIN life_day_plans d ON d.user_id=a.user_id AND d.id=a.day_plan_id
      WHERE a.user_id=? AND a.template_id=? AND d.plan_date>=? ORDER BY d.plan_date`,[userId,templateId,input.fromDate]);const candidates=found.map((row)=>this.mapDayPlan(row)).filter((plan)=>input.target==='future-incomplete'||selected.has(plan.date));const templateItemIds=new Set(template.items.map((entry)=>entry.id))
    const excludedCompletedDates:string[]=[];const changes:Array<{date:string;before:LifePlanItem[];after:LifePlanItem[]}> = []
    for(const plan of candidates){const linked=plan.items.filter((entry)=>entry.originTemplateItemId&&templateItemIds.has(entry.originTemplateItemId));if(linked.some((entry)=>entry.status==='completed')){excludedCompletedDates.push(plan.date);continue}const base=clone(plan);base.items=base.items.filter((entry)=>entry.originTemplateItemId==null||!templateItemIds.has(entry.originTemplateItemId));const preview=previewTemplateApplication({dayPlan:base,template,resolution:'merge'});const existingIds=new Set(base.items.map((entry)=>entry.id));const after=preview.result.items.map((entry)=>existingIds.has(entry.id)?entry:{...entry,id:`sync-preview:${plan.date}:${entry.originTemplateItemId??entry.id}`});changes.push({date:plan.date,before:clone(plan.items),after})}
    return{writesApplied:false as const,templateVersion:template.entityVersion,dayPlanVersions:Object.fromEntries(changes.map((entry)=>[entry.date,candidates.find((plan)=>plan.date===entry.date)!.entityVersion])),affectedDates:changes.map((entry)=>entry.date),excludedCompletedDates,changes}
  }

  private async buildTemplate(executor:Executor,userId:string,input:CreatePlanTemplateInput,entityVersion:number,current?:PlanTemplate){const mealSlots=this.validateMealSlots(input.mealSlots);const items:TemplatePlanItem[]=[];for(const [index,entry] of input.items.entries()){const built=await this.buildItem(executor,userId,entry,mealSlots,items.map((value)=>({...value,status:'planned',completionId:null,actual:null,originTemplateItemId:value.id,entityVersion:1})));const weekdays=entry.weekdays==null?[]:[...new Set(entry.weekdays)].sort((a,b)=>a-b);if(weekdays.some((value)=>!Number.isInteger(value)||value<0||value>6))throw new LifePlanningDomainError('INVALID_INPUT','Template weekdays must be zero through six.');items.push({id:current?.items[index]?.id??this.createId(),kind:built.kind,title:built.title,mealSlotId:built.mealSlotId,scheduledTime:built.scheduledTime,weekdays,source:built.source,quantity:built.quantity,unit:built.unit,servings:built.servings,durationMinutes:built.durationMinutes})}return{id:current?.id??this.createId(),name:this.text(input.name,'name'),mealSlots,items,entityVersion}}
  private async buildItems(executor:Executor,userId:string,input:PlanItemInput[],mealSlots:MealSlot[]){const result:LifePlanItem[]=[];for(const entry of input)result.push(await this.buildItem(executor,userId,entry,mealSlots,result));return result}
  private async buildItem(executor:Executor,userId:string,input:PlanItemInput,mealSlots:MealSlot[],prior:LifePlanItem[]):Promise<LifePlanItem>{if(!['meal','supplement','medicine','fitness','custom'].includes(input.kind))throw new LifePlanningDomainError('INVALID_INPUT','Unknown plan item kind.');const mealSlotId=input.mealSlotId??null;if(mealSlotId&&!mealSlots.some((slot)=>slot.id===mealSlotId))throw new LifePlanningDomainError('NOT_FOUND','The meal slot does not exist.',404);let scheduledTime=input.scheduledTime??null;if(input.relativeToItemIndex!=null){const meal=prior[input.relativeToItemIndex];if(!meal||meal.kind!=='meal'||!meal.scheduledTime)throw new LifePlanningDomainError('INVALID_RELATIVE_SCHEDULE','A relative supplement must reference an earlier scheduled meal.',409);scheduledTime=scheduleRelativeToMeal(meal.scheduledTime,input.offsetMinutes??0)}else if(scheduledTime!=null)scheduleRelativeToMeal(scheduledTime,0);const source=input.source??null;if(input.kind==='supplement'||input.kind==='medicine'){if(source?.type!=='catalog-item')throw new LifePlanningDomainError('INVALID_SOURCE','Supplement and medicine plans require a catalog item source.',409);const catalog=await this.options.getCatalogItem(userId,source.id);if(!catalog||catalog.kind!==input.kind||catalog.deletedAt!=null||catalog.status!=='active')throw new LifePlanningDomainError('NOT_FOUND',`The ${input.kind} source does not exist.`,404)}if(input.kind==='fitness'){if(source?.type!=='fitness-activity')throw new LifePlanningDomainError('INVALID_SOURCE','Fitness plans require a fitness activity source.',409);const found=await rows<SqlRow>(executor,'SELECT id FROM fitness_activities WHERE user_id=? AND id=? LIMIT 1',[userId,source.id]);if(!found[0])throw new LifePlanningDomainError('NOT_FOUND','The fitness activity does not exist.',404)}if(input.kind==='custom'&&source!=null)throw new LifePlanningDomainError('INVALID_SOURCE','Custom plan items cannot attach an implicit source.',409);if(input.quantity!=null&&(!Number.isFinite(input.quantity)||input.quantity<=0))throw new LifePlanningDomainError('INVALID_INPUT','Plan quantity must be positive.');if(input.servings!=null&&(!Number.isFinite(input.servings)||input.servings<=0))throw new LifePlanningDomainError('INVALID_INPUT','Plan servings must be positive.');if(input.durationMinutes!=null)this.nonNegative(input.durationMinutes,'durationMinutes');return{id:this.createId(),kind:input.kind,title:this.text(input.title,'title'),mealSlotId,scheduledTime,source:clone(source),quantity:input.quantity??null,unit:input.unit?.trim().toLowerCase()||null,servings:input.servings??null,durationMinutes:input.durationMinutes??null,status:'planned',completionId:null,actual:null,originTemplateItemId:null,entityVersion:1}}

  private async completionFacts(connection:PoolConnection,userId:string,item:LifePlanItem,completedAt:string,input:{actualMinutes?:number;overrideEnergyKcal?:number},completionId:string){
    if(item.kind==='fitness'){
      const found=await rows<SqlRow>(connection,'SELECT * FROM fitness_activities WHERE user_id=? AND id=? LIMIT 1',[userId,item.source?.id])
      if(!found[0])throw new LifePlanningDomainError('NOT_FOUND','The fitness activity does not exist.',404)
      const activity=this.mapFitness(found[0]);const result=calculateFitnessActual({kcalPerHour:activity.kcalPerHour,actualMinutes:input.actualMinutes??item.durationMinutes??activity.defaultMinutes,overrideEnergyKcal:input.overrideEnergyKcal})
      return{source:clone(item.source),nutrition:null,costMinor:null,inventoryTransactionIds:[] as string[],preparedFoodEvents:[] as PreparedFoodConsumption[],actualMinutes:result.actualMinutes,estimatedEnergyKcal:result.estimatedEnergyKcal,energyIsEstimate:true}
    }
    if(item.kind==='supplement'||item.kind==='medicine'){
      if(!item.source||item.source.type!=='catalog-item'||item.quantity==null||!item.unit)throw new LifePlanningDomainError('INCOMPLETE_PLAN_ITEM','Inventory-backed completion requires an item, quantity and unit.',409)
      const catalog=await this.options.getCatalogItemFrom(connection,userId,item.source.id);if(!catalog||catalog.kind!==item.kind)throw new LifePlanningDomainError('NOT_FOUND','The inventory-backed source does not exist.',404)
      const facts=await this.catalogFacts(connection,userId,catalog,item.quantity,item.unit,completedAt.slice(0,10));const inventory=await this.consumeInventoryEvent(connection,userId,catalog,item.quantity,item.unit,completedAt,item.id)
      return{source:clone(item.source),...facts,costMinor:inventory.actualCostMinor,inventoryTransactionIds:[inventory.transactionId],preparedFoodEvents:[] as PreparedFoodConsumption[],actualMinutes:null,estimatedEnergyKcal:null,energyIsEstimate:false}
    }
    if(item.kind==='meal'){
      if(!item.source||item.source.type!=='recipe-version'||item.servings==null||item.servings<=0)throw new LifePlanningDomainError('INCOMPLETE_PLAN_ITEM','Meal completion requires a recipe version and positive servings.',409)
      let calculation:Awaited<ReturnType<typeof this.options.calculateStoredRecipe>>
      let recipeVersionId=item.source.versionId??null
      if(recipeVersionId==null){calculation=await this.options.calculateStoredRecipeFrom(connection,userId,item.source.id,{mode:'latest',asOf:completedAt.slice(0,10)});if(!calculation)throw new LifePlanningDomainError('NOT_FOUND','The meal recipe does not exist.',404);recipeVersionId=calculation.recipeVersionId}
      const prepared=await this.consumePreparedFood(connection,userId,item.source.id,recipeVersionId,item.servings)
      if(prepared.remaining>0){calculation??=await this.options.calculateStoredRecipeFrom(connection,userId,item.source.id,{mode:'pinned',versionId:recipeVersionId,asOf:completedAt.slice(0,10)});if(!calculation||calculation.status!=='complete'||!calculation.perServingNutrition||calculation.perServingCostMinor==null||calculation.servings<=0)throw new LifePlanningDomainError('INCOMPLETE_RECIPE','Unprepared meal portions require complete recipe nutrition, price and conversion facts.',409)}
      const inventoryTransactionIds:string[]=[];let uncoveredActualCost=0;let uncoveredCostComplete=true;const factor=prepared.remaining>0?prepared.remaining/calculation!.servings:0
      if(prepared.remaining>0){for(const ingredient of calculation!.ingredients){const catalog=await this.options.getCatalogItemFrom(connection,userId,ingredient.itemId);if(!catalog)throw new LifePlanningDomainError('NOT_FOUND','A recipe ingredient no longer exists.',404);const inventory=await this.consumeInventoryEvent(connection,userId,catalog,round(ingredient.quantity*factor),ingredient.unit,completedAt,item.id);inventoryTransactionIds.push(inventory.transactionId);if(inventory.actualCostMinor==null)uncoveredCostComplete=false;else uncoveredActualCost=round(uncoveredActualCost+inventory.actualCostMinor)}}
      const nutrition=prepared.events.reduce((total,event)=>addFacts(total,flattenNutrition(event.nutrition)),{} as Record<string,number>)
      if(prepared.remaining>0)addFacts(nutrition,Object.fromEntries(Object.entries(flattenNutrition(calculation!.perServingNutrition!)).map(([name,value])=>[name,round(value*prepared.remaining)])))
      const preparedCost=round(prepared.events.reduce((total,event)=>total+event.costMinor,0));const costMinor=prepared.remaining>0&&!uncoveredCostComplete?null:round(preparedCost+uncoveredActualCost)
      return{source:{type:'recipe-version' as const,id:item.source.id,versionId:recipeVersionId},nutrition,costMinor,inventoryTransactionIds,preparedFoodEvents:prepared.events,actualMinutes:null,estimatedEnergyKcal:null,energyIsEstimate:false}
    }
    return{source:clone(item.source),nutrition:null,costMinor:null,inventoryTransactionIds:[] as string[],preparedFoodEvents:[] as PreparedFoodConsumption[],actualMinutes:null,estimatedEnergyKcal:null,energyIsEstimate:false}
  }

  private async consumePreparedFood(connection:PoolConnection,userId:string,recipeId:string,recipeVersionId:string,requestedPortions:number){
    const found=await rows<SqlRow>(connection,`SELECT * FROM life_prepared_food_stock WHERE user_id=? AND recipe_id=? AND recipe_version_id=? AND portions_remaining>0 ORDER BY created_at,id FOR UPDATE`,[userId,recipeId,recipeVersionId])
    let remaining=requestedPortions;const events:PreparedFoodConsumption[]=[]
    for(const row of found){if(remaining<=0)break;const current=Number(row.portions_remaining);const portions=Math.min(remaining,current);const factor=portions/current;const currentNutrition=parse<NutritionValues>(row.nutrition_remaining);const nutrition=scaleNutrition(currentNutrition,factor);const cookingOilGrams=round(Number(row.cooking_oil_grams_remaining)*factor);const costMinor=round(Number(row.cost_remaining_minor)*factor);const nextNutrition=scaleNutrition(currentNutrition,1-factor)
      await connection.execute(`UPDATE life_prepared_food_stock SET portions_remaining=?,nutrition_remaining=?,cooking_oil_grams_remaining=?,cost_remaining_minor=? WHERE user_id=? AND id=?`,[round(current-portions),JSON.stringify(nextNutrition),round(Number(row.cooking_oil_grams_remaining)-cookingOilGrams),round(Number(row.cost_remaining_minor)-costMinor),userId,row.id])
      events.push({id:this.createId(),stockId:String(row.id),portions,nutrition,cookingOilGrams,costMinor});remaining=round(remaining-portions)}
    return{events,remaining}
  }

  private async restorePreparedFood(connection:PoolConnection,userId:string,event:SqlRow){
    const stockRows=await rows<SqlRow>(connection,'SELECT * FROM life_prepared_food_stock WHERE user_id=? AND id=? LIMIT 1 FOR UPDATE',[userId,event.prepared_food_stock_id]);const stock=stockRows[0]
    if(!stock)throw new LifePlanningDomainError('PREPARED_FOOD_NOT_FOUND','The prepared-food stock no longer exists.',409)
    const portions=round(Number(stock.portions_remaining)+Number(event.portions));if(portions>Number(stock.portions_created))throw new LifePlanningDomainError('PREPARED_FOOD_RESTORE_CONFLICT','Prepared-food stock would exceed its original portions.',409)
    const nutrition=addFacts(flattenNutrition(parse<NutritionValues>(stock.nutrition_remaining)),flattenNutrition(parse<NutritionValues>(event.nutrition_json)))
    await connection.execute(`UPDATE life_prepared_food_stock SET portions_remaining=?,nutrition_remaining=?,cooking_oil_grams_remaining=cooking_oil_grams_remaining+?,cost_remaining_minor=cost_remaining_minor+? WHERE user_id=? AND id=?`,[portions,JSON.stringify({energyKcal:nutrition.energyKcal??0,proteinGrams:nutrition.proteinGrams??0,fatGrams:nutrition.fatGrams??0,carbohydrateGrams:nutrition.carbohydrateGrams??0,...(Object.keys(nutrition).some((name)=>!['energyKcal','proteinGrams','fatGrams','carbohydrateGrams'].includes(name))?{custom:Object.fromEntries(Object.entries(nutrition).filter(([name])=>!['energyKcal','proteinGrams','fatGrams','carbohydrateGrams'].includes(name)))}:{})}),Number(event.cooking_oil_grams),Number(event.cost_minor),userId,stock.id])
  }
  private async consumeInventoryEvent(connection:PoolConnection,userId:string,item:CatalogItem,quantity:number,unit:string,occurredAt:string,itemId:string){const units=await this.options.listUnitsFrom(connection,userId);const converted=convertUnit({itemId:item.id,quantity,fromUnit:unit,toBaseUnit:item.baseUnit,itemConversions:item.itemConversions,units:units.map((value)=>({code:value.code,dimension:value.dimension,baseCode:value.baseCode,toBaseFactor:value.toBaseFactor}))});if(converted.status==='incomplete')throw new LifePlanningDomainError('INCOMPLETE_CONVERSION','The completion quantity cannot be converted to inventory units.',409);const batchRows=await rows<SqlRow>(connection,`SELECT * FROM life_inventory_batches WHERE user_id=? AND item_id=? AND remaining_quantity>0 AND (expires_on IS NULL OR expires_on>=?) ORDER BY expires_on IS NULL,expires_on,purchased_on,id FOR UPDATE`,[userId,item.id,occurredAt.slice(0,10)]);const batches:InventoryBatch[]=batchRows.map((row)=>({id:String(row.id),itemId:String(row.item_id),baseUnit:String(row.base_unit),originalQuantity:Number(row.original_quantity),remainingQuantity:Number(row.remaining_quantity),purchasedOn:row.purchased_on==null?null:String(row.purchased_on).slice(0,10),expiresOn:row.expires_on==null?null:String(row.expires_on).slice(0,10),locationId:row.location_id==null?null:String(row.location_id),actualUnitCostMinor:row.actual_unit_cost_minor==null?null:Number(row.actual_unit_cost_minor),createdAt:iso(row.created_at)}));const allocation=allocateEarliestExpiry(batches,converted.baseQuantity,occurredAt.slice(0,10));for(const value of allocation.allocations)await connection.execute('UPDATE life_inventory_batches SET remaining_quantity=remaining_quantity-?,version=version+1 WHERE user_id=? AND id=?',[value.quantity,userId,value.batchId]);const transactionId=this.createId();const balance=await rows<SqlRow>(connection,'SELECT COALESCE(SUM(delta_base_quantity),0) total FROM life_inventory_transactions WHERE user_id=? AND item_id=?',[userId,item.id]);const warning=Number(balance[0]?.total??0)-converted.baseQuantity<0?'negative_inventory':null;await connection.execute(`INSERT INTO life_inventory_transactions
    (id,user_id,item_id,transaction_kind,quantity,unit,base_quantity,delta_base_quantity,batch_id,occurred_at,reverses_transaction_id,warning,note,created_at)
    VALUES (?,?,?,'consume',?,?,?, ?,NULL,?,NULL,?,?,?)`,[transactionId,userId,item.id,quantity,unit,converted.baseQuantity,-converted.baseQuantity,sqlDate(occurredAt),warning,`Planning completion ${itemId}`,sqlDate(this.now())]);for(const [position,value] of allocation.allocations.entries())await connection.execute('INSERT INTO life_inventory_allocations (user_id,transaction_id,batch_id,quantity,position,created_at) VALUES (?,?,?,?,?,?)',[userId,transactionId,value.batchId,value.quantity,position,sqlDate(this.now())]);let actualCostMinor:number|null=null;if(allocation.unallocated===0){let total=0;let complete=true;for(const value of allocation.allocations){const batch=batches.find((entry)=>entry.id===value.batchId);if(batch?.actualUnitCostMinor==null){complete=false;break}total=round(total+value.quantity*batch.actualUnitCostMinor)}if(complete)actualCostMinor=total}return{transactionId,actualCostMinor}}
  private async reverseInventoryEvent(connection:PoolConnection,userId:string,transactionId:string,completionId:string){const found=await rows<SqlRow>(connection,'SELECT * FROM life_inventory_transactions WHERE user_id=? AND id=? LIMIT 1 FOR UPDATE',[userId,transactionId]);const original=found[0];if(!original)throw new LifePlanningDomainError('INVENTORY_TRANSACTION_NOT_FOUND','A completion inventory event no longer exists.',409);const existing=await rows<SqlRow>(connection,'SELECT id FROM life_inventory_transactions WHERE user_id=? AND reverses_transaction_id=? LIMIT 1 FOR UPDATE',[userId,transactionId]);if(existing[0])throw new LifePlanningDomainError('COMPLETION_ALREADY_UNDONE','A completion inventory event is already reversed.',409);const allocationRows=await rows<SqlRow>(connection,'SELECT batch_id,quantity FROM life_inventory_allocations WHERE user_id=? AND transaction_id=? ORDER BY position FOR UPDATE',[userId,transactionId]);for(const value of allocationRows)await connection.execute('UPDATE life_inventory_batches SET remaining_quantity=remaining_quantity+?,version=version+1 WHERE user_id=? AND id=?',[value.quantity,userId,value.batch_id]);const reversalId=this.createId();const delta=-Number(original.delta_base_quantity);const balance=await rows<SqlRow>(connection,'SELECT COALESCE(SUM(delta_base_quantity),0) total FROM life_inventory_transactions WHERE user_id=? AND item_id=?',[userId,original.item_id]);const warning=Number(balance[0]?.total??0)+delta<0?'negative_inventory':null;await connection.execute(`INSERT INTO life_inventory_transactions
    (id,user_id,item_id,transaction_kind,quantity,unit,base_quantity,delta_base_quantity,batch_id,occurred_at,reverses_transaction_id,warning,note,created_at)
    VALUES (?,?,?,'reversal',?,?,?, ?,NULL,?,?,?, ?,?)`,[reversalId,userId,original.item_id,Number(original.base_quantity),String(original.unit),Number(original.base_quantity),delta,sqlDate(this.now()),transactionId,warning,`Undo planning completion ${completionId}`,sqlDate(this.now())]);for(const [position,value] of allocationRows.entries())await connection.execute('INSERT INTO life_inventory_allocations (user_id,transaction_id,batch_id,quantity,position,created_at) VALUES (?,?,?,?,?,?)',[userId,reversalId,value.batch_id,value.quantity,position,sqlDate(this.now())]);return reversalId}
  private async catalogFacts(executor:Executor,userId:string,item:CatalogItem,quantity:number,unit:string,asOf:string){const units=await this.options.listUnitsFrom(executor,userId);const definitions=units.map((value)=>({code:value.code,dimension:value.dimension,baseCode:value.baseCode,toBaseFactor:value.toBaseFactor}));let nutrition:Record<string,number>|null=null;if(item.nutrition){const converted=convertUnit({itemId:item.id,quantity,fromUnit:unit,toBaseUnit:item.nutrition.basisUnit,itemConversions:item.itemConversions,units:definitions});if(converted.status==='complete'){const factor=converted.baseQuantity/item.nutrition.basisQuantity;const values=item.nutrition.values;nutrition={energyKcal:round(values.energyKcal*factor),proteinGrams:round(values.proteinGrams*factor),fatGrams:round(values.fatGrams*factor),carbohydrateGrams:round(values.carbohydrateGrams*factor),...Object.fromEntries(Object.entries(values.custom??{}).map(([name,value])=>[name,round(value*factor)]))}}}let costMinor:number|null=null;const price=selectEffectivePrice(item.pricePoints,asOf);if(price){const converted=convertUnit({itemId:item.id,quantity,fromUnit:unit,toBaseUnit:price.purchaseUnit,itemConversions:item.itemConversions,units:definitions});if(converted.status==='complete')costMinor=round(price.amountMinor*converted.baseQuantity/price.purchaseQuantity)}return{nutrition,costMinor}}

  private mapTemplate(row:SqlRow):PlanTemplate{return{id:String(row.id),name:String(row.name),mealSlots:parse(row.meal_slots_json),items:parse(row.items_json),entityVersion:Number(row.entity_version)}}
  private mapDayPlan(row:SqlRow):DayPlan{return{id:String(row.id),date:String(row.plan_date).slice(0,10),mealSlots:parse(row.meal_slots_json),items:parse(row.items_json),entityVersion:Number(row.entity_version)}}
  private async hydrateDayPlan(executor:Executor,userId:string,source:DayPlan){
    const plan=clone(source)
    const completions=await rows<SqlRow>(executor,`SELECT c.* FROM life_completion_snapshots c
      LEFT JOIN life_completion_reversals r ON r.user_id=c.user_id AND r.completion_id=c.id
      WHERE c.user_id=? AND c.day_plan_id=? AND r.id IS NULL ORDER BY c.completed_at,c.id`,[userId,plan.id])
    if(!completions.length)return plan
    const completionIds=completions.map((entry)=>String(entry.id))
    const links=await rows<SqlRow>(executor,`SELECT completion_id,transaction_id FROM life_completion_inventory_events
      WHERE user_id=? AND completion_id IN (${completionIds.map(()=>'?').join(',')}) ORDER BY completion_id,position`,[userId,...completionIds])
    const preparedLinks=await rows<SqlRow>(executor,`SELECT completion_id,id FROM life_completion_prepared_food_events
      WHERE user_id=? AND completion_id IN (${completionIds.map(()=>'?').join(',')}) ORDER BY completion_id,position`,[userId,...completionIds])
    const transactions=new Map<string,string[]>()
    for(const link of links){const id=String(link.completion_id);const values=transactions.get(id)??[];values.push(String(link.transaction_id));transactions.set(id,values)}
    const preparedEvents=new Map<string,string[]>()
    for(const link of preparedLinks){const id=String(link.completion_id);const values=preparedEvents.get(id)??[];values.push(String(link.id));preparedEvents.set(id,values)}
    for(const completion of completions){
      const item=plan.items.find((entry)=>entry.id===String(completion.day_plan_item_id));if(!item)continue
      item.status='completed';item.completionId=String(completion.id);item.actual={
        source:completion.source_json==null?null:parse(completion.source_json),
        quantity:completion.actual_quantity==null?null:Number(completion.actual_quantity),
        unit:completion.actual_unit==null?null:String(completion.actual_unit),
        servings:completion.actual_servings==null?null:Number(completion.actual_servings),
        completedAt:this.validTimestamp(iso(completion.completed_at),'completedAt'),nutrition:completion.nutrition_json==null?null:parse(completion.nutrition_json),
        costMinor:completion.cost_minor==null?null:Number(completion.cost_minor),inventoryTransactionIds:transactions.get(String(completion.id))??[],
        preparedFoodEventIds:preparedEvents.get(String(completion.id))??[],
        actualMinutes:completion.actual_minutes==null?null:Number(completion.actual_minutes),
        estimatedEnergyKcal:completion.estimated_energy_kcal==null?null:Number(completion.estimated_energy_kcal),
        energyIsEstimate:Boolean(completion.energy_is_estimate),
      }
    }
    return plan
  }
  private mapFitness(row:SqlRow):FitnessActivity{return{id:String(row.id),name:String(row.name),defaultMinutes:Number(row.default_minutes),kcalPerHour:Number(row.kcal_per_hour),intensity:String(row.intensity),steps:parse(row.steps_json),equipment:parse(row.equipment_json),entityVersion:Number(row.entity_version),createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)}}
  private mapMedicineRecurrenceRule(row:SqlRow):MedicineRecurrenceRule{return{id:String(row.id),title:String(row.title),sourceId:String(row.source_item_id),quantity:Number(row.quantity),unit:String(row.unit),recurrence:parse(row.recurrence_json),entityVersion:Number(row.entity_version),createdAt:iso(row.created_at),updatedAt:iso(row.updated_at),deletedAt:row.deleted_at==null?null:iso(row.deleted_at)}}
  private mapMedicineOccurrence(row:SqlRow):MedicineRecurrenceOccurrence{return{
    id:String(row.id),ruleId:String(row.rule_id),entityVersion:Number(row.entity_version),kind:'medicine',title:String(row.title),
    source:{type:'catalog-item',id:String(row.source_item_id)},quantity:Number(row.quantity),unit:String(row.unit),
    originalDate:String(row.original_date).slice(0,10),originalTime:String(row.original_time).slice(0,5),
    scheduledDate:String(row.scheduled_date).slice(0,10),scheduledTime:String(row.scheduled_time).slice(0,5),
    status:row.status as MedicineRecurrenceOccurrence['status'],completionId:row.completion_id==null?null:String(row.completion_id),
    createdAt:iso(row.created_at),updatedAt:iso(row.updated_at),
  }}
  private buildMedicineOccurrences(rule:MedicineRecurrenceRule,timestamp:string):MedicineRecurrenceOccurrence[]{return expandMedicineRecurrence(rule.recurrence).map(({date,time})=>({
    id:this.createId(),ruleId:rule.id,entityVersion:1,kind:'medicine',title:rule.title,
    source:{type:'catalog-item',id:rule.sourceId},quantity:rule.quantity,unit:rule.unit,
    originalDate:date,originalTime:time,scheduledDate:date,scheduledTime:time,status:'planned',completionId:null,
    createdAt:timestamp,updatedAt:timestamp,
  }))}
  private async insertMedicineOccurrences(connection:PoolConnection,userId:string,occurrences:MedicineRecurrenceOccurrence[]){
    const chunkSize=500
    for(let offset=0;offset<occurrences.length;offset+=chunkSize){
      const chunk=occurrences.slice(offset,offset+chunkSize)
      const placeholders=chunk.map(()=>'(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',')
      const values=chunk.flatMap((entry)=>[
        entry.id,userId,entry.ruleId,entry.title,entry.source.id,entry.quantity,entry.unit,
        entry.originalDate,entry.originalTime,entry.scheduledDate,entry.scheduledTime,entry.status,entry.completionId,
        entry.entityVersion,sqlDate(entry.createdAt),sqlDate(entry.updatedAt),
      ])
      await connection.execute(`INSERT INTO life_medicine_recurrence_occurrences
        (id,user_id,rule_id,title,source_item_id,quantity,unit,original_date,original_time,scheduled_date,scheduled_time,status,completion_id,entity_version,created_at,updated_at)
        VALUES ${placeholders}`,values)
    }
  }
  private async reconcileMedicineOccurrences(
    connection:PoolConnection,userId:string,existing:MedicineRecurrenceOccurrence[],next:MedicineRecurrenceRule,
  ){
    const desired=new Map(expandMedicineRecurrence(next.recurrence).map(({date,time})=>[`${date}\0${time}`,{date,time}]))
    const existingIdentities=new Set(existing.map((entry)=>`${entry.originalDate}\0${entry.originalTime}`))
    for(const occurrence of existing){
      if(occurrence.status!=='planned'||!this.isFutureOccurrence(occurrence,next.updatedAt))continue
      const identity=`${occurrence.originalDate}\0${occurrence.originalTime}`
      if(!desired.has(identity)){
        await connection.execute(`UPDATE life_medicine_recurrence_occurrences
          SET status='cancelled',completion_id=NULL,entity_version=entity_version+1,updated_at=GREATEST(updated_at,?) WHERE user_id=? AND id=?`,
        [sqlDate(next.updatedAt),userId,occurrence.id])
        continue
      }
      if(occurrence.title===next.title&&occurrence.source.id===next.sourceId
        &&occurrence.quantity===next.quantity&&occurrence.unit===next.unit)continue
      await connection.execute(`UPDATE life_medicine_recurrence_occurrences
        SET title=?,source_item_id=?,quantity=?,unit=?,entity_version=entity_version+1,updated_at=GREATEST(updated_at,?) WHERE user_id=? AND id=?`,[
        next.title,next.sourceId,next.quantity,next.unit,sqlDate(next.updatedAt),userId,occurrence.id,
      ])
    }
    const additions:MedicineRecurrenceOccurrence[]=[]
    for(const [identity,value] of desired){
      if(existingIdentities.has(identity)||Date.parse(`${value.date}T${value.time}:00.000Z`)<=Date.parse(next.updatedAt))continue
      additions.push({
        id:this.createId(),ruleId:next.id,entityVersion:1,kind:'medicine',title:next.title,
        source:{type:'catalog-item',id:next.sourceId},quantity:next.quantity,unit:next.unit,
        originalDate:value.date,originalTime:value.time,scheduledDate:value.date,scheduledTime:value.time,
        status:'planned',completionId:null,createdAt:next.updatedAt,updatedAt:next.updatedAt,
      })
    }
    await this.insertMedicineOccurrences(connection,userId,additions)
  }
  private isFutureOccurrence(occurrence:MedicineRecurrenceOccurrence,timestamp:string){return Date.parse(`${occurrence.scheduledDate}T${occurrence.scheduledTime}:00.000Z`)>Date.parse(timestamp)}
  private maxTimestamp(left:string,right:string){return Date.parse(left)>=Date.parse(right)?left:right}
  private async buildMedicineRecurrenceRule(
    executor:Executor,userId:string,input:CreateMedicineRecurrenceRuleInput,
    identity:Pick<MedicineRecurrenceRule,'id'|'entityVersion'|'createdAt'|'updatedAt'|'deletedAt'>,
  ):Promise<MedicineRecurrenceRule>{
    const found=await rows<SqlRow>(executor,`SELECT id,base_unit,available_units FROM life_items
      WHERE user_id=? AND id=? AND item_kind='medicine' AND status='active' AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,[userId,input.sourceId])
    if(!found[0])throw new LifePlanningDomainError('NOT_FOUND','The medicine fact does not exist.',404)
    if(!Number.isFinite(input.quantity)||input.quantity<=0)throw new LifePlanningDomainError('INVALID_INPUT','Medicine recurrence quantity must be positive.')
    const unit=this.text(input.unit,'unit').toLocaleLowerCase()
    const available=new Set([String(found[0].base_unit),...parse<string[]>(found[0].available_units)].map((value)=>value.toLocaleLowerCase()))
    if(!available.has(unit))throw new LifePlanningDomainError('INVALID_UNIT','The medicine recurrence unit is not available for this catalog item.',409)
    return{...identity,title:this.text(input.title,'title'),sourceId:String(found[0].id),quantity:input.quantity,unit,recurrence:normalizeMedicineRecurrence(input.recurrence)}
  }
  private async persistDayPlan(executor:Executor,userId:string,plan:DayPlan){await executor.execute('UPDATE life_day_plans SET meal_slots_json=?,items_json=?,entity_version=?,updated_at=? WHERE user_id=? AND id=?',[JSON.stringify(plan.mealSlots),JSON.stringify(plan.items),plan.entityVersion,sqlDate(this.now()),userId,plan.id])}
  private validateMealSlots(input:MealSlot[]){const ids=new Set<string>();const positions=new Set<number>();return clone(input).map((slot)=>{const id=this.text(slot.id,'meal slot id'),name=this.text(slot.name,'meal slot name');if(ids.has(id)||positions.has(slot.position)||!Number.isInteger(slot.position)||slot.position<0)throw new LifePlanningDomainError('INVALID_MEAL_SLOTS','Meal slot IDs and positions must be unique non-negative values.',409);ids.add(id);positions.add(slot.position);return{id,name,position:slot.position,hidden:Boolean(slot.hidden)}}).sort((a,b)=>a.position-b.position||a.id.localeCompare(b.id))}
  private text(value:string,field:string){const result=value?.trim();if(!result)throw new LifePlanningDomainError('INVALID_INPUT',`${field} is required.`);return result}
  private nonNegative(value:number,field:string){if(!Number.isFinite(value)||value<0)throw new LifePlanningDomainError('INVALID_INPUT',`${field} must be non-negative.`);return value}
  private validDate(value:string,field:string){const parsed=new Date(`${value}T00:00:00.000Z`);if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)throw new LifePlanningDomainError('INVALID_DATE',`${field} must be a real date-only value.`);return value}
  private validTime(value:string,field:string){if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))throw new LifePlanningDomainError('INVALID_TIME',`${field} must use HH:mm.`);return value}
  private validTimestamp(value:string,field:string){const parsed=new Date(value);if(Number.isNaN(parsed.getTime()))throw new LifePlanningDomainError('INVALID_DATE',`${field} must be a valid timestamp.`);return parsed.toISOString()}
  private async idempotently<T>(userId:string,operation:string,rawKey:string,input:unknown,create:(connection:PoolConnection)=>Promise<T>):Promise<T>{const key=rawKey.trim();if(!key||key.length>190)throw new LifePlanningDomainError('INVALID_IDEMPOTENCY_KEY','A valid idempotency key is required.');const hash=requestHash(input),connection=await this.pool.getConnection();try{if(operation==='planning:create-completion'){await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT')}else await connection.beginTransaction();await connection.execute('INSERT IGNORE INTO life_planning_idempotency (user_id,operation_key,idempotency_key,request_hash,response_json,created_at) VALUES (?,?,?,?,NULL,?)',[userId,operation,key,hash,sqlDate(this.now())]);const found=(await rows<SqlRow>(connection,'SELECT * FROM life_planning_idempotency WHERE user_id=? AND operation_key=? AND idempotency_key=? FOR UPDATE',[userId,operation,key]))[0];if(String(found.request_hash)!==hash)throw new LifePlanningDomainError('IDEMPOTENCY_CONFLICT','The idempotency key belongs to another planning request.',409);if(found.response_json!=null){const response=parse<T>(found.response_json);await connection.commit();return response}const result=await create(connection);await connection.execute('UPDATE life_planning_idempotency SET response_json=? WHERE user_id=? AND operation_key=? AND idempotency_key=?',[JSON.stringify(result),userId,operation,key]);await connection.commit();return clone(result)}catch(error){await connection.rollback();throw error}finally{connection.release()}}
}
