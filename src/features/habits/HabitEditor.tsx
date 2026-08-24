import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { CreateHabitInput, Habit, HabitMeasure, HabitSchedule, UpdateHabitInput } from '../../domain/habits'

interface HabitEditorProps {
  habit?: Habit
  onClose(): void
  onSave(input: CreateHabitInput | UpdateHabitInput): Promise<void>
}

export function HabitEditor({ habit, onClose, onSave }: HabitEditorProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const firstFieldRef = useRef<HTMLInputElement>(null)
  const [scheduleType, setScheduleType] = useState<HabitSchedule['scheduleType']>(habit?.schedule.scheduleType ?? 'daily')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    firstFieldRef.current?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])') ?? [])
      const first = focusable[0]
      const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', keydown)
    return () => { window.removeEventListener('keydown', keydown); previousFocus?.focus() }
  }, [onClose, saving])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const text = (name: string) => String(data.get(name) ?? '').trim()
    const number = (name: string) => text(name) ? Number(text(name)) : null
    const schedule: HabitSchedule = {
      scheduleType,
      startsOn: text('startsOn'),
      endsOn: text('endsOn') || null,
      ...(scheduleType === 'weekdays' ? { weekdays: data.getAll('weekdays').map(Number) } : {}),
      ...(scheduleType === 'times-per-week' ? { timesPerWeek: Number(text('timesPerWeek')) } : {}),
      ...(scheduleType === 'interval' ? { intervalDays: Number(text('intervalDays')) } : {}),
    }
    const input: CreateHabitInput | UpdateHabitInput = {
      title: text('title'),
      description: text('description'),
      goalId: text('goalId') || null,
      projectId: text('projectId') || null,
      measure: text('measure') as HabitMeasure,
      unit: text('unit') || null,
      targetValue: number('targetValue'),
      timezone: text('timezone'),
      schedule,
      ...(habit ? { version: habit.version } : {}),
    }
    setSaving(true)
    setError('')
    try {
      await onSave(input)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试。')
    } finally {
      setSaving(false)
    }
  }

  const title = habit ? '编辑习惯' : '新建习惯'
  return (
    <div className="habit-editor-layer">
      <button className="habit-editor-layer__backdrop" type="button" tabIndex={-1} aria-label={`关闭${title}`} onClick={onClose} />
      <section ref={dialogRef} className="habit-editor" role="dialog" aria-modal="true" aria-label={title}>
        <header><div><span>节奏定义</span><h2>{title}</h2></div><button type="button" onClick={onClose} aria-label={`关闭${title}`}>关闭</button></header>
        <form onSubmit={submit}>
          <div className="habit-editor__fields">
            <label><span>标题</span><input ref={firstFieldRef} name="title" required maxLength={240} defaultValue={habit?.title ?? ''} /></label>
            <label className="is-wide"><span>描述</span><textarea name="description" maxLength={20_000} defaultValue={habit?.description ?? ''} /></label>
            <label><span>目标</span><input name="goalId" maxLength={80} defaultValue={habit?.goalId ?? ''} /></label>
            <label><span>项目</span><input name="projectId" maxLength={80} defaultValue={habit?.projectId ?? ''} /></label>
            <label><span>计量方式</span><select name="measure" defaultValue={habit?.measure ?? 'boolean'}><option value="boolean">是 / 否</option><option value="count">次数</option><option value="duration">时长</option><option value="quantity">数量</option></select></label>
            <label><span>目标值</span><input name="targetValue" type="number" min="0" step="any" defaultValue={habit?.targetValue ?? 1} /></label>
            <label><span>单位</span><input name="unit" maxLength={40} defaultValue={habit?.unit ?? ''} /></label>
            <label><span>时区</span><input name="timezone" required maxLength={64} defaultValue={habit?.timezone ?? 'Asia/Shanghai'} /></label>
            <label><span>排程方式</span><select name="scheduleType" value={scheduleType} onChange={(event) => setScheduleType(event.target.value as HabitSchedule['scheduleType'])}><option value="daily">每天</option><option value="weekdays">指定星期</option><option value="times-per-week">每周次数</option><option value="interval">按间隔天数</option></select></label>
            <label><span>开始日期</span><input name="startsOn" type="date" required defaultValue={habit?.schedule.startsOn ?? new Date().toISOString().slice(0, 10)} /></label>
            <label><span>结束日期</span><input name="endsOn" type="date" defaultValue={habit?.schedule.endsOn ?? ''} /></label>
            {scheduleType === 'times-per-week' ? <label><span>每周次数</span><input name="timesPerWeek" type="number" min="1" max="7" defaultValue={habit?.schedule.timesPerWeek ?? 3} /></label> : null}
            {scheduleType === 'interval' ? <label><span>间隔天数</span><input name="intervalDays" type="number" min="1" defaultValue={habit?.schedule.intervalDays ?? 2} /></label> : null}
            {scheduleType === 'weekdays' ? <fieldset className="habit-editor__weekdays"><legend>每周日期</legend>{['一', '二', '三', '四', '五', '六', '日'].map((day, index) => <label key={day}><input type="checkbox" name="weekdays" value={index + 1} defaultChecked={habit?.schedule.weekdays?.includes(index + 1) ?? index < 5} /><span>周{day}</span></label>)}</fieldset> : null}
          </div>
          {error ? <p className="habit-editor__error" role="alert">{error}</p> : null}
          <footer><button type="button" disabled={saving} onClick={onClose}>取消</button><button type="submit" className="is-primary" disabled={saving}>{saving ? '正在保存…' : '保存习惯'}</button></footer>
        </form>
      </section>
    </div>
  )
}

