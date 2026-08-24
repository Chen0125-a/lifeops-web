import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { CreateRecordInput, RecordFilters, UpdateRecordInput } from '../domain/records.js'
import type { User } from '../domain/types.js'
import type { LifeStore } from '../store/lifeStore.js'

interface RouteAuth { user: User }
interface RecordsRouteSecurity {
  authenticate(request: FastifyRequest, reply: FastifyReply): Promise<RouteAuth | undefined>
  authorizeWrite(request: FastifyRequest, reply: FastifyReply): Promise<RouteAuth | undefined>
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, required })
const text = (minLength = 1, maxLength = 10_000) => ({ type: 'string', minLength, maxLength })
const idParams = objectSchema({ id: text(1, 80) }, ['id'])
const instant = text(1, 64)
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
const nullableId = { anyOf: [text(1, 80), { type: 'null' }] }
const link = objectSchema({ type: { type: 'string', enum: ['goal', 'project', 'task', 'habit'] }, id: text(1, 80) }, ['type', 'id'])
const recordFields = {
  planId: text(1, 80),
  title: text(1, 240),
  body: text(1, 200_000),
  occurredAt: instant,
  tags: { type: 'array', maxItems: 50, uniqueItems: true, items: text(1, 80) },
  pinned: { type: 'boolean' },
  archived: { type: 'boolean' },
  links: { type: 'array', maxItems: 50, items: link },
  mediaIds: { type: 'array', maxItems: 50, uniqueItems: true, items: text(1, 80) },
  coverMediaId: nullableId,
}

function idempotencyKey(request: FastifyRequest, reply: FastifyReply) {
  const value = Array.isArray(request.headers['idempotency-key']) ? request.headers['idempotency-key'][0] : request.headers['idempotency-key']
  if (typeof value !== 'string' || !value.trim()) {
    reply.code(400).send({ error: { code: 'IDEMPOTENCY_REQUIRED', message: '创建请求需要幂等键', requestId: request.id } })
    return undefined
  }
  return value.trim()
}

function notFound(request: FastifyRequest, reply: FastifyReply) {
  return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '找不到记录', requestId: request.id } })
}

export function registerRecordsRoutes(app: FastifyInstance, store: LifeStore, security: RecordsRouteSecurity) {
  app.get('/api/v1/records', {
    schema: { querystring: objectSchema({
      from: date, to: date, tag: text(1, 80), linkType: { type: 'string', enum: ['goal', 'project', 'task', 'habit'] },
      linkId: text(1, 80), q: text(1, 500), includeArchived: { type: 'boolean' },
    }) },
  }, async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    return store.listRecords(auth.user.id, request.query as RecordFilters)
  })

  app.post('/api/v1/records', {
    schema: { body: objectSchema(recordFields, ['title', 'body']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const key = idempotencyKey(request, reply)
    if (!key) return
    return reply.code(201).send(await store.createRecord(auth.user.id, request.body as CreateRecordInput, key))
  })

  app.get('/api/v1/records/:id', { schema: { params: idParams } }, async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    return await store.getRecord(auth.user.id, (request.params as { id: string }).id) ?? notFound(request, reply)
  })

  app.patch('/api/v1/records/:id', {
    schema: { params: idParams, body: objectSchema({ ...recordFields, version: { type: 'integer', minimum: 1 } }, ['version']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    return await store.updateRecord(auth.user.id, (request.params as { id: string }).id, request.body as UpdateRecordInput)
      ?? notFound(request, reply)
  })

  app.delete('/api/v1/records/:id', {
    schema: { params: idParams, body: objectSchema({ version: { type: 'integer', minimum: 1 } }, ['version']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const removed = await store.deleteRecord(auth.user.id, (request.params as { id: string }).id, (request.body as { version: number }).version)
    if (!removed) return notFound(request, reply)
    return reply.code(204).send()
  })

  app.post('/api/v1/records/:id/restore', {
    schema: { params: idParams, body: objectSchema({ version: { type: 'integer', minimum: 1 } }, ['version']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    return await store.restoreRecord(auth.user.id, (request.params as { id: string }).id, (request.body as { version: number }).version)
      ?? notFound(request, reply)
  })
}
