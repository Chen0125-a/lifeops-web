import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type {
  CreateKnowledgeInput,
  KnowledgeFilters,
  KnowledgeSourceType,
  UpdateKnowledgeInput,
} from '../domain/knowledge.js'
import type { User } from '../domain/types.js'
import type { LifeStore } from '../store/lifeStore.js'

interface RouteAuth { user: User }
interface KnowledgeRouteSecurity {
  authenticate(request: FastifyRequest, reply: FastifyReply): Promise<RouteAuth | undefined>
  authorizeWrite(request: FastifyRequest, reply: FastifyReply): Promise<RouteAuth | undefined>
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, required })
const text = (minLength = 1, maxLength = 10_000) => ({ type: 'string', minLength, maxLength })
const id = text(1, 80)
const version = { type: 'integer', minimum: 1 }
const idParams = objectSchema({ id }, ['id'])
const stringArray = (maxItems = 100) => ({ type: 'array', maxItems, items: text(1, 120) })
const sourceLink = objectSchema({ type: { type: 'string', enum: ['record', 'review', 'goal', 'project'] }, id }, ['type', 'id'])
const nullableDate = { anyOf: [{ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, { type: 'null' }] }
const noteFields = {
  title: text(1, 240),
  body: text(1, 100_000),
  tags: stringArray(50),
  collectionIds: stringArray(50),
  sourceLinks: { type: 'array', maxItems: 40, items: sourceLink },
  relatedIds: stringArray(100),
  pinned: { type: 'boolean' },
  favorite: { type: 'boolean' },
  reviewOn: nullableDate,
}

function notFound(request: FastifyRequest, reply: FastifyReply, message = '找不到知识') {
  return reply.code(404).send({ error: { code: 'NOT_FOUND', message, requestId: request.id } })
}

export function registerKnowledgeRoutes(app: FastifyInstance, store: LifeStore, security: KnowledgeRouteSecurity) {
  app.get('/api/v1/knowledge', {
    schema: { querystring: objectSchema({
      q: text(0, 240), tag: text(1, 80), source: { type: 'string', enum: ['record', 'review', 'goal', 'project'] },
      collectionId: id, includeArchived: { type: 'boolean' }, includeDeleted: { type: 'boolean' },
    }) },
  }, async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    return store.listKnowledge(auth.user.id, request.query as KnowledgeFilters)
  })

  app.get('/api/v1/knowledge/resurface', async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    return store.resurfaceKnowledge(auth.user.id, new Date().toISOString())
  })

  app.get('/api/v1/knowledge/collections', async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    return store.listKnowledgeCollections(auth.user.id)
  })

  app.post('/api/v1/knowledge/collections', {
    schema: { body: objectSchema({ name: text(1, 120), color: text(1, 32), position: { type: 'integer', minimum: 0 } }, ['name', 'color']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    return reply.code(201).send(await store.createKnowledgeCollection(auth.user.id, request.body as { name: string; color: string; position?: number }))
  })

  app.patch('/api/v1/knowledge/collections/:id', {
    schema: { params: idParams, body: objectSchema({ name: text(1, 120), color: text(1, 32), position: { type: 'integer', minimum: 0 }, version }, ['version']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const collection = await store.updateKnowledgeCollection(auth.user.id, (request.params as { id: string }).id, request.body as { name?: string; color?: string; position?: number; version: number })
    return collection ?? notFound(request, reply, '找不到知识集合')
  })

  app.delete('/api/v1/knowledge/collections/:id', {
    schema: { params: idParams, body: objectSchema({ version }, ['version']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const removed = await store.deleteKnowledgeCollection(auth.user.id, (request.params as { id: string }).id, (request.body as { version: number }).version)
    return removed ? reply.code(204).send() : notFound(request, reply, '找不到知识集合')
  })

  app.post('/api/v1/knowledge', {
    schema: { body: objectSchema(noteFields, ['title', 'body']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    return reply.code(201).send(await store.createKnowledgeNote(auth.user.id, request.body as CreateKnowledgeInput))
  })

  app.get('/api/v1/knowledge/:id', { schema: { params: idParams } }, async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    return await store.getKnowledgeNote(auth.user.id, (request.params as { id: string }).id) ?? notFound(request, reply)
  })

  app.patch('/api/v1/knowledge/:id', {
    schema: { params: idParams, body: objectSchema({ ...noteFields, version }, ['version']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    return await store.updateKnowledgeNote(auth.user.id, (request.params as { id: string }).id, request.body as UpdateKnowledgeInput)
      ?? notFound(request, reply)
  })

  app.post('/api/v1/knowledge/:id/archive', {
    schema: { params: idParams, body: objectSchema({ version }, ['version']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    return await store.archiveKnowledgeNote(auth.user.id, (request.params as { id: string }).id, (request.body as { version: number }).version)
      ?? notFound(request, reply)
  })

  app.delete('/api/v1/knowledge/:id', {
    schema: { params: idParams, body: objectSchema({ version }, ['version']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const removed = await store.deleteKnowledgeNote(auth.user.id, (request.params as { id: string }).id, (request.body as { version: number }).version)
    return removed ? reply.code(204).send() : notFound(request, reply)
  })

  app.post('/api/v1/knowledge/:id/restore', {
    schema: { params: idParams, body: objectSchema({ version }, ['version']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    return await store.restoreKnowledgeNote(auth.user.id, (request.params as { id: string }).id, (request.body as { version: number }).version)
      ?? notFound(request, reply)
  })

  for (const method of ['POST', 'DELETE'] as const) {
    app.route({
      method,
      url: '/api/v1/knowledge/:id/relations',
      schema: { params: idParams, body: objectSchema({ relatedId: id, version }, ['relatedId', 'version']) },
      handler: async (request, reply) => {
        const auth = await security.authorizeWrite(request, reply)
        if (!auth) return
        const params = request.params as { id: string }
        const body = request.body as { relatedId: string; version: number }
        const note = method === 'POST'
          ? await store.addKnowledgeRelation(auth.user.id, params.id, body.relatedId, body.version)
          : await store.removeKnowledgeRelation(auth.user.id, params.id, body.relatedId, body.version)
        return note ?? notFound(request, reply)
      },
    })
  }
}
