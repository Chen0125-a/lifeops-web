import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { HttpError } from '../../api/httpClient'
import type { CreateTaskInput, ScheduleBlock, Task, UpdateTaskInput } from '../../domain/tasks'
import { moveScheduleBlock, resizeScheduleBlock, localWeekDates, scheduleDateKey, type ScheduleBlockChange } from './dragSchedule'
import { TaskEditor, type TaskEditorSubmission } from './TaskEditor'
import { TaskPool, type TaskPoolGroup } from './TaskPool'
import { useSchedule, type ScheduleUndoToken } from './useSchedule'
import { WeekCalendar } from './WeekCalendar'

type ScheduleView = 'day' | 'week' | 'month'

interface KeyboardPlan {
  task: Task
  date: string
  startMinutes: number
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function parseDateKey(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function shiftDate(value: string, deltaDays: number) {
  const date = parseDateKey(value)
  return dateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + deltaDays))
}

function localDateTime(date: string, minutes: number) {
  const bounded = Math.max(0, Math.min(24 * 60 - 1, minutes))
  return `${date}T${pad(Math.floor(bounded / 60))}:${pad(bounded % 60)}:00`
}

function planDuration(task: Task) {
  return Math.max(15, Math.ceil((task.estimateMinutes ?? 30) / 15) * 15)
}

function isDone(task: Task) {
  return task.status === 'done' || task.status === 'skipped' || task.status === 'cancelled'
}

function hasScheduledBlock(task: Task, blocks: ScheduleBlock[]) {
  return blocks.some((block) => block.taskId === task.id) || Boolean(task.startsAt && task.endsAt)
}

function filteredTasks(tasks: Task[], project: string, status: string) {
  return tasks.filter((task) => !task.deletedAt
    && (project === 'all' || task.projectId === project)
    && (status === 'all' || task.status === status))
}

function taskGroups(tasks: Task[], blocks: ScheduleBlock[], selectedDate: string, now: Date): TaskPoolGroup[] {
  const nowTime = now.getTime()
  const dueBoundary = nowTime + 3 * 86_400_000
  const today = tasks.filter((task) => blocks.some((block) => block.taskId === task.id && scheduleDateKey(block.startsAt) === selectedDate)
    || (task.startsAt ? scheduleDateKey(task.startsAt) === selectedDate : false))
  const due = tasks.filter((task) => !isDone(task) && task.dueAt && Date.parse(task.dueAt) >= nowTime && Date.parse(task.dueAt) <= dueBoundary)
  const unscheduled = tasks.filter((task) => !isDone(task) && !hasScheduledBlock(task, blocks))
  const overdue = tasks.filter((task) => !isDone(task) && task.dueAt && Date.parse(task.dueAt) < nowTime)
  return [
    { id: 'today', label: '今天', tasks: today },
    { id: 'due', label: '临期', tasks: due },
    { id: 'unscheduled', label: '未排期', tasks: unscheduled },
    { id: 'overdue', label: '已逾期', tasks: overdue },
  ]
}

function viewRange(view: ScheduleView, selectedDate: string) {
  if (view === 'day') return { from: `${selectedDate}T00:00:00`, to: `${shiftDate(selectedDate, 1)}T00:00:00` }
  if (view === 'month') {
    const date = parseDateKey(selectedDate)
    const first = dateKey(new Date(date.getFullYear(), date.getMonth(), 1))
    const next = dateKey(new Date(date.getFullYear(), date.getMonth() + 1, 1))
    return { from: `${first}T00:00:00`, to: `${next}T00:00:00` }
  }
  const week = localWeekDates(selectedDate)
  return { from: `${week[0]}T00:00:00`, to: `${shiftDate(week[6], 1)}T00:00:00` }
}

