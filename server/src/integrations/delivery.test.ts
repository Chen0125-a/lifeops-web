import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IntegrationConfig } from './types.js'
import { fetchDeliverySummary } from './delivery.js'

const sourceConfig = (baseUrl: string, deepLinkUrl: string): IntegrationConfig => ({
  enabled: true,
  baseUrl,
  timeoutMs: 500,
  maxResponseBytes: 256 * 1024,
  deepLinkUrl,
  auth: {},
})

const github = sourceConfig('https://api.github.example.test', 'https://github.example.test/acme/lifeops/actions')
const argoCd = sourceConfig('https://argo.example.test', 'https://argo.example.test/applications/lifeops')
const webDigest = `sha256:${'a'.repeat(64)}`
const apiDigest = `sha256:${'b'.repeat(64)}`

const argoFixture = {
  metadata: { name: 'lifeops', namespace: 'argocd' },
  spec: { source: { repoURL: 'https://private.example/repo', targetRevision: 'main', path: 'deploy' } },
  status: {
    sync: { status: 'Synced', revision: '0123456789abcdef' },
    health: { status: 'Healthy', message: 'all resources healthy' },
    summary: { images: [
      `uhub.service.ucloud.cn/lifeops/lifeops-web:v1.2.3@${webDigest}`,
      `uhub.service.ucloud.cn/lifeops/lifeops-api:v1.2.3@${apiDigest}`,
    ] },
    history: [],
    resources: [],
  },
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchDeliverySummary', () => {
  it('normalizes GitHub/Argo state and parses immutable Web/API image tags and digests', async () => {
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input))
      const body = url.hostname.startsWith('api.github') ? {
        total_count: 1,
        workflow_runs: [{
          id: 101, run_number: 17, status: 'completed', conclusion: 'success', head_sha: '0123456789abcdef',
          html_url: 'https://untrusted.example/run/101', created_at: '2026-08-22T00:00:00Z', updated_at: '2026-08-22T00:05:00Z',
        }],
      } : argoFixture
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))
    }))

    const result = await fetchDeliverySummary({
      github: { config: github, repository: 'acme/lifeops' },
      argoCd: { config: argoCd, application: 'lifeops' },
    })

    expect(result.state).toBe('connected')
    expect(result.github).toEqual(expect.objectContaining({
      state: 'connected', deepLinkUrl: 'https://github.example.test/acme/lifeops/actions',
      latestRun: expect.objectContaining({ id: 101, status: 'completed', conclusion: 'success' }),
    }))
    expect(result.argoCd).toEqual(expect.objectContaining({
      state: 'connected', sync: 'Synced', health: 'Healthy', revision: '0123456789abcdef',
      deepLinkUrl: 'https://argo.example.test/applications/lifeops',
    }))
    expect(result.images).toEqual({
      web: { repository: 'uhub.service.ucloud.cn/lifeops/lifeops-web', tag: 'v1.2.3', digest: webDigest },
      api: { repository: 'uhub.service.ucloud.cn/lifeops/lifeops-api', tag: 'v1.2.3', digest: apiDigest },
    })
    expect(JSON.stringify(result)).not.toContain('untrusted.example')
    expect(JSON.stringify(result)).not.toContain('private.example')
  })

  it.each([
    ['OutOfSync', 'Healthy'],
    ['Synced', 'Degraded'],
  ])('preserves truthful Argo %s/%s states', async (sync, health) => {
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input))
      const body = url.hostname.startsWith('api.github')
        ? { total_count: 0, workflow_runs: [] }
        : { ...argoFixture, status: { ...argoFixture.status, sync: { status: sync, revision: 'revision' }, health: { status: health } } }
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))
    }))

    const result = await fetchDeliverySummary({
      github: { config: github, repository: 'acme/lifeops' },
      argoCd: { config: argoCd, application: 'lifeops' },
    })

    expect(result.argoCd).toEqual(expect.objectContaining({ sync, health }))
  })

  it('contains one source failure without discarding the healthy source', async () => {
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.hostname.startsWith('api.github')) {
        return Promise.resolve(new Response(JSON.stringify({ error: 'private upstream body' }), {
          status: 503, headers: { 'content-type': 'application/json' },
        }))
      }
      return Promise.resolve(new Response(JSON.stringify(argoFixture), {
        status: 200, headers: { 'content-type': 'application/json' },
      }))
    }))

    const result = await fetchDeliverySummary({
      github: { config: github, repository: 'acme/lifeops' },
      argoCd: { config: argoCd, application: 'lifeops' },
    })

    expect(result.state).toBe('degraded')
    expect(result.github).toEqual(expect.objectContaining({ state: 'degraded', latestRun: null }))
    expect(result.argoCd).toEqual(expect.objectContaining({ state: 'connected', sync: 'Synced', health: 'Healthy' }))
    expect(JSON.stringify(result)).not.toContain('private upstream body')
  })
})
