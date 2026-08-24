import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import multipart from '@fastify/multipart'
import { GoalsDomainError } from './domain/goals.js'
import { TasksDomainError } from './domain/tasks.js'
import { HabitsDomainError } from './domain/habits.js'
import { RecordsDomainError } from './domain/records.js'
import { ReviewsDomainError } from './domain/reviews.js'
import { KnowledgeDomainError } from './domain/knowledge.js'
import { PublishingDomainError } from './domain/publishing.js'
import { LifeCatalogDomainError } from './domain/life/catalog.js'
import { LifeInventoryDomainError } from './domain/life/inventory.js'
import { LifeRecipesDomainError } from './domain/life/recipes.js'
import { LifePlanningDomainError } from './domain/life/planning.js'
import { LifeCommerceDomainError } from './domain/life/commerce.js'
import { MAX_MEDIA_BYTES, MediaStorageError, type MediaStoragePort } from './media/storagePort.js'
import type { Session, SourceType, User } from './domain/types.js'
import { registerGoalsRoutes } from './routes/goals.js'
import { registerTasksRoutes } from './routes/tasks.js'
import { registerHabitsRoutes } from './routes/habits.js'
import { registerMediaRoutes } from './routes/media.js'
import { registerRecordsRoutes } from './routes/records.js'
import { registerReviewsRoutes } from './routes/reviews.js'
import { registerKnowledgeRoutes } from './routes/knowledge.js'
import { registerLifeCatalogRoutes } from './routes/lifeCatalog.js'
import { registerLifeInventoryRoutes } from './routes/lifeInventory.js'
import { registerLifeRecipeRoutes } from './routes/lifeRecipes.js'
import { registerLifePlanningRoutes } from './routes/lifePlanning.js'
import { registerLifeCommerceRoutes } from './routes/lifeCommerce.js'
import { registerLifePortabilityRoutes } from './routes/lifePortability.js'
import { registerPublicContentRoutes } from './routes/publicContent.js'
import { registerPublishingRoutes } from './routes/publishing.js'
import { verifyPassword } from './security/password.js'
import { createOpaqueToken, hashOpaqueToken, parseCookie, safeTokenEqual } from './security/session.js'
import type { LifeStore } from './store/lifeStore.js'
import { createAppMetrics, registerAppMetrics } from './observability/metrics.js'
import { registerStructuredLogger } from './observability/structuredLogger.js'
import { registerPlatformRoutes, type PlatformIntegrations } from './routes/platform.js'
import { registerSearchRoutes } from './routes/search.js'
import { registerSettingsRoutes, type SafeConnectionState } from './routes/settings.js'

export interface AppConfig {
  cookieName: string
  sessionTtlSeconds: number
  secureCookies: boolean
  allowedOrigins?: string[]
  logger?: boolean
  trustProxy?: boolean | string | string[] | number
  publicOrigin?: string
}

interface AuthContext { session: Session; user: User }

const DUMMY_PASSWORD_HASH = 'scrypt-v1$AAAAAAAAAAAAAAAAAAAAAA$7fl5B8zh90y3D3TwfIPn-kg2Me2VCrRCkw8KvGg3armbWu6dDdOowMblzSqjgn1JeZ87e60D9xNrZ1ouCZBxcg'
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_MAX_FAILURES = 8

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
})

const text = (minLength = 1, maxLength = 10_000) => ({ type: 'string', minLength, maxLength })
const stringArray = { type: 'array', maxItems: 50, items: text(1, 80) }

