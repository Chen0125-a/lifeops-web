import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ConvertReviewActionInput, CreateReviewInput, ReviewFilters, UpdateReviewInput } from '../domain/reviews.js'
import type { User } from '../domain/types.js'
import type { LifeStore } from '../store/lifeStore.js'

interface RouteAuth { user: User }
interface ReviewsRouteSecurity {
  authenticate(request: FastifyRequest, reply: FastifyReply): Promise<RouteAuth | undefined>
  authorizeWrite(request: FastifyRequest, reply: FastifyReply): Promise<RouteAuth | undefined>
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, required })
const text = (minLength = 1, maxLength = 10_000) => ({ type: 'string', minLength, maxLength })
const id = text(1, 80)
const idParams = objectSchema({ id }, ['id'])
const actionParams = objectSchema({ id, actionId: id }, ['id', 'actionId'])
const version = { type: 'integer', minimum: 1 }
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
const period = objectSchema({ from: date, to: date }, ['from', 'to'])
const narrative = { type: 'array', maxItems: 100, items: text(1, 4_000) }
const action = objectSchema({ id, text: text(1, 1_000) }, ['text'])
const reviewFields = {
  type: { type: 'string', enum: ['weekly', 'monthly', 'custom'] },
  period,
  status: { type: 'string', enum: ['draft', 'archived'] },
  achievements: narrative,
  problems: narrative,
  causes: narrative,
  insights: narrative,
  nextChanges: narrative,
  actions: { type: 'array', maxItems: 100, items: action },
}

function idempotencyKey(request: FastifyRequest, reply: FastifyReply) {
  const value = Array.isArray(request.headers['idempotency-key']) ? request.headers['idempotency-key'][0] : request.headers['idempotency-key']
  if (typeof value !== 'string' || !value.trim()) {
    reply.code(400).send({ error: { code: 'IDEMPOTENCY_REQUIRED', message: '创建回顾需要幂等键', requestId: request.id } })
    return undefined
  }
  return value.trim()
}

function notFound(request: FastifyRequest, reply: FastifyReply, message = '找不到回顾') {
  return reply.code(404).send({ error: { code: 'NOT_FOUND', message, requestId: request.id } })
}

export function registerReviewsRoutes(app: FastifyInstance, store: LifeStore, security: ReviewsRouteSecurity) {
  app.get('/api/v1/reviews', {
    schema: { querystring: objectSchema({ includeArchived: { type: 'boolean' } }) },
  }, async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    return store.listReviews(auth.user.id, request.query as ReviewFilters)
  })

  app.post('/api/v1/reviews', {
    schema: { body: objectSchema(reviewFields, ['type', 'period']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const key = idempotencyKey(request, reply)
    if (!key) return
    return reply.code(201).send(await store.createReview(auth.user.id, request.body as CreateReviewInput, key))
  })

  app.get('/api/v1/reviews/:id', { schema: { params: idParams } }, async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    return await store.getReview(auth.user.id, (request.params as { id: string }).id) ?? notFound(request, reply)
  })

  app.patch('/api/v1/reviews/:id', {
    schema: { params: idParams, body: objectSchema({ ...reviewFields, version }, ['version']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    return await store.updateReview(auth.user.id, (request.params as { id: string }).id, request.body as UpdateReviewInput)
      ?? notFound(request, reply)
  })

  app.delete('/api/v1/reviews/:id', {
    schema: { params: idParams, body: objectSchema({ version }, ['version']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const removed = await store.deleteReview(auth.user.id, (request.params as { id: string }).id, (request.body as { version: number }).version)
    if (!removed) return notFound(request, reply)
    return reply.code(204).send()
  })

  app.post('/api/v1/reviews/:id/restore', {
    schema: { params: idParams, body: objectSchema({ version }, ['version']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    return await store.restoreReview(auth.user.id, (request.params as { id: string }).id, (request.body as { version: number }).version)
      ?? notFound(request, reply)
  })

  app.post('/api/v1/reviews/:id/refresh-evidence', {
    schema: { params: idParams, body: objectSchema({ version }, ['version']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    return await store.refreshReviewEvidence(auth.user.id, (request.params as { id: string }).id, (request.body as { version: number }).version)
      ?? notFound(request, reply)
  })

  app.post('/api/v1/reviews/:id/actions/:actionId/convert', {
    schema: {
      params: actionParams,
      body: objectSchema({ target: { type: 'string', enum: ['task', 'goal-update', 'knowledge', 'public-draft'] }, goalId: id }, ['target']),
    },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const key = idempotencyKey(request, reply)
    if (!key) return
    const params = request.params as { id: string; actionId: string }
    const result = await store.convertReviewAction(auth.user.id, params.id, params.actionId, request.body as ConvertReviewActionInput, key)
    if (!result) return notFound(request, reply, '找不到回顾行动')
    return reply.code(201).send(result)
  })
}
