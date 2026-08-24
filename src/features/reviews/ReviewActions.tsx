import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { ConvertReviewActionInput, ReviewAction, ReviewActionTarget } from '../../domain/reviews'

const targets: Array<{ value: ReviewActionTarget; label: string }> = [
  { value: 'task', label: '任务' },
  { value: 'goal-update', label: '目标更新' },
  { value: 'knowledge', label: '知识草稿' },
  { value: 'public-draft', label: '公开草稿' },
]

const targetLabel = (target: ReviewActionTarget | null) => targets.find((item) => item.value === target)?.label ?? '未知去向'

function targetHref(action: ReviewAction) {
  if (!action.convertedTarget || !action.convertedId) return '#'
  const query = encodeURIComponent(action.convertedId)
  if (action.convertedTarget === 'task') return `/app/schedule?task=${query}`
  if (action.convertedTarget === 'goal-update') return `/app/goals?update=${query}`
  if (action.convertedTarget === 'knowledge') return `/app/knowledge?note=${query}`
  return `/app/publish?draft=${query}`
}

function ActionCard({ action, onConvert, busy }: {
  action: ReviewAction
  onConvert: (actionId: string, input: ConvertReviewActionInput) => Promise<unknown>
  busy: boolean
}) {
  const [target, setTarget] = useState<ReviewActionTarget>('task')

  return (
    <article className={`review-action ${action.status === 'converted' ? 'is-converted' : ''}`} aria-label={`行动 · ${action.text}`}>
      <span>{action.status === 'converted' ? '已完成转换' : '待决定去向'}</span>
      <h3>{action.text}</h3>
      {action.status === 'converted' ? (
        <div className="review-action__result">
          <strong>已转为{targetLabel(action.convertedTarget)}</strong>
          <Link to={targetHref(action)}>打开转换结果</Link>
          <small>该行动已绑定唯一结果，不能再次转换。</small>
        </div>
      ) : (
        <div className="review-action__convert">
          <label>
            <span>转换去向</span>
            <select aria-label="转换去向" value={target} onChange={(event) => setTarget(event.target.value as ReviewActionTarget)}>
              {targets.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <button type="button" disabled={busy} onClick={() => void onConvert(action.id, { target })}>转换行动</button>
        </div>
      )}
    </article>
  )
}

export function ReviewActions({ actions, onConvert, busy = false }: {
  actions: ReviewAction[]
  onConvert: (actionId: string, input: ConvertReviewActionInput) => Promise<unknown>
  busy?: boolean
}) {
  return (
    <aside className="review-actions" role="region" aria-label="洞察与行动" data-grid-span="3">
      <header>
        <span>行动层</span>
        <h2>把变化送到下一站</h2>
        <p>每条行动只能转换一次；目标与结果链接会保留在这里。</p>
      </header>
      <div className="review-actions__list">
        {actions.length
          ? actions.map((action) => <ActionCard key={action.id} action={action} onConvert={onConvert} busy={busy} />)
          : <p className="review-actions__empty">在“下一步变化”里写清行动，再将其保存为结构化行动。</p>}
      </div>
    </aside>
  )
}
