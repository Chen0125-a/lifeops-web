import { convertUnit, selectEffectivePrice, type CatalogItem, type LifeUnit, type NutritionValues } from './catalog.js'
import type { InventoryBalance } from './inventory.js'

export interface RecipeComponent {
  id: string
  itemId: string
  quantity: number
  unit: string
  role: 'ingredient' | 'seasoning'
  position: number
}

export interface RecipeStep {
  id: string
  instruction: string
  ingredientItemIds: string[]
  durationSeconds: number | null
  imageMediaId: string | null
  caution: string
  position: number
}

export interface RecipeVersion {
  id: string
  recipeId: string
  number: number
  servings: number
  yieldQuantity: number | null
  yieldUnit: string | null
  components: RecipeComponent[]
  steps: RecipeStep[]
  promotedNote: string | null
  createdAt: string
}

export interface RecipeIngredientCalculation {
  itemId: string
  quantity: number
  unit: string
  baseQuantity: number | null
  costMinor: number | null
  nutrition: NutritionValues | null
  onHand: number | null
  shortage: number | null
}

export interface RecipeCalculation {
  status: 'complete' | 'incomplete'
  servings: number
  scaleFactor: number
  ingredients: RecipeIngredientCalculation[]
  totalCostMinor: number | null
  perServingCostMinor: number | null
  totalNutrition: NutritionValues | null
  perServingNutrition: NutritionValues | null
  cookingOilGrams: number | null
  perServingCookingOilGrams: number | null
  missing: Array<{ itemId: string; facts: Array<'conversion' | 'nutrition' | 'price'> }>
}

export interface RecipeCalculationInput {
  version: RecipeVersion
  items: CatalogItem[]
  units: LifeUnit[]
  balances?: InventoryBalance[]
  asOf: string
  targetServings?: number
  lockedIngredient?: { itemId: string; quantity: number; unit: string }
}

export interface RecipeVersionDiff {
  servings: { before: number; after: number } | null
  yield: {
    before: { quantity: number | null; unit: string | null }
    after: { quantity: number | null; unit: string | null }
  } | null
  components: Array<{ itemId: string; change: 'added' | 'removed' | 'changed'; beforeQuantity: number | null; afterQuantity: number | null; unit: string }>
  stepsChanged: boolean
  promotedNoteChanged: boolean
}

export interface RecipeRelation {
  recipeId: string
  recipeName: string
  recipeVersionId: string
  itemId: string
  quantity: number
  unit: string
}

export interface CookingNotePromotionResult {
  sessionNote: string
  promotedVersion: RecipeVersion | null
}

export interface CookingCompletionOutcome {
  madeServings: number
  eatenServings: number
  preparedServings: number
  ingredientConsumption: Array<{ itemId: string; quantity: number; unit: string }>
  intakeNutrition: NutritionValues
  preparedNutrition: NutritionValues
  intakeCookingOilGrams: number
  preparedCookingOilGrams: number
}

