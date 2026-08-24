import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { CreateKnowledgeInput, KnowledgeFilters, KnowledgeNote, KnowledgeSourceType } from '../../domain/knowledge'
import { KnowledgeEditor } from './KnowledgeEditor'
import { KnowledgeList } from './KnowledgeList'
import { KnowledgeSidebar } from './KnowledgeSidebar'
import { useKnowledge } from './useKnowledge'

const sourceTypes = new Set<KnowledgeSourceType>(['record', 'review', 'goal', 'project'])

function filtersFrom(params: URLSearchParams): KnowledgeFilters {
  const filters: KnowledgeFilters = {}
  const collectionId = params.get('collection')
  const tag = params.get('tag')
  const q = params.get('q')
  const source = params.get('source')
  if (collectionId) filters.collectionId = collectionId
  if (tag) filters.tag = tag
  if (q) filters.q = q
  if (sourceTypes.has(source as KnowledgeSourceType)) filters.source = source as KnowledgeSourceType
  return filters
}

function failureMessage(status: ReturnType<typeof useKnowledge>['status']) {
  if (status === 'forbidden') return '你没有访问这些知识的权限。'
  if (status === 'conflict') return '知识已在另一处更新，本地内容没有覆盖服务器版本。'
  if (status === 'disconnected') return '当前设备离线；未保存内容只保留在本次浏览器会话。'
  return '知识暂时无法读取，请检查连接后重试。'
}

interface KnowledgeComposerProps {
  onCancel: () => void
  onCreate: (input: CreateKnowledgeInput) => Promise<KnowledgeNote>
}

function KnowledgeComposer({ onCancel, onCreate }: KnowledgeComposerProps) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState('')
  const [reviewOn, setReviewOn] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await onCreate({
        body,
        reviewOn: reviewOn || null,
        tags: [...new Set(tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))],
        title,
      })
    } finally {
      setSaving(false)
    }
  }

  return <form className="knowledge-composer" aria-label="新建知识" onSubmit={(event) => void submit(event)}>
    <header><button type="button" onClick={onCancel}>返回知识列表</button><span role="status">{saving ? '正在创建' : '新知识'}</span></header>
    <p className="knowledge-composer__kicker">Direct note</p><h2>写下可复用的理解</h2>
    <label><span>知识标题</span><input autoFocus required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
    <label><span>Markdown 正文</span><textarea required rows={16} value={body} onChange={(event) => setBody(event.target.value)} /></label>
    <div><label><span>标签</span><input value={tags} onChange={(event) => setTags(event.target.value)} /></label><label><span>复习日期</span><input type="date" value={reviewOn} onChange={(event) => setReviewOn(event.target.value)} /></label></div>
    <button className="knowledge-composer__submit" type="submit" disabled={saving}>创建知识</button>
  </form>
}

