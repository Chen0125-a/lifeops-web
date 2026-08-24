import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appRoutes } from '../../../App'
import { queryClient } from '../../../api/queryClient'
import type { ExportJob, ImportApplyResult, ImportPreview } from '../../../domain/lifeCommerce'
import { LOCAL_SESSION_KEY } from '../../../state/AuthContext'

const { commerceApi, catalogApi } = vi.hoisted(() => ({
  commerceApi: {
    listInventoryPolicies: vi.fn(), listShopping: vi.fn(), listBudgets: vi.fn(), getAnalytics: vi.fn(), listExports: vi.fn(),
    upsertInventoryPolicy: vi.fn(), recalculateShopping: vi.fn(), createSuggestion: vi.fn(), createShoppingItem: vi.fn(),
    createPurchase: vi.fn(), createRefund: vi.fn(), createBudget: vi.fn(), createExport: vi.fn(), previewImport: vi.fn(), applyImport: vi.fn(),
  },
  catalogApi: { listTrash: vi.fn(), restore: vi.fn() },
}))

vi.mock('../../../api/lifeCommerceApi', () => ({ lifeCommerceApi: commerceApi }))
vi.mock('../../../api/lifeCatalogApi', () => ({ lifeCatalogApi: catalogApi }))

const payload = { catalogItems: [], shoppingItems: [], purchases: [], refunds: [], budgets: [] }
const existingExport: ExportJob = {
  id: 'export-existing', status: 'completed', reason: 'user-export', format: 'json', formatVersion: 1,
  checksumSha256: 'a'.repeat(64), recordCounts: { catalogItems: 8, shoppingItems: 2, budgets: 1 },
  payload, canonicalJson: '{}', createdAt: '2026-08-22T08:00:00.000Z',
}
const zipExport: ExportJob = {
  id: 'export-zip', status: 'completed', reason: 'user-export', format: 'zip', formatVersion: 1,
  checksumSha256: 'b'.repeat(64), recordCounts: { catalogItems: 8, media: 3 }, archiveBase64: 'UEsDBA==',
  archiveEntries: ['manifest.json', 'data.json', 'media/image-1.webp'], createdAt: '2026-08-22T09:00:00.000Z',
}
const conflictPreview: ImportPreview = {
  id: 'import-1', mode: 'replace', status: 'conflicts', payload,
  conflicts: [{ entityType: 'budget', entityId: 'budget-august', currentVersion: 2, incomingVersion: 3, resolutions: ['keep-current', 'use-imported', 'duplicate'] }],
  errors: [], createdAt: '2026-08-22T10:00:00.000Z',
}

function renderRoute(path = '/app/life/data?section=export') {
  sessionStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ mode: 'local-preview', account: 'owner@example.com' }))
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  return { router, ...render(<RouterProvider router={router} />) }
}

