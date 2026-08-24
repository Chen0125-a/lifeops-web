import { type FormEvent, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLifeRepository, useLifeState } from '../../state/LifeDataContext'

const hours = Array.from({ length: 17 }, (_, index) => index + 6)

export function PrivateHomePage() {
  const repository = useLifeRepository()
  const state = useLifeState()
  const [title, setTitle] = useState('')
  const now = useMemo(() => new Date(), [])
  const pending = state.plans.filter((plan) => plan.status === 'planned')
  const done = state.plans.filter((plan) => plan.status === 'done')
  const recentRecords = [...state.records].reverse().slice(0, 4)
  const add = async (event: FormEvent) => { event.preventDefault(); if (!title.trim()) return; await repository.createPlan({ title }); setTitle('') }

  return <article className="day-canvas" data-day-canvas><header className="day-canvas__intro"><div><h1>今天</h1><p>{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(now)}</p></div><form onSubmit={add}><label className="sr-only" htmlFor="day-plan">今天要推进什么</label><input id="day-plan" aria-label="今天要推进什么" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="写下今天真正重要的一件事" /><button type="submit" aria-label="加入今天">加入今天<span aria-hidden="true">＋</span></button></form></header><div className="day-canvas__grid"><section className="day-timeline" aria-label="今日日程"><div className="day-now-line" style={{ '--now-position': `${Math.min(100, Math.max(0, ((now.getHours() + now.getMinutes() / 60 - 6) / 16) * 100))}%` } as React.CSSProperties}><span>{now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</span></div><ol className="day-hours" aria-hidden="true">{hours.map((hour) => <li key={hour}>{String(hour).padStart(2, '0')}:00</li>)}</ol><div className="day-plan-lane">{pending.length === 0 && <div className="day-empty"><strong>今天还没有安排</strong><p>从上方写下一件重要的事，或者使用右上角快速记录。</p></div>}{pending.map((plan, index) => <article className="day-plan" key={plan.id} style={{ '--plan-row': plan.scheduledFor ? Number(plan.scheduledFor.slice(0, 2)) - 5 : index * 2 + 2 } as React.CSSProperties}><time>{plan.scheduledFor || '待安排'}</time><div><strong>{plan.title}</strong><small>等待发生</small></div><button type="button" onClick={() => void repository.completePlan(plan.id)} aria-label={`完成 ${plan.title}`}>完成</button></article>)}</div></section><aside className="day-context"><section><header><h2>接下来</h2><Link to="/app/plans" viewTransition>全部计划</Link></header>{pending.length === 0 ? <p className="context-empty">没有等待中的计划。</p> : pending.slice(0, 4).map((plan) => <Link className="context-row" key={plan.id} to="/app/plans" viewTransition><span /><div><strong>{plan.title}</strong><small>{plan.scheduledFor || '尚未安排时间'}</small></div><i aria-hidden="true">→</i></Link>)}</section><section><header><h2>待回顾</h2><Link to="/app/reviews" viewTransition>开始回顾</Link></header><div className="review-prompt"><strong>{done.length + state.records.length} 条证据</strong><p>{done.length} 件完成计划，{state.records.length} 条生活记录。</p></div></section><section><header><h2>最近记录</h2><Link to="/app/records" viewTransition>全部记录</Link></header>{recentRecords.length === 0 ? <p className="context-empty">完成计划后，记下一点真实发生的事。</p> : recentRecords.map((record) => <Link className="record-glance" key={record.id} to="/app/records" viewTransition><time>{new Date(record.occurredAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</time><strong>{record.title}</strong></Link>)}</section></aside></div></article>
}
