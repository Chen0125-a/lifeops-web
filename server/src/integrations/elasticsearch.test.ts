import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IntegrationConfig } from './types.js'
import { fetchLogSummary } from './elasticsearch.js'

const config: IntegrationConfig = {
  enabled: true,
  baseUrl: 'https://elasticsearch.example.test',
  timeoutMs: 500,
  maxResponseBytes: 512 * 1024,
  deepLinkUrl: 'https://kibana.example.test/app/discover',
  auth: {},
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchLogSummary', () => {
  it('uses a fixed bounded query, keeps filter text as data, caps events and redacts malformed external logs', async () => {
    const injectedNamespace = 'lifeops\"}],\"must\":[{\"match_all\":{}}]}'
    const hits = Array.from({ length: 105 }, (_, index) => ({
      _id: `event-${index}`,
      _index: 'lifeops-logs-2026.08.22',
      _score: null,
      _source: {
        '@timestamp': `2026-08-22T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
        message: `event ${index}`,
        'log.level': index % 2 ? 'info' : 'error',
        kubernetes: { namespace_name: 'lifeops', pod: { name: `api-${index % 2}` } },
        http: { request: { id: `request-${index}` }, body: { password: 'body-password' } },
        headers: { authorization: 'Bearer external-token', accept: 'application/json' },
      },
    }))
    hits.push({ _id: 'malformed', _index: 'lifeops-logs', _score: null, _source: null })

    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('POST')
      const query = JSON.parse(String(init?.body))
      expect(query.size).toBe(100)
      expect(query.sort).toEqual([{ '@timestamp': 'desc' }])
      expect(query.query.bool.filter).toContainEqual({ term: { 'kubernetes.namespace_name.keyword': injectedNamespace } })
      expect(query.query.bool.filter).toContainEqual({ term: { 'log.level.keyword': 'error' } })
      expect(query.query.bool).not.toHaveProperty('must')
      return Promise.resolve(new Response(JSON.stringify({
        took: 3,
        timed_out: false,
        _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
        hits: { total: { value: 106, relation: 'eq' }, max_score: null, hits },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchLogSummary(config, { namespace: injectedNamespace, level: 'error' })

    expect(result.total).toBe(106)
    expect(result.events).toHaveLength(100)
    expect(result.deepLinkUrl).toBe('https://kibana.example.test/app/discover')
    expect(result.events[0]).toEqual(expect.objectContaining({ id: 'event-0', level: 'error', message: 'event 0' }))
    expect(JSON.stringify(result)).not.toMatch(/body-password|external-token|authorization/)
  })
})
