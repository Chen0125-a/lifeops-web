import { describe, expect, it } from 'vitest'
import { sanitizeExternalError, sanitizeLabels, sanitizeLogEvent } from './redact.js'

describe('integration redaction', () => {
  it('removes authorization, cookie, password, token and secret label values', () => {
    expect(sanitizeLabels({
      method: 'GET',
      route: '/api/v1/platform/overview',
      authorization: 'Bearer authorization-value',
      Cookie: 'lifeops=cookie-value',
      'set-cookie': 'lifeops=set-cookie-value',
      password: 'password-value',
      accessToken: 'token-value',
      client_secret: 'secret-value',
    })).toEqual({
      method: 'GET',
      route: '/api/v1/platform/overview',
    })
  })

  it('recursively removes request bodies, nested sensitive headers and Kubernetes sensitive annotations', () => {
    const sanitized = sanitizeLogEvent({
      event: 'integration.request.failed',
      request: {
        method: 'GET',
        body: { query: 'private-query', password: 'body-password' },
        headers: {
          accept: 'application/json',
          authorization: 'Bearer nested-authorization',
          cookie: 'nested-cookie',
        },
      },
      kubernetes: {
        metadata: {
          name: 'lifeops-api',
          annotations: {
            team: 'platform',
            'kubectl.kubernetes.io/last-applied-configuration': '{"token":"annotation-token"}',
            'lifeops.example/token': 'annotation-secret',
          },
        },
      },
    })

    expect(sanitized).toEqual({
      event: 'integration.request.failed',
      request: {
        method: 'GET',
        headers: { accept: 'application/json' },
      },
      kubernetes: {
        metadata: {
          name: 'lifeops-api',
          annotations: { team: 'platform' },
        },
      },
    })
    expect(JSON.stringify(sanitized)).not.toMatch(
      /private-query|body-password|nested-authorization|nested-cookie|annotation-token|annotation-secret/,
    )
  })

  it('turns arbitrary upstream failures into a fixed safe error shape', () => {
    const upstream = Object.assign(
      new Error('401 from https://upstream.example/private?token=query-token: response-password'),
      {
        code: 'UPSTREAM_AUTH_FAILED',
        headers: { authorization: 'Bearer header-token' },
        response: { body: { password: 'response-password' } },
      },
    )

    const sanitized = sanitizeExternalError(upstream)
    expect(sanitized).toEqual({
      code: 'INTEGRATION_UPSTREAM_ERROR',
      message: 'External integration request failed',
    })
    expect(JSON.stringify(sanitized)).not.toMatch(
      /upstream\.example|query-token|response-password|header-token|UPSTREAM_AUTH_FAILED/,
    )
  })
})