export interface Recipe {
  id: string
  name: string
  description: string
  coverMediaId: string | null
  prepMinutes: number
  cookMinutes: number
  difficulty: 'easy' | 'medium' | 'hard'
  categoryId: string | null
  tagIds: string[]
  storageNotes: string
  entityVersion: number
  currentVersion: RecipeVersion
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface RecipeVersionInput {
  servings: number
  yieldQuantity?: number | null
  yieldUnit?: string | null
  components: Array<Omit<RecipeComponent, 'id'>>
  steps: Array<Omit<RecipeStep, 'id'>>
}

export interface CreateRecipeInput extends RecipeVersionInput {
  name: string
  description?: string
  coverMediaId?: string | null
  prepMinutes?: number
  cookMinutes?: number
  difficulty?: Recipe['difficulty']
  categoryId?: string | null
  tagIds?: string[]
  storageNotes?: string
}

export interface UpdateRecipeInput extends CreateRecipeInput {
  entityVersion: number
}

export interface RecipeImpactPreview {
  writesApplied: false
  createsVersion: boolean
  nextVersionNumber: number
  futurePlansAffected: number
  diff: RecipeVersionDiff
  calculation: RecipeCalculation
}

export interface CookingSession {
  id: string
  recipeId: string
  recipeVersionId: string
  plannedServings: number
  note: string
  entityVersion: number
  progress: CookingProgress
  status: 'active' | 'completed'
  createdAt: string
  completedAt: string | null
}

export interface ActualRecipeIngredient {
  itemId: string
  quantity: number
  unit: string
  replacesItemId: string | null
}

export interface CookingTimer {
  stepId: string
  elapsedSeconds: number
  running: boolean
  startedAt: string | null
}

export interface CookingProgress {
  currentStepIndex: number
  completedStepIds: string[]
  actualIngredients: ActualRecipeIngredient[]
  timers: CookingTimer[]
}

export interface UpdateCookingSessionInput extends CookingProgress {
  entityVersion: number
}

export interface CookingCompletionSnapshot {
  id: string
  cookingSessionId: string
  recipeId: string
  recipeVersionId: string
  madeServings: number
  eatenServings: number
  ingredients: Array<RecipeIngredientCalculation & { replacesItemId: string | null }>
  totalCostMinor: number
  totalNutrition: NutritionValues
  intakeNutrition: NutritionValues
  cookingOilGrams: number
  intakeCookingOilGrams: number
  completedAt: string
}

export interface PreparedFoodStock {
  id: string
  cookingSnapshotId: string
  recipeId: string
  recipeVersionId: string
  portionsCreated: number
  portionsRemaining: number
  nutritionRemaining: NutritionValues
  cookingOilGramsRemaining: number
  costRemainingMinor: number
  createdAt: string
}

export interface PreparedFoodConsumption {
  id: string
  stockId: string
  portions: number
  nutrition: NutritionValues
  cookingOilGrams: number
  costMinor: number
}

export interface CookingCompletionResult {
  snapshot: CookingCompletionSnapshot
  preparedFood: PreparedFoodStock | null
  intake: { servings: number; nutrition: NutritionValues; cookingOilGrams: number; costMinor: number }
}

export class LifeRecipesDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message)
    this.name = 'LifeRecipesDomainError'
  }
}

const round = (value: number) => Math.round((value + Number.EPSILON) * 1_000_000_000) / 1_000_000_000
const zeroNutrition = (): NutritionValues => ({ energyKcal: 0, proteinGrams: 0, fatGrams: 0, carbohydrateGrams: 0 })
const addNutrition = (left: NutritionValues, right: NutritionValues): NutritionValues => {
  const customKeys = [...new Set([...Object.keys(left.custom ?? {}), ...Object.keys(right.custom ?? {})])].sort()
  return {
    energyKcal: round(left.energyKcal + right.energyKcal),
    proteinGrams: round(left.proteinGrams + right.proteinGrams),
    fatGrams: round(left.fatGrams + right.fatGrams),
    carbohydrateGrams: round(left.carbohydrateGrams + right.carbohydrateGrams),
    ...(customKeys.length ? { custom: Object.fromEntries(customKeys.map((name) => [name, round((left.custom?.[name] ?? 0) + (right.custom?.[name] ?? 0))])) } : {}),
  }
}
const scaleNutrition = (value: NutritionValues, factor: number): NutritionValues => ({
  energyKcal: round(value.energyKcal * factor),
  proteinGrams: round(value.proteinGrams * factor),
  fatGrams: round(value.fatGrams * factor),
  carbohydrateGrams: round(value.carbohydrateGrams * factor),
  ...(value.custom && Object.keys(value.custom).length ? { custom: Object.fromEntries(Object.entries(value.custom).map(([name, amount]) => [name, round(amount * factor)])) } : {}),
})

function positive(value: number, field: string) {
  if (!Number.isFinite(value) || value <= 0) throw new LifeRecipesDomainError('INVALID_INPUT', `${field} must be positive.`)
  return value
}

