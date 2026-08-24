import { useMemo, useRef } from 'react'
import type { KnowledgeCollection, KnowledgeNote } from '../../domain/knowledge'

interface KnowledgeSidebarProps {
  activeCollection?: string
  activeTag?: string
  collections: KnowledgeCollection[]
  notes: KnowledgeNote[]
  onCollection: (id?: string) => void
  onTag: (tag?: string) => void
  resurfaced: KnowledgeNote[]
}

function moveFocus(buttons: HTMLButtonElement[], current: HTMLButtonElement, delta: number) {
  const index = buttons.indexOf(current)
  if (index < 0 || buttons.length === 0) return
  buttons[(index + delta + buttons.length) % buttons.length]?.focus()
}

export function KnowledgeSidebar({
  activeCollection,
  activeTag,
  collections,
  notes,
  onCollection,
  onTag,
  resurfaced,
}: KnowledgeSidebarProps) {
  const rootRef = useRef<HTMLElement>(null)
  const tags = useMemo(() => [...new Set(notes.flatMap((note) => note.tags))].sort((a, b) => a.localeCompare(b, 'zh-CN')), [notes])
  const topics = useMemo(() => [...new Set(notes.map((note) => note.tags[0]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN')), [notes])

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const buttons = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[data-library-choice]') ?? [])]
    event.preventDefault()
    if (event.key === 'Home') buttons[0]?.focus()
    else if (event.key === 'End') buttons.at(-1)?.focus()
    else moveFocus(buttons, event.currentTarget, event.key === 'ArrowDown' ? 1 : -1)
  }

  return (
    <nav ref={rootRef} className="knowledge-sidebar" aria-label="知识资料库" data-grid-span="2.5">
      <section className="knowledge-sidebar__group" aria-labelledby="knowledge-collections-title">
        <div className="knowledge-sidebar__label"><h2 id="knowledge-collections-title">资料库</h2><span>{collections.length}</span></div>
        <button data-library-choice type="button" aria-current={!activeCollection ? 'page' : undefined} onClick={() => onCollection()} onKeyDown={onKeyDown}>全部知识</button>
        {collections.map((collection) => <button
          data-library-choice
          type="button"
          key={collection.id}
          aria-current={activeCollection === collection.id ? 'page' : undefined}
          aria-label={`资料库 ${collection.name}`}
          onClick={() => onCollection(collection.id)}
          onKeyDown={onKeyDown}
        ><i style={{ '--knowledge-accent': collection.color } as React.CSSProperties} />{collection.name}</button>)}
      </section>

      <section className="knowledge-sidebar__group" aria-labelledby="knowledge-topics-title">
        <div className="knowledge-sidebar__label"><h2 id="knowledge-topics-title">主题</h2><span>{topics.length}</span></div>
        {topics.map((topic) => <button data-library-choice type="button" key={topic} aria-label={`主题 ${topic}`} aria-current={activeTag === topic ? 'page' : undefined} onClick={() => onTag(topic)} onKeyDown={onKeyDown}># {topic}</button>)}
      </section>

      <section className="knowledge-sidebar__group knowledge-sidebar__tags" aria-labelledby="knowledge-tags-title">
        <div className="knowledge-sidebar__label"><h2 id="knowledge-tags-title">标签</h2><span>{tags.length}</span></div>
        <div>{tags.map((tag) => <button data-library-choice type="button" key={tag} aria-label={`标签 ${tag}`} aria-pressed={activeTag === tag} onClick={() => onTag(activeTag === tag ? undefined : tag)} onKeyDown={onKeyDown}>{tag}</button>)}</div>
      </section>

      <section className="knowledge-resurfaced" role="region" aria-label="今天重现">
        <p>今天重现</p>
        {resurfaced.length ? resurfaced.map((note) => <span key={note.id}>{note.title}</span>) : <span>今天没有到期知识</span>}
      </section>
    </nav>
  )
}
