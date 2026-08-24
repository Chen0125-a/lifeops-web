import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { platformApi } from '../../api/platformApi'
import { queryKeys } from '../../api/queryKeys'
import type { LogFilters, PlatformDetail, PlatformMetricKey, PlatformOverview, PlatformTab } from '../../domain/platform'

const platformTabs = new Set<PlatformTab>(['overview', 'kubernetes', 'monitoring', 'alerts', 'logs', 'delivery', 'technologies'])
const platformMetrics = new Set<PlatformMetricKey>(['availability', 'request-rate', 'error-rate', 'p95-latency', 'cpu', 'memory', 'storage', 'restarts', 'readiness'])
const logFilterKeys = ['namespace', 'pod', 'level', 'requestId'] as const satisfies readonly (keyof LogFilters)[]

function tabFrom(params: URLSearchParams): PlatformTab {
  const value = params.get('tab') as PlatformTab | null
  return value && platformTabs.has(value) ? value : 'overview'
}

function metricFrom(params: URLSearchParams): PlatformMetricKey {
  const value = params.get('metric') as PlatformMetricKey | null
  return value && platformMetrics.has(value) ? value : 'availability'
}

function filtersFrom(params: URLSearchParams): LogFilters {
  return Object.fromEntries(logFilterKeys.flatMap((key) => {
    const value = params.get(key)?.trim()
    return value ? [[key, value]] : []
  })) as LogFilters
}

export interface PlatformController {
  tab: PlatformTab
  selectTab: (tab: PlatformTab) => void
  refresh: () => void
  status: 'loading' | 'ready' | 'error'
  error: string | null
  overview: PlatformOverview | null
  detail: PlatformDetail | null
  metricKey?: PlatformMetricKey
  selectMetric?: (key: PlatformMetricKey) => void
  logFilters?: LogFilters
  setLogFilters?: (filters: LogFilters) => void
}

function useDocumentVisible() {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible')
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return visible
}

export function usePlatform(): PlatformController {
  const [searchParams, setSearchParams] = useSearchParams()
  const searchKey = searchParams.toString()
  const [tab, setTab] = useState<PlatformTab>(() => tabFrom(searchParams))
  const [metricKey, setMetricKey] = useState<PlatformMetricKey>(() => metricFrom(searchParams))
  const [logFilters, setFilters] = useState<LogFilters>(() => filtersFrom(searchParams))
  const visible = useDocumentVisible()
  const polling = visible ? 30_000 : false

  useEffect(() => {
    const params = new URLSearchParams(searchKey)
    setTab(tabFrom(params))
    setMetricKey(metricFrom(params))
    setFilters(filtersFrom(params))
  }, [searchKey])

  const updateParams = useCallback((mutate: (next: URLSearchParams) => void) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      mutate(next)
      return next
    }, { replace: true })
  }, [setSearchParams])
  const selectTab = useCallback((nextTab: PlatformTab) => {
    setTab(nextTab)
    updateParams((next) => next.set('tab', nextTab))
  }, [updateParams])
  const selectMetric = useCallback((nextMetric: PlatformMetricKey) => {
    setMetricKey(nextMetric)
    updateParams((next) => { next.set('tab', 'monitoring'); next.set('metric', nextMetric) })
  }, [updateParams])
  const setLogFilters = useCallback((filters: LogFilters) => {
    setFilters(filters)
    updateParams((next) => {
      next.set('tab', 'logs')
      for (const key of logFilterKeys) {
        const value = filters[key]?.trim()
        if (value) next.set(key, value)
        else next.delete(key)
      }
    })
  }, [updateParams])
  const overviewQuery = useQuery({
    queryKey: queryKeys.platform.detail('overview'),
    queryFn: ({ signal }) => platformApi.overview(signal),
    refetchInterval: polling,
  })
  const detailQuery = useQuery({
    enabled: tab !== 'overview',
    queryKey: [...queryKeys.platform.detail(tab), tab === 'monitoring' ? metricKey : tab === 'logs' ? logFilters : null],
    queryFn: ({ signal }): Promise<PlatformDetail> => {
      if (tab === 'kubernetes') return platformApi.kubernetes(signal)
      if (tab === 'monitoring') return platformApi.metric(metricKey, signal)
      if (tab === 'alerts') return platformApi.alerts(signal)
      if (tab === 'logs') return platformApi.logs(logFilters, signal)
      if (tab === 'delivery') return platformApi.delivery(signal)
      return platformApi.technologies(signal)
    },
    refetchInterval: polling,
  })
  const active = tab === 'overview' ? overviewQuery : detailQuery
  const error = active.error instanceof Error ? active.error.message : active.error ? '平台数据暂时不可用' : null
  const refresh = useCallback(() => { void active.refetch() }, [active])

  return useMemo(() => ({
    tab,
    selectTab,
    refresh,
    status: active.isPending ? 'loading' : error ? 'error' : 'ready',
    error,
    overview: overviewQuery.data ?? null,
    detail: detailQuery.data ?? null,
    metricKey,
    selectMetric,
    logFilters,
    setLogFilters,
  }), [active.isPending, detailQuery.data, error, logFilters, metricKey, overviewQuery.data, refresh, tab])
}