function itemConversion(item: CatalogItem, quantity: number, fromUnit: string, toUnit: string, units: LifeUnit[]) {
  return convertUnit({
    itemId: item.id,
    quantity,
    fromUnit,
    toBaseUnit: toUnit,
    itemConversions: item.itemConversions,
    units: units.map((unit) => ({ code: unit.code, dimension: unit.dimension, baseCode: unit.baseCode, toBaseFactor: unit.toBaseFactor })),
  })
}

export function calculateRecipe(input: RecipeCalculationInput): RecipeCalculation {
  const scaled = scaleRecipeVersion(input.version, input)
  const missing: RecipeCalculation['missing'] = []
  let totalCost = 0
  let costComplete = true
  let totalNutrition = zeroNutrition()
  let nutritionComplete = true
  let cookingOilGrams = 0
  let cookingOilComplete = true
  const ingredients = scaled.components.map((component): RecipeIngredientCalculation => {
    const item = input.items.find((candidate) => candidate.id === component.itemId && candidate.deletedAt == null && candidate.status === 'active')
    const facts: Array<'conversion' | 'nutrition' | 'price'> = []
    if (!item) facts.push('conversion', 'nutrition', 'price')
    const base = item ? itemConversion(item, component.quantity, component.unit, item.baseUnit, input.units) : undefined
    if (item && base?.status === 'incomplete') facts.push('conversion')
    if (!item) cookingOilComplete = false
    else if (item.isCookingOil) {
      const oil = itemConversion(item, component.quantity, component.unit, 'gram', input.units)
      if (oil.status === 'incomplete') {
        cookingOilComplete = false
        if (!facts.includes('conversion')) facts.push('conversion')
      } else cookingOilGrams = round(cookingOilGrams + oil.baseQuantity)
    }

    let componentNutrition: NutritionValues | null = null
    if (!item?.nutrition) {
      if (!facts.includes('nutrition')) facts.push('nutrition')
    } else {
      const converted = itemConversion(item, component.quantity, component.unit, item.nutrition.basisUnit, input.units)
      if (converted.status === 'incomplete') {
        if (!facts.includes('conversion')) facts.push('conversion')
      } else {
        componentNutrition = scaleNutrition(item.nutrition.values, converted.baseQuantity / positive(item.nutrition.basisQuantity, 'nutrition basis quantity'))
      }
    }

    let componentCost: number | null = null
    const price = item ? selectEffectivePrice(item.pricePoints, input.asOf) : undefined
    if (!price) {
      if (!facts.includes('price')) facts.push('price')
    } else if (item) {
      const converted = itemConversion(item, component.quantity, component.unit, price.purchaseUnit, input.units)
      if (converted.status === 'incomplete') {
        if (!facts.includes('conversion')) facts.push('conversion')
      } else {
        componentCost = round(price.amountMinor * converted.baseQuantity / positive(price.purchaseQuantity, 'price purchase quantity'))
      }
    }

    if (facts.length) missing.push({ itemId: component.itemId, facts: [...new Set(facts)].sort((a, b) => ['conversion', 'nutrition', 'price'].indexOf(a) - ['conversion', 'nutrition', 'price'].indexOf(b)) })
    if (componentNutrition) totalNutrition = addNutrition(totalNutrition, componentNutrition)
    else nutritionComplete = false
    if (componentCost != null) totalCost = round(totalCost + componentCost)
    else costComplete = false
    const onHand = input.balances?.find((balance) => balance.itemId === component.itemId)?.onHand ?? null
    const baseQuantity = base?.status === 'complete' ? base.baseQuantity : null
    return {
      itemId: component.itemId,
      quantity: component.quantity,
      unit: component.unit,
      baseQuantity,
      costMinor: componentCost,
      nutrition: componentNutrition,
      onHand,
      shortage: onHand == null || baseQuantity == null ? null : round(Math.max(0, baseQuantity - onHand)),
    }
  })
  return {
    status: missing.length ? 'incomplete' : 'complete',
    servings: scaled.servings,
    scaleFactor: scaled.scaleFactor,
    ingredients,
    totalCostMinor: costComplete ? totalCost : null,
    perServingCostMinor: costComplete ? round(totalCost / scaled.servings) : null,
    totalNutrition: nutritionComplete ? totalNutrition : null,
    perServingNutrition: nutritionComplete ? scaleNutrition(totalNutrition, 1 / scaled.servings) : null,
    cookingOilGrams: cookingOilComplete ? cookingOilGrams : null,
    perServingCookingOilGrams: cookingOilComplete ? round(cookingOilGrams / scaled.servings) : null,
    missing,
  }
}

