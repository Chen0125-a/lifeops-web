import { sanitizeLogEvent } from './redact.js'
import { safeIntegrationFetch } from './safeFetch.js'
import { IntegrationRequestError, type IntegrationConfig } from './types.js'

export interface LogFilters {
  namespace?: string
  pod?: string
  level?: string
  requestId?: string
}

type JsonRecord = Record<string, unknown>
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value)
  ? value as JsonRecord
  : {}
const text = (value: unknown): string | null => typeof value === 'string' ? value.slice(0, 2_048) : null

const FILTER_FIELDS: Record<keyof LogFilters, string> = {
  namespace: 'kubernetes.namespace_name.keyword',
  pod: 'kubernetes.pod.name.keyword',
  level: 'log.level.keyword',
  requestId: 'http.request.id.keyword',
}

function nested(source: JsonRecord, ...keys: string[]): unknown {
  let value: unknown = source
  for (const key of keys) value = record(value)[key]
  return value
}

export async function fetchLogSummary(config: IntegrationConfig, filters: LogFilters = {}) {
  const unknownKeys = Object.keys(filters).filter((key) => !Object.hasOwn(FILTER_FIELDS, key))
  if (unknownKeys.length) throw new IntegrationRequestError('PLATFORM_FILTER_REJECTED')
  const filter = Object.entries(filters)
    .filter((entry): entry is [keyof LogFilters, string] => typeof entry[1] === 'string' && entry[1].length > 0)
    .map(([key, value]) => ({ term: { [FILTER_FIELDS[key]]: value.slice(0, 256) } }))
  const response = await safeIntegrationFetch<JsonRecord>(config, '/lifeops-logs-*/_search', {
    method: 'POST',
    jsonBody: {
      size: 100,
      sort: [{ '@timestamp': 'desc' }],
      query: { bool: { filter } },
    },
  })
  const hitsContainer = record(response.hits)
  const rawHits = Array.isArray(hitsContainer.hits) ? hitsContainer.hits.map(record) : []
  const events = rawHits.slice(0, 100).flatMap((hit) => {
    const sanitized = record(sanitizeLogEvent(hit._source))
    if (!Object.keys(sanitized).length) return []
    return [{
      id: text(hit._id) ?? '',
      timestamp: text(sanitized['@timestamp']),
      level: text(sanitized['log.level']) ?? text(nested(sanitized, 'log', 'level')) ?? 'unknown',
      message: text(sanitized.message) ?? '',
      namespace: text(nested(sanitized, 'kubernetes', 'namespace_name')),
      pod: text(nested(sanitized, 'kubernetes', 'pod', 'name')),
      requestId: text(nested(sanitized, 'http', 'request', 'id')),
    }]
  })
  const total = record(hitsContainer.total)
  return {
    state: 'connected',
    deepLinkUrl: config.deepLinkUrl,
    total: typeof total.value === 'number' ? total.value : events.length,
    events,
  }
}
