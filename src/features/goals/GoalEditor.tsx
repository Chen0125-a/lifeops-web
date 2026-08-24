import { useEffect, useRef, useState, type FormEvent } from 'react'
import type {
  CreateGoalInput,
  CreateMilestoneInput,
  CreateProjectInput,
  Goal,
  Milestone,
  Project,
  UpdateGoalInput,
  UpdateMilestoneInput,
  UpdateProjectInput,
} from '../../domain/goals'

export type GoalEditorSubmission =
  | { kind: 'goal'; input: CreateGoalInput | UpdateGoalInput }
  | { kind: 'project'; goalId: string; input: CreateProjectInput | UpdateProjectInput }
  | { kind: 'milestone'; projectId: string; input: CreateMilestoneInput | UpdateMilestoneInput }

interface GoalEditorProps {
  kind: 'goal' | 'project' | 'milestone'
  value?: Goal | Project | Milestone
  goals: Goal[]
  projects: Project[]
  parentId?: string
  onClose(): void
  onSave(submission: GoalEditorSubmission): Promise<void>
}

const kindLabel = { goal: '目标', project: '项目', milestone: '里程碑' } as const

function asGoal(value: GoalEditorProps['value']) {
  return value && 'priority' in value ? value : undefined
}

function asProject(value: GoalEditorProps['value']) {
  return value && 'riskNote' in value ? value : undefined
}

function asMilestone(value: GoalEditorProps['value']) {
  return value && 'projectId' in value && !('riskNote' in value) ? value : undefined
}

