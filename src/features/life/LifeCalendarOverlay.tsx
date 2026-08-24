import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import type { CalendarDaySummary, DayPlanProjection, PlanningTimeline } from '../../domain/lifePlanning'

export interface LifeCalendarSelection {
  date: string
  timeline: PlanningTimeline | null
  projection: DayPlanProjection | null
}

export interface LifeCalendarOverlayProps {
  open: boolean
  status?: 'loading' | 'ready' | 'error'
  error?: string | null
  onRetry?: () => void
  monthLabel: string
  days: CalendarDaySummary[]
  today: string
  selectedDate: string
  selection: LifeCalendarSelection
  returnFocusRef?: RefObject<HTMLElement | null>
  onSelectDate: (date: string) => void
  onClose: () => void
  onOpenDay: (date: string) => void
  onCopyPlan: (sourceDate: string, targetDate: string) => void | Promise<void>
  onApplyTemplate: (date: string) => void
}

export function LifeCalendarOverlay(_props: LifeCalendarOverlayProps) {
  const {
    open, status = 'ready', error, onRetry, monthLabel, days, today, selectedDate, selection, returnFocusRef,
    onSelectDate, onClose, onOpenDay, onCopyPlan, onApplyTemplate,
  } = _props
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const copyInputRef = useRef<HTMLInputElement>(null)
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyTarget, setCopyTarget] = useState(() => shiftDate(selectedDate, 1))
  const [copyPending, setCopyPending] = useState(false)
  const [copyError, setCopyError] = useState('')
  const [focusedDate, setFocusedDate] = useState(selectedDate)

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    let settleFrame = 0
    const routeFrame = requestAnimationFrame(() => {
      settleFrame = requestAnimationFrame(() => {
        const active = document.activeElement
        if (active === document.body || active === closeRef.current || active?.id === 'life-calendar-title' || !dialogRef.current?.contains(active)) {
          closeRef.current?.focus({ preventScroll: true })
        }
      })
    })
    return () => {
      cancelAnimationFrame(routeFrame)
      cancelAnimationFrame(settleFrame)
      returnFocusRef?.current?.focus()
    }
  }, [open, returnFocusRef])

  useEffect(() => {
    setFocusedDate(selectedDate)
  }, [selectedDate])

  useEffect(() => {
    if (!copyOpen) return
    setCopyTarget(shiftDate(selectedDate, 1))
    setCopyError('')
    copyInputRef.current?.focus()
  }, [copyOpen, selectedDate])

  const copyPlan = async () => {
    if (copyPending) return
    setCopyPending(true)
    setCopyError('')
    try {
      await onCopyPlan(selectedDate, copyTarget)
      setCopyOpen(false)
    } catch {
      setCopyError('计划尚未提交。目标日期已保留，请联网并核对冲突后重试。')
    } finally {
      setCopyPending(false)
    }
  }

  if (!open) return null

  const monthDays = calendarGrid(selectedDate)
  const summaries = new Map(days.map((day) => [day.date, day]))
  const actualAvailable = selection.projection ? hasActualFacts(selection.projection) : false

  const trapFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (copyOpen) setCopyOpen(false)
      else onClose()
      return
    }
    if (event.key !== 'Tab' || copyOpen) return
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]), a[href], input:not([disabled])'))
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  }

  const moveCalendarFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const weekStart = index - (index % 7)
    const targetIndex = event.key === 'ArrowRight' ? index + 1
      : event.key === 'ArrowLeft' ? index - 1
        : event.key === 'ArrowDown' ? index + 7
          : event.key === 'ArrowUp' ? index - 7
            : event.key === 'Home' ? weekStart
              : event.key === 'End' ? weekStart + 6
                : null
    if (targetIndex === null) return
    event.preventDefault()
    event.stopPropagation()
    const boundedIndex = Math.max(0, Math.min(monthDays.length - 1, targetIndex))
    const targetDate = monthDays[boundedIndex]!
    setFocusedDate(targetDate)
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`button[data-calendar-date="${targetDate}"]`)?.focus()
  }

  return (
    <section ref={dialogRef} className="life-calendar-overlay" role="dialog" aria-modal="true" aria-labelledby="life-calendar-title" data-layout="month/summary" onKeyDown={trapFocus}>
      <button className="life-calendar-backdrop" type="button" tabIndex={-1} aria-hidden="true" onClick={onClose} />
      <button ref={closeRef} className="life-calendar-persistent-close" type="button" onClick={onClose} aria-label="关闭生活日历"><span aria-hidden="true">←</span><span>返回今日</span></button>
      <div className="life-calendar-panel">
        <header>
          <div><p>Calendar · persistent facts</p><h1 id="life-calendar-title" tabIndex={-1}>生活日历</h1></div>
        </header>

        {status === 'loading' ? <p className="life-calendar-data-state" role="status">正在加载日历与日期事实…</p> : null}
        {status === 'error' ? <div className="life-calendar-data-state is-error"><p role="alert">{error ?? '网络不可用，日历事实尚未加载。'}</p><button type="button" onClick={onRetry}>重试生活日历</button></div> : null}

        <div className="life-calendar-layout">
          <section className="life-calendar-month" aria-label={monthLabel}>
            <header><h2>{monthLabel}</h2><span>形状与文字共同标记状态</span></header>
            <div className="life-calendar-weekdays" aria-hidden="true">{['一', '二', '三', '四', '五', '六', '日'].map((label) => <span key={label}>{label}</span>)}</div>
            <div className="life-calendar-grid" role="grid" aria-label={`${monthLabel}日期`}>
              {Array.from({ length: 6 }, (_, weekIndex) => (
                <div className="life-calendar-grid__row" role="row" key={weekIndex}>
                  {monthDays.slice(weekIndex * 7, weekIndex * 7 + 7).map((date, dayIndex) => {
                    const summary = summaries.get(date)
                    const state = summary?.state ?? 'none'
                    const isToday = date === today
                    const selected = date === selectedDate
                    const currentMonth = date.slice(0, 7) === selectedDate.slice(0, 7)
                    const index = weekIndex * 7 + dayIndex
                    return <button role="gridcell" key={date} type="button" data-calendar-date={date} data-state={state} data-current-month={currentMonth} tabIndex={date === focusedDate ? 0 : -1} aria-selected={selected} aria-label={calendarDayLabel(date, summary, isToday, selected)} onFocus={() => setFocusedDate(date)} onKeyDown={(event) => moveCalendarFocus(event, index)} onClick={() => onSelectDate(date)}><time dateTime={date}>{Number(date.slice(8))}</time><span>{summary ? calendarStateLabel[summary.state] : '无计划'}</span></button>
                  })}
                </div>
              ))}
            </div>
            <ul className="life-calendar-legend" aria-label="日历状态图例">
              <li data-state="planned">有计划</li><li data-state="complete">全部完成</li><li data-state="past-incomplete">过去未完成</li><li data-state="conflicted">有冲突</li>
            </ul>
          </section>

          <section className="life-calendar-summary" aria-label={`${formatDate(selectedDate)}摘要`}>
            <header><p>Selected day</p><h2>{formatDate(selectedDate)}</h2></header>
            <div className="life-calendar-summary__count"><strong>{selection.timeline?.timelineItems.length ?? 0}</strong><span>条生活安排</span></div>
            {selection.timeline?.timelineItems.length ? <ol>{selection.timeline.timelineItems.map((item) => <li key={item.id}><time>{item.scheduledTime ?? '待安排'}</time><div><strong>{item.title}</strong><span>{item.kind === 'meal' ? '饮食' : item.kind === 'supplement' ? '补充剂' : item.kind === 'medicine' ? '用药事实' : item.kind === 'fitness' ? '健身' : '自定义'}</span></div></li>)}</ol> : <p className="life-calendar-summary__empty">这一天还没有生活计划。</p>}
            <dl>
              <div><dt>计划营养：</dt><dd>{selection.projection?.plannedNutrition ? `${selection.projection.plannedNutrition.energyKcal ?? '数据不完整'} kcal` : '数据不完整'}</dd></div>
              <div><dt>实际营养：</dt><dd>{actualAvailable ? `${selection.projection?.actualNutrition.energyKcal ?? '数据不完整'} kcal` : '数据不完整'}</dd></div>
              <div><dt>计划消耗成本：</dt><dd>{selection.projection?.plannedCostMinor === null || selection.projection?.plannedCostMinor === undefined ? '数据不完整' : money(selection.projection.plannedCostMinor)}</dd></div>
              <div><dt>实际消耗成本：</dt><dd>{selection.projection && actualAvailable ? money(selection.projection.actualCostMinor) : '数据不完整'}</dd></div>
            </dl>
            {selection.projection?.inventory.some((item) => item.status === 'incomplete' || item.shortage > 0) ? <p className="life-calendar-conflict">库存事实存在短缺或单位换算不完整，请在执行前处理。</p> : null}
            <div className="life-calendar-actions">
              <button type="button" onClick={() => onOpenDay(selectedDate)}>打开当天</button>
              <button type="button" onClick={() => setCopyOpen(true)}>复制计划</button>
              <button type="button" onClick={() => onApplyTemplate(selectedDate)}>应用模板</button>
            </div>
          </section>
        </div>

        {copyOpen ? <section className="life-copy-dialog" role="dialog" aria-modal="true" aria-labelledby="life-copy-title" aria-busy={copyPending} onKeyDown={(event) => { if (event.key === 'Escape' && !copyPending) { event.stopPropagation(); setCopyOpen(false) } }}>
          <h2 id="life-copy-title">复制 {formatDate(selectedDate)}的计划</h2>
          <p>只复制计划，不复制完成状态、实际记录、历史快照或库存事务。</p>
          <label>目标日期<input ref={copyInputRef} type="date" value={copyTarget} disabled={copyPending} onChange={(event) => setCopyTarget(event.target.value)} /></label>
          {copyPending ? <p role="status">正在提交复制计划…</p> : null}
          {copyError ? <p role="alert">{copyError}</p> : null}
          <div><button type="button" disabled={copyPending} onClick={() => setCopyOpen(false)}>取消</button><button type="button" disabled={copyPending} onClick={() => void copyPlan()}>确认复制计划</button></div>
        </section> : null}
      </div>
    </section>
  )
}

