import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IntegrationConfig } from '../integrations/types.js'
import { registerPlatformRoutes, type PlatformRouteAdapters } from './platform.js'

const disabled = (): IntegrationConfig => ({
  enabled: false,
  baseUrl: null,
  timeoutMs: 3_000,
  maxResponseBytes: 256 * 1024,
  deepLinkUrl: null,
  auth: {},
})

const enabled = (name: string): IntegrationConfig => ({
  enabled: true,
  baseUrl: `https://${name}.internal.example/`,
  timeoutMs: 3_000,
  maxResponseBytes: 256 * 1024,
  deepLinkUrl: `https://${name}.example/`,
  auth: { bearerToken: `${name}-private-token`, basic: { username: 'owner', password: `${name}-private-password` } },
})

const integrations = (connected = false) => ({
  kubernetes: connected ? enabled('kubernetes') : disabled(),
  prometheus: connected ? enabled('grafana') : disabled(),
  alertmanager: connected ? enabled('alertmanager') : disabled(),
  elasticsearch: connected ? enabled('kibana') : disabled(),
  github: connected ? enabled('github') : disabled(),
  argoCd: connected ? enabled('argocd') : disabled(),
})

const adapterFixtures = (): PlatformRouteAdapters => ({
  kubernetes: vi.fn().mockResolvedValue({
    nodes: [{ name: 'worker-1', ready: true, reason: '', message: '' }],
    workloads: [{ namespace: 'lifeops', name: 'api', desired: 2, ready: 2, available: 2, state: 'available' }],
    pods: { total: 4, ready: 4, pending: 0, restarts: 1 },
    services: [{ namespace: 'lifeops', name: 'api', type: 'ClusterIP', clusterIP: '10.0.0.2', ports: [8080] }],
    httpRoutes: [{ namespace: 'lifeops', name: 'web', hostnames: ['lifeops.example'], accepted: true, resolvedRefs: true }],
  }),
  metric: vi.fn().mockImplementation(async (_config, key) => ({
    key,
    unit: key === 'p95-latency' ? 'seconds' : 'ratio',
    state: 'connected',
    deepLinkUrl: 'https://grafana.example/',
    series: [{ labels: { service: 'api' }, points: [{ timestamp: 1_777_000_000, value: 0.998 }] }],
  })),
  alerts: vi.fn().mockResolvedValue({ state: 'connected', deepLinkUrl: 'https://alertmanager.example/', firing: [], resolved: [] }),
  logs: vi.fn().mockResolvedValue({ state: 'connected', deepLinkUrl: 'https://kibana.example/', total: 1, events: [{ id: 'event-1', message: 'bounded event' }] }),
  delivery: vi.fn().mockResolvedValue({
    state: 'connected',
    github: { state: 'connected', deepLinkUrl: 'https://github.example/', latestRun: { id: 7, status: 'completed', conclusion: 'success' } },
    argoCd: { state: 'connected', deepLinkUrl: 'https://argocd.example/', sync: 'Synced', health: 'Healthy', revision: 'abc123', images: {} },
    images: { web: { repository: 'registry/lifeops-web', tag: 'v1', digest: `sha256:${'a'.repeat(64)}` } },
  }),
})

