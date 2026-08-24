import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { safeIntegrationFetch } from './safeFetch.js'
import type { IntegrationConfig } from './types.js'

const integrationConfig = (overrides: Partial<IntegrationConfig> = {}): IntegrationConfig => ({
  enabled: true,
  baseUrl: 'https://integrations.example.test/root/',
  timeoutMs: 500,
  maxResponseBytes: 64 * 1024,
  deepLinkUrl: null,
  auth: {},
  ...overrides,
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('safeIntegrationFetch', () => {
  it.each([
    ['absolute URL', 'https://evil.example/metrics'],
    ['scheme-relative alternate origin', '//evil.example/metrics'],
    ['userinfo URL', '//user:password@integrations.example.test/metrics'],
    ['lookalike host', '//integrations.example.test.evil.test/metrics'],
    ['alternate port', '//integrations.example.test:444/metrics'],
  ])('rejects %s injection before a network request', async (_label, requestPath) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(safeIntegrationFetch(integrationConfig(), requestPath)).rejects.toThrow(
      'INTEGRATION_PATH_REJECTED',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects raw upstream query languages before a network request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(safeIntegrationFetch(integrationConfig(), '/api/v1/query', {
      query: { query: 'sum(rate(http_requests_total[5m]))' },
    })).rejects.toThrow('RAW_QUERY_REJECTED')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses redirect error mode and rejects a redirect response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: 'https://evil.example/redirected' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(safeIntegrationFetch(integrationConfig(), '/api/status')).rejects.toThrow(
      'INTEGRATION_REDIRECT_REJECTED',
    )
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ redirect: 'error' }))
  })

  it('aborts an upstream request at the configured deadline', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    vi.stubGlobal('fetch', fetchMock)

    const pending = expect(safeIntegrationFetch(
      integrationConfig({ timeoutMs: 25 }),
      '/api/status',
    )).rejects.toThrow('INTEGRATION_TIMEOUT')
    await vi.advanceTimersByTimeAsync(25)
    await pending
  })

  it('counts response bytes before parsing JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ payload: 'x'.repeat(128) }), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(safeIntegrationFetch(
      integrationConfig({ maxResponseBytes: 32 }),
      '/api/status',
    )).rejects.toThrow('INTEGRATION_RESPONSE_TOO_LARGE')
  })

  it('rejects a successful response that is not JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('healthy', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(safeIntegrationFetch(integrationConfig(), '/api/status')).rejects.toThrow(
      'INTEGRATION_RESPONSE_NOT_JSON',
    )
  })

  it('returns parsed JSON for a same-origin relative path and bounded safe query', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ready' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(safeIntegrationFetch<{ status: string }>(integrationConfig(), '/api/status', {
      query: { view: 'availability', limit: 10 },
    })).resolves.toEqual({ status: 'ready' })
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://integrations.example.test/api/status?view=availability&limit=10',
    )
  })

  it('loads in-cluster bearer token and CA files into the HTTPS transport without serializing the token', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lifeops-integration-auth-'))
    const tokenPath = path.join(directory, 'service-account-token')
    const caPath = path.join(directory, 'service-account-ca.crt')
    const token = 'task-only-service-account-token'
    const ca = '-----BEGIN CERTIFICATE-----\ntask-only-ca\n-----END CERTIFICATE-----\n'
    await writeFile(tokenPath, token, 'utf8')
    await writeFile(caPath, ca, 'utf8')
    const requestSpy = vi.spyOn(https, 'request').mockImplementation((
      _url: string | URL,
      _options: https.RequestOptions,
      callback?: (response: import('node:http').IncomingMessage) => void,
    ) => {
      const request = new Writable({ write: (_chunk, _encoding, done) => done() })
      const response = new PassThrough() as PassThrough & import('node:http').IncomingMessage
      response.statusCode = 200
      response.statusMessage = 'OK'
      response.headers = { 'content-type': 'application/json' }
      queueMicrotask(() => {
        callback?.(response)
        response.end(JSON.stringify({ status: 'ready' }))
      })
      return request as unknown as import('node:http').ClientRequest
    })

    try {
      await expect(safeIntegrationFetch<{ status: string }>(integrationConfig({
        auth: { bearerTokenFile: tokenPath, caFile: caPath },
      }), '/api/status')).resolves.toEqual({ status: 'ready' })

      const requestOptions = requestSpy.mock.calls[0]?.[1] as https.RequestOptions
      expect(requestOptions.ca).toBe(ca)
      expect(new Headers(requestOptions.headers as HeadersInit).get('authorization')).toBe(`Bearer ${token}`)
      expect(JSON.stringify(integrationConfig({ auth: { bearerTokenFile: tokenPath, caFile: caPath } }))).not.toContain(token)
    } finally {
      requestSpy.mockRestore()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('never includes a file-backed service-account token in a transport error', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lifeops-integration-token-'))
    const tokenPath = path.join(directory, 'service-account-token')
    const token = 'file-backed-private-token'
    await writeFile(tokenPath, token, 'utf8')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(`upstream rejected ${token}`)))

    try {
      let thrown: unknown
      try {
        await safeIntegrationFetch(integrationConfig({ auth: { bearerTokenFile: tokenPath } }), '/api/status')
      } catch (error) {
        thrown = error
      }
      expect(thrown).toEqual(expect.objectContaining({ code: 'INTEGRATION_UPSTREAM_ERROR' }))
      expect(String(thrown)).not.toContain(token)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