export function GoalEditor({ kind, value, goals, projects, parentId, onClose, onSave }: GoalEditorProps) {
  const goal = asGoal(value)
  const project = asProject(value)
  const milestone = asMilestone(value)
  const editorRef = useRef<HTMLElement>(null)
  const firstField = useRef<HTMLInputElement>(null)
  const savingRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    firstField.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingRef.current) {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(editorRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [])
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus()
    }
  }, [onClose])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    savingRef.current = true
    setSaving(true)
    setError('')
    const data = new FormData(event.currentTarget)
    const text = (name: string) => String(data.get(name) ?? '').trim()
    const nullable = (name: string) => text(name) || null
    try {
      if (kind === 'goal') {
        const input: CreateGoalInput | UpdateGoalInput = {
          title: text('title'),
          description: text('description'),
          priority: Number(text('priority')) as 1 | 2 | 3,
          startsOn: nullable('startsOn'),
          targetOn: nullable('targetOn'),
          progressMode: text('progressMode') as Goal['progressMode'],
          manualProgress: Number(text('manualProgress') || 0),
          ...(goal ? { status: text('status') as Goal['status'], version: goal.version } : {}),
        }
        await onSave({ kind, input })
      }
      if (kind === 'project') {
        const goalId = text('goalId')
        const input: CreateProjectInput | UpdateProjectInput = {
          title: text('title'),
          description: text('description'),
          riskNote: text('riskNote'),
          status: text('status') as Project['status'],
          startsOn: nullable('startsOn'),
          targetOn: nullable('targetOn'),
          progress: Number(text('progress') || 0),
          nextTaskId: nullable('nextTaskId'),
          ...(project ? { version: project.version } : {}),
        }
        await onSave({ kind, goalId, input })
      }
      if (kind === 'milestone') {
        const projectId = text('projectId')
        const input: CreateMilestoneInput | UpdateMilestoneInput = {
          title: text('title'),
          dueOn: nullable('dueOn'),
          position: Number(text('position') || 0),
          ...(milestone ? { version: milestone.version } : {}),
        }
        await onSave({ kind, projectId, input })
      }
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试。')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const title = `${value ? '编辑' : '新建'}${kindLabel[kind]}`
  return (
    <div className="goal-editor-layer">
      <button className="goal-editor-layer__backdrop" type="button" onClick={onClose} tabIndex={-1} aria-label={`关闭${title}`} />
      <section ref={editorRef} className="goal-editor" role="dialog" aria-modal="true" aria-label={title}>
        <header><div><span>{kindLabel[kind]}</span><h2>{title}</h2></div><button type="button" onClick={onClose} aria-label={`关闭${title}`}>关闭</button></header>
        <form onSubmit={submit}>
          <div className="goal-editor__fields">
            <label><span>标题</span><input ref={firstField} name="title" required maxLength={240} defaultValue={value?.title ?? ''} /></label>

            {kind !== 'milestone' ? <label className="is-wide"><span>描述</span><textarea name="description" maxLength={20_000} defaultValue={goal?.description ?? project?.description ?? ''} /></label> : null}

            {kind === 'goal' ? <>
              <label><span>优先级</span><select name="priority" defaultValue={goal?.priority ?? 2}><option value="1">1 · 最高</option><option value="2">2 · 重要</option><option value="3">3 · 常规</option></select></label>
              <label><span>开始日期</span><input name="startsOn" type="date" defaultValue={goal?.startsOn ?? ''} /></label>
              <label><span>目标日期</span><input name="targetOn" type="date" defaultValue={goal?.targetOn ?? ''} /></label>
              <label><span>状态</span><select name="status" defaultValue={goal?.status ?? 'active'} disabled={!goal}><option value="active">进行中</option><option value="paused">已暂停</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select>{!goal ? <small>新目标创建后为进行中，可在保存后编辑状态。</small> : null}</label>
              <label><span>进度方式</span><select name="progressMode" defaultValue={goal?.progressMode ?? 'manual'}><option value="manual">手动进度</option><option value="task-ratio">按任务完成率</option><option value="milestone-ratio">按里程碑完成率</option></select></label>
              <label><span>手动进度</span><input name="manualProgress" type="number" min="0" max="100" step="1" defaultValue={goal?.manualProgress ?? 0} /></label>
            </> : null}

            {kind === 'project' ? <>
              <label><span>目标</span><select name="goalId" defaultValue={project?.goalId ?? parentId ?? goals[0]?.id} disabled={Boolean(project)}>{goals.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>{project ? <input type="hidden" name="goalId" value={project.goalId ?? ''} /> : null}</label>
              <label><span>开始日期</span><input name="startsOn" type="date" defaultValue={project?.startsOn ?? ''} /></label>
              <label><span>目标日期</span><input name="targetOn" type="date" defaultValue={project?.targetOn ?? ''} /></label>
              <label><span>状态</span><select name="status" defaultValue={project?.status ?? 'active'}><option value="active">进行中</option><option value="paused">已暂停</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select></label>
              <label><span>进度</span><input name="progress" type="number" min="0" max="100" step="1" defaultValue={project?.progress ?? 0} /></label>
              <label><span>下一任务</span><input name="nextTaskId" defaultValue={project?.nextTaskId ?? ''} maxLength={80} /></label>
              <label className="is-wide"><span>风险备注</span><textarea name="riskNote" maxLength={20_000} defaultValue={project?.riskNote ?? ''} /></label>
            </> : null}

            {kind === 'milestone' ? <>
              <label><span>项目</span><select name="projectId" defaultValue={milestone?.projectId ?? parentId ?? projects[0]?.id} disabled={Boolean(milestone)}>{projects.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>{milestone ? <input type="hidden" name="projectId" value={milestone.projectId} /> : null}</label>
              <label><span>到期日</span><input name="dueOn" type="date" defaultValue={milestone?.dueOn ?? ''} /></label>
              <label><span>排序</span><input name="position" type="number" min="0" max="4294967295" step="1" defaultValue={milestone?.position ?? 0} /></label>
            </> : null}
          </div>
          {error ? <p className="goal-editor__error" role="alert">{error}</p> : null}
          <footer><button type="button" onClick={onClose} disabled={saving}>取消</button><button type="submit" className="is-primary" disabled={saving}>{saving ? '正在保存…' : '保存'}</button></footer>
        </form>
      </section>
    </div>
  )
}
