import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicDraft, PublicRevision, PublicRevisionView } from '../../domain/publishing'
import { PublishingPage, type PublishingController } from './PublishingPage'

const draft: PublicDraft = {
  id: 'draft-learning',
  category: 'learning',
  source: { type: 'knowledge', id: 'note-release', version: 7 },
  title: '发布门禁',
  excerpt: '只公开明确复制的字段。',
  body: '# 发布门禁\n\n保留公开事实。',
  coverUrl: 'https://cdn.example.test/release.webp',
  tags: ['k8s', '发布'],
  slug: 'release-gate',
  scheduledAt: null,
  featured: true,
  seo: { title: '发布门禁 · LifeOps', description: '公开发布门禁摘要' },
  status: 'draft',
  version: 4,
  createdAt: '2026-08-22T08:00:00.000Z',
  updatedAt: '2026-08-22T10:00:00.000Z',
}

const preview: PublicRevisionView = {
  body: draft.body,
  category: draft.category,
  coverUrl: draft.coverUrl,
  excerpt: draft.excerpt,
  featured: draft.featured,
  publishedAt: '2026-08-22T10:00:00.000Z',
  revision: 3,
  slug: draft.slug,
  tags: draft.tags,
  title: draft.title,
  updatedAt: draft.updatedAt,
}

const revision = (revisionNumber: number, title: string): PublicRevision => ({
  ...preview,
  id: `revision-${revisionNumber}`,
  draftId: draft.id,
  sourceVersion: revisionNumber + 2,
  revision: revisionNumber,
  title,
  seo: draft.seo,
})

function controller(patch: Partial<PublishingController> = {}): PublishingController {
  return {
    status: 'ready',
    drafts: [
      draft,
      { ...draft, id: 'draft-scheduled', title: '计划发布', slug: 'scheduled', status: 'scheduled', version: 2 },
      { ...draft, id: 'draft-published', title: '已经发布', slug: 'published', status: 'published', version: 2 },
      { ...draft, id: 'draft-revoked', title: '已经撤回', slug: 'revoked', status: 'revoked', version: 2 },
    ],
    sources: [
      { type: 'plan', id: 'plan-w34', title: 'W34 发布计划', updatedAt: '2026-08-22T08:00:00.000Z' },
      { type: 'record', id: 'record-incident', title: '事故记录', updatedAt: '2026-08-22T08:10:00.000Z' },
      { type: 'review', id: 'review-weekly', title: '每周回顾', updatedAt: '2026-08-22T08:20:00.000Z' },
      { type: 'knowledge', id: 'note-release', title: '发布门禁知识', updatedAt: '2026-08-22T08:30:00.000Z' },
    ],
    selected: draft,
    preview,
    revisions: [revision(3, '发布门禁'), revision(2, '发布门禁旧稿')],
    diff: { from: 2, to: 3, changed: [{ field: 'title', before: '发布门禁旧稿', after: '发布门禁' }] },
    isSaving: false,
    createStandalone: vi.fn().mockResolvedValue(draft),
    createFromSource: vi.fn().mockResolvedValue(draft),
    select: vi.fn(),
    update: vi.fn().mockResolvedValue({ ...draft, version: 5 }),
    previewDraft: vi.fn().mockResolvedValue(preview),
    publish: vi.fn().mockResolvedValue(undefined),
    schedule: vi.fn().mockResolvedValue(undefined),
    revoke: vi.fn().mockResolvedValue(undefined),
    loadDiff: vi.fn().mockResolvedValue(undefined),
    retry: vi.fn(),
    ...patch,
  }
}

function renderPublishing(subject = controller()) {
  return {
    subject,
    ...render(<MemoryRouter initialEntries={['/app/publish?status=draft&draft=draft-learning']}><PublishingPage controller={subject} /></MemoryRouter>),
  }
}

