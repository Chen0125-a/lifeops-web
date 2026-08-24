import type { FastifyInstance, FastifyRequest } from 'fastify'
import { sanitizeLogEvent } from '../integrations/redact.js'

export interface StructuredLogEvent {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  service: 'lifeops-api'
  requestId: string
  method: string
  route: string
  statusCode: number
  durationMs: number
  errorCode?: string
}

export interface StructuredLogSink {
  write(event: StructuredLogEvent): void
}

function normalizeText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]+/gu, ' ').replace(/\s+/gu, ' ').trim()
}

function normalizeSanitizedValue(value: unknown): unknown {
  if (typeof value === 'string') return normalizeText(value)
  if (Array.isArray(value)) return value.map(normalizeSanitizedValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, normalizeSanitizedValue(nested)]))
}

export function sanitizeStructuredFields(value: unknown): unknown {
  return normalizeSanitizedValue(sanitizeLogEvent(value))
}

function safeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error) || typeof error.code !== 'string') return undefined
  const code = normalizeText(error.code)
  return /^[A-Z][A-Z0-9_]{0,79}$/u.test(code) ? code : undefined
}

export function registerStructuredLogger(app: FastifyInstance, sink: StructuredLogSink = {
  write: (event) => console.log(JSON.stringify(event)),
}): void {
  const started = new WeakMap<FastifyRequest, bigint>()
  const errorCodes = new WeakMap<FastifyRequest, string>()

  app.addHook('onRequest', async (request) => {
    started.set(request, process.hrtime.bigint())
  })

  app.addHook('onError', async (request, _reply, error) => {
    const code = safeErrorCode(error)
    if (code) errorCodes.set(request, code)
  })

  app.addHook('onResponse', async (request, reply) => {
    const start = started.get(request)
    if (start === undefined) return
    started.delete(request)
    const errorCode = errorCodes.get(request)
    errorCodes.delete(request)
    const statusCode = reply.statusCode
    const candidate: StructuredLogEvent = {
      timestamp: new Date().toISOString(),
      level: statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info',
      service: 'lifeops-api',
      requestId: request.id,
      method: request.method,
      route: request.routeOptions.url || 'unmatched',
      statusCode,
      durationMs: Math.max(0, Number(process.hrtime.bigint() - start) / 1_000_000),
      ...(errorCode ? { errorCode } : {}),
    }
    sink.write(sanitizeStructuredFields(candidate) as StructuredLogEvent)
  })
}
