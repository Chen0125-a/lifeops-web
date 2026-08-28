import { type FocusEvent, type PointerEvent, useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { goalsApi } from '../../api/goalsApi'
import { habitsApi } from '../../api/habitsApi'
import { isLocalDemoMode } from '../../api/lifeApi'
import { queryKeys } from '../../api/queryKeys'
import { recordsApi } from '../../api/recordsApi'
import { reviewsApi } from '../../api/reviewsApi'
import { tasksApi } from '../../api/tasksApi'
import type { Review } from '../../domain/reviews'
import type { Task } from '../../domain/tasks'
import { useLifeState } from '../../state/LifeDataContext'
import { buildOverviewModel, type OverviewModel } from './overviewModel'
import { useLifeDay } from '../life/useLifeDay'

export type OverviewSection = 'timeline' | 'goals' | 'habits' | 'trends' | 'records' | 'review' | 'knowledge'
export interface OverviewPageProps {
  model: OverviewModel
  lifeSummary?: { nextAction: string; plannedCount: number; completedCount: number; incomplete: boolean }
  componentErrors?: Partial<Record<OverviewSection, string>>
  onRetry?: (section: OverviewSection) => void
}

const healthLabel = {
  healthy: '运行正常',
  degraded: '性能下降',
  disconnected: '服务未连接',
  unknown: '状态未验证',
} as const

function preloadRecordsRoute(event: FocusEvent<HTMLAnchorElement> | PointerEvent<HTMLAnchorElement>) {
  const link = event.currentTarget
  link.dataset.routePreloadState = 'loading'
  void import('../records/RecordsPage').then(() => {
    if (link.isConnected) link.dataset.routePreloadState = 'ready'
  }).catch(() => {
    if (link.isConnected) link.dataset.routePreloadState = 'failed'
  })
}

function SectionError({ message, name, section, onRetry }: { message: string; name: string; section: OverviewSection; onRetry?: (section: OverviewSection) => void }) {
  return <div className="overview-inline-error"><p role="alert">{message}</p><button type="button" onClick={() => onRetry?.(section)}>重试{name}</button></div>
}

export function OverviewPage({ model, lifeSummary, componentErrors = {}, onRetry }: OverviewPageProps) {
  return (
    <article className="overview-canvas" data-overview-canvas>
      <header className="overview-heading">
        <h1 tabIndex={-1}>总览</h1>
      </header>

      <section className="overview-status-strip" data-grid-span="12" data-testid="overview-status-strip" aria-label="今日状态">
        <div><time>{model.statusStrip.dateLabel}</time><strong>{model.statusStrip.greeting}</strong></div>
        <div><span>本周进度</span><strong>{model.statusStrip.week.completed} / {model.statusStrip.week.total}</strong></div>
        <Link to="/app/schedule?create=task">快速创建</Link>
        <Link className={`overview-health is-${model.statusStrip.platformHealth}`} to="/app/platform">
          <span>平台</span><strong>{healthLabel[model.statusStrip.platformHealth]}</strong>
        </Link>
      </section>

      {lifeSummary ? <section className="overview-life-summary" aria-label="今日生活摘要">
        <div><span>今日生活</span><strong>{lifeSummary.completedCount} / {lifeSummary.plannedCount} 已完成</strong></div>
        <p>下一步：{lifeSummary.nextAction}</p>
        {lifeSummary.incomplete ? <small>数据不完整</small> : <small>事实已汇总</small>}
        <Link to="/app/life">打开今日生活</Link>
      </section> : null}

      <div className="overview-primary" data-layout="7/5" data-testid="overview-primary">
        <section className="overview-timeline" data-grid-span="7" aria-label="今天时间线">
          <header><h2>今天时间线</h2><Link to="/app/schedule">打开日程</Link></header>
          {componentErrors.timeline ? <SectionError message={componentErrors.timeline} name="今天时间线" section="timeline" onRetry={onRetry} /> : model.todayTimeline.length ? (
            <ol>{model.todayTimeline.map((item) => <li key={item.id}><time>{item.at ?? '待安排'}</time><strong>{item.title}</strong><span>{item.status === 'done' ? '已完成' : item.status === 'doing' ? '正在进行' : '等待执行'}</span></li>)}</ol>
          ) : <div className="overview-empty"><p>今天还没有排定任务，把真正重要的一步放进时间里。</p><Link to="/app/schedule?create=task">创建今天的任务</Link></div>}
        </section>

        <section className="overview-focus" data-grid-span="5" aria-label="当前重点">
          <header><h2>当前重点</h2><Link to="/app/goals">查看全部</Link></header>
          {componentErrors.goals ? <SectionError message={componentErrors.goals} name="当前重点" section="goals" onRetry={onRetry} /> : model.topGoals.length ? (
            <div className="overview-goal-stack">{model.topGoals.map((goal) => <article key={goal.id}><div><strong>{goal.title}</strong><span>{goal.progress}%</span></div><progress max="100" value={goal.progress} aria-label={`${goal.title}进度`} /></article>)}{model.activeProjects.slice(0, 3).map((project) => <Link key={project.id} to={`/app/goals?project=${encodeURIComponent(project.id)}`}><span>{project.title}</span><strong>{project.progress}%</strong></Link>)}</div>
          ) : <div className="overview-empty"><p>还没有正在推进的重点。先确定一个值得持续投入的方向。</p><Link to="/app/goals?create=goal">添加优先目标</Link></div>}
        </section>
      </div>

      <section className="overview-habits" aria-label="习惯七日节奏">
        <header><h2>习惯七日节奏</h2><Link to="/app/habits">查看习惯</Link></header>
        {componentErrors.habits ? <SectionError message={componentErrors.habits} name="习惯七日节奏" section="habits" onRetry={onRetry} /> : model.habitWeek.rows.length ? (
          <div className="overview-habit-grid" role="grid" aria-label="本周习惯完成状态">
            <div className="overview-habit-grid__days" aria-hidden="true">{model.habitWeek.days.map((day) => <span key={day.date}>{day.label}</span>)}</div>
            {model.habitWeek.rows.map((row) => <div role="row" key={row.id}><strong role="rowheader">{row.title}</strong>{row.cells.map((cell) => <span role="gridcell" key={cell.date} data-status={cell.status} aria-label={`${cell.date} ${cell.status}`} />)}</div>)}
          </div>
        ) : <div className="overview-empty"><p>习惯会在这里形成七天节奏，不用连胜或徽章制造压力。</p><Link to="/app/habits">记录一次习惯</Link></div>}
      </section>

      <div className="overview-evidence-band">
        <section aria-label="本周趋势">
          <header><h2>本周趋势</h2></header>
          {componentErrors.trends ? <SectionError message={componentErrors.trends} name="本周趋势" section="trends" onRetry={onRetry} /> : <dl><div><dt>完成任务</dt><dd>{model.trends.completedTasks}</dd></div><div><dt>习惯完成</dt><dd>{model.trends.habitCompletions}</dd></div><div><dt>生活记录</dt><dd>{model.trends.recordCount}</dd></div></dl>}
        </section>
        <section aria-label="最近记录">
          <header><h2>最近记录</h2><Link onFocus={preloadRecordsRoute} onPointerEnter={preloadRecordsRoute} to="/app/records">全部记录</Link></header>
          {componentErrors.records ? <SectionError message={componentErrors.records} name="最近记录" section="records" onRetry={onRetry} /> : model.recentRecords.length ? <ol>{model.recentRecords.map((record) => <li key={record.id}><time>{new Date(record.occurredAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</time><strong>{record.title}</strong></li>)}</ol> : <div className="overview-empty"><p>记录真实发生过的事，回顾才有证据。</p><Link onFocus={preloadRecordsRoute} onPointerEnter={preloadRecordsRoute} to="/app/records?create=record">写下今天</Link></div>}
        </section>
        <section aria-label="上次回顾">
          <header><h2>上次回顾</h2><Link to="/app/reviews">查看回顾</Link></header>
          {componentErrors.review ? <SectionError message={componentErrors.review} name="上次回顾" section="review" onRetry={onRetry} /> : model.priorInsight ? <blockquote>{model.priorInsight.text}</blockquote> : <div className="overview-empty"><p>用一段回顾把事实变成下一次可用的判断。</p><Link to="/app/reviews?create=weekly">开始本周回顾</Link></div>}
        </section>
        <section aria-label="重新浮现的知识">
          <header><h2>重新浮现的知识</h2><Link to="/app/knowledge">知识库</Link></header>
          {componentErrors.knowledge ? <SectionError message={componentErrors.knowledge} name="重新浮现的知识" section="knowledge" onRetry={onRetry} /> : model.resurfacedKnowledge.length ? <ol>{model.resurfacedKnowledge.map((note) => <li key={note.id}><strong>{note.title}</strong><p>{note.body}</p></li>)}</ol> : <div className="overview-empty"><p>把可复用的理解留下来，它会在合适的时间重新出现。</p><Link to="/app/knowledge?create=note">添加知识</Link></div>}
        </section>
      </div>
    </article>
  )
}

function localTask(plan: ReturnType<typeof useLifeState>['plans'][number]): Task {
  const scheduledAt = plan.scheduledFor ? `${plan.scheduledFor}T09:00:00` : null
  return {
    id: plan.id,
    goalId: null,
    projectId: null,
    milestoneId: null,
    title: plan.title,
    description: '',
    startsAt: scheduledAt,
    endsAt: null,
    dueAt: scheduledAt,
    estimateMinutes: null,
    priority: 2,
    tags: [],
    status: plan.status === 'done' ? 'done' : plan.status === 'skipped' ? 'skipped' : 'planned',
    checklist: [],
    recurrence: null,
    version: 1,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    completedAt: plan.completedAt ?? null,
    deletedAt: null,
  }
}

function localReview(review: ReturnType<typeof useLifeState>['reviews'][number]): Review {
  const period = { from: review.periodStart, to: review.periodEnd }
  return {
    id: review.id,
    type: 'custom',
    period,
    status: 'draft',
    achievements: [],
    problems: [],
    causes: [],
    insights: review.insights,
    nextChanges: [],
    evidence: {
      period,
      goals: { active: 0, completed: 0 },
      projects: { active: 0, completed: 0 },
      tasks: { total: 0, completed: 0, skipped: 0, cancelled: 0 },
      habits: { entries: 0, done: 0, partial: 0, intentionalSkips: 0 },
      records: { total: review.evidence.filter((item) => item.type === 'record').length, ids: review.evidence.filter((item) => item.type === 'record').map((item) => item.sourceId) },
      priorCommitments: [],
      hasFacts: review.evidence.length > 0,
    },
    actions: [],
    version: 1,
    createdAt: review.createdAt,
    updatedAt: review.createdAt,
    deletedAt: null,
  }
}

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function currentWeek(now: Date) {
  const from = new Date(now)
  from.setHours(0, 0, 0, 0)
  const weekday = from.getDay()
  from.setDate(from.getDate() - (weekday === 0 ? 6 : weekday - 1))
  const to = new Date(from)
  to.setDate(to.getDate() + 6)
  return { from: dateKey(from), to: dateKey(to) }
}

/** Route adapter: production reads Plan 1 APIs; local preview keeps its explicit on-device fixture boundary. */
export function OverviewRoute() {
  const legacyState = useLifeState()
  const now = useMemo(() => new Date(), [])
  const week = useMemo(() => currentWeek(now), [now])
  const lifeDay = useLifeDay(dateKey(now))
  const goalsQuery = useQuery({
    queryKey: queryKeys.goals.lists,
    queryFn: ({ signal }) => goalsApi.list(signal),
    enabled: !isLocalDemoMode,
  })
  const tasksQuery = useQuery({
    queryKey: queryKeys.tasks.lists,
    queryFn: ({ signal }) => tasksApi.list(signal),
    enabled: !isLocalDemoMode,
  })
  const habitsQuery = useQuery({
    queryKey: queryKeys.habits.list(week),
    queryFn: ({ signal }) => habitsApi.list(week, signal),
    enabled: !isLocalDemoMode,
  })
  const recordsQuery = useQuery({
    queryKey: queryKeys.records.lists,
    queryFn: ({ signal }) => recordsApi.list({}, signal),
    enabled: !isLocalDemoMode,
  })
  const reviewsQuery = useQuery({
    queryKey: queryKeys.reviews.lists,
    queryFn: ({ signal }) => reviewsApi.list({}, signal),
    enabled: !isLocalDemoMode,
  })
  const projectQueries = useQueries({
    queries: (goalsQuery.data ?? []).map((goal) => ({
      queryKey: queryKeys.projects.list({ goalId: goal.id }),
      queryFn: ({ signal }: { signal: AbortSignal }) => goalsApi.listProjects(goal.id, signal),
      enabled: !isLocalDemoMode,
    })),
  })

  const model = useMemo(() => buildOverviewModel(isLocalDemoMode ? {
    goals: [],
    projects: [],
    tasks: legacyState.plans.map(localTask),
    habits: [],
    entries: [],
    records: legacyState.records,
    reviews: legacyState.reviews.map(localReview),
    knowledge: legacyState.knowledge,
    now,
    platformHealth: 'unknown',
  } : {
    goals: goalsQuery.data ?? [],
    projects: projectQueries.flatMap((query) => query.data ?? []),
    tasks: tasksQuery.data ?? [],
    habits: habitsQuery.data?.habits ?? [],
    entries: habitsQuery.data?.entries ?? [],
    records: recordsQuery.data ?? [],
    reviews: reviewsQuery.data ?? [],
    knowledge: legacyState.knowledge,
    now,
    platformHealth: 'unknown',
  }), [goalsQuery.data, habitsQuery.data, legacyState, now, projectQueries, recordsQuery.data, reviewsQuery.data, tasksQuery.data])

  const componentErrors: OverviewPageProps['componentErrors'] = isLocalDemoMode ? {} : {
    ...(tasksQuery.isError ? { timeline: '今天时间线暂时无法加载。' } : {}),
    ...(goalsQuery.isError || projectQueries.some((query) => query.isError) ? { goals: '当前重点暂时无法加载。' } : {}),
    ...(habitsQuery.isError ? { habits: '习惯七日节奏暂时无法加载。' } : {}),
    ...(recordsQuery.isError ? { records: '最近记录暂时无法加载。' } : {}),
    ...(reviewsQuery.isError ? { review: '上次回顾暂时无法加载。' } : {}),
  }
  const retry = (section: OverviewSection) => {
    if (section === 'timeline') void tasksQuery.refetch()
    if (section === 'goals') {
      void goalsQuery.refetch()
      void Promise.all(projectQueries.map((query) => query.refetch()))
    }
    if (section === 'habits') void habitsQuery.refetch()
    if (section === 'records') void recordsQuery.refetch()
    if (section === 'review') void reviewsQuery.refetch()
  }

  const lifeItems = lifeDay.timeline?.timelineItems ?? []
  const lifeSummary = lifeDay.status === 'ready' ? {
    nextAction: lifeItems.find((item) => !['completed', 'skipped', 'cancelled'].includes(item.status))?.title ?? '安排今天的生活计划',
    plannedCount: lifeItems.length,
    completedCount: lifeItems.filter((item) => item.status === 'completed').length,
    incomplete: lifeDay.projection?.status === 'incomplete' || !lifeDay.projection,
  } : undefined

  return <OverviewPage model={model} lifeSummary={lifeSummary} componentErrors={componentErrors} onRetry={retry} />
}
