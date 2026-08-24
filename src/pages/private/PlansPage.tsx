import { type FormEvent, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLifeRepository, useLifeState } from '../../state/LifeDataContext'

export function PlansPage() {
  const repository = useLifeRepository()
  const state = useLifeState()
  const [title, setTitle] = useState('')
  const [scheduledFor, setScheduledFor] = useState('')
  const [filter, setFilter] = useState<'all' | 'planned' | 'done'>('all')
  const plans = useMemo(
    () => [...state.plans].reverse().filter((plan) => filter === 'all' || plan.status === filter),
    [filter, state.plans],
  )
  const add = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    await repository.createPlan({ title, scheduledFor: scheduledFor || undefined })
    setTitle('')
    setScheduledFor('')
  }

  return (
    <article className="workspace-surface plans-surface">
      <header className="workspace-surface__intro">
        <div><h1 tabIndex={-1}>计划</h1><p>让重要的事获得一个清楚、可以执行的下一步。</p></div>
        <div className="surface-filter" aria-label="筛选计划">
          {(['all', 'planned', 'done'] as const).map((value) => (
            <button type="button" aria-pressed={filter === value} key={value} onClick={() => setFilter(value)}>
              {value === 'all' ? '全部' : value === 'planned' ? '待完成' : '已完成'}
            </button>
          ))}
        </div>
      </header>
      <div className="plans-layout">
        <section className="plans-list" aria-label="计划列表">
          {plans.length === 0 ? (
            <div className="workspace-empty"><strong>这里还没有计划</strong><p>先写下一件能够在今天推进的事。</p></div>
          ) : plans.map((plan) => (
            <article className={plan.status === 'done' ? 'is-done' : ''} key={plan.id}>
              <span className="plan-check" />
              <time>{plan.scheduledFor || '—'}</time>
              <div><h2>{plan.title}</h2><p>{plan.status === 'done' ? '已经完成，可以为它留下记录。' : '等待执行'}</p></div>
              {plan.status === 'planned' ? (
                <button type="button" onClick={() => void repository.completePlan(plan.id)} aria-label={`完成 ${plan.title}`}>完成</button>
              ) : <Link to={`/app/records?plan=${plan.id}`}>留下记录</Link>}
            </article>
          ))}
        </section>
        <form className="plan-editor" onSubmit={add}>
          <h2>新计划</h2>
          <label htmlFor="plan-title">计划标题</label>
          <input id="plan-title" value={title} onChange={(event) => setTitle(event.target.value)} required />
          <label htmlFor="plan-time">安排时间</label>
          <input id="plan-time" type="time" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} />
          <button className="workspace-primary" type="submit" aria-label="保存计划">保存计划<span aria-hidden="true">→</span></button>
        </form>
      </div>
    </article>
  )
}
