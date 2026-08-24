import { convertUnit, selectEffectivePrice, type CatalogItem, type LifeUnit, type NutritionValues } from '../domain/life/catalog.js'
import type { InventoryForecast } from '../domain/life/inventory.js'
import {
  calculateFitnessActual,
  type DayPlan,
  type DayPlanItemProjection,
  type DayPlanProjection,
  type FitnessActivity,
  type LifePlanItem,
  type PlanningInventoryProjection,
} from '../domain/life/planning.js'
import type { PreparedFoodStock, RecipeCalculation } from '../domain/life/recipes.js'

type StoredRecipeCalculation = RecipeCalculation & { recipeVersionId: string; recipeVersionNumber: number }

export interface PlanningProjectionDependencies {
  getCatalogItem(userId: string, itemId: string): Promise<CatalogItem | undefined>
  listUnits(userId: string): Promise<LifeUnit[]>
  listInventoryForecasts(userId: string): Promise<InventoryForecast[]>
  calculateStoredRecipe(
    userId: string,
    recipeId: string,
    input: { mode: 'latest' | 'pinned'; versionId?: string; asOf: string },
  ): Promise<StoredRecipeCalculation | undefined>
  listPreparedFood(userId: string): Promise<PreparedFoodStock[]>
  getFitnessActivity(userId: string, id: string): Promise<FitnessActivity | undefined>
}

interface PreparedState {
  stock: PreparedFoodStock
  portions: number
  nutrition: Record<string, number>
  costMinor: number
}

const round = (value: number) => Math.round((value + Number.EPSILON) * 1_000_000_000) / 1_000_000_000

function add(target: Record<string, number>, values: Record<string, number>) {
  for (const [name, value] of Object.entries(values)) target[name] = round((target[name] ?? 0) + value)
  return target
}

function scale(values: Record<string, number>, factor: number) {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, round(value * factor)]))
}

function flattenNutrition(values: NutritionValues, factor = 1) {
  return scale({
    energyKcal: values.energyKcal,
    proteinGrams: values.proteinGrams,
    fatGrams: values.fatGrams,
    carbohydrateGrams: values.carbohydrateGrams,
    ...values.custom,
  }, factor)
}

function catalogFacts(item: CatalogItem, quantity: number, unit: string, units: LifeUnit[], asOf: string) {
  const definitions = units.map((value) => ({
    code: value.code,
    dimension: value.dimension,
    baseCode: value.baseCode,
    toBaseFactor: value.toBaseFactor,
  }))
  let nutrition: Record<string, number> | null = null
  if (item.nutrition) {
    const converted = convertUnit({
      itemId: item.id,
      quantity,
      fromUnit: unit,
      toBaseUnit: item.nutrition.basisUnit,
      itemConversions: item.itemConversions,
      units: definitions,
    })
    if (converted.status === 'complete') {
      nutrition = flattenNutrition(item.nutrition.values, converted.baseQuantity / item.nutrition.basisQuantity)
    }
  }
  let costMinor: number | null = null
  const price = selectEffectivePrice(item.pricePoints, asOf)
  if (price) {
    const converted = convertUnit({
      itemId: item.id,
      quantity,
      fromUnit: unit,
      toBaseUnit: price.purchaseUnit,
      itemConversions: item.itemConversions,
      units: definitions,
    })
    if (converted.status === 'complete') {
      costMinor = round(price.amountMinor * converted.baseQuantity / price.purchaseQuantity)
    }
  }
  return { nutrition, costMinor }
}

function catalogDemand(
  item: CatalogItem,
  quantity: number,
  unit: string,
  units: LifeUnit[],
  forecasts: Map<string, InventoryForecast>,
): PlanningInventoryProjection {
  const converted = convertUnit({
    itemId: item.id,
    quantity,
    fromUnit: unit,
    toBaseUnit: item.baseUnit,
    itemConversions: item.itemConversions,
    units: units.map((value) => ({
      code: value.code,
      dimension: value.dimension,
      baseCode: value.baseCode,
      toBaseFactor: value.toBaseFactor,
    })),
  })
  const forecast = forecasts.get(item.id)
  if (converted.status === 'incomplete' || forecast?.status === 'incomplete') {
    return {
      status: 'incomplete', itemId: item.id, baseUnit: item.baseUnit,
      onHand: forecast?.onHand ?? 0, plannedDemand: null, projectedBalance: null, shortage: null,
      reason: 'missing_conversion',
    }
  }
  const onHand = forecast?.onHand ?? 0
  return {
    status: 'complete', itemId: item.id, baseUnit: item.baseUnit, onHand,
    plannedDemand: converted.baseQuantity,
    projectedBalance: round(onHand - converted.baseQuantity),
    shortage: round(Math.max(0, converted.baseQuantity - onHand)),
  }
}

