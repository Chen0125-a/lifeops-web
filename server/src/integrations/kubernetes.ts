import type { IntegrationConfig } from './types.js'
import { safeIntegrationFetch } from './safeFetch.js'

type JsonRecord = Record<string, unknown>

const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value)
  ? value as JsonRecord
  : {}
const rows = (value: unknown): JsonRecord[] => Array.isArray(value) ? value.map(record) : []
const text = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback
const count = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0

function metadata(item: JsonRecord) {
  const value = record(item.metadata)
  return { name: text(value.name), namespace: text(value.namespace, 'default') }
}

function condition(items: unknown, type: string): JsonRecord {
  return rows(items).find((candidate) => candidate.type === type) ?? {}
}

export async function fetchKubernetesSummary(config: IntegrationConfig) {
  const [nodeList, deploymentList, podList, serviceList, routeList] = await Promise.all([
    safeIntegrationFetch<JsonRecord>(config, '/api/v1/nodes'),
    safeIntegrationFetch<JsonRecord>(config, '/apis/apps/v1/deployments'),
    safeIntegrationFetch<JsonRecord>(config, '/api/v1/pods'),
    safeIntegrationFetch<JsonRecord>(config, '/api/v1/services'),
    safeIntegrationFetch<JsonRecord>(config, '/apis/gateway.networking.k8s.io/v1/httproutes'),
  ])

  const pods = rows(podList.items)
  const podStatuses = pods.flatMap((pod) => rows(record(pod.status).containerStatuses))

  return {
    nodes: rows(nodeList.items).map((node) => {
      const ready = condition(record(node.status).conditions, 'Ready')
      return {
        name: metadata(node).name,
        ready: ready.status === 'True',
        reason: text(ready.reason),
        message: text(ready.message),
      }
    }),
    workloads: rows(deploymentList.items).map((deployment) => {
      const identity = metadata(deployment)
      const desired = count(record(deployment.spec).replicas)
      const status = record(deployment.status)
      const available = count(status.availableReplicas)
      const ready = count(status.readyReplicas)
      return {
        ...identity,
        desired,
        available,
        ready,
        state: available >= desired ? 'available' : 'degraded',
      }
    }),
    pods: {
      total: pods.length,
      ready: pods.filter((pod) => rows(record(pod.status).containerStatuses).every((status) => status.ready === true)).length,
      pending: pods.filter((pod) => text(record(pod.status).phase) === 'Pending').length,
      restarts: podStatuses.reduce((total, status) => total + count(status.restartCount), 0),
    },
    services: rows(serviceList.items).map((service) => {
      const identity = metadata(service)
      const spec = record(service.spec)
      return {
        ...identity,
        type: text(spec.type),
        clusterIP: text(spec.clusterIP),
        ports: rows(spec.ports).map((port) => count(port.port)),
      }
    }),
    httpRoutes: rows(routeList.items).map((route) => {
      const identity = metadata(route)
      const parentConditions = rows(record(route.status).parents).flatMap((parent) => rows(parent.conditions))
      return {
        ...identity,
        hostnames: Array.isArray(record(route.spec).hostnames)
          ? (record(route.spec).hostnames as unknown[]).filter((hostname): hostname is string => typeof hostname === 'string')
          : [],
        accepted: parentConditions.some((candidate) => candidate.type === 'Accepted' && candidate.status === 'True'),
        resolvedRefs: parentConditions.some((candidate) => candidate.type === 'ResolvedRefs' && candidate.status === 'True'),
      }
    }),
  }
}
