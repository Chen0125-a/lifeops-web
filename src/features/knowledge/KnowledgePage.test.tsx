import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpError } from '../../api/httpClient'
import type { KnowledgeCollection, KnowledgeNote } from '../../domain/knowledge'
import { KnowledgePage } from './KnowledgePage'

const { knowledgeApiMock } = vi.hoisted(() => ({
  knowledgeApiMock: {
    addRelation: vi.fn(),
    archive: vi.fn(),
    create: vi.fn(),
    createCollection: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    listCollections: vi.fn(),
    remove: vi.fn(),
    removeCollection: vi.fn(),
    removeRelation: vi.fn(),
    resurface: vi.fn(),
    restore: vi.fn(),
    update: vi.fn(),
    updateCollection: vi.fn(),
  },
}))

vi.mock('../../api/knowledgeApi', () => ({ knowledgeApi: knowledgeApiMock }))
vi.mock('../../state/AuthContext', () => ({ useAuth: () => ({ csrfToken: 'csrf-knowledge' }) }))

function note(id: string, patch: Partial<KnowledgeNote> = {}): KnowledgeNote {
  return {
    id,
    title: id,
    body: `# ${id}\n\n可追溯的知识正文。`,
    tags: ['lifeops'],
    collectionIds: ['collection-work'],
    sourceLinks: [],
    relatedIds: [],
    pinned: false,
    favorite: false,
    reviewOn: null,
    version: 4,
    createdAt: '2026-08-20T08:00:00.000Z',
    updatedAt: '2026-08-20T08:00:00.000Z',
    archivedAt: null,
    deletedAt: null,
    ...patch,
  }
}

const notes = [
  note('note-derived', {
    title: '从复盘提炼发布门禁',
    tags: ['k8s', '发布'],
    sourceLinks: [{ type: 'review', id: 'review-week-32' }],
    relatedIds: ['note-observability'],
    pinned: true,
    favorite: true,
    reviewOn: '2026-08-22',
  }),
  note('note-observability', {
    title: '可观测性要保留来源',
    tags: ['k8s', '可观测性'],
    collectionIds: ['collection-tech'],
    sourceLinks: [{ type: 'record', id: 'record-incident-7' }],
  }),
  note('note-rhythm', {
    title: '每周回顾节奏',
    tags: ['复盘'],
    collectionIds: ['collection-work'],
  }),
]

const collections: KnowledgeCollection[] = [
  { id: 'collection-work', name: '工作', color: '#D95D39', position: 1, version: 1 },
  { id: 'collection-tech', name: '技术', color: '#2E6F65', position: 2, version: 1 },
]

function renderKnowledge(initialEntry = '/app/knowledge?note=note-derived') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  })
  const router = createMemoryRouter([
    { path: '/app/knowledge', element: <KnowledgePage /> },
  ], { initialEntries: [initialEntry] })
  return {
    router,
    ...render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>),
  }
}

