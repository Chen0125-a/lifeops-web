import { useState } from 'react'
import type { ReviewEvidence } from '../../domain/reviews'

type EvidenceFilter = 'all' | 'goals' | 'projects' | 'tasks' | 'habits' | 'records' | 'commitments'

const filters: Array<{ id: EvidenceFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'goals', label: '目标' },
  { id: 'projects', label: '项目' },
  { id: 'tasks', label: '任务' },
  { id: 'habits', label: '习惯' },
  { id: 'records', label: '记录' },
  { id: 'commitments', label: '承诺' },
]

export function EvidenceRail({ evidence, onRefresh, refreshing = false }: {
  evidence: ReviewEvidence
  onRefresh: () => void
  refreshing?: boolean
}) {
  const [filter, setFilter] = useState<EvidenceFilter>('all')
  const visible = (id: EvidenceFilter) => filter === 'all' || filter === id

  return (
    <aside className="review-evidence-rail" role="region" aria-label="证据目录" data-grid-span="3">
      <header>
        <div>
          <span>事实层</span>
          <h2>证据目录</h2>
        </div>
        <button type="button" onClick={onRefresh} disabled={refreshing}>刷新证据</button>
      </header>
      <p className="review-evidence-rail__note">只读取当前周期内已经保存的事实；筛选不会改写原始数据。</p>
      <nav className="review-evidence-filter" aria-label="证据来源筛选">
        {filters.map((item) => (
          <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>
        ))}
      </nav>
      <div className="review-evidence-groups">
        {visible('goals') ? <section role="group" aria-label="目标证据"><span>目标</span><strong>{evidence.goals.active} 个进行中 · {evidence.goals.completed} 个完成</strong></section> : null}
        {visible('projects') ? <section role="group" aria-label="项目证据"><span>项目</span><strong>{evidence.projects.active} 个进行中 · {evidence.projects.completed} 个完成</strong></section> : null}
        {visible('tasks') ? <section role="group" aria-label="任务证据"><span>任务</span><strong>{evidence.tasks.completed} / {evidence.tasks.total} 完成</strong><small>{evidence.tasks.skipped} 主动跳过 · {evidence.tasks.cancelled} 取消</small></section> : null}
        {visible('habits') ? <section role="group" aria-label="习惯证据"><span>习惯</span><strong>{evidence.habits.done} 完成 · {evidence.habits.partial} 部分 · {evidence.habits.intentionalSkips} 主动跳过</strong><small>{evidence.habits.entries} 条真实记录</small></section> : null}
        {visible('records') ? <section role="group" aria-label="记录证据"><span>记录</span><strong>{evidence.records.total} 条记录</strong><small>{evidence.records.ids.length ? evidence.records.ids.join(' · ') : '本周期没有记录'}</small></section> : null}
        {visible('commitments') ? (
          <section role="group" aria-label="上次承诺">
            <span>上次承诺</span>
            {evidence.priorCommitments.length
              ? <ul>{evidence.priorCommitments.map((item) => <li key={`${item.reviewId}:${item.text}`}>{item.text}</li>)}</ul>
              : <small>没有待处理的承诺</small>}
          </section>
        ) : null}
      </div>
      {!evidence.hasFacts ? <p className="review-evidence-rail__empty">这个周期还没有可聚合事实；你仍可写草稿，但系统不会生成洞察。</p> : null}
    </aside>
  )
}
