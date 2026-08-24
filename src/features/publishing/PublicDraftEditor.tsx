import { useEffect, useState } from 'react'
import type { PublicCategory, PublicDraft, UpdatePublicDraftInput } from '../../domain/publishing'

const categories: Array<{ value: PublicCategory; label: string }> = [
  { value: 'now', label: '此刻' }, { value: 'doing', label: '在做' }, { value: 'learning', label: '在学' },
  { value: 'moments', label: '片刻' }, { value: 'archive', label: '归档' },
]

const splitTags = (value: string) => [...new Set(value.split(/[,，]/u).map((tag) => tag.trim()).filter(Boolean))]

export function PublicDraftEditor({ draft, isSaving, onBack, onDirty, onLiveChange, onPreview, onSave }: {
  draft: PublicDraft
  isSaving: boolean
  onBack: () => void
  onDirty: () => void
  onLiveChange?: (draft: PublicDraft) => void
  onPreview: () => void
  onSave: (input: UpdatePublicDraftInput) => Promise<void>
}) {
  const [form, setForm] = useState(() => ({
    category: draft.category,
    title: draft.title,
    excerpt: draft.excerpt,
    body: draft.body,
    coverUrl: draft.coverUrl ?? '',
    tags: draft.tags.join('，'),
    slug: draft.slug,
    featured: draft.featured,
    seoTitle: draft.seo.title,
    seoDescription: draft.seo.description,
  }))

  useEffect(() => setForm({
    category: draft.category, title: draft.title, excerpt: draft.excerpt, body: draft.body,
    coverUrl: draft.coverUrl ?? '', tags: draft.tags.join('，'), slug: draft.slug, featured: draft.featured,
    seoTitle: draft.seo.title, seoDescription: draft.seo.description,
  }), [draft.id, draft.version])

  const inputFrom = (value: typeof form): UpdatePublicDraftInput => ({
    version: draft.version,
    category: value.category,
    title: value.title,
    excerpt: value.excerpt,
    body: value.body,
    coverUrl: value.coverUrl.trim() || null,
    tags: splitTags(value.tags),
    slug: value.slug,
    featured: value.featured,
    seo: { title: value.seoTitle, description: value.seoDescription },
  })
  const change = <K extends keyof typeof form>(key: K, value: typeof form[K]) => {
    const next = { ...form, [key]: value }
    setForm(next)
    onDirty()
    onLiveChange?.({ ...draft, ...inputFrom(next) })
  }
  const save = () => onSave(inputFrom(form))

  return (
    <section aria-label="公开草稿编辑器" className="publishing-editor" data-grid-span="5" role="region">
      <header><button autoFocus className="publishing-mobile-back" type="button" onClick={onBack}>返回发布来源</button><div><p>Public draft</p><h2>{draft.title}</h2></div><span role="status">{isSaving ? '保存中' : `版本 ${draft.version}`}</span></header>
      <div className="publishing-editor__form">
        <label><span>公开分类</span><select aria-label="公开分类" value={form.category} onChange={(event) => change('category', event.target.value as PublicCategory)}>{categories.map((category) => <option value={category.value} key={category.value}>{category.label}</option>)}</select></label>
        <label><span>公开标题</span><input aria-label="公开标题" maxLength={240} value={form.title} onChange={(event) => change('title', event.target.value)} /></label>
        <label><span>公开摘要</span><textarea aria-label="公开摘要" rows={3} value={form.excerpt} onChange={(event) => change('excerpt', event.target.value)} /></label>
        <label className="publishing-editor__body"><span>Markdown 正文</span><textarea aria-label="Markdown 正文" rows={14} value={form.body} onChange={(event) => change('body', event.target.value)} /></label>
        <div className="publishing-editor__row"><label><span>封面地址</span><input aria-label="封面地址" type="url" value={form.coverUrl} onChange={(event) => change('coverUrl', event.target.value)} /></label><label><span>公开标签</span><input aria-label="公开标签" value={form.tags} onChange={(event) => change('tags', event.target.value)} /></label></div>
        <div className="publishing-editor__row"><label><span>公开 slug</span><input aria-label="公开 slug" value={form.slug} onChange={(event) => change('slug', event.target.value)} /></label><label className="publishing-editor__featured"><input aria-label="设为精选" type="checkbox" checked={form.featured} onChange={(event) => change('featured', event.target.checked)} /><span>设为精选</span></label></div>
        <label><span>SEO 标题</span><input aria-label="SEO 标题" value={form.seoTitle} onChange={(event) => change('seoTitle', event.target.value)} /></label>
        <label><span>SEO 描述</span><textarea aria-label="SEO 描述" rows={2} value={form.seoDescription} onChange={(event) => change('seoDescription', event.target.value)} /></label>
      </div>
      <footer className="publishing-editor__actions" data-fixed-mobile-controls><button type="button" disabled={isSaving} onClick={() => void save().catch(() => {})}>保存公开草稿</button><button type="button" onClick={onPreview}>下一步：预览公开内容</button></footer>
    </section>
  )
}