export function SchedulePage({ now = new Date() }: { now?: Date }) {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [compactDefault, setCompactDefault] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches === true)
  const fallbackDate = dateKey(now)
  const queryView = searchParams.get('view')
  const fallbackView: ScheduleView = compactDefault ? 'day' : 'week'
  const view: ScheduleView = queryView === 'day' || queryView === 'week' || queryView === 'month' ? queryView : fallbackView
  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('date') ?? '') ? searchParams.get('date')! : fallbackDate
  const projectFilter = searchParams.get('project') ?? 'all'
  const statusFilter = searchParams.get('status') ?? 'all'
  const range = useMemo(() => viewRange(view, selectedDate), [selectedDate, view])
  const schedule = useSchedule(range)
  const [keyboardPlan, setKeyboardPlan] = useState<KeyboardPlan | null>(null)
  const [editorTask, setEditorTask] = useState<Task | 'new' | null>(null)
  const [undo, setUndo] = useState<ScheduleUndoToken | null>(null)
  const [conflictPreview, setConflictPreview] = useState<ScheduleBlockChange | null>(null)
  const keyboardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 767px)')
    if (!query) return
    const update = () => setCompactDefault(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const browserPath = window.location.pathname
    const browserMirrorsAppRoutes = browserPath.startsWith('/app/')
    if (location.pathname !== '/app/schedule' || (browserMirrorsAppRoutes && browserPath !== '/app/schedule')) return
    if (searchParams.has('view') && searchParams.has('date')) return
    const next = new URLSearchParams(searchParams)
    if (!next.has('view')) next.set('view', fallbackView)
    if (!next.has('date')) next.set('date', fallbackDate)
    setSearchParams(next, { replace: true })
  }, [fallbackDate, fallbackView, location.pathname, searchParams, setSearchParams])

  useEffect(() => { if (keyboardPlan) keyboardRef.current?.focus() }, [keyboardPlan])

  const updateQuery = useCallback((updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(updates)) value === null || value === 'all' ? next.delete(key) : next.set(key, value)
    setSearchParams(next)
  }, [searchParams, setSearchParams])

  const visibleTasks = useMemo(() => filteredTasks(schedule.tasks, projectFilter, statusFilter), [projectFilter, schedule.tasks, statusFilter])
  const groups = useMemo(() => taskGroups(visibleTasks, schedule.blocks, selectedDate, now), [now, schedule.blocks, selectedDate, visibleTasks])
  const projects = useMemo(() => [...new Set(schedule.tasks.map((task) => task.projectId).filter((id): id is string => Boolean(id)))].sort(), [schedule.tasks])
  const selectedBlocks = schedule.blocks.filter((block) => scheduleDateKey(block.startsAt) === selectedDate)
  const selectedMinutes = selectedBlocks.reduce((total, block) => total + Math.max(0, (Date.parse(block.endsAt) - Date.parse(block.startsAt)) / 60_000), 0)

  const commitChange = useCallback(async (change: ScheduleBlockChange) => {
    try {
      const token = await schedule.scheduleTask(change.block.taskId, change.block.startsAt, change.block.endsAt, change.block.version)
      setUndo(token)
      setConflictPreview(null)
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) setConflictPreview(change)
    }
  }, [schedule])

  const openKeyboardPlan = useCallback((task: Task) => {
    setKeyboardPlan({ task, date: selectedDate, startMinutes: 9 * 60 })
  }, [selectedDate])

  const keyboardMove = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!keyboardPlan) return
    if (event.key === 'Escape') { event.preventDefault(); setKeyboardPlan(null); return }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      setKeyboardPlan({ ...keyboardPlan, date: shiftDate(keyboardPlan.date, event.key === 'ArrowRight' ? 1 : -1) })
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const delta = event.key === 'ArrowDown' ? 15 : -15
      const latestStart = 24 * 60 - planDuration(keyboardPlan.task)
      setKeyboardPlan({ ...keyboardPlan, startMinutes: Math.max(0, Math.min(latestStart, keyboardPlan.startMinutes + delta)) })
    }
    if (event.key === 'Enter') { event.preventDefault(); void confirmKeyboardPlan() }
  }

  const confirmKeyboardPlan = async () => {
    if (!keyboardPlan) return
    const duration = planDuration(keyboardPlan.task)
    try {
      const token = await schedule.scheduleTask(
        keyboardPlan.task.id,
        localDateTime(keyboardPlan.date, keyboardPlan.startMinutes),
        localDateTime(keyboardPlan.date, keyboardPlan.startMinutes + duration),
        keyboardPlan.task.version,
      )
      setUndo(token)
      setKeyboardPlan(null)
    } catch {
      // The hook exposes the scoped 409/network state; retain this exact keyboard preview.
    }
  }

  const undoCurrent = async () => {
    if (!undo) return
    try {
      await schedule.undoSchedule(undo)
      setUndo(null)
    } catch {
      // Retain the undo token so a transient failure can be retried.
    }
  }

  const saveTask = async ({ input, checklist }: TaskEditorSubmission) => {
    if (editorTask && editorTask !== 'new') await schedule.updateTask(editorTask.id, input as UpdateTaskInput, checklist)
    else await schedule.createTask(input as CreateTaskInput, checklist)
  }

  const pageError = schedule.status === 'forbidden'
    ? '你没有查看或修改日程的权限。'
    : schedule.status === 'conflict'
      ? '日程已经在另一处更新。预览仍保留，请恢复原时间或选择新时间。'
      : schedule.status === 'disconnected'
        ? '当前设备离线。读取内容仍保留，联网后再提交排期。'
        : schedule.status === 'network-error'
          ? '任务与日程暂时无法加载。'
          : null

  return (
    <article className="schedule-page" data-schedule-page data-view={view}>
      <header className="schedule-page__heading">
        <div><h1 tabIndex={-1}>日程</h1><p>把时间留给真正要推进的事。拖动只是捷径，所有安排都有等价的键盘与表单路径。</p></div>
        <button type="button" onClick={() => setEditorTask('new')}>新建任务</button>
      </header>

      <section className="schedule-toolbar" aria-label="日程视图与筛选">
        <div className="schedule-toolbar__views" role="group" aria-label="日程视图">
          {(['day', 'week', 'month'] as const).map((item) => <button key={item} type="button" aria-label={`${item === 'day' ? '日' : item === 'week' ? '周' : '月'}视图`} aria-pressed={view === item} onClick={() => updateQuery({ view: item })}>{item === 'day' ? '日' : item === 'week' ? '周' : '月'}</button>)}
          <button type="button" aria-label="回到今天" onClick={() => updateQuery({ date: fallbackDate })}>今天</button>
        </div>
        <div className="schedule-toolbar__date"><button type="button" aria-label="上一天" onClick={() => updateQuery({ date: shiftDate(selectedDate, view === 'week' ? -7 : -1) })}>←</button><time dateTime={selectedDate}>{parseDateKey(selectedDate).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}</time><button type="button" aria-label="下一天" onClick={() => updateQuery({ date: shiftDate(selectedDate, view === 'week' ? 7 : 1) })}>→</button></div>
        <label><span>项目筛选</span><select aria-label="项目筛选" value={projectFilter} onChange={(event) => updateQuery({ project: event.target.value })}><option value="all">全部项目</option>{projects.map((project) => <option key={project} value={project}>{project}</option>)}</select></label>
        <label><span>状态筛选</span><select aria-label="状态筛选" value={statusFilter} onChange={(event) => updateQuery({ status: event.target.value })}><option value="all">全部状态</option><option value="inbox">收件箱</option><option value="planned">已计划</option><option value="doing">进行中</option><option value="done">已完成</option></select></label>
      </section>

      {pageError ? <div className="schedule-page__error" role="alert"><p>{pageError}</p><button type="button" onClick={schedule.retry}>重新加载</button></div> : null}
      {schedule.status === 'loading' ? <div className="schedule-page__state" role="status"><span />正在核对任务与时间边界…</div> : null}
      {schedule.status === 'empty' ? <section className="schedule-page__empty"><span>没有样例任务</span><h2>还没有可安排的任务</h2><p>先写下一个行动，也可以从目标拆解，或建立你确实需要的重复项。</p><div><button type="button" onClick={() => setEditorTask('new')}>创建任务</button><Link to="/app/goals">从目标拆解</Link><button type="button" onClick={() => setEditorTask('new')}>创建重复项</button></div></section> : null}

      {schedule.tasks.length ? <>
        <div className="schedule-signals" aria-live="polite">
          <span data-warning={selectedMinutes > 480}>{selectedMinutes > 480 ? `今日安排超过 8 小时（${Math.round(selectedMinutes / 60 * 10) / 10} 小时）` : `今日已安排 ${Math.round(selectedMinutes / 60 * 10) / 10} 小时`}</span>
          <span data-warning={schedule.conflicts.length > 0}>{schedule.conflicts.length ? `${schedule.conflicts.length} 组时间冲突` : '当前没有时间冲突'}</span>
        </div>
        <div className="schedule-workspace" data-layout="8/4">
          <section className="schedule-canvas" aria-label="日程画布">
            <WeekCalendar
              view={view}
              selectedDate={selectedDate}
              todayDate={fallbackDate}
              tasks={visibleTasks}
              blocks={schedule.blocks}
              conflicts={schedule.conflicts}
              onMove={(block, delta) => commitChange(moveScheduleBlock(block, delta))}
              onResize={(block, edge, delta) => commitChange(resizeScheduleBlock(block, edge, delta))}
            />
          </section>
          <TaskPool groups={groups} onPick={openKeyboardPlan} onEdit={setEditorTask} />
        </div>
      </> : null}

      {keyboardPlan ? <div className="keyboard-planner" ref={keyboardRef} role="group" aria-label="键盘排期" tabIndex={-1} onKeyDown={keyboardMove}>
        <header><span>键盘排期</span><button type="button" onClick={() => setKeyboardPlan(null)}>取消</button></header>
        <strong>{keyboardPlan.task.title}</strong>
        <p><time dateTime={keyboardPlan.date}>{keyboardPlan.date}</time><span>{pad(Math.floor(keyboardPlan.startMinutes / 60))}:{pad(keyboardPlan.startMinutes % 60)}</span></p>
        <small>左右键换日期，上下键按 15 分钟移动；Enter 也可确认，Esc 取消。</small>
        <button className="is-primary" type="button" onClick={() => void confirmKeyboardPlan()}>确认排期</button>
      </div> : null}

      {conflictPreview ? <div className="schedule-conflict" role="alert"><p>服务器发现版本冲突，预览没有丢失。</p><button type="button" onClick={() => setConflictPreview(null)}>恢复原时间</button><button type="button" onClick={() => {
        const task = schedule.tasks.find((item) => item.id === conflictPreview.block.taskId)
        const moment = new Date(conflictPreview.block.startsAt)
        if (task) setKeyboardPlan({ task, date: scheduleDateKey(conflictPreview.block.startsAt), startMinutes: moment.getHours() * 60 + moment.getMinutes() })
      }}>选择新时间</button></div> : null}
      {undo ? <div className="schedule-undo" role="status"><span>排期已保存</span><button type="button" onClick={() => void undoCurrent()}>撤销排期</button></div> : null}
      {editorTask ? <TaskEditor task={editorTask === 'new' ? undefined : editorTask} saving={schedule.isSaving} onClose={() => setEditorTask(null)} onSave={saveTask} /> : null}
    </article>
  )
}
