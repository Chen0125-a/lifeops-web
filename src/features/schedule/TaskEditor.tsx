import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { CreateTaskInput, RecurrenceRule, Task, TaskStatus, UpdateTaskInput } from '../../domain/tasks'

export interface TaskEditorSubmission {
  input: CreateTaskInput | UpdateTaskInput
  checklist: string[]
}

interface TaskEditorProps {
  task?: Task
  saving?: boolean
  onClose(): void
  onSave(submission: TaskEditorSubmission): Promise<void>
}

const statuses: Array<{ value: TaskStatus; label: string }> = [
  { value: 'inbox', label: '收件箱' },
  { value: 'planned', label: '已计划' },
  { value: 'doing', label: '进行中' },
  { value: 'done', label: '已完成' },
  { value: 'skipped', label: '已跳过' },
  { value: 'cancelled', label: '已取消' },
]

function localInput(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function nullable(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()
  return text || null
}

function optionalInstant(value: FormDataEntryValue | null) {
  const text = nullable(value)
  return text ? `${text}:00` : null
}

function positiveInteger(value: FormDataEntryValue | null) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

export function TaskEditor({ task, saving = false, onClose, onSave }: TaskEditorProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const [frequency, setFrequency] = useState<RecurrenceRule['frequency'] | 'none'>(task?.recurrence?.frequency ?? 'none')
  const [error, setError] = useState<{ field?: string; message: string } | null>(null)

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    return () => previous?.focus()
  }, [])

  const trapFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
    if (event.key !== 'Tab') return
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)')]
    const first = controls[0]
    const last = controls.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const title = String(form.get('title') ?? '').trim()
    const startsAt = optionalInstant(form.get('startsAt'))
    const endsAt = optionalInstant(form.get('endsAt'))
    if (!title) { setError({ field: 'title', message: '请输入任务标题' }); return }
    if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
      setError({ field: 'endsAt', message: '结束时间必须晚于开始时间' }); return
    }

    let recurrence: RecurrenceRule | null = null
    if (frequency !== 'none') {
      const interval = positiveInteger(form.get('recurrenceInterval'))
      if (!interval) { setError({ field: 'recurrenceInterval', message: '重复间隔至少为 1' }); return }
      const weekdays = form.getAll('weekdays').map(Number)
      const monthDay = positiveInteger(form.get('monthDay'))
      if (frequency === 'weekly' && weekdays.length === 0) {
        setError({ field: 'weekdays', message: '每周重复至少选择一天' }); return
      }
      if (frequency === 'monthly' && (!monthDay || monthDay > 31)) {
        setError({ field: 'monthDay', message: '每月日期必须在 1–31 之间' }); return
      }
      recurrence = {
        frequency,
        interval,
        ...(frequency === 'weekly' ? { weekdays } : {}),
        ...(frequency === 'monthly' ? { monthDay: monthDay! } : {}),
        until: nullable(form.get('until')),
      }
    }

    const estimateMinutes = positiveInteger(form.get('estimateMinutes'))
    const input: CreateTaskInput | UpdateTaskInput = {
      title,
      description: String(form.get('description') ?? '').trim(),
      projectId: nullable(form.get('projectId')),
      startsAt,
      endsAt,
      dueAt: optionalInstant(form.get('dueAt')),
      estimateMinutes,
      priority: Number(form.get('priority')) as 1 | 2 | 3,
      status: String(form.get('status')) as TaskStatus,
      tags: String(form.get('tags') ?? '').split(',').map((tag) => tag.trim()).filter(Boolean),
      recurrence,
      ...(task ? { version: task.version } : {}),
    }
    const checklist = String(form.get('checklist') ?? '').split('\n').map((item) => item.trim()).filter(Boolean)
    setError(null)
    try {
      await onSave({ input, checklist })
      onClose()
    } catch {
      setError({ message: '任务没有保存。页面内容仍在，请检查提示后重试。' })
    }
  }

  return (
    <div className="task-editor-layer" onKeyDown={trapFocus}>
      <button className="task-editor-layer__backdrop" type="button" tabIndex={-1} aria-label="关闭任务编辑器" onClick={onClose} />
      <section className="task-editor" role="dialog" aria-modal="true" aria-labelledby="task-editor-title">
        <header><div><span>{task ? '编辑任务' : '创建任务'}</span><h2 id="task-editor-title">{task?.title ?? '把行动放进时间里'}</h2></div><button ref={closeRef} type="button" onClick={onClose}>关闭</button></header>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <div className="task-editor__fields">
            <label className="is-wide"><span>标题</span><input name="title" defaultValue={task?.title ?? ''} maxLength={240} aria-invalid={error?.field === 'title'} />{error?.field === 'title' ? <small role="alert">{error.message}</small> : null}</label>
            <label className="is-wide"><span>说明</span><textarea name="description" defaultValue={task?.description ?? ''} maxLength={20_000} /></label>
            <label><span>项目 ID</span><input name="projectId" defaultValue={task?.projectId ?? ''} maxLength={80} placeholder="可留空" /></label>
            <label><span>状态</span><select name="status" defaultValue={task?.status ?? 'inbox'}>{statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label>
            <label><span>开始时间</span><input name="startsAt" type="datetime-local" defaultValue={localInput(task?.startsAt ?? null)} /></label>
            <label><span>结束时间</span><input name="endsAt" type="datetime-local" defaultValue={localInput(task?.endsAt ?? null)} aria-invalid={error?.field === 'endsAt'} />{error?.field === 'endsAt' ? <small role="alert">{error.message}</small> : null}</label>
            <label><span>截止时间</span><input name="dueAt" type="datetime-local" defaultValue={localInput(task?.dueAt ?? null)} /></label>
            <label><span>预计时长（分钟）</span><input name="estimateMinutes" type="number" min={1} max={525600} defaultValue={task?.estimateMinutes ?? ''} /></label>
            <label><span>优先级</span><select name="priority" defaultValue={task?.priority ?? 2}><option value="1">高</option><option value="2">中</option><option value="3">低</option></select></label>
            <label><span>标签（逗号分隔）</span><input name="tags" defaultValue={task?.tags.join(', ') ?? ''} /></label>
            <label className="is-wide"><span>清单（每行一项）</span><textarea name="checklist" defaultValue={task?.checklist.map((item) => item.title).join('\n') ?? ''} /></label>
            <label><span>重复规则</span><select name="recurrenceFrequency" value={frequency} onChange={(event) => setFrequency(event.target.value as typeof frequency)}><option value="none">不重复</option><option value="daily">每天</option><option value="weekly">每周</option><option value="monthly">每月</option></select></label>
            {frequency !== 'none' ? <label><span>每隔</span><input name="recurrenceInterval" type="number" min={1} defaultValue={task?.recurrence?.interval ?? 1} aria-invalid={error?.field === 'recurrenceInterval'} />{error?.field === 'recurrenceInterval' ? <small role="alert">{error.message}</small> : null}</label> : null}
            {frequency === 'weekly' ? <fieldset className="task-editor__weekdays"><legend>重复星期</legend>{['一', '二', '三', '四', '五', '六', '日'].map((day, index) => <label key={day}><input type="checkbox" name="weekdays" value={index + 1} defaultChecked={task?.recurrence?.weekdays?.includes(index + 1)} />周{day}</label>)}{error?.field === 'weekdays' ? <small role="alert">{error.message}</small> : null}</fieldset> : null}
            {frequency === 'monthly' ? <label><span>每月日期</span><input name="monthDay" type="number" min={1} max={31} defaultValue={task?.recurrence?.monthDay ?? 1} aria-invalid={error?.field === 'monthDay'} />{error?.field === 'monthDay' ? <small role="alert">{error.message}</small> : null}</label> : null}
            {frequency !== 'none' ? <label><span>重复至</span><input name="until" type="date" defaultValue={task?.recurrence?.until ?? ''} /></label> : null}
          </div>
          {error && !error.field ? <p className="task-editor__error" role="alert">{error.message}</p> : null}
          <footer><button type="button" onClick={onClose}>取消</button><button className="is-primary" type="submit" disabled={saving}>{saving ? '正在保存…' : '保存任务'}</button></footer>
        </form>
      </section>
    </div>
  )
}
