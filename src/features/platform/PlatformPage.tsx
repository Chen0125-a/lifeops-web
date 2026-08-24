import { useEffect, useRef, type FormEvent } from 'react'
import type {
  AlertSummary,
  DeliverySummary,
  KubernetesSummary,
  LogFilters,
  LogSummary,
  PlatformEnvelope,
  PlatformMetric,
  PlatformMetricKey,
  PlatformSourceStatus,
  PlatformTab,
  TechnologyArchive as TechnologyArchiveData,
} from '../../domain/platform'
import { AccessibleTrend } from './AccessibleTrend'
import { ServiceTopology } from './ServiceTopology'
import { TechnologyArchive } from './TechnologyArchive'
import { usePlatform, type PlatformController } from './usePlatform'

const tabs: Array<{ id: PlatformTab; label: string }> = [
  { id: 'overview', label: '总览' }, { id: 'kubernetes', label: 'Kubernetes' }, { id: 'monitoring', label: '监控' },
  { id: 'alerts', label: '告警' }, { id: 'logs', label: '日志' }, { id: 'delivery', label: '发布' }, { id: 'technologies', label: '技术档案' },
]
const metrics: Array<{ id: PlatformMetricKey; label: string }> = [
  { id: 'availability', label: '可用率' }, { id: 'p95-latency', label: 'P95 延迟' }, { id: 'request-rate', label: '请求量' },
  { id: 'error-rate', label: '错误率' }, { id: 'cpu', label: 'CPU' }, { id: 'memory', label: '内存' }, { id: 'storage', label: '存储' },
  { id: 'readiness', label: '就绪' }, { id: 'restarts', label: '重启' },
]

const stateLabel = { connected: '已连接', degraded: '局部降级', disconnected: '已断开', disabled: '未连接', unknown: '未验证' } as const
const isEnvelope = (value: unknown): value is PlatformEnvelope<unknown> => Boolean(value && typeof value === 'object' && 'source' in value && 'data' in value)
const asEnvelope = <T,>(value: unknown) => isEnvelope(value) ? value as PlatformEnvelope<T> : null

function ConnectionStrip({ sources }: { sources: PlatformSourceStatus[] }) {
  return <section className="platform-connections" role="region" aria-label="平台连接状态"><ul>{sources.map((source) => <li key={source.source} data-state={source.state}><i aria-hidden="true" /><span>{source.source}</span><strong>{stateLabel[source.state]}</strong><small>{source.checkedAt ? new Date(source.checkedAt).toLocaleTimeString('zh-CN') : '等待配置'}</small></li>)}</ul></section>
}

function ExternalLink({ href, children }: { href: string | null | undefined; children: string }) {
  return href ? <a href={href} target="_blank" rel="noreferrer">{children}</a> : null
}

