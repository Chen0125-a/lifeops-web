import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { publicContentApi } from '../api/publicContentApi'
import { createMemoryStorage, LifeRepository } from '../domain/lifeRepository'
import { LifeDataProvider } from '../state/LifeDataContext'
import { PublicSnapshotPage } from './PublicSnapshotPage'

const renderSnapshot = (repository: LifeRepository, id: string) => render(
  <LifeDataProvider repository={repository}>
    <MemoryRouter initialEntries={[`/snapshots/${id}`]}>
      <Routes><Route path="/snapshots/:id" element={<PublicSnapshotPage />} /><Route path="/p/:slug" element={<p>稳定公开地址</p>} /></Routes>
    </MemoryRouter>
  </LifeDataProvider>,
)

describe('PublicSnapshotPage', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shows only an explicitly published allowlisted copy', () => {
    const repository = new LifeRepository({ storage: createMemoryStorage() })
    const record = repository.createRecord({ title: '来源记录', body: '完整私密正文。' })
    const note = repository.createKnowledgeNote({ sourceType: 'record', sourceId: record.id, title: '来源知识', body: '沉淀内容。' })
    const snapshot = repository.createSnapshot({ sourceType: 'knowledge', sourceId: note.id, title: '公开标题', excerpt: '允许公开的摘录。' })
    repository.publishSnapshot(snapshot.id)

    renderSnapshot(repository, snapshot.id)

    expect(screen.getByText('稳定公开地址')).toBeInTheDocument()
    expect(screen.queryByText('完整私密正文。')).not.toBeInTheDocument()
  })

  it('refuses access after the owner revokes publication', () => {
    const repository = new LifeRepository({ storage: createMemoryStorage() })
    const record = repository.createRecord({ title: '来源记录', body: '完整私密正文。' })
    const snapshot = repository.createSnapshot({ sourceType: 'record', sourceId: record.id, title: '已撤回', excerpt: '不再公开' })
    repository.publishSnapshot(snapshot.id)
    repository.revokeSnapshot(snapshot.id)

    renderSnapshot(repository, snapshot.id)

    expect(screen.getByRole('heading', { name: '这份快照当前不可公开访问' })).toBeInTheDocument()
    expect(screen.queryByText('不再公开')).not.toBeInTheDocument()
  })

  it('renders only a revision-backed public whitelist at the stable /p/:slug route', async () => {
    vi.spyOn(publicContentApi, 'get').mockResolvedValueOnce({
      body: '# 公开正文\n\n只包含允许字段。', category: 'learning', coverUrl: null,
      excerpt: '允许公开的摘要', featured: true, publishedAt: '2026-08-22T10:00:00.000Z',
      revision: 3, slug: 'release-gate', tags: ['public'], title: '发布门禁', updatedAt: '2026-08-22T09:00:00.000Z',
    })
    const repository = new LifeRepository({ storage: createMemoryStorage() })
    render(<LifeDataProvider repository={repository}><MemoryRouter initialEntries={['/p/release-gate']}><Routes><Route path="/p/:slug" element={<PublicSnapshotPage />} /></Routes></MemoryRouter></LifeDataProvider>)

    expect(await screen.findByRole('heading', { name: '发布门禁' })).toBeVisible()
    expect(screen.getByText('只包含允许字段。')).toBeVisible()
    expect(screen.getByText('Revision 3')).toBeVisible()
    expect(document.body.textContent).not.toMatch(/source|owner|PRIVATE_SOURCE_SENTINEL/i)
  })

  it('redirects a live legacy snapshot URL to its stable slug and keeps revoked or unknown content unavailable', async () => {
    const repository = new LifeRepository({ storage: createMemoryStorage() })
    const record = repository.createRecord({ title: '来源记录', body: '私人正文' })
    const snapshot = repository.createSnapshot({ sourceType: 'record', sourceId: record.id, title: '旧入口', excerpt: '允许摘要' })
    repository.publishSnapshot(snapshot.id)
    render(<LifeDataProvider repository={repository}><MemoryRouter initialEntries={[`/snapshots/${snapshot.id}`]}><Routes><Route path="/snapshots/:id" element={<PublicSnapshotPage />} /><Route path="/p/:slug" element={<p>稳定公开地址</p>} /></Routes></MemoryRouter></LifeDataProvider>)
    await waitFor(() => expect(screen.getByText('稳定公开地址')).toBeVisible())
  })

  it('uses the existing unavailable result when a revision is revoked or missing', async () => {
    vi.spyOn(publicContentApi, 'get').mockRejectedValueOnce(new Error('404 revoked'))
    const repository = new LifeRepository({ storage: createMemoryStorage() })
    render(<LifeDataProvider repository={repository}><MemoryRouter initialEntries={['/p/revoked-entry']}><Routes><Route path="/p/:slug" element={<PublicSnapshotPage />} /></Routes></MemoryRouter></LifeDataProvider>)
    expect(await screen.findByRole('heading', { name: '这份快照当前不可公开访问' })).toBeVisible()
  })
})