describe('KnowledgePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    knowledgeApiMock.list.mockResolvedValue({ items: notes })
    knowledgeApiMock.listCollections.mockResolvedValue(collections)
    knowledgeApiMock.resurface.mockResolvedValue([notes[0]])
    knowledgeApiMock.get.mockImplementation(async (id: string) => notes.find((item) => item.id === id))
    knowledgeApiMock.update.mockImplementation(async (id: string, input: Record<string, unknown>) => ({
      ...notes.find((item) => item.id === id)!,
      ...input,
      version: Number(input.version) + 1,
      updatedAt: '2026-08-22T10:00:00.000Z',
    }))
    knowledgeApiMock.archive.mockImplementation(async (id: string, version: number) => ({
      ...notes.find((item) => item.id === id)!, archivedAt: '2026-08-22T10:00:00.000Z', version: version + 1,
    }))
    knowledgeApiMock.remove.mockResolvedValue(undefined)
    knowledgeApiMock.restore.mockImplementation(async (id: string, version: number) => ({
      ...notes.find((item) => item.id === id)!, deletedAt: null, version: version + 1,
    }))
  })

  it('renders the native 2.5/3.5/6 library, note list and reader with collections, topics, tags and resurfacing', async () => {
    renderKnowledge()

    expect(await screen.findByRole('heading', { level: 1, name: '知识' })).toBeVisible()
    const library = screen.getByRole('navigation', { name: '知识资料库' })
    const list = screen.getByRole('region', { name: '知识列表' })
    let reader = screen.getByRole('region', { name: '知识阅读与编辑' })
    expect(library).toHaveAttribute('data-grid-span', '2.5')
    expect(list).toHaveAttribute('data-grid-span', '3.5')
    expect(reader).toHaveAttribute('data-grid-span', '6')

    expect(await within(library).findByRole('button', { name: '资料库 工作' })).toBeVisible()
    expect(within(library).getByRole('button', { name: '资料库 技术' })).toBeVisible()
    expect(within(library).getByRole('button', { name: '主题 k8s' })).toBeVisible()
    expect(within(library).getByRole('button', { name: '标签 发布' })).toBeVisible()
    expect(within(list).getByRole('button', { name: /从复盘提炼发布门禁/ })).toHaveAttribute('aria-current', 'true')
    await screen.findByRole('heading', { name: '从复盘提炼发布门禁' })
    reader = screen.getByRole('region', { name: '知识阅读与编辑' })
    expect(within(reader).getByRole('heading', { name: '从复盘提炼发布门禁' })).toBeVisible()
    expect(within(reader).getByRole('button', { name: '来源 回顾 review-week-32' })).toBeVisible()
    expect(within(reader).getByRole('button', { name: '相关知识 可观测性要保留来源' })).toBeVisible()
    expect(within(reader).getByText('2026年8月22日复习')).toBeVisible()

    const resurfaced = screen.getByRole('region', { name: '今天重现' })
    expect(resurfaced).toHaveTextContent('从复盘提炼发布门禁')
  })

  it('maps the shareable authenticated URL to exact filters and keeps the selected matching note', async () => {
    const { router } = renderKnowledge('/app/knowledge?collection=collection-work&tag=k8s&source=review&q=%E5%8F%91%E5%B8%83&note=note-derived')

    await screen.findByRole('region', { name: '知识列表' })
    await waitFor(() => expect(knowledgeApiMock.list).toHaveBeenCalledWith({
      collectionId: 'collection-work',
      q: '发布',
      source: 'review',
      tag: 'k8s',
    }, expect.any(AbortSignal)))
    expect(screen.getByRole('searchbox', { name: '搜索知识' })).toHaveValue('发布')
    expect(screen.getByRole('region', { name: '知识阅读与编辑' })).toHaveTextContent('从复盘提炼发布门禁')

    await router.navigate('/app/knowledge?collection=collection-work&tag=%E5%8F%91%E5%B8%83&note=note-derived')
    await waitFor(() => expect(screen.getByRole('region', { name: '知识阅读与编辑' })).toHaveTextContent('从复盘提炼发布门禁'))
    expect(router.state.location.search).toContain('note=note-derived')
  })

  it('pins, favorites, archives, deletes and restores the same note with optimistic versions', async () => {
    const user = userEvent.setup()
    renderKnowledge('/app/knowledge?note=note-observability')
    await screen.findByRole('heading', { name: '可观测性要保留来源' })
    const reader = screen.getByRole('region', { name: '知识阅读与编辑' })

    await user.click(within(reader).getByRole('button', { name: '置顶知识' }))
    expect(knowledgeApiMock.update).toHaveBeenLastCalledWith('note-observability', { pinned: true, version: 4 }, 'csrf-knowledge')
    await user.click(within(reader).getByRole('button', { name: '收藏知识' }))
    expect(knowledgeApiMock.update).toHaveBeenLastCalledWith('note-observability', { favorite: true, version: 5 }, 'csrf-knowledge')
    await user.click(within(reader).getByRole('button', { name: '归档知识' }))
    expect(knowledgeApiMock.archive).toHaveBeenLastCalledWith('note-observability', 6, 'csrf-knowledge')
    await user.click(within(reader).getByRole('button', { name: '删除知识' }))
    expect(knowledgeApiMock.remove).toHaveBeenLastCalledWith('note-observability', 7, 'csrf-knowledge')

    await user.click(await screen.findByRole('button', { name: '恢复刚删除的知识' }))
    expect(knowledgeApiMock.restore).toHaveBeenLastCalledWith('note-observability', 8, 'csrf-knowledge')
    expect(await screen.findByRole('heading', { name: '可观测性要保留来源' })).toBeVisible()
  })

  it('supports roving library/list focus, Enter open, Escape back and exact list scroll restoration', async () => {
    const user = userEvent.setup()
    const { router } = renderKnowledge('/app/knowledge')
    const library = await screen.findByRole('navigation', { name: '知识资料库' })
    const work = await within(library).findByRole('button', { name: '资料库 工作' })
    work.focus()
    await user.keyboard('{ArrowDown}')
    expect(within(library).getByRole('button', { name: '资料库 技术' })).toHaveFocus()

    const list = screen.getByRole('region', { name: '知识列表' })
    Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value: 184 })
    const first = within(list).getByRole('button', { name: /从复盘提炼发布门禁/ })
    first.focus()
    await user.keyboard('{ArrowDown}')
    const second = within(list).getByRole('button', { name: /可观测性要保留来源/ })
    expect(second).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(router.state.location.search).toContain('note=note-observability'))
    expect(screen.getByRole('button', { name: '返回知识列表' })).toHaveFocus()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(router.state.location.search).not.toContain('note='))
    expect(second).toHaveFocus()
    expect(list.scrollTop).toBe(184)
  })

  it('keeps an autosave conflict inside the editor instead of replacing the whole-page query state', async () => {
    const user = userEvent.setup()
    knowledgeApiMock.update.mockRejectedValueOnce(new HttpError(
      'VERSION_CONFLICT',
      '知识已在另一处更新',
      409,
      'request-knowledge-page-409',
    ))
    renderKnowledge('/app/knowledge?note=note-derived')

    await screen.findByRole('heading', { name: '从复盘提炼发布门禁' })
    await user.click(screen.getByRole('button', { name: '编辑知识' }))
    await user.clear(screen.getByLabelText('Markdown 正文'))
    await user.type(screen.getByLabelText('Markdown 正文'), '不能覆盖的本地新证据')

    const editorConflict = await screen.findByRole('alert', { name: '知识保存冲突' }, { timeout: 2_000 })
    expect(editorConflict).toBeVisible()
    expect(screen.getAllByRole('alert')).toEqual([editorConflict])
    expect(screen.queryByText('知识已在另一处更新，本地内容没有覆盖服务器版本。')).not.toBeInTheDocument()
  })
})