export function scaleRecipeVersion(
  version: RecipeVersion,
  input: Pick<RecipeCalculationInput, 'items' | 'units' | 'targetServings' | 'lockedIngredient'>,
): { scaleFactor: number; servings: number; components: RecipeComponent[] } {
  positive(version.servings, 'recipe servings')
  if (input.targetServings != null && input.lockedIngredient) throw new LifeRecipesDomainError('INVALID_SCALE', 'Choose servings or a locked ingredient, not both.')
  let factor = input.targetServings == null ? 1 : positive(input.targetServings, 'target servings') / version.servings
  if (input.lockedIngredient) {
    const locked = version.components.find((component) => component.itemId === input.lockedIngredient!.itemId)
    const item = input.items.find((candidate) => candidate.id === locked?.itemId)
    if (!locked || !item) throw new LifeRecipesDomainError('LOCKED_INGREDIENT_NOT_FOUND', 'The locked ingredient is not part of this recipe.', 404)
    const converted = itemConversion(item, positive(input.lockedIngredient.quantity, 'locked ingredient quantity'), input.lockedIngredient.unit, locked.unit, input.units)
    if (converted.status === 'incomplete') throw new LifeRecipesDomainError('INCOMPLETE_CONVERSION', 'The locked ingredient quantity cannot be converted.', 409)
    factor = converted.baseQuantity / positive(locked.quantity, 'component quantity')
  }
  return {
    scaleFactor: round(factor),
    servings: round(version.servings * factor),
    components: version.components.map((component) => ({ ...component, quantity: round(component.quantity * factor) })),
  }
}

export function diffRecipeVersions(before: RecipeVersion, after: RecipeVersion): RecipeVersionDiff {
  const ids = [...new Set([...before.components.map((value) => value.itemId), ...after.components.map((value) => value.itemId)])].sort()
  const components = ids.flatMap((itemId): RecipeVersionDiff['components'] => {
    const left = before.components.find((value) => value.itemId === itemId)
    const right = after.components.find((value) => value.itemId === itemId)
    if (!left && right) return [{ itemId, change: 'added', beforeQuantity: null, afterQuantity: right.quantity, unit: right.unit }]
    if (left && !right) return [{ itemId, change: 'removed', beforeQuantity: left.quantity, afterQuantity: null, unit: left.unit }]
    if (left && right && (left.quantity !== right.quantity || left.unit !== right.unit || left.role !== right.role)) {
      return [{ itemId, change: 'changed', beforeQuantity: left.quantity, afterQuantity: right.quantity, unit: right.unit }]
    }
    return []
  })
  const stepShape = (steps: RecipeStep[]) => JSON.stringify(steps.map(({ instruction, ingredientItemIds, durationSeconds, imageMediaId, caution, position }) => ({ instruction, ingredientItemIds, durationSeconds, imageMediaId, caution, position })))
  return {
    servings: before.servings === after.servings ? null : { before: before.servings, after: after.servings },
    yield: before.yieldQuantity === after.yieldQuantity && before.yieldUnit === after.yieldUnit ? null : {
      before: { quantity: before.yieldQuantity, unit: before.yieldUnit },
      after: { quantity: after.yieldQuantity, unit: after.yieldUnit },
    },
    components,
    stepsChanged: stepShape(before.steps) !== stepShape(after.steps),
    promotedNoteChanged: before.promotedNote !== after.promotedNote,
  }
}

