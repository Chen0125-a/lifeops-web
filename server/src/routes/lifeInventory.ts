import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type {
  CreateInventoryTransactionInput,
  InventoryFilters,
  ReverseInventoryTransactionInput,
} from '../domain/life/inventory.js'
import type { User } from '../domain/types.js'
import type { LifeStore } from '../store/lifeStore.js'

interface RouteAuth { user: User }
interface LifeInventoryRouteSecurity {
  authenticate(request: FastifyRequest, reply: FastifyReply): Promise<RouteAuth | undefined>
  authorizeWrite(request: FastifyRequest, reply: FastifyReply): Promise<RouteAuth | undefined>
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object', additionalProperties: false, properties, required,
})
const text = (minLength = 1, maxLength = 10_000) => ({ type: 'string', minLength, maxLength })
const id = text(1, 80)
const nullableId = { anyOf: [id, { type: 'null' }] }
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
const nullableDate = { anyOf: [date, { type: 'null' }] }

function idempotencyKey(request: FastifyRequest, reply: FastifyReply) {
  const value = Array.isArray(request.headers['idempotency-key']) ? request.headers['idempotency-key'][0] : request.headers['idempotency-key']
  if (typeof value !== 'string' || !value.trim()) {
    reply.code(400).send({ error: { code: 'IDEMPOTENCY_REQUIRED', message: 'Inventory writes require an idempotency key.', requestId: request.id } })
    return undefined
  }
  return value.trim()
}

function notFound(request: FastifyRequest, reply: FastifyReply) {
  return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'The inventory transaction was not found.', requestId: request.id } })
}

export function registerLifeInventoryRoutes(app: FastifyInstance, store: LifeStore, security: LifeInventoryRouteSecurity) {
  app.get('/api/v1/life/inventory/balances', {
    schema: { querystring: objectSchema({ itemId: id }) },
  }, async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    return store.listInventoryBalances(auth.user.id, request.query as InventoryFilters)
  })

  app.get('/api/v1/life/inventory/transactions', {
    schema: { querystring: objectSchema({ itemId: id }) },
  }, async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    return store.listInventoryTransactions(auth.user.id, request.query as InventoryFilters)
  })

  app.post('/api/v1/life/inventory/transactions', {
    schema: {
      body: objectSchema({
        itemId: id,
        kind: { type: 'string', enum: ['purchase', 'consume', 'return', 'waste', 'adjustment'] },
        quantity: { type: 'number', not: { const: 0 } },
        unit: text(1, 80),
        occurredAt: text(1, 80),
        batch: objectSchema({
          purchasedOn: nullableDate,
          expiresOn: nullableDate,
          locationId: nullableId,
          actualUnitCostMinor: { anyOf: [{ type: 'number', minimum: 0 }, { type: 'null' }] },
        }),
        note: text(0, 4_000),
      }, ['itemId', 'kind', 'quantity', 'unit', 'occurredAt']),
    },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const key = idempotencyKey(request, reply)
    if (!key) return
    return reply.code(201).send(await store.createInventoryTransaction(
      auth.user.id,
      request.body as CreateInventoryTransactionInput,
      key,
    ))
  })

  app.get('/api/v1/life/inventory/forecasts', {
    schema: { querystring: objectSchema({ itemId: id }) },
  }, async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    return store.listInventoryForecasts(auth.user.id, request.query as InventoryFilters)
  })

  app.post('/api/v1/life/inventory/transactions/:id/reverse', {
    schema: {
      params: objectSchema({ id }, ['id']),
      body: objectSchema({ note: text(0, 4_000) }),
    },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const key = idempotencyKey(request, reply)
    if (!key) return
    return await store.reverseInventoryTransaction(
      auth.user.id,
      (request.params as { id: string }).id,
      request.body as ReverseInventoryTransactionInput,
      key,
    ).then((value) => value ? reply.code(201).send(value) : notFound(request, reply))
  })
}
