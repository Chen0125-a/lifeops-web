import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LifeRecord, MediaAsset } from '../../domain/records'
import { RecordsPage } from './RecordsPage'

const { mediaApiMock, recordsApiMock } = vi.hoisted(() => ({
  mediaApiMock: {
    upload: vi.fn(),
    privateUrl: vi.fn((id: string) => `/api/v1/media/${encodeURIComponent(id)}`),
    publicUrl: vi.fn((id: string) => `/api/v1/public/media/${encodeURIComponent(id)}`),
  },
  recordsApiMock: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    restore: vi.fn(),
  },
}))

vi.mock('../../api/mediaApi', () => ({ mediaApi: mediaApiMock }))
vi.mock('../../api/recordsApi', () => ({ recordsApi: recordsApiMock }))
vi.mock('../../state/AuthContext', () => ({ useAuth: () => ({ csrfToken: 'csrf-records' }) }))

type CoveredRecord = LifeRecord & { coverMediaId: string | null }

function record(id: string, patch: Partial<CoveredRecord> = {}): CoveredRecord {
  return {
    id,
    title: id,
    body: `# ${id}\n\n真实发生的记录。`,
    occurredAt: '2026-08-15T09:30:00.000Z',
    tags: ['lifeops'],
    pinned: false,
    archivedAt: null,
    links: [],
    mediaIds: [],
    coverMediaId: null,
    version: 3,
    createdAt: '2026-08-15T09:30:00.000Z',
    updatedAt: '2026-08-15T09:30:00.000Z',
    deletedAt: null,
    ...patch,
  }
}

const records: CoveredRecord[] = [
  record('record-release', {
    title: '发布前的闭环检查',
    links: [
      { type: 'task', id: 'task:lifeops:step-4' },
      { type: 'project', id: 'project-lifeops' },
    ],
    mediaIds: ['media-cover', 'media-detail'],
    coverMediaId: 'media-cover',
  }),
  record('record-walk', { title: '午后散步', occurredAt: '2026-08-15T06:00:00.000Z', tags: ['生活'] }),
  record('record-yesterday', { title: '昨日复盘', occurredAt: '2026-08-14T12:00:00.000Z' }),
]

function renderRecords(initialEntry = '/app/records?record=record-release') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  })
  const router = createMemoryRouter([
    { path: '/app/records', element: <RecordsPage now={new Date('2026-08-15T12:00:00+08:00')} /> },
  ], { initialEntries: [initialEntry] })
  return {
    router,
    ...render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>),
  }
}

