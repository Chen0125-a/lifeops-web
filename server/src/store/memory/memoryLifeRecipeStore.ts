import { createHash, randomUUID } from 'node:crypto'
import type { CatalogItem, LifeUnit, NutritionValues, TaxonomyEntity, TaxonomyKind } from '../../domain/life/catalog.js'
import type { InventoryBalance } from '../../domain/life/inventory.js'
import {
  LifeRecipesDomainError,
  buildIngredientRecipeRelations,
  calculateRecipe,
  diffRecipeVersions,
  recipeVersionChanged,
  resolveCookingCompletion,
  resolveCookingNotePromotion,
  selectRecipeVersion,
  type CookingCompletionResult,
  type CookingCompletionSnapshot,
  type CookingSession,
  type CreateRecipeInput,
  type PreparedFoodConsumption,
  type PreparedFoodStock,
  type Recipe,
  type RecipeVersion,
  type RecipeVersionInput,
  type UpdateCookingSessionInput,
  type UpdateRecipeInput,
} from '../../domain/life/recipes.js'
import type { LifeRecipeStore } from '../lifeRecipeStore.js'
import type { MemoryOwnerTransactionParticipant } from './memoryOwnerTransactionCoordinator.js'

interface Owned<T> { userId: string; value: T }
interface RecipeOwnerTransactionState {
  recipes: Array<Owned<Recipe>>
  versions: Array<Owned<RecipeVersion>>
  sessions: Array<Owned<CookingSession>>
  preparedFood: Array<Owned<PreparedFoodStock>>
  completions: Array<Owned<CookingCompletionResult>>
  idempotency: Array<[string, { hash: string; promise: Promise<unknown> }]>
}

