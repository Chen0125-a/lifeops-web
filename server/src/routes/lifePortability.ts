import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { User } from '../domain/types.js'
import type { ImportResolution } from '../store/lifeCommerceStore.js'
import type { LifeStore } from '../store/lifeStore.js'

interface RouteAuth { user: User }
interface RouteSecurity {
  authenticate(request: FastifyRequest, reply: FastifyReply): Promise<RouteAuth | undefined>
  authorizeWrite(request: FastifyRequest, reply: FastifyReply): Promise<RouteAuth | undefined>
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, required })
const text = (minLength = 1, maxLength = 10_000_000) => ({ type: 'string', minLength, maxLength })
const id = text(1, 80)

function idempotencyKey(request: FastifyRequest, reply: FastifyReply) {
  const raw = Array.isArray(request.headers['idempotency-key']) ? request.headers['idempotency-key'][0] : request.headers['idempotency-key']
  if (typeof raw !== 'string' || !raw.trim()) {
    reply.code(400).send({ error: { code: 'IDEMPOTENCY_REQUIRED', message: 'Portability writes require an idempotency key.', requestId: request.id } })
    return undefined
  }
  return raw.trim()
}

export function registerLifePortabilityRoutes(app: FastifyInstance, store: LifeStore, security: RouteSecurity) {
  app.post('/api/v1/life/exports', {
    schema: { body: objectSchema({
      format: { type: 'string', enum: ['json', 'zip'] }, includeAttachments: { type: 'boolean' },
    }, ['format', 'includeAttachments']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const key = idempotencyKey(request, reply)
    if (!key) return
    return reply.code(201).send(await store.createLifeExport(auth.user.id, request.body as { format: 'json' | 'zip'; includeAttachments: boolean }, key))
  })

  app.get('/api/v1/life/exports', async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    return store.listLifeExports(auth.user.id)
  })

  app.post('/api/v1/life/imports/preview', {
    schema: { body: objectSchema({
      formatVersion: { type: 'integer', minimum: 1 }, checksumSha256: { type: 'string', pattern: '^[A-Fa-f0-9]{64}$' },
      canonicalJson: text(2, 10_000_000), archiveBase64: text(4, 20_000_000), mode: { type: 'string', enum: ['merge', 'replace'] },
    }, ['formatVersion', 'checksumSha256', 'mode']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const key = idempotencyKey(request, reply)
    if (!key) return
    return reply.send(await store.previewLifeImport(auth.user.id, request.body as { formatVersion: number; checksumSha256: string; canonicalJson?: string; archiveBase64?: string; mode: 'merge' | 'replace' }, key))
  })

  app.post('/api/v1/life/imports/:id/apply', {
    schema: {
      params: objectSchema({ id }, ['id']),
      body: objectSchema({
        resolutions: { type: 'array', maxItems: 10_000, items: objectSchema({
          entityType: text(1, 80), entityId: id, resolution: { type: 'string', enum: ['keep-current', 'use-imported', 'duplicate'] },
        }, ['entityType', 'entityId', 'resolution']) },
      }, ['resolutions']),
    },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const key = idempotencyKey(request, reply)
    if (!key) return
    const result = await store.applyLifeImport(auth.user.id, (request.params as { id: string }).id, (request.body as { resolutions: ImportResolution[] }).resolutions, key)
    if (!result) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'The import preview was not found.', requestId: request.id } })
    if (result.status === 'rejected') {
      const details = {
        ...(result.restorePointExportId ? { restorePointExportId: result.restorePointExportId } : {}),
        appliedRows: result.appliedRows,
      }
      return reply.code(409).send({
        error: { code: result.code, message: result.message, requestId: request.id, details },
        ...(result.restorePointExportId ? { restorePointExportId: result.restorePointExportId } : {}),
        appliedRows: result.appliedRows,
      })
    }
    return reply.send(result)
  })
}