export function KnowledgePage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => filtersFrom(params), [params])
  const knowledge = useKnowledge(filters)
  const [deleted, setDeleted] = useState<{ id: string; title: string; version: number } | null>(null)
  const [creating, setCreating] = useState(false)
  const [restoreFocusId, setRestoreFocusId] = useState<string>()
  const [listScrollTop, setListScrollTop] = useState(0)
  const selectedId = params.get('note') ?? undefined
  const selected = knowledge.notes.find((note) => note.id === selectedId)
  const invalidSource = Boolean(params.get('source') && !sourceTypes.has(params.get('source') as KnowledgeSourceType))

  useEffect(() => {
    if (!selectedId || knowledge.status === 'loading' || selected) return
    const next = new URLSearchParams(params)
    next.delete('note')
    setParams(next, { replace: true })
  }, [knowledge.status, params, selected, selectedId, setParams])

  const changeParam = (key: 'collection' | 'tag' | 'source' | 'q' | 'note', value?: string, replace = true) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace })
  }

  const select = (id: string, scrollTop = listScrollTop) => {
    setCreating(false)
    setRestoreFocusId(undefined)
    setListScrollTop(scrollTop)
    changeParam('note', id, false)
  }

  const close = () => {
    setCreating(false)
    setRestoreFocusId(selected?.id)
    changeParam('note', undefined, false)
    queueMicrotask(() => {
      const list = document.querySelector<HTMLElement>('[aria-label="知识列表"]')
      if (list) list.scrollTop = listScrollTop
    })
  }

  const remove = async (note: KnowledgeNote) => {
    await knowledge.remove(note.id, note.version)
    setDeleted({ id: note.id, title: note.title, version: note.version + 1 })
    close()
  }

  const restore = async () => {
    if (!deleted) return
    const restored = await knowledge.restore(deleted.id, deleted.version)
    setDeleted(null)
    select(restored.id)
  }

  const create = async (input: CreateKnowledgeInput) => {
    const created = await knowledge.create(input)
    setCreating(false)
    select(created.id)
    return created
  }

  const pageFailure = ['network-error', 'forbidden', 'conflict', 'disconnected'].includes(knowledge.status)

  return (
    <article className="knowledge-page" data-knowledge-page data-mobile-level={creating || selected ? 'reader' : 'list'}>
      <header className="knowledge-page__heading">
        <div><p>Knowledge library</p><h1 tabIndex={-1}>知识</h1><span>把理解放回来源、关系与复习节奏里。</span></div>
        <button type="button" onClick={() => { setCreating(true); changeParam('note') }}>新建知识</button>
      </header>

      <form className="knowledge-search" role="search" aria-label="筛选知识" onSubmit={(event) => event.preventDefault()}>
        <label><span>搜索</span><input type="search" role="searchbox" aria-label="搜索知识" value={params.get('q') ?? ''} placeholder="标题、正文或标签" onChange={(event) => changeParam('q', event.target.value)} /></label>
        <label><span>来源</span><select aria-label="来源类型" value={params.get('source') ?? ''} onChange={(event) => changeParam('source', event.target.value)}><option value="">全部来源</option><option value="record">记录</option><option value="review">回顾</option><option value="goal">目标</option><option value="project">项目</option></select></label>
      </form>

      {invalidSource ? <div className="knowledge-page__error" role="alert">来源筛选无效，只接受 record、review、goal 或 project。</div> : null}
      {pageFailure ? <div className="knowledge-page__error" role="alert"><p>{failureMessage(knowledge.status)}</p><button type="button" onClick={knowledge.retry}>重新加载</button></div> : null}
      {knowledge.status === 'loading' ? <p className="knowledge-page__loading" role="status">正在整理知识关系…</p> : null}

      <section className="knowledge-workspace" aria-label="知识工作区" data-layout="2.5/3.5/6">
        <KnowledgeSidebar
          activeCollection={params.get('collection') ?? undefined}
          activeTag={params.get('tag') ?? undefined}
          collections={knowledge.collections}
          notes={knowledge.notes}
          onCollection={(id) => changeParam('collection', id)}
          onTag={(tag) => changeParam('tag', tag)}
          resurfaced={knowledge.resurfaced}
        />
        <KnowledgeList notes={knowledge.notes} onSelect={select} restoreFocusId={restoreFocusId} selectedId={selected?.id} />
        {creating ? <KnowledgeComposer onCancel={close} onCreate={create} /> : selected ? <KnowledgeEditor
          key={selected.id}
          focusBackOnMount
          note={selected}
          notes={knowledge.notes}
          onAddRelation={(note, relatedId) => knowledge.addRelation(note.id, relatedId, note.version).then(() => undefined)}
          onArchive={(note) => knowledge.archive(note.id, note.version).then(() => undefined)}
          onBack={close}
          onDelete={remove}
          onFavorite={(note) => knowledge.update(note.id, { favorite: !note.favorite, version: note.version }).then(() => undefined)}
          onOpenRelated={(id) => select(id)}
          onOpenSource={(type, id) => {
            const destination = type === 'record' ? `/app/records?record=${encodeURIComponent(id)}`
              : type === 'review' ? `/app/reviews?review=${encodeURIComponent(id)}`
                : type === 'goal' ? `/app/goals?goal=${encodeURIComponent(id)}`
                  : `/app/goals?project=${encodeURIComponent(id)}`
            void navigate(destination)
          }}
          onPin={(note) => knowledge.update(note.id, { pinned: !note.pinned, version: note.version }).then(() => undefined)}
          onRemoveRelation={(note, relatedId) => knowledge.removeRelation(note.id, relatedId, note.version).then(() => undefined)}
          onUpdate={(id, input) => knowledge.update(id, input, false)}
        /> : <section className="knowledge-editor is-empty" role="region" aria-label="知识阅读与编辑" data-grid-span="6">
          <p>Reading desk</p><h2>选择一条知识继续</h2><span>左边收拢范围，中间选择对象，右边阅读、修正并安排复习。</span><button type="button" onClick={() => setCreating(true)}>新建知识</button>
        </section>}
      </section>

      {deleted ? <div className="knowledge-undo" role="status"><span>已删除“{deleted.title}”</span><button type="button" onClick={() => void restore()}>恢复刚删除的知识</button></div> : null}
    </article>
  )
}
