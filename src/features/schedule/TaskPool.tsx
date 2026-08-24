import type { Task } from '../../domain/tasks'

export interface TaskPoolGroup {
  id: 'today' | 'due' | 'unscheduled' | 'overdue'
  label: '今天' | '临期' | '未排期' | '已逾期'
  tasks: Task[]
}

interface TaskPoolProps {
  groups: TaskPoolGroup[]
  onPick(task: Task): void
  onEdit(task: Task): void
}

function taskMeta(task: Task) {
  if (task.startsAt) return new Date(task.startsAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  if (task.dueAt) return `截止 ${new Date(task.dueAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`
  return task.estimateMinutes ? `预计 ${task.estimateMinutes} 分钟` : '尚未估时'
}

export function TaskPool({ groups, onPick, onEdit }: TaskPoolProps) {
  return (
    <aside className="task-pool" aria-label="任务池">
      <header><span>任务池</span><strong>{groups.reduce((total, group) => total + group.tasks.length, 0)} 项需要判断</strong></header>
      {groups.map((group) => (
        <section className="task-pool__group" key={group.id} data-pool={group.id}>
          <div><h2>{group.label}</h2><span>{group.tasks.length}</span></div>
          {group.tasks.length ? <ol>{group.tasks.map((task) => (
            <li key={`${group.id}-${task.id}`}>
              <button type="button" aria-label={`排期：${task.title}`} onClick={() => onPick(task)}>
                <span>{task.title}</span><small>{taskMeta(task)}</small>
              </button>
              <button type="button" aria-label={`编辑：${task.title}`} onClick={() => onEdit(task)}>编辑</button>
            </li>
          ))}</ol> : <p>这里暂时没有任务</p>}
        </section>
      ))}
    </aside>
  )
}