export function recipeVersionChanged(before: RecipeVersion, after: RecipeVersion) {
  const diff = diffRecipeVersions(before, after)
  return diff.servings != null || diff.yield != null || diff.components.length > 0 || diff.stepsChanged || diff.promotedNoteChanged
}

export function selectRecipeVersion(
  versions: RecipeVersion[],
  selection: { mode: 'latest' } | { mode: 'pinned'; versionId: string },
): RecipeVersion {
  const found = selection.mode === 'latest'
    ? [...versions].sort((left, right) => right.number - left.number)[0]
    : versions.find((version) => version.id === selection.versionId)
  if (!found) throw new LifeRecipesDomainError('RECIPE_VERSION_NOT_FOUND', 'The requested recipe version does not exist.', 404)
  return structuredClone(found)
}

export function buildIngredientRecipeRelations(
  recipes: Array<{ id: string; name: string; version: RecipeVersion }>,
  itemId?: string,
): RecipeRelation[] {
  return recipes.flatMap((recipe) => recipe.version.components
    .filter((component) => !itemId || component.itemId === itemId)
    .map((component) => ({
      recipeId: recipe.id, recipeName: recipe.name, recipeVersionId: recipe.version.id,
      itemId: component.itemId, quantity: component.quantity, unit: component.unit,
    })))
    .sort((left, right) => left.recipeId.localeCompare(right.recipeId) || left.itemId.localeCompare(right.itemId))
}

export function resolveCookingNotePromotion(input: {
  version: RecipeVersion
  note: string
  promote: boolean
  nextVersionId: string
  createdAt: string
  createId?: () => string
}): CookingNotePromotionResult {
  const note = input.note.trim()
  if (!note) throw new LifeRecipesDomainError('INVALID_INPUT', 'A cooking note is required.')
  if (!input.promote) return { sessionNote: note, promotedVersion: null }
  return {
    sessionNote: note,
    promotedVersion: {
      ...structuredClone(input.version),
      id: input.nextVersionId,
      number: input.version.number + 1,
      components: input.version.components.map((component, index) => ({ ...component, id: input.createId?.() ?? `${input.nextVersionId}-component-${index}` })),
      steps: input.version.steps.map((step, index) => ({ ...step, id: input.createId?.() ?? `${input.nextVersionId}-step-${index}` })),
      promotedNote: note,
      createdAt: input.createdAt,
    },
  }
}

export function resolveCookingCompletion(input: {
  calculation: RecipeCalculation
  madeServings: number
  eatenServings: number
}): CookingCompletionOutcome {
  positive(input.madeServings, 'made servings')
  if (!Number.isFinite(input.eatenServings) || input.eatenServings < 0 || input.eatenServings > input.madeServings) {
    throw new LifeRecipesDomainError('INVALID_INPUT', 'Eaten servings must be between zero and made servings.')
  }
  if (input.calculation.status !== 'complete' || !input.calculation.totalNutrition || input.calculation.cookingOilGrams == null) {
    throw new LifeRecipesDomainError('INCOMPLETE_RECIPE', 'Cooking cannot complete until recipe calculations are complete.', 409)
  }
  const eatenFactor = input.eatenServings / input.madeServings
  const preparedFactor = (input.madeServings - input.eatenServings) / input.madeServings
  return {
    madeServings: input.madeServings,
    eatenServings: input.eatenServings,
    preparedServings: round(input.madeServings - input.eatenServings),
    ingredientConsumption: input.calculation.ingredients.map((ingredient) => ({ itemId: ingredient.itemId, quantity: ingredient.quantity, unit: ingredient.unit })),
    intakeNutrition: scaleNutrition(input.calculation.totalNutrition, eatenFactor),
    preparedNutrition: scaleNutrition(input.calculation.totalNutrition, preparedFactor),
    intakeCookingOilGrams: round(input.calculation.cookingOilGrams * eatenFactor),
    preparedCookingOilGrams: round(input.calculation.cookingOilGrams * preparedFactor),
  }
}