describe('PublishingPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the approved 3/5/4 source, editor and preview workbench with four source types and four status tabs', async () => {
    const { subject } = renderPublishing()

    expect(await screen.findByRole('heading', { level: 1, name: '发布' })).toBeVisible()
    expect(screen.getByRole('region', { name: '发布来源库' })).toHaveAttribute('data-grid-span', '3')
    expect(screen.getByRole('region', { name: '公开草稿编辑器' })).toHaveAttribute('data-grid-span', '5')
    expect(screen.getByRole('region', { name: '公开内容预览' })).toHaveAttribute('data-grid-span', '4')
    for (const name of ['计划 · W34 发布计划', '记录 · 事故记录', '回顾 · 每周回顾', '知识 · 发布门禁知识']) {
      expect(screen.getByRole('button', { name })).toBeVisible()
    }
    for (const name of ['草稿 1', '计划中 1', '已发布 1', '已撤回 1']) {
      expect(screen.getByRole('tab', { name })).toBeVisible()
    }

    await userEvent.click(screen.getByRole('button', { name: '记录 · 事故记录' }))
    expect(subject.createFromSource).toHaveBeenCalledWith({ type: 'record', id: 'record-incident' })
    expect(JSON.stringify(vi.mocked(subject.createFromSource).mock.calls)).not.toMatch(/PRIVATE|body|token/i)
  })

  it('edits every public field, supports day/night and desktop/mobile preview, and resets confirmation when the version changes', async () => {
    const user = userEvent.setup()
    const { subject } = renderPublishing()
    const editor = screen.getByRole('region', { name: '公开草稿编辑器' })
    for (const label of ['公开分类', '公开标题', '公开摘要', 'Markdown 正文', '封面地址', '公开标签', '公开 slug', 'SEO 标题', 'SEO 描述']) {
      expect(within(editor).getByLabelText(label)).toBeVisible()
    }
    expect(within(editor).getByLabelText('设为精选')).toBeChecked()

    const publicPreview = screen.getByRole('region', { name: '公开内容预览' })
    expect(publicPreview).toHaveAttribute('data-preview-theme', 'day')
    expect(publicPreview).toHaveAttribute('data-preview-device', 'desktop')
    await user.click(screen.getByRole('button', { name: '夜间预览' }))
    await user.click(screen.getByRole('button', { name: '移动端预览' }))
    expect(publicPreview).toHaveAttribute('data-preview-theme', 'night')
    expect(publicPreview).toHaveAttribute('data-preview-device', 'mobile')

    const publish = screen.getByRole('button', { name: '立即发布' })
    expect(publish).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: '我已确认公开字段' }))
    expect(publish).toBeEnabled()
    await user.click(publish)
    expect(subject.publish).toHaveBeenCalledWith(draft.id, draft.version)

    await user.clear(within(editor).getByLabelText('公开标题'))
    await user.type(within(editor).getByLabelText('公开标题'), '发布门禁 v4')
    expect(screen.getByRole('checkbox', { name: '我已确认公开字段' })).not.toBeChecked()
    expect(publish).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '保存公开草稿' }))
    expect(subject.update).toHaveBeenCalledWith(draft.id, expect.objectContaining({ title: '发布门禁 v4', version: draft.version }))
  })

  it('separates public and omitted private fields, then schedules, revokes and compares immutable revisions', async () => {
    const user = userEvent.setup()
    const { subject } = renderPublishing()
    const review = screen.getByRole('region', { name: '公开前隐私检查' })
    expect(review).toHaveTextContent('标题')
    expect(review).toHaveTextContent('摘要')
    expect(review).toHaveTextContent('正文')
    expect(review).toHaveTextContent('媒体')
    expect(review).toHaveTextContent('标签')
    expect(review).toHaveTextContent('SEO')
    expect(review).toHaveTextContent('不会公开：来源 ID、来源版本、所有者、私人关系与计划时间')
    expect(document.body).not.toHaveTextContent('PRIVATE_SOURCE_SENTINEL')

    await user.click(screen.getByRole('checkbox', { name: '我已确认公开字段' }))
    const scheduledAt = '2026-08-24T09:30'
    await user.type(screen.getByLabelText('计划发布时间'), scheduledAt)
    await user.click(screen.getByRole('button', { name: '计划发布' }))
    expect(subject.schedule).toHaveBeenCalledWith(draft.id, draft.version, new Date(scheduledAt).toISOString())
    await user.click(screen.getByRole('button', { name: '撤回公开' }))
    expect(subject.revoke).toHaveBeenCalledWith(draft.id, draft.version)

    const history = screen.getByRole('region', { name: '公开 revision 历史' })
    expect(history).toHaveTextContent('Revision 3')
    expect(history).toHaveTextContent('Revision 2')
    await user.click(within(history).getByRole('button', { name: '比较 Revision 2 → 3' }))
    expect(subject.loadDiff).toHaveBeenCalledWith(draft.id, 2, 3)
    expect(history).toHaveTextContent('title')
    expect(history).toHaveTextContent('发布门禁旧稿')
    expect(history).toHaveTextContent('发布门禁')
  })

  it('uses source → edit → preview mobile levels with fixed controls and restores focus on Back', async () => {
    const user = userEvent.setup()
    renderPublishing()
    const page = screen.getByTestId('publishing-page')
    expect(page).toHaveAttribute('data-mobile-level', 'source')
    const edit = screen.getByRole('button', { name: '下一步：编辑公开草稿' })
    await user.click(edit)
    expect(page).toHaveAttribute('data-mobile-level', 'edit')
    expect(screen.getByRole('button', { name: '返回发布来源' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: '下一步：预览公开内容' }))
    expect(page).toHaveAttribute('data-mobile-level', 'preview')
    await user.click(screen.getByRole('button', { name: '返回公开草稿编辑' }))
    expect(page).toHaveAttribute('data-mobile-level', 'edit')
  })

  it.each([
    ['network-error', '发布工作台暂时无法读取'],
    ['forbidden', '你没有访问发布工作台的权限'],
    ['conflict', '公开草稿已在另一处更新'],
    ['disconnected', '当前设备离线'],
  ] as const)('keeps %s local to the workbench with an explicit retry', (status, message) => {
    const subject = controller({ status })
    renderPublishing(subject)
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    screen.getByRole('button', { name: '重新加载发布工作台' }).click()
    expect(subject.retry).toHaveBeenCalledTimes(1)
  })
})
