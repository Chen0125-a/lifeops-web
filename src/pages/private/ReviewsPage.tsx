import { type FormEvent, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PrivateSurface } from '../../components/private/PrivateSurface'
import { useLifeRepository, useLifeState } from '../../state/LifeDataContext'

const padDatePart = (value: number) => String(value).padStart(2, '0')

export const formatLocalDate = (date: Date) =>
  `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`

export function ReviewsPage() {
  const repository = useLifeRepository()
  const state = useLifeState()
  const [summary, setSummary] = useState('')
  const [insight, setInsight] = useState('')
  const [createdId, setCreatedId] = useState<string>()
  const period = useMemo(() => {
    const end = new Date()
    const start = new Date(end)
    start.setDate(end.getDate() - 6)
    return { start: formatLocalDate(start), end: formatLocalDate(end) }
  }, [])
  const completed = state.plans.filter((plan) => plan.status === 'done')

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const review = await repository.createReview({
      periodStart: period.start,
      periodEnd: period.end,
      summary,
      insights: [insight],
      sourcePlanIds: completed.map((plan) => plan.id),
      sourceRecordIds: state.records.map((record) => record.id),
    })
    setCreatedId(review.id)
    setSummary('')
    setInsight('')
  }

  return (
    <PrivateSurface title="从一段时间里，认出自己的变化。" lead="回顾不追求漂亮数字，只把计划、经历与新的理解放回同一条时间弧。">
      <section className="review-observatory" aria-label="周期回顾">
        <div className="review-arc">
          <div className="review-arc__dial" aria-hidden="true"><span>{new Date(period.start).getDate()}</span><i>—</i><span>{new Date(period.end).getDate()}</span></div>
          <h2>{completed.length + state.records.length} 条来源已准备</h2>
          <p>其中包含 {completed.length} 件已完成计划与 {state.records.length} 条生活记录。这里只计算你真实保存的内容。</p>
          <div className="review-evidence">
            {completed.map((plan) => <span key={plan.id}>计划 · {plan.title}</span>)}
            {state.records.map((record) => <span key={record.id}>记录 · {record.title}</span>)}
          </div>
          {state.reviews.length > 0 && <div className="review-history"><h3>以往回顾</h3>{[...state.reviews].reverse().map((review) => <article key={review.id}><time>{review.periodStart} — {review.periodEnd}</time><strong>{review.summary}</strong></article>)}</div>}
        </div>
        <form className="life-form life-form--review" onSubmit={save}>
          <h2>这一段时间说明了什么？</h2>
          <label htmlFor="review-summary">回顾总结</label>
          <textarea id="review-summary" value={summary} onChange={(event) => setSummary(event.target.value)} rows={4} required />
          <label htmlFor="review-insight">新的理解</label>
          <textarea id="review-insight" value={insight} onChange={(event) => setInsight(event.target.value)} rows={3} required />
          <button className="life-primary-action" type="submit" aria-label="保存周期回顾">保存周期回顾 <span>→</span></button>
          {createdId && <Link className="next-loop-link" to={`/app/knowledge?review=${createdId}`}>把本次回顾提炼为知识</Link>}
        </form>
      </section>
    </PrivateSurface>
  )
}
