import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PrivateSurface } from '../../components/private/PrivateSurface'
import type { SourceType } from '../../domain/types'
import { useLifeRepository, useLifeState } from '../../state/LifeDataContext'

export function SnapshotsPage() {
  const repository = useLifeRepository()
  const state = useLifeState()
  const [params] = useSearchParams()
  const requestedType = params.get('source')
  const sourceType: SourceType | undefined = ['plan', 'record', 'review', 'knowledge'].includes(requestedType ?? '') ? requestedType as SourceType : undefined
  const sourceId = params.get('id') ?? undefined
  const [snapshotId, setSnapshotId] = useState<string>()
  const [publicTitle, setPublicTitle] = useState('')
  const [publicExcerpt, setPublicExcerpt] = useState('')
  const source = useMemo(() => {
    if (!sourceType || !sourceId) return undefined
    if (sourceType === 'knowledge') return state.knowledge.find((item) => item.id === sourceId)
    if (sourceType === 'record') return state.records.find((item) => item.id === sourceId)
    if (sourceType === 'review') return state.reviews.find((item) => item.id === sourceId)
    return state.plans.find((item) => item.id === sourceId)
  }, [sourceId, sourceType, state])
  const suggestedTitle = useMemo(() => {
    if (!source) return ''
    return 'title' in source ? source.title : 'summary' in source ? source.summary.slice(0, 42) : 'LifeOps 快照'
  }, [source])
  const current = state.snapshots.find((snapshot) => snapshot.id === snapshotId)

  useEffect(() => {
    setSnapshotId(undefined)
    setPublicTitle(suggestedTitle)
    setPublicExcerpt('')
  }, [sourceId, sourceType, suggestedTitle])

  const sourceCopy = async () => {
    if (!source || !sourceType || !sourceId) return
    const snapshot = await repository.createSnapshot({ sourceType, sourceId, title: publicTitle, excerpt: publicExcerpt })
    setSnapshotId(snapshot.id)
  }

  return (
    <PrivateSurface title="公开的是副本，不是你的私人原文。" lead="先预览允许公开的标题和摘录，再明确发布；撤回后，公开入口立即回到私人状态。">
      <section className="snapshot-studio" aria-label="公开快照工作台">
        <div className="snapshot-preview">
          <h2>快照预览</h2>
          {current ? <article><span>LifeOps · PUBLIC SNAPSHOT</span><h2>{current.title}</h2><p>{current.excerpt}</p><footer><small>由私人内容生成的独立副本</small><b>{current.visibility === 'public' ? '公开中' : '仅自己可见'}</b></footer></article> : <div className="life-empty"><span>◌</span><div><strong>还没有快照预览</strong><p>{source ? '先在右侧主动编辑允许公开的标题与摘录；私人正文不会自动进入副本。' : '请从记录、回顾或知识页面选择一条来源。'}</p></div></div>}
        </div>
        <div className="snapshot-controls">
          <h2>每一次公开，都要是有意识的选择。</h2>
          {source && <p className="source-trace">当前来源 · {'title' in source ? source.title : 'summary' in source ? source.summary : 'LifeOps 内容'}</p>}
          {source && !current && <div className="snapshot-draft">
            <label htmlFor="snapshot-public-title">公开快照标题</label>
            <input id="snapshot-public-title" value={publicTitle} onChange={(event) => setPublicTitle(event.target.value)} />
            <label htmlFor="snapshot-public-excerpt">公开摘录</label>
            <textarea id="snapshot-public-excerpt" rows={5} value={publicExcerpt} onChange={(event) => setPublicExcerpt(event.target.value)} placeholder="只写下你确认可以离开私人空间的内容" />
            <small>不会自动复制私人正文、标签或来源关系。</small>
          </div>}
          {!current && <button className="life-primary-action" type="button" aria-label="生成快照预览" onClick={sourceCopy} disabled={!source || !publicTitle.trim() || !publicExcerpt.trim()}>生成快照预览 <span>→</span></button>}
          {current?.visibility === 'private' && <button className="life-primary-action" type="button" aria-label="公开这份快照" onClick={() => void repository.publishSnapshot(current.id)}>公开这份快照 <span>↗</span></button>}
          {current?.visibility === 'public' && <><Link className="next-loop-link" to={`/snapshots/${current.slug}`} target="_blank" rel="noopener noreferrer">查看公开页面</Link><button className="life-secondary-action" type="button" onClick={() => void repository.revokeSnapshot(current.id)}>撤回公开</button></>}
          <div className="snapshot-ledger"><h3>历史快照</h3>{state.snapshots.length === 0 ? <small>暂无历史</small> : [...state.snapshots].reverse().map((snapshot) => <button type="button" key={snapshot.id} onClick={() => setSnapshotId(snapshot.id)}><span className={snapshot.visibility} /><strong>{snapshot.title}</strong><small>{snapshot.visibility === 'public' ? '公开' : '私人'}</small></button>)}</div>
        </div>
      </section>
    </PrivateSurface>
  )
}
