import { type FormEvent, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PrivateSurface } from '../../components/private/PrivateSurface'
import { useLifeRepository, useLifeState } from '../../state/LifeDataContext'

export function KnowledgePage() {
  const repository = useLifeRepository()
  const state = useLifeState()
  const [params] = useSearchParams()
  const reviewId = params.get('review') ?? state.reviews.at(-1)?.id
  const sourceReview = state.reviews.find((review) => review.id === reviewId)
  const [title, setTitle] = useState(sourceReview?.summary.slice(0, 24) ?? '')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState('')
  const [query, setQuery] = useState('')
  const [createdId, setCreatedId] = useState<string>()
  const notes = useMemo(() => {
    const clean = query.trim().toLocaleLowerCase('zh-CN')
    if (!clean) return [...state.knowledge].reverse()
    return [...state.knowledge].reverse().filter((note) =>
      `${note.title} ${note.body} ${note.tags.join(' ')}`.toLocaleLowerCase('zh-CN').includes(clean),
    )
  }, [query, state.knowledge])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!reviewId) return
    const note = await repository.createKnowledgeNote({
      sourceType: 'review',
      sourceId: reviewId,
      title,
      body,
      tags: tags.split(/[,，]/),
    })
    setCreatedId(note.id)
    setTitle('')
    setBody('')
    setTags('')
  }

  return (
    <PrivateSurface title="知识" lead="每条理解都保留来源；新的证据出现时，随时回来修正。">
      <section className="knowledge-library" aria-label="知识资料库">
        <div className="knowledge-browser">
          <label className="knowledge-search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
            <input type="search" role="searchbox" aria-label="搜索知识" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="按标题、正文或标签搜索" />
          </label>
          <div className="knowledge-index"><span>{notes.length} 条知识</span><span>保留来源</span></div>
          <div className="knowledge-entries">
            {notes.length === 0 ? (
              <div className="workspace-empty"><strong>{query ? '没有匹配的知识' : '知识库还是空的'}</strong><p>{query ? '尝试更短的关键词。' : '完成一次回顾，再把其中值得复用的理解留下。'}</p></div>
            ) : notes.map((note) => (
              <article key={note.id}>
                <div><span>{note.source.type === 'review' ? '来自回顾' : '来自记录'}</span><time>{new Date(note.createdAt).toLocaleDateString('zh-CN')}</time></div>
                <h2>{note.title}</h2><p>{note.body}</p>
                <footer>{note.tags.map((tag) => <small key={tag}>{tag}</small>)}</footer>
              </article>
            ))}
          </div>
        </div>
        <form className="knowledge-editor" onSubmit={save}>
          <h2>提炼新的知识</h2>
          {sourceReview ? <p className="source-trace">来源回顾 · {sourceReview.summary}</p> : <p className="source-trace">请先完成一次周期回顾。</p>}
          <label htmlFor="knowledge-title">知识标题</label>
          <input id="knowledge-title" value={title} onChange={(event) => setTitle(event.target.value)} required />
          <label htmlFor="knowledge-body">知识内容</label>
          <textarea id="knowledge-body" value={body} onChange={(event) => setBody(event.target.value)} rows={6} required />
          <label htmlFor="knowledge-tags">标签（逗号分隔）</label>
          <input id="knowledge-tags" value={tags} onChange={(event) => setTags(event.target.value)} />
          <button className="workspace-primary" type="submit" aria-label="保存知识笔记" disabled={!sourceReview}>保存知识笔记<span aria-hidden="true">→</span></button>
          {createdId && <Link className="next-loop-link" to={`/app/publish?source=knowledge&id=${createdId}`}>为这条知识创建公开快照</Link>}
        </form>
      </section>
    </PrivateSurface>
  )
}
