import { type FormEvent, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PrivateSurface } from '../../components/private/PrivateSurface'
import { useLifeRepository, useLifeState } from '../../state/LifeDataContext'

export function RecordsPage() {
  const repository = useLifeRepository()
  const state = useLifeState()
  const [params] = useSearchParams()
  const planId = params.get('plan') ?? undefined
  const sourcePlan = state.plans.find((plan) => plan.id === planId)
  const [title, setTitle] = useState(sourcePlan ? `${sourcePlan.title} · 记录` : '')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState('')
  const [createdId, setCreatedId] = useState<string>()
  const latestRecords = useMemo(() => [...state.records].reverse(), [state.records])

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const record = await repository.createRecord({ planId, title, body, tags: tags.split(/[,，]/) })
    setCreatedId(record.id)
    setTitle('')
    setBody('')
    setTags('')
  }

  return (
    <PrivateSurface title="生活不是流水账，是发生过的证据。" lead="计划可以没完成，记录不必漂亮；只要它确实属于今天。">
      <section className="record-river" aria-label="生活记录时间流">
        <div className="record-river__stream">
          <span className="record-river__line" aria-hidden="true" />
          {latestRecords.length === 0 ? <div className="life-empty"><span>NOW</span><div><strong>还没有生活记录</strong><p>完成一件计划后回来，或直接写下刚刚发生的事。</p></div></div> : latestRecords.map((record, index) => (
            <article className={index % 2 ? 'is-right' : ''} key={record.id}>
              <time>{new Date(record.occurredAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}</time>
              <span />
              <div><h2>{record.title}</h2><small>{record.planId ? '来自计划' : '直接记录'}</small><p>{record.body}</p>{record.tags.length > 0 && <small>{record.tags.join(' · ')}</small>}</div>
            </article>
          ))}
        </div>
        <form className="life-form life-form--record" onSubmit={save}>
          <h2>{sourcePlan ? '把完成后的感受留下来' : '写下刚刚发生的事'}</h2>
          {sourcePlan && <p className="source-trace">来源计划 · {sourcePlan.title}</p>}
          <label htmlFor="record-title">记录标题</label>
          <input id="record-title" value={title} onChange={(event) => setTitle(event.target.value)} required />
          <label htmlFor="record-body">记录内容</label>
          <textarea id="record-body" value={body} onChange={(event) => setBody(event.target.value)} rows={5} required />
          <label htmlFor="record-tags">标签（逗号分隔）</label>
          <input id="record-tags" value={tags} onChange={(event) => setTags(event.target.value)} />
          <button className="life-primary-action" type="submit" aria-label="保存生活记录">保存生活记录 <span>→</span></button>
          {createdId && <Link className="next-loop-link" to="/app/reviews">进入周期回顾</Link>}
        </form>
      </section>
    </PrivateSurface>
  )
}
