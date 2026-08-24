import { MarkdownView } from '../../components/system/MarkdownView'
import type { PublicDraft, PublicRevisionView } from '../../domain/publishing'

type PublicRenderable = Pick<PublicDraft, 'body' | 'category' | 'coverUrl' | 'excerpt' | 'featured' | 'slug' | 'tags' | 'title' | 'updatedAt'> & { publishedAt?: string; revision?: number }

export function PublicRevisionArticle({ content, compact = false }: { content: PublicRenderable; compact?: boolean }) {
  return (
    <article className={`public-revision ${compact ? 'is-compact' : ''}`} data-public-revision>
      <header><span>{content.category}</span>{content.featured ? <strong>精选</strong> : null}<time dateTime={content.publishedAt ?? content.updatedAt}>{new Intl.DateTimeFormat('zh-CN').format(new Date(content.publishedAt ?? content.updatedAt))}</time></header>
      {content.coverUrl ? <img alt="" src={content.coverUrl} /> : null}
      <h1>{content.title}</h1>
      <p className="public-revision__excerpt">{content.excerpt}</p>
      <MarkdownView className="public-revision__body" source={content.body} />
      <footer><div>{content.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>{content.revision ? <strong>Revision {content.revision}</strong> : <span>草稿预览</span>}</footer>
    </article>
  )
}

export function PublicPreview({ content, device, onBack, onDevice, onTheme, theme }: {
  content: PublicRevisionView | PublicDraft
  device: 'desktop' | 'mobile'
  onBack: () => void
  onDevice: (value: 'desktop' | 'mobile') => void
  onTheme: (value: 'day' | 'night') => void
  theme: 'day' | 'night'
}) {
  return (
    <section aria-label="公开内容预览" className="publishing-preview" data-grid-span="4" data-preview-device={device} data-preview-theme={theme} role="region">
      <header><button className="publishing-mobile-back" type="button" onClick={onBack}>返回公开草稿编辑</button><div><button aria-pressed={theme === 'day'} type="button" onClick={() => onTheme('day')}>日间预览</button><button aria-pressed={theme === 'night'} type="button" onClick={() => onTheme('night')}>夜间预览</button></div><div><button aria-pressed={device === 'desktop'} type="button" onClick={() => onDevice('desktop')}>桌面端预览</button><button aria-pressed={device === 'mobile'} type="button" onClick={() => onDevice('mobile')}>移动端预览</button></div></header>
      <div className="publishing-preview__viewport"><PublicRevisionArticle compact content={content} /></div>
    </section>
  )
}
