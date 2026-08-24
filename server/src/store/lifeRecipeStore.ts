import type {
  CookingCompletionResult,
  CookingSession,
  CreateRecipeInput,
  PreparedFoodStock,
  Recipe,
  RecipeCalculation,
  RecipeImpactPreview,
  RecipeRelation,
  RecipeVersion,
  UpdateCookingSessionInput,
  UpdateRecipeInput,
} from '../domain/life/recipes.js'

export interface LifeRecipeStore {
  listRecipes(userId: string): Promise<Recipe[]>
  listDeletedRecipes(userId: string): Promise<Recipe[]>
  getRecipe(userId: string, id: string): Promise<Recipe | undefined>
  createRecipe(userId: string, input: CreateRecipeInput, idempotencyKey: string): Promise<Recipe>
  previewRecipeImpact(userId: string, id: string, input: UpdateRecipeInput): Promise<RecipeImpactPreview | undefined>
  updateRecipe(userId: string, id: string, input: UpdateRecipeInput): Promise<Recipe | undefined>
  deleteRecipe(userId: string, id: string, entityVersion: number): Promise<boolean>
  restoreRecipe(userId: string, id: string, entityVersion: number): Promise<Recipe | undefined>
  listRecipeVersions(userId: string, recipeId: string): Promise<RecipeVersion[] | undefined>
  calculateStoredRecipe(userId: string, recipeId: string, input: { mode: 'latest' | 'pinned'; versionId?: string; asOf: string }): Promise<(RecipeCalculation & { recipeVersionId: string; recipeVersionNumber: number }) | undefined>
  listRecipeRelations(userId: string, itemId?: string): Promise<RecipeRelation[]>
  createCookingSession(userId: string, input: { recipeId: string; recipeVersionId?: string; plannedServings: number; note?: string }, idempotencyKey: string): Promise<CookingSession>
  getCookingSession(userId: string, id: string): Promise<CookingSession | undefined>
  updateCookingSession(userId: string, id: string, input: UpdateCookingSessionInput): Promise<CookingSession | undefined>
  promoteCookingNote(userId: string, sessionId: string, expectedRecipeVersion: number, idempotencyKey: string): Promise<RecipeVersion | undefined>
  completeCookingSession(userId: string, sessionId: string, input: { madeServings: number; eatenServings: number; completedAt: string }, idempotencyKey: string): Promise<CookingCompletionResult | undefined>
  listPreparedFood(userId: string): Promise<PreparedFoodStock[]>
}
