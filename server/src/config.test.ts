import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

const baseEnv = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  LIFEOPS_STORE: 'memory',
  LIFEOPS_ADMIN_ACCOUNT: 'owner',
  LIFEOPS_ADMIN_PASSWORD: 'a-strong-bootstrap-password',
  ...overrides,
})

describe('integration runtime configuration', () => {
  it('keeps every external integration disabled unless it is explicitly enabled', () => {
    const config = loadConfig(baseEnv())

    expect(Object.keys(config.integrations)).toEqual([
      'kubernetes',
      'prometheus',
      'alertmanager',
      'elasticsearch',
      'github',
      'argoCd',
    ])
    expect(Object.values(config.integrations)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          enabled: false,
          baseUrl: null,
          timeoutMs: 3_000,
          maxResponseBytes: 256 * 1024,
          deepLinkUrl: null,
        }),
      ]),
    )
    expect(Object.values(config.integrations).every((source) => source.enabled === false)).toBe(true)
  })

  it('requires a base URL when an integration is enabled', () => {
    expect(() => loadConfig(baseEnv({ LIFEOPS_PROMETHEUS_ENABLED: 'true' }))).toThrow(
      'LIFEOPS_PROMETHEUS_BASE_URL',
    )
  })

  it.each(['file:///var/run/prometheus.sock', 'ftp://metrics.example.test']) (
    'rejects a non-HTTP integration base URL: %s',
    (baseUrl) => {
      expect(() => loadConfig(baseEnv({
        LIFEOPS_PROMETHEUS_ENABLED: 'true',
        LIFEOPS_PROMETHEUS_BASE_URL: baseUrl,
      }))).toThrow('LIFEOPS_PROMETHEUS_BASE_URL')
    },
  )

  it('keeps credentials available to server code but out of serialized status configuration', () => {
    const token = 'prometheus-private-token'
    const source = loadConfig(baseEnv({
      LIFEOPS_PROMETHEUS_ENABLED: 'true',
      LIFEOPS_PROMETHEUS_BASE_URL: 'https://metrics.example.test',
      LIFEOPS_PROMETHEUS_BEARER_TOKEN: token,
    })).integrations.prometheus

    expect(source.auth.bearerToken).toBe(token)
    const serialized = JSON.stringify(source)
    expect(serialized).not.toContain(token)
    expect(JSON.parse(serialized)).not.toHaveProperty('auth')
  })

  it.each([
    ['timeout', 'LIFEOPS_PROMETHEUS_TIMEOUT_MS', '499'],
    ['timeout', 'LIFEOPS_PROMETHEUS_TIMEOUT_MS', '10001'],
    ['response limit', 'LIFEOPS_PROMETHEUS_MAX_RESPONSE_BYTES', String(64 * 1024 - 1)],
    ['response limit', 'LIFEOPS_PROMETHEUS_MAX_RESPONSE_BYTES', String(2 * 1024 * 1024 + 1)],
  ])('rejects an out-of-range %s', (_label, field, value) => {
    expect(() => loadConfig(baseEnv({
      LIFEOPS_PROMETHEUS_ENABLED: 'true',
      LIFEOPS_PROMETHEUS_BASE_URL: 'https://metrics.example.test',
      [field]: value,
    }))).toThrow(field)
  })

  it.each([
    ['500', String(64 * 1024)],
    ['10000', String(2 * 1024 * 1024)],
  ])('accepts timeout and response-limit boundary values %s/%s', (timeoutMs, maxResponseBytes) => {
    const source = loadConfig(baseEnv({
      LIFEOPS_PROMETHEUS_ENABLED: 'true',
      LIFEOPS_PROMETHEUS_BASE_URL: 'https://metrics.example.test',
      LIFEOPS_PROMETHEUS_TIMEOUT_MS: timeoutMs,
      LIFEOPS_PROMETHEUS_MAX_RESPONSE_BYTES: maxResponseBytes,
    })).integrations.prometheus

    expect(source.timeoutMs).toBe(Number(timeoutMs))
    expect(source.maxResponseBytes).toBe(Number(maxResponseBytes))
  })
})

describe('media storage runtime configuration', () => {
  it('defaults to private filesystem storage without adding credentials to the storage union', () => {
    const config = loadConfig(baseEnv({ LIFEOPS_MEDIA_ROOT: 'data/private-media' }))

    expect(config.mediaStorage).toEqual({ backend: 'filesystem', root: 'data/private-media' })
    expect(config.mediaStorage).not.toHaveProperty('credentials')
  })

  it('loads an explicit S3-compatible topology while credentials remain outside MediaStorageConfig', () => {
    const config = loadConfig(baseEnv({
      LIFEOPS_MEDIA_BACKEND: 's3',
      LIFEOPS_S3_ENDPOINT: 'https://objects.example.test',
      LIFEOPS_S3_REGION: 'us-east-1',
      LIFEOPS_S3_BUCKET: 'lifeops-media',
      LIFEOPS_S3_FORCE_PATH_STYLE: 'true',
      AWS_ACCESS_KEY_ID: 'private-key-id',
      AWS_SECRET_ACCESS_KEY: 'private-secret',
    }))

    expect(config.mediaStorage).toEqual({
      backend: 's3',
      endpoint: 'https://objects.example.test',
      region: 'us-east-1',
      bucket: 'lifeops-media',
      forcePathStyle: true,
    })
    expect(JSON.stringify(config.mediaStorage)).not.toContain('private-key-id')
    expect(JSON.stringify(config.mediaStorage)).not.toContain('private-secret')
  })

  it.each(['LIFEOPS_S3_ENDPOINT', 'LIFEOPS_S3_REGION', 'LIFEOPS_S3_BUCKET'])(
    'rejects S3 mode when %s is missing',
    (missingField) => {
      const env = baseEnv({
        LIFEOPS_MEDIA_BACKEND: 's3',
        LIFEOPS_S3_ENDPOINT: 'https://objects.example.test',
        LIFEOPS_S3_REGION: 'us-east-1',
        LIFEOPS_S3_BUCKET: 'lifeops-media',
      })
      delete env[missingField]

      expect(() => loadConfig(env)).toThrow(missingField)
    },
  )

  it('rejects an unknown media backend instead of falling back to filesystem storage', () => {
    expect(() => loadConfig(baseEnv({ LIFEOPS_MEDIA_BACKEND: 'automatic' }))).toThrow('LIFEOPS_MEDIA_BACKEND')
  })
})
