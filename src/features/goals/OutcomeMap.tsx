import { memo, useMemo } from 'react'
import { motion } from 'motion/react'
import type { Goal, Milestone, Project } from '../../domain/goals'

export interface OutcomeSelection {
  type: 'goal' | 'project' | 'milestone'
  id: string
}

export interface OutcomeMapProps {
  goals: Goal[]
  projects: Project[]
  milestones: Milestone[]
  range: { from: string; to: string }
  now: string
  selected: OutcomeSelection | null
  onSelect(selection: OutcomeSelection): void
  onEdit(selection: OutcomeSelection): void
}

interface TimelineItem {
  id: string
  type: OutcomeSelection['type']
  title: string
  from: string
  to: string
  progress: number | null
  parentTitle: string | null
}

const day = 86_400_000

function dateTime(value: string) {
  const parsed = Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`)
  return Number.isFinite(parsed) ? parsed : 0
}

function percent(value: string, range: OutcomeMapProps['range']) {
  const from = dateTime(range.from)
  const to = dateTime(range.to)
  const span = Math.max(day, to - from)
  return Math.min(100, Math.max(0, ((dateTime(value) - from) / span) * 100))
}

function toItems(goals: Goal[], projects: Project[], milestones: Milestone[], range: OutcomeMapProps['range']) {
  const goalNames = new Map(goals.map((goal) => [goal.id, goal.title]))
  const projectNames = new Map(projects.map((project) => [project.id, project.title]))
  const items: TimelineItem[] = []
  for (const goal of goals) items.push({
    id: goal.id,
    type: 'goal',
    title: goal.title,
    from: goal.startsOn ?? range.from,
    to: goal.targetOn ?? range.to,
    progress: goal.manualProgress,
    parentTitle: null,
  })
  for (const project of projects) items.push({
    id: project.id,
    type: 'project',
    title: project.title,
    from: project.startsOn ?? range.from,
    to: project.targetOn ?? range.to,
    progress: project.progress,
    parentTitle: project.goalId ? goalNames.get(project.goalId) ?? null : null,
  })
  for (const milestone of milestones) items.push({
    id: milestone.id,
    type: 'milestone',
    title: milestone.title,
    from: milestone.dueOn ?? range.to,
    to: milestone.dueOn ?? range.to,
    progress: milestone.completedAt ? 100 : null,
    parentTitle: projectNames.get(milestone.projectId) ?? null,
  })
  return items
}

const typeLabel = { goal: '目标', project: '项目', milestone: '里程碑' } as const

export const OutcomeMap = memo(function OutcomeMap({
  goals,
  projects,
  milestones,
  range,
  now,
  selected,
  onSelect,
  onEdit,
}: OutcomeMapProps) {
  const items = useMemo(() => toItems(goals, projects, milestones, range), [goals, milestones, projects, range])
  const height = Math.max(260, items.length * 46 + 38)
  const today = percent(now, range)

  return (
    <section className="outcome-map" data-testid="outcome-map" data-layout="timeline" data-motion-layout-scope="goals-outcomes" data-range={`${range.from}/${range.to}`}>
      <header className="outcome-map__heading">
        <div><h2>成果地图</h2><p>目标给出方向，项目与里程碑把方向放进时间。</p></div>
        <time>{range.from.replaceAll('-', '.')} — {range.to.replaceAll('-', '.')}</time>
      </header>

      <div className="outcome-map__plot" role="img" aria-label="目标、项目与里程碑成果地图" style={{ minHeight: height }}>
        <svg aria-hidden="true" viewBox={`0 0 1000 ${height}`} preserveAspectRatio="none">
          {[0, 25, 50, 75, 100].map((position) => <line key={position} x1={position * 10} x2={position * 10} y1="0" y2={height} className="outcome-map__grid-line" />)}
          <line x1={today * 10} x2={today * 10} y1="0" y2={height} className="outcome-map__today-line" />
          {items.map((item, index) => {
            const start = percent(item.from, range)
            const end = percent(item.to, range)
            const y = index * 46 + 24
            if (item.type === 'milestone') return <circle key={`${item.type}-${item.id}`} cx={start * 10} cy={y} r="7" data-shape="milestone" />
            return <rect
              key={`${item.type}-${item.id}`}
              x={start * 10}
              y={y - (item.type === 'goal' ? 8 : 5)}
              width={Math.max(item.type === 'goal' ? 18 : 10, (end - start) * 10)}
              height={item.type === 'goal' ? 16 : 10}
              rx={item.type === 'goal' ? 8 : 5}
              data-shape={item.type}
            />
          })}
        </svg>
        <span className="outcome-map__today" data-date={now} style={{ left: `${today}%` }}>今天</span>
      </div>

      <ol className="outcome-map__rows" aria-label="成果地图对象">
        {items.map((item) => {
          const selection = { type: item.type, id: item.id } as const
          return (
            <li key={`${item.type}-${item.id}`} data-selected={selected?.type === item.type && selected.id === item.id}>
              {selected?.type === item.type && selected.id === item.id ? (
                <motion.span
                  aria-hidden="true"
                  className="outcome-map__selection-marker"
                  data-layout-identity="goals-selected-object"
                  layoutId="selected-object"
                />
              ) : null}
              <button type="button" onClick={() => onSelect(selection)} aria-label={`选择${typeLabel[item.type]} ${item.title}`}>
                <span data-kind={item.type}>{item.title}</span>
                <small>{item.parentTitle ? `${item.type === 'project' ? '目标' : '项目'} · ${item.parentTitle}` : typeLabel[item.type]}</small>
                <time>{item.type === 'milestone' ? item.from : `${item.from} → ${item.to}`}</time>
                {item.progress === null ? null : <span className="outcome-map__progress">{item.progress}%</span>}
              </button>
              <button type="button" className="outcome-map__edit" onClick={() => onEdit(selection)} aria-label={`编辑${typeLabel[item.type]} ${item.title}`}>编辑</button>
            </li>
          )
        })}
      </ol>
    </section>
  )
})
