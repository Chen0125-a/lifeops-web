import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpError } from '../../api/httpClient'
import type { KnowledgeNote } from '../../domain/knowledge'
import { KnowledgeEditor } from './KnowledgeEditor'

function note(id: string, patch: Partial<KnowledgeNote> = {}): KnowledgeNote {
  return {
    id,
    title: '发布门禁知识',
    body: '# 安全正文\n\n[危险链接](javascript:alert(1))\n\n<script>alert(2)</script>',
    tags: ['k8s', '发布'],
    collectionIds: ['collection-tech'],
    sourceLinks: [{ type: 'record', id: 'record-incident-7' }],
    relatedIds: ['note-related'],
    pinned: false,
    favorite: false,
    reviewOn: '2026-08-25',
    version: 4,
    createdAt: '2026-08-20T08:00:00.000Z',
    updatedAt: '2026-08-20T08:00:00.000Z',
    archivedAt: null,
    deletedAt: null,
    ...patch,
  }
}

const related = note('note-related', { title: '关联的可观测性知识', sourceLinks: [], relatedIds: [] })

describe('KnowledgeEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-22T10:00:00.000Z'))
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    sessionStorage.clear()
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
  })

  it('renders sanitized Markdown, factual source links, relations and the review date without mutating a source', async () => {
    const onOpenSource = vi.fn()
    const onUpdate = vi.fn()
    render(<KnowledgeEditor note={note('note-1')} notes={[note('note-1'), related]} onBack={vi.fn()} onDelete={vi.fn()} onOpenSource={onOpenSource} onUpdate={onUpdate} />)

    const editor = screen.getByRole('region', { name: '知识阅读与编辑' })
    expect(within(editor).getByRole('heading', { name: '安全正文' })).toBeVisible()
    expect(editor.querySelector('script')).toBeNull()
    expect(within(editor).getByText('危险链接').closest('a')).not.toHaveAttribute('href', expect.stringMatching(/^javascript:/i))
    expect(within(editor).getByText('2026年8月25日复习')).toBeVisible()
    expect(within(editor).getByRole('button', { name: '相关知识 关联的可观测性知识' })).toBeVisible()

    fireEvent.click(within(editor).getByRole('button', { name: '来源 记录 record-incident-7' }))
    expect(onOpenSource).toHaveBeenCalledWith('record', 'record-incident-7')
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('autosaves title, Markdown, tags and review date after 800ms with the current optimistic version', async () => {
    const onUpdate = vi.fn().mockImplementation(async (_id: string, input: Record<string, unknown>) => ({
      ...note('note-1'), ...input, version: 5, updatedAt: '2026-08-22T10:00:00.000Z',
    }))
    render(<KnowledgeEditor note={note('note-1')} notes={[note('note-1'), related]} onBack={vi.fn()} onDelete={vi.fn()} onUpdate={onUpdate} />)

    fireEvent.click(screen.getByRole('button', { name: '编辑知识' }))
    const title = screen.getByLabelText('知识标题')
    fireEvent.change(title, { target: { value: '修正后的发布门禁' } })
    const body = screen.getByLabelText('Markdown 正文')
    fireEvent.change(body, { target: { value: '## 新证据\n\n保留来源。' } })
    const tags = screen.getByLabelText('标签')
    fireEvent.change(tags, { target: { value: 'k8s，证据' } })
    fireEvent.change(screen.getByLabelText('复习日期'), { target: { value: '2026-09-01' } })

    expect(screen.getByRole('status')).toHaveTextContent('等待保存')
    await act(async () => { await vi.advanceTimersByTimeAsync(800) })
    expect(onUpdate).toHaveBeenCalledWith('note-1', expect.objectContaining({
      body: '## 新证据\n\n保留来源。',
      reviewOn: '2026-09-01',
      tags: ['k8s', '证据'],
      title: '修正后的发布门禁',
      version: 4,
    }))
    expect(screen.getByRole('status')).toHaveTextContent('已保存')
  })

  it('keeps the local Markdown visible and exposes explicit recovery choices on a 409 conflict', async () => {
    const onUpdate = vi.fn().mockRejectedValue(new HttpError('VERSION_CONFLICT', '知识已在另一处更新', 409, 'request-409'))
    render(<KnowledgeEditor note={note('note-1')} notes={[note('note-1'), related]} onBack={vi.fn()} onDelete={vi.fn()} onUpdate={onUpdate} />)

    fireEvent.click(screen.getByRole('button', { name: '编辑知识' }))
    const body = screen.getByLabelText('Markdown 正文')
    fireEvent.change(body, { target: { value: '不能覆盖的本地新证据' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(800) })

    expect(screen.getByRole('status')).toHaveTextContent('保存冲突')
    const conflict = screen.getByRole('alert', { name: '知识保存冲突' })
    expect(conflict).toHaveTextContent('服务器版本')
    expect(within(conflict).getByRole('button', { name: '保留本地草稿' })).toBeVisible()
    expect(within(conflict).getByRole('button', { name: '重新载入服务器版本' })).toBeVisible()
    expect(body).toHaveValue('不能覆盖的本地新证据')
    expect(sessionStorage.getItem('lifeops:record-draft:knowledge:note-1')).toContain('不能覆盖的本地新证据')
  })

  it('uses fixed back controls and reports an honest session-only draft while offline', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })
    const onBack = vi.fn()
    const onUpdate = vi.fn()
    render(<KnowledgeEditor note={note('note-1')} notes={[note('note-1'), related]} onBack={onBack} onDelete={vi.fn()} onUpdate={onUpdate} />)

    fireEvent.click(screen.getByRole('button', { name: '编辑知识' }))
    fireEvent.change(screen.getByLabelText('Markdown 正文'), { target: { value: `${note('note-1').body} 离线补充` } })
    await act(async () => { await vi.advanceTimersByTimeAsync(800) })
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('离线草稿')
    expect(screen.getByText(/当前浏览器会话/)).toHaveTextContent('明文')

    fireEvent.click(screen.getByRole('button', { name: '返回知识列表' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('adds and removes explicit note relations with the current note version', () => {
    const onAddRelation = vi.fn().mockResolvedValue(undefined)
    const onRemoveRelation = vi.fn().mockResolvedValue(undefined)
    const candidate = note('note-candidate', { title: '候选知识', sourceLinks: [], relatedIds: [] })
    render(<KnowledgeEditor
      note={note('note-1')}
      notes={[note('note-1'), related, candidate]}
      onAddRelation={onAddRelation}
      onBack={vi.fn()}
      onDelete={vi.fn()}
      onRemoveRelation={onRemoveRelation}
      onUpdate={vi.fn()}
    />)

    fireEvent.change(screen.getByRole('combobox', { name: '添加相关知识' }), { target: { value: 'note-candidate' } })
    fireEvent.click(screen.getByRole('button', { name: '建立知识关系' }))
    expect(onAddRelation).toHaveBeenCalledWith(note('note-1'), 'note-candidate')

    fireEvent.click(screen.getByRole('button', { name: '移除关系 关联的可观测性知识' }))
    expect(onRemoveRelation).toHaveBeenCalledWith(note('note-1'), 'note-related')
  })

  it('moves focus into edit mode and lets Escape return to the safe reader', () => {
    render(<KnowledgeEditor note={note('note-1')} notes={[note('note-1'), related]} onBack={vi.fn()} onDelete={vi.fn()} onUpdate={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '编辑知识' }))
    expect(screen.getByLabelText('知识标题')).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('region', { name: '知识阅读与编辑' }), { key: 'Escape' })
    expect(screen.queryByLabelText('Markdown 正文')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '安全正文' })).toBeVisible()
  })
})
