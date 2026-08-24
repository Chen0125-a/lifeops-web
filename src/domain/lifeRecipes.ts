import type { NutritionValues } from './lifeCatalog'

export interface RecipeComponentInput {
  itemId: string
  quantity: number
  unit: string
  role: 'ingredient' | 'seasoning'
  position: number
}

export interface RecipeStepInput {
  instruction: string
  ingredientItemIds: string[]
  durationSeconds: number | null
  imageMediaId: string | null
  caution: string
  position: number
}

export interface RecipeInput {
  name: string
  description?: string
  coverMediaId?: string | null
  servings: number
  yieldQuantity?: number | null
  yieldUnit?: string | null
  prepMinutes?: number
  cookMinutes?: number
  difficulty?: 'easy' | 'medium' | 'hard'
  categoryId?: string | null
  tagIds?: string[]
  storageNotes?: string
  components: RecipeComponentInput[]
  steps: RecipeStepInput[]
}

export interface RecipeComponent extends RecipeComponentInput { id: string }
export interface RecipeStep extends RecipeStepInput { id: string }

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

export interface StoredRecipeCalculation extends RecipeCalculation {
  recipeVersionId: string
  recipeVersionNumber: number
}

export interface RecipeVersionDiff {
  servings: { before: number; after: number } | null
  yield: {
    before: { quantity: number | null; unit: string | null }
    after: { quantity: number | null; unit: string | null }
  } | null
  components: Array<{
    itemId: string
    change: 'added' | 'removed' | 'changed'
    beforeQuantity: number | null
    afterQuantity: number | null
    unit: string
  }>
  stepsChanged: boolean
  promotedNoteChanged: boolean
}

export interface RecipeImpactPreview {
  writesApplied: false
  createsVersion: boolean
  nextVersionNumber: number
  futurePlansAffected: number
  diff: RecipeVersionDiff
  calculation: RecipeCalculation
}

export interface RecipeRelation {
  recipeId: string
  recipeName: string
  recipeVersionId: string
  itemId: string
  quantity: number
  unit: string
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

export interface CookingCompletionResult {
  snapshot: CookingCompletionSnapshot
  preparedFood: PreparedFoodStock | null
  intake: { servings: number; nutrition: NutritionValues; cookingOilGrams: number; costMinor: number }
}
