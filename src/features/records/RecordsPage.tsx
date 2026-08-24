import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useBlocker, useSearchParams } from 'react-router-dom'
import type { LifeRecord, RecordFilters, RecordLink, RecordLinkType } from '../../domain/records'
import { useAuth } from '../../state/AuthContext'
import { RecordEditor } from './RecordEditor'
import { RecordStream } from './RecordStream'
import { useRecords } from './useRecords'

interface RecordsPageProps { now?: Date }

interface SourceResult {
  error?: 'duplicate' | 'malformed'
  link?: RecordLink
  raw: string
}

const sourceTypes = new Set<RecordLinkType>(['goal', 'project', 'task', 'habit'])

function sourceFrom(params: URLSearchParams): SourceResult {
  const values = params.getAll('source')
  if (values.length > 1) return { error: 'duplicate', raw: values.join(' · ') }
  const raw = values[0] ?? ''
  if (!raw) return { raw: '' }
  const separator = raw.indexOf(':')
  if (separator <= 0 || separator === raw.length - 1) return { error: 'malformed', raw }
  const type = raw.slice(0, separator)
  const id = raw.slice(separator + 1)
  if (!sourceTypes.has(type as RecordLinkType) || !id) return { error: 'malformed', raw }
  return { link: { type: type as RecordLinkType, id }, raw }
}

function filtersFrom(params: URLSearchParams, source: SourceResult): RecordFilters {
  const filters: RecordFilters = {}
  for (const key of ['from', 'to', 'tag', 'q'] as const) {
    const value = params.get(key)
    if (value) filters[key] = value
  }
  if (source.link) {
    filters.linkType = source.link.type
    filters.linkId = source.link.id
  }
  return filters
}

function statusMessage(status: ReturnType<typeof useRecords>['status']) {
  if (status === 'forbidden') return '你没有访问这些记录的权限。'
  if (status === 'conflict') return '记录已在另一处更新，本地修改没有覆盖服务器版本。'
  if (status === 'disconnected') return '当前设备离线；未保存内容只保留在本次浏览器会话。'
  return '记录暂时无法读取，请检查连接后重试。'
}

