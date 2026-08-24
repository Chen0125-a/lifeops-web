import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Session, User, UserSettings } from '../domain/types.js'
import { assertPasswordPolicy, hashPassword, verifyPassword } from '../security/password.js'
import { DataTransferError, DataTransferService } from '../services/dataTransfer.js'
import type { LifeStore } from '../store/lifeStore.js'

interface RouteAuth { user: User; session: Session }
interface RouteSecurity {
  authenticate(request: FastifyRequest, reply: FastifyReply): Promise<RouteAuth | undefined>
  authorizeWrite(request: FastifyRequest, reply: FastifyReply): Promise<RouteAuth | undefined>
}

export interface SafeConnectionState {
  id: string
  label: string
  state: 'connected' | 'degraded' | 'disabled' | 'local-only'
  detail: string
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, required })
const text = (minLength = 1, maxLength = 10_000_000) => ({ type: 'string', minLength, maxLength })
const checksum = { type: 'string', pattern: '^[A-Fa-f0-9]{64}$' }

function settingsPatchSchema() {
  return objectSchema({
    version: { type: 'integer', minimum: 1 },
    appearance: objectSchema({ theme: { type: 'string', enum: ['system', 'light', 'dark'] }, motion: { type: 'string', enum: ['system', 'reduce', 'full'] } }),
    locale: objectSchema({ locale: text(2, 35), timezone: text(1, 80), weekStartsOn: { type: 'integer', enum: [0, 1, 6] } }),
    defaults: objectSchema({ startRoute: text(1, 160), quickCreateType: text(1, 80) }),
    life: objectSchema({ lowStockDays: { type: 'integer', minimum: 0, maximum: 365 }, expiryWarningDays: { type: 'integer', minimum: 0, maximum: 3650 }, remindersEnabled: { type: 'boolean' } }),
    publicSite: objectSchema({ defaultVisibility: { type: 'string', enum: ['private', 'public'] }, rssEnabled: { type: 'boolean' } }),
  }, ['version'])
}

function sendKnownError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof DataTransferError) {
    return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, requestId: request.id } })
  }
  const record = error && typeof error === 'object' ? error as { code?: unknown; statusCode?: unknown; message?: unknown } : undefined
  if (typeof record?.code === 'string' && Number.isInteger(record.statusCode)) {
    return reply.code(Number(record.statusCode)).send({ error: { code: record.code, message: String(record.message ?? '请求失败'), requestId: request.id } })
  }
  throw error
}

export function registerSettingsRoutes(
  app: FastifyInstance,
  store: LifeStore,
  security: RouteSecurity,
  options: { connections?: SafeConnectionState[] } = {},
) {
  const transfer = new DataTransferService(store)
  const connections = options.connections ?? [{ id: 'obsidian', label: 'Obsidian', state: 'local-only', detail: '浏览器授权' }]

  app.get('/api/v1/settings', async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    return { ...await store.getUserSettings(auth.user.id), connections }
  })

  app.patch('/api/v1/settings', { schema: { body: settingsPatchSchema() } }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    try {
      const saved = await store.updateUserSettings(auth.user.id, request.body as Partial<UserSettings> & { version: number })
      await store.appendSafeAuditEvent(auth.user.id, { action: 'settings.update', targetType: 'settings', metadata: { version: saved.version } })
      return { ...saved, connections }
    } catch (error) { return sendKnownError(error, request, reply) }
  })

  app.get('/api/v1/account/sessions', async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    return { sessions: await store.listUserSessions(auth.user.id, auth.session.id) }
  })

  app.post('/api/v1/account/sessions/:id/revoke', {
    schema: { params: objectSchema({ id: text(1, 80) }, ['id']), body: objectSchema({}) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const sessionId = (request.params as { id: string }).id
    if (sessionId === auth.session.id) {
      return reply.code(409).send({ error: { code: 'CURRENT_SESSION_REQUIRES_LOGOUT', message: '当前会话只能通过明确退出登录结束', requestId: request.id } })
    }
    const revoked = await store.revokeUserSession(auth.user.id, sessionId)
    if (!revoked) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '会话不存在', requestId: request.id } })
    await store.appendSafeAuditEvent(auth.user.id, { action: 'account.session.revoke', targetType: 'session', targetId: sessionId })
    return reply.code(204).send()
  })

  app.post('/api/v1/account/password', {
    schema: { body: objectSchema({ currentPassword: text(1, 512), newPassword: text(1, 512) }, ['currentPassword', 'newPassword']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const body = request.body as { currentPassword: string; newPassword: string }
    if (!await verifyPassword(body.currentPassword, auth.user.passwordHash)) {
      return reply.code(403).send({ error: { code: 'CURRENT_PASSWORD_INVALID', message: '当前密码不正确', requestId: request.id } })
    }
    try { assertPasswordPolicy(body.newPassword) } catch (error) {
      return reply.code(400).send({ error: { code: 'PASSWORD_POLICY', message: error instanceof Error ? error.message : '新密码不符合策略', requestId: request.id } })
    }
    await store.updateUserPassword(auth.user.id, await hashPassword(body.newPassword))
    await store.revokeOtherUserSessions(auth.user.id, auth.session.id)
    await store.appendSafeAuditEvent(auth.user.id, { action: 'account.password.change', targetType: 'account', targetId: auth.user.id, metadata: { otherSessionsRevoked: true } })
    return reply.code(204).send()
  })

  app.post('/api/v1/data/export', { schema: { body: objectSchema({}) } }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const result = await transfer.export(auth.user.id)
    await store.appendSafeAuditEvent(auth.user.id, { action: 'data.export', targetType: 'data-transfer', metadata: { counts: result.counts, checksumSha256: result.checksumSha256 } })
    return result
  })

  app.post('/api/v1/data/import/preview', {
    schema: { body: objectSchema({ canonicalJson: text(2, 20_000_000), checksumSha256: checksum, existingIds: { type: 'array', maxItems: 50_000, items: text(1, 120) } }, ['canonicalJson', 'checksumSha256']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    try {
      const result = await transfer.preview(auth.user.id, request.body as { canonicalJson: string; checksumSha256: string; existingIds?: string[] })
      await store.appendSafeAuditEvent(auth.user.id, { action: 'data.import.preview', targetType: 'data-transfer', metadata: { status: result.status, counts: result.counts, conflictCount: result.conflicts.length } })
      return result
    } catch (error) { return sendKnownError(error, request, reply) }
  })

  app.post('/api/v1/data/import/apply', {
    schema: { body: objectSchema({ previewChecksum: checksum, currentPassword: text(1, 512) }, ['previewChecksum', 'currentPassword']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    try {
      const body = request.body as { previewChecksum: string; currentPassword: string }
      const result = await transfer.apply(auth.user.id, body, (password) => verifyPassword(password, auth.user.passwordHash), async ({ counts, restorePoint }) => {
        await store.appendSafeAuditEvent(auth.user.id, {
          action: 'data.import.apply', targetType: 'data-transfer',
          metadata: { counts, previewChecksum: body.previewChecksum, restorePointId: restorePoint.id, restorePointChecksum: restorePoint.checksumSha256 },
        })
      })
      return result
    } catch (error) { return sendKnownError(error, request, reply) }
  })

  app.get('/api/v1/audit', {
    schema: { querystring: objectSchema({ limit: { type: 'integer', minimum: 1, maximum: 500 } }) },
  }, async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    const limit = Number((request.query as { limit?: number }).limit ?? 100)
    return { events: await store.listSafeAuditEvents(auth.user.id, limit) }
  })
}
