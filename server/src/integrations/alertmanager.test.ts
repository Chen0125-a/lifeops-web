import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IntegrationConfig } from './types.js'
import { fetchAlertSummary } from './alertmanager.js'

const config: IntegrationConfig = {
  enabled: true,
  baseUrl: 'https://alertmanager.example.test',
  timeoutMs: 500,
  maxResponseBytes: 256 * 1024,
  deepLinkUrl: 'https://alerts.example.test/#/alerts',
  auth: {},
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchAlertSummary', () => {
  it('separates firing and recently resolved alerts and uses only the configured deep link', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const active = new URL(String(input)).searchParams.get('active') !== 'false'
      const body = active ? [{
        fingerprint: 'firing-1',
        labels: { alertname: 'ApiUnavailable', severity: 'critical', namespace: 'lifeops' },
        annotations: { summary: 'API has no ready replicas', runbook_url: 'https://untrusted.example/runbook' },
        startsAt: '2026-08-22T00:00:00.000Z',
        endsAt: '0001-01-01T00:00:00.000Z',
        updatedAt: '2026-08-22T00:01:00.000Z',
        status: { state: 'active', silencedBy: [], inhibitedBy: [] },
        receivers: [{ name: 'default' }],
        generatorURL: 'https://untrusted.example/graph',
      }] : [{
        fingerprint: 'resolved-1',
        labels: { alertname: 'HighLatency', severity: 'warning', namespace: 'lifeops' },
        annotations: { summary: 'Latency recovered' },
        startsAt: '2026-08-21T23:00:00.000Z',
        endsAt: '2026-08-22T00:05:00.000Z',
        updatedAt: '2026-08-22T00:05:00.000Z',
        status: { state: 'resolved', silencedBy: [], inhibitedBy: [] },
        receivers: [{ name: 'default' }],
        generatorURL: 'https://untrusted.example/graph',
      }]
      return Promise.resolve(new Response(JSON.stringify(body), {
        status: 200, headers: { 'content-type': 'application/json' },
      }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchAlertSummary(config)

    expect(result.state).toBe('connected')
    expect(result.deepLinkUrl).toBe('https://alerts.example.test/#/alerts')
    expect(result.firing).toEqual([expect.objectContaining({ id: 'firing-1', name: 'ApiUnavailable', severity: 'critical' })])
    expect(result.resolved).toEqual([expect.objectContaining({ id: 'resolved-1', name: 'HighLatency', severity: 'warning' })])
    expect(JSON.stringify(result)).not.toContain('untrusted.example')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
