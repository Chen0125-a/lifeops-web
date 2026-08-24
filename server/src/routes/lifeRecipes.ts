import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { CreateRecipeInput, UpdateCookingSessionInput, UpdateRecipeInput } from '../domain/life/recipes.js'
import type { User } from '../domain/types.js'
import type { LifeStore } from '../store/lifeStore.js'

interface RouteAuth { user: User }
interface LifeRecipeRouteSecurity {
  authenticate(request: FastifyRequest, reply: FastifyReply): Promise<RouteAuth | undefined>
  authorizeWrite(request: FastifyRequest, reply: FastifyReply): Promise<RouteAuth | undefined>
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, required })
const text = (minLength = 1, maxLength = 10_000) => ({ type: 'string', minLength, maxLength })
const nullableText = (maxLength = 500) => ({ anyOf: [text(1, maxLength), { type: 'null' }] })
const id = text(1, 80)
const positive = { type: 'number', exclusiveMinimum: 0 }
const nonNegative = { type: 'number', minimum: 0 }
const position = { type: 'integer', minimum: 0 }
const component = objectSchema({ itemId: id, quantity: positive, unit: text(1, 80), role: { type: 'string', enum: ['ingredient', 'seasoning'] }, position }, ['itemId', 'quantity', 'unit', 'role', 'position'])
const step = objectSchema({
  instruction: text(1, 20_000), ingredientItemIds: { type: 'array', maxItems: 200, uniqueItems: true, items: id },
  durationSeconds: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] }, imageMediaId: nullableText(80),
  caution: text(0, 4_000), position,
}, ['instruction', 'ingredientItemIds', 'durationSeconds', 'imageMediaId', 'caution', 'position'])
const recipeFields = {
  name: text(1, 240), description: text(0, 20_000), coverMediaId: nullableText(80), servings: positive,
  yieldQuantity: { anyOf: [positive, { type: 'null' }] }, yieldUnit: nullableText(80),
  prepMinutes: nonNegative, cookMinutes: nonNegative, difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
  categoryId: nullableText(80), tagIds: { type: 'array', maxItems: 200, uniqueItems: true, items: id },
  storageNotes: text(0, 4_000), components: { type: 'array', minItems: 1, maxItems: 500, items: component },
  steps: { type: 'array', maxItems: 500, items: step },
}
const actualIngredient = objectSchema({ itemId: id, quantity: positive, unit: text(1, 80), replacesItemId: nullableText(80) }, ['itemId', 'quantity', 'unit', 'replacesItemId'])
const cookingTimer = objectSchema({
  stepId: id, elapsedSeconds: { type: 'integer', minimum: 0 }, running: { type: 'boolean' }, startedAt: nullableText(80),
}, ['stepId', 'elapsedSeconds', 'running', 'startedAt'])
const cookingProgressFields = {
  entityVersion: { type: 'integer', minimum: 1 },
  currentStepIndex: { type: 'integer', minimum: 0 },
  completedStepIds: { type: 'array', maxItems: 500, uniqueItems: true, items: id },
  actualIngredients: { type: 'array', maxItems: 500, items: actualIngredient },
  timers: { type: 'array', maxItems: 500, items: cookingTimer },
}

function idempotencyKey(request: FastifyRequest, reply: FastifyReply) {
  const value = Array.isArray(request.headers['idempotency-key']) ? request.headers['idempotency-key'][0] : request.headers['idempotency-key']
  if (typeof value !== 'string' || !value.trim()) {
    reply.code(400).send({ error: { code: 'IDEMPOTENCY_REQUIRED', message: 'Recipe creation and cooking writes require an idempotency key.', requestId: request.id } })
    return undefined
  }
  return value.trim()
}

const notFound = (request: FastifyRequest, reply: FastifyReply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'The recipe object was not found.', requestId: request.id } })

