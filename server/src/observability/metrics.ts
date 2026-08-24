import type { FastifyInstance, FastifyRequest } from 'fastify'
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client'

export interface AppMetrics {
  registry: Registry
  requests: Counter<'method' | 'route' | 'status_class' | 'service'>
  duration: Histogram<'method' | 'route' | 'status_class' | 'service'>
  active: Gauge<'service'>
  buildInfo: Gauge<'service'>
}

export function createAppMetrics(): AppMetrics {
  const registry = new Registry()
  collectDefaultMetrics({ register: registry, prefix: 'lifeops_' })
  const requests = new Counter({
    name: 'lifeops_http_requests_total',
    help: 'Completed LifeOps HTTP requests.',
    labelNames: ['method', 'route', 'status_class', 'service'],
    registers: [registry],
  })
  const duration = new Histogram({
    name: 'lifeops_http_request_duration_seconds',
    help: 'LifeOps HTTP request duration in seconds.',
    labelNames: ['method', 'route', 'status_class', 'service'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  })
  const active = new Gauge({
    name: 'lifeops_http_active_requests',
    help: 'Currently active LifeOps HTTP requests.',
    labelNames: ['service'],
    registers: [registry],
  })
  const buildInfo = new Gauge({
    name: 'lifeops_build_info',
    help: 'Static LifeOps API build identity.',
    labelNames: ['service'],
    registers: [registry],
  })
  active.set({ service: 'lifeops-api' }, 0)
  buildInfo.set({ service: 'lifeops-api' }, 1)
  return { registry, requests, duration, active, buildInfo }
}

export function registerAppMetrics(app: FastifyInstance, metrics: AppMetrics) {
  const started = new WeakMap<FastifyRequest, bigint>()

  app.addHook('onRequest', async (request) => {
    if (['/metrics', '/healthz', '/readyz'].includes(request.url.split('?', 1)[0])) return
    started.set(request, process.hrtime.bigint())
    metrics.active.inc({ service: 'lifeops-api' })
  })

  app.addHook('onResponse', async (request, reply) => {
    const start = started.get(request)
    if (start === undefined) return
    started.delete(request)
    metrics.active.dec({ service: 'lifeops-api' })
    const labels = {
      method: request.method,
      route: request.routeOptions.url || 'unmatched',
      status_class: `${Math.floor(reply.statusCode / 100)}xx`,
      service: 'lifeops-api',
    }
    metrics.requests.inc(labels)
    metrics.duration.observe(labels, Number(process.hrtime.bigint() - start) / 1_000_000_000)
  })

  app.get('/metrics', async (_request, reply) => {
    reply.header('content-type', metrics.registry.contentType)
    return metrics.registry.metrics()
  })
}
