import { basename } from 'node:path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { MAX_MEDIA_BYTES, type MediaStoragePort } from '../media/storagePort.js'
import type { User } from '../domain/types.js'
import type { LifeStore } from '../store/lifeStore.js'

interface RouteAuth { user: User }
interface MediaRouteSecurity {
  authenticate(request: FastifyRequest, reply: FastifyReply): Promise<RouteAuth | undefined>
  authorizeWrite(request: FastifyRequest, reply: FastifyReply): Promise<RouteAuth | undefined>
}
const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, required })
const idParams = objectSchema({ id: { type: 'string', minLength: 1, maxLength: 80 } }, ['id'])

function idempotencyKey(request: FastifyRequest, reply: FastifyReply) {
  const value = Array.isArray(request.headers['idempotency-key']) ? request.headers['idempotency-key'][0] : request.headers['idempotency-key']
  if (typeof value !== 'string' || !value.trim()) {
    reply.code(400).send({ error: { code: 'IDEMPOTENCY_REQUIRED', message: '上传请求需要幂等键', requestId: request.id } })
    return undefined
  }
  return value.trim()
}

function publicAsset(asset: Awaited<ReturnType<LifeStore['getMediaAsset']>>) {
  if (!asset) return undefined
  const { storageKey: _storageKey, ...safe } = asset
  return safe
}

export function registerMediaRoutes(
  app: FastifyInstance,
  store: LifeStore,
  storage: MediaStoragePort | undefined,
  security: MediaRouteSecurity,
) {
  app.post('/api/v1/media', async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const key = idempotencyKey(request, reply)
    if (!key) return
    if (!storage) return reply.code(503).send({ error: { code: 'MEDIA_STORAGE_DISABLED', message: '媒体存储未配置', requestId: request.id } })
    const file = await request.file({ limits: { fileSize: MAX_MEDIA_BYTES, files: 1 } })
    if (!file || file.fieldname !== 'file') return reply.code(400).send({ error: { code: 'FILE_REQUIRED', message: '需要 file 字段', requestId: request.id } })
    let stored
    try {
      stored = await storage.put({ originalName: file.filename, mimeType: file.mimetype, bytes: await file.toBuffer() })
      const asset = await store.createMediaAsset(auth.user.id, {
        originalName: basename(file.filename.replace(/\\/g, '/')),
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        storageKey: stored.storageKey,
        checksum: stored.checksum,
      }, key)
      if (asset.storageKey !== stored.storageKey) await storage.remove(stored.storageKey)
      return reply.code(201).send(publicAsset(asset))
    } catch (error) {
      if (stored) await storage.remove(stored.storageKey).catch(() => undefined)
      throw error
    }
  })

  app.get('/api/v1/media/:id', { schema: { params: idParams } }, async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    const asset = await store.getMediaAsset(auth.user.id, (request.params as { id: string }).id)
    if (!asset || !storage) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '找不到媒体', requestId: request.id } })
    const bytes = await storage.read(asset.storageKey)
    if (!bytes) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '找不到媒体文件', requestId: request.id } })
    return reply.type(asset.mimeType).send(Buffer.from(bytes))
  })

  app.get('/api/v1/public/media/:id', { schema: { params: idParams } }, async (request, reply) => {
    const asset = await store.getPublicMediaAsset((request.params as { id: string }).id)
    if (!asset || !storage) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '找不到公开媒体', requestId: request.id } })
    const bytes = await storage.read(asset.storageKey)
    if (!bytes) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '找不到公开媒体文件', requestId: request.id } })
    return reply.type(asset.mimeType).send(Buffer.from(bytes))
  })
}
