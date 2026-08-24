import userEvent from '@testing-library/user-event'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SyncPlan, VaultDocument } from '../../integrations/obsidian/types'
import { ObsidianSettings } from './ObsidianSettings'

function doc(id = 'note-1'): VaultDocument {
  return {
    lifeopsId: id,
    type: 'knowledge',
    title: 'Kubernetes 复盘',
    tags: ['k8s'],
    source: null,
    updatedAt: '2026-08-22T10:00:00.000Z',
    syncRevision: 1,
    body: '# 正文',
    path: `LifeOps/Knowledge/${id}.md`,
  }
}

function plan(): SyncPlan {
  return {
    hasConflicts: true,
    actions: [
      { kind: 'create-vault', lifeopsId: 'note-1', web: doc(), vault: null },
      { kind: 'conflict', lifeopsId: 'note-2', web: doc('note-2'), vault: doc('note-2') },
    ],
  }
}

describe('ObsidianSettings', () => {
  it('shows an honest ZIP fallback and encoded Obsidian URI when directory access is unsupported', async () => {
    const user = userEvent.setup()
    const onExportZip = vi.fn()
    render(<ObsidianSettings
      documents={[doc()]}
      supported={false}
      onExportZip={onExportZip}
      vaultName="我的 Vault"
      filePath="LifeOps/Knowledge/证据 1.md"
    />)

    expect(screen.getByText(/浏览器不支持文件夹连接/)).toBeInTheDocument()
    expect(screen.queryByText(/已连接/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /导出 ZIP/ }))
    expect(onExportZip).toHaveBeenCalledWith([doc()])
    expect(screen.getByLabelText(/导入 ZIP/)).toHaveAttribute('type', 'file')
    expect(screen.getByRole('link', { name: /在 Obsidian 中打开/ })).toHaveAttribute(
      'href',
      'obsidian://open?vault=%E6%88%91%E7%9A%84%20Vault&file=LifeOps%2FKnowledge%2F%E8%AF%81%E6%8D%AE%201.md',
    )
  })

  it('reports denied permission without storing a false connected state', async () => {
    const user = userEvent.setup()
    render(<ObsidianSettings
      documents={[doc()]}
      supported
      connect={vi.fn(async () => ({
        permission: 'denied' as PermissionState,
        vaultName: 'Denied vault',
        scan: vi.fn(async () => plan()),
      }))}
    />)

    await user.click(screen.getByRole('button', { name: /连接文件夹/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/权限.*拒绝/)
    expect(screen.queryByText(/已连接/)).not.toBeInTheDocument()
  })

  it('scans first, previews every action and waits for explicit apply confirmation', async () => {
    const user = userEvent.setup()
    const scan = vi.fn(async () => plan())
    const onApply = vi.fn(async () => undefined)
    render(<ObsidianSettings
      documents={[doc()]}
      supported
      connect={vi.fn(async () => ({ permission: 'granted' as PermissionState, vaultName: 'Life vault', scan }))}
      onApply={onApply}
    />)

    await user.click(screen.getByRole('button', { name: /连接文件夹/ }))
    expect(await screen.findByText('已连接 · Life vault')).toBeInTheDocument()
    expect(scan).toHaveBeenCalledTimes(1)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText(/create-vault/)).toBeInTheDocument()
    expect(screen.getByText(/conflict/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/2 项.*1 个冲突/)
    expect(onApply).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /确认并应用/ })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '保留 Web 版本' }))
    await user.click(screen.getByRole('button', { name: /确认并应用/ }))
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith(plan(), { 'note-2': 'keep-web' })
  })

  it('previews an imported ZIP before allowing apply', async () => {
    const user = userEvent.setup()
    const onImportZip = vi.fn(async () => plan())
    const onApply = vi.fn(async () => undefined)
    render(<ObsidianSettings
      documents={[doc()]}
      supported={false}
      onImportZip={onImportZip}
      onApply={onApply}
    />)

    const file = new File(['zip'], 'lifeops.zip', { type: 'application/zip' })
    await user.upload(screen.getByLabelText(/导入 ZIP/), file)
    expect(onImportZip).toHaveBeenCalledWith(file)
    expect(await screen.findByText(/2 项.*1 个冲突/)).toBeInTheDocument()
    expect(onApply).not.toHaveBeenCalled()
  })
})