const calendarStateLabel = {
  planned: '有计划',
  complete: '全部完成',
  'past-incomplete': '过去未完成',
  conflicted: '有冲突',
} as const

function parseDate(date: string) {
  return new Date(`${date}T12:00:00`)
}

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function shiftDate(date: string, amount: number) {
  const value = parseDate(date)
  value.setDate(value.getDate() + amount)
  return dateKey(value)
}

function calendarGrid(selectedDate: string) {
  const first = parseDate(`${selectedDate.slice(0, 7)}-01`)
  const mondayOffset = first.getDay() === 0 ? 6 : first.getDay() - 1
  first.setDate(first.getDate() - mondayOffset)
  return Array.from({ length: 42 }, (_, index) => shiftDate(dateKey(first), index))
}

function formatDate(date: string) {
  const value = parseDate(date)
  return `${value.getFullYear()}年${value.getMonth() + 1}月${value.getDate()}日`
}

function calendarDayLabel(date: string, summary: CalendarDaySummary | undefined, today: boolean, selected: boolean) {
  const value = parseDate(date)
  const labels = [`${value.getMonth() + 1}月${value.getDate()}日`]
  if (today) labels.push('今天')
  if (selected) labels.push('已选中')
  labels.push(summary ? calendarStateLabel[summary.state] : '无计划')
  if (summary) labels.push(`${summary.itemCount}项，完成${summary.completedCount}项`)
  return labels.join(' ')
}

function hasActualFacts(projection: DayPlanProjection) {
  return Object.keys(projection.actualNutrition).length > 0
    || projection.actualCostMinor > 0
    || projection.items.some((item) => item.mode === 'actual' && item.status === 'complete')
}

function money(value: number) {
  return `¥${(value / 100).toFixed(2)}`
}