function directDemand(
  item: CatalogItem | undefined,
  baseQuantity: number | null,
  forecasts: Map<string, InventoryForecast>,
  itemId: string,
): PlanningInventoryProjection {
  const forecast = forecasts.get(itemId)
  if (!item || baseQuantity == null || forecast?.status === 'incomplete') {
    return {
      status: 'incomplete', itemId, baseUnit: item?.baseUnit ?? forecast?.baseUnit ?? null,
      onHand: forecast?.onHand ?? null, plannedDemand: null, projectedBalance: null, shortage: null,
      reason: 'missing_conversion',
    }
  }
  const onHand = forecast?.onHand ?? 0
  return {
    status: 'complete', itemId, baseUnit: item.baseUnit, onHand,
    plannedDemand: round(baseQuantity), projectedBalance: round(onHand - baseQuantity),
    shortage: round(Math.max(0, baseQuantity - onHand)),
  }
}

function aggregateInventory(values: PlanningInventoryProjection[]) {
  const grouped = new Map<string, PlanningInventoryProjection[]>()
  for (const value of values) grouped.set(value.itemId, [...(grouped.get(value.itemId) ?? []), value])
  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([itemId, entries]) => {
    const incomplete = entries.find((entry) => entry.status === 'incomplete')
    if (incomplete) return incomplete
    const complete = entries as Array<Extract<PlanningInventoryProjection, { status: 'complete' }>>
    const plannedDemand = round(complete.reduce((total, entry) => total + entry.plannedDemand, 0))
    const onHand = complete[0]?.onHand ?? 0
    return {
      status: 'complete' as const,
      itemId,
      baseUnit: complete[0]?.baseUnit ?? '',
      onHand,
      plannedDemand,
      projectedBalance: round(onHand - plannedDemand),
      shortage: round(Math.max(0, plannedDemand - onHand)),
    }
  })
}

function allocatePrepared(
  states: PreparedState[],
  recipeId: string,
  recipeVersionId: string,
  requestedPortions: number,
) {
  const matching = states.filter((entry) => (
    entry.stock.recipeId === recipeId
    && entry.stock.recipeVersionId === recipeVersionId
    && entry.portions > 0
  ))
  const portionsAvailable = round(matching.reduce((total, entry) => total + entry.portions, 0))
  let remaining = requestedPortions
  let costMinor = 0
  const nutrition: Record<string, number> = {}
  const stockIds: string[] = []
  for (const state of matching) {
    if (remaining <= 0) break
    const take = Math.min(remaining, state.portions)
    const factor = take / state.portions
    add(nutrition, scale(state.nutrition, factor))
    const takenCost = round(state.costMinor * factor)
    costMinor = round(costMinor + takenCost)
    state.portions = round(state.portions - take)
    state.nutrition = scale(state.nutrition, 1 - factor)
    state.costMinor = round(state.costMinor - takenCost)
    remaining = round(remaining - take)
    stockIds.push(state.stock.id)
  }
  const portionsAllocated = round(requestedPortions - remaining)
  return {
    remaining,
    nutrition,
    costMinor,
    preparedFood: portionsAvailable > 0 ? {
      stockIds,
      portionsAvailable,
      portionsAllocated,
      portionsRemainingAfterPlan: round(portionsAvailable - portionsAllocated),
    } : null,
  }
}

function actualProjection(item: LifePlanItem): DayPlanItemProjection {
  const actual = item.actual
  const notApplicable = item.kind === 'custom' || item.status === 'skipped'
  return {
    dayPlanItemId: item.id,
    kind: item.kind,
    mode: 'actual',
    status: notApplicable ? 'not-applicable' : actual ? 'complete' : 'incomplete',
    source: actual?.source ?? item.source,
    nutrition: actual?.nutrition ?? null,
    costMinor: actual?.costMinor ?? null,
    estimatedEnergyKcal: actual?.estimatedEnergyKcal ?? null,
    inventory: [],
    preparedFood: null,
    missing: !notApplicable && !actual ? ['completion_snapshot'] : [],
  }
}

