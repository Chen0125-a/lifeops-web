import type {
  AlertSummary,
  DeliverySummary,
  KubernetesSummary,
  LogFilters,
  LogSummary,
  PlatformEnvelope,
  PlatformMetric,
  PlatformMetricKey,
  PlatformOverview,
  TechnologyArchive,
} from '../domain/platform'
import { http } from './httpClient'

function query(filters: LogFilters) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
  const serialized = params.toString()
  return serialized ? `?${serialized}` : ''
}

export const platformApi = {
  overview: (signal?: AbortSignal) => http.request<PlatformOverview>('/platform/overview', { signal }),
  kubernetes: (signal?: AbortSignal) => http.request<PlatformEnvelope<KubernetesSummary>>('/platform/kubernetes', { signal }),
  metric: (key: PlatformMetricKey, signal?: AbortSignal) => http.request<PlatformEnvelope<PlatformMetric>>(`/platform/metrics/${key}`, { signal }),
  alerts: (signal?: AbortSignal) => http.request<PlatformEnvelope<AlertSummary>>('/platform/alerts', { signal }),
  logs: (filters: LogFilters, signal?: AbortSignal) => http.request<PlatformEnvelope<LogSummary>>(`/platform/logs${query(filters)}`, { signal }),
  delivery: (signal?: AbortSignal) => http.request<PlatformEnvelope<DeliverySummary>>('/platform/delivery', { signal }),
  technologies: (signal?: AbortSignal) => http.request<TechnologyArchive>('/platform/technologies', { signal }),
}