const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => `${JSON.stringify(name)}:${stable(item)}`).join(',')}}`
    : JSON.stringify(value)
const hash = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex').toUpperCase()
const round = (value: number) => Math.round((value + Number.EPSILON) * 1_000_000_000) / 1_000_000_000
const scaleNutrition = (value: NutritionValues, factor: number): NutritionValues => ({
  energyKcal: round(value.energyKcal * factor),
  proteinGrams: round(value.proteinGrams * factor),
  fatGrams: round(value.fatGrams * factor),
  carbohydrateGrams: round(value.carbohydrateGrams * factor),
  ...(value.custom ? { custom: Object.fromEntries(Object.entries(value.custom).map(([name, amount]) => [name, round(amount * factor)])) } : {}),
})
const addNutrition = (left: NutritionValues, right: NutritionValues): NutritionValues => ({
  energyKcal: round(left.energyKcal + right.energyKcal),
  proteinGrams: round(left.proteinGrams + right.proteinGrams),
  fatGrams: round(left.fatGrams + right.fatGrams),
  carbohydrateGrams: round(left.carbohydrateGrams + right.carbohydrateGrams),
  ...((left.custom || right.custom) ? { custom: Object.fromEntries([...new Set([...Object.keys(left.custom ?? {}), ...Object.keys(right.custom ?? {})])]
    .map((name) => [name, round((left.custom?.[name] ?? 0) + (right.custom?.[name] ?? 0))])) } : {}),
})

export class MemoryLifeRecipeStore implements LifeRecipeStore, MemoryOwnerTransactionParticipant<RecipeOwnerTransactionState> {
  private readonly createId: () => string
  private readonly now: () => string
  private recipes: Array<Owned<Recipe>> = []
  private versions: Array<Owned<RecipeVersion>> = []
  private sessions: Array<Owned<CookingSession>> = []
  private preparedFood: Array<Owned<PreparedFoodStock>> = []
  private readonly completions: Array<Owned<CookingCompletionResult>> = []
  private readonly idempotency = new Map<string, { hash: string; promise: Promise<unknown> }>()

  constructor(private readonly options: {
    createId?: () => string
    now?: () => string
    getCatalogItem(userId: string, itemId: string): Promise<CatalogItem | undefined>
    listCatalogItems(userId: string): Promise<CatalogItem[]>
    listTaxonomy(userId: string, kind: TaxonomyKind): Promise<TaxonomyEntity[]>
    listUnits(userId: string): Promise<LifeUnit[]>
    getMediaAsset(userId: string, id: string): Promise<unknown | undefined>
    listInventoryBalances(userId: string): Promise<InventoryBalance[]>
    consumeRecipeIngredients(userId: string, inputs: Array<{ itemId: string; quantity: number; unit: string }>, occurredAt: string, cookingSessionId: string): Promise<unknown>
  }) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date().toISOString())
  }

  async listRecipes(userId: string) {
    return structuredClone(this.recipes.filter((entry) => entry.userId === userId && entry.value.deletedAt == null).map((entry) => entry.value).sort((a, b) => a.name.localeCompare(b.name)))
  }

  async listDeletedRecipes(userId: string) {
    return structuredClone(this.recipes.filter((entry) => entry.userId === userId && entry.value.deletedAt != null).map((entry) => entry.value).sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '') || a.name.localeCompare(b.name)))
  }

  async getRecipe(userId: string, id: string) {
    const value = this.recipe(userId, id)
    return value ? structuredClone(value) : undefined
  }

  captureOwnerTransactionState(userId: string): RecipeOwnerTransactionState {
    const prefix = `${userId}\0`
    return {
      recipes: structuredClone(this.recipes.filter((entry) => entry.userId === userId)),
      versions: structuredClone(this.versions.filter((entry) => entry.userId === userId)),
      sessions: structuredClone(this.sessions.filter((entry) => entry.userId === userId)),
      preparedFood: structuredClone(this.preparedFood.filter((entry) => entry.userId === userId)),
      completions: structuredClone(this.completions.filter((entry) => entry.userId === userId)),
      idempotency: [...this.idempotency.entries()].filter(([key]) => key.startsWith(prefix)),
    }
  }

  restoreOwnerTransactionState(userId: string, state: RecipeOwnerTransactionState) {
    const restore = <T>(current: Array<Owned<T>>, saved: Array<Owned<T>>) => [
      ...current.filter((entry) => entry.userId !== userId), ...structuredClone(saved),
    ]
    this.recipes = restore(this.recipes, state.recipes)
    this.versions = restore(this.versions, state.versions)
    this.sessions = restore(this.sessions, state.sessions)
    this.preparedFood = restore(this.preparedFood, state.preparedFood)
    this.completions.splice(0, this.completions.length,
      ...this.completions.filter((entry) => entry.userId !== userId), ...structuredClone(state.completions))
    const prefix = `${userId}\0`
    for (const key of [...this.idempotency.keys()]) if (key.startsWith(prefix)) this.idempotency.delete(key)
    for (const [key, value] of state.idempotency) this.idempotency.set(key, value)
  }

  exportOwnerPortableData(userId: string) {
    return {
      recipes: structuredClone(this.recipes.filter((entry) => entry.userId === userId).map((entry) => entry.value)),
      recipeVersions: structuredClone(this.versions.filter((entry) => entry.userId === userId).map((entry) => entry.value)),
      cookingSessions: structuredClone(this.sessions.filter((entry) => entry.userId === userId).map((entry) => entry.value)),
      cookingCompletions: structuredClone(this.completions.filter((entry) => entry.userId === userId).map((entry) => entry.value.snapshot)),
      preparedFood: structuredClone(this.preparedFood.filter((entry) => entry.userId === userId).map((entry) => entry.value)),
    }
  }

  replaceOwnerPortableData(userId: string, payload: Record<string, unknown>) {
    const values = <T>(key: string) => structuredClone((Array.isArray(payload[key]) ? payload[key] : []) as T[])
    this.recipes = [...this.recipes.filter((entry) => entry.userId !== userId),
      ...values<Recipe>('recipes').map((value) => ({ userId, value }))]
    this.versions = [...this.versions.filter((entry) => entry.userId !== userId),
      ...values<RecipeVersion>('recipeVersions').map((value) => ({ userId, value }))]
    this.sessions = [...this.sessions.filter((entry) => entry.userId !== userId),
      ...values<CookingSession>('cookingSessions').map((value) => ({ userId, value }))]
    const preparedFood = values<PreparedFoodStock>('preparedFood')
    this.preparedFood = [...this.preparedFood.filter((entry) => entry.userId !== userId),
      ...preparedFood.map((value) => ({ userId, value }))]
    const completions = values<CookingCompletionSnapshot>('cookingCompletions').map((snapshot): CookingCompletionResult => ({
      snapshot,
      preparedFood: preparedFood.find((entry) => entry.cookingSnapshotId === snapshot.id) ?? null,
      intake: {
        servings: snapshot.eatenServings,
        nutrition: structuredClone(snapshot.intakeNutrition),
        cookingOilGrams: snapshot.intakeCookingOilGrams,
        costMinor: round(snapshot.totalCostMinor * snapshot.eatenServings / snapshot.madeServings),
      },
    }))
    this.completions.splice(0, this.completions.length,
      ...this.completions.filter((entry) => entry.userId !== userId),
      ...completions.map((value) => ({ userId, value })))
  }

  async createRecipe(userId: string, input: CreateRecipeInput, key: string) {
    return this.idempotently<Recipe>(userId, 'create-recipe', key, input, async () => {
      await this.validateRecipeInput(userId, input)
      const timestamp = this.now()
      const recipeId = this.createId()
      const version = this.createVersion(recipeId, 1, input, timestamp)
      const recipe: Recipe = {
        id: recipeId,
        name: this.text(input.name, 'name'),
        description: input.description?.trim() ?? '',
        coverMediaId: input.coverMediaId ?? null,
        prepMinutes: this.nonNegative(input.prepMinutes ?? 0, 'prepMinutes'),
        cookMinutes: this.nonNegative(input.cookMinutes ?? 0, 'cookMinutes'),
        difficulty: input.difficulty ?? 'easy',
        categoryId: input.categoryId ?? null,
        tagIds: [...new Set(input.tagIds ?? [])],
        storageNotes: input.storageNotes?.trim() ?? '',
        entityVersion: 1,
        currentVersion: version,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      }
      this.versions.push({ userId, value: version })
      this.recipes.push({ userId, value: recipe })
      return structuredClone(recipe)
    })
  }

  async previewRecipeImpact(userId: string, id: string, input: UpdateRecipeInput) {
    const recipe = this.recipe(userId, id)
    if (!recipe) return undefined
    this.assertEntityVersion(recipe, input.entityVersion)
    await this.validateRecipeInput(userId, input)
    const proposed = this.createVersion(id, recipe.currentVersion.number + 1, input, this.now(), recipe.currentVersion.promotedNote)
    const createsVersion = recipeVersionChanged(recipe.currentVersion, proposed)
    return {
      writesApplied: false as const,
      createsVersion,
      nextVersionNumber: createsVersion ? proposed.number : recipe.currentVersion.number,
      futurePlansAffected: 0,
      diff: diffRecipeVersions(recipe.currentVersion, proposed),
      calculation: await this.calculation(userId, proposed, this.now().slice(0, 10)),
    }
  }

  async updateRecipe(userId: string, id: string, input: UpdateRecipeInput) {
    const recipe = this.recipe(userId, id)
    if (!recipe) return undefined
    this.assertEntityVersion(recipe, input.entityVersion)
    await this.validateRecipeInput(userId, input)
    const timestamp = this.now()
    const proposed = this.createVersion(id, recipe.currentVersion.number + 1, input, timestamp, recipe.currentVersion.promotedNote)
    const createsVersion = recipeVersionChanged(recipe.currentVersion, proposed)
    const next = createsVersion ? proposed : recipe.currentVersion
    recipe.name = this.text(input.name, 'name')
    recipe.description = input.description?.trim() ?? ''
    recipe.coverMediaId = input.coverMediaId ?? null
    recipe.prepMinutes = this.nonNegative(input.prepMinutes ?? 0, 'prepMinutes')
    recipe.cookMinutes = this.nonNegative(input.cookMinutes ?? 0, 'cookMinutes')
    recipe.difficulty = input.difficulty ?? 'easy'
    recipe.categoryId = input.categoryId ?? null
    recipe.tagIds = [...new Set(input.tagIds ?? [])]
    recipe.storageNotes = input.storageNotes?.trim() ?? ''
    recipe.entityVersion += 1
    recipe.currentVersion = next
    recipe.updatedAt = timestamp
    if (createsVersion) this.versions.push({ userId, value: next })
    return structuredClone(recipe)
  }

  async deleteRecipe(userId: string, id: string, entityVersion: number) {
    const recipe = this.recipe(userId, id)
    if (!recipe) return false
    this.assertEntityVersion(recipe, entityVersion)
    const timestamp = this.now()
    recipe.deletedAt = timestamp
    recipe.updatedAt = timestamp
    recipe.entityVersion += 1
    return true
  }

  async restoreRecipe(userId: string, id: string, entityVersion: number) {
    const recipe = this.anyRecipe(userId, id)
    if (!recipe || recipe.deletedAt == null) return undefined
    this.assertEntityVersion(recipe, entityVersion)
    const timestamp = this.now()
    recipe.deletedAt = null
    recipe.updatedAt = timestamp
    recipe.entityVersion += 1
    return structuredClone(recipe)
  }

  async listRecipeVersions(userId: string, recipeId: string) {
    if (!this.recipe(userId, recipeId)) return undefined
    return structuredClone(this.ownedVersions(userId, recipeId).sort((a, b) => a.number - b.number))
  }

  async calculateStoredRecipe(userId: string, recipeId: string, input: { mode: 'latest' | 'pinned'; versionId?: string; asOf: string }) {
    const recipe = this.recipe(userId, recipeId)
    if (!recipe) return undefined
    const versions = this.ownedVersions(userId, recipeId)
    const selected = selectRecipeVersion(versions, input.mode === 'latest' ? { mode: 'latest' } : { mode: 'pinned', versionId: input.versionId ?? '' })
    return { ...(await this.calculation(userId, selected, input.asOf)), recipeVersionId: selected.id, recipeVersionNumber: selected.number }
  }

  async listRecipeRelations(userId: string, itemId?: string) {
    const recipes = this.recipes.filter((entry) => entry.userId === userId).map((entry) => ({ id: entry.value.id, name: entry.value.name, version: entry.value.currentVersion }))
    return buildIngredientRecipeRelations(recipes, itemId)
  }

  async createCookingSession(userId: string, input: { recipeId: string; recipeVersionId?: string; plannedServings: number; note?: string }, key: string) {
    return this.idempotently<CookingSession>(userId, 'create-cooking-session', key, input, async () => {
      const recipe = this.recipe(userId, input.recipeId)
      if (!recipe) throw new LifeRecipesDomainError('NOT_FOUND', 'The recipe does not exist.', 404)
      const version = selectRecipeVersion(this.ownedVersions(userId, recipe.id), input.recipeVersionId ? { mode: 'pinned', versionId: input.recipeVersionId } : { mode: 'latest' })
      const timestamp = this.now()
      const session: CookingSession = {
        id: this.createId(), recipeId: recipe.id, recipeVersionId: version.id,
        plannedServings: this.positive(input.plannedServings, 'plannedServings'), note: input.note?.trim() ?? '',
        entityVersion: 1,
        progress: { currentStepIndex: 0, completedStepIds: [], actualIngredients: [], timers: [] },
        status: 'active', createdAt: timestamp, completedAt: null,
      }
      this.sessions.push({ userId, value: session })
      return structuredClone(session)
    })
  }

  async getCookingSession(userId: string, id: string) {
    const session = this.session(userId, id)
    return session ? structuredClone(session) : undefined
  }

  async updateCookingSession(userId: string, id: string, input: UpdateCookingSessionInput) {
    const session = this.session(userId, id)
    if (!session) return undefined
    if (session.status !== 'active') throw new LifeRecipesDomainError('COOKING_ALREADY_COMPLETED', 'This cooking session is already complete.', 409)
    this.assertSessionVersion(session, input.entityVersion)
    session.progress = await this.validateCookingProgress(userId, session, input)
    session.entityVersion += 1
    return structuredClone(session)
  }

  async promoteCookingNote(userId: string, sessionId: string, expectedRecipeVersion: number, key: string) {
    const session = this.session(userId, sessionId)
    if (!session) return undefined
    return this.idempotently<RecipeVersion>(userId, `promote-note:${sessionId}`, key, { expectedRecipeVersion }, async () => {
      const recipe = this.recipe(userId, session.recipeId)
      if (!recipe) throw new LifeRecipesDomainError('NOT_FOUND', 'The recipe does not exist.', 404)
      this.assertEntityVersion(recipe, expectedRecipeVersion)
      const result = resolveCookingNotePromotion({ version: recipe.currentVersion, note: session.note, promote: true, nextVersionId: this.createId(), createdAt: this.now(), createId: this.createId })
      const next = result.promotedVersion!
      recipe.currentVersion = next
      recipe.entityVersion += 1
      recipe.updatedAt = next.createdAt
      this.versions.push({ userId, value: next })
      return structuredClone(next)
    })
  }

  async completeCookingSession(userId: string, sessionId: string, input: { madeServings: number; eatenServings: number; completedAt: string }, key: string) {
    const session = this.session(userId, sessionId)
    if (!session) return undefined
    return this.idempotently<CookingCompletionResult>(userId, `complete-cooking:${sessionId}`, key, input, async () => {
      if (session.status === 'completed') throw new LifeRecipesDomainError('COOKING_ALREADY_COMPLETED', 'This cooking session is already complete.', 409)
      const recipe = this.anyRecipe(userId, session.recipeId)!
      const version = selectRecipeVersion(this.ownedVersions(userId, recipe.id), { mode: 'pinned', versionId: session.recipeVersionId })
      const completionVersion = this.resolveActualVersion(version, session, input.madeServings)
      const calculation = await this.calculation(userId, completionVersion, input.completedAt.slice(0, 10), session.progress.actualIngredients.length ? undefined : input.madeServings)
      const outcome = resolveCookingCompletion({ calculation, madeServings: input.madeServings, eatenServings: input.eatenServings })
      await this.options.consumeRecipeIngredients(userId, outcome.ingredientConsumption, input.completedAt, session.id)
      const timestamp = this.now()
      const totalNutrition = calculation.totalNutrition!
      const totalCostMinor = calculation.totalCostMinor!
      const snapshotIngredients = calculation.ingredients.map((ingredient) => ({
        ...ingredient,
        replacesItemId: session.progress.actualIngredients.find((actual) => actual.itemId === ingredient.itemId)?.replacesItemId ?? null,
      }))
      const snapshot = {
        id: this.createId(), cookingSessionId: session.id, recipeId: recipe.id, recipeVersionId: version.id,
        madeServings: input.madeServings, eatenServings: input.eatenServings,
        ingredients: structuredClone(snapshotIngredients), totalCostMinor, totalNutrition,
        intakeNutrition: outcome.intakeNutrition,
        cookingOilGrams: calculation.cookingOilGrams!,
        intakeCookingOilGrams: outcome.intakeCookingOilGrams,
        completedAt: new Date(input.completedAt).toISOString(),
      }
      const preparedPortions = outcome.preparedServings
      const prepared = preparedPortions > 0 ? {
        id: this.createId(), cookingSnapshotId: snapshot.id, recipeId: recipe.id, recipeVersionId: version.id,
        portionsCreated: preparedPortions, portionsRemaining: preparedPortions,
        nutritionRemaining: outcome.preparedNutrition,
        cookingOilGramsRemaining: outcome.preparedCookingOilGrams,
        costRemainingMinor: round(totalCostMinor * preparedPortions / input.madeServings), createdAt: timestamp,
      } satisfies PreparedFoodStock : null
      const result: CookingCompletionResult = {
        snapshot,
        preparedFood: prepared,
        intake: {
          servings: input.eatenServings,
          nutrition: outcome.intakeNutrition,
          cookingOilGrams: outcome.intakeCookingOilGrams,
          costMinor: round(totalCostMinor * input.eatenServings / input.madeServings),
        },
      }
      session.status = 'completed'
      session.completedAt = snapshot.completedAt
      session.entityVersion += 1
      if (prepared) this.preparedFood.push({ userId, value: prepared })
      this.completions.push({ userId, value: result })
      return structuredClone(result)
    })
  }

  async listPreparedFood(userId: string) {
    return structuredClone(this.preparedFood.filter((entry) => entry.userId === userId).map((entry) => entry.value))
  }

  consumePreparedFood(userId: string, recipeId: string, recipeVersionId: string, requestedPortions: number) {
    this.positive(requestedPortions, 'requested portions')
    let remaining = requestedPortions
    const events: PreparedFoodConsumption[] = []
    const candidates = this.preparedFood
      .filter((entry) => entry.userId === userId && entry.value.recipeId === recipeId
        && entry.value.recipeVersionId === recipeVersionId && entry.value.portionsRemaining > 0)
      .map((entry) => entry.value)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    for (const stock of candidates) {
      if (remaining <= 0) break
      const portions = Math.min(remaining, stock.portionsRemaining)
      const factor = portions / stock.portionsRemaining
      const nutrition = scaleNutrition(stock.nutritionRemaining, factor)
      const cookingOilGrams = round(stock.cookingOilGramsRemaining * factor)
      const costMinor = round(stock.costRemainingMinor * factor)
      stock.portionsRemaining = round(stock.portionsRemaining - portions)
      stock.nutritionRemaining = scaleNutrition(stock.nutritionRemaining, 1 - factor)
      stock.cookingOilGramsRemaining = round(stock.cookingOilGramsRemaining - cookingOilGrams)
      stock.costRemainingMinor = round(stock.costRemainingMinor - costMinor)
      remaining = round(remaining - portions)
      events.push({ id: this.createId(), stockId: stock.id, portions, nutrition, cookingOilGrams, costMinor })
    }
    return { events: structuredClone(events), remaining }
  }

  restorePreparedFood(userId: string, events: PreparedFoodConsumption[]) {
    for (const event of events) {
      const stock = this.preparedFood.find((entry) => entry.userId === userId && entry.value.id === event.stockId)?.value
      if (!stock) throw new LifeRecipesDomainError('PREPARED_FOOD_NOT_FOUND', 'The prepared-food stock no longer exists.', 409)
      if (round(stock.portionsRemaining + event.portions) > stock.portionsCreated) {
        throw new LifeRecipesDomainError('PREPARED_FOOD_RESTORE_CONFLICT', 'Prepared-food stock would exceed its original portions.', 409)
      }
      stock.portionsRemaining = round(stock.portionsRemaining + event.portions)
      stock.nutritionRemaining = addNutrition(stock.nutritionRemaining, event.nutrition)
      stock.cookingOilGramsRemaining = round(stock.cookingOilGramsRemaining + event.cookingOilGrams)
      stock.costRemainingMinor = round(stock.costRemainingMinor + event.costMinor)
    }
  }

  private async calculation(userId: string, version: RecipeVersion, asOf: string, targetServings?: number) {
    return calculateRecipe({
      version,
      items: await this.options.listCatalogItems(userId),
      units: await this.options.listUnits(userId),
      balances: await this.options.listInventoryBalances(userId),
      asOf,
      targetServings,
    })
  }

  private async validateRecipeInput(userId: string, input: CreateRecipeInput) {
    this.text(input.name, 'name')
    this.positive(input.servings, 'servings')
    if (!input.components.length) throw new LifeRecipesDomainError('INVALID_INPUT', 'A recipe requires at least one component.')
    const ids = new Set<string>()
    for (const component of input.components) {
      if (ids.has(component.itemId)) throw new LifeRecipesDomainError('DUPLICATE_COMPONENT', 'A recipe ingredient can appear only once.', 409)
      ids.add(component.itemId)
      const item = await this.options.getCatalogItem(userId, component.itemId)
      if (!item || item.deletedAt != null || item.status !== 'active' || item.kind !== 'ingredient') throw new LifeRecipesDomainError('NOT_FOUND', 'A recipe ingredient does not exist.', 404)
      this.positive(component.quantity, 'component quantity')
    }
    if (input.categoryId) {
      const categories = await this.options.listTaxonomy(userId, 'category')
      if (!categories.some((entry) => entry.id === input.categoryId && entry.status === 'active')) {
        throw new LifeRecipesDomainError('NOT_FOUND', 'The recipe category does not exist.', 404)
      }
    }
    if (input.coverMediaId && !await this.options.getMediaAsset(userId, input.coverMediaId)) {
      throw new LifeRecipesDomainError('NOT_FOUND', 'Recipe cover media does not exist.', 404)
    }
    if (input.tagIds?.length) {
      const tags = await this.options.listTaxonomy(userId, 'tag')
      const activeTagIds = new Set(tags.filter((entry) => entry.status === 'active').map((entry) => entry.id))
      if (input.tagIds.some((id) => !activeTagIds.has(id))) throw new LifeRecipesDomainError('NOT_FOUND', 'A recipe tag does not exist.', 404)
    }
    for (const step of input.steps) {
      for (const itemId of step.ingredientItemIds) {
        if (!ids.has(itemId)) throw new LifeRecipesDomainError('INVALID_STEP_REFERENCE', 'A recipe step references an ingredient outside the recipe.', 409)
      }
      if (step.imageMediaId && !await this.options.getMediaAsset(userId, step.imageMediaId)) {
        throw new LifeRecipesDomainError('NOT_FOUND', 'Recipe step media does not exist.', 404)
      }
    }
  }

  private createVersion(recipeId: string, number: number, input: RecipeVersionInput, timestamp: string, promotedNote: string | null = null): RecipeVersion {
    return {
      id: this.createId(), recipeId, number, servings: input.servings,
      yieldQuantity: input.yieldQuantity ?? null, yieldUnit: input.yieldUnit?.trim() || null,
      components: [...input.components].sort((a, b) => a.position - b.position).map((value) => ({ ...value, id: this.createId(), unit: value.unit.trim().toLowerCase() })),
      steps: [...input.steps].sort((a, b) => a.position - b.position).map((value) => ({ ...value, id: this.createId(), instruction: value.instruction.trim(), ingredientItemIds: [...new Set(value.ingredientItemIds)], caution: value.caution.trim() })),
      promotedNote, createdAt: timestamp,
    }
  }

  private async validateCookingProgress(userId: string, session: CookingSession, input: UpdateCookingSessionInput) {
    const version = selectRecipeVersion(this.ownedVersions(userId, session.recipeId), { mode: 'pinned', versionId: session.recipeVersionId })
    if (!Number.isInteger(input.currentStepIndex) || input.currentStepIndex < 0 || input.currentStepIndex > version.steps.length) {
      throw new LifeRecipesDomainError('INVALID_INPUT', 'The current cooking step is invalid.')
    }
    const stepIds = new Set(version.steps.map((step) => step.id))
    if (new Set(input.completedStepIds).size !== input.completedStepIds.length || input.completedStepIds.some((id) => !stepIds.has(id))) {
      throw new LifeRecipesDomainError('INVALID_INPUT', 'Completed cooking steps must belong to this recipe version.')
    }
    const timerStepIds = new Set<string>()
    for (const timer of input.timers) {
      if (!stepIds.has(timer.stepId) || timerStepIds.has(timer.stepId) || !Number.isInteger(timer.elapsedSeconds) || timer.elapsedSeconds < 0) {
        throw new LifeRecipesDomainError('INVALID_INPUT', 'Cooking timers must be unique, non-negative and belong to this recipe version.')
      }
      timerStepIds.add(timer.stepId)
      if (timer.startedAt != null && Number.isNaN(Date.parse(timer.startedAt))) throw new LifeRecipesDomainError('INVALID_DATE', 'The cooking timer timestamp is invalid.')
    }
    const componentIds = new Set(version.components.map((component) => component.itemId))
    const actualItemIds = new Set<string>()
    const coveredComponentIds = new Set<string>()
    for (const actual of input.actualIngredients) {
      this.positive(actual.quantity, 'actual ingredient quantity')
      if (actualItemIds.has(actual.itemId)) throw new LifeRecipesDomainError('DUPLICATE_COMPONENT', 'An actual ingredient can appear only once.', 409)
      actualItemIds.add(actual.itemId)
      const sourceId = actual.replacesItemId ?? actual.itemId
      if (!componentIds.has(sourceId) || coveredComponentIds.has(sourceId)) throw new LifeRecipesDomainError('INVALID_SUBSTITUTION', 'Each actual ingredient must map to one recipe component.', 409)
      coveredComponentIds.add(sourceId)
      const item = await this.options.getCatalogItem(userId, actual.itemId)
      if (!item || item.deletedAt != null || item.status !== 'active' || item.kind !== 'ingredient') throw new LifeRecipesDomainError('NOT_FOUND', 'An actual cooking ingredient does not exist.', 404)
    }
    return structuredClone({
      currentStepIndex: input.currentStepIndex,
      completedStepIds: input.completedStepIds,
      actualIngredients: input.actualIngredients.map((value) => ({ ...value, unit: value.unit.trim().toLowerCase() })),
      timers: input.timers.map((value) => ({ ...value, startedAt: value.startedAt == null ? null : new Date(value.startedAt).toISOString() })),
    })
  }

  private resolveActualVersion(version: RecipeVersion, session: CookingSession, madeServings: number): RecipeVersion {
    if (!session.progress.actualIngredients.length) return version
    const covered = new Set(session.progress.actualIngredients.map((actual) => actual.replacesItemId ?? actual.itemId))
    const missing = version.components.filter((component) => !covered.has(component.itemId))
    if (missing.length) throw new LifeRecipesDomainError('INCOMPLETE_ACTUAL_INGREDIENTS', 'Actual cooking quantities must account for every recipe component.', 409)
    return {
      ...structuredClone(version),
      servings: this.positive(madeServings, 'madeServings'),
      components: session.progress.actualIngredients.map((actual, index) => {
        const source = version.components.find((component) => component.itemId === (actual.replacesItemId ?? actual.itemId))!
        return { id: `${session.id}-actual-${index}`, itemId: actual.itemId, quantity: actual.quantity, unit: actual.unit, role: source.role, position: index }
      }),
    }
  }

  private recipe(userId: string, id: string) { const value = this.anyRecipe(userId, id); return value?.deletedAt == null ? value : undefined }
  private anyRecipe(userId: string, id: string) { return this.recipes.find((entry) => entry.userId === userId && entry.value.id === id)?.value }
  private session(userId: string, id: string) { return this.sessions.find((entry) => entry.userId === userId && entry.value.id === id)?.value }
  private ownedVersions(userId: string, recipeId: string) { return this.versions.filter((entry) => entry.userId === userId && entry.value.recipeId === recipeId).map((entry) => entry.value) }
  private assertEntityVersion(recipe: Recipe, expected: number) {
    if (recipe.entityVersion !== expected) throw new LifeRecipesDomainError('VERSION_CONFLICT', 'The recipe changed since it was loaded.', 409)
  }
  private assertSessionVersion(session: CookingSession, expected: number) {
    if (session.entityVersion !== expected) throw new LifeRecipesDomainError('VERSION_CONFLICT', 'The cooking session changed since it was loaded.', 409)
  }
  private text(value: string, field: string) { const clean = value?.trim(); if (!clean) throw new LifeRecipesDomainError('INVALID_INPUT', `${field} is required.`); return clean }
  private positive(value: number, field: string) { if (!Number.isFinite(value) || value <= 0) throw new LifeRecipesDomainError('INVALID_INPUT', `${field} must be positive.`); return value }
  private nonNegative(value: number, field: string) { if (!Number.isFinite(value) || value < 0) throw new LifeRecipesDomainError('INVALID_INPUT', `${field} must be non-negative.`); return value }

  private async idempotently<T>(userId: string, operation: string, rawKey: string, input: unknown, create: () => Promise<T>): Promise<T> {
    const key = rawKey.trim()
    if (!key || key.length > 190) throw new LifeRecipesDomainError('INVALID_IDEMPOTENCY_KEY', 'A valid idempotency key is required.')
    const mapKey = `${userId}\u0000${operation}\u0000${key}`
    const requestHash = hash(input)
    const existing = this.idempotency.get(mapKey)
    if (existing) {
      if (existing.hash !== requestHash) throw new LifeRecipesDomainError('IDEMPOTENCY_CONFLICT', 'The idempotency key belongs to another recipe request.', 409)
      return structuredClone(await existing.promise) as T
    }
    const promise = Promise.resolve().then(create)
    this.idempotency.set(mapKey, { hash: requestHash, promise })
    try { return structuredClone(await promise) } catch (error) { this.idempotency.delete(mapKey); throw error }
  }
}
