import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  registerStructuredLogger,
  sanitizeStructuredFields,
  type StructuredLogEvent,
} from './structuredLogger.js'

describe('structured application logging', () => {
  let app: FastifyInstance
  let events: StructuredLogEvent[]

  beforeEach(async () => {
    events = []
    app = Fastify({ logger: false })
    registerStructuredLogger(app, { write: (event) => events.push(event) })
    app.get('/api/items/:id', async (request) => ({ requestId: request.id }))
    app.get('/api/failure/:id', async () => {
      throw Object.assign(new Error('private failure'), {
        code: 'UPSTREAM_FAILED',
        authorization: 'Bearer should-not-log',
        nested: { password: 'should-not-log', cookie: 'should-not-log' },
      })
    })
    await app.ready()
  })

  afterEach(async () => app.close())

  it('writes one bounded event for success and error requests with stable request IDs and normalized routes', async () => {
    const success = await app.inject({
      method: 'GET',
      url: '/api/items/private-id?account=owner@example.com',
      headers: { authorization: 'Bearer request-secret', cookie: 'lifeops=request-secret' },
    })
    await app.inject({ method: 'GET', url: '/api/failure/private-id?token=query-secret' })

    expect(events).toHaveLength(2)
    expect(events[0]).toEqual(expect.objectContaining({
      level: 'info', service: 'lifeops-api', requestId: success.json<{ requestId: string }>().requestId,
      method: 'GET', route: '/api/items/:id', statusCode: 200,
    }))
    expect(events[0].durationMs).toBeGreaterThanOrEqual(0)
    expect(events[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/u)
    expect(events[1]).toEqual(expect.objectContaining({
      level: 'error', service: 'lifeops-api', method: 'GET', route: '/api/failure/:id',
      statusCode: 500, errorCode: 'UPSTREAM_FAILED',
    }))
    expect(JSON.stringify(events)).not.toMatch(/private-id|owner@example\.com|query-secret|request-secret|should-not-log/u)
  })

  it('recursively redacts credential-like fields and removes multiline/control characters', () => {
    const sanitized = sanitizeStructuredFields({
      message: 'first\nsecond\u0000third',
      authorization: 'Bearer secret',
      nested: {
        safe: 'value\r\nnext',
        cookie: 'session=secret',
        password: 'secret',
        accessToken: 'secret',
      },
    })

    expect(sanitized).toEqual({ message: 'first second third', nested: { safe: 'value next' } })
    expect(JSON.stringify(sanitized)).not.toMatch(/Bearer|session=|secret|\r|\n|\u0000/u)
  })
})
