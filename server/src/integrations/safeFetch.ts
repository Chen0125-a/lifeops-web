import { readFile } from 'node:fs/promises'
import https from 'node:https'
import { Readable } from 'node:stream'

import {
  IntegrationRequestError,
  type IntegrationConfig,
  type SafeIntegrationFetchOptions,
} from './types.js'

const RAW_QUERY_KEYS = new Set(['body', 'dsl', 'path', 'promql', 'query', 'source', 'uri', 'url'])

function requestError(code: string): IntegrationRequestError {
  return new IntegrationRequestError(code)
}

function resolveTarget(baseUrl: string, requestPath: string): URL {
  if (
    !requestPath.startsWith('/')
    || requestPath.startsWith('//')
    || requestPath.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(requestPath)
  ) {
    throw requestError('INTEGRATION_PATH_REJECTED')
  }

  let base: URL
  let target: URL
  try {
    base = new URL(baseUrl)
    target = new URL(requestPath, base)
  } catch {
    throw requestError('INTEGRATION_PATH_REJECTED')
  }
  if (
    !['http:', 'https:'].includes(base.protocol)
    || base.username
    || base.password
    || target.origin !== base.origin
    || target.username
    || target.password
  ) {
    throw requestError('INTEGRATION_PATH_REJECTED')
  }
  return target
}

function applyQuery(
  target: URL,
  query: SafeIntegrationFetchOptions['query'],
  trustedQuery: SafeIntegrationFetchOptions['trustedQuery'],
) {
  for (const [key, value] of Object.entries(query ?? {})) {
    if (RAW_QUERY_KEYS.has(key.toLowerCase())) throw requestError('RAW_QUERY_REJECTED')
    if (value !== undefined && value !== null) target.searchParams.set(key, String(value))
  }
  for (const [key, value] of Object.entries(trustedQuery ?? {})) {
    if (value !== undefined && value !== null) target.searchParams.set(key, String(value))
  }
}

interface ResolvedIntegrationAuth {
  bearerToken?: string
  basic?: { username: string; password: string }
  ca?: string
}

async function resolveAuth(config: IntegrationConfig): Promise<ResolvedIntegrationAuth> {
  let bearerToken = config.auth.bearerToken
  if (config.auth.bearerTokenFile) {
    bearerToken = (await readFile(config.auth.bearerTokenFile, 'utf8')).trim()
    if (!bearerToken || bearerToken.length > 16 * 1024) throw requestError('INTEGRATION_AUTH_REJECTED')
  }
  let ca: string | undefined
  if (config.auth.caFile) {
    ca = await readFile(config.auth.caFile, 'utf8')
    if (!ca.trim() || ca.length > 1024 * 1024) throw requestError('INTEGRATION_CA_REJECTED')
  }
  return { bearerToken, basic: config.auth.basic, ca }
}

function authHeaders(auth: ResolvedIntegrationAuth, hasJsonBody: boolean): Headers {
  const headers = new Headers({ accept: 'application/json' })
  if (hasJsonBody) headers.set('content-type', 'application/json')
  if (auth.basic) {
    const encoded = Buffer.from(`${auth.basic.username}:${auth.basic.password}`, 'utf8').toString('base64')
    headers.set('authorization', `Basic ${encoded}`)
  }
  if (auth.bearerToken) headers.set('authorization', `Bearer ${auth.bearerToken}`)
  return headers
}

function responseHeaders(source: import('node:http').IncomingHttpHeaders): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) value.forEach((entry) => headers.append(key, entry))
    else if (value !== undefined) headers.set(key, value)
  }
  return headers
}

function httpsFetchWithCa(
  target: URL,
  init: { method: 'GET' | 'POST'; headers: Headers; body?: string; signal: AbortSignal },
  ca: string,
): Promise<Response> {
  if (target.protocol !== 'https:') return Promise.reject(requestError('INTEGRATION_CA_REJECTED'))
  return new Promise((resolve, reject) => {
    const request = https.request(target, {
      method: init.method,
      headers: Object.fromEntries(init.headers.entries()),
      ca,
      signal: init.signal,
    }, (response) => {
      const status = response.statusCode ?? 502
      resolve(new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, {
        status,
        statusText: response.statusMessage,
        headers: responseHeaders(response.headers),
      }))
    })
    request.once('error', reject)
    if (init.body !== undefined) request.write(init.body)
    request.end()
  })
}

async function readBoundedBody(response: Response, maxResponseBytes: number): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > maxResponseBytes) {
      await reader.cancel().catch(() => undefined)
      throw requestError('INTEGRATION_RESPONSE_TOO_LARGE')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

export async function safeIntegrationFetch<T>(
  config: IntegrationConfig,
  requestPath: string,
  options: SafeIntegrationFetchOptions = {},
): Promise<T> {
  if (!config.enabled) throw requestError('INTEGRATION_DISABLED')
  if (!config.baseUrl) throw requestError('INTEGRATION_NOT_CONFIGURED')

  const target = resolveTarget(config.baseUrl, requestPath)
  applyQuery(target, options.query, options.trustedQuery)
  const method = options.method ?? 'GET'
  if (method === 'GET' && options.jsonBody !== undefined) throw requestError('INTEGRATION_BODY_REJECTED')
  const requestBody = options.jsonBody === undefined ? undefined : JSON.stringify(options.jsonBody)

  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, config.timeoutMs)
  const abortFromCaller = () => controller.abort()
  options.signal?.addEventListener('abort', abortFromCaller, { once: true })
  if (options.signal?.aborted) controller.abort()

  try {
    const auth = await resolveAuth(config)
    const headers = authHeaders(auth, requestBody !== undefined)
    const response = auth.ca
      ? await httpsFetchWithCa(target, { method, headers, body: requestBody, signal: controller.signal }, auth.ca)
      : await fetch(target, {
        method,
        headers,
        body: requestBody,
        redirect: 'error',
        signal: controller.signal,
      })
    if (response.status >= 300 && response.status < 400) {
      throw requestError('INTEGRATION_REDIRECT_REJECTED')
    }
    if (!response.ok) throw requestError('INTEGRATION_UPSTREAM_ERROR')
    const contentType = response.headers.get('content-type') ?? ''
    if (!/(?:application\/json|[+/]json)(?:\s*;|\s*$)/i.test(contentType)) {
      throw requestError('INTEGRATION_RESPONSE_NOT_JSON')
    }
    const responseBody = await readBoundedBody(response, config.maxResponseBytes)
    try {
      return JSON.parse(responseBody) as T
    } catch {
      throw requestError('INTEGRATION_RESPONSE_INVALID_JSON')
    }
  } catch (error) {
    if (error instanceof IntegrationRequestError) throw error
    if (timedOut) throw requestError('INTEGRATION_TIMEOUT')
    if (controller.signal.aborted) throw requestError('INTEGRATION_ABORTED')
    throw requestError('INTEGRATION_UPSTREAM_ERROR')
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abortFromCaller)
  }
}
