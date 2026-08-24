import { useQuery } from '@tanstack/react-query'
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { lifeCommerceApi } from '../../../api/lifeCommerceApi'
import { HttpError } from '../../../api/httpClient'
import { queryKeys } from '../../../api/queryKeys'
import { useAuth } from '../../../state/AuthContext'
import { BudgetSummary } from '../budgets/BudgetSummary'

function dateKey(offset = 0) {
  const value = new Date()
  value.setDate(value.getDate() + offset)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function money(minor: number) {
  return `¥${(minor / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function monthBounds(date: string) {
  const value = new Date(`${date}T00:00:00`)
  const year = value.getFullYear()
  const month = value.getMonth()
  const startsOn = `${year}-${String(month + 1).padStart(2, '0')}-01`
  const end = new Date(year, month + 1, 0)
  const endsOn = `${year}-${String(month + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`
  return { startsOn, endsOn }
}

function analyticsErrorMessage(error: unknown, action: 'load' | 'write') {
  if (error instanceof HttpError) {
    if (error.status === 0 || error.code === 'NETWORK_ERROR') return action === 'load' ? '当前设备离线；不会用估算值替代事实。' : '当前设备离线，预算没有创建。'
    if (error.status === 403) return action === 'load' ? '当前账户没有权限读取生活分析。' : '当前账户没有权限创建预算。'
    if (error.status === 409) return '预算事实已在另一处更新。请重新载入后再提交。'
  }
  return action === 'load' ? '日期范围内的事实没有完整返回。' : '预算没有创建，请重新载入后重试。'
}

function BudgetDialog({ to, pending, onClose, onCreate }: { to: string; pending: boolean; onClose(): void; onCreate(name: string, amountMinor: number): Promise<void> }) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('1000')
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { closeRef.current?.focus() }, [])
  return <div className="life-commerce-layer" onKeyDown={(event) => { if (event.key === 'Escape' && !pending) onClose() }}>
    <button type="button" aria-label="取消新建预算" onClick={onClose} disabled={pending} />
    <section role="dialog" aria-modal="true" aria-label="新建生活预算">
      <header><div><span>Budget guardrail</span><h2>新建生活预算</h2></div><button ref={closeRef} type="button" onClick={onClose} disabled={pending}>关闭</button></header>
      <div className="purchase-confirm__body">
        <p>预算提供 50%、80% 与 100% 三个明确阈值；现金支出与消耗成本仍各自统计。</p>
        <label>预算名称<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>预算金额（元）<input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <span>预算月份：{to.slice(0, 7)}</span>
      </div>
      <footer><button type="button" onClick={onClose} disabled={pending}>取消</button><button type="button" disabled={pending || !name.trim() || !(Number(amount) > 0)} onClick={() => void onCreate(name.trim(), Math.round(Number(amount) * 100))}>{pending ? '正在创建…' : '创建预算'}</button></footer>
    </section>
  </div>
}

export function LifeAnalyticsPage() {
  const auth = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const from = searchParams.get('from') ?? dateKey(-6)
  const to = searchParams.get('to') ?? dateKey()
  const [draftFrom, setDraftFrom] = useState(from)
  const [draftTo, setDraftTo] = useState(to)
  const [budgetOpen, setBudgetOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [writeError, setWriteError] = useState('')
  const headingRef = useRef<HTMLHeadingElement>(null)
  const analyticsQuery = useQuery({
    queryKey: queryKeys.lifeCommerce.list({ view: 'analytics', from, to }),
    queryFn: ({ signal }) => lifeCommerceApi.getAnalytics({ from, to }, signal),
  })
  const budgetsQuery = useQuery({
    queryKey: queryKeys.lifeCommerce.list({ view: 'budgets', asOf: to }),
    queryFn: ({ signal }) => lifeCommerceApi.listBudgets(to, signal),
  })

  useEffect(() => { setDraftFrom(from); setDraftTo(to) }, [from, to])
  useEffect(() => {
    if (analyticsQuery.data) requestAnimationFrame(() => headingRef.current?.focus())
  }, [analyticsQuery.data])

  const chart = useMemo(() => {
    const days = analyticsQuery.data?.days ?? []
    const max = Math.max(1, ...days.flatMap((day) => [day.cashExpenditure.status === 'recorded' ? day.cashExpenditure.valueMinor : 0, day.consumptionCost.status === 'recorded' ? day.consumptionCost.valueMinor : 0]))
    return { days, max }
  }, [analyticsQuery.data])

  const submitRange = (event: FormEvent) => {
    event.preventDefault()
    setSearchParams({ from: draftFrom, to: draftTo })
  }

  const createBudget = async (name: string, limitMinor: number) => {
    setBusy(true)
    setWriteError('')
    try {
      const period = monthBounds(to)
      await lifeCommerceApi.createBudget({ name, scope: { kind: 'all-life' }, period: { kind: 'monthly', ...period }, limitMinor, thresholds: [0.5, 0.8, 1], rolloverMinor: 0 }, `budget-${crypto.randomUUID()}`, auth.csrfToken)
      setNotice(`${name}已创建；支出事实与消耗成本仍分开计算`)
      setBudgetOpen(false)
    } catch (error) {
      setWriteError(analyticsErrorMessage(error, 'write'))
    } finally {
      setBusy(false)
    }
  }

  if (analyticsQuery.isPending || budgetsQuery.isPending) return <main className="life-commerce-workspace is-loading" aria-busy="true"><span className="life-commerce-loader" /><p>正在汇总可追溯事实…</p></main>
  if (analyticsQuery.error || budgetsQuery.error || !analyticsQuery.data) return <main className="life-commerce-workspace"><div className="life-commerce-load-error" role="alert"><strong>分析暂时无法载入</strong><p>{analyticsErrorMessage(analyticsQuery.error ?? budgetsQuery.error, 'load')}</p><button type="button" onClick={() => { void analyticsQuery.refetch(); void budgetsQuery.refetch() }}>重新载入分析</button></div></main>

  const analytics = analyticsQuery.data
  return <main className="life-commerce-workspace life-analytics-workspace">
    {writeError ? <div className="life-commerce-write-error" role="alert"><strong>预算未保存</strong><span>{writeError}</span><button type="button" onClick={() => setWriteError('')}>关闭</button></div> : null}
    <header className="life-commerce-heading">
      <div><span>Traceable life ledger</span><h1 ref={headingRef} tabIndex={-1}>生活分析</h1><p>现金支出回答“付了多少钱”，消耗成本回答“实际用了多少价值”；无记录不会伪装成零。</p></div>
      <button type="button" onClick={() => setBudgetOpen(true)}>新建预算</button>
    </header>
    <form className="life-analytics-range" onSubmit={submitRange} aria-label="分析日期范围">
      <label>开始日期<input type="date" value={draftFrom} onChange={(event) => setDraftFrom(event.target.value)} /></label>
      <span aria-hidden="true">→</span>
      <label>结束日期<input type="date" value={draftTo} onChange={(event) => setDraftTo(event.target.value)} /></label>
      <button type="submit" disabled={!draftFrom || !draftTo || draftFrom > draftTo}>应用范围</button>
    </form>
    <section className="life-analytics-totals" aria-label="分析总计">
      <article><span>Cash out</span><strong>现金支出 {money(analytics.totals.cashExpenditureMinor)}</strong><p>采购与退款的实际现金净额</p></article>
      <article><span>Consumed</span><strong>消耗成本 {money(analytics.totals.consumptionCostMinor)}</strong><p>仅由完成事实产生的成本快照</p></article>
      <article><span>Execution</span><strong>{analytics.totals.actualCount} / {analytics.totals.plannedCount}</strong><p>{analytics.totals.incompleteCount} 项仍未完成</p></article>
    </section>
    <BudgetSummary budgets={budgetsQuery.data ?? []} />

    <section className="life-analytics-chart" aria-label="趋势图与数据">
      <header><div><span>Daily comparison</span><h2>每日趋势</h2></div><p>图形与下方表格表达同一组数据。</p></header>
      <svg role="img" aria-label="现金支出与消耗成本趋势" viewBox={`0 0 ${Math.max(420, chart.days.length * 120)} 220`} preserveAspectRatio="none">
        <title>现金支出与消耗成本趋势</title>
        <desc>每个日期包含现金支出与消耗成本两根柱；无记录日期不绘制数值柱。</desc>
        {chart.days.map((day, index) => {
          const x = 42 + index * 120
          const cash = day.cashExpenditure.status === 'recorded' ? day.cashExpenditure.valueMinor : 0
          const cost = day.consumptionCost.status === 'recorded' ? day.consumptionCost.valueMinor : 0
          return <g key={day.date}>
            <line x1={x - 8} x2={x + 82} y1="178" y2="178" className="life-chart-axis" />
            {day.cashExpenditure.status === 'recorded' ? <rect x={x} y={178 - (cash / chart.max) * 132} width="26" height={(cash / chart.max) * 132} rx="3" className="life-chart-cash" /> : null}
            {day.consumptionCost.status === 'recorded' ? <rect x={x + 34} y={178 - (cost / chart.max) * 132} width="26" height={(cost / chart.max) * 132} rx="3" className="life-chart-cost" /> : null}
            <text x={x - 6} y="202">{day.date.slice(5)}</text>
          </g>
        })}
      </svg>
      <div className="life-chart-legend"><span><i className="is-cash" />现金支出</span><span><i className="is-cost" />消耗成本</span><span><i className="is-none" />无记录不绘制</span></div>
      <div className="life-analytics-table-wrap" tabIndex={0} aria-label="可横向滚动的生活分析数据表"><table aria-label="生活分析数据表"><thead><tr><th>日期</th><th>现金支出</th><th>消耗成本</th><th>计划执行</th><th>来源</th></tr></thead><tbody>{analytics.days.map((day) => <tr key={day.date}><th scope="row">{day.date}</th><td>{day.cashExpenditure.status === 'recorded' ? money(day.cashExpenditure.valueMinor) : '无记录'}</td><td>{day.consumptionCost.status === 'recorded' ? money(day.consumptionCost.valueMinor) : '无记录'}</td><td>{day.planExecution.status === 'recorded' ? `${day.planExecution.actualCount} / ${day.planExecution.plannedCount} · 未完成 ${day.planExecution.incompleteCount}` : '无记录'}</td><td>{day.cashExpenditure.status === 'recorded' && day.cashExpenditure.sourceIds.length ? day.cashExpenditure.sourceIds.map((sourceId) => <Link key={sourceId} to={`/app/life/shopping?source=${encodeURIComponent(sourceId)}&return=${encodeURIComponent(`/app/life/analytics?from=${from}&to=${to}`)}`}>查看 {sourceId}</Link>) : '—'}</td></tr>)}</tbody></table></div>
    </section>
    {notice ? <p className="life-commerce-notice" role="status" aria-label="预算结果">{notice}</p> : null}
    {budgetOpen ? <BudgetDialog to={to} pending={busy} onClose={() => setBudgetOpen(false)} onCreate={createBudget} /> : null}
  </main>
}
