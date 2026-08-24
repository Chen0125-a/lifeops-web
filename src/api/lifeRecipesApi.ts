import type { CookingCompletionResult, CookingSession, PreparedFoodStock, Recipe, RecipeImpactPreview, RecipeInput, RecipeRelation, RecipeVersion, StoredRecipeCalculation, UpdateCookingSessionInput } from '../domain/lifeRecipes'
import { http } from './httpClient'
import { queryClient } from './queryClient'
import { queryKeys } from './queryKeys'

const segment = (value: string) => encodeURIComponent(value)
async function mutation<T>(request: Promise<T>) {
  const result = await request
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.lifeRecipes.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.lifeCatalog.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.lifeInventory.all }),
  ])
  return result
}

export const lifeRecipesApi = {
  list: (signal?: AbortSignal): Promise<Recipe[]> => http.request('/life/recipes', { signal }),
  get: (id: string, signal?: AbortSignal): Promise<Recipe> => http.request(`/life/recipes/${segment(id)}`, { signal }),
  listVersions: (id: string, signal?: AbortSignal): Promise<RecipeVersion[]> => http.request(`/life/recipes/${segment(id)}/versions`, { signal }),
  calculate: (id: string, input: { mode: 'latest' | 'pinned'; versionId?: string; asOf: string }, signal?: AbortSignal): Promise<StoredRecipeCalculation> => {
    const query = new URLSearchParams({ mode: input.mode })
    if (input.versionId) query.set('versionId', input.versionId)
    query.set('asOf', input.asOf)
    return http.request(`/life/recipes/${segment(id)}/calculation?${query}`, { signal })
  },
  listRelations: (itemId?: string, signal?: AbortSignal): Promise<RecipeRelation[]> => {
    const query = itemId ? `?${new URLSearchParams({ itemId })}` : ''
    return http.request(`/life/recipes/relations${query}`, { signal })
  },
  listPreparedFood: (signal?: AbortSignal): Promise<PreparedFoodStock[]> => http.request('/life/prepared-food', { signal }),
  listTrash: (signal?: AbortSignal): Promise<Recipe[]> => http.request('/life/trash/recipes', { signal }),
  getCookingSession: (id: string, signal?: AbortSignal): Promise<CookingSession> => http.request(`/life/cooking-sessions/${segment(id)}`, { signal }),
  create: (input: RecipeInput, idempotencyKey: string, csrf?: string): Promise<Recipe> => mutation(http.request('/life/recipes', { method: 'POST', body: input, csrf, idempotencyKey })),
  previewImpact: (id: string, input: RecipeInput & { entityVersion: number }, csrf?: string): Promise<RecipeImpactPreview> => http.request(`/life/recipes/${segment(id)}/impact-preview`, { method: 'POST', body: input, csrf }),
  update: (id: string, input: RecipeInput & { entityVersion: number }, csrf?: string): Promise<Recipe> => mutation(http.request(`/life/recipes/${segment(id)}`, { method: 'PATCH', body: input, csrf })),
  remove: (id: string, entityVersion: number, csrf?: string): Promise<void> => mutation(http.request(`/life/recipes/${segment(id)}`, { method: 'DELETE', body: { entityVersion }, csrf })),
  restore: (id: string, entityVersion: number, csrf?: string): Promise<Recipe> => mutation(http.request(`/life/trash/recipes/${segment(id)}/restore`, { method: 'POST', body: { entityVersion }, csrf })),
  createCookingSession: (input: { recipeId: string; recipeVersionId?: string; plannedServings: number; note?: string }, idempotencyKey: string, csrf?: string): Promise<CookingSession> => mutation(http.request('/life/cooking-sessions', { method: 'POST', body: input, csrf, idempotencyKey })),
  updateCookingSession: (sessionId: string, input: UpdateCookingSessionInput, csrf?: string): Promise<CookingSession> => mutation(http.request(`/life/cooking-sessions/${segment(sessionId)}`, { method: 'PATCH', body: input, csrf })),
  promoteCookingNote: (sessionId: string, expectedRecipeVersion: number, idempotencyKey: string, csrf?: string): Promise<RecipeVersion> => mutation(http.request(`/life/cooking-sessions/${segment(sessionId)}/promote-note`, { method: 'POST', body: { expectedRecipeVersion }, csrf, idempotencyKey })),
  completeCookingSession: (sessionId: string, input: { madeServings: number; eatenServings: number; completedAt: string }, idempotencyKey: string, csrf?: string): Promise<CookingCompletionResult> => mutation(http.request(`/life/cooking-sessions/${segment(sessionId)}/complete`, { method: 'POST', body: input, csrf, idempotencyKey })),
}