export function RecordsPage({ now = new Date() }: RecordsPageProps) {
  const { csrfToken } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const source = useMemo(() => sourceFrom(searchParams), [searchParams])
  const filters = useMemo(() => filtersFrom(searchParams, source), [searchParams, source])
  const recordsState = useRecords(filters, !source.error)
  const [deleted, setDeleted] = useState<{ id: string; title: string; version: number } | null>(null)
  const [editorDirty, setEditorDirty] = useState(false)
  const allowNavigation = useRef(false)
  const createMode = searchParams.get('create') === 'record'
  const requestedId = searchParams.get('record') ?? undefined
  const selected = createMode ? undefined : recordsState.records.find((record) => record.id === requestedId)
    ?? (!requestedId ? recordsState.records[0] : undefined)

  const blocker = useBlocker(({ currentLocation, nextLocation }) => (
    editorDirty
    && !allowNavigation.current
    && `${currentLocation.pathname}${currentLocation.search}` !== `${nextLocation.pathname}${nextLocation.search}`
  ))

  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (window.confirm('这份记录还有未保存内容。仍要离开当前编辑器吗？')) blocker.proceed()
    else blocker.reset()
  }, [blocker])

  const navigate = useCallback((next: URLSearchParams, replace = false) => {
    allowNavigation.current = true
    setSearchParams(next, { replace })
    queueMicrotask(() => { allowNavigation.current = false })
  }, [setSearchParams])

  const select = useCallback((id: string) => {
    const next = new URLSearchParams(searchParams)
    next.delete('create')
    next.set('record', id)
    navigate(next)
  }, [navigate, searchParams])

  const create = useCallback(() => {
    const next = new URLSearchParams(searchParams)
    next.delete('record')
    next.set('create', 'record')
    navigate(next)
  }, [navigate, searchParams])

  const closeEditor = useCallback(() => {
    const next = new URLSearchParams(searchParams)
    next.delete('record')
    next.delete('create')
    navigate(next)
  }, [navigate, searchParams])

  const updateFilter = (key: 'from' | 'to' | 'tag' | 'source' | 'q', value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    navigate(next, true)
  }

  const remove = async (record: LifeRecord) => {
    await recordsState.remove(record.id, record.version)
    setDeleted({ id: record.id, title: record.title, version: record.version + 1 })
    setEditorDirty(false)
    const next = new URLSearchParams(searchParams)
    next.delete('record')
    navigate(next, true)
  }

  const restore = async () => {
    if (!deleted) return
    const restored = await recordsState.restore(deleted.id, deleted.version)
    setDeleted(null)
    select(restored.id)
  }

  const createRecord = async (input: Parameters<typeof recordsState.create>[0]) => {
    const created = await recordsState.create(input)
    setEditorDirty(false)
    const next = new URLSearchParams(searchParams)
    next.delete('create')
    next.set('record', created.id)
    navigate(next, true)
    return created
  }

  const pageFailure = ['network-error', 'forbidden', 'conflict', 'disconnected'].includes(recordsState.status)

  return (
    <article className="records-page" data-records-page data-mobile-editor-open={Boolean(createMode || requestedId)}>
      <header className="records-page__heading">
        <div><h1 tabIndex={-1}>记录</h1><p>把发生过的事实、感受和来源留在同一条可回看的时间流里。</p></div>
        <button type="button" onClick={create}>新建记录</button>
      </header>

      <form className="records-filter" role="search" aria-label="筛选记录" onSubmit={(event) => event.preventDefault()}>
        <label><span>从</span><input type="date" value={searchParams.get('from') ?? ''} onChange={(event) => updateFilter('from', event.target.value)} /></label>
        <label><span>到</span><input type="date" value={searchParams.get('to') ?? ''} onChange={(event) => updateFilter('to', event.target.value)} /></label>
        <label><span>标签</span><input value={searchParams.get('tag') ?? ''} onChange={(event) => updateFilter('tag', event.target.value)} /></label>
        <label><span>来源</span><input aria-label="来源" value={source.raw} placeholder="task:任务ID" onChange={(event) => updateFilter('source', event.target.value)} /></label>
        <label className="records-filter__query"><span>正文搜索</span><input type="search" value={searchParams.get('q') ?? ''} onChange={(event) => updateFilter('q', event.target.value)} /></label>
      </form>

      {source.error ? <div className="records-page__source-error" role="alert" aria-label="来源筛选错误">
        <strong>来源筛选格式无效</strong><span>请使用 goal、project、task 或 habit，加一个冒号和非空 ID。</span>
      </div> : null}
      {pageFailure ? <div className="records-page__error" role="alert"><p>{statusMessage(recordsState.status)}</p><button type="button" onClick={recordsState.retry}>重新加载</button></div> : null}
      {recordsState.status === 'loading' ? <p className="records-page__loading" role="status">正在整理记录时间流…</p> : null}

      <section className="records-workspace" role="region" aria-label="记录工作区" data-layout="8/4">
        <RecordStream records={recordsState.records} selectedId={selected?.id} onSelect={select} />
        {createMode ? <RecordEditor
          csrfToken={csrfToken}
          isSaving={recordsState.isSaving}
          sourceLink={source.link}
          onBack={closeEditor}
          onCreate={createRecord}
          onDirtyChange={setEditorDirty}
        /> : selected ? <RecordEditor
          key={selected.id}
          csrfToken={csrfToken}
          isSaving={recordsState.isSaving}
          record={selected}
          onBack={closeEditor}
          onDelete={remove}
          onDirtyChange={setEditorDirty}
          onUpdate={recordsState.update}
        /> : <section className="record-editor is-empty" role="region" aria-label="记录编辑器" data-grid-span="4">
          <h2>{source.error ? '先修正来源筛选' : '选择一条记录继续'}</h2>
          <p>{source.error ? '无效来源只影响当前筛选，不会发送猜测出来的请求。' : '也可以新建一条记录，把刚刚发生的事留下来。'}</p>
          {!source.error ? <button type="button" onClick={create}>新建记录</button> : null}
        </section>}
      </section>

      {deleted ? <div className="records-undo" role="status"><span>已删除“{deleted.title}”</span><button type="button" onClick={() => void restore()}>恢复刚删除的记录</button></div> : null}
      <time className="records-page__today" dateTime={now.toISOString()}>{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long' }).format(now)}</time>
    </article>
  )
}
