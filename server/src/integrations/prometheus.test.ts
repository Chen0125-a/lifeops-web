import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IntegrationConfig } from './types.js'
import { fetchPrometheusMetric, type PlatformMetricKey } from './prometheus.js'

const metricKeys: PlatformMetricKey[] = [
  'availability', 'request-rate', 'error-rate', 'p95-latency', 'cpu', 'memory', 'storage', 'restarts', 'readiness',
]

const config: IntegrationConfig = {
  enabled: true,
  baseUrl: 'https://prometheus.example.test',
  timeoutMs: 500,
  maxResponseBytes: 256 * 1024,
  deepLinkUrl: 'https://grafana.example.test/d/lifeops',
  auth: {},
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchPrometheusMetric', () => {
  it.each(metricKeys)('maps the allowlisted %s key to a server-owned query', async (key) => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input))
      expect(url.pathname).toBe('/api/v1/query')
      expect(url.searchParams.get('query')).toBeTruthy()
      return Promise.resolve(new Response(JSON.stringify({
        status: 'success',
        data: { resultType: 'vector', result: [{ metric: { service: 'lifeops' }, value: [1_777_000_000, '2.5'] }] },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchPrometheusMetric(config, key)

    expect(result.key).toBe(key)
    expect(result.state).toBe('connected')
    expect(result.deepLinkUrl).toBe('https://grafana.example.test/d/lifeops')
    expect(result.series[0]?.points).toEqual([{ timestamp: 1_777_000_000, value: 2.5 }])
  })

  it('normalizes matrix values and ignores non-numeric samples', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'success',
      data: {
        resultType: 'matrix',
        result: [{ metric: { pod: 'api-0' }, values: [[10, '0.12'], [20, 'NaN'], [30, '0.34']] }],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })))

    const result = await fetchPrometheusMetric(config, 'cpu')

    expect(result.series).toEqual([{ labels: { pod: 'api-0' }, points: [
      { timestamp: 10, value: 0.12 },
      { timestamp: 30, value: 0.34 },
    ] }])
  })

  it('returns an honest unknown result when the query has no series', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'success', data: { resultType: 'vector', result: [] },
    }), { status: 200, headers: { 'content-type': 'application/json' } })))

    await expect(fetchPrometheusMetric(config, 'readiness')).resolves.toEqual(expect.objectContaining({
      key: 'readiness', state: 'unknown', series: [],
    }))
  })

  it('rejects a non-allowlisted metric before a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchPrometheusMetric(config, 'raw-promql' as PlatformMetricKey)).rejects.toThrow(
      'PLATFORM_FILTER_REJECTED',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
