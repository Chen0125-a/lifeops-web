export type PlatformSourceState = 'connected' | 'degraded' | 'disconnected' | 'disabled' | 'unknown'
export type PlatformTab = 'overview' | 'kubernetes' | 'monitoring' | 'alerts' | 'logs' | 'delivery' | 'technologies'
export type PlatformMetricKey = 'availability' | 'request-rate' | 'error-rate' | 'p95-latency' | 'cpu' | 'memory' | 'storage' | 'restarts' | 'readiness'

export interface PlatformSourceStatus {
  source: string
  state: PlatformSourceState
  checkedAt: string | null
  latencyMs: number | null
  message: string
}

export interface PlatformEnvelope<T> {
  source: PlatformSourceStatus
  cachedAt: string | null
  data: T | null
}

export interface PlatformMetric {
  key: PlatformMetricKey
  unit: string
  state: PlatformSourceState
  deepLinkUrl: string | null
  series: Array<{ labels: Record<string, string>; points: Array<{ timestamp: number; value: number }> }>
}

export interface KubernetesSummary {
  nodes: Array<{ name: string; ready: boolean; reason: string; message: string }>
  workloads: Array<{ namespace: string; name: string; desired: number; ready: number; available: number; state: string }>
  pods: { total: number; ready: number; pending: number; restarts: number }
  services: Array<{ namespace?: string; name?: string; type?: string; clusterIP?: string; ports?: number[] }>
  httpRoutes: Array<{ namespace?: string; name?: string; hostnames?: string[]; accepted?: boolean; resolvedRefs?: boolean }>
}

export interface AlertSummary {
  deepLinkUrl: string | null
  firing: Array<{ id: string; name: string; severity: string; summary: string; startsAt: string | null; endsAt?: string | null }>
  resolved: Array<{ id: string; name: string; severity: string; summary: string; startsAt: string | null; endsAt?: string | null }>
}

export interface LogSummary {
  deepLinkUrl: string | null
  total: number
  events: Array<{ id: string; timestamp: string | null; level: string; message: string; namespace?: string | null; pod?: string | null; requestId?: string | null }>
}

export interface DeliverySummary {
  state: PlatformSourceState
  github: { state: PlatformSourceState; deepLinkUrl: string | null; latestRun: { number?: number | null; status?: string | null; conclusion?: string | null; revision?: string | null } | null }
  argoCd: { state: PlatformSourceState; deepLinkUrl: string | null; sync: string; health: string; revision: string | null; images: Record<string, ImageReference> }
  images: Record<string, ImageReference>
}

export interface ImageReference { repository: string; tag: string; digest: string }
export interface TechnologyEntry { name: string; role: string; status: string }
export interface TechnologyArchive { technologies: TechnologyEntry[] }
export interface LogFilters { namespace?: string; pod?: string; level?: string; requestId?: string }

export interface PlatformOverview {
  connections: PlatformSourceStatus[]
  kubernetes: PlatformEnvelope<KubernetesSummary>
  monitoring: PlatformEnvelope<PlatformMetric>
  alerts: PlatformEnvelope<AlertSummary>
  logs: PlatformEnvelope<LogSummary>
  delivery: PlatformEnvelope<DeliverySummary>
}

export type PlatformDetail =
  | PlatformEnvelope<KubernetesSummary>
  | PlatformEnvelope<PlatformMetric>
  | PlatformEnvelope<AlertSummary>
  | PlatformEnvelope<LogSummary>
  | PlatformEnvelope<DeliverySummary>
  | TechnologyArchive