function Overview({ controller }: { controller: PlatformController }) {
  const overview = controller.overview
  if (!overview) return <p className="platform-empty">平台总览尚无可验证数据。</p>
  const kube = overview.kubernetes.data
  const alerts = overview.alerts.data
  const logs = overview.logs.data
  const delivery = overview.delivery.data
  const monitoring = overview.monitoring.data
  return <>
    <ConnectionStrip sources={overview.connections} />
    <div className="platform-overview">
      <section className="platform-topology" role="region" aria-label="服务拓扑"><header><p>Live topology</p><h2>服务与工作负载</h2></header><ServiceTopology summary={kube} /></section>
      <section className="platform-alerts" role="region" aria-label="当前告警"><header><p>Active alerts</p><h2>{alerts?.firing.length ?? '—'} 条当前告警</h2></header>{alerts?.firing.length ? <ol>{alerts.firing.slice(0, 5).map((item) => <li key={item.id}><strong>{item.name}</strong><span>{item.summary}</span><small>{item.severity}</small></li>)}</ol> : <p>{overview.alerts.source.state === 'connected' ? '当前没有 firing 告警。' : '告警来源未连接或暂时不可用。'}</p>}<ExternalLink href={alerts?.deepLinkUrl}>打开 Alertmanager</ExternalLink></section>
      <section className="platform-deployment" role="region" aria-label="最新部署"><header><p>Latest delivery</p><h2>{delivery?.github.latestRun?.conclusion ?? '未验证'}</h2></header><dl><div><dt>Revision</dt><dd>{delivery?.github.latestRun?.revision ?? '—'}</dd></div><div><dt>Web image</dt><dd>{delivery?.images.web?.tag ?? '—'}</dd></div></dl><ExternalLink href={delivery?.github.deepLinkUrl}>打开 GitHub Actions</ExternalLink></section>
      <section className="platform-monitoring" role="region" aria-label="资源与可用性趋势">{monitoring ? <AccessibleTrend title="服务可用性" description="Prometheus 预设 SLI；缺失不会填成零。" unit={monitoring.unit} series={monitoring.series.map((row, index) => ({ name: row.labels.service ?? row.labels.pod ?? `series-${index + 1}`, points: row.points }))} /> : <p className="platform-empty">监控来源尚未连接或没有可验证序列。</p>}<ExternalLink href={monitoring?.deepLinkUrl}>在 Grafana 深入查看</ExternalLink></section>
      <section className="platform-logs" role="region" aria-label="错误日志摘要"><header><p>Bounded logs</p><h2>最近错误摘要</h2></header>{logs?.events.length ? <ol>{logs.events.slice(0, 5).map((item) => <li key={item.id}><time>{item.timestamp ?? '—'}</time><strong>{item.level}</strong><span>{item.message}</span></li>)}</ol> : <p>日志来源未连接或没有可验证事件。</p>}<ExternalLink href={logs?.deepLinkUrl}>打开 Kibana</ExternalLink></section>
      <section className="platform-gitops" role="region" aria-label="GitOps 状态"><header><p>GitOps read only</p><h2>{delivery?.argoCd.sync ?? '未验证'} · {delivery?.argoCd.health ?? '未验证'}</h2></header><p>{delivery?.argoCd.revision ?? '尚无经过验证的 Argo CD revision。'}</p><ExternalLink href={delivery?.argoCd.deepLinkUrl}>打开 Argo CD</ExternalLink></section>
    </div>
  </>
}

function MonitoringDetail({ envelope, controller }: { envelope: PlatformEnvelope<PlatformMetric> | null; controller: PlatformController }) {
  const data = envelope?.data
  return <section className="platform-detail" role="region" aria-label="监控详情"><header><div><p>Allowlisted SLI</p><h2>预设指标查询</h2></div><label>监控指标<select value={controller.metricKey ?? 'availability'} onChange={(event) => controller.selectMetric?.(event.target.value as PlatformMetricKey)}>{metrics.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></header>{data ? <AccessibleTrend title={metrics.find((item) => item.id === data.key)?.label ?? data.key} description="只使用服务端定义的 PromQL，不接受浏览器原始查询。" unit={data.unit} series={data.series.map((row, index) => ({ name: row.labels.service ?? row.labels.pod ?? `series-${index + 1}`, points: row.points }))} /> : <p className="platform-empty">没有可验证的指标序列。</p>}<ExternalLink href={data?.deepLinkUrl}>在 Grafana 深入查看</ExternalLink></section>
}

function LogsDetail({ envelope, controller }: { envelope: PlatformEnvelope<LogSummary> | null; controller: PlatformController }) {
  const current = controller.logFilters ?? {}
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    controller.setLogFilters?.(Object.fromEntries([...data.entries()].filter(([, value]) => String(value).trim())) as LogFilters)
  }
  return <section className="platform-detail" role="region" aria-label="日志详情"><header><div><p>Sanitized events</p><h2>最多 100 条脱敏摘要</h2></div></header><form className="platform-log-filters" onSubmit={submit}><label>Namespace<input name="namespace" defaultValue={current.namespace} /></label><label>Pod<input name="pod" defaultValue={current.pod} /></label><label>Level<select name="level" defaultValue={current.level ?? ''}><option value="">全部</option><option value="error">error</option><option value="warn">warn</option><option value="info">info</option></select></label><label>Request ID<input name="requestId" defaultValue={current.requestId} /></label><button type="submit">应用筛选</button></form>{envelope?.data?.events.length ? <ol className="platform-event-stream">{envelope.data.events.map((item) => <li key={item.id}><time>{item.timestamp ?? '—'}</time><strong>{item.level}</strong><span>{item.message}</span></li>)}</ol> : <p className="platform-empty">日志来源未连接或没有匹配事件。</p>}<ExternalLink href={envelope?.data?.deepLinkUrl}>打开 Kibana</ExternalLink></section>
}

