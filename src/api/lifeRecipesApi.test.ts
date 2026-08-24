import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { CookingCompletionResult, Recipe, RecipeCalculation, RecipeImpactPreview, RecipeVersion } from '../domain/lifeRecipes'
import { http } from './httpClient'
import { lifeRecipesApi } from './lifeRecipesApi'
import { queryClient } from './queryClient'
import { queryKeys } from './queryKeys'

vi.mock('./httpClient', () => ({ http: { request: vi.fn() } }))
vi.mock('./queryClient', () => ({ queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) } }))
const request = vi.mocked(http.request)
const invalidate = vi.mocked(queryClient.invalidateQueries)

describe('lifeRecipesApi', () => {
  beforeEach(() => { request.mockReset(); request.mockResolvedValue(undefined); invalidate.mockClear() })

  it('uses cancellable encoded recipe, version, calculation, relation and prepared-food reads', async () => {
    const signal = new AbortController().signal
    await lifeRecipesApi.get('recipe/one', signal)
    await lifeRecipesApi.listVersions('recipe/one', signal)
    await lifeRecipesApi.calculate('recipe/one', { mode: 'pinned', versionId: 'version/one', asOf: '2026-08-13' }, signal)
    await lifeRecipesApi.listRelations('item/one', signal)
    await lifeRecipesApi.listPreparedFood(signal)
    await lifeRecipesApi.listTrash(signal)
    await lifeRecipesApi.getCookingSession('session/one', signal)
    expect(request.mock.calls).toEqual([
      ['/life/recipes/recipe%2Fone', { signal }],
      ['/life/recipes/recipe%2Fone/versions', { signal }],
      ['/life/recipes/recipe%2Fone/calculation?mode=pinned&versionId=version%2Fone&asOf=2026-08-13', { signal }],
      ['/life/recipes/relations?itemId=item%2Fone', { signal }],
      ['/life/prepared-food', { signal }],
      ['/life/trash/recipes', { signal }],
      ['/life/cooking-sessions/session%2Fone', { signal }],
    ])
  })

  it('preserves CSRF, idempotency and encoded paths across recipe and cooking writes', async () => {
    const recipe = { name: 'Soup', servings: 2, components: [], steps: [] }
    await lifeRecipesApi.create(recipe, 'recipe-create', 'csrf')
    await lifeRecipesApi.previewImpact('recipe/one', { ...recipe, entityVersion: 1 }, 'csrf')
    await lifeRecipesApi.update('recipe/one', { ...recipe, entityVersion: 1 }, 'csrf')
    await lifeRecipesApi.remove('recipe/one', 1, 'csrf')
    await lifeRecipesApi.restore('recipe/one', 2, 'csrf')
    await lifeRecipesApi.createCookingSession({ recipeId: 'recipe/one', plannedServings: 2 }, 'session-create', 'csrf')
    const progress = {
      entityVersion: 1,
      currentStepIndex: 1,
      completedStepIds: ['step/one'],
      actualIngredients: [{ itemId: 'item/one', quantity: 125, unit: 'gram', replacesItemId: null }],
      timers: [{ stepId: 'step/one', elapsedSeconds: 45, running: false, startedAt: null }],
    }
    await lifeRecipesApi.updateCookingSession('session/one', progress, 'csrf')
    await lifeRecipesApi.promoteCookingNote('session/one', 1, 'note-promote', 'csrf')
    await lifeRecipesApi.completeCookingSession('session/one', { madeServings: 4, eatenServings: 1, completedAt: '2026-08-13T10:00:00.000Z' }, 'session-complete', 'csrf')
    expect(request.mock.calls.map(([path, options]) => [path, options])).toEqual([
      ['/life/recipes', { method: 'POST', body: recipe, csrf: 'csrf', idempotencyKey: 'recipe-create' }],
      ['/life/recipes/recipe%2Fone/impact-preview', { method: 'POST', body: { ...recipe, entityVersion: 1 }, csrf: 'csrf' }],
      ['/life/recipes/recipe%2Fone', { method: 'PATCH', body: { ...recipe, entityVersion: 1 }, csrf: 'csrf' }],
      ['/life/recipes/recipe%2Fone', { method: 'DELETE', body: { entityVersion: 1 }, csrf: 'csrf' }],
      ['/life/trash/recipes/recipe%2Fone/restore', { method: 'POST', body: { entityVersion: 2 }, csrf: 'csrf' }],
      ['/life/cooking-sessions', { method: 'POST', body: { recipeId: 'recipe/one', plannedServings: 2 }, csrf: 'csrf', idempotencyKey: 'session-create' }],
      ['/life/cooking-sessions/session%2Fone', { method: 'PATCH', body: progress, csrf: 'csrf' }],
      ['/life/cooking-sessions/session%2Fone/promote-note', { method: 'POST', body: { expectedRecipeVersion: 1 }, csrf: 'csrf', idempotencyKey: 'note-promote' }],
      ['/life/cooking-sessions/session%2Fone/complete', { method: 'POST', body: { madeServings: 4, eatenServings: 1, completedAt: '2026-08-13T10:00:00.000Z' }, csrf: 'csrf', idempotencyKey: 'session-complete' }],
    ])
  })

  it('awaits recipe, catalog and inventory invalidation after confirmed writes', async () => {
    await lifeRecipesApi.completeCookingSession('session', { madeServings: 1, eatenServings: 1, completedAt: '2026-08-13T10:00:00.000Z' }, 'complete', 'csrf')
    expect(invalidate.mock.calls.map(([value]) => value)).toEqual([
      { queryKey: queryKeys.lifeRecipes.all }, { queryKey: queryKeys.lifeCatalog.all }, { queryKey: queryKeys.lifeInventory.all },
    ])
  })

  it('exposes the complete recipe, calculation, preview and cooking snapshot contracts', () => {
    expectTypeOf<Recipe>().toHaveProperty('prepMinutes')
    expectTypeOf<Recipe>().toHaveProperty('tagIds')
    expectTypeOf<RecipeVersion>().toHaveProperty('yieldQuantity')
    expectTypeOf<RecipeCalculation>().toHaveProperty('ingredients')
    expectTypeOf<RecipeCalculation>().toHaveProperty('totalNutrition')
    expectTypeOf<RecipeImpactPreview>().toHaveProperty('writesApplied')
    expectTypeOf<CookingCompletionResult['snapshot']>().toHaveProperty('ingredients')
    expectTypeOf<CookingCompletionResult['preparedFood']>().toEqualTypeOf<import('../domain/lifeRecipes').PreparedFoodStock | null>()
  })
})
