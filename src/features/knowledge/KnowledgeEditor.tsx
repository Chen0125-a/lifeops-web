import { useEffect, useMemo, useRef, useState } from 'react'
import { MarkdownView } from '../../components/system/MarkdownView'
import type { KnowledgeNote, KnowledgeSourceType, UpdateKnowledgeInput } from '../../domain/knowledge'
import { useAutosave } from '../records/useAutosave'

const sourceLabels: Record<KnowledgeSourceType, string> = {
  goal: '目标',
  project: '项目',
  record: '记录',
  review: '回顾',
}

const splitTags = (value: string) => [...new Set(value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))]

const reviewLabel = (value: string) => `${new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'Asia/Shanghai',
}).format(new Date(`${value}T00:00:00+08:00`))}复习`

export interface KnowledgeEditorProps {
  focusBackOnMount?: boolean
  note: KnowledgeNote
  notes: KnowledgeNote[]
  onAddRelation?: (note: KnowledgeNote, relatedId: string) => Promise<void>
  onArchive?: (note: KnowledgeNote) => Promise<void>
  onBack: () => void
  onDelete: (note: KnowledgeNote) => Promise<void>
  onFavorite?: (note: KnowledgeNote) => Promise<void>
  onOpenRelated?: (id: string) => void
  onOpenSource?: (type: KnowledgeSourceType, id: string) => void
  onPin?: (note: KnowledgeNote) => Promise<void>
  onRemoveRelation?: (note: KnowledgeNote, relatedId: string) => Promise<void>
  onUpdate: (id: string, input: UpdateKnowledgeInput) => Promise<KnowledgeNote>
}