describe('platform routes', () => {
  let app: FastifyInstance

  afterEach(async () => app.close())

  async function build(connected = false, adapters = adapterFixtures()) {
    app = Fastify()
    registerPlatformRoutes(app, {
      authenticate: async (request: FastifyRequest, reply: FastifyReply) => {
        if (request.headers['x-test-auth'] !== 'owner') {
          reply.code(401).send({ error: { code: 'AUTH_REQUIRED' } })
          return undefined
        }
        return { user: { id: 'owner' } }
      },
    }, {
      integrations: integrations(connected),
      adapters,
      ping: vi.fn().mockResolvedValue(undefined),
      now: () => Date.parse('2026-08-22T16:00:00.000Z'),
    })
    await app.ready()
    return { adapters, get: (url: string) => app.inject({ method: 'GET', url, headers: { 'x-test-auth': 'owner' } }) }
  }

  it('protects every private platform route', async () => {
    await build()
    for (const url of ['/api/v1/platform/overview', '/api/v1/platform/kubernetes', '/api/v1/platform/metrics/availability', '/api/v1/platform/alerts', '/api/v1/platform/logs', '/api/v1/platform/delivery', '/api/v1/platform/technologies']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401)
    }
  })

  it('returns honest disabled sources without fabricated operational values', async () => {
    const { get } = await build()
    const response = await get('/api/v1/platform/overview')
    expect(response.statusCode).toBe(200)
    const body = response.json<{ connections: Array<{ source: string; state: string }>; kubernetes: { data: unknown } }>()
    expect(body.connections).toHaveLength(8)
    expect(body.connections.filter((source) => source.state === 'disabled')).toHaveLength(5)
    expect(body.connections.find((source) => source.source === 'Web')?.state).toBe('connected')
    expect(body.connections.find((source) => source.source === 'API')?.state).toBe('connected')
    expect(body.connections.find((source) => source.source === 'MySQL')?.state).toBe('connected')
    expect(body.kubernetes.data).toBeNull()
    expect(response.body).not.toMatch(/private-(?:token|password)/u)
  })

  it('keeps partial source failures local and preserves configured deep links', async () => {
    const adapters = adapterFixtures()
    vi.mocked(adapters.alerts).mockRejectedValueOnce(new Error('upstream response with private-token'))
    const { get } = await build(true, adapters)
    const response = await get('/api/v1/platform/overview')
    expect(response.statusCode).toBe(200)
    const body = response.json<{ connections: Array<{ source: string; state: string; message: string }>; monitoring: { data: { deepLinkUrl: string } }; alerts: { data: unknown } }>()
    expect(body.connections.find((source) => source.source === 'Alertmanager')).toMatchObject({ state: 'degraded', message: '来源暂时不可用' })
    expect(body.connections.find((source) => source.source === 'Prometheus')?.state).toBe('connected')
    expect(body.monitoring.data.deepLinkUrl).toBe('https://grafana.example/')
    expect(body.alerts.data).toBeNull()
    expect(response.body).not.toContain('private-token')
  })

  it('allows only predefined metric and log filters', async () => {
    const { adapters, get } = await build(true)
    expect((await get('/api/v1/platform/metrics/arbitrary-promql')).statusCode).toBe(400)
    expect((await get('/api/v1/platform/logs?query=raw-search')).statusCode).toBe(400)
    const response = await get('/api/v1/platform/logs?namespace=lifeops&level=error&requestId=req-7')
    expect(response.statusCode).toBe(200)
    expect(adapters.logs).toHaveBeenLastCalledWith(expect.anything(), { namespace: 'lifeops', level: 'error', requestId: 'req-7' })
  })

  it('returns stable cache timestamps and coalesces repeated reads', async () => {
    const { adapters, get } = await build(true)
    const first = await get('/api/v1/platform/kubernetes')
    const second = await get('/api/v1/platform/kubernetes')
    expect(first.json()).toMatchObject({ cachedAt: '2026-08-22T16:00:00.000Z', source: { state: 'connected' } })
    expect(second.json<{ cachedAt: string }>().cachedAt).toBe(first.json<{ cachedAt: string }>().cachedAt)
    expect(adapters.kubernetes).toHaveBeenCalledOnce()
  })

  it('publishes the complete technology archive with delivery truth', async () => {
    const { get } = await build()
    const body = (await get('/api/v1/platform/technologies')).json<{ technologies: Array<{ name: string; status: string }> }>()
    expect(body.technologies.map((item) => item.name)).toEqual(expect.arrayContaining([
      'React', 'TypeScript', 'MySQL', 'Docker', 'Kubernetes', 'Helm', 'GitHub Actions', 'Argo CD',
      'Prometheus', 'Grafana', 'Alertmanager', 'Elasticsearch', 'Kibana', 'Elastic Agent / Filebeat', 'Jenkins', 'UHub', 'Harbor',
    ]))
    expect(body.technologies.find((item) => item.name === 'Jenkins')?.status).toBe('later-learning-track')
    expect(body.technologies.find((item) => item.name === 'UHub')?.status).toBe('current-image-mainline')
    expect(body.technologies.find((item) => item.name === 'Harbor')?.status).toBe('optional')
  })
})
