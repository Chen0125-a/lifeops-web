import { sanitizeLabels } from './redact.js'
import { safeIntegrationFetch } from './safeFetch.js'
import { IntegrationRequestError, type IntegrationConfig } from './types.js'

export type PlatformMetricKey =
  | 'availability'
  | 'request-rate'
  | 'error-rate'
  | 'p95-latency'
  | 'cpu'
  | 'memory'
  | 'storage'
  | 'restarts'
  | 'readiness'

const QUERIES: Record<PlatformMetricKey, string> = {
  availability: 'avg(up{job=~"lifeops-(web|api)"})',
  'request-rate': 'sum(rate(lifeops_http_requests_total[5m]))',
  'error-rate': 'sum(rate(lifeops_http_requests_total{status_class=~"4xx|5xx"}[5m])) / clamp_min(sum(rate(lifeops_http_requests_total[5m])), 1)',
  'p95-latency': 'histogram_quantile(0.95, sum by (le) (rate(lifeops_http_request_duration_seconds_bucket[5m])))',
  cpu: 'sum(rate(container_cpu_usage_seconds_total{namespace="lifeops"}[5m])) by (pod)',
  memory: 'sum(container_memory_working_set_bytes{namespace="lifeops"}) by (pod)',
  storage: 'sum(kubelet_volume_stats_used_bytes{namespace="lifeops"}) by (persistentvolumeclaim)',
  restarts: 'sum(kube_pod_container_status_restarts_total{namespace="lifeops"}) by (pod)',
  readiness: 'avg(kube_pod_status_ready{namespace="lifeops",condition="true"})',
}

const UNITS: Record<PlatformMetricKey, string> = {
  availability: 'ratio',
  'request-rate': 'requests/second',
  'error-rate': 'ratio',
  'p95-latency': 'seconds',
  cpu: 'cores',
  memory: 'bytes',
  storage: 'bytes',
  restarts: 'restarts',
  readiness: 'ratio',
}

type JsonRecord = Record<string, unknown>
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value)
  ? value as JsonRecord
  : {}

function sample(value: unknown): { timestamp: number; value: number } | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const timestamp = Number(value[0])
  const numeric = Number(value[1])
  return Number.isFinite(timestamp) && Number.isFinite(numeric) ? { timestamp, value: numeric } : null
}

export async function fetchPrometheusMetric(config: IntegrationConfig, key: PlatformMetricKey) {
  if (!Object.hasOwn(QUERIES, key)) throw new IntegrationRequestError('PLATFORM_FILTER_REJECTED')
  const response = await safeIntegrationFetch<JsonRecord>(config, '/api/v1/query', {
    trustedQuery: { query: QUERIES[key] },
  })
  const data = record(response.data)
  const result = Array.isArray(data.result) ? data.result.map(record) : []
  const resultType = data.resultType
  const series = result.map((row) => {
    const values = resultType === 'matrix' ? row.values : [row.value]
    return {
      labels: sanitizeLabels(record(row.metric)),
      points: (Array.isArray(values) ? values : []).map(sample).filter((point): point is NonNullable<typeof point> => point !== null),
    }
  }).filter((row) => row.points.length > 0)
  return {
    key,
    unit: UNITS[key],
    state: series.length > 0 ? 'connected' : 'unknown',
    deepLinkUrl: config.deepLinkUrl,
    series,
  }
}
