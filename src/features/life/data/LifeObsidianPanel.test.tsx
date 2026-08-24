import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { LifeProjectionDocument, LifeProjectionType } from '../../../integrations/obsidian/lifeProjection'
import { LifeObsidianPanel, type LifeObsidianConnection } from './LifeObsidianPanel'

const updatedAt = '2026-08-22T08:00:00.000Z'

function document(type: LifeProjectionType, id: string, version: number, body: string): LifeProjectionDocument {
  return { lifeopsId: id, type, version, updatedAt, title: id, tags: [], body, path: `LifeOps/Life/${type}/${id}.md` }
}

describe('Life Obsidian panel', () => {
  it('scans before writes, exports selected types and requires conflict/version actions before a backed-up apply', async () => {
    const user = userEvent.setup()
    const apply = vi.fn().mockResolvedValue({ backupPath: 'LifeOps/.lifeops-backup/2026-08-22', completedPaths: ['recipe.md'], failedPaths: [] })
    const connection: LifeObsidianConnection = {
      permission: 'granted', vaultName: 'My Life Vault',
      scan: vi.fn().mockResolvedValue([
        document('recipe', 'recipe-1', 2, '# Obsidian recipe edit'),
        document('life-review', 'review-1', 1, '# Obsidian review edit'),
      ]),
      apply,
    }
    const connect = vi.fn().mockResolvedValue(connection)
    const exportZip = vi.fn()
    render(<LifeObsidianPanel
      supported
      documents={[
        document('recipe', 'recipe-1', 2, '# Web recipe'),
        document('life-review', 'review-1', 1, '# Web review'),
        document('budget-summary', 'budget-1', 1, '# Budget'),
      ]}
      connect={connect}
      onExportZip={exportZip}
    />)

    await user.click(screen.getByRole('checkbox', { name: '预算摘要' }))
    await user.click(screen.getByRole('button', { name: '导出所选 ZIP' }))
    expect(exportZip).toHaveBeenCalledWith(expect.not.arrayContaining([expect.objectContaining({ type: 'budget-summary' })]))

    await user.click(screen.getByRole('button', { name: '连接并扫描' }))
    expect(apply).not.toHaveBeenCalled()
    const preview = await screen.findByRole('region', { name: 'Life Obsidian 同步预览' })
    expect(within(preview).getByText('首次连接只完成扫描与预览，尚未写入任何文件。')).toBeVisible()
    expect(within(preview).getByText('# Web recipe')).toBeVisible()
    expect(within(preview).getByText('# Obsidian recipe edit')).toBeVisible()
    expect(within(preview).getByRole('button', { name: '确认应用' })).toBeDisabled()

    await user.click(within(preview).getByRole('radio', { name: '创建新的配方版本' }))
    await user.click(within(preview).getByRole('radio', { name: '采用 Obsidian 回顾' }))
    await user.click(within(preview).getByRole('button', { name: '确认应用' }))
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/写入前备份.*LifeOps\/\.lifeops-backup\/2026-08-22/)).toBeVisible()
  })

  it('uses ZIP fallback without claiming a folder connection', async () => {
    const user = userEvent.setup()
    const importZip = vi.fn().mockResolvedValue([document('fitness-summary', 'fitness-1', 1, '# Ride')])
    render(<LifeObsidianPanel supported={false} documents={[document('fitness-summary', 'fitness-1', 1, '# Ride')]} onExportZip={vi.fn()} onImportZip={importZip} />)
    expect(screen.getByText('当前浏览器不支持文件夹连接；可使用 ZIP 手动往返。')).toBeVisible()
    expect(screen.queryByText(/已连接/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('导入 Life Obsidian ZIP'), { target: { files: [new File(['zip'], 'life.zip', { type: 'application/zip' })] } })
    await waitFor(() => expect(importZip).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('region', { name: 'Life Obsidian 同步预览' })).toBeVisible()
  })

  it('returns to a degraded unconnected state when permission is lost', async () => {
    const user = userEvent.setup()
    const connection: LifeObsidianConnection = {
      permission: 'granted', vaultName: 'My Life Vault', scan: vi.fn().mockResolvedValue([]),
      apply: vi.fn().mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError')),
    }
    render(<LifeObsidianPanel supported documents={[document('budget-summary', 'budget-1', 1, '# Budget')]} connect={vi.fn().mockResolvedValue(connection)} />)
    await user.click(screen.getByRole('button', { name: '连接并扫描' }))
    expect(await screen.findByText('已连接 · My Life Vault')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '确认应用' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('文件夹权限已失效')
    expect(screen.queryByText('已连接 · My Life Vault')).not.toBeInTheDocument()
    expect(screen.getByText('降级状态 · 尚未连接')).toBeVisible()
  })
})
