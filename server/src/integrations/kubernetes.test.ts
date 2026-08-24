import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IntegrationConfig } from './types.js'
import { fetchKubernetesSummary } from './kubernetes.js'

const config: IntegrationConfig = {
  enabled: true,
  baseUrl: 'https://kubernetes.example.test',
  timeoutMs: 500,
  maxResponseBytes: 256 * 1024,
  deepLinkUrl: 'https://argo.example.test/applications/lifeops',
  auth: {},
}

const fixtures: Record<string, unknown> = {
  '/api/v1/nodes': {
    apiVersion: 'v1', kind: 'NodeList', metadata: {}, items: [
      { metadata: { name: 'worker-a' }, status: { conditions: [{ type: 'Ready', status: 'True', reason: 'KubeletReady', message: 'ready' }] } },
      { metadata: { name: 'worker-b' }, status: { conditions: [{ type: 'Ready', status: 'False', reason: 'KubeletNotReady', message: 'runtime unavailable' }] } },
    ],
  },
  '/apis/apps/v1/deployments': {
    apiVersion: 'apps/v1', kind: 'DeploymentList', metadata: {}, items: [
      { metadata: { namespace: 'lifeops', name: 'web' }, spec: { replicas: 2 }, status: { replicas: 2, availableReplicas: 2, readyReplicas: 2, updatedReplicas: 2 } },
      { metadata: { namespace: 'lifeops', name: 'api' }, spec: { replicas: 2 }, status: { replicas: 2, availableReplicas: 1, readyReplicas: 1, updatedReplicas: 2 } },
    ],
  },
  '/api/v1/pods': {
    apiVersion: 'v1', kind: 'PodList', metadata: {}, items: [
      { metadata: { namespace: 'lifeops', name: 'web-a' }, status: { phase: 'Running', containerStatuses: [{ name: 'web', ready: true, restartCount: 1 }] } },
      { metadata: { namespace: 'lifeops', name: 'api-a' }, status: { phase: 'Pending', containerStatuses: [{ name: 'api', ready: false, restartCount: 3 }] } },
    ],
  },
  '/api/v1/services': {
    apiVersion: 'v1', kind: 'ServiceList', metadata: {}, items: [
      { metadata: { namespace: 'lifeops', name: 'web' }, spec: { type: 'ClusterIP', clusterIP: '10.96.0.10', ports: [{ name: 'http', port: 80, protocol: 'TCP' }] }, status: { loadBalancer: {} } },
    ],
  },
  '/apis/gateway.networking.k8s.io/v1/httproutes': {
    apiVersion: 'gateway.networking.k8s.io/v1', kind: 'HTTPRouteList', metadata: {}, items: [
      { metadata: { namespace: 'lifeops', name: 'public' }, spec: { hostnames: ['lifeops.example.test'] }, status: { parents: [{ conditions: [{ type: 'Accepted', status: 'True' }, { type: 'ResolvedRefs', status: 'True' }] }] } },
    ],
  },
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchKubernetesSummary', () => {
  it('normalizes approved read-only resources and never requests secrets, logs, exec or mutations', async () => {
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      const fixture = fixtures[url.pathname]
      return Promise.resolve(new Response(JSON.stringify(fixture), {
        status: fixture ? 200 : 404,
        headers: { 'content-type': 'application/json' },
      }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const summary = await fetchKubernetesSummary(config)

    expect(summary.nodes).toEqual([
      { name: 'worker-a', ready: true, reason: 'KubeletReady', message: 'ready' },
      { name: 'worker-b', ready: false, reason: 'KubeletNotReady', message: 'runtime unavailable' },
    ])
    expect(summary.workloads).toEqual([
      { namespace: 'lifeops', name: 'web', desired: 2, available: 2, ready: 2, state: 'available' },
      { namespace: 'lifeops', name: 'api', desired: 2, available: 1, ready: 1, state: 'degraded' },
    ])
    expect(summary.pods).toEqual({ total: 2, ready: 1, pending: 1, restarts: 4 })
    expect(summary.services).toEqual([
      { namespace: 'lifeops', name: 'web', type: 'ClusterIP', clusterIP: '10.96.0.10', ports: [80] },
    ])
    expect(summary.httpRoutes).toEqual([
      { namespace: 'lifeops', name: 'public', hostnames: ['lifeops.example.test'], accepted: true, resolvedRefs: true },
    ])

    const calls = fetchMock.mock.calls.map(([input, init]) => ({ url: String(input), method: init?.method }))
    expect(calls).toHaveLength(5)
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
    expect(calls.map((call) => call.url).join('\n')).not.toMatch(/secret|\/log\b|\/exec\b/i)
  })
})
