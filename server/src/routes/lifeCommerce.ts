import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type {
  CreateBudgetInput,
  CreatePurchaseInput,
  CreateRefundInput,
  CreateShoppingItemInput,
  CreateShoppingSuggestionInput,
  UpsertInventoryPolicyInput,
} from '../domain/life/commerce.js'
import type { User } from '../domain/types.js'
import type { LifeStore } from '../store/lifeStore.js'

interface RouteAuth { user: User }
interface RouteSecurity {
  authenticate(request: FastifyRequest, reply: FastifyReply): Promise<RouteAuth | undefined>
  authorizeWrite(request: FastifyRequest, reply: FastifyReply): Promise<RouteAuth | undefined>
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, required })
const text = (minLength = 1, maxLength = 10_000) => ({ type: 'string', minLength, maxLength })
const id = text(1, 80)
const nullableId = { anyOf: [id, { type: 'null' }] }
const nullableDate = { anyOf: [{ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, { type: 'null' }] }
const amount = { type: 'integer', minimum: 0 }
const positive = { type: 'number', exclusiveMinimum: 0 }

function idempotencyKey(request: FastifyRequest, reply: FastifyReply) {
  const raw = Array.isArray(request.headers['idempotency-key']) ? request.headers['idempotency-key'][0] : request.headers['idempotency-key']
  if (typeof raw !== 'string' || !raw.trim()) {
    reply.code(400).send({ error: { code: 'IDEMPOTENCY_REQUIRED', message: 'Commerce writes require an idempotency key.', requestId: request.id } })
    return undefined
  }
  return raw.trim()
}

export function registerLifeCommerceRoutes(app: FastifyInstance, store: LifeStore, security: RouteSecurity) {
  app.get('/api/v1/life/inventory-policies', async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    return store.listInventoryPolicies(auth.user.id)
  })

  app.put('/api/v1/life/inventory-policies/:itemId', {
    schema: {
      params: objectSchema({ itemId: id }, ['itemId']),
      body: objectSchema({
        minimumStock: { type: 'number', minimum: 0 },
        packageQuantity: positive,
        unitId: id,
        version: { type: 'integer', minimum: 1 },
      }, ['minimumStock', 'packageQuantity', 'unitId']),
    },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const key = idempotencyKey(request, reply)
    if (!key) return
    const result = await store.upsertInventoryPolicy(
      auth.user.id,
      (request.params as { itemId: string }).itemId,
      request.body as UpsertInventoryPolicyInput,
      key,
    )
    return reply.code(result.created ? 201 : 200).send(result.policy)
  })

  app.post('/api/v1/life/shopping/recalculate', {
    schema: { body: objectSchema({ through: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }, ['through']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const key = idempotencyKey(request, reply)
    if (!key) return
    return store.recalculateShopping(auth.user.id, request.body as { through: string }, key)
  })

  app.get('/api/v1/life/shopping', async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    return store.listShopping(auth.user.id)
  })

  app.post('/api/v1/life/shopping/suggestions', {
    schema: { body: objectSchema({
      itemId: id,
      requiredQuantity: positive,
      unit: text(1, 80),
      packageQuantity: positive,
      reason: objectSchema({
        kind: { type: 'string', enum: ['planned_shortage', 'minimum_stock', 'expiring', 'manual'] },
        sourceType: { type: 'string', enum: ['day-plan', 'inventory-policy', 'inventory-batch', 'manual'] },
        sourceId: id,
        requiredOn: nullableDate,
      }, ['kind', 'sourceType', 'sourceId', 'requiredOn']),
    }, ['itemId', 'requiredQuantity', 'unit', 'packageQuantity', 'reason']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const key = idempotencyKey(request, reply)
    if (!key) return
    return reply.code(201).send(await store.createShoppingSuggestion(auth.user.id, request.body as CreateShoppingSuggestionInput, key))
  })

  app.post('/api/v1/life/shopping/items', {
    schema: { body: objectSchema({
      itemId: id, requestedQuantity: positive, unit: text(1, 80), neededOn: nullableDate,
      priority: { type: 'string', enum: ['low', 'normal', 'high'] }, storeGroup: text(0, 240),
    }, ['itemId', 'requestedQuantity', 'unit']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const key = idempotencyKey(request, reply)
    if (!key) return
    return reply.code(201).send(await store.createShoppingItem(auth.user.id, request.body as CreateShoppingItemInput, key))
  })

  app.post('/api/v1/life/purchases', {
    schema: { body: objectSchema({
      purchasedAt: text(1, 80), currency: text(3, 3), storeName: text(0, 240),
      items: { type: 'array', minItems: 1, maxItems: 500, items: objectSchema({
        shoppingItemId: nullableId, itemId: id, quantity: positive, unit: text(1, 80), amountMinor: amount,
        updateCurrentPrice: { type: 'boolean' }, expiresOn: nullableDate, locationId: nullableId,
      }, ['itemId', 'quantity', 'unit', 'amountMinor']) },
    }, ['purchasedAt', 'currency', 'items']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const key = idempotencyKey(request, reply)
    if (!key) return
    return reply.code(201).send(await store.createPurchase(auth.user.id, request.body as CreatePurchaseInput, key))
  })

  app.post('/api/v1/life/purchases/:id/refunds', {
    schema: {
      params: objectSchema({ id }, ['id']),
      body: objectSchema({
        refundedAt: text(1, 80), note: text(0, 4_000),
        items: { type: 'array', minItems: 1, maxItems: 500, items: objectSchema({
          purchaseItemId: id, quantity: positive, amountMinor: amount,
        }, ['purchaseItemId', 'quantity', 'amountMinor']) },
      }, ['refundedAt', 'items']),
    },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const key = idempotencyKey(request, reply)
    if (!key) return
    const result = await store.createRefund(auth.user.id, (request.params as { id: string }).id, request.body as CreateRefundInput, key)
    return result ? reply.code(201).send(result) : reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'The purchase was not found.', requestId: request.id } })
  })

  app.post('/api/v1/life/budgets', {
    schema: { body: objectSchema({
      name: text(1, 240),
      scope: {
        type: 'object', additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['all-life', 'item', 'category', 'custom'] },
          itemIds: { type: 'array', maxItems: 500, uniqueItems: true, items: id },
          categoryIds: { type: 'array', maxItems: 500, uniqueItems: true, items: id },
        },
        required: ['kind'],
        allOf: [
          { if: { properties: { kind: { const: 'item' } }, required: ['kind'] }, then: { required: ['itemIds'], properties: { itemIds: { type: 'array', minItems: 1 } } } },
          { if: { properties: { kind: { const: 'category' } }, required: ['kind'] }, then: { required: ['categoryIds'], properties: { categoryIds: { type: 'array', minItems: 1 } } } },
          { if: { properties: { kind: { const: 'custom' } }, required: ['kind'] }, then: {
            required: ['itemIds', 'categoryIds'],
            anyOf: [{ properties: { itemIds: { type: 'array', minItems: 1 } } }, { properties: { categoryIds: { type: 'array', minItems: 1 } } }],
          } },
        ],
      },
      period: objectSchema({
        kind: { type: 'string', enum: ['weekly', 'monthly', 'custom'] },
        startsOn: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        endsOn: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      }, ['kind', 'startsOn', 'endsOn']),
      limitMinor: amount,
      thresholds: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'number', exclusiveMinimum: 0 } },
      rolloverMinor: amount,
    }, ['name', 'scope', 'period', 'limitMinor', 'thresholds']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const key = idempotencyKey(request, reply)
    if (!key) return
    return reply.code(201).send(await store.createBudget(auth.user.id, request.body as CreateBudgetInput, key))
  })

  app.get('/api/v1/life/budgets', {
    schema: { querystring: objectSchema({ asOf: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }, ['asOf']) },
  }, async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    return store.listBudgetSummaries(auth.user.id, (request.query as { asOf: string }).asOf)
  })

  app.get('/api/v1/life/analytics', {
    schema: { querystring: objectSchema({
      from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    }, ['from', 'to']) },
  }, async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    const query = request.query as { from: string; to: string }
    return store.getLifeAnalytics(auth.user.id, query.from, query.to)
  })
}
