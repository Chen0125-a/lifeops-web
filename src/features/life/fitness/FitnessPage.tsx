import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { lifePlanningApi } from '../../../api/lifePlanningApi'
import type { DayPlan, FitnessActivity, LifePlanItem, PlanningCompletionSnapshot } from '../../../domain/lifePlanning'

function localDateKey() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function key(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function activityEnergy(activity: FitnessActivity) {
  return activity.kcalPerHour * activity.defaultMinutes / 60
}

export function FitnessPage() {
  const [searchParams] = useSearchParams()
  const date = searchParams.get('date') ?? localDateKey()
  const [activities, setActivities] = useState<FitnessActivity[]>([])
  const [plan, setPlan] = useState<DayPlan | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [builderOpen, setBuilderOpen] = useState(false)
  const [completionItem, setCompletionItem] = useState<LifePlanItem | null>(null)
  const [actualMinutes, setActualMinutes] = useState('45')
  const [submitting, setSubmitting] = useState(false)
  const [completion, setCompletion] = useState<PlanningCompletionSnapshot | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    Promise.all([
      lifePlanningApi.listFitness(controller.signal),
      lifePlanningApi.getDayPlan(date, controller.signal),
      lifePlanningApi.getDayProjection(date, controller.signal),
    ]).then(([catalog, loadedPlan]) => {
      setActivities(catalog)
      setPlan(loadedPlan)
      setLoading(false)
      requestAnimationFrame(() => headingRef.current?.focus())
    }).catch((caught: unknown) => {
      if (controller.signal.aborted) return
      setLoading(false)
      setError(caught instanceof Error ? caught.message : '健身事实无法载入')
    })
    return () => controller.abort()
  }, [date])

  const selectedActivities = useMemo(() => activities.filter((activity) => selected.includes(activity.id)), [activities, selected])
  const totalMinutes = selectedActivities.reduce((sum, activity) => sum + activity.defaultMinutes, 0)
  const totalEnergy = Math.round(selectedActivities.reduce((sum, activity) => sum + activityEnergy(activity), 0))
  const primaryRate = activities.find((activity) => activity.id === completionItem?.source?.id)?.kcalPerHour ?? 0
  const completionEnergy = Math.round(primaryRate * (Number(actualMinutes) || 0) / 60)

  const write = async (operation: () => Promise<void>) => {
    setError(null)
    try { await operation() } catch (caught) { setError(caught instanceof Error ? caught.message : '这次更改没有保存') }
  }

  const addCombination = () => write(async () => {
    if (!plan || !selectedActivities.length) return
    const title = selectedActivities.map((activity) => activity.name).join(' + ')
    const item = {
      kind: 'fitness' as const,
      title,
      mealSlotId: null,
      scheduledTime: '18:30',
      source: { type: 'fitness-activity' as const, id: selectedActivities[0].id },
      quantity: null,
      unit: null,
      servings: null,
      durationMinutes: totalMinutes,
    }
    const saved = await lifePlanningApi.updateDayPlan(date, {
      entityVersion: plan.entityVersion,
      mealSlots: plan.mealSlots,
      items: [
        ...plan.items.map((entry) => ({
          id: entry.id, entityVersion: entry.entityVersion,
          kind: entry.kind, title: entry.title, mealSlotId: entry.mealSlotId, scheduledTime: entry.scheduledTime,
          source: entry.source, quantity: entry.quantity, unit: entry.unit, servings: entry.servings, durationMinutes: entry.durationMinutes,
        })),
        item,
      ],
    }, undefined)
    setPlan(saved)
    setBuilderOpen(false)
    setSelected([])
    setNotice('组合训练已加入当天计划。')
  })

  const complete = async () => {
    if (!completionItem || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const saved = await lifePlanningApi.createCompletion({
        date,
        dayPlanItemId: completionItem.id,
        completedAt: new Date().toISOString(),
        actualMinutes: Number(actualMinutes),
      }, key('fitness-completion'), undefined)
      setCompletion(saved)
      setCompletionItem(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '完成事实没有保存')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <main className="fitness-workspace is-loading" aria-busy="true"><span className="life-plan-skeleton" /><p>正在读取健身事实…</p></main>
  if (!plan) return <main className="fitness-workspace"><div className="life-plans-load-error" role="alert"><strong>健身计划暂时无法载入</strong><p>{error}</p></div></main>

  return <main className="fitness-workspace">
    <header className="fitness-workspace__heading">
      <div><span>Movement ledger · {date}</span><h1 ref={headingRef} tabIndex={-1}>健身计划</h1><p>训练结构由你维护；热量只按你提供的参数估算，实际时长单独记录。</p></div>
      <div><strong>{plan.items.filter((item) => item.kind === 'fitness').length}</strong><span>当天训练</span></div>
    </header>
    {error ? <div className="life-plan-write-error" role="alert"><strong>这次更改没有保存</strong><span>{error}</span><button type="button" onClick={() => setError(null)}>关闭</button></div> : null}
    {notice ? <p className="fitness-workspace__notice" role="status">{notice}</p> : null}
    {completion ? <section className="fitness-completion-status" role="status" aria-label="健身完成事实">
      <div><span>已记录完成</span><strong>实际 {completion.actualMinutes} 分钟</strong><p>{completion.estimatedEnergyKcal} kcal（用户估算）</p></div>
      <button type="button" onClick={() => void write(async () => { await lifePlanningApi.undoCompletion(completion.id, key('undo-fitness'), undefined); setCompletion(null); setNotice('已撤销完成；计划恢复为未完成。') })}>撤销本次完成</button>
    </section> : null}
    <section className="fitness-workspace__composition">
      <header><div><span>Activity library</span><h2>组合你的训练</h2></div><button type="button" disabled={!selected.length} onClick={() => setBuilderOpen(true)}>加入组合训练</button></header>
      <div className="fitness-activity-ledger">
        {activities.map((activity) => <article key={activity.id}>
          <label><input type="checkbox" aria-label={`选择${activity.name}`} checked={selected.includes(activity.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, activity.id] : current.filter((id) => id !== activity.id))} /><span>{activity.intensity}</span></label>
          <h3>{activity.name}</h3>
          <p>{activity.defaultMinutes} 分钟 · {activity.kcalPerHour} kcal/小时（用户维护）</p>
          <small>{activity.steps.join(' → ')}</small>
        </article>)}
      </div>
    </section>
    <section className="fitness-workspace__today">
      <header><span>Today</span><h2>{date} 的训练</h2></header>
      {plan.items.filter((item) => item.kind === 'fitness').length ? <ol>{plan.items.filter((item) => item.kind === 'fitness').map((item) => <li key={item.id}>
        <div><time>{item.scheduledTime ?? '待安排'}</time><strong>{item.title}</strong><span>计划 {item.durationMinutes ?? 0} 分钟 · 预计值</span></div>
        <button type="button" aria-label={`完成${item.title}`} onClick={() => { setCompletionItem(item); setActualMinutes(String(item.durationMinutes ?? 30)) }}>记录实际</button>
      </li>)}</ol> : <div className="fitness-workspace__empty"><strong>这一天还没有训练计划</strong><p>从上方选择活动，或保持空白。</p></div>}
    </section>

    {builderOpen ? <div className="life-plan-task-layer" onKeyDown={(event) => { if (event.key === 'Escape') setBuilderOpen(false) }}>
      <button type="button" aria-label="取消组合训练" onClick={() => setBuilderOpen(false)} />
      <section role="dialog" aria-modal="true" aria-label="组合训练">
        <header><div><span>Composition</span><h2>组合训练</h2></div><button type="button" onClick={() => setBuilderOpen(false)}>关闭</button></header>
        <div className="fitness-builder__body">
          <ol>{selectedActivities.map((activity) => <li key={activity.id}><strong>{activity.name} · {activity.defaultMinutes} 分钟</strong><span>{Math.round(activityEnergy(activity))} kcal（估算）</span></li>)}</ol>
          <dl><div><dt>总时长</dt><dd>计划 {totalMinutes} 分钟</dd></div><div><dt>能量</dt><dd>预计消耗 {totalEnergy} kcal · 用户估算</dd></div></dl>
        </div>
        <footer><button type="button" onClick={() => setBuilderOpen(false)}>取消</button><button type="button" onClick={() => void addCombination()}>加入 {date}</button></footer>
      </section>
    </div> : null}
    {completionItem ? <div className="life-plan-task-layer life-plan-task-layer--deep" onKeyDown={(event) => { if (event.key === 'Escape' && !submitting) setCompletionItem(null) }}>
      <button type="button" aria-label="取消完成训练" onClick={() => { if (!submitting) setCompletionItem(null) }} />
      <section role="dialog" aria-modal="true" aria-label={`完成${completionItem.title}`}>
        <header><div><span>Actual completion</span><h2>完成{completionItem.title}</h2></div><button type="button" disabled={submitting} onClick={() => setCompletionItem(null)}>关闭</button></header>
        <div className="fitness-builder__body">
          <label>实际时长（分钟）<input type="number" min="0" step="1" value={actualMinutes} onChange={(event) => setActualMinutes(event.target.value)} /></label>
          <p>按用户维护的 {primaryRate} kcal/小时估算：{completionEnergy} kcal</p>
          <small>这是用户参数推算，不是医疗或运动处方。</small>
        </div>
        <footer><button type="button" disabled={submitting} onClick={() => setCompletionItem(null)}>取消</button><button type="button" disabled={submitting || Number(actualMinutes) < 0} onClick={() => void complete()}>{submitting ? '正在记录…' : '确认实际完成'}</button></footer>
      </section>
    </div> : null}
  </main>
}

export const FitnessRoute = () => <FitnessPage />