function Detail({ controller }: { controller: PlatformController }) {
  if (controller.tab === 'technologies') return <TechnologyArchive technologies={(controller.detail as TechnologyArchiveData | null)?.technologies ?? []} />
  if (controller.tab === 'monitoring') return <MonitoringDetail envelope={asEnvelope<PlatformMetric>(controller.detail)} controller={controller} />
  if (controller.tab === 'logs') return <LogsDetail envelope={asEnvelope<LogSummary>(controller.detail)} controller={controller} />
  const envelope = asEnvelope<KubernetesSummary | AlertSummary | DeliverySummary>(controller.detail)
  if (controller.tab === 'kubernetes') return <section className="platform-detail" role="region" aria-label="Kubernetes 详情"><header><p>Read only inventory</p><h2>节点、工作负载与网络入口</h2></header><ServiceTopology summary={envelope?.data as KubernetesSummary | null} /></section>
  if (controller.tab === 'alerts') {
    const data = envelope?.data as AlertSummary | null
    return <section className="platform-detail" role="region" aria-label="告警详情"><header><p>Alert state</p><h2>当前与近期恢复</h2></header><div className="platform-alert-columns"><div><h3>当前</h3>{data?.firing.map((item) => <p key={item.id}><strong>{item.name}</strong><span>{item.summary}</span></p>)}</div><div><h3>近期恢复</h3>{data?.resolved.map((item) => <p key={item.id}><strong>{item.name}</strong><span>{item.summary}</span></p>)}</div></div><ExternalLink href={data?.deepLinkUrl}>打开 Alertmanager</ExternalLink></section>
  }
  const data = envelope?.data as DeliverySummary | null
  return <section className="platform-detail" role="region" aria-label="发布详情"><header><p>Delivery truth</p><h2>GitHub Actions → UHub → GitOps</h2></header><dl className="platform-delivery-ledger"><div><dt>Actions</dt><dd>{data?.github.latestRun?.conclusion ?? '未验证'}</dd></div><div><dt>Argo sync</dt><dd>{data?.argoCd.sync ?? '未验证'}</dd></div><div><dt>Argo health</dt><dd>{data?.argoCd.health ?? '未验证'}</dd></div>{Object.entries(data?.images ?? {}).map(([name, image]) => <div key={name}><dt>{name}</dt><dd>{image.tag}<small>{image.digest}</small></dd></div>)}</dl><ExternalLink href={data?.github.deepLinkUrl}>打开 GitHub Actions</ExternalLink><ExternalLink href={data?.argoCd.deepLinkUrl}>打开 Argo CD</ExternalLink></section>
}

function PlatformView({ controller }: { controller: PlatformController }) {
  const tabRailRef = useRef<HTMLElement>(null)
  const selectedTabRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const rail = tabRailRef.current
    const selected = selectedTabRef.current
    if (!rail || !selected) return
    rail.scrollLeft = Math.max(0, selected.offsetLeft - (rail.clientWidth - selected.offsetWidth) / 2)
  }, [controller.tab])

  return <article className="platform-page" data-platform-page>
    <header className="platform-hero"><div><p>Operations center · read only</p><h1 tabIndex={-1}>平台运行中心</h1><span>真实来源、短时缓存、局部降级；未连接的数据保持空白。</span></div><button type="button" onClick={controller.refresh}>刷新当前区域</button></header>
    <nav ref={tabRailRef} className="platform-tabs" role="tablist" aria-label="平台区域">{tabs.map((tab) => <button key={tab.id} ref={controller.tab === tab.id ? selectedTabRef : undefined} type="button" role="tab" aria-selected={controller.tab === tab.id} onClick={() => controller.selectTab(tab.id)}>{tab.label}</button>)}</nav>
    {controller.status === 'loading' ? <p className="platform-loading" role="status">正在读取已配置的平台来源…</p> : null}
    {controller.status === 'error' ? <div className="platform-local-error" role="alert"><p>{controller.error ?? '当前区域暂时不可用'}</p><button type="button" onClick={controller.refresh}>重试当前区域</button></div> : null}
    {controller.status === 'ready' ? controller.tab === 'overview' ? <Overview controller={controller} /> : <Detail controller={controller} /> : null}
  </article>
}

function ConnectedPlatformPage() {
  const controller = usePlatform()
  return <PlatformView controller={controller} />
}

export function PlatformPage({ controller }: { controller?: PlatformController } = {}) {
  return controller ? <PlatformView controller={controller} /> : <ConnectedPlatformPage />
}
