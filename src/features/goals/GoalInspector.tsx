import type { Goal, Milestone, Project } from '../../domain/goals'
import type { OutcomeSelection } from './OutcomeMap'

interface GoalInspectorProps {
  selection: OutcomeSelection | null
  goals: Goal[]
  projects: Project[]
  milestones: Milestone[]
  mobileOpen: boolean
  onEdit(selection: OutcomeSelection): void
  onArchive(selection: OutcomeSelection): void
  onCreateChild(selection: OutcomeSelection): void
  onCompleteMilestone(id: string, version: number): void
  onClose(): void
}

const statusLabel = {
  active: '进行中',
  paused: '已暂停',
  completed: '已完成',
  cancelled: '已取消',
} as const

export function GoalInspector({
  selection,
  goals,
  projects,
  milestones,
  mobileOpen,
  onEdit,
  onArchive,
  onCreateChild,
  onCompleteMilestone,
  onClose,
}: GoalInspectorProps) {
  const goal = selection?.type === 'goal' ? goals.find((item) => item.id === selection.id) : undefined
  const project = selection?.type === 'project' ? projects.find((item) => item.id === selection.id) : undefined
  const milestone = selection?.type === 'milestone' ? milestones.find((item) => item.id === selection.id) : undefined
  const entity = goal ?? project ?? milestone
  const kind = goal ? '目标' : project ? '项目' : milestone ? '里程碑' : null

  return (
    <aside className="goal-inspector" role="region" aria-label="对象检查器" data-grid-span="4" data-open={mobileOpen}>
      <div className="goal-inspector__mobile-bar">
        <button type="button" onClick={onClose}>返回成果地图</button>
        <span>{kind ?? '对象检查器'}</span>
      </div>
      {entity && selection && kind ? (
        <>
          <header>
            <span>{kind}</span>
            <h2>{entity.title}</h2>
            {'status' in entity ? <p>{statusLabel[entity.status]}</p> : <p>{entity.completedAt ? '已完成' : '等待完成'}</p>}
          </header>

          {goal ? (
            <dl>
              <div><dt>进度</dt><dd>{goal.manualProgress}%</dd></div>
              <div><dt>优先级</dt><dd>{goal.priority}</dd></div>
              <div><dt>时间</dt><dd>{goal.startsOn ?? '未设定'} — {goal.targetOn ?? '未设定'}</dd></div>
              <div><dt>说明</dt><dd>{goal.description || '没有补充说明'}</dd></div>
            </dl>
          ) : null}
          {project ? (
            <dl>
              <div><dt>所属目标</dt><dd>{goals.find((item) => item.id === project.goalId)?.title ?? '未关联目标'}</dd></div>
              <div><dt>进度</dt><dd>{project.progress}%</dd></div>
              <div><dt>下一任务</dt><dd>{project.nextTaskId ?? '尚未指定'}</dd></div>
              <div><dt>风险</dt><dd>{project.riskNote || '当前没有风险备注'}</dd></div>
            </dl>
          ) : null}
          {milestone ? (
            <dl>
              <div><dt>所属项目</dt><dd>{projects.find((item) => item.id === milestone.projectId)?.title ?? '未找到项目'}</dd></div>
              <div><dt>到期日</dt><dd>{milestone.dueOn ?? '未设定'}</dd></div>
              <div><dt>排序</dt><dd>{milestone.position}</dd></div>
            </dl>
          ) : null}

          <div className="goal-inspector__actions">
            <button type="button" className="is-primary" onClick={() => onEdit(selection)}>编辑{kind}</button>
            {selection.type === 'goal' ? <button type="button" onClick={() => onCreateChild(selection)}>添加项目</button> : null}
            {selection.type === 'project' ? <button type="button" onClick={() => onCreateChild(selection)}>添加里程碑</button> : null}
            {milestone && !milestone.completedAt ? <button type="button" onClick={() => onCompleteMilestone(milestone.id, milestone.version)}>标记完成</button> : null}
            <button type="button" className="is-danger" onClick={() => onArchive(selection)}>归档{kind}</button>
          </div>
        </>
      ) : (
        <div className="goal-inspector__empty">
          <h2>选择一个成果对象</h2>
          <p>从左侧时间地图选择目标、项目或里程碑，在这里查看事实并继续编辑。</p>
        </div>
      )}
    </aside>
  )
}
