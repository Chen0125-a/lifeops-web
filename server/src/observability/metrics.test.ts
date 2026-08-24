import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAppMetrics, registerAppMetrics } from './metrics.js'

describe('application metrics', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    app = Fastify()
    registerAppMetrics(app, createAppMetrics())
    app.get('/api/items/:id', async () => ({ ok: true }))
    app.get('/api/failure', async (_request, reply) => reply.code(503).send({ ok: false }))
    app.get('/healthz', async () => ({ status: 'ok' }))
    app.get('/readyz', async () => ({ status: 'ready' }))
    await app.ready()
  })

  afterEach(async () => app.close())

  it('publishes process defaults and bounded HTTP metrics with Prometheus content type', async () => {
    await app.inject({ method: 'GET', url: '/api/items/private-item?account=owner@example.com' })
    await app.inject({ method: 'GET', url: '/api/failure' })
    const response = await app.inject({ method: 'GET', url: '/metrics' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/plain')
    expect(response.body).toContain('lifeops_process_cpu_user_seconds_total')
    expect(response.body).toContain('lifeops_http_requests_total')
    expect(response.body).toContain('lifeops_http_request_duration_seconds')
    expect(response.body).toContain('lifeops_http_active_requests{service="lifeops-api"} 0')
    expect(response.body).toContain('lifeops_build_info')
    expect(response.body).toContain('method="GET"')
    expect(response.body).toContain('service="lifeops-api"')
    expect(response.body).toContain('route="/api/items/:id"')
    expect(response.body).toContain('status_class="5xx"')
  })

  it('keeps health and readiness probes available without adding them to request-rate SLO metrics', async () => {
    await app.inject({ method: 'GET', url: '/healthz' })
    await app.inject({ method: 'GET', url: '/readyz' })
    const body = (await app.inject({ method: 'GET', url: '/metrics' })).body

    expect(body).not.toContain('route="/healthz"')
    expect(body).not.toContain('route="/readyz"')
  })

  it('never exposes account, literal URL, query or uncontrolled labels', async () => {
    await app.inject({ method: 'GET', url: '/api/items/private-item?account=owner@example.com&query=secret' })
    const body = (await app.inject({ method: 'GET', url: '/metrics' })).body

    expect(body).not.toContain('private-item')
    expect(body).not.toContain('owner@example.com')
    expect(body).not.toContain('query=secret')
    expect(body).not.toMatch(/\b(account|url|query|user_id)=/u)
  })
})