export function KnowledgeEditor({
  focusBackOnMount = false,
  note,
  notes,
  onArchive,
  onAddRelation,
  onBack,
  onDelete,
  onFavorite,
  onOpenRelated,
  onOpenSource,
  onPin,
  onRemoveRelation,
  onUpdate,
}: KnowledgeEditorProps) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)
  const [tagText, setTagText] = useState(note.tags.join('，'))
  const [reviewOn, setReviewOn] = useState(note.reviewOn ?? '')
  const [relationCandidate, setRelationCandidate] = useState('')
  const backRef = useRef<HTMLButtonElement>(null)
  const draft = useMemo(() => JSON.stringify({ body, reviewOn: reviewOn || null, tags: splitTags(tagText), title }), [body, reviewOn, tagText, title])
  const autosave = useAutosave({
    delay: 800,
    draftKey: `knowledge:${note.id}`,
    value: draft,
    version: note.version,
    save: async (value, version) => {
      const parsed = JSON.parse(value) as Pick<UpdateKnowledgeInput, 'body' | 'reviewOn' | 'tags' | 'title'>
      const updated = await onUpdate(note.id, { ...parsed, version })
      return { updatedAt: updated.updatedAt, version: updated.version }
    },
  })

  useEffect(() => {
    setTitle(note.title)
    setBody(note.body)
    setTagText(note.tags.join('，'))
    setReviewOn(note.reviewOn ?? '')
  }, [note.id])

  useEffect(() => {
    if (focusBackOnMount) backRef.current?.focus()
  }, [focusBackOnMount])

  const resetFromServer = () => {
    setTitle(note.title)
    setBody(note.body)
    setTagText(note.tags.join('，'))
    setReviewOn(note.reviewOn ?? '')
    sessionStorage.removeItem(`lifeops:record-draft:knowledge:${note.id}`)
  }

  const keepLocal = () => {
    const recovered = autosave.recoverDraft()
    if (!recovered) return
    try {
      const parsed = JSON.parse(recovered) as { body?: unknown; reviewOn?: unknown; tags?: unknown; title?: unknown }
      if (typeof parsed.title === 'string') setTitle(parsed.title)
      if (typeof parsed.body === 'string') setBody(parsed.body)
      if (Array.isArray(parsed.tags)) setTagText(parsed.tags.map(String).join('，'))
      if (typeof parsed.reviewOn === 'string') setReviewOn(parsed.reviewOn)
    } catch {
      // The session-local draft stays available even if an older shape cannot be decoded.
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    if (editing) setEditing(false)
    else onBack()
  }

  return (
    <section className="knowledge-editor" role="region" aria-label="知识阅读与编辑" data-grid-span="6" onKeyDown={onKeyDown}>
      <header className="knowledge-editor__bar">
        <button ref={backRef} className="knowledge-editor__back" type="button" onClick={onBack}>返回知识列表</button>
        <span className={`knowledge-save-state is-${autosave.status}`} role="status" aria-live="polite">{autosave.statusLabel}</span>
        <button className="knowledge-editor__mode" type="button" onClick={() => setEditing((value) => !value)}>{editing ? '阅读知识' : '编辑知识'}</button>
      </header>

      {editing ? <div className="knowledge-editor__form">
        <label><span>知识标题</span><input autoFocus aria-label="知识标题" value={title} maxLength={240} onChange={(event) => setTitle(event.target.value)} /></label>
        <label><span>Markdown 正文</span><textarea aria-label="Markdown 正文" value={body} rows={16} onChange={(event) => setBody(event.target.value)} /></label>
        <div className="knowledge-editor__row">
          <label><span>标签</span><input aria-label="标签" value={tagText} onChange={(event) => setTagText(event.target.value)} /></label>
          <label><span>复习日期</span><input aria-label="复习日期" type="date" value={reviewOn} onChange={(event) => setReviewOn(event.target.value)} /></label>
        </div>
        {autosave.status === 'offline' ? <p className="knowledge-editor__privacy">{autosave.privacyNote}</p> : null}
        {autosave.status === 'conflict' ? <div className="knowledge-editor__conflict" role="alert" aria-label="知识保存冲突">
          <strong>服务器版本已经变化</strong>
          <p>本地草稿没有覆盖服务器版本。请选择保留本地内容，或重新载入当前服务器版本。</p>
          <div><button type="button" onClick={keepLocal}>保留本地草稿</button><button type="button" onClick={resetFromServer}>重新载入服务器版本</button></div>
        </div> : null}
      </div> : <div className="knowledge-reader">
        <div className="knowledge-reader__eyebrow"><span>{note.pinned ? '置顶' : '知识笔记'}</span><time dateTime={note.updatedAt}>更新于 {new Intl.DateTimeFormat('zh-CN').format(new Date(note.updatedAt))}</time></div>
        <h2>{note.title}</h2>
        <div className="knowledge-reader__tags">{note.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
        <MarkdownView className="knowledge-reader__markdown" source={note.body} />
      </div>}

      <aside className="knowledge-editor__context" aria-label="知识来源与关系">
        {note.reviewOn ? <p className="knowledge-review-date"><span />{reviewLabel(note.reviewOn)}</p> : <p className="knowledge-review-date is-empty"><span />未安排复习</p>}
        <section aria-labelledby={`knowledge-source-${note.id}`}><h3 id={`knowledge-source-${note.id}`}>来源</h3>
          {note.sourceLinks.length ? note.sourceLinks.map((source) => <button type="button" key={`${source.type}:${source.id}`} aria-label={`来源 ${sourceLabels[source.type]} ${source.id}`} onClick={() => onOpenSource?.(source.type, source.id)}>{sourceLabels[source.type]}<span>{source.id}</span></button>) : <p>这是一条直接写下的知识。</p>}
        </section>
        <section aria-labelledby={`knowledge-relations-${note.id}`}><h3 id={`knowledge-relations-${note.id}`}>相关知识</h3>
          {note.relatedIds.length ? note.relatedIds.map((id) => {
            const related = notes.find((candidate) => candidate.id === id)
            return <div className="knowledge-relation" key={id}>
              <button type="button" aria-label={`相关知识 ${related?.title ?? id}`} onClick={() => onOpenRelated?.(id)}>{related?.title ?? id}</button>
              {onRemoveRelation ? <button type="button" aria-label={`移除关系 ${related?.title ?? id}`} onClick={() => void onRemoveRelation(note, id)}>移除</button> : null}
            </div>
          }) : <p>还没有建立知识关系。</p>}
          {onAddRelation ? <div className="knowledge-relation__add">
            <label><span>添加相关知识</span><select aria-label="添加相关知识" value={relationCandidate} onChange={(event) => setRelationCandidate(event.target.value)}><option value="">选择知识</option>{notes.filter((candidate) => candidate.id !== note.id && !note.relatedIds.includes(candidate.id) && !candidate.deletedAt).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}</select></label>
            <button type="button" disabled={!relationCandidate} onClick={() => { if (relationCandidate) void onAddRelation(note, relationCandidate).then(() => setRelationCandidate('')) }}>建立知识关系</button>
          </div> : null}
        </section>
      </aside>

      <footer className="knowledge-editor__actions">
        {onPin ? <button type="button" onClick={() => void onPin(note)}>{note.pinned ? '取消置顶' : '置顶知识'}</button> : null}
        {onFavorite ? <button type="button" onClick={() => void onFavorite(note)}>{note.favorite ? '取消收藏' : '收藏知识'}</button> : null}
        {onArchive ? <button type="button" onClick={() => void onArchive(note)}>{note.archivedAt ? '已归档' : '归档知识'}</button> : null}
        <button className="is-danger" type="button" onClick={() => void onDelete(note)}>删除知识</button>
      </footer>
    </section>
  )
}