describe('RecordsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    recordsApiMock.list.mockResolvedValue(records)
    recordsApiMock.get.mockImplementation(async (id: string) => records.find((item) => item.id === id))
    recordsApiMock.update.mockImplementation(async (id: string, input: Record<string, unknown>) => ({
      ...records.find((item) => item.id === id)!,
      ...input,
      version: Number(input.version) + 1,
    }))
    recordsApiMock.remove.mockResolvedValue(undefined)
    recordsApiMock.restore.mockImplementation(async (id: string, version: number) => ({
      ...records.find((item) => item.id === id)!, deletedAt: null, version: version + 1,
    }))
  })

  it('renders the native 8/4 date-grouped stream, selected editor, links and private cover truth', async () => {
    renderRecords()

    expect(await screen.findByRole('heading', { level: 1, name: '记录' })).toBeVisible()
    const stream = screen.getByRole('region', { name: '记录时间流' })
    expect(stream).toHaveAttribute('data-grid-span', '8')
    const today = await within(stream).findByRole('group', { name: '2026年8月15日' })
    expect(today).toHaveTextContent('发布前的闭环检查')
    expect(today).toHaveTextContent('午后散步')
    expect(await within(stream).findByRole('group', { name: '2026年8月14日' })).toHaveTextContent('昨日复盘')

    const editor = screen.getByRole('region', { name: '记录编辑器' })
    expect(editor).toHaveAttribute('data-grid-span', '4')
    expect(within(editor).getByLabelText('标题')).toHaveValue('发布前的闭环检查')
    expect((within(editor).getByLabelText('Markdown 正文') as HTMLTextAreaElement).value).toContain('真实发生')
    expect(within(editor).getByText('任务 · task:lifeops:step-4')).toBeVisible()
    expect(within(editor).getByText('项目 · project-lifeops')).toBeVisible()
    expect(within(editor).getByRole('img', { name: '发布前的闭环检查封面' }))
      .toHaveAttribute('src', '/api/v1/media/media-cover')
    expect(within(editor).getByText('仅自己可见')).toBeVisible()
    expect(within(editor).getByRole('button', { name: '当前封面 media-cover' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('decodes source once, splits at the first colon and maps only to existing paired filters', async () => {
    renderRecords('/app/records?record=record-release&from=2026-08-01&to=2026-08-15&tag=lifeops&source=task:task%3Alifeops%3Astep-4&q=%E9%97%AD%E7%8E%AF')

    await screen.findByRole('heading', { level: 1, name: '记录' })
    await waitFor(() => expect(recordsApiMock.list).toHaveBeenCalledWith({
      from: '2026-08-01',
      to: '2026-08-15',
      tag: 'lifeops',
      linkType: 'task',
      linkId: 'task:lifeops:step-4',
      q: '闭环',
    }, expect.any(AbortSignal)))
    expect(screen.getByLabelText('来源')).toHaveValue('task:task:lifeops:step-4')
    expect(screen.queryByRole('alert', { name: '来源筛选错误' })).not.toBeInTheDocument()
  })

  it.each([
    ['/app/records?source=task', '缺少分隔符'],
    ['/app/records?source=unknown:item-1', '未知类型'],
    ['/app/records?source=task:', '缺少 ID'],
    ['/app/records?source=goal:goal-1&source=task:task-1', '重复来源'],
  ])('contains invalid source as a scoped error and sends no malformed request: %s', async (entry) => {
    renderRecords(entry)

    expect(await screen.findByRole('heading', { level: 1, name: '记录' })).toBeVisible()
    expect(screen.getByRole('alert', { name: '来源筛选错误' })).toHaveTextContent('来源筛选格式无效')
    expect(screen.getByRole('region', { name: '记录工作区' })).toBeVisible()
    expect(recordsApiMock.list).not.toHaveBeenCalled()
  })

  it('pins, archives, deletes and restores the same record with optimistic versions', async () => {
    const user = userEvent.setup()
    renderRecords()
    await screen.findByRole('button', { name: '置顶记录' })
    const editor = screen.getByRole('region', { name: '记录编辑器' })

    await user.click(within(editor).getByRole('button', { name: '置顶记录' }))
    expect(recordsApiMock.update).toHaveBeenLastCalledWith('record-release', { pinned: true, version: 3 }, 'csrf-records')
    await waitFor(() => expect(within(editor).getByRole('button', { name: '归档记录' })).toBeEnabled())

    await user.click(within(editor).getByRole('button', { name: '归档记录' }))
    expect(recordsApiMock.update).toHaveBeenLastCalledWith('record-release', { archived: true, version: 4 }, 'csrf-records')

    await user.click(within(editor).getByRole('button', { name: '删除记录' }))
    expect(recordsApiMock.remove).toHaveBeenLastCalledWith('record-release', 5, 'csrf-records')
    await user.click(await screen.findByRole('button', { name: '恢复刚删除的记录' }))
    expect(recordsApiMock.restore).toHaveBeenLastCalledWith('record-release', 6, 'csrf-records')
    expect(await screen.findByText('发布前的闭环检查')).toBeVisible()
  })

  it('creates a task-linked private record with uploaded media and an explicit cover identity', async () => {
    const user = userEvent.setup()
    const uploaded: MediaAsset = {
      id: 'media-new', visibility: 'private', mimeType: 'image/png', originalName: 'proof.png', sizeBytes: 5,
      checksum: 'A'.repeat(64), width: 800, height: 600, version: 1,
      createdAt: '2026-08-15T12:00:00.000Z', updatedAt: '2026-08-15T12:00:00.000Z', deletedAt: null,
    }
    mediaApiMock.upload.mockImplementation(async (_file: File, options: { onStatus?: (status: string) => void }) => {
      options.onStatus?.('queued')
      options.onStatus?.('uploading')
      options.onStatus?.('stored')
      return uploaded
    })
    recordsApiMock.create.mockImplementation(async (input: Record<string, unknown>) => record('record-new', {
      ...(input as Partial<CoveredRecord>), version: 1,
    }))
    renderRecords('/app/records?create=record&source=task:task-closed-loop')
    const editor = await screen.findByRole('region', { name: '记录编辑器' })

    await user.type(within(editor).getByLabelText('标题'), '任务完成记录')
    await user.type(within(editor).getByLabelText('Markdown 正文'), '完成了真实闭环。')
    await user.upload(within(editor).getByLabelText('上传图片'), new File(['proof'], 'proof.png', { type: 'image/png' }))
    expect(await within(editor).findByText('上传完成')).toBeVisible()
    await user.click(within(editor).getByRole('button', { name: '设为封面 proof.png' }))
    await user.click(within(editor).getByRole('button', { name: '创建记录' }))

    expect(recordsApiMock.create).toHaveBeenCalledWith(expect.objectContaining({
      title: '任务完成记录',
      body: '完成了真实闭环。',
      links: [{ type: 'task', id: 'task-closed-loop' }],
      mediaIds: ['media-new'],
      coverMediaId: 'media-new',
    }), expect.stringMatching(/^record:/), 'csrf-records')
    expect(await screen.findByText('仅自己可见')).toBeVisible()
  })
})
