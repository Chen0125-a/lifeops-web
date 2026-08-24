import { sanitizeLabels } from './redact.js'
import { safeIntegrationFetch } from './safeFetch.js'
import type { IntegrationConfig } from './types.js'

type JsonRecord = Record<string, unknown>
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value)
  ? value as JsonRecord
  : {}

function normalizedAlert(value: unknown) {
  const alert = record(value)
  const labels = sanitizeLabels(record(alert.labels))
  const annotations = record(alert.annotations)
  return {
    id: typeof alert.fingerprint === 'string' ? alert.fingerprint : '',
    name: labels.alertname ?? 'Unknown alert',
    severity: labels.severity ?? 'unknown',
    namespace: labels.namespace ?? null,
    summary: typeof annotations.summary === 'string' ? annotations.summary.slice(0, 512) : '',
    startsAt: typeof alert.startsAt === 'string' ? alert.startsAt : null,
    endsAt: typeof alert.endsAt === 'string' ? alert.endsAt : null,
  }
}

export async function fetchAlertSummary(config: IntegrationConfig) {
  const [firing, resolved] = await Promise.all([
    safeIntegrationFetch<unknown[]>(config, '/api/v2/alerts', { query: { active: true, silenced: false, inhibited: false } }),
    safeIntegrationFetch<unknown[]>(config, '/api/v2/alerts', { query: { active: false, silenced: false, inhibited: false } }),
  ])
  return {
    state: 'connected',
    deepLinkUrl: config.deepLinkUrl,
    firing: firing.slice(0, 100).map(normalizedAlert),
    resolved: resolved.slice(0, 100).map(normalizedAlert),
  }
}
