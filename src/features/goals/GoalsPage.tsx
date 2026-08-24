import { useCallback, useMemo, useState } from 'react'
import { LayoutGroup } from 'motion/react'
import { useSearchParams } from 'react-router-dom'
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
import { GoalEditor, type GoalEditorSubmission } from './GoalEditor'
import { GoalInspector } from './GoalInspector'
import { OutcomeMap, type OutcomeSelection } from './OutcomeMap'
import { useGoals } from './useGoals'

interface EditorState {
  kind: OutcomeSelection['type']
  value?: Goal | Project | Milestone
  parentId?: string
}

interface UndoState {
  selection: OutcomeSelection
  title: string
  version: number
}

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function quarterRange(now: Date) {
  const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3
  const from = new Date(now.getFullYear(), quarterStartMonth, 1)
  const to = new Date(now.getFullYear(), quarterStartMonth + 3, 0)
  return { from: dateKey(from), to: dateKey(to) }
}

function findSelection(
  selection: OutcomeSelection | null,
  goals: Goal[],
  projects: Project[],
  milestones: Milestone[],
) {
  if (selection?.type === 'goal') return goals.find((item) => item.id === selection.id)
  if (selection?.type === 'project') return projects.find((item) => item.id === selection.id)
  if (selection?.type === 'milestone') return milestones.find((item) => item.id === selection.id)
  return undefined
}

function initialSelection(params: URLSearchParams, goals: Goal[], projects: Project[], milestones: Milestone[]): OutcomeSelection | null {
  const milestoneId = params.get('milestone')
  if (milestoneId && milestones.some((item) => item.id === milestoneId)) return { type: 'milestone', id: milestoneId }
  const projectId = params.get('project')
  if (projectId && projects.some((item) => item.id === projectId)) return { type: 'project', id: projectId }
  const goalId = params.get('goal')
  if (goalId && goals.some((item) => item.id === goalId)) return { type: 'goal', id: goalId }
  return goals[0] ? { type: 'goal', id: goals[0].id } : null
}

function attentionGroups(projects: Project[], now: string) {
  const staleBoundary = Date.parse(`${now}T23:59:59.999Z`) - 14 * 86_400_000
  return [
    { label: '停滞', items: projects.filter((project) => project.status === 'active' && Date.parse(project.updatedAt) < staleBoundary) },
    { label: '逾期', items: projects.filter((project) => project.status === 'active' && project.targetOn !== null && project.targetOn < now) },
    { label: '缺少下一步', items: projects.filter((project) => project.status === 'active' && !project.nextTaskId) },
  ]
}

