import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  copyPublicSourceFields,
  PublishingDomainError,
  toPublicRevisionView,
  type CreatePublicDraftInput,
  type PublicSourceCopy,
  type PublicSourceType,
  type UpdatePublicDraftInput,
} from '../domain/publishing.js'
import type { User } from '../domain/types.js'
import type { LifeStore } from '../store/lifeStore.js'

interface RouteAuth { user: User }
interface PublishingRouteSecurity {
  authenticate(request: FastifyRequest, reply: FastifyReply): Promise<RouteAuth | undefined>
  authorizeWrite(request: FastifyRequest, reply: FastifyReply): Promise<RouteAuth | undefined>
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, required })
const text = (minLength = 1, maxLength = 10_000) => ({ type: 'string', minLength, maxLength })
const id = text(1, 80)
const version = { type: 'integer', minimum: 1 }
const idParams = objectSchema({ id }, ['id'])
const nullableCover = { anyOf: [text(1, 2_000), { type: 'null' }] }
const publicFields = {
  category: { type: 'string', enum: ['now', 'doing', 'learning', 'moments', 'archive'] },
  title: text(1, 240),
  excerpt: text(1, 2_000),
  body: text(1, 200_000),
  coverUrl: nullableCover,
  tags: { type: 'array', maxItems: 50, uniqueItems: true, items: text(1, 80) },
  slug: text(1, 160),
  featured: { type: 'boolean' },
  seo: objectSchema({ title: text(1, 240), description: text(1, 500) }),
}
const source = objectSchema({ type: { type: 'string', enum: ['plan', 'record', 'review', 'knowledge'] }, id }, ['type', 'id'])

function notFound(request: FastifyRequest, reply: FastifyReply, message = '找不到发布草稿') {
  return reply.code(404).send({ error: { code: 'NOT_FOUND', message, requestId: request.id } })
}

async function resolveSource(store: LifeStore, userId: string, requested: { type: PublicSourceType; id: string }) {
  let value: Record<string, unknown> | undefined
  let versionValue = 1
  if (requested.type === 'knowledge') {
    const note = await store.getKnowledgeNote(userId, requested.id)
    if (note && note.deletedAt == null) {
      value = { title: note.title, body: note.body, tags: note.tags }
      versionValue = note.version
    }
  } else if (requested.type === 'record') {
    const record = await store.getRecord(userId, requested.id)
    if (record && record.deletedAt == null) {
      value = { title: record.title, body: record.body, tags: record.tags }
      versionValue = record.version
    }
  } else if (requested.type === 'review') {
    const review = await store.getReview(userId, requested.id)
    if (review && review.deletedAt == null) {
      const sections = [
        ...review.achievements,
        ...review.problems,
        ...review.causes,
        ...review.insights,
        ...review.nextChanges,
      ]
      value = {
        title: `${review.period.from} 至 ${review.period.to} 回顾`,
        excerpt: review.insights[0] ?? review.achievements[0] ?? '公开回顾',
        body: sections.join('\n\n') || '公开回顾',
        tags: [review.type, 'review'],
      }
      versionValue = review.version
    }
  } else {
    const plan = (await store.getState(userId)).plans.find((item) => item.id === requested.id)
    if (plan) value = { title: plan.title, excerpt: plan.title, body: plan.title, tags: ['plan'] }
  }
  if (!value) throw new PublishingDomainError('SOURCE_NOT_FOUND', '找不到可发布来源', 404)
  return {
    fields: copyPublicSourceFields(value),
    source: { type: requested.type, id: requested.id, version: versionValue } satisfies PublicSourceCopy,
  }
}

export function registerPublishingRoutes(app: FastifyInstance, store: LifeStore, security: PublishingRouteSecurity): void {
  app.get('/api/v1/publishing/drafts', async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    return store.listPublicDrafts(auth.user.id)
  })

  app.get('/api/v1/publishing/drafts/:id', { schema: { params: idParams } }, async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    return await store.getPublicDraft(auth.user.id, (request.params as { id: string }).id) ?? notFound(request, reply)
  })

  app.post('/api/v1/publishing/drafts', {
    schema: { body: objectSchema({ ...publicFields, source }, ['category', 'slug']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const body = request.body as Partial<CreatePublicDraftInput> & { category: CreatePublicDraftInput['category']; slug: string; source?: { type: PublicSourceType; id: string } }
    let sourceCopy: PublicSourceCopy | null = null
    let inherited: ReturnType<typeof copyPublicSourceFields> | undefined
    if (body.source) {
      const resolved = await resolveSource(store, auth.user.id, body.source)
      sourceCopy = resolved.source
      inherited = resolved.fields
    }
    const value = {
      ...inherited,
      ...body,
      source: sourceCopy,
    } as CreatePublicDraftInput
    return reply.code(201).send(await store.createPublicDraft(auth.user.id, value))
  })

  app.patch('/api/v1/publishing/drafts/:id', {
    schema: { params: idParams, body: objectSchema({ ...publicFields, version }, ['version']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    return await store.updatePublicDraft(auth.user.id, (request.params as { id: string }).id, request.body as UpdatePublicDraftInput)
      ?? notFound(request, reply)
  })

  app.delete('/api/v1/publishing/drafts/:id', {
    schema: { params: idParams, body: objectSchema({ version }, ['version']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const removed = await store.deletePublicDraft(auth.user.id, (request.params as { id: string }).id, (request.body as { version: number }).version)
    return removed ? reply.code(204).send() : notFound(request, reply)
  })

  app.post('/api/v1/publishing/drafts/:id/preview', { schema: { params: idParams } }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const revision = await store.previewPublicDraft(auth.user.id, (request.params as { id: string }).id)
    return revision ? toPublicRevisionView(revision) : notFound(request, reply)
  })

  app.post('/api/v1/publishing/drafts/:id/publish', {
    schema: { params: idParams, body: objectSchema({ version }, ['version']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    return await store.publishPublicDraft(auth.user.id, (request.params as { id: string }).id, (request.body as { version: number }).version)
      ?? notFound(request, reply)
  })

  app.post('/api/v1/publishing/drafts/:id/schedule', {
    schema: { params: idParams, body: objectSchema({ version, scheduledAt: text(1, 64) }, ['version', 'scheduledAt']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const body = request.body as { version: number; scheduledAt: string }
    return await store.schedulePublicDraft(auth.user.id, (request.params as { id: string }).id, body.version, body.scheduledAt)
      ?? notFound(request, reply)
  })

  app.post('/api/v1/publishing/drafts/:id/revoke', {
    schema: { params: idParams, body: objectSchema({ version }, ['version']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    return await store.revokePublicDraft(auth.user.id, (request.params as { id: string }).id, (request.body as { version: number }).version)
      ?? notFound(request, reply)
  })

  app.get('/api/v1/publishing/drafts/:id/revisions', { schema: { params: idParams } }, async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    const draftId = (request.params as { id: string }).id
    if (!await store.getPublicDraft(auth.user.id, draftId)) return notFound(request, reply)
    return store.listPublicRevisions(auth.user.id, draftId)
  })

  app.get('/api/v1/publishing/drafts/:id/revisions/diff', {
    schema: { params: idParams, querystring: objectSchema({ from: version, to: version }, ['from', 'to']) },
  }, async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    const { from, to } = request.query as { from: number; to: number }
    return await store.diffPublicRevisionHistory(auth.user.id, (request.params as { id: string }).id, from, to)
      ?? notFound(request, reply, '找不到要比较的公开 revision')
  })
}