async function buildOnePlanningProjection(
  userId: string,
  plan: DayPlan,
  dependencies: PlanningProjectionDependencies,
  units: LifeUnit[],
  inventoryForecasts: InventoryForecast[],
  preparedStates: PreparedState[],
): Promise<DayPlanProjection> {
  const forecasts = new Map(inventoryForecasts.map((entry) => [entry.itemId, entry]))
  const items: DayPlanItemProjection[] = []
  const nutritionExpected = new Set<string>()
  const costExpected = new Set<string>()

  for (const item of plan.items) {
    if (item.status === 'completed' || item.status === 'skipped') {
      items.push(actualProjection(item))
      continue
    }
    if (item.kind === 'custom') {
      items.push({
        dayPlanItemId: item.id, kind: item.kind, mode: 'planned', status: 'not-applicable', source: null,
        nutrition: null, costMinor: null, estimatedEnergyKcal: null, inventory: [], preparedFood: null, missing: [],
      })
      continue
    }
    if (item.kind === 'fitness') {
      const activity = item.source?.type === 'fitness-activity'
        ? await dependencies.getFitnessActivity(userId, item.source.id)
        : undefined
      if (!activity) {
        items.push({
          dayPlanItemId: item.id, kind: item.kind, mode: 'planned', status: 'incomplete', source: item.source,
          nutrition: null, costMinor: null, estimatedEnergyKcal: null, inventory: [], preparedFood: null,
          missing: ['fitness_activity'],
        })
      } else {
        const estimate = calculateFitnessActual({
          kcalPerHour: activity.kcalPerHour,
          actualMinutes: item.durationMinutes ?? activity.defaultMinutes,
        })
        items.push({
          dayPlanItemId: item.id, kind: item.kind, mode: 'planned', status: 'complete', source: item.source,
          nutrition: null, costMinor: null, estimatedEnergyKcal: estimate.estimatedEnergyKcal,
          inventory: [], preparedFood: null, missing: [],
        })
      }
      continue
    }
    if (item.kind === 'supplement' || item.kind === 'medicine') {
      costExpected.add(item.id)
      const catalog = item.source?.type === 'catalog-item'
        ? await dependencies.getCatalogItem(userId, item.source.id)
        : undefined
      if (!catalog || item.quantity == null || !item.unit) {
        items.push({
          dayPlanItemId: item.id, kind: item.kind, mode: 'planned', status: 'incomplete', source: item.source,
          nutrition: null, costMinor: null, estimatedEnergyKcal: null, inventory: [], preparedFood: null,
          missing: ['catalog_item_or_quantity'],
        })
        continue
      }
      if (catalog.nutrition) nutritionExpected.add(item.id)
      const facts = catalogFacts(catalog, item.quantity, item.unit, units, plan.date)
      const demand = catalogDemand(catalog, item.quantity, item.unit, units, forecasts)
      const missing = [
        ...(catalog.nutrition && facts.nutrition == null ? ['nutrition'] : []),
        ...(facts.costMinor == null ? ['price'] : []),
        ...(demand.status === 'incomplete' ? ['inventory_conversion'] : []),
      ]
      items.push({
        dayPlanItemId: item.id, kind: item.kind, mode: 'planned',
        status: missing.length ? 'incomplete' : 'complete', source: item.source,
        nutrition: facts.nutrition, costMinor: facts.costMinor, estimatedEnergyKcal: null,
        inventory: [demand], preparedFood: null, missing,
      })
      continue
    }

    nutritionExpected.add(item.id)
    costExpected.add(item.id)
    const source = item.source?.type === 'recipe-version' ? item.source : undefined
    const calculation = source ? await dependencies.calculateStoredRecipe(userId, source.id, {
      mode: source.versionId ? 'pinned' : 'latest',
      ...(source.versionId ? { versionId: source.versionId } : {}),
      asOf: plan.date,
    }) : undefined
    const desiredServings = item.servings ?? calculation?.servings ?? 1
    const recipeVersionId = source?.versionId ?? calculation?.recipeVersionId
    const prepared = source && recipeVersionId
      ? allocatePrepared(preparedStates, source.id, recipeVersionId, desiredServings)
      : { remaining: desiredServings, nutrition: {}, costMinor: 0, preparedFood: null }
    let nutrition: Record<string, number> | null = Object.keys(prepared.nutrition).length ? prepared.nutrition : null
    let costMinor: number | null = prepared.preparedFood ? prepared.costMinor : null
    const demands: PlanningInventoryProjection[] = []
    const missing: string[] = []
    if (prepared.remaining > 0) {
      if (!calculation || calculation.servings <= 0) {
        missing.push('recipe_version')
      } else {
        if (calculation.perServingNutrition) {
          const currentNutrition = flattenNutrition(calculation.perServingNutrition, prepared.remaining)
          nutrition = add(nutrition ?? {}, currentNutrition)
        } else missing.push('nutrition')
        if (calculation.perServingCostMinor != null) {
          costMinor = round((costMinor ?? 0) + calculation.perServingCostMinor * prepared.remaining)
        } else missing.push('price')
        const demandFactor = prepared.remaining / calculation.servings
        for (const ingredient of calculation.ingredients) {
          const catalog = await dependencies.getCatalogItem(userId, ingredient.itemId)
          const demand = directDemand(
            catalog,
            ingredient.baseQuantity == null ? null : ingredient.baseQuantity * demandFactor,
            forecasts,
            ingredient.itemId,
          )
          demands.push(demand)
          if (demand.status === 'incomplete') missing.push(`${ingredient.itemId}:conversion`)
        }
        for (const entry of calculation.missing) {
          for (const fact of entry.facts) missing.push(`${entry.itemId}:${fact}`)
        }
      }
    }
    items.push({
      dayPlanItemId: item.id, kind: item.kind, mode: 'planned',
      status: missing.length ? 'incomplete' : 'complete',
      source: source ? { ...source, versionId: recipeVersionId ?? null } : item.source,
      nutrition, costMinor, estimatedEnergyKcal: null, inventory: demands,
      preparedFood: prepared.preparedFood, missing: [...new Set(missing)].sort(),
    })
  }

  const plannedNutritionItems = items.filter((item) => item.mode === 'planned' && nutritionExpected.has(item.dayPlanItemId))
  const plannedCostItems = items.filter((item) => item.mode === 'planned' && costExpected.has(item.dayPlanItemId))
  const plannedNutrition = plannedNutritionItems.some((item) => item.nutrition == null)
    ? null
    : plannedNutritionItems.reduce((total, item) => add(total, item.nutrition!), {} as Record<string, number>)
  const plannedCostMinor = plannedCostItems.some((item) => item.costMinor == null)
    ? null
    : round(plannedCostItems.reduce((total, item) => total + item.costMinor!, 0))
  const actualItems = plan.items.filter((item) => item.status === 'completed' && item.actual)
  return {
    date: plan.date,
    status: items.some((item) => item.status === 'incomplete') ? 'incomplete' : 'complete',
    plannedNutrition,
    actualNutrition: actualItems.reduce((total, item) => item.actual?.nutrition ? add(total, item.actual.nutrition) : total, {} as Record<string, number>),
    plannedCostMinor,
    actualCostMinor: round(actualItems.reduce((total, item) => total + (item.actual?.costMinor ?? 0), 0)),
    plannedEnergyKcal: round(items.reduce((total, item) => item.mode === 'planned' ? total + (item.estimatedEnergyKcal ?? 0) : total, 0)),
    actualEnergyKcal: round(actualItems.reduce((total, item) => total + (item.actual?.estimatedEnergyKcal ?? 0), 0)),
    sourceIds: [...new Set(items.flatMap((item) => item.source ? [item.source.id] : []))].sort(),
    inventory: aggregateInventory(items.flatMap((item) => item.mode === 'planned' ? item.inventory : [])),
    items,
  }
}

export async function buildPlanningProjections(
  userId: string,
  plans: DayPlan[],
  dependencies: PlanningProjectionDependencies,
): Promise<DayPlanProjection[]> {
  const [units, inventoryForecasts, preparedFood] = await Promise.all([
    dependencies.listUnits(userId),
    dependencies.listInventoryForecasts(userId),
    dependencies.listPreparedFood(userId),
  ])
  const preparedStates: PreparedState[] = preparedFood.map((stock) => ({
    stock,
    portions: stock.portionsRemaining,
    nutrition: flattenNutrition(stock.nutritionRemaining),
    costMinor: stock.costRemainingMinor,
  }))
  const result: DayPlanProjection[] = []
  for (const plan of [...plans].sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id))) {
    result.push(await buildOnePlanningProjection(userId, plan, dependencies, units, inventoryForecasts, preparedStates))
  }
  return result
}

export async function buildPlanningProjection(
  userId: string,
  plan: DayPlan,
  dependencies: PlanningProjectionDependencies,
): Promise<DayPlanProjection> {
  return (await buildPlanningProjections(userId, [plan], dependencies))[0]!
}