export function GoalsPage({ now = new Date() }: { now?: Date }) {
  const goalsState = useGoals()
  const [searchParams, setSearchParams] = useSearchParams()
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [undo, setUndo] = useState<UndoState | null>(null)
  const closeEditor = useCallback(() => setEditor(null), [])
  const today = dateKey(now)
  const range = useMemo(() => quarterRange(now), [now])
  const priorities = useMemo(() => [...goalsState.goals]
    .filter((goal) => goal.status === 'active')
    .sort((left, right) => left.priority - right.priority || right.manualProgress - left.manualProgress || left.id.localeCompare(right.id))
    .slice(0, 3), [goalsState.goals])
  const quarterProgress = priorities.length
    ? Math.round(priorities.reduce((total, goal) => total + goal.manualProgress, 0) / priorities.length)
    : 0
  const querySelection = initialSelection(searchParams, goalsState.goals, goalsState.projects, goalsState.milestones)
  const selected = querySelection
  const attention = useMemo(() => attentionGroups(goalsState.projects, today), [goalsState.projects, today])

  const select = useCallback((selection: OutcomeSelection) => {
    const next = new URLSearchParams(searchParams)
    next.delete('goal')
    next.delete('project')
    next.delete('milestone')
    if (selection.type === 'goal') next.set('goal', selection.id)
    if (selection.type === 'project') {
      const project = goalsState.projects.find((item) => item.id === selection.id)
      if (project?.goalId) next.set('goal', project.goalId)
      next.set('project', selection.id)
    }
    if (selection.type === 'milestone') {
      const milestone = goalsState.milestones.find((item) => item.id === selection.id)
      const project = goalsState.projects.find((item) => item.id === milestone?.projectId)
      if (project?.goalId) next.set('goal', project.goalId)
      if (milestone) next.set('project', milestone.projectId)
      next.set('milestone', selection.id)
    }
    setSearchParams(next)
  }, [goalsState.milestones, goalsState.projects, searchParams, setSearchParams])

  const clearSelection = useCallback(() => {
    const next = new URLSearchParams(searchParams)
    next.delete('goal')
    next.delete('project')
    next.delete('milestone')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const openEditor = useCallback((selection: OutcomeSelection) => {
    const value = findSelection(selection, goalsState.goals, goalsState.projects, goalsState.milestones)
    if (value) setEditor({ kind: selection.type, value })
  }, [goalsState.goals, goalsState.milestones, goalsState.projects])

  const createChild = useCallback((selection: OutcomeSelection) => {
    if (selection.type === 'goal') setEditor({ kind: 'project', parentId: selection.id })
    if (selection.type === 'project') setEditor({ kind: 'milestone', parentId: selection.id })
  }, [])

  const save = async (submission: GoalEditorSubmission) => {
    if (submission.kind === 'goal') {
      if (editor?.value && 'priority' in editor.value) await goalsState.updateGoal(editor.value.id, submission.input as UpdateGoalInput)
      else await goalsState.createGoal(submission.input as CreateGoalInput)
    }
    if (submission.kind === 'project') {
      if (editor?.value && 'riskNote' in editor.value) await goalsState.updateProject(editor.value.id, submission.input as UpdateProjectInput)
      else await goalsState.createProject(submission.goalId, submission.input as CreateProjectInput)
    }
    if (submission.kind === 'milestone') {
      if (editor?.value && 'projectId' in editor.value && !('riskNote' in editor.value)) {
        await goalsState.updateMilestone(editor.value.id, submission.input as UpdateMilestoneInput)
      } else await goalsState.createMilestone(submission.projectId, submission.input as CreateMilestoneInput)
    }
  }

  const archive = useCallback(async (selection: OutcomeSelection) => {
    const value = findSelection(selection, goalsState.goals, goalsState.projects, goalsState.milestones)
    if (!value) return
    if (selection.type === 'goal' && 'priority' in value) await goalsState.archiveGoal(value.id, value.version)
    if (selection.type === 'project' && 'riskNote' in value) await goalsState.archiveProject(value.id, value.version)
    if (selection.type === 'milestone' && 'projectId' in value && !('riskNote' in value)) await goalsState.archiveMilestone(value.id, value.version)
    setUndo({ selection, title: value.title, version: value.version + 1 })
    clearSelection()
  }, [clearSelection, goalsState.archiveGoal, goalsState.archiveMilestone, goalsState.archiveProject, goalsState.goals, goalsState.milestones, goalsState.projects])

  const restore = useCallback(async () => {
    if (!undo) return
    if (undo.selection.type === 'goal') await goalsState.restoreGoal(undo.selection.id, undo.version)
    if (undo.selection.type === 'project') await goalsState.restoreProject(undo.selection.id, undo.version)
    if (undo.selection.type === 'milestone') await goalsState.restoreMilestone(undo.selection.id, undo.version)
    select(undo.selection)
    setUndo(null)
  }, [goalsState.restoreGoal, goalsState.restoreMilestone, goalsState.restoreProject, select, undo])

  const completeMilestone = useCallback((id: string, version: number) => {
    void goalsState.completeMilestone(id, version)
  }, [goalsState.completeMilestone])

  const pageError = goalsState.status === 'forbidden'
    ? '你没有查看或修改这些目标的权限。'
    : goalsState.status === 'conflict'
      ? '这份内容已在另一处更新。你的修改没有覆盖新版本，请检查后重试。'
      : goalsState.status === 'disconnected'
        ? '当前设备离线。已保留页面内容，重新联网后再继续。'
        : goalsState.status === 'network-error'
          ? '目标与项目暂时无法加载。'
          : null

  return (
    <article className="goals-page" data-goals-page>
      <header className="goals-page__heading">
        <div><h1 tabIndex={-1}>目标与项目</h1><p>把长期方向、正在推进的工作和关键里程碑放在同一条时间坐标上。</p></div>
        <button type="button" onClick={() => setEditor({ kind: 'goal' })}>新建目标</button>
      </header>

      {pageError ? <div className="goals-page__error" role="alert"><p>{pageError}</p><button type="button" onClick={goalsState.retry}>重新加载</button></div> : null}
      {goalsState.status === 'loading' ? <div className="goals-page__state" role="status"><span />正在整理成果地图…</div> : null}
      {goalsState.status === 'empty' ? <section className="goals-page__empty"><h2>先确定一个值得持续投入的方向</h2><p>目标不是指标墙。先写下真正重要的一件事，再把它拆成项目与里程碑。</p><button type="button" onClick={() => setEditor({ kind: 'goal' })}>创建第一个目标</button></section> : null}

      {goalsState.goals.length ? <>
        <section className="goals-priority" role="region" aria-label="当前优先目标">
          <div className="goals-priority__list">
            <h2>当前优先目标</h2>
            <ol>{priorities.map((goal) => <li key={goal.id}><button type="button" onClick={() => select({ type: 'goal', id: goal.id })}><span>{goal.title}</span><strong>{goal.manualProgress}%</strong></button></li>)}</ol>
          </div>
          <div className="goals-quarter-progress">
            <div><span>本季度进度</span><strong>{quarterProgress}%</strong></div>
            <div role="progressbar" aria-label="本季度进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={quarterProgress}><span style={{ width: `${quarterProgress}%` }} /></div>
          </div>
        </section>

        <LayoutGroup id="goals-outcomes">
        <div className="goals-workspace" data-layout="8/4">
          <div className="goals-map-column" data-testid="goals-map-column" data-grid-span="8">
            <OutcomeMap
              goals={goalsState.goals}
              projects={goalsState.projects}
              milestones={goalsState.milestones}
              range={range}
              now={today}
              selected={selected}
              onSelect={select}
              onEdit={openEditor}
            />
          </div>
          <GoalInspector
            selection={selected}
            goals={goalsState.goals}
            projects={goalsState.projects}
            milestones={goalsState.milestones}
            mobileOpen={Boolean(searchParams.get('goal') || searchParams.get('project') || searchParams.get('milestone'))}
            onEdit={openEditor}
            onArchive={(selection) => void archive(selection)}
            onCreateChild={createChild}
            onCompleteMilestone={completeMilestone}
            onClose={clearSelection}
          />
        </div>
        </LayoutGroup>

        <section className="goals-attention" role="region" aria-label="需要处理的项目">
          <header><h2>需要处理的项目</h2><p>只抬高需要判断的事实，不制造虚假的紧迫感。</p></header>
          <div>{attention.map((group) => <section key={group.label}><h3>{group.label}</h3>{group.items.length ? <ol>{group.items.map((project) => <li key={project.id}><button type="button" onClick={() => select({ type: 'project', id: project.id })}><span>{project.title}</span><small>{project.riskNote || project.description}</small></button></li>)}</ol> : <p>当前没有{group.label}项目</p>}</section>)}</div>
        </section>
      </> : null}

      {undo ? <div className="goals-undo" role="status"><span>已归档“{undo.title}”</span><button type="button" onClick={() => void restore()}>撤销归档</button></div> : null}
      {editor ? <GoalEditor
        key={`${editor.kind}-${editor.value?.id ?? editor.parentId ?? 'new'}`}
        kind={editor.kind}
        value={editor.value}
        parentId={editor.parentId}
        goals={goalsState.goals}
        projects={goalsState.projects}
        onClose={closeEditor}
        onSave={save}
      /> : null}
    </article>
  )
}
