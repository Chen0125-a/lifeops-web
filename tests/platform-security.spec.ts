import Fastify from '../server/node_modules/fastify/fastify.js'
import { expect, test } from '@playwright/test'
import type { IntegrationConfig } from '../server/src/integrations/types.js'
import { registerPlatformRoutes, type PlatformRouteAdapters } from '../server/src/routes/platform.js'

const tokenSentinel = 'configured-platform-token-sentinel'
const passwordSentinel = 'configured-platform-password-sentinel'
const cookieSentinel = 'configured-session-cookie-sentinel'

const enabled = (name: string): IntegrationConfig => ({
  enabled: true,
  baseUrl: `https://${name}.internal.example/`,
  timeoutMs: 3_000,
  maxResponseBytes: 256 * 1024,
  deepLinkUrl: `https://${name}.example/`,
  auth: { bearerToken: tokenSentinel, basic: { username: 'owner', password: passwordSentinel } },
})

function adapters(): PlatformRouteAdapters {
  return {
    kubernetes: async () => ({
      nodes: [], workloads: [], pods: { total: 0, ready: 0, pending: 0, restarts: 0 }, services: [], httpRoutes: [],
    }),
    metric: async (_config, key) => ({ key, unit: 'ratio', state: 'connected', series: [], deepLinkUrl: 'https://grafana.example/' }),
    alerts: async () => { throw new Error(`upstream included ${tokenSentinel}`) },
    logs: async () => ({ state: 'connected', total: 0, events: [], deepLinkUrl: 'https://kibana.example/' }),
    delivery: async () => ({
      state: 'connected', github: { state: 'connected', deepLinkUrl: 'https://github.example/', latestRun: null },
      argoCd: { state: 'connected', deepLinkUrl: 'https://argocd.example/', sync: 'Unknown', health: 'Unknown', revision: null, images: {} }, images: {},
    }),
  }
}

async function buildPlatformServer() {
  const app = Fastify()
  const config = enabled('platform')
  registerPlatformRoutes(app, {
    authenticate: async (request, reply) => {
      if (request.headers['x-test-auth'] !== 'owner') {
        reply.code(401).send({ error: { code: 'AUTH_REQUIRED' } })
        return undefined
      }
      return { user: { id: 'owner' } }
    },
  }, {
    integrations: { kubernetes: config, prometheus: config, alertmanager: config, elasticsearch: config, github: config, argoCd: config },
    adapters: adapters(),
    ping: async () => undefined,
    now: () => Date.parse('2026-08-23T03:30:00.000Z'),
  })
  await app.ready()
  return app
}

test('platform API rejects raw query surfaces, stays read-only and never serializes configured secrets', async () => {
  const app = await buildPlatformServer()
  try {
    const privateReads = [
      '/api/v1/platform/overview', '/api/v1/platform/kubernetes', '/api/v1/platform/metrics/availability',
      '/api/v1/platform/alerts', '/api/v1/platform/logs', '/api/v1/platform/delivery', '/api/v1/platform/technologies',
    ]
    for (const url of privateReads) expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401)

    const auth = { 'x-test-auth': 'owner', cookie: `lifeops_session=${cookieSentinel}` }
    expect((await app.inject({ method: 'GET', url: '/api/v1/platform/logs?query=raw-lucene', headers: auth })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: '/api/v1/platform/logs?url=https%3A%2F%2Fevil.example', headers: auth })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: '/api/v1/platform/metrics/sum%28rate%28http_requests_total%5B5m%5D%29%29', headers: auth })).statusCode).toBe(400)

    for (const [method, url] of [
      ['POST', '/api/v1/platform/kubernetes'],
      ['PATCH', '/api/v1/platform/delivery'],
      ['DELETE', '/api/v1/platform/kubernetes/pods/api-1'],
    ] as const) expect((await app.inject({ method, url, headers: auth })).statusCode).toBe(404)

    const overview = await app.inject({ method: 'GET', url: '/api/v1/platform/overview', headers: auth })
    expect(overview.statusCode).toBe(200)
    expect(overview.body).not.toContain(tokenSentinel)
    expect(overview.body).not.toContain(passwordSentinel)
    expect(overview.body).not.toContain(cookieSentinel)
    expect(overview.json<{ connections: Array<{ source: string; state: string }> }>().connections.find((item) => item.source === 'Alertmanager')?.state).toBe('degraded')
  } finally {
    await app.close()
  }
})

test('anonymous browser entry cannot render the private platform route', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.clear())
  await page.goto('/app/platform')
  await expect(page).toHaveURL('http://127.0.0.1:4193/')
  await expect(page.getByRole('heading', { name: '平台运行中心' })).toHaveCount(0)
})
