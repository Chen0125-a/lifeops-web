import { useEffect, useMemo, useRef } from 'react'
import type { KnowledgeNote } from '../../domain/knowledge'

interface KnowledgeListProps {
  notes: KnowledgeNote[]
  onSelect: (id: string, scrollTop: number) => void
  restoreFocusId?: string
  selectedId?: string
}

const dateLabel = (value: string) => new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value))

export function KnowledgeList({ notes, onSelect, restoreFocusId, selectedId }: KnowledgeListProps) {
  const rootRef = useRef<HTMLElement>(null)
  const noteMap = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes])

  useEffect(() => {
    if (!restoreFocusId || !noteMap.has(restoreFocusId)) return
    queueMicrotask(() => rootRef.current?.querySelector<HTMLButtonElement>(`[data-note-id="${CSS.escape(restoreFocusId)}"]`)?.focus())
  }, [noteMap, restoreFocusId])

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'Enter' || event.key === ' ') {
      onSelect(id, rootRef.current?.scrollTop ?? 0)
      return
    }
    const buttons = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[data-note-id]') ?? [])]
    const index = buttons.indexOf(event.currentTarget)
    if (event.key === 'Home') buttons[0]?.focus()
    else if (event.key === 'End') buttons.at(-1)?.focus()
    else buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
  }

  return (
    <section ref={rootRef} className="knowledge-list" role="region" aria-label="知识列表" data-grid-span="3.5">
      <div className="knowledge-list__heading"><p>{notes.length} 条知识</p><span>按最近更新</span></div>
      {notes.length === 0 ? <div className="knowledge-list__empty"><h2>没有匹配的知识</h2><p>清除一项筛选，或新建一条带来源的知识。</p></div> : notes.map((note) => <button
        type="button"
        className="knowledge-list__item"
        key={note.id}
        data-note-id={note.id}
        aria-current={selectedId === note.id ? 'true' : undefined}
        aria-label={`知识 ${note.title}`}
        onClick={() => onSelect(note.id, rootRef.current?.scrollTop ?? 0)}
        onKeyDown={(event) => onKeyDown(event, note.id)}
      >
        <span className="knowledge-list__meta"><span>{note.pinned ? '置顶' : note.favorite ? '收藏' : note.tags[0] ?? '知识'}</span><time dateTime={note.updatedAt}>{dateLabel(note.updatedAt)}</time></span>
        <strong>{note.title}</strong>
        <span className="knowledge-list__excerpt">{note.body.replace(/[#>*_`\[\]()]/g, '').slice(0, 74)}</span>
        <span className="knowledge-list__tags">{note.tags.slice(0, 3).map((tag) => <small key={tag}>{tag}</small>)}</span>
      </button>)}
    </section>
  )
}
