import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { ScheduleBlock, ScheduleConflict, Task } from '../../domain/tasks'
import { localWeekDates, minutesToGridPosition, scheduleDateKey } from './dragSchedule'

interface WeekCalendarProps {
  view: 'day' | 'week' | 'month'
  selectedDate: string
  todayDate?: string
  tasks: Task[]
  blocks: ScheduleBlock[]
  conflicts: ScheduleConflict[]
  onMove(block: ScheduleBlock, deltaMinutes: number): void | Promise<void>
  onResize(block: ScheduleBlock, edge: 'start' | 'end', deltaMinutes: number): void | Promise<void>
}

interface PreviewState {
  blockId: string
  originY: number
  deltaY: number
  mode: 'move' | 'resize-start' | 'resize-end'
}

const scale = { dayStartMinutes: 480, hourHeight: 64, snapMinutes: 15 }
const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function parseDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function shortDate(value: string) {
  const date = parseDate(value)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function time(value: string) {
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function minutes(value: string) {
  const date = new Date(value)
  return date.getHours() * 60 + date.getMinutes()
}

function blockConflict(block: ScheduleBlock, conflicts: ScheduleConflict[]) {
  return conflicts.some((conflict) => conflict.leftId === block.id || conflict.rightId === block.id)
}

function viewDates(view: WeekCalendarProps['view'], selectedDate: string) {
  return view === 'week' ? localWeekDates(selectedDate) : [selectedDate]
}

export function WeekCalendar({ view, selectedDate, todayDate = selectedDate, tasks, blocks, conflicts, onMove, onResize }: WeekCalendarProps) {
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const dates = viewDates(view, selectedDate)
  const week = localWeekDates(selectedDate)
  const selected = parseDate(selectedDate)
  const weekLabel = `${selected.getFullYear()}年${parseDate(week[0]).getMonth() + 1}月${parseDate(week[0]).getDate()}日至${parseDate(week[6]).getDate()}日周历`

  if (view === 'month') {
    const monthBlocks = blocks.filter((block) => scheduleDateKey(block.startsAt).slice(0, 7) === selectedDate.slice(0, 7))
    return (
      <section className="schedule-agenda" aria-label={`${selected.getFullYear()}年${selected.getMonth() + 1}月议程`}>
        <header><span>月议程</span><strong>{monthBlocks.length} 项安排</strong></header>
        {monthBlocks.length ? <ol>{monthBlocks.map((block) => <li key={block.id}><time>{shortDate(scheduleDateKey(block.startsAt))} {time(block.startsAt)}</time><span>{taskById.get(block.taskId)?.title ?? '已删除任务'}</span></li>)}</ol> : <p>这个月还没有安排。</p>}
      </section>
    )
  }

  const pointerDown = (event: ReactPointerEvent<HTMLElement>, block: ScheduleBlock, mode: PreviewState['mode']) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setPreview({ blockId: block.id, originY: event.clientY, deltaY: 0, mode })
  }
  const pointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!preview) return
    setPreview((current) => current ? { ...current, deltaY: event.clientY - current.originY } : null)
  }
  const pointerUp = (event: ReactPointerEvent<HTMLElement>, block: ScheduleBlock) => {
    if (!preview || preview.blockId !== block.id) return
    const deltaMinutes = (preview.deltaY / scale.hourHeight) * 60
    if (Math.abs(deltaMinutes) >= 7.5) {
      if (preview.mode === 'move') void onMove(block, deltaMinutes)
      if (preview.mode === 'resize-start') void onResize(block, 'start', deltaMinutes)
      if (preview.mode === 'resize-end') void onResize(block, 'end', deltaMinutes)
    }
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setPreview(null)
  }

  return (
    <div className="week-calendar" role="grid" aria-label={view === 'week' ? weekLabel : `${shortDate(selectedDate)}日历`} aria-colcount={dates.length}>
      <div className="week-calendar__headers" role="row">
        {dates.map((date) => {
          const value = parseDate(date)
          const isToday = date === todayDate
          const isSelected = date === selectedDate
          return <div role="columnheader" key={date} data-selected={isSelected} aria-label={`${shortDate(date)} ${weekdays[value.getDay()]}${isToday ? ' 今天' : ''}`}><span>{weekdays[value.getDay()]}</span><strong>{value.getDate()}</strong>{isToday ? <small>今天</small> : null}</div>
        })}
      </div>
      <div className="week-calendar__body" role="row" tabIndex={0} aria-label="可滚动的日程时间表">
        <div className="week-calendar__hours" aria-hidden="true">{Array.from({ length: 13 }, (_, index) => <span key={index}>{String(index + 8).padStart(2, '0')}:00</span>)}</div>
        {dates.map((date) => <div className="week-calendar__day" role="gridcell" data-selected={date === selectedDate} aria-label={shortDate(date)} key={date}>
          {blocks.filter((block) => scheduleDateKey(block.startsAt) === date).map((block) => {
            const task = taskById.get(block.taskId)
            const conflict = blockConflict(block, conflicts)
            const activePreview = preview?.blockId === block.id ? preview : null
            const top = minutesToGridPosition(minutes(block.startsAt), scale)
            const height = Math.max(16, minutesToGridPosition(minutes(block.endsAt), scale) - top)
            const style = {
              '--schedule-top': `${top}px`,
              '--schedule-height': `${height}px`,
              transform: activePreview ? `translateY(${activePreview.deltaY}px)` : undefined,
            } as CSSProperties
            return <div className="schedule-block" data-conflict={conflict} key={block.id} style={style}>
              <button
                type="button"
                aria-label={`${task?.title ?? '已删除任务'} ${time(block.startsAt)} 至 ${time(block.endsAt)} ${conflict ? '存在冲突' : '无冲突'}`}
                onPointerDown={(event) => pointerDown(event, block, 'move')}
                onPointerMove={pointerMove}
                onPointerUp={(event) => pointerUp(event, block)}
              ><strong>{task?.title ?? '已删除任务'}</strong><span>{time(block.startsAt)}–{time(block.endsAt)}</span></button>
              <button className="schedule-block__resize is-start" type="button" aria-label={`向前调整 ${task?.title ?? '任务'} 的开始时间`} onPointerDown={(event) => pointerDown(event, block, 'resize-start')} onPointerMove={pointerMove} onPointerUp={(event) => pointerUp(event, block)} />
              <button className="schedule-block__resize is-end" type="button" aria-label={`调整 ${task?.title ?? '任务'} 的结束时间`} onPointerDown={(event) => pointerDown(event, block, 'resize-end')} onPointerMove={pointerMove} onPointerUp={(event) => pointerUp(event, block)} />
            </div>
          })}
        </div>)}
      </div>
      {preview ? <span className="sr-only" role="status">正在预览日程位置，松开后提交一次更改</span> : null}
    </div>
  )
}
