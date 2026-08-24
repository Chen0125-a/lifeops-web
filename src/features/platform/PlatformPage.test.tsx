import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { PlatformPage } from './PlatformPage'
import type { PlatformController } from './usePlatform'

const source = (name: string, state: 'connected' | 'degraded' | 'disabled' | 'unknown' = 'connected') => ({
  source: name,
  state,
  checkedAt: state === 'disabled' ? null : '2026-08-22T16:00:00.000Z',
  latencyMs: state === 'connected' ? 18 : null,
  message: state === 'connected' ? '已连接' : state === 'degraded' ? '来源暂时不可用' : state === 'disabled' ? '未连接' : '未验证',
})

function controller(patch: Partial<PlatformController> = {}): PlatformController {
  return {
    tab: 'overview',
    selectTab: vi.fn(),
    refresh: vi.fn(),
    status: 'ready',
    error: null,
    overview: {
      connections: ['Web', 'API', 'MySQL', 'Kubernetes', 'Prometheus', 'Alertmanager', 'Elasticsearch', 'Argo CD'].map((name) => source(name)),
      kubernetes: { source: source('Kubernetes'), cachedAt: '2026-08-22T16:00:00.000Z', data: {
        nodes: [{ name: 'worker-1', ready: true, reason: '', message: '' }],
        workloads: [{ namespace: 'lifeops', name: 'api', desired: 2, ready: 2, available: 2, state: 'available' }],
        pods: { total: 4, ready: 4, pending: 0, restarts: 1 }, services: [], httpRoutes: [],
      } },
      monitoring: { source: source('Prometheus'), cachedAt: '2026-08-22T16:00:00.000Z', data: { key: 'availability', unit: 'ratio', state: 'connected', deepLinkUrl: 'https://grafana.example/', series: [{ labels: { service: 'api' }, points: [{ timestamp: 1_777_000_000, value: 0.998 }] }] } },
      alerts: { source: source('Alertmanager'), cachedAt: '2026-08-22T16:00:00.000Z', data: { deepLinkUrl: 'https://alertmanager.example/', firing: [{ id: 'a1', name: 'API latency', severity: 'warning', summary: 'P95 elevated', startsAt: '2026-08-22T15:55:00.000Z' }], resolved: [] } },
      logs: { source: source('Elasticsearch'), cachedAt: '2026-08-22T16:00:00.000Z', data: { deepLinkUrl: 'https://kibana.example/', total: 1, events: [{ id: 'e1', timestamp: '2026-08-22T15:59:00.000Z', level: 'error', message: 'bounded failure', namespace: 'lifeops', pod: 'api-1', requestId: 'req-7' }] } },
      delivery: { source: source('Argo CD'), cachedAt: '2026-08-22T16:00:00.000Z', data: { state: 'connected', github: { state: 'connected', deepLinkUrl: 'https://github.example/', latestRun: { number: 27, status: 'completed', conclusion: 'success', revision: 'abc123' } }, argoCd: { state: 'connected', deepLinkUrl: 'https://argocd.example/', sync: 'Synced', health: 'Healthy', revision: 'abc123', images: {} }, images: { web: { repository: 'registry/lifeops-web', tag: 'v1', digest: `sha256:${'a'.repeat(64)}` } } } },
    },
    detail: null,
    ...patch,
  }
}

function renderPage(value = controller()) {
  return render(<MemoryRouter><PlatformPage controller={value} /></MemoryRouter>)
}

describe('PlatformPage', () => {
  it('renders the bright continuous operations hierarchy without a dark dashboard or card wall', () => {
    const { container } = renderPage()
    const strip = screen.getByRole('region', { name: '平台连接状态' })
    expect(within(strip).getAllByRole('listitem')).toHaveLength(8)
    expect(screen.getByRole('region', { name: '服务拓扑' })).toHaveTextContent('worker-1')
    expect(screen.getByRole('region', { name: '当前告警' })).toHaveTextContent('API latency')
    expect(screen.getByRole('region', { name: '最新部署' })).toHaveTextContent('abc123')
    expect(screen.getByRole('region', { name: '资源与可用性趋势' })).toBeVisible()
    expect(screen.getByRole('region', { name: '错误日志摘要' })).toHaveTextContent('bounded failure')
    expect(screen.getByRole('region', { name: 'GitOps 状态' })).toHaveTextContent('Synced')
    expect(container.querySelector('.dark-dashboard')).toBeNull()
    expect(container.querySelector('.platform-card-wall')).toBeNull()
  })

  it('offers all seven tabs, configured deep links and explicit non-connected states', async () => {
    const user = userEvent.setup()
    const selectTab = vi.fn()
    const value = controller({
      selectTab,
      overview: {
        ...controller().overview!,
        connections: [source('Web'), source('API'), source('MySQL'), source('Kubernetes', 'disabled'), source('Prometheus', 'unknown'), source('Alertmanager', 'degraded'), source('Elasticsearch', 'disabled'), source('Argo CD', 'unknown')],
      },
    })
    renderPage(value)
    expect(screen.getAllByRole('tab')).toHaveLength(7)
    await user.click(screen.getByRole('tab', { name: '告警' }))
    expect(selectTab).toHaveBeenCalledWith('alerts')
    expect(screen.getAllByText('未连接').length).toBeGreaterThan(0)
    expect(screen.getAllByText('未验证').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: '在 Grafana 深入查看' })).toHaveAttribute('href', 'https://grafana.example/')
    expect(screen.getByRole('link', { name: '打开 Alertmanager' })).toHaveAttribute('href', 'https://alertmanager.example/')
    expect(screen.getByRole('link', { name: '打开 Kibana' })).toHaveAttribute('href', 'https://kibana.example/')
  })

  it('renders the technology archive truth instead of treating later tools as current delivery', () => {
    renderPage(controller({
      tab: 'technologies',
      detail: { technologies: [
        { name: 'Jenkins', role: '等价流水线练习', status: 'later-learning-track' },
        { name: 'UHub', role: '当前镜像主线', status: 'current-image-mainline' },
        { name: 'Harbor', role: '可选镜像方案', status: 'optional' },
      ] },
    }))
    expect(screen.getByRole('row', { name: /Jenkins.*后续学习轨/u })).toBeVisible()
    expect(screen.getByRole('row', { name: /UHub.*当前镜像主线/u })).toBeVisible()
    expect(screen.getByRole('row', { name: /Harbor.*可选/u })).toBeVisible()
  })

  it('keeps a local retry action when one tab fails', async () => {
    const user = userEvent.setup()
    const refresh = vi.fn()
    renderPage(controller({ tab: 'logs', status: 'error', error: '日志来源暂时不可用', refresh }))
    expect(screen.getByRole('alert')).toHaveTextContent('日志来源暂时不可用')
    await user.click(screen.getByRole('button', { name: '重试当前区域' }))
    expect(refresh).toHaveBeenCalledOnce()
  })
})
