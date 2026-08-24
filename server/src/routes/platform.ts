import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { fetchAlertSummary } from '../integrations/alertmanager.js'
import { TimedCache } from '../integrations/cache.js'
import { fetchDeliverySummary } from '../integrations/delivery.js'
import { fetchLogSummary, type LogFilters } from '../integrations/elasticsearch.js'
import { fetchKubernetesSummary } from '../integrations/kubernetes.js'
import { fetchPrometheusMetric, type PlatformMetricKey } from '../integrations/prometheus.js'
import type { IntegrationConfig, PlatformSourceState, PlatformSourceStatus } from '../integrations/types.js'

interface RouteAuth { user: { id: string } }
interface PlatformRouteSecurity {
  authenticate(request: FastifyRequest, reply: FastifyReply): Promise<RouteAuth | undefined>
}

export interface PlatformIntegrations {
  kubernetes: IntegrationConfig
  prometheus: IntegrationConfig
  alertmanager: IntegrationConfig
  elasticsearch: IntegrationConfig
  github: IntegrationConfig
  argoCd: IntegrationConfig
}

export interface PlatformRouteAdapters {
  kubernetes: typeof fetchKubernetesSummary
  metric: typeof fetchPrometheusMetric
  alerts: typeof fetchAlertSummary
  logs: typeof fetchLogSummary
  delivery: typeof fetchDeliverySummary
}

interface PlatformRouteOptions {
  integrations: PlatformIntegrations
  adapters?: PlatformRouteAdapters
  ping: () => Promise<unknown>
  now?: () => number
  cache?: TimedCache
}

interface SourceEnvelope<T> {
  source: PlatformSourceStatus
  cachedAt: string | null
  data: T | null
}

const metricKeys = [
  'availability', 'request-rate', 'error-rate', 'p95-latency', 'cpu', 'memory', 'storage', 'restarts', 'readiness',
] as const satisfies readonly PlatformMetricKey[]

const objectSchema = (properties: Record<string, unknown> = {}) => ({ type: 'object', additionalProperties: false, properties })
const filterText = { type: 'string', minLength: 1, maxLength: 256 }

const technologies = [
  ['React', 'Web interface', 'implemented'],
  ['TypeScript', 'Web and API contracts', 'implemented'],
  ['MySQL', 'Production application data', 'implemented'],
  ['Docker', 'Immutable application images', 'delivery-pending'],
  ['Kubernetes', 'User-operated application runtime', 'user-operated'],
  ['Helm', 'Application delivery package', 'delivery-pending'],
  ['GitHub Actions', 'Release mainline', 'configured-mainline'],
  ['Argo CD', 'Recommended user-operated GitOps consumer', 'user-operated'],
  ['Prometheus', 'Application and platform metrics', 'integration-optional'],
  ['Grafana', 'Metric deep links', 'integration-optional'],
  ['Alertmanager', 'Alert deep links', 'integration-optional'],
  ['Elasticsearch', 'Bounded log summaries', 'integration-optional'],
  ['Kibana', 'Log deep links', 'integration-optional'],
  ['Elastic Agent / Filebeat', 'Log collection', 'integration-optional'],
  ['Jenkins', 'Equivalent pipeline practice', 'later-learning-track'],
  ['UHub', 'Current image release target', 'current-image-mainline'],
  ['Harbor', 'Alternative image registry', 'optional'],
].map(([name, role, status]) => ({ name, role, status }))

function status(source: string, state: PlatformSourceState, checkedAt: string | null, latencyMs: number | null, message: string): PlatformSourceStatus {
  return { source, state, checkedAt, latencyMs, message }
}

function stateFromData(value: unknown): PlatformSourceState {
  if (value && typeof value === 'object' && 'state' in value) {
    const state = (value as { state?: unknown }).state
    if (['connected', 'degraded', 'disconnected', 'disabled', 'unknown'].includes(String(state))) return state as PlatformSourceState
  }
  return 'connected'
}

async function readSource<T>(
  cache: TimedCache,
  now: () => number,
  key: string,
  name: string,
  config: IntegrationConfig,
  loader: () => Promise<T>,
): Promise<SourceEnvelope<T>> {
  if (!config.enabled) return { source: status(name, 'disabled', null, null, '未连接'), cachedAt: null, data: null }
  try {
    const cached = await cache.get(key, async () => {
      const startedAt = now()
      const data = await loader()
      const cachedAt = new Date(now()).toISOString()
      return { data, cachedAt, latencyMs: Math.max(0, now() - startedAt) }
    })
    const state = stateFromData(cached.data)
    return {
      source: status(name, state, cached.cachedAt, cached.latencyMs, state === 'unknown' ? '未验证' : '已连接'),
      cachedAt: cached.cachedAt,
      data: cached.data,
    }
  } catch {
    const checkedAt = new Date(now()).toISOString()
    return { source: status(name, 'degraded', checkedAt, null, '来源暂时不可用'), cachedAt: checkedAt, data: null }
  }
}