describe('life export, import and recovery workspace', () => {
  beforeEach(() => {
    queryClient.clear()
    commerceApi.listExports.mockReset().mockResolvedValue([existingExport])
    commerceApi.createExport.mockReset().mockResolvedValue(zipExport)
    commerceApi.previewImport.mockReset().mockResolvedValue(conflictPreview)
    commerceApi.applyImport.mockReset().mockResolvedValue({ status: 'applied', importId: 'import-1', restorePointExportId: 'restore-1', appliedRows: 12 } satisfies ImportApplyResult)
    catalogApi.listTrash.mockReset().mockResolvedValue([])
    catalogApi.restore.mockReset()
  })

  it('shows versioned export manifests, attachment boundaries and the existing relationship-safe trash without conflating them', async () => {
    const user = userEvent.setup()
    renderRoute()

    expect(await screen.findByRole('heading', { name: '生活数据管理', level: 1 })).toBeVisible()
    expect(screen.getByRole('navigation', { name: '生活数据分区' })).toBeVisible()
    const manifest = await screen.findByRole('region', { name: '导出清单' })
    expect(within(manifest).getByText('格式版本 1')).toBeVisible()
    expect(within(manifest).getByText(`SHA-256 ${'a'.repeat(64)}`)).toBeVisible()
    expect(within(manifest).getByText('目录物品 8 · 正式采购 2 · 预算 1')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '创建导出' }))
    const dialog = screen.getByRole('dialog', { name: '创建生活数据导出' })
    await user.selectOptions(within(dialog).getByLabelText('格式'), 'zip')
    await user.click(within(dialog).getByLabelText('包含私有附件'))
    expect(within(dialog).getByText('附件仍保持私有；导出包不会变成公开发布内容。')).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: '生成导出包' }))
    await waitFor(() => expect(commerceApi.createExport).toHaveBeenCalledWith({ format: 'zip', includeAttachments: true }, expect.any(String), undefined))
    expect(await screen.findByText(`SHA-256 ${'b'.repeat(64)}`)).toBeVisible()

    await user.click(screen.getByRole('tab', { name: '回收站' }))
    expect(await screen.findByRole('region', { name: '生活数据回收站' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /永久删除/ })).not.toBeInTheDocument()
  })

  it('requires a successful preview and explicit conflict decisions before replace can create a restore point and apply', async () => {
    const user = userEvent.setup()
    renderRoute('/app/life/data?section=import')
    await screen.findByRole('heading', { name: '生活数据管理' })

    fireEvent.change(screen.getByLabelText('导入 JSON'), { target: { value: '{"formatVersion":1}' } })
    await user.type(screen.getByLabelText('SHA-256'), 'c'.repeat(64))
    await user.click(screen.getByRole('radio', { name: '替换现有生活数据' }))
    expect(screen.queryByRole('button', { name: '应用导入' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '只预览，不写入' }))
    await waitFor(() => expect(commerceApi.previewImport).toHaveBeenCalledWith({
      formatVersion: 1, checksumSha256: 'c'.repeat(64), canonicalJson: '{"formatVersion":1}', mode: 'replace',
    }, expect.any(String), undefined))

    const preview = screen.getByRole('region', { name: '导入预览' })
    expect(within(preview).getByText('写入尚未发生')).toBeVisible()
    expect(within(preview).getByText('budget · budget-august · 当前 v2 / 导入 v3')).toBeVisible()
    expect(within(preview).getByRole('button', { name: '应用导入' })).toBeDisabled()
    await user.click(within(preview).getByRole('radio', { name: '使用导入版本' }))
    await user.click(within(preview).getByRole('button', { name: '应用导入' }))

    const confirmation = screen.getByRole('dialog', { name: '确认替换生活数据' })
    expect(within(confirmation).getByText('服务端会先创建恢复点；任何失败都必须回滚，当前数据保持不变。')).toBeVisible()
    await user.click(within(confirmation).getByRole('button', { name: '创建恢复点并替换' }))
    await waitFor(() => expect(commerceApi.applyImport).toHaveBeenCalledWith('import-1', [{
      entityType: 'budget', entityId: 'budget-august', resolution: 'use-imported',
    }], expect.any(String), undefined))
    expect(await screen.findByRole('status', { name: '导入结果' })).toHaveTextContent('已应用 12 行 · 恢复点 restore-1')
  })

  it('reports exact invalid or failed rows and never presents a failed replace as live data', async () => {
    const user = userEvent.setup()
    commerceApi.previewImport.mockResolvedValueOnce({
      ...conflictPreview, id: 'import-invalid', status: 'invalid', conflicts: [],
      errors: [{ entityType: 'catalog-item', entityId: 'oat', code: 'UNIT_UNKNOWN', message: '单位 missing-unit 不存在' }],
    })
    renderRoute('/app/life/data?section=import')
    await screen.findByRole('heading', { name: '生活数据管理' })
    fireEvent.change(screen.getByLabelText('导入 JSON'), { target: { value: '{}' } })
    await user.type(screen.getByLabelText('SHA-256'), 'd'.repeat(64))
    await user.click(screen.getByRole('button', { name: '只预览，不写入' }))
    const invalid = await screen.findByRole('region', { name: '导入预览' })
    expect(within(invalid).getByText('catalog-item / oat / UNIT_UNKNOWN / 单位 missing-unit 不存在')).toBeVisible()
    expect(within(invalid).queryByRole('button', { name: '应用导入' })).not.toBeInTheDocument()

    commerceApi.previewImport.mockResolvedValueOnce({ ...conflictPreview, status: 'ready', conflicts: [] })
    commerceApi.applyImport.mockRejectedValueOnce(Object.assign(new Error('budget / budget-august / 写入失败'), {
      details: { restorePointExportId: 'restore-failed', appliedRows: 0 },
    }))
    await user.click(screen.getByRole('button', { name: '只预览，不写入' }))
    await user.click(await screen.findByRole('button', { name: '应用导入' }))
    await user.click(screen.getByRole('button', { name: '确认合并' }))
    const failure = await screen.findByRole('alert')
    expect(failure).toHaveTextContent('budget / budget-august / 写入失败')
    expect(failure).toHaveTextContent('已应用 0 行；当前生活数据未改变；恢复点 restore-failed 可用于审计')
    expect(screen.queryByText('导入已完成')).not.toBeInTheDocument()
  })
})
