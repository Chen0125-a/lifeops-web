import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { settingsApi } from '../../api/settingsApi'
import type { SettingsDocument } from '../../domain/settings'
import { SettingsPage } from './SettingsPage'

vi.mock('../../api/settingsApi', () => ({
  settingsApi: {
    get: vi.fn(),
    update: vi.fn(),
    listSessions: vi.fn(),
    changePassword: vi.fn(),
    revokeSession: vi.fn(),
    exportData: vi.fn(),
    previewImport: vi.fn(),
    applyImport: vi.fn(),
    listAudit: vi.fn(),
  },
}))

vi.mock('../../api/knowledgeApi', () => ({ knowledgeApi: { list: vi.fn(async () => ({ items: [] })) } }))
vi.mock('../../api/reviewsApi', () => ({ reviewsApi: { list: vi.fn(async () => []) } }))
vi.mock('../../state/AuthContext', () => ({ useAuth: () => ({ csrfToken: 'csrf-test', user: { id: 'owner-1', account: 'owner@example.com', displayName: 'Owner' } }) }))

const settingsDocument: SettingsDocument = {
  version: 1,
  updatedAt: '2026-08-23T02:30:00.000Z',
  appearance: { theme: 'system' as const, motion: 'system' as const },
  locale: { locale: 'zh-CN', timezone: 'Asia/Shanghai', weekStartsOn: 1 as const },
  defaults: { startRoute: '/app', quickCreateType: 'record' as const },
  life: { lowStockDays: 7, expiryWarningDays: 14, remindersEnabled: true },
  publicSite: { defaultVisibility: 'private' as const, rssEnabled: true },
  connections: [
    { id: 'prometheus', label: 'Prometheus', state: 'disabled' as const, detail: '未配置' },
    { id: 'obsidian', label: 'Obsidian', state: 'local-only' as const, detail: '浏览器授权' },
  ],
}

function renderPage(width = 1440) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  window.dispatchEvent(new Event('resize'))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><SettingsPage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.mocked(settingsApi.get).mockResolvedValue(structuredClone(settingsDocument))
    vi.mocked(settingsApi.update).mockImplementation(async (input) => ({ ...structuredClone(settingsDocument), ...input, version: 2 }))
    vi.mocked(settingsApi.listSessions).mockResolvedValue({ sessions: [{ id: 'session-1', current: true, createdAt: '2026-08-23T01:00:00.000Z', expiresAt: '2026-08-23T09:00:00.000Z' }] })
    vi.mocked(settingsApi.changePassword).mockResolvedValue(undefined)
    vi.mocked(settingsApi.revokeSession).mockResolvedValue(undefined)
    vi.mocked(settingsApi.exportData).mockResolvedValue({ schemaVersion: 1, canonicalJson: '{}', checksumSha256: 'a'.repeat(64), counts: {} })
    vi.mocked(settingsApi.previewImport).mockResolvedValue({ status: 'ready', previewChecksum: 'b'.repeat(64), counts: { goals: 1 }, conflicts: [], rejectedRecords: [], ownerRemap: { source: 'source', target: 'owner-1' } })
    vi.mocked(settingsApi.applyImport).mockResolvedValue({
      applied: true, counts: { goals: 1 },
      restorePoint: { id: 'restore-1', checksumSha256: 'a'.repeat(64), createdAt: '2026-08-23T10:00:00.000Z' },
    })
    vi.mocked(settingsApi.listAudit).mockResolvedValue({ events: [] })
  })

  it('exposes every approved category in one continuous settings workbench', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: '账户与设置' })).toBeVisible()
    for (const name of ['账户与会话', '外观与动效', '时间与区域', '默认行为', '生活阈值与提醒', 'Obsidian', '平台连接', '公开站点', '数据与安全']) {
      expect(screen.getByRole('button', { name })).toBeVisible()
    }
  })

  it('keeps save progress beside the changed appearance setting', async () => {
    const user = userEvent.setup()
    let resolve!: (value: SettingsDocument) => void
    vi.mocked(settingsApi.update).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    renderPage()
    await screen.findByRole('heading', { name: '账户与设置' })
    await user.click(screen.getByRole('button', { name: '外观与动效' }))
    await user.selectOptions(screen.getByLabelText('界面主题'), 'dark')
    expect(screen.getByRole('status')).toHaveTextContent('正在保存')
    resolve({ ...settingsDocument, appearance: { theme: 'dark', motion: 'system' }, version: 2 })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已保存'))
  })

  it('shows connection state without rendering secret configuration values', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: '账户与设置' })
    await user.click(screen.getByRole('button', { name: '平台连接' }))
    expect(screen.getByText('Prometheus')).toBeVisible()
    expect(screen.getByText('未配置')).toBeVisible()
    expect(screen.getByText('Obsidian', { selector: 'strong' })).toBeVisible()
    expect(window.document.body.textContent).not.toMatch(/token|password|cookie|secret/i)
  })

  it('requires an explicit dangerous confirmation with impact and recovery copy before import apply', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: '账户与设置' })
    await user.click(screen.getByRole('button', { name: '数据与安全' }))
    expect(screen.getByText(/导入会变更当前账户数据/)).toBeVisible()
    expect(screen.getByText(/可用导入前恢复点恢复/)).toBeVisible()
    await user.upload(screen.getByLabelText('选择导入 JSON'), new File(['{}'], 'lifeops.json', { type: 'application/json' }))
    await screen.findByText(/预览完成/)
    expect(screen.getByRole('button', { name: '应用导入' })).toBeDisabled()
    await user.type(screen.getByLabelText('当前密码'), 'Correct-password-2026!')
    await user.click(screen.getByRole('checkbox', { name: /我已理解影响与恢复方式/ }))
    await user.click(screen.getByRole('button', { name: '应用导入' }))
    expect(settingsApi.applyImport).toHaveBeenCalledWith(expect.objectContaining({ currentPassword: 'Correct-password-2026!' }), 'csrf-test')
  })

  it('uses mobile category enter and reverse navigation without losing the selected category', async () => {
    const user = userEvent.setup()
    renderPage(390)
    await screen.findByRole('heading', { name: '账户与设置' })
    await user.click(screen.getByRole('button', { name: '时间与区域' }))
    expect(screen.getByRole('button', { name: '返回设置分类' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '时间与区域' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '返回设置分类' }))
    expect(screen.getByRole('button', { name: '时间与区域' })).toHaveAttribute('aria-current', 'page')
  })
})