export function registerPlatformRoutes(app: FastifyInstance, security: PlatformRouteSecurity, options: PlatformRouteOptions) {
  const adapters = options.adapters ?? {
    kubernetes: fetchKubernetesSummary,
    metric: fetchPrometheusMetric,
    alerts: fetchAlertSummary,
    logs: fetchLogSummary,
    delivery: fetchDeliverySummary,
  }
  const cache = options.cache ?? new TimedCache()
  const now = options.now ?? Date.now
  const auth = async (request: FastifyRequest, reply: FastifyReply) => Boolean(await security.authenticate(request, reply))
  const readKubernetes = () => readSource(cache, now, 'platform:kubernetes', 'Kubernetes', options.integrations.kubernetes, () => adapters.kubernetes(options.integrations.kubernetes))
  const readMetric = (key: PlatformMetricKey) => readSource(cache, now, `platform:metric:${key}`, 'Prometheus', options.integrations.prometheus, () => adapters.metric(options.integrations.prometheus, key))
  const readAlerts = () => readSource(cache, now, 'platform:alerts', 'Alertmanager', options.integrations.alertmanager, () => adapters.alerts(options.integrations.alertmanager))
  const readLogs = (filters: LogFilters = {}) => readSource(cache, now, `platform:logs:${JSON.stringify(filters)}`, 'Elasticsearch', options.integrations.elasticsearch, () => adapters.logs(options.integrations.elasticsearch, filters))
  const deliveryConfig: IntegrationConfig = {
    enabled: options.integrations.github.enabled || options.integrations.argoCd.enabled,
    baseUrl: null,
    timeoutMs: Math.max(options.integrations.github.timeoutMs, options.integrations.argoCd.timeoutMs),
    maxResponseBytes: Math.max(options.integrations.github.maxResponseBytes, options.integrations.argoCd.maxResponseBytes),
    deepLinkUrl: options.integrations.argoCd.deepLinkUrl,
    auth: {},
  }
  const readDelivery = () => readSource(cache, now, 'platform:delivery', 'Argo CD', deliveryConfig, () => adapters.delivery({
    github: { config: options.integrations.github, repository: 'lifeops/lifeops-web' },
    argoCd: { config: options.integrations.argoCd, application: 'lifeops-web' },
  }))

  app.get('/api/v1/platform/overview', async (request, reply) => {
    if (!await auth(request, reply)) return
    const localCheckedAt = new Date(now()).toISOString()
    const [database, kubernetes, monitoring, alerts, logs, delivery] = await Promise.all([
      options.ping().then(
        () => status('MySQL', 'connected', localCheckedAt, null, '已连接'),
        () => status('MySQL', 'degraded', localCheckedAt, null, '来源暂时不可用'),
      ),
      readKubernetes(), readMetric('availability'), readAlerts(), readLogs(), readDelivery(),
    ])
    return {
      connections: [
        status('Web', 'connected', localCheckedAt, null, '已连接'),
        status('API', 'connected', localCheckedAt, null, '已连接'),
        database,
        kubernetes.source,
        monitoring.source,
        alerts.source,
        logs.source,
        delivery.source,
      ],
      kubernetes,
      monitoring,
      alerts,
      logs,
      delivery,
    }
  })

  app.get('/api/v1/platform/kubernetes', async (request, reply) => {
    if (!await auth(request, reply)) return
    return readKubernetes()
  })
  app.get('/api/v1/platform/metrics/:key', {
    schema: { params: objectSchema({ key: { type: 'string', enum: metricKeys } }) },
  }, async (request, reply) => {
    if (!await auth(request, reply)) return
    return readMetric((request.params as { key: PlatformMetricKey }).key)
  })
  app.get('/api/v1/platform/alerts', async (request, reply) => {
    if (!await auth(request, reply)) return
    return readAlerts()
  })
  app.get('/api/v1/platform/logs', {
    schema: { querystring: objectSchema({ namespace: filterText, pod: filterText, level: filterText, requestId: filterText }) },
  }, async (request, reply) => {
    if (!await auth(request, reply)) return
    const rawQuery = new URL(request.raw.url ?? request.url, 'http://lifeops.local').searchParams
    const allowedFilters = new Set(['namespace', 'pod', 'level', 'requestId'])
    if ([...rawQuery.keys()].some((key) => !allowedFilters.has(key))) {
      return reply.code(400).send({ error: { code: 'PLATFORM_FILTER_REJECTED', message: '日志筛选字段不受支持', requestId: request.id } })
    }
    return readLogs(request.query as LogFilters)
  })
  app.get('/api/v1/platform/delivery', async (request, reply) => {
    if (!await auth(request, reply)) return
    return readDelivery()
  })
  app.get('/api/v1/platform/technologies', async (request, reply) => {
    if (!await auth(request, reply)) return
    return { technologies }
  })
}