export function buildApp({ store, config, mediaStorage, integrations }: { store: LifeStore; config: AppConfig; mediaStorage?: MediaStoragePort; integrations?: PlatformIntegrations }): FastifyInstance {
  store.configureMediaStorage(mediaStorage)
  const app = Fastify({ logger: false, trustProxy: config.trustProxy ?? false, bodyLimit: 256 * 1024 })
  app.register(multipart, { limits: { fileSize: MAX_MEDIA_BYTES, files: 1 } })
  registerAppMetrics(app, createAppMetrics())
  if (config.logger) registerStructuredLogger(app)

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id)
    reply.header('x-content-type-options', 'nosniff')
    reply.header('referrer-policy', 'same-origin')
    if (/^\/api\/v1\/(?:auth|state|search|goals|projects|milestones|tasks|habits|records|reviews|knowledge|publishing|media|life|schedule-blocks|schedule)(?:\/|$)/.test(request.url)) reply.header('cache-control', 'no-store')
    return payload
  })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof GoalsDomainError || error instanceof TasksDomainError || error instanceof HabitsDomainError || error instanceof RecordsDomainError || error instanceof ReviewsDomainError || error instanceof KnowledgeDomainError || error instanceof PublishingDomainError || error instanceof LifeCatalogDomainError || error instanceof LifeInventoryDomainError || error instanceof LifeRecipesDomainError || error instanceof LifePlanningDomainError || error instanceof LifeCommerceDomainError) {
      return reply.code(error.status).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
          ...((error instanceof LifePlanningDomainError || error instanceof LifeCommerceDomainError) && error.details ? error.details : {}),
        },
      })
    }
    if (error instanceof MediaStorageError) {
      const status = error.code === 'MEDIA_TOO_LARGE' ? 413 : error.code === 'STORAGE_KEY_CONFLICT' ? 409 : 400
      return reply.code(status).send({ error: { code: error.code, message: error.message, requestId: request.id } })
    }
    if (error && typeof error === 'object' && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ error: { code: 'MEDIA_TOO_LARGE', message: '文件不能超过 10 MiB', requestId: request.id } })
    }
    const message = error instanceof Error ? error.message : '未知错误'
    const validation = typeof error === 'object' && error !== null && 'validation' in error
    const known = validation || /不能为空|找不到|已经存在|至少/.test(message)
    const statusCode = known ? 400 : 500
    if (!known) request.log.error(error)
    reply.code(statusCode).send({ error: { code: known ? 'INVALID_REQUEST' : 'INTERNAL_ERROR', message: known ? message : '服务暂时不可用', requestId: request.id } })
  })

  const cookieValue = (token: string, maxAge = config.sessionTtlSeconds) => [
    `${config.cookieName}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    config.secureCookies ? 'Secure' : '',
  ].filter(Boolean).join('; ')

  const authenticate = async (request: FastifyRequest, reply: FastifyReply): Promise<AuthContext | undefined> => {
    const token = parseCookie(request.headers.cookie, config.cookieName)
    if (!token) {
      reply.code(401).send({ error: { code: 'AUTH_REQUIRED', message: '请先登录', requestId: request.id } })
      return undefined
    }
    const session = await store.findSessionByTokenHash(hashOpaqueToken(token))
    if (!session || Date.parse(session.expiresAt) <= Date.now()) {
      if (session) await store.deleteSession(session.id)
      reply.header('set-cookie', cookieValue('', 0)).code(401).send({ error: { code: 'SESSION_EXPIRED', message: '会话已失效，请重新登录', requestId: request.id } })
      return undefined
    }
    const user = await store.findUserById(session.userId)
    if (!user) {
      await store.deleteSession(session.id)
      reply.code(401).send({ error: { code: 'AUTH_REQUIRED', message: '请重新登录', requestId: request.id } })
      return undefined
    }
    return { session, user }
  }

  const authorizeWrite = async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await authenticate(request, reply)
    if (!auth) return undefined
    const origin = request.headers.origin
    if (origin && config.allowedOrigins?.length && !config.allowedOrigins.includes(origin)) {
      reply.code(403).send({ error: { code: 'ORIGIN_REJECTED', message: '请求来源不受信任', requestId: request.id } })
      return undefined
    }
    const csrf = Array.isArray(request.headers['x-csrf-token']) ? request.headers['x-csrf-token'][0] : request.headers['x-csrf-token']
    if (!safeTokenEqual(csrf, auth.session.csrfToken)) {
      reply.code(403).send({ error: { code: 'CSRF_REJECTED', message: '安全令牌无效，请刷新后重试', requestId: request.id } })
      return undefined
    }
    return auth
  }

  app.get('/healthz', async () => ({ status: 'ok' }))
  app.get('/readyz', async (_request, reply) => {
    await store.ping()
    return reply.send({ status: 'ready' })
  })

  app.post('/api/v1/auth/login', {
    schema: { body: objectSchema({ account: text(1, 254), password: text(1, 512) }, ['account', 'password']) },
  }, async (request, reply) => {
    const body = request.body as { account: string; password: string }
    const account = body.account.trim().toLowerCase()
    const failureKey = hashOpaqueToken(`${request.ip}|${account}`)
    const now = Date.now()
    const current = await store.getLoginFailure(failureKey)
    const resetAt = current ? Date.parse(current.resetAt) : 0
    if (current && resetAt > now && current.count >= LOGIN_MAX_FAILURES) {
      reply.header('retry-after', Math.max(1, Math.ceil((resetAt - now) / 1000)))
      return reply.code(429).send({ error: { code: 'LOGIN_RATE_LIMITED', message: '登录尝试过多，请稍后再试', requestId: request.id } })
    }
    const user = await store.findUserByAccount(body.account)
    const valid = await verifyPassword(body.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH)
    if (!user || !valid) {
      await store.recordLoginFailure(failureKey, new Date(now).toISOString(), new Date(now + LOGIN_WINDOW_MS).toISOString())
      return reply.code(401).send({ error: { code: 'INVALID_CREDENTIALS', message: '账号或密码不正确', requestId: request.id } })
    }
    await store.clearLoginFailures(failureKey)
    const token = createOpaqueToken()
    const csrfToken = createOpaqueToken(24)
    await store.createSession({ userId: user.id, tokenHash: hashOpaqueToken(token), csrfToken, expiresAt: new Date(Date.now() + config.sessionTtlSeconds * 1000).toISOString() })
    reply.header('set-cookie', cookieValue(token))
    return { user: { id: user.id, account: user.account, displayName: user.displayName }, csrfToken }
  })

  app.get('/api/v1/auth/session', async (request, reply) => {
    const auth = await authenticate(request, reply)
    if (!auth) return
    return { user: { id: auth.user.id, account: auth.user.account, displayName: auth.user.displayName }, csrfToken: auth.session.csrfToken }
  })

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const auth = await authorizeWrite(request, reply)
    if (!auth) return
    await store.deleteSession(auth.session.id)
    reply.header('set-cookie', cookieValue('', 0)).code(204).send()
  })

  app.get('/api/v1/state', async (request, reply) => {
    const auth = await authenticate(request, reply)
    if (!auth) return
    return store.getState(auth.user.id)
  })

  registerGoalsRoutes(app, store, { authenticate, authorizeWrite })
  registerTasksRoutes(app, store, { authenticate, authorizeWrite })
  registerHabitsRoutes(app, store, { authenticate, authorizeWrite })
  registerRecordsRoutes(app, store, { authenticate, authorizeWrite })
  registerReviewsRoutes(app, store, { authenticate, authorizeWrite })
  registerKnowledgeRoutes(app, store, { authenticate, authorizeWrite })
  registerSearchRoutes(app, store, { authenticate })
  registerPublishingRoutes(app, store, { authenticate, authorizeWrite })
  registerLifeCatalogRoutes(app, store, { authenticate, authorizeWrite })
  registerLifeInventoryRoutes(app, store, { authenticate, authorizeWrite })
  registerLifeRecipeRoutes(app, store, { authenticate, authorizeWrite })
  registerLifePlanningRoutes(app, store, { authenticate, authorizeWrite })
  registerLifeCommerceRoutes(app, store, { authenticate, authorizeWrite })
  registerLifePortabilityRoutes(app, store, { authenticate, authorizeWrite })
  const configuredIntegrations = integrations ?? undefined
  const connectionLabels: Record<string, string> = {
    kubernetes: 'Kubernetes', prometheus: 'Prometheus', alertmanager: 'Alertmanager', elasticsearch: 'Elasticsearch', github: 'GitHub Actions', argo: 'Argo CD',
  }
  const safeConnections: SafeConnectionState[] = Object.entries(configuredIntegrations ?? {}).map(([id, value]) => ({
    id,
    label: connectionLabels[id] ?? id,
    state: value.enabled ? 'degraded' : 'disabled',
    detail: value.enabled ? '已配置；实时状态请在平台页确认' : '未配置',
  }))
  safeConnections.push({ id: 'obsidian', label: 'Obsidian', state: 'local-only', detail: '浏览器授权' })
  registerSettingsRoutes(app, store, { authenticate, authorizeWrite }, { connections: safeConnections })
  registerMediaRoutes(app, store, mediaStorage, { authenticate, authorizeWrite })
  const disabledIntegration = (): PlatformIntegrations['kubernetes'] => ({ enabled: false, baseUrl: null, timeoutMs: 3_000, maxResponseBytes: 256 * 1024, deepLinkUrl: null, auth: {} })
  registerPlatformRoutes(app, { authenticate }, {
    integrations: integrations ?? {
      kubernetes: disabledIntegration(), prometheus: disabledIntegration(), alertmanager: disabledIntegration(),
      elasticsearch: disabledIntegration(), github: disabledIntegration(), argoCd: disabledIntegration(),
    },
    ping: () => store.ping(),
  })

  app.post('/api/v1/plans', {
    schema: { body: objectSchema({ title: text(1, 240), scheduledFor: text(1, 40) }, ['title']) },
  }, async (request, reply) => {
    const auth = await authorizeWrite(request, reply)
    if (!auth) return
    const plan = await store.createPlan(auth.user.id, request.body as { title: string; scheduledFor?: string })
    return reply.code(201).send(plan)
  })

  app.post('/api/v1/plans/:id/complete', {
    schema: { params: objectSchema({ id: text(1, 80) }, ['id']) },
  }, async (request, reply) => {
    const auth = await authorizeWrite(request, reply)
    if (!auth) return
    const plan = await store.completePlan(auth.user.id, (request.params as { id: string }).id)
    return plan ?? reply.code(404).send({ error: { code: 'NOT_FOUND', message: '找不到计划', requestId: request.id } })
  })

  app.post('/api/v1/snapshots', {
    schema: { body: objectSchema({ sourceType: { type: 'string', enum: ['plan', 'record', 'review', 'knowledge'] }, sourceId: text(1, 80), title: text(1, 240), excerpt: text(1, 2_000) }, ['sourceType', 'sourceId', 'title', 'excerpt']) },
  }, async (request, reply) => {
    const auth = await authorizeWrite(request, reply)
    if (!auth) return
    const body = request.body as { sourceType: SourceType; sourceId: string; title: string; excerpt: string }
    return reply.code(201).send(await store.createSnapshot(auth.user.id, { ...body, slug: createOpaqueToken(18) }))
  })

  for (const action of ['publish', 'revoke'] as const) {
    app.post(`/api/v1/snapshots/:id/${action}`, {
      schema: { params: objectSchema({ id: text(1, 80) }, ['id']) },
    }, async (request, reply) => {
      const auth = await authorizeWrite(request, reply)
      if (!auth) return
      const id = (request.params as { id: string }).id
      const snapshot = action === 'publish' ? await store.publishSnapshot(auth.user.id, id) : await store.revokeSnapshot(auth.user.id, id)
      return snapshot ?? reply.code(404).send({ error: { code: 'NOT_FOUND', message: '找不到公开快照', requestId: request.id } })
    })
  }

  app.get('/api/v1/public/snapshots/:slug', {
    schema: { params: objectSchema({ slug: text(12, 120) }, ['slug']) },
  }, async (request, reply) => {
    const snapshot = await store.getPublicSnapshot((request.params as { slug: string }).slug)
    if (!snapshot) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '快照不存在或已撤回', requestId: request.id } })
    return { slug: snapshot.slug, title: snapshot.title, excerpt: snapshot.excerpt, publishedAt: snapshot.publishedAt }
  })

  registerPublicContentRoutes(app, store, config.publicOrigin)

  app.addHook('onClose', async () => store.close())
  return app
}