export function registerLifeRecipeRoutes(app: FastifyInstance, store: LifeStore, security: LifeRecipeRouteSecurity) {
  app.get('/api/v1/life/recipes', async (request, reply) => {
    const auth = await security.authenticate(request, reply); if (!auth) return
    return store.listRecipes(auth.user.id)
  })
  app.post('/api/v1/life/recipes', { schema: { body: objectSchema(recipeFields, ['name', 'servings', 'components', 'steps']) } }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply); if (!auth) return
    const key = idempotencyKey(request, reply); if (!key) return
    return reply.code(201).send(await store.createRecipe(auth.user.id, request.body as CreateRecipeInput, key))
  })
  app.get('/api/v1/life/recipes/relations', { schema: { querystring: objectSchema({ itemId: id }) } }, async (request, reply) => {
    const auth = await security.authenticate(request, reply); if (!auth) return
    return store.listRecipeRelations(auth.user.id, (request.query as { itemId?: string }).itemId)
  })
  app.get('/api/v1/life/recipes/:id/versions', { schema: { params: objectSchema({ id }, ['id']) } }, async (request, reply) => {
    const auth = await security.authenticate(request, reply); if (!auth) return
    return await store.listRecipeVersions(auth.user.id, (request.params as { id: string }).id) ?? notFound(request, reply)
  })
  app.get('/api/v1/life/recipes/:id/calculation', {
    schema: { params: objectSchema({ id }, ['id']), querystring: objectSchema({ mode: { type: 'string', enum: ['latest', 'pinned'] }, versionId: id, asOf: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }, ['mode', 'asOf']) },
  }, async (request, reply) => {
    const auth = await security.authenticate(request, reply); if (!auth) return
    const query = request.query as { mode: 'latest' | 'pinned'; versionId?: string; asOf: string }
    return await store.calculateStoredRecipe(auth.user.id, (request.params as { id: string }).id, query) ?? notFound(request, reply)
  })
  app.post('/api/v1/life/recipes/:id/impact-preview', {
    schema: { params: objectSchema({ id }, ['id']), body: objectSchema({ entityVersion: { type: 'integer', minimum: 1 }, ...recipeFields }, ['entityVersion', 'name', 'servings', 'components', 'steps']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply); if (!auth) return
    return await store.previewRecipeImpact(auth.user.id, (request.params as { id: string }).id, request.body as UpdateRecipeInput) ?? notFound(request, reply)
  })
  app.patch('/api/v1/life/recipes/:id', {
    schema: { params: objectSchema({ id }, ['id']), body: objectSchema({ entityVersion: { type: 'integer', minimum: 1 }, ...recipeFields }, ['entityVersion', 'name', 'servings', 'components', 'steps']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply); if (!auth) return
    return await store.updateRecipe(auth.user.id, (request.params as { id: string }).id, request.body as UpdateRecipeInput) ?? notFound(request, reply)
  })
  app.delete('/api/v1/life/recipes/:id', {
    schema: { params: objectSchema({ id }, ['id']), body: objectSchema({ entityVersion: { type: 'integer', minimum: 1 } }, ['entityVersion']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply); if (!auth) return
    const removed = await store.deleteRecipe(auth.user.id, (request.params as { id: string }).id, (request.body as { entityVersion: number }).entityVersion)
    return removed ? reply.code(204).send() : notFound(request, reply)
  })
  app.get('/api/v1/life/trash/recipes', async (request, reply) => {
    const auth = await security.authenticate(request, reply); if (!auth) return
    return store.listDeletedRecipes(auth.user.id)
  })
  app.post('/api/v1/life/trash/recipes/:id/restore', {
    schema: { params: objectSchema({ id }, ['id']), body: objectSchema({ entityVersion: { type: 'integer', minimum: 1 } }, ['entityVersion']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply); if (!auth) return
    return await store.restoreRecipe(auth.user.id, (request.params as { id: string }).id, (request.body as { entityVersion: number }).entityVersion) ?? notFound(request, reply)
  })
  app.get('/api/v1/life/recipes/:id', { schema: { params: objectSchema({ id }, ['id']) } }, async (request, reply) => {
    const auth = await security.authenticate(request, reply); if (!auth) return
    return await store.getRecipe(auth.user.id, (request.params as { id: string }).id) ?? notFound(request, reply)
  })

  app.post('/api/v1/life/cooking-sessions', {
    schema: { body: objectSchema({ recipeId: id, recipeVersionId: id, plannedServings: positive, note: text(0, 4_000) }, ['recipeId', 'plannedServings']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply); if (!auth) return
    const key = idempotencyKey(request, reply); if (!key) return
    return reply.code(201).send(await store.createCookingSession(auth.user.id, request.body as { recipeId: string; recipeVersionId?: string; plannedServings: number; note?: string }, key))
  })
  app.get('/api/v1/life/cooking-sessions/:id', { schema: { params: objectSchema({ id }, ['id']) } }, async (request, reply) => {
    const auth = await security.authenticate(request, reply); if (!auth) return
    return await store.getCookingSession(auth.user.id, (request.params as { id: string }).id) ?? notFound(request, reply)
  })
  app.patch('/api/v1/life/cooking-sessions/:id', {
    schema: { params: objectSchema({ id }, ['id']), body: objectSchema(cookingProgressFields, ['entityVersion', 'currentStepIndex', 'completedStepIds', 'actualIngredients', 'timers']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply); if (!auth) return
    return await store.updateCookingSession(auth.user.id, (request.params as { id: string }).id, request.body as UpdateCookingSessionInput) ?? notFound(request, reply)
  })
  app.post('/api/v1/life/cooking-sessions/:id/promote-note', {
    schema: { params: objectSchema({ id }, ['id']), body: objectSchema({ expectedRecipeVersion: { type: 'integer', minimum: 1 } }, ['expectedRecipeVersion']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply); if (!auth) return
    const key = idempotencyKey(request, reply); if (!key) return
    return await store.promoteCookingNote(auth.user.id, (request.params as { id: string }).id, (request.body as { expectedRecipeVersion: number }).expectedRecipeVersion, key)
      .then((value) => value ? reply.code(201).send(value) : notFound(request, reply))
  })
  app.post('/api/v1/life/cooking-sessions/:id/complete', {
    schema: { params: objectSchema({ id }, ['id']), body: objectSchema({ madeServings: positive, eatenServings: nonNegative, completedAt: text(1, 80) }, ['madeServings', 'eatenServings', 'completedAt']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply); if (!auth) return
    const key = idempotencyKey(request, reply); if (!key) return
    return await store.completeCookingSession(auth.user.id, (request.params as { id: string }).id, request.body as { madeServings: number; eatenServings: number; completedAt: string }, key)
      .then((value) => value ? reply.code(201).send(value) : notFound(request, reply))
  })
  app.get('/api/v1/life/prepared-food', async (request, reply) => {
    const auth = await security.authenticate(request, reply); if (!auth) return
    return store.listPreparedFood(auth.user.id)
  })
}
